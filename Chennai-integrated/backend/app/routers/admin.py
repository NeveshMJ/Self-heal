import json

import csv
import io
import os
import re
import zipfile
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import require_roles
from app.db.session import get_db
from app.models.models import (Article, ArticleEmbedding, Department, Ticket,
                               TicketAudit, User)
from app.schemas.schemas import ArticleIngest, AuditOut, RetentionPolicy
from app.services.article_ingest import ingest_article, parse_markdown
from app.services.ticket_ref import short_ref

router = APIRouter(prefix="/admin", tags=["Administration"])

_policy = RetentionPolicy()


def _enforce_size(content: bytes) -> None:
    """Second line of defence behind the body-size middleware, for clients
    that stream without a Content-Length header."""
    limit = int(settings.max_upload_mb * 1024 * 1024)
    if len(content) > limit:
        raise HTTPException(
            413, f"Upload too large. The limit is {settings.max_upload_mb} MB.")


# --------------------------------------------------------------------------
# audit serialization
# --------------------------------------------------------------------------
# maps a raw audit action to the category the UI colours / filters on
ACTION_TYPES = {
    "CREATED": "ticket",
    "MATCHED": "ticket",
    "SELF_HEAL_SUCCESS": "ticket",
    "SELF_HEAL_FAILED": "ticket",
    "SELF_HEAL_BLOCKED": "ticket",
    "OVERRIDDEN": "ticket",
    "ASK_MORE": "ticket",
    "ANSWERS_SUBMITTED": "ticket",
    "ESCALATED": "ticket",
    "LOGIN": "authentication",
    "DATASET_UPLOAD": "dataset",
    "RETENTION_UPDATE": "configuration",
}


