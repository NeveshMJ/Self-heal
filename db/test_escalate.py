import os, psycopg
from dotenv import load_dotenv
from actions import escalate_ticket
load_dotenv()

conn = psycopg.connect(host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
    dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"), password=os.getenv("DB_PASSWORD"))
cur = conn.cursor()

# give a ticket a low score to simulate a below-80% case
cur.execute("SELECT id FROM tickets LIMIT 1 OFFSET 5")
tid = cur.fetchone()[0]
cur.execute("UPDATE tickets SET match_score=45 WHERE id=%s", (tid,))
conn.commit()
print("Testing on ticket:", tid)

print("viewer (should fail) :", escalate_ticket(tid, "usr-viewer", "viewer"))
print("analyst (should pass):", escalate_ticket(tid, "usr-analyst", "analyst"))