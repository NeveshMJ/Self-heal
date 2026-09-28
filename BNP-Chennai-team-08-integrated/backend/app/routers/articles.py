from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Article, ArticleTag, Department, User
from app.schemas.schemas import ArticleCreate, ArticleOut
from app.core.security import get_current_user, require_roles

router = APIRouter(prefix="/articles", tags=["Knowledge Base"])

def to_out(article):
    return ArticleOut(
        id=article.id, department_id=article.department_id, title=article.title,
        body_text=article.body_text, version=article.version, created_at=article.created_at,
        tags=[x.tag for x in article.tags] if hasattr(article, "tags") else []
    )

@router.get("", response_model=list[ArticleOut])
def list_articles(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Article).order_by(Article.created_at.desc()).all()
    result = []
    for a in rows:
        tags = db.query(ArticleTag).filter(ArticleTag.article_id == a.id).all()
        result.append(ArticleOut(id=a.id, department_id=a.department_id, title=a.title, body_text=a.body_text,
                                 version=a.version, created_at=a.created_at, tags=[t.tag for t in tags]))
    return result

@router.post("", response_model=ArticleOut, status_code=201)
def create_article(payload: ArticleCreate, _: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    if not db.get(Department, payload.department_id):
        raise HTTPException(404, "Department not found")
    a = Article(department_id=payload.department_id, title=payload.title, body_text=payload.body_text, version=payload.version)
    db.add(a); db.flush()
    for tag in set(payload.tags):
        db.add(ArticleTag(article_id=a.id, tag=tag))
    db.commit(); db.refresh(a)
    return ArticleOut(id=a.id, department_id=a.department_id, title=a.title, body_text=a.body_text,
                      version=a.version, created_at=a.created_at, tags=payload.tags)
