"""
Self-Healing Controller - data loader.
Reads the raw files in data/raw and fills the PostgreSQL tables.
Safe to run more than once (it clears the loaded tables first).
"""
import csv
import hashlib
import json
import os
import re
from pathlib import Path

import pandas as pd
import psycopg
from dotenv import load_dotenv

# ---------- paths ----------
DATA = Path("data/raw/Selfhealing_Data")
KB_DIR = DATA / "knowledge_base"
TICKETS_CSV = DATA / "sample_tickets.csv"
REFERENCE_CSV = DATA / "matching_reference.csv"
EXCLUSION_CSV = DATA / "exclusion_list.csv"
COSTING_XLSX = DATA / "costing_metadata.xlsx"

DEPARTMENTS = {
    "Corporate_Banking": "Corporate Banking",
    "Data_Center": "Data Center",
    "Insurance": "Insurance",
    "Investment_Banking": "Investment Banking",
    "Laptop_Assets": "Laptop Assets",
    "Retail_Banking": "Retail Banking",
}

SOP_RE = re.compile(r"sop[\u2010\u2011\u2013-]?\s*(\d+)", re.IGNORECASE)


# ---------- helpers ----------
def normalize(text: str) -> str:
    text = (text.replace("\u2011", "-").replace("\u2010", "-")
                .replace("\u2013", "-").replace("\u2019", "'").replace("\u2018", "'"))
    return re.sub(r"\s+", " ", text).strip()


def extract_sop(text: str):
    m = SOP_RE.search(text)
    return m.group(1) if m else None


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8192), b""):
            h.update(block)
    return h.hexdigest()


def connect():
    load_dotenv()
    return psycopg.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


# ---------- load steps ----------
def clear(cur):
    # order matters because of foreign keys
    for t in ["ticket_audit", "clarification_rounds", "ticket_reference",
              "tickets", "article_embeddings", "article_tags",
              "article_versions", "articles", "exclusion_list",
              "cost_avoidance", "cost_rates", "source_files", "departments"]:
        cur.execute(f"TRUNCATE {t} RESTART IDENTITY CASCADE;")


def load_source_files(cur):
    files = [KB_DIR.parent / "knowledge_base.zip", TICKETS_CSV,
             REFERENCE_CSV, EXCLUSION_CSV, COSTING_XLSX]
    for f in files:
        if f.exists():
            cur.execute(
                "INSERT INTO source_files (filename, sha256) VALUES (%s, %s)",
                (f.name, sha256_file(f)))
    print(f"source_files: {len(files)} hashed")


def load_departments(cur):
    ids = {}
    for folder, display in DEPARTMENTS.items():
        cur.execute(
            "INSERT INTO departments (name, display_name) VALUES (%s, %s) RETURNING id",
            (folder, display))
        ids[folder] = cur.fetchone()[0]
    print(f"departments: {len(ids)}")
    return ids


def load_exclusions(cur):
    ids = set()
    with open(EXCLUSION_CSV, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            aid = row["Exclude_Article_ID"].strip()
            if aid:
                cur.execute("INSERT INTO exclusion_list (article_id) VALUES (%s)", (aid,))
                ids.add(aid)
    print(f"exclusion_list: {len(ids)}")
    return ids


def load_articles(cur, dept_ids, excluded):
    count = 0
    for md in sorted(KB_DIR.rglob("ART-*.md")):
        raw = md.read_text(encoding="utf-8").replace("\r\n", "\n")
        aid = md.stem
        dept = md.parent.name
        lines = [l.rstrip() for l in raw.split("\n")]
        heading = next((l[2:] for l in lines if l.startswith("# ")), aid).strip()
        title = re.split(r"\s+[\u2013\u2014-]\s+", heading, maxsplit=1)[-1]
        body = normalize("\n".join(l for l in lines if not l.startswith("# ")))
        sop = extract_sop(raw)
        no_auto = aid in excluded

        cur.execute(
            """INSERT INTO articles
               (id, department_id, title, body_text, sop_id, no_auto_execute,
                version, content_sha256)
               VALUES (%s,%s,%s,%s,%s,%s,1,%s)""",
            (aid, dept_ids[dept], title, body, sop, no_auto, sha256_file(md)))
        cur.execute(
            """INSERT INTO article_versions (article_id, version, title, body_text)
               VALUES (%s,1,%s,%s)""", (aid, title, body))

        tags = {dept}
        if sop:
            tags.add(f"sop-{sop}")
        for tag in tags:
            cur.execute("INSERT INTO article_tags (article_id, tag) VALUES (%s,%s)",
                        (aid, tag))
        count += 1
    print(f"articles: {count}")


def load_tickets(cur, dept_ids):
    df = pd.read_csv(TICKETS_CSV)
    loaded, rejected = 0, 0
    for _, r in df.iterrows():
        dept = str(r["Department"]).strip()
        desc = str(r["Description"]).strip()
        # validation
        if dept not in dept_ids or not desc:
            rejected += 1
            continue
        h = sha256_text(desc)
        cur.execute(
            """INSERT INTO tickets
               (id, department_id, description, original_description,
                requestor_id, requestor_geography, status,
                original_hash, current_hash)
               VALUES (%s,%s,%s,%s,%s,%s,'NEW',%s,%s)""",
            (r["Ticket_ID"], dept_ids[dept], desc, desc,
             r.get("Requestor_ID"), r.get("Requestor_Geography"), h, h))
        cur.execute(
            """INSERT INTO ticket_audit (ticket_id, user_id, action, ticket_hash)
               VALUES (%s,'system','CREATED',%s)""", (r["Ticket_ID"], h))
        loaded += 1
    print(f"tickets: {loaded} loaded, {rejected} rejected")


def load_reference(cur):
    df = pd.read_csv(REFERENCE_CSV, keep_default_na=False)
    n = 0
    for _, r in df.iterrows():
        expected = r["Expected_Article_ID"].strip() or None
        cur.execute(
            """INSERT INTO ticket_reference (ticket_id, expected_article_id, expected_bucket)
               VALUES (%s,%s,%s)""",
            (r["Ticket_ID"], expected, r["Expected_Bucket"].strip()))
        n += 1
    print(f"ticket_reference: {n}")


def load_costing(cur):
    x = pd.ExcelFile(COSTING_XLSX)
    rates = x.parse("Cost_Rates")
    for _, r in rates.iterrows():
        cur.execute("INSERT INTO cost_rates (metric, value_eur) VALUES (%s,%s)",
                    (r["Metric"], float(r["Value_EUR"])))
    ca = x.parse("Cost_Avoidance")
    ca = ca[ca["Department"] != "GRAND_TOTAL"]   # skip the total row
    for _, r in ca.iterrows():
        cur.execute(
            """INSERT INTO cost_avoidance
               (department, saved_engineer_hours, total_savings_eur)
               VALUES (%s,%s,%s)""",
            (r["Department"], float(r["saved_engineer_hours"]),
             float(r["Total_Savings_EUR"])))
    print(f"cost_rates: {len(rates)}, cost_avoidance: {len(ca)}")


def main():
    with connect() as conn:
        with conn.cursor() as cur:
            clear(cur)
            load_source_files(cur)
            dept_ids = load_departments(cur)
            excluded = load_exclusions(cur)
            load_articles(cur, dept_ids, excluded)
            load_tickets(cur, dept_ids)
            load_reference(cur)
            load_costing(cur)
        conn.commit()
    print("Done.")


if __name__ == "__main__":
    main()