"""
Tickets router - wired to the real matcher, self-heal sandbox, and Ask More.

Ticket identity
---------------
Every ticket carries a SHA-256 `ticket_uid` generated at creation and stored in
the tickets table. The API accepts either that hash (or a unique prefix of it)
or the internal integer id in the path, and the UI only ever shows the hash.

Create flow
-----------
POST /tickets returns immediately with status "New". The match runs in a
background task straight after, so the status moves from New to
Self-Heal Ready / Matched / Ask More / Escalated on its own and the UI picks
that up on its next poll.
"""
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_roles
from app.db.session import SessionLocal, get_db
from app.models.models import (Article, ClarificationRound, Department, Ticket,
                               User)
from app.schemas.schemas import TicketCreate
from app.services import matcher as matcher_service
from app.services.audit import record_audit, sha256_text
from app.services.question_gen import generate_questions
from app.services.selfheal_bridge import run_heal
from app.services.ticket_ref import make_ticket_uid, short_ref

router = APIRouter(prefix="/tickets", tags=["Tickets"])

MAX_CLARIFY_ROUNDS = 3


# ---------- request bodies ----------
class OverrideBody(BaseModel):
    note: str
    # 95-99% is the "human approves, then we act" band: the analyst can apply
    # the matched article's remediation as part of the approval
    apply_fix: bool = False


class AnswersBody(BaseModel):
    # either one free-text block, or one answer per question (in order)
    answers: str | None = None
    responses: list[str] | None = None


CLOSED_STATUSES = ("Resolved", "Overridden", "Escalated")


# ---------- ticket lookup (hash, hash prefix, or integer id) ----------
def resolve_ticket(db: Session, ref: str) -> Ticket:
    ref = (ref or "").strip()
    if not ref:
        raise HTTPException(404, "Ticket not found")

    # a short display ref such as TCK-9F2A11C0D3 is accepted too
    if ref.upper().startswith("TCK-"):
        ref = ref[4:]

    ticket = None
    if len(ref) >= 8 and not ref.isdigit():
        matches = (db.query(Ticket)
                     .filter(Ticket.ticket_uid.ilike(f"{ref.lower()}%"))
                     .limit(2)
                     .all())
        if len(matches) > 1:
            raise HTTPException(400, "Ambiguous ticket reference")
        ticket = matches[0] if matches else None
    elif ref.isdigit():
        ticket = db.get(Ticket, int(ref))

    if not ticket:
        raise HTTPException(404, "Ticket not found")
    return ticket


def open_round(t: Ticket, db: Session) -> ClarificationRound | None:
    """The current Ask More round, if its questions are still unanswered."""
    if not t.clarify_round:
        return None
    rnd = (db.query(ClarificationRound)
             .filter(ClarificationRound.ticket_id == t.id,
                     ClarificationRound.round_no == t.clarify_round)
             .first())
    return rnd if rnd and not rnd.answers else None


# ---------- serialization (frontend-friendly) ----------
def serialize(t: Ticket, db: Session) -> dict:
    dept = db.get(Department, t.department_id)
    art = db.get(Article, t.matched_article_id) if t.matched_article_id else None
    pending = open_round(t, db) if t.status not in CLOSED_STATUSES else None
    return {
        "id": t.id,                            # internal only
        "ticketUid": t.ticket_uid,             # the SHA-256 stored in the table
        "ticketRef": short_ref(t.ticket_uid),  # what the tables display
        "description": t.description,
        "department": dept.name if dept else None,
        "department_id": t.department_id,
        "matchScore": t.match_score,           # camelCase for the React UI
        "match_score": t.match_score,          # snake_case kept for compatibility
        "status": t.status,
        "band": t.match_band,
        "cosine": t.match_cosine,
        "created_at": t.created_at,
        "matchedArticleId": t.matched_article_id,
        "matchedArticle": {
            "id": art.id,
            "code": art.article_code,
            "title": art.title,
            "body_text": art.body_text,
            "sop_id": art.sop_id,
            "no_auto_execute": art.no_auto_execute,
        } if art else None,
        "overrideNote": t.override_note,
        "clarifyRound": t.clarify_round,
        "maxRounds": MAX_CLARIFY_ROUNDS,
        # Ask More: questions waiting for the user (or staff) to answer
        "awaitingAnswers": pending is not None,
        "pendingQuestions": json.loads(pending.questions) if pending and pending.questions else [],
    }


def _apply_match(t: Ticket, db: Session):
    """Run the matcher on the current ticket text and store the result."""
    result = matcher_service.matcher.match(t.department_id, t.description)
    t.match_score = result["score"]
    t.match_cosine = result["cosine"]
    t.match_band = result["band"]
    t.matched_article_id = result["article_id"]
    t.status = matcher_service.BAND_TO_STATUS[result["band"]]
    return result


