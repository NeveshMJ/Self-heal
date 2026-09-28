"""
Startup bootstrap.

Guarantees that the fixed accounts the UI documents always exist and always
have the documented password, and that the six departments are present so a
fresh database is usable immediately.

Fixed accounts
--------------
    admin    / admin@123     -> role "admin"
    analyst  / analyst@123   -> role "analyst"

End users (used by the public "User" portal when raising a complaint)
    user1 / user@123
    user2 / user@123
    user3 / user@123
"""
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.session import SessionLocal, engine
from app.models.models import Department, Ticket, User
from app.services.ticket_ref import make_ticket_uid

STAFF_ACCOUNTS = [
    ("admin", "admin@123", "admin"),
    ("analyst", "analyst@123", "analyst"),
]

END_USER_ACCOUNTS = [
    ("user1", "user@123", "viewer"),
    ("user2", "user@123", "viewer"),
    ("user3", "user@123", "viewer"),
]

DEPARTMENTS = [
    "Corporate_Banking",
    "Data_Center",
    "Insurance",
    "Investment_Banking",
    "Laptop_Assets",
    "Retail_Banking",
]


def _upsert_user(db: Session, username: str, password: str, role: str) -> None:
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        db.add(User(username=username,
                    password_hash=hash_password(password),
                    role=role))
        return
    # keep the documented credentials authoritative even if the row already exists
    user.password_hash = hash_password(password)
    user.role = role


def migrate() -> None:
    """Add columns that were introduced after the tables were first created.

    SQLAlchemy's create_all() only creates missing TABLES, never missing
    columns, so an existing database needs this one-liner. It is safe to run
    on every start.
    """
    try:
        columns = {c["name"] for c in inspect(engine).get_columns("tickets")}
    except Exception as exc:  # table not created yet - create_all handles it
        print(f"Bootstrap: skipping migration ({exc}).")
        return

    if "ticket_uid" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE tickets ADD COLUMN ticket_uid VARCHAR(64)"))
        print("Bootstrap: added tickets.ticket_uid.")

    # give any pre-existing ticket a hash so old rows still display correctly
    db = SessionLocal()
    try:
        legacy = db.query(Ticket).filter(Ticket.ticket_uid.is_(None)).all()
        for t in legacy:
            t.ticket_uid = make_ticket_uid(t.department_id, t.description,
                                           t.created_at, salt=f"legacy-{t.id}")
        if legacy:
            db.commit()
            print(f"Bootstrap: generated hashes for {len(legacy)} existing tickets.")
    except Exception as exc:
        db.rollback()
        print(f"WARNING: could not backfill ticket hashes ({exc}).")
    finally:
        db.close()


def seed_defaults() -> None:
    db = SessionLocal()
    try:
        for username, password, role in STAFF_ACCOUNTS + END_USER_ACCOUNTS:
            _upsert_user(db, username, password, role)

        if db.query(Department).count() == 0:
            for name in DEPARTMENTS:
                db.add(Department(name=name))

        db.commit()
        print("Bootstrap: fixed accounts ready "
              "(admin/admin@123, analyst/analyst@123, user1-3/user@123).")
    except Exception as exc:  # pragma: no cover - never block API startup
        db.rollback()
        print(f"WARNING: bootstrap seeding skipped ({exc}).")
    finally:
        db.close()
