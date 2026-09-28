"""
Knowledge-base ingestion.

Storing an article is not enough for it to be usable: the matcher works on
per-sentence embeddings, so a new article has to be split, embedded and written
to article_embeddings, and the matcher's in-memory index has to be reloaded.
This module does all of that in one call, using exactly the conventions
load_and_embed.py uses for the bundled knowledge base.
"""
import json
import re
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.models import (Article, ArticleEmbedding, ArticleTag,
                               Department)
from app.services.matcher import matcher

SOP_RE = re.compile(r"sop[\u2010\u2011\u2013-]?\s*(\d+)", re.IGNORECASE)


def normalize(text: str) -> str:
    text = (text or "")
    text = (text.replace("\u2011", "-").replace("\u2010", "-")
                .replace("\u2013", "-").replace("\u2019", "'")
                .replace("\u2018", "'"))
    return re.sub(r"\s+", " ", text).strip()


def extract_sop(text: str) -> str | None:
    m = SOP_RE.search(text or "")
    return m.group(1) if m else None


def split_sentences(body: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", body or "")
    return [p.strip() for p in parts if p.strip()]


def new_article_code() -> str:
    return f"ART-{uuid4().hex[:8].upper()}"


def parse_markdown(raw: str, fallback_title: str = "") -> tuple[str, str]:
    """Pull the '# Heading' out of a markdown article; return (title, body)."""
    raw = (raw or "").replace("\r\n", "\n")
    lines = [line.rstrip() for line in raw.split("\n")]

    heading = next((line[2:] for line in lines if line.startswith("# ")), "").strip()
    title = heading or fallback_title or "Untitled article"
    # the bundled KB titles look like "ART-XXXX - Real title"
    title = re.split(r"\s+[\u2013\u2014-]\s+", title, maxsplit=1)[-1].strip()

    body = normalize("\n".join(line for line in lines if not line.startswith("# ")))
    return title, body


def ingest_article(db: Session, *, department_id: int, title: str, body_text: str,
                   article_code: str | None = None, tags: list[str] | None = None,
                   sop_id: str | None = None, script_path: str | None = None,
                   no_auto_execute: bool = False, reload_matcher: bool = True) -> dict:
    """Create or replace one article, embed its sentences, refresh the matcher."""
    dept = db.get(Department, department_id)
    if dept is None:
        raise ValueError("Department not found")

    body = normalize(body_text)
    if not body:
        raise ValueError("The article body is empty")

    code = (article_code or "").strip().upper() or new_article_code()
    sop = (sop_id or "").strip() or extract_sop(f"{title} {body}")

    existing = db.query(Article).filter(Article.article_code == code).first()
    replaced = existing is not None

    if existing:
        art = existing
        art.department_id = department_id
        art.title = title.strip()
        art.body_text = body
        art.sop_id = sop
        art.version = (art.version or 1) + 1
        art.no_auto_execute = no_auto_execute
        if script_path:
            art.script_path = script_path
        # drop the previous embeddings and tags before rebuilding them
        db.query(ArticleEmbedding).filter(
            ArticleEmbedding.article_id == art.id).delete()
        db.query(ArticleTag).filter(ArticleTag.article_id == art.id).delete()
    else:
        art = Article(
            department_id=department_id,
            title=title.strip(),
            body_text=body,
            version=1,
            article_code=code,
            sop_id=sop,
            script_path=script_path,
            no_auto_execute=no_auto_execute,
        )
        db.add(art)

    db.flush()

    # tags: department, the SOP number, plus anything the admin supplied
    wanted = {dept.name}
    if sop:
        wanted.add(f"sop-{sop}")
    for tag in (tags or []):
        clean = tag.strip()
        if clean:
            wanted.add(clean)
    for tag in wanted:
        db.add(ArticleTag(article_id=art.id, tag=tag))

    # embeddings: one row per sentence, chunk_no starting at 1 (the matcher
    # only reads chunk_no > 0)
    sentences = split_sentences(body)
    embedded = 0
    embed_error = None

    if sentences:
        try:
            vectors = matcher.encode(sentences)
            for i, (sentence, vector) in enumerate(zip(sentences, vectors), start=1):
                db.add(ArticleEmbedding(
                    article_id=art.id,
                    chunk_no=i,
                    chunk_text=sentence,
                    embedding=json.dumps(vector.tolist()),
                ))
                embedded += 1
        except Exception as exc:  # model missing / download failed
            embed_error = str(exc)

    db.commit()
    db.refresh(art)

    # make the new article matchable immediately
    reloaded = False
    if reload_matcher and embedded:
        try:
            matcher.load()
            reloaded = True
        except Exception as exc:
            embed_error = embed_error or str(exc)

    return {
        "id": art.id,
        "article_code": art.article_code,
        "title": art.title,
        "department": dept.name,
        "department_id": dept.id,
        "sop_id": art.sop_id,
        "version": art.version,
        "no_auto_execute": art.no_auto_execute,
        "script_path": art.script_path,
        "sentences": embedded,
        "replaced": replaced,
        "matcher_reloaded": reloaded,
        "embed_error": embed_error,
    }