def run_match_job(ticket_id: int, user_id: int):
    """Background job: match a freshly created ticket and move it off "New".

    Runs in its own session because the request session is already closed by
    the time FastAPI executes background tasks.
    """
    db = SessionLocal()
    try:
        t = db.get(Ticket, ticket_id)
        if not t:
            return
        try:
            _apply_match(t, db)
            db.commit()
            db.refresh(t)
            record_audit(db, t, user_id, "MATCHED",
                         {"score": t.match_score, "band": t.match_band,
                          "article_id": t.matched_article_id})
        except Exception as exc:
            db.rollback()
            # the knowledge base is missing or the model failed to load:
            # send the ticket down the escalate path rather than leaving it New
            t = db.get(Ticket, ticket_id)
            t.match_score = 0.0
            t.match_band = "ESCALATE"
            t.status = "Escalated"
            db.commit()
            db.refresh(t)
            record_audit(db, t, user_id, "MATCH_FAILED", {"error": str(exc)})
            print(f"WARNING: matching failed for ticket {ticket_id}: {exc}")
    finally:
        db.close()


# ---------- list / detail ----------
@router.get("")
def list_tickets(_: User = Depends(require_roles("admin", "analyst")),
                 db: Session = Depends(get_db)):
    rows = db.query(Ticket).order_by(Ticket.created_at.desc()).all()
    return [serialize(t, db) for t in rows]


