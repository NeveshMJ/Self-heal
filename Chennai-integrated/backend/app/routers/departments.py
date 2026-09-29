from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Department, User
from app.schemas.schemas import DepartmentCreate, DepartmentOut
from app.core.security import get_current_user, require_roles

router = APIRouter(prefix="/departments", tags=["Departments"])

@router.get("/public", response_model=list[DepartmentOut])
def public_departments(db: Session = Depends(get_db)):
    """Unauthenticated: the public complaint form needs the department list
    before the complainant's credentials have been checked."""
    return db.query(Department).order_by(Department.name).all()


@router.get("", response_model=list[DepartmentOut])
def list_departments(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Department).order_by(Department.name).all()

@router.post("", response_model=DepartmentOut, status_code=201)
def create_department(payload: DepartmentCreate, _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    if db.query(Department).filter(Department.name == payload.name).first():
        raise HTTPException(409, "Department already exists")
    obj = Department(name=payload.name)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj
