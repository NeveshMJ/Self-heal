"""
Real semantic matcher for the Self-Heal Controller.

Loads the mpnet model once at startup, reads article sentence-embeddings
from the database, and scores a ticket against the articles in its
department. Includes the SOP-exact rule (an unambiguous SOP number match
counts as 100%).

This module is the single source of truth for matching. It is loaded
once in app.main and reused for every request.
"""
import json
import re
import threading

import numpy as np
from sqlalchemy import text as sql_text

from app.db.session import SessionLocal

SOP_RE = re.compile(r"sop[\u2010\u2011\u2013-]?\s*(\d+)", re.IGNORECASE)

STOPWORDS = {
    "the", "a", "an", "in", "on", "to", "of", "for", "as", "is", "please",
    "user", "and", "or", "your", "this", "that", "with", "by", "s", "requestor",
}

# Band thresholds (from the problem statement). Configurable in one place.
SELF_HEAL_MIN = 100     # == 100  -> self-heal
OVERRIDE_MIN = 95       # 95-99   -> override
ASK_MORE_MIN = 81       # 81-94   -> ask more
# below 81 -> escalate


def extract_sop(text: str):
    m = SOP_RE.search(text or "")
    return m.group(1) if m else None


def _tokenize(t):
    return re.findall(r"[a-z0-9]+", (t or "").lower())


def shared_words(ticket: str, sentence: str):
    a = {w for w in _tokenize(ticket) if w not in STOPWORDS and len(w) > 1}
    b = {w for w in _tokenize(sentence) if w not in STOPWORDS and len(w) > 1}
    return sorted(a & b)


def band_for(score: float) -> str:
    if score >= SELF_HEAL_MIN:
        return "SELF_HEAL"
    if score >= OVERRIDE_MIN:
        return "OVERRIDE"
    if score >= ASK_MORE_MIN:
        return "ASK_MORE"
    return "ESCALATE"


# UI-facing status label derived from the band.
BAND_TO_STATUS = {
    "SELF_HEAL": "Self-Heal Ready",
    "OVERRIDE": "Matched",
    "ASK_MORE": "Ask More",
    "ESCALATE": "Escalated",
}


class Matcher:
    def __init__(self):
        self._lock = threading.Lock()
        self._model = None
        self.by_dept = {}          # department_id -> {ids, codes, sops, texts, vecs}
        self.sop_map = {}          # (department_id, sop) -> [article_int_id, ...]
        self.loaded = False

    # -- model is loaded lazily so importing this module is cheap --
    def _model_ref(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer("all-mpnet-base-v2")
        return self._model

    def encode(self, sentences: list[str]):
        """Public encoder, used when a new article is ingested."""
        return self._model_ref().encode(sentences, normalize_embeddings=True)

    def load(self):
        """Load article embeddings + SOP map from the DB into memory."""
        with self._lock:
            self.by_dept = {}
            self.sop_map = {}
            db = SessionLocal()
            try:
                rows = db.execute(sql_text("""
                    SELECT a.department_id, a.id, a.article_code, a.sop_id,
                           e.chunk_text, e.embedding
                    FROM article_embeddings e
                    JOIN articles a ON a.id = e.article_id
                    WHERE e.chunk_no > 0
                """)).fetchall()
                for dept_id, aid, code, sop, ctext, emb in rows:
                    d = self.by_dept.setdefault(dept_id, {"ids": [], "codes": [], "sops": [], "texts": [], "vecs": []})
                    d["ids"].append(aid)
                    d["codes"].append(code)
                    d["sops"].append(sop)
                    d["texts"].append(_clean(ctext))
                    d["vecs"].append(np.array(json.loads(emb), dtype=np.float32))
                for d in self.by_dept.values():
                    d["vecs"] = np.vstack(d["vecs"]) if d["vecs"] else np.zeros((0, 768), dtype=np.float32)

                srows = db.execute(sql_text(
                    "SELECT id, department_id, sop_id FROM articles WHERE sop_id IS NOT NULL"
                )).fetchall()
                for aid, dept_id, sop in srows:
                    self.sop_map.setdefault((dept_id, sop), []).append(aid)
                self.loaded = True
            finally:
                db.close()

    def match(self, department_id: int, text: str) -> dict:
        """Return best article (int id), score, cosine, band, top sentences."""
        if not self.loaded:
            self.load()

        d = self.by_dept.get(department_id)
        if not d or d["vecs"].shape[0] == 0:
            return {"article_id": None, "article_code": None, "score": 0.0,
                    "cosine": 0.0, "band": "ESCALATE", "reason": "no_articles",
                    "top_sentences": []}

        tvec = self._model_ref().encode([text], normalize_embeddings=True)[0]
        sims = d["vecs"] @ tvec

        order = np.argsort(sims)[::-1][:3]
        top = [{
            "text": d["texts"][i],
            "article_id": d["ids"][i],
            "article_code": d["codes"][i],
            "score": round(float(sims[i]) * 100, 1),
            "cosine": round(float(sims[i]), 4),
            "shared_words": shared_words(text, d["texts"][i]),
        } for i in order]

        best_i = int(order[0])
        best_cosine = float(sims[best_i])
        score = round(best_cosine * 100, 1)
        article_id = d["ids"][best_i]
        article_code = d["codes"][best_i]
        reason = "semantic"

        # SOP-exact rule: unambiguous SOP -> 100%
        sop = extract_sop(text)
        if sop:
            candidates = self.sop_map.get((department_id, sop), [])
            if len(candidates) == 1:
                article_id = candidates[0]
                score = 100.0
                best_cosine = 1.0
                reason = "sop_exact"
                # find its code for display
                if article_id in d["ids"]:
                    article_code = d["codes"][d["ids"].index(article_id)]

        return {
            "article_id": article_id,
            "article_code": article_code,
            "score": score,
            "cosine": round(best_cosine, 4),
            "band": band_for(score),
            "reason": reason,
            "top_sentences": top,
        }


def _clean(t: str) -> str:
    """Strip leftover markdown so sentences display cleanly."""
    t = (t or "").lstrip("#").strip().lstrip("-").strip()
    if t.lower().startswith("procedure"):
        t = t[len("procedure"):].lstrip("-").strip()
    return t


# single shared instance
matcher = Matcher()
