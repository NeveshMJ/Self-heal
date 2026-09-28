from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, DateTime, Float, ForeignKey, UniqueConstraint, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="viewer", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)


class Article(Base):
    __tablename__ = "articles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # --- fields added for the real matcher / self-heal engine ---
    # article_code is the original text id from the knowledge base, e.g. "ART-87C7B85B".
    article_code: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    sop_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    script_path: Mapped[str | None] = mapped_column(String(255), nullable=True)   # target key, e.g. "SOP-521"
    no_auto_execute: Mapped[bool] = mapped_column(Boolean, default=False)          # on the exclusion list

    department = relationship("Department")


class ArticleTag(Base):
    __tablename__ = "article_tags"
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True)
    tag: Mapped[str] = mapped_column(String(100), primary_key=True)
    __table_args__ = (UniqueConstraint("article_id", "tag", name="uq_article_tag"),)


class ArticleEmbedding(Base):
    __tablename__ = "article_embeddings"
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), primary_key=True)
    chunk_no: Mapped[int] = mapped_column(Integer, primary_key=True)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[str] = mapped_column(Text, nullable=False)   # JSON array of floats


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # SHA-256 identifier shown everywhere in the UI (the integer id above is
    # kept only so the audit / clarification foreign keys keep working)
    ticket_uid: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="New", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    match_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    matched_article_id: Mapped[int | None] = mapped_column(ForeignKey("articles.id"), nullable=True)

    # --- fields added for the real engine ---
    original_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    current_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    match_band: Mapped[str | None] = mapped_column(String(20), nullable=True)     # SELF_HEAL / OVERRIDE / ASK_MORE / ESCALATE
    match_cosine: Mapped[float | None] = mapped_column(Float, nullable=True)
    clarify_round: Mapped[int] = mapped_column(Integer, default=0)
    override_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    overridden_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    department = relationship("Department")
    matched_article = relationship("Article")


class ClarificationRound(Base):
    __tablename__ = "clarification_rounds"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    round_no: Mapped[int] = mapped_column(Integer, nullable=False)
    questions: Mapped[str | None] = mapped_column(Text, nullable=True)   # JSON
    answers: Mapped[str | None] = mapped_column(Text, nullable=True)     # JSON
    score_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class TicketAudit(Base):
    __tablename__ = "ticket_audit"
    audit_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    ticket_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)   # JSON
