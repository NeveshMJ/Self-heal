"""
Score the semantic matcher against ticket_reference.
Prints bucket accuracy and a confusion matrix (expected bucket vs predicted band).
"""
import json
import os

import numpy as np
import psycopg
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-mpnet-base-v2"

# band thresholds (PS): >=95 override, 100 self-heal, 81-94 ask more, <80 escalate
def band(score):
    if score >= 95:
        return "high"        # >=95%  -> review / self-heal
    if score >= 81:
        return "mid"         # 81-94% -> ask more
    return "low"             # <81%   -> escalate


def connect():
    load_dotenv()
    return psycopg.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


def main():
    print("Loading model...")
    model = SentenceTransformer(MODEL_NAME)

    with connect() as conn, conn.cursor() as cur:
        # load article embeddings grouped by department
        cur.execute("""
            SELECT a.department_id, e.article_id, e.embedding
            FROM article_embeddings e
            JOIN articles a ON a.id = e.article_id
            where e.chunk_no > 0
        """)
        by_dept = {}
        for dept_id, aid, emb in cur.fetchall():
            vec = np.array(emb, dtype=np.float32)
            by_dept.setdefault(dept_id, {"ids": [], "vecs": []})
            by_dept[dept_id]["ids"].append(aid)
            by_dept[dept_id]["vecs"].append(vec)
        for d in by_dept.values():
            d["vecs"] = np.vstack(d["vecs"])

        # load tickets + expected answers
        cur.execute("""
            SELECT t.id, t.department_id, t.description,
                   r.expected_article_id, r.expected_bucket
            FROM tickets t
            JOIN ticket_reference r ON r.ticket_id = t.id
        """)
        tickets = cur.fetchall()

    print(f"Scoring {len(tickets)} tickets...")
    ticket_texts = [t[2] for t in tickets]
    ticket_vecs = model.encode(ticket_texts, normalize_embeddings=True,
                               batch_size=64, show_progress_bar=True)

    article_correct = 0
    article_total = 0
    # confusion matrix: expected bucket (rows) vs predicted band (cols)
    labels = ["high", "mid", "low"]
    cm = {e: {p: 0 for p in labels} for e in labels}

    for (tid, dept_id, desc, exp_article, exp_bucket), tvec in zip(tickets, ticket_vecs):
        d = by_dept[dept_id]
        sims = d["vecs"] @ tvec            # cosine, since all normalized
        best_i = int(np.argmax(sims))
        best_score = float(sims[best_i]) * 100
        pred_article = d["ids"][best_i]
        pred_band = band(best_score)

        cm[exp_bucket][pred_band] += 1
        if exp_article:                    # only high/mid have an expected article
            article_total += 1
            if pred_article == exp_article:
                article_correct += 1

    # ---- report ----
    print("\n=== Bucket confusion matrix (rows = expected, cols = predicted) ===")
    print(f"{'':8}" + "".join(f"{p:>8}" for p in labels))
    correct_band = 0
    total = 0
    for e in labels:
        row = cm[e]
        print(f"{e:8}" + "".join(f"{row[p]:>8}" for p in labels))
        correct_band += row[e]
        total += sum(row.values())
    print(f"\nBucket accuracy : {correct_band/total*100:.1f}%")
    if article_total:
        print(f"Article accuracy: {article_correct/article_total*100:.1f}% "
              f"({article_correct}/{article_total}, high+mid only)")


if __name__ == "__main__":
    main()