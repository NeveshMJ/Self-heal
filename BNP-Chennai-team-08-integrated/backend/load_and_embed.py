"""
One-shot loader for the INTEGRATED backend.

Populates the SQLAlchemy schema (integer IDs) from the raw knowledge-base
data, computes mpnet embeddings, links the 6 hero articles to self-heal
targets, and seeds demo users.

Run once after the tables are created (start the API once, or it creates
them). Usage:
    python load_and_embed.py --data ../../data/raw/Selfhealing_Data

Re-runnable: it clears the KB/ticket tables first.
"""
import argparse
import csv
import json
import re
from pathlib import Path

from sqlalchemy import text as sql_text

from app.db.session import Base, SessionLocal, engine
from app.models.models import (Article, ArticleEmbedding, ArticleTag,
                               Department, User)
from app.core.security import hash_password

SOP_RE = re.compile(r"sop[\u2010\u2011\u2013-]?\s*(\d+)", re.IGNORECASE)

DEPARTMENTS = ["Corporate_Banking", "Data_Center", "Insurance",
               "Investment_Banking", "Laptop_Assets", "Retail_Banking"]

# hero articles -> self-heal target key (matches selfheal/targets/<key>.json)
HERO_SCRIPTS = {
    "ART-2E986668": "SOP-521",
    "ART-09F20E37": "SOP-313",
    "ART-2380231D": "SOP-667",
    "ART-062BC201": "SOP-904",
    "ART-133ABF10": "SOP-691",
    "ART-00EBEDA6": "SOP-671",
}

# Fixed accounts. Kept in step with app/core/bootstrap.py, which re-applies
# them on every API start so the documented credentials always work.
DEMO_USERS = [("admin", "admin@123", "admin"),
              ("analyst", "analyst@123", "analyst"),
              ("user1", "user@123", "viewer"),
              ("user2", "user@123", "viewer"),
              ("user3", "user@123", "viewer")]


def normalize(t):
    t = (t.replace("\u2011", "-").replace("\u2010", "-").replace("\u2013", "-")
          .replace("\u2019", "'").replace("\u2018", "'"))
    return re.sub(r"\s+", " ", t).strip()


def extract_sop(t):
    m = SOP_RE.search(t or "")
    return m.group(1) if m else None


def split_sentences(body):
    parts = re.split(r"(?<=[.!?])\s+", body)
    return [p.strip() for p in parts if p.strip()]


def main(data_dir: Path):
    kb = data_dir / "knowledge_base"
    exclusion_csv = data_dir / "exclusion_list.csv"
    if not kb.exists():
        raise SystemExit(f"knowledge_base not found under {data_dir}")

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # clear KB-related tables (keep users unless reseeding)
    for t in ["article_embeddings", "article_tags", "clarification_rounds",
              "ticket_audit", "tickets", "articles", "departments"]:
        db.execute(sql_text(f"TRUNCATE {t} RESTART IDENTITY CASCADE"))
    db.commit()

    # departments
    dept_ids = {}
    for name in DEPARTMENTS:
        d = Department(name=name)
        db.add(d)
        db.flush()
        dept_ids[name] = d.id
    print(f"departments: {len(dept_ids)}")

    # exclusions
    excluded = set()
    if exclusion_csv.exists():
        with open(exclusion_csv, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                v = row["Exclude_Article_ID"].strip()
                if v:
                    excluded.add(v)

    # articles
    from sentence_transformers import SentenceTransformer
    print("loading model...")
    model = SentenceTransformer("all-mpnet-base-v2")

    n_art, n_emb = 0, 0
    for md in sorted(kb.rglob("ART-*.md")):
        raw = md.read_text(encoding="utf-8").replace("\r\n", "\n")
        code = md.stem
        dept = md.parent.name
        lines = [l.rstrip() for l in raw.split("\n")]
        heading = next((l[2:] for l in lines if l.startswith("# ")), code).strip()
        title = re.split(r"\s+[\u2013\u2014-]\s+", heading, maxsplit=1)[-1]
        body = normalize("\n".join(l for l in lines if not l.startswith("# ")))
        sop = extract_sop(raw)

        art = Article(
            department_id=dept_ids[dept], title=title, body_text=body, version=1,
            article_code=code, sop_id=sop,
            no_auto_execute=(code in excluded),
            script_path=HERO_SCRIPTS.get(code),
        )
        db.add(art)
        db.flush()

        db.add(ArticleTag(article_id=art.id, tag=dept))
        if sop:
            db.add(ArticleTag(article_id=art.id, tag=f"sop-{sop}"))

        # embeddings: one per sentence (chunk_no >= 1)
        sentences = split_sentences(body)
        if sentences:
            vecs = model.encode(sentences, normalize_embeddings=True)
            for i, (s, v) in enumerate(zip(sentences, vecs), start=1):
                db.add(ArticleEmbedding(article_id=art.id, chunk_no=i,
                                        chunk_text=s, embedding=json.dumps(v.tolist())))
                n_emb += 1
        n_art += 1

    db.commit()
    print(f"articles: {n_art}, embeddings: {n_emb}")

    # demo users (upsert)
    for username, pw, role in DEMO_USERS:
        u = db.query(User).filter(User.username == username).first()
        if u:
            u.password_hash = hash_password(pw)
            u.role = role
        else:
            db.add(User(username=username, password_hash=hash_password(pw), role=role))
    db.commit()
    print(f"demo users: {', '.join(u for u, _, _ in DEMO_USERS)}")

    linked = db.query(Article).filter(Article.script_path.isnot(None)).count()
    print(f"hero articles linked to self-heal scripts: {linked}")
    db.close()
    print("Done.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="../../data/raw/Selfhealing_Data",
                    help="path to the folder containing knowledge_base/ and exclusion_list.csv")
    args = ap.parse_args()
    main(Path(args.data))
