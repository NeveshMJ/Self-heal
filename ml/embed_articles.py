"""
Embed every article's sentences with all-mpnet-base-v2 and store the
vectors in the article_embeddings table. Run once after loading the KB.
"""
import json
import os
import re

import psycopg
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-mpnet-base-v2"


def connect():
    load_dotenv()
    return psycopg.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


def split_sentences(body: str):
    # articles store steps joined together; split on sentence enders
    parts = re.split(r"(?<=[.!?])\s+", body)
    return [p.strip() for p in parts if p.strip()]


def main():
    print("Loading model...")
    model = SentenceTransformer(MODEL_NAME)

    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT id, title, body_text FROM articles")
        rows = cur.fetchall()

        cur.execute("TRUNCATE article_embeddings")

        total = 0
        for aid, title, body in rows:
            # chunk 0 = whole article (title + body); chunks 1+ = each sentence
            chunks = [f"{title}. {body}"] + split_sentences(body)
            vectors = model.encode(chunks, normalize_embeddings=True)
            for i, (text, vec) in enumerate(zip(chunks, vectors)):
                cur.execute(
                    """INSERT INTO article_embeddings
                       (article_id, chunk_no, chunk_text, embedding)
                       VALUES (%s,%s,%s,%s)""",
                    (aid, i, text, json.dumps(vec.tolist())))
                total += 1
        conn.commit()
    print(f"Stored {total} embeddings for {len(rows)} articles.")


if __name__ == "__main__":
    main()