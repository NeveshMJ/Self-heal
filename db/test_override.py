import os, psycopg
from dotenv import load_dotenv
from actions import override_ticket
load_dotenv()

conn = psycopg.connect(host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
    dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"), password=os.getenv("DB_PASSWORD"))
cur = conn.cursor()

# give a real ticket a 97% score so we can test the override
cur.execute("SELECT id FROM tickets LIMIT 1")
tid = cur.fetchone()[0]
cur.execute("UPDATE tickets SET match_score=97 WHERE id=%s", (tid,))
conn.commit()
print("Testing on ticket:", tid)

print("viewer (should fail) :", override_ticket(tid, "note", "usr-viewer", "viewer"))
print("empty note (fail)    :", override_ticket(tid, "", "usr-analyst", "analyst"))
print("analyst (should pass):", override_ticket(tid, "Confirmed, correct article.", "usr-analyst", "analyst"))