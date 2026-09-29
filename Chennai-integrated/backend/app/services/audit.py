import hashlib
import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.models import Ticket, TicketAudit


def ticket_hash(ticket: Ticket) -> str:
    raw = f"{ticket.id}|{ticket.department_id}|{ticket.description}|{ticket.status}|{ticket.match_score}|{ticket.matched_article_id}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def record_audit(db: Session, ticket: Ticket, user_id: int, action: str, details: dict | None = None):
    entry = TicketAudit(
        ticket_id=ticket.id,
        user_id=user_id,
        action=action,
        timestamp=datetime.now(timezone.utc),
        ticket_hash=ticket_hash(ticket),
        details=json.dumps(details) if details else None,
    )
    db.add(entry)
    db.commit()
    return entry
