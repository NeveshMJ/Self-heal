from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.models.models import Ticket, User
from app.core.security import get_current_user
router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("/stats")
def stats(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    total = db.query(func.count(Ticket.id)).scalar() or 0
    new = db.query(func.count(Ticket.id)).filter(Ticket.status == "New").scalar() or 0
    resolved = db.query(func.count(Ticket.id)).filter(Ticket.status == "Resolved").scalar() or 0
    escalated = db.query(func.count(Ticket.id)).filter(Ticket.status == "Escalated").scalar() or 0
    self_heal_ready = db.query(func.count(Ticket.id)).filter(Ticket.match_score == 100).scalar() or 0
    return {"total": total, "new": new, "resolved": resolved, "escalated": escalated, "self_heal_ready": self_heal_ready}