def _parse_details(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    except (ValueError, TypeError):
        return {"value": raw}


def _summarise(action: str, details: dict) -> str:
    """One readable line for the table's Details column."""
    if action == "CREATED":
        return "Ticket created and queued for matching."
    if action == "MATCHED":
        score = details.get("score")
        band = details.get("band")
        if score is not None:
            return f"AI matched the ticket at {score}% ({band})."
        return "AI matching completed."
    if action == "SELF_HEAL_SUCCESS":
        return f"Self-healing executed via {details.get('script', 'sandbox script')}."
    if action == "SELF_HEAL_FAILED":
        return f"Self-healing failed: {details.get('error', 'unknown error')}."
    if action == "SELF_HEAL_BLOCKED":
        return f"Self-healing blocked ({details.get('reason', 'policy')})."
    if action == "OVERRIDDEN":
        return f"AI recommendation manually overridden: {details.get('note', '')}".strip()
    if action == "ASK_MORE":
        return f"Clarification round {details.get('round', 1)} started."
    if action == "ANSWERS_SUBMITTED":
        return (f"Answers submitted; score moved from "
                f"{details.get('score_before')}% to {details.get('score_after')}%.")
    if action == "ESCALATED":
        return "Ticket escalated for human investigation."
    return action.replace("_", " ").capitalize() + "."


def serialize_audit(entry: TicketAudit, db: Session, full: bool = False) -> dict:
    user = db.get(User, entry.user_id)
    ticket = db.get(Ticket, entry.ticket_id)
    dept = db.get(Department, ticket.department_id) if ticket else None
    details = _parse_details(entry.details)

    out = {
        "id": entry.audit_id,
        "audit_id": entry.audit_id,
        "ticket_id": entry.ticket_id,
        "user_id": entry.user_id,
        "user": user.username if user else f"user#{entry.user_id}",
        "role": user.role if user else None,
        "action": entry.action,
        "type": ACTION_TYPES.get(entry.action, "ticket"),
        "resource": short_ref(ticket.ticket_uid) if ticket else f"ticket#{entry.ticket_id}",
        "ticketUid": ticket.ticket_uid if ticket else None,
        "timestamp": entry.timestamp,
        "ticket_hash": entry.ticket_hash,
        "details": _summarise(entry.action, details),
        "detailsJson": details,
        "department": dept.name if dept else None,
    }

    if full and ticket:
        out["ticket"] = {
            "id": ticket.id,
            "ticketUid": ticket.ticket_uid,
            "ticketRef": short_ref(ticket.ticket_uid),
            "description": ticket.description,
            "original_description": ticket.original_description,
            "status": ticket.status,
            "department": dept.name if dept else None,
            "match_score": ticket.match_score,
            "match_band": ticket.match_band,
            "matched_article_id": ticket.matched_article_id,
            "created_at": ticket.created_at,
            "override_note": ticket.override_note,
            "clarify_round": ticket.clarify_round,
        }
    return out


# --------------------------------------------------------------------------
# retention
# --------------------------------------------------------------------------
@router.get("/retention", response_model=RetentionPolicy)
def get_retention(_: User = Depends(require_roles("admin"))):
    return _policy


@router.put("/retention", response_model=RetentionPolicy)
def update_retention(payload: RetentionPolicy, _: User = Depends(require_roles("admin"))):
    global _policy
    _policy = payload
    return _policy


# --------------------------------------------------------------------------
# knowledge base: new articles are stored in the articles table AND embedded,
# so the matcher can use them straight away
# --------------------------------------------------------------------------
def _resolve_department(db: Session, department_id: int | None,
                        department: str | None) -> int:
    if department_id:
        if not db.get(Department, department_id):
            raise HTTPException(404, "Department not found")
        return department_id

    name = (department or "").strip()
    if not name:
        raise HTTPException(400, "A department is required")

    # Accept the UI label and common folder spellings, e.g.
    # Corporate Banking / Corporate_Banking / Corporate-Banking.
    candidates = {
        name.lower(),
        name.replace(" ", "_").lower(),
        name.replace("-", "_").lower(),
        name.replace(" ", "_").replace("-", "_").lower(),
    }
    departments = db.query(Department).all()
    def key(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")
    wanted = {key(value) for value in candidates}
    dept = next((item for item in departments if key(item.name) in wanted), None)
    if not dept:
        raise HTTPException(404, f"Department '{department}' not found")
    return dept.id


@router.get("/articles")
def list_articles(department_id: int | None = None,
                  _: User = Depends(require_roles("admin")),
                  db: Session = Depends(get_db)):
    """Every article in the knowledge base, with how many sentences are
    embedded for it (0 means the matcher cannot use it yet)."""
    query = db.query(Article)
    if department_id:
        query = query.filter(Article.department_id == department_id)

    counts = dict(db.query(ArticleEmbedding.article_id,
                           func.count(ArticleEmbedding.article_id))
                    .group_by(ArticleEmbedding.article_id).all())

    rows = query.order_by(Article.id.desc()).limit(500).all()
    out = []
    for art in rows:
        dept = db.get(Department, art.department_id)
        out.append({
            "id": art.id,
            "article_code": art.article_code,
            "title": art.title,
            "department": dept.name if dept else None,
            "department_id": art.department_id,
            "sop_id": art.sop_id,
            "version": art.version,
            "no_auto_execute": art.no_auto_execute,
            "script_path": art.script_path,
            "sentences": counts.get(art.id, 0),
            "created_at": art.created_at,
        })
    return out


@router.post("/articles", status_code=201)
def create_article(payload: ArticleIngest,
                   _: User = Depends(require_roles("admin")),
                   db: Session = Depends(get_db)):
    """Store a new knowledge-base article typed or pasted into the admin UI."""
    department_id = _resolve_department(db, payload.department_id, payload.department)
    try:
        return ingest_article(
            db,
            department_id=department_id,
            title=payload.title,
            body_text=payload.body_text,
            article_code=payload.article_code,
            tags=payload.tags,
            sop_id=payload.sop_id,
            script_path=payload.script_path,
            no_auto_execute=payload.no_auto_execute,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/articles/upload", status_code=201)
async def upload_article(file: UploadFile = File(...),
                         department: str | None = Form(None),
                         department_id: int | None = Form(None),
                         _: User = Depends(require_roles("admin")),
                         db: Session = Depends(get_db)):
    """Load knowledge-base content from individual files or a category ZIP.

    Individual .md/.txt/.csv files require the selected department. A ZIP is
    organised as <category>/<article-file>; the category folder is resolved
    against the departments table, so every article is stored against its
    correct department automatically. A single wrapper folder is tolerated.
    """
    name = (file.filename or "").strip()
    if not name:
        raise HTTPException(400, "No file provided")

    content = await file.read()
    lower = name.lower()
    results, errors = [], []

    def ingest_one(raw: bytes, filename: str, dept_id: int):
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError("article exceeds the 2 MB per-article limit")
        lower_name = filename.lower()
        if lower_name.endswith(".csv"):
            text = raw.decode("utf-8-sig", errors="replace")
            reader = csv.DictReader(io.StringIO(text))
            local = []
            for line_no, row in enumerate(reader, start=2):
                row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
                body = row.get("body") or row.get("body_text") or row.get("content")
                title = row.get("title") or row.get("heading")
                if not body or not title:
                    errors.append(f"{filename}: row {line_no}: title and body are required")
                    continue
                # The selected category (or ZIP folder category) is authoritative.
                # This prevents a CSV row from silently being loaded into the wrong department.
                local.append(ingest_article(
                    db, department_id=dept_id, title=title, body_text=body,
                    article_code=row.get("article_code") or row.get("code") or None,
                    sop_id=row.get("sop_id") or None,
                    no_auto_execute=row.get("no_auto_execute", "").lower() in ("1", "true", "yes"),
                    reload_matcher=False,
                ))
            return local

        if lower_name.endswith((".md", ".txt")):
            text = raw.decode("utf-8-sig", errors="replace")
            stem = os.path.basename(filename).rsplit(".", 1)[0]
            title, body = parse_markdown(text, fallback_title=stem)
            code = stem.upper() if stem.upper().startswith("ART-") else None
            return [ingest_article(db, department_id=dept_id, title=title, body_text=body, article_code=code, reload_matcher=False)]

        raise ValueError("unsupported article type; use .md, .txt or .csv")

    if lower.endswith(".zip"):
        if len(content) > int(settings.knowledge_base_max_upload_mb * 1024 * 1024):
            raise HTTPException(413, f"Knowledge Base ZIP exceeds {settings.knowledge_base_max_upload_mb} MB")
        try:
            zf = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile:
            raise HTTPException(400, "The uploaded file is not a valid ZIP archive")

        files = []
        extracted_bytes = 0
        max_extracted = 100 * 1024 * 1024
        max_files = 500
        for info in zf.infolist():
            if info.is_dir():
                continue
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts:
                raise HTTPException(400, f"Unsafe ZIP path: {info.filename}")
            if len(files) >= max_files:
                raise HTTPException(400, f"ZIP contains more than {max_files} article files")
            if info.file_size > 2 * 1024 * 1024:
                errors.append(f"{info.filename}: exceeds the 2 MB per-article limit")
                continue
            if path.suffix.lower() not in (".md", ".txt", ".csv"):
                continue
            extracted_bytes += info.file_size
            if extracted_bytes > max_extracted:
                raise HTTPException(413, "ZIP extracted content exceeds the 100 MB safety limit")
            files.append(info)

        if not files:
            raise HTTPException(400, "ZIP contains no supported .md, .txt or .csv article files")

        # Ignore one common wrapper folder (e.g. knowledge_base/Corporate_Banking/...).
        roots = {PurePosixPath(i.filename).parts[0] for i in files if PurePosixPath(i.filename).parts}
        wrapper = len(roots) == 1 and all(len(PurePosixPath(i.filename).parts) >= 3 for i in files)

        for info in files:
            parts = PurePosixPath(info.filename).parts
            if wrapper:
                category = parts[1]
            elif len(parts) >= 2:
                category = parts[0]
            else:
                errors.append(f"{info.filename}: place the article inside a category folder")
                continue
            try:
                dept_id = _resolve_department(db, None, category)
                results.extend(ingest_one(zf.read(info), parts[-1], dept_id))
            except (HTTPException, ValueError, zipfile.BadZipFile) as exc:
                detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
                errors.append(f"{info.filename}: {detail}")
    else:
        if len(content) > 2 * 1024 * 1024:
            raise HTTPException(413, "Article files are limited to 2 MB each")
        if not lower.endswith((".md", ".txt", ".csv")):
            raise HTTPException(400, "Upload a .md, .txt, .csv article file, or a ZIP category archive")
        dept_id = _resolve_department(db, department_id, department)
        try:
            results.extend(ingest_one(content, name, dept_id))
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    if results:
        try:
            from app.services.matcher import matcher
            matcher.load()
        except Exception as exc:
            errors.append(f"matcher reload failed: {exc}")

    if not results and errors:
        raise HTTPException(400, "; ".join(errors[:10]))

    return {
        "filename": name,
        "stored": len(results),
        "articles": results,
        "errors": errors,
        "mode": "zip" if lower.endswith(".zip") else "files",
    }


# --------------------------------------------------------------------------
# audit logs
# --------------------------------------------------------------------------
@router.get("/audit-logs", response_model=list[AuditOut])
def audit_logs(_: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    rows = db.query(TicketAudit).order_by(TicketAudit.timestamp.desc()).limit(500).all()
    return [serialize_audit(r, db) for r in rows]


@router.get("/audit-logs/{audit_id}", response_model=AuditOut)
def audit_log_detail(audit_id: int,
                     _: User = Depends(require_roles("admin")),
                     db: Session = Depends(get_db)):
    """Everything known about a single audit event, including the ticket it touched."""
    entry = db.get(TicketAudit, audit_id)
    if not entry:
        raise HTTPException(404, "Audit event not found")
    return serialize_audit(entry, db, full=True)
