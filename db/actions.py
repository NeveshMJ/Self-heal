"""
Ticket decision actions as pure functions the API can import and call.
Currently: override_ticket (for the 95-99% path).
"""
import os
import json
import psycopg
from dotenv import load_dotenv

load_dotenv()


def _connect():
    return psycopg.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"))


def override_ticket(ticket_id: str, note: str, user_id: str, role: str) -> dict:
    """
    Analyst/Admin overrides a 95-99% ticket by saving a short note.
    Sets status OVERRIDDEN and writes an audit row.
    """
    # 1. role check
    if role not in ("analyst", "admin"):
        return {"ok": False, "error": "only analyst or admin can override"}

    # 2. validate the note
    note = (note or "").strip()
    if not note:
        return {"ok": False, "error": "note cannot be empty"}
    if len(note) > 250:
        return {"ok": False, "error": "note too long (max 250 chars)"}

    with _connect() as conn, conn.cursor() as cur:
        # 3. load ticket and check score
        cur.execute("SELECT match_score, current_hash FROM tickets WHERE id=%s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            return {"ok": False, "error": "ticket not found"}
        score, ticket_hash = row
        if score is None or float(score) < 95:
            return {"ok": False, "error": f"override needs score >= 95 (this ticket: {score})"}

        # 4. save note + set status
        cur.execute(
            """UPDATE tickets
               SET status='OVERRIDDEN', override_note=%s,
                   overridden_by=%s, overridden_at=now()
               WHERE id=%s""",
            (note, user_id, ticket_id))

        # 5. audit row
        cur.execute(
            """INSERT INTO ticket_audit (ticket_id, user_id, action, details, ticket_hash)
               VALUES (%s, %s, 'OVERRIDDEN', %s, %s)""",
            (ticket_id, user_id, json.dumps({"note": note}), ticket_hash))
        conn.commit()

    return {"ok": True, "status": "OVERRIDDEN", "ticket_id": ticket_id}

def escalate_ticket(ticket_id: str, user_id: str, role: str) -> dict:
    """
    Move a ticket to the Production-Support queue (status ESCALATED).
    Used for scores below 80%, or when an analyst chooses to escalate.
    """
    if role not in ("analyst", "admin"):
        return {"ok": False, "error": "only analyst or admin can escalate"}

    with _connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT match_score, current_hash FROM tickets WHERE id=%s", (ticket_id,))
        row = cur.fetchone()
        if not row:
            return {"ok": False, "error": "ticket not found"}
        score, ticket_hash = row

        cur.execute(
            "UPDATE tickets SET status='ESCALATED' WHERE id=%s", (ticket_id,))
        cur.execute(
            """INSERT INTO ticket_audit (ticket_id, user_id, action, details, ticket_hash)
               VALUES (%s, %s, 'ESCALATED', %s, %s)""",
            (ticket_id, user_id, json.dumps({"score": float(score) if score is not None else None}),
             ticket_hash))
        conn.commit()

    return {"ok": True, "status": "ESCALATED", "ticket_id": ticket_id}