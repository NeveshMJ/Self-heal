"""
Ticket identifiers.

Tickets are addressed by a SHA-256 hash (`ticket_uid`) that is generated when
the ticket is created and stored in the tickets table. The integer primary key
still exists for the foreign keys (audit rows, clarification rounds), but it is
never shown in the UI - every screen shows the hash.
"""
import hashlib
from datetime import datetime, timezone
from uuid import uuid4


def make_ticket_uid(department_id: int, description: str,
                    created_at: datetime | None = None,
                    salt: str | None = None) -> str:
    """SHA-256 over the ticket's own content + a random salt (so two identical
    complaints still get different ids)."""
    stamp = (created_at or datetime.now(timezone.utc)).isoformat()
    raw = f"{department_id}|{description}|{stamp}|{salt or uuid4().hex}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def short_ref(ticket_uid: str | None) -> str:
    """What the tables show: TCK- plus the first 10 hex characters."""
    if not ticket_uid:
        return "TCK-????????"
    return f"TCK-{ticket_uid[:10].upper()}"
