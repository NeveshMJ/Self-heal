from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import User
from app.schemas.schemas import SignupRequest, LoginRequest, TokenResponse, UserOut
from app.core.security import (hash_password, verify_password, create_access_token,
                               get_current_user, require_roles)

router = APIRouter(prefix="/auth", tags=["Authentication"])


# Public self-service signup has been removed: the controller ships with fixed
# accounts (admin / analyst) plus end-user accounts provisioned by an admin.
# This endpoint is kept for provisioning only and now requires an admin token.
@router.post("/users", response_model=UserOut, status_code=201)
def create_user(payload: SignupRequest,
                _: User = Depends(require_roles("admin")),
                db: Session = Depends(get_db)):
    role = payload.role.lower()
    if role not in {"admin", "analyst", "viewer"}:
        raise HTTPException(400, "Invalid role")
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(409, "Username already exists")
    user = User(username=payload.username, password_hash=hash_password(payload.password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")
    return TokenResponse(access_token=create_access_token(user), user=user)

@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