@router.get("/mine/list")
def my_tickets(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (db.query(Ticket)
              .filter(Ticket.created_by == user.id)
              .order_by(Ticket.created_at.desc())
              .all())
    return [serialize(t, db) for t in rows]


@router.get("/{ref}")
def get_ticket(ref: str, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    """Full ticket, including the explanation of HOW the match was made.

    Staff see any ticket; an end user can only open their own.
    """
    t = resolve_ticket(db, ref)
    if user.role not in ("admin", "analyst") and t.created_by != user.id:
        raise HTTPException(403, "Insufficient permissions")

    out = serialize(t, db)

    # interpretability: recompute the top sentences for this ticket text
    try:
        result = matcher_service.matcher.match(t.department_id, t.description)
        out["topSentences"] = result["top_sentences"]
        out["matchReason"] = result["reason"]
        out["liveScore"] = result["score"]
    except Exception as exc:
        out["topSentences"] = []
        out["matchReason"] = None
        out["matchError"] = str(exc)

    # the clarification rounds, so the analyst can see what was asked
    rounds = (db.query(ClarificationRound)
                .filter(ClarificationRound.ticket_id == t.id)
                .order_by(ClarificationRound.round_no)
                .all())
    def _answer(r):
        return json.loads(r.answers) if r.answers else {}

    out["clarifications"] = [{
        "round": r.round_no,
        "questions": json.loads(r.questions) if r.questions else [],
        "answers": _answer(r).get("text"),
        "answeredBy": _answer(r).get("by"),
        "score_before": r.score_before,
        "score_after": r.score_after,
    } for r in rounds]

    return out


# ---------- create: status "New" now, match in the background ----------
@router.post("", status_code=201)
def create_ticket(payload: TicketCreate,
                  background: BackgroundTasks,
                  user: User = Depends(require_roles("admin", "analyst", "viewer")),
                  db: Session = Depends(get_db)):
    if not db.get(Department, payload.department_id):
        raise HTTPException(404, "Department not found")

    h = sha256_text(payload.description)
    t = Ticket(
        department_id=payload.department_id,
        description=payload.description,
        original_description=payload.description,
        original_hash=h,
        current_hash=h,
        status="New",
        created_by=user.id,
    )
    t.ticket_uid = make_ticket_uid(payload.department_id, payload.description)

    db.add(t)
    db.commit()
    db.refresh(t)

    record_audit(db, t, user.id, "CREATED", {"hash": h, "ticket_uid": t.ticket_uid})

    # the AI match runs right after the response is sent, so the caller sees
    # status "New" first and the status updates itself a moment later
    background.add_task(run_match_job, t.id, user.id)

    return serialize(t, db)


# ---------- 100%: self-heal via the real sandbox ----------
@router.post("/{ref}/self-heal")
def self_heal(ref: str, user: User = Depends(require_roles("analyst", "admin")),
              db: Session = Depends(get_db)):
    t = resolve_ticket(db, ref)
    if t.match_score is None or float(t.match_score) < 100:
        raise HTTPException(400, "Ticket is not eligible for self-heal (needs 100%)")

    art = db.get(Article, t.matched_article_id) if t.matched_article_id else None
    if not art:
        raise HTTPException(400, "No matched article to heal")
    if art.no_auto_execute:
        record_audit(db, t, user.id, "SELF_HEAL_BLOCKED", {"reason": "exclusion_list"})
        raise HTTPException(400, "Article is on the exclusion list; auto-heal blocked")
    if not art.script_path:
        raise HTTPException(400, "No remediation script linked to this article")

    # call the existing sandbox (not modified). script_path holds e.g. "SOP-521".
    result = run_heal(sop_key=art.script_path, article_code=art.article_code,
                      ticket_id=t.id, user_id=user.id)

    if result.get("ok"):
        t.status = "Resolved"
        db.commit()
        db.refresh(t)
        record_audit(db, t, user.id, "SELF_HEAL_SUCCESS",
                     {"logs": result.get("logs", ""), "script": art.script_path})
    else:
        record_audit(db, t, user.id, "SELF_HEAL_FAILED", {"error": result.get("error")})
        raise HTTPException(502, f"Self-heal failed: {result.get('error')}")

    out = serialize(t, db)
    out["healLogs"] = result.get("logs", "")
    return out


# ---------- 95-99%: analyst review and override ----------
@router.get("/{ref}/override-context")
def override_context(ref: str, _: User = Depends(require_roles("analyst", "admin")),
                     db: Session = Depends(get_db)):
    """Everything the analyst needs before approving a 95-99% match: the
    complaint, the article the AI picked, and whether that article can be
    executed automatically."""
    t = resolve_ticket(db, ref)
    art = db.get(Article, t.matched_article_id) if t.matched_article_id else None

    eligible = (t.match_score is not None and 95 <= float(t.match_score) < 100
                and t.status not in ("Resolved", "Overridden"))

    return {
        "ticket": serialize(t, db),
        "eligible": eligible,
        "reason": None if eligible else (
            "This ticket is already closed."
            if t.status in ("Resolved", "Overridden")
            else "Override applies to matches between 95% and 99%."),
        "canApplyFix": bool(art and art.script_path and not art.no_auto_execute),
        "blockedReason": (
            "The matched article is on the exclusion list, so its remediation "
            "cannot be executed automatically."
            if art and art.no_auto_execute else
            "No remediation script is linked to the matched article."
            if art and not art.script_path else None),
        "noteMaxLength": 250,
    }


@router.post("/{ref}/override")
def override(ref: str, body: OverrideBody,
             user: User = Depends(require_roles("analyst", "admin")),
             db: Session = Depends(get_db)):
    """Approve a 95-99% match with a mandatory justification note, optionally
    executing the matched article's remediation as part of the approval."""
    t = resolve_ticket(db, ref)

    note = (body.note or "").strip()
    if not note:
        raise HTTPException(400, "An override note is required")
    if len(note) < 10:
        raise HTTPException(400, "The override note must explain the decision "
                                 "(at least 10 characters)")
    if len(note) > 250:
        raise HTTPException(400, "Override note too long (max 250 chars)")

    if t.status in ("Resolved", "Overridden"):
        raise HTTPException(400, "This ticket is already closed")
    if t.match_score is None or float(t.match_score) < 95:
        raise HTTPException(400, "Override requires a match score of at least 95%")

    art = db.get(Article, t.matched_article_id) if t.matched_article_id else None

    # optional: run the remediation the analyst just approved
    applied = False
    heal_logs = None
    if body.apply_fix:
        if not art:
            raise HTTPException(400, "No matched article to apply")
        if art.no_auto_execute:
            record_audit(db, t, user.id, "SELF_HEAL_BLOCKED",
                         {"reason": "exclusion_list", "via": "override"})
            raise HTTPException(400, "The matched article is on the exclusion "
                                     "list; its remediation cannot be executed")
        if not art.script_path:
            raise HTTPException(400, "No remediation script is linked to the "
                                     "matched article")

        result = run_heal(sop_key=art.script_path, article_code=art.article_code,
                          ticket_id=t.id, user_id=user.id)
        if not result.get("ok"):
            record_audit(db, t, user.id, "SELF_HEAL_FAILED",
                         {"error": result.get("error"), "via": "override"})
            raise HTTPException(502, f"Remediation failed: {result.get('error')}")

        applied = True
        heal_logs = result.get("logs", "")

    t.status = "Overridden"
    t.override_note = note
    t.overridden_by = user.id
    db.commit()
    db.refresh(t)

    record_audit(db, t, user.id, "OVERRIDDEN", {
        "note": note,
        "score": t.match_score,
        "band": t.match_band,
        "article": art.article_code if art else None,
        "remediation_applied": applied,
    })

    out = serialize(t, db)
    out["remediationApplied"] = applied
    out["overriddenBy"] = user.username
    if heal_logs is not None:
        out["healLogs"] = heal_logs
    return out


# ---------- 81-94%: Ask More (fine-tuned T5 writes the questions) ----------
@router.post("/{ref}/ask-more")
def ask_more(ref: str, user: User = Depends(require_roles("analyst", "admin")),
             db: Session = Depends(get_db)):
    """Open a clarification round: the questions are stored on the ticket and
    wait for the complainant (or an analyst on their behalf) to answer."""
    t = resolve_ticket(db, ref)
    if t.status in CLOSED_STATUSES:
        raise HTTPException(400, "This ticket is already closed")
    art = db.get(Article, t.matched_article_id) if t.matched_article_id else None
    if not art:
        raise HTTPException(400, "Ticket has no matched article yet")

    pending = open_round(t, db)
    if pending:
        # already waiting: hand back the same questions instead of a new round
        return {"ticket": serialize(t, db),
                "questions": json.loads(pending.questions or "[]"),
                "round": pending.round_no, "used_t5": None, "alreadyOpen": True}

    if (t.clarify_round or 0) >= MAX_CLARIFY_ROUNDS:
        raise HTTPException(400, f"All {MAX_CLARIFY_ROUNDS} clarification rounds "
                                 "are used; escalate this ticket instead")

    gen = generate_questions(complaint=t.description, title=art.title,
                             body=art.body_text, sop_id=art.sop_id,
                             department=t.department.name if t.department else None)
    round_no = (t.clarify_round or 0) + 1
    db.add(ClarificationRound(
        ticket_id=t.id, round_no=round_no,
        questions=json.dumps(gen["questions"]), score_before=t.match_score,
    ))
    t.status = "Ask More"
    t.clarify_round = round_no
    db.commit()
    db.refresh(t)
    record_audit(db, t, user.id, "ASK_MORE", {"round": round_no, "used_t5": gen["used_t5"]})
    return {"ticket": serialize(t, db), "questions": gen["questions"],
            "round": round_no, "used_t5": gen["used_t5"], "alreadyOpen": False}


# ---------- 81-94%: submit answers, append, re-match ----------
@router.post("/{ref}/answers")
def submit_answers(ref: str, body: AnswersBody,
                   user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    """Answer the open round. The complainant answers their own ticket from
    the User portal; an analyst or admin can answer on their behalf."""
    t = resolve_ticket(db, ref)
    is_staff = user.role in ("admin", "analyst")
    if not is_staff and t.created_by != user.id:
        raise HTTPException(403, "You can only answer your own tickets")

    rnd = open_round(t, db)
    if not rnd or t.status in CLOSED_STATUSES:
        raise HTTPException(400, "This ticket is not waiting for answers")

    if body.responses:
        questions = json.loads(rnd.questions or "[]")
        parts = [a.strip() for a in body.responses if a and a.strip()]
        if not parts:
            raise HTTPException(400, "Answer at least one question")
        answers = " ".join(parts)
        qa = [{"question": q, "answer": (body.responses[i] or "").strip()}
              for i, q in enumerate(questions) if i < len(body.responses)]
    else:
        answers = (body.answers or "").strip()
        qa = []
    if not answers:
        raise HTTPException(400, "Answers cannot be empty")
    if len(answers) > 2000:
        raise HTTPException(400, "Answers too long (max 2000 characters)")

    answered_by = user.username if is_staff else "user"

    score_before = t.match_score
    t.description = f"{t.description} {answers}".strip()
    t.current_hash = sha256_text(t.description)
    _apply_match(t, db)

    # record the round result
    rnd.answers = json.dumps({"text": answers, "by": answered_by, "qa": qa})
    rnd.score_after = t.match_score

    # if still ASK_MORE after the max rounds, escalate
    escalated = False
    if t.match_band == "ASK_MORE" and t.clarify_round >= MAX_CLARIFY_ROUNDS:
        t.status = "Escalated"
        t.match_band = "ESCALATE"
        escalated = True

    db.commit()
    db.refresh(t)
    record_audit(db, t, user.id, "ANSWERS_SUBMITTED",
                 {"score_before": score_before, "score_after": t.match_score,
                  "band": t.match_band, "escalated": escalated,
                  "answered_by": answered_by})
    out = serialize(t, db)
    out["result"] = {"scoreBefore": score_before, "scoreAfter": t.match_score,
                     "band": t.match_band, "status": t.status,
                     "escalated": escalated, "answeredBy": answered_by}
    return out


# ---------- <80%: escalate ----------
@router.post("/{ref}/escalate")
def escalate(ref: str, user: User = Depends(require_roles("analyst", "admin")),
             db: Session = Depends(get_db)):
    t = resolve_ticket(db, ref)
    t.status = "Escalated"
    t.match_band = "ESCALATE"
    db.commit()
    db.refresh(t)
    record_audit(db, t, user.id, "ESCALATED", {"score": t.match_score})
    return serialize(t, db)
