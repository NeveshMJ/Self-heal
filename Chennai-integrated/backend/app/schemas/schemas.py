from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="viewer")

class LoginRequest(BaseModel):
    username: str
    password: str

class UserOut(BaseModel):
    id: int
    username: str
    role: str
    model_config = ConfigDict(from_attributes=True)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class DepartmentCreate(BaseModel):
    name: str

class DepartmentOut(DepartmentCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class ArticleCreate(BaseModel):
    department_id: int
    title: str
    body_text: str
    version: int = 1
    tags: list[str] = []

class ArticleOut(BaseModel):
    id: int
    department_id: int
    title: str
    body_text: str
    version: int
    created_at: datetime
    tags: list[str] = []

class ArticleIngest(BaseModel):
    """A new knowledge-base article submitted from the admin UI."""
    title: str = Field(min_length=3, max_length=500)
    body_text: str = Field(min_length=10)
    department_id: int | None = None
    department: str | None = None      # name, e.g. "Corporate_Banking"
    article_code: str | None = None    # generated when omitted
    sop_id: str | None = None          # extracted from the text when omitted
    script_path: str | None = None     # self-heal target key, e.g. "SOP-521"
    no_auto_execute: bool = False
    tags: list[str] = []


class TicketCreate(BaseModel):
    department_id: int
    description: str

class TicketOut(BaseModel):
    id: int
    department_id: int
    description: str
    status: str
    created_at: datetime
    match_score: float | None = None
    matched_article_id: int | None = None
    department_name: str | None = None
    matched_article_title: str | None = None
    model_config = ConfigDict(from_attributes=True)

class AuditOut(BaseModel):
    """One audit event, enriched for the Admin > Audit Logs screen."""
    id: int
    audit_id: int
    ticket_id: int
    user_id: int
    user: str | None = None
    role: str | None = None
    action: str
    type: str = "ticket"
    resource: str | None = None
    ticketUid: str | None = None
    timestamp: datetime
    ticket_hash: str
    details: str | None = None
    detailsJson: dict = {}
    department: str | None = None
    ticket: dict | None = None

class RetentionPolicy(BaseModel):
    ticket_retention_days: int = 365
    audit_retention_days: int = 730
    dataset_retention_days: int = 180
