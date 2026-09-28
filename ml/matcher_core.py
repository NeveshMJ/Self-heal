"""
Core matcher: given a department and ticket text, return the best article,
a confidence score, the band, the top-3 matching sentences, and shared
words for frontend highlighting.

Rule (documented assumption):
  - Ticket names an SOP number that exactly one article in the same
    department has -> certain match -> 100%.
  - Otherwise, confidence = cosine similarity (0-100) against article sentences.
"""
import os
import re
import numpy as np
import psycopg
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

SOP_RE = re.compile(r"sop[\u2010\u2011\u2013-]?\s*(\d+)", re.IGNORECASE)

# small stopword list so highlighting shows meaningful shared words only
STOPWORDS = {"the", "a", "an", "in", "on", "to", "of", "for", "as", "is",
             "please", "user", "the", "and", "or", "your", "this", "that",
             "with", "by", "s", "requestor"}


def extract_sop(text: str):
    m = SOP_RE.search(text)
    return m.group(1) if m else None


def tokenize(text: str):
    return re.findall(r"[a-z0-9]+", text.lower())


def shared_words(ticket: str, sentence: str):
    """Meaningful words present in both, for frontend highlighting."""
    a = {w for w in tokenize(ticket) if w not in STOPWORDS and len(w) > 1}
    b = {w for w in tokenize(sentence) if w not in STOPWORDS and len(w) > 1}
    return sorted(a & b)


class Matcher:
    def __init__(self):
        load_dotenv()
        self.model = SentenceTransformer("all-mpnet-base-v2")
        self._load()

    def _connect(self):
        return psycopg.connect(
            host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
            dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"))

    def _load(self):
        with self._connect() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT a.department_id, e.article_id, e.chunk_text, e.embedding
                FROM article_embeddings e
                JOIN articles a ON a.id = e.article_id
                WHERE e.chunk_no > 0
            """)
            self.by_dept = {}
            for dept_id, aid, text, emb in cur.fetchall():
                d = self.by_dept.setdefault(dept_id, {"ids": [], "texts": [], "vecs": []})
                d["ids"].append(aid)
                clean = text.lstrip("#").lstrip().lstrip("-").strip()
                if clean.lower().startswith("procedure"):
                    clean = clean[len("procedure"):].lstrip("-").strip()
                d["texts"].append(clean)
                d["vecs"].append(np.array(emb, dtype=np.float32))
            for d in self.by_dept.values():
                d["vecs"] = np.vstack(d["vecs"])

            cur.execute("SELECT id, department_id, sop_id FROM articles WHERE sop_id IS NOT NULL")
            self.sop_map = {}
            for aid, dept_id, sop in cur.fetchall():
                self.sop_map.setdefault((dept_id, sop), []).append(aid)

            cur.execute("SELECT id, name FROM departments")
            self.dept_by_name = {name: did for did, name in cur.fetchall()}

    def band(self, score: float) -> str:
        if score >= 100:
            return "SELF_HEAL"
        if score >= 95:
            return "OVERRIDE"
        if score >= 81:
            return "ASK_MORE"
        return "ESCALATE"

    def match(self, department: str, text: str) -> dict:
        dept_id = self.dept_by_name.get(department)
        if dept_id is None:
            return {"error": f"unknown department: {department}"}

        d = self.by_dept[dept_id]
        tvec = self.model.encode([text], normalize_embeddings=True)[0]
        sims = d["vecs"] @ tvec               # cosine similarity for every sentence

        # top-3 sentences by similarity (for interpretability panel)
        order = np.argsort(sims)[::-1][:3]
        top_sentences = [
            {
                "text": d["texts"][i],
                "article_id": d["ids"][i],
                "score": round(float(sims[i]) * 100, 1),
                "cosine": round(float(sims[i]), 4),
                "shared_words": shared_words(text, d["texts"][i]),
            }
            for i in order
        ]

        best_i = int(order[0])
        best_cosine = float(sims[best_i])
        best_score = round(best_cosine * 100, 1)
        best_article = d["ids"][best_i]
        reason = "semantic"

        # --- SOP rule: exact, unambiguous SOP match -> 100% ---
        sop = extract_sop(text)
        if sop:
            candidates = self.sop_map.get((dept_id, sop), [])
            if len(candidates) == 1:
                best_article = candidates[0]
                best_score = 100.0
                best_cosine = 1.0
                reason = "sop_exact"

        return {
            "matched_article": best_article,
            "score": best_score,
            "cosine": round(best_cosine, 4),
            "band": self.band(best_score),
            "reason": reason,
            "top_sentences": top_sentences,
        }