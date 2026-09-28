from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.models.models import Ticket, User
from app.core.security import get_current_user
router = APIRouter(prefix="/insights", tags=["Insights"])

@router.get("")
def insights(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    total = db.query(func.count(Ticket.id)).scalar() or 0
    resolved = db.query(func.count(Ticket.id)).filter(Ticket.status == "Resolved").scalar() or 0
    escalated = db.query(func.count(Ticket.id)).filter(Ticket.status == "Escalated").scalar() or 0
    avg = db.query(func.avg(Ticket.match_score)).scalar()
    return {
        "total_tickets": total,
        "resolved": resolved,
        "escalated": escalated,
        "self_heal_ready": db.query(func.count(Ticket.id)).filter(Ticket.match_score == 100).scalar() or 0,
        "average_match_score": round(float(avg), 2) if avg is not None else 0,
        "resolution_rate": round((resolved / total) * 100, 2) if total else 0,
    }
