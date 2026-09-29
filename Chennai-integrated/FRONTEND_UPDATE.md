# Update — hashed ticket IDs, complaint page, department queues, match explanation

Everything below is in this zip. **Restart both servers and hard-refresh the
browser (Ctrl+Shift+R)** — the screenshots you sent were still the old bundle.

---

## 1. Ticket IDs are SHA-256 hashes

No more 1, 2, 3.

- `tickets` has a new column **`ticket_uid VARCHAR(64)`** holding a SHA-256 of
  `department_id | description | created_at | random salt`. Two identical
  complaints still get different ids.
- The UI shows the short form **`TCK-B43DBAF243`** (first 10 hex characters);
  the full 64-character hash is shown on the ticket detail panel and on the
  complaint receipt.
- The API accepts the full hash, a unique prefix, the `TCK-…` short ref, or the
  old integer id — `GET /tickets/{ref}`, `/self-heal`, `/override`, `/ask-more`,
  `/answers`, `/escalate` all take the hash now.
- The integer primary key still exists internally so the audit and
  clarification foreign keys keep working. It is never displayed.

**Your existing database is handled.** `app/core/bootstrap.py` runs a migration
on every startup: it adds the column if missing and generates hashes for tickets
already in the table. Your four existing tickets will get hashes automatically —
tested against a database built with the old schema.

---

## 2. "User" goes straight to the complaint page, credentials mandatory

`src/components/user/UserPortal.jsx` is now a single page — no separate login
step. One form, in two blocks:

**Your credentials (required)** — User ID and Password. Nothing is logged until
these are verified against the backend, and they are re-checked on every
submission. An invalid pair returns "Invalid user ID or password" and no ticket
is created.

**Complaint details** — the ticket-table fields the user supplies:
`department_id` (dropdown) and `description`. The field names are printed next
to the labels.

Generated automatically, as you asked: `ticket_uid`, `status`, `match_score`,
`matched_article_id`, `created_at`.

The department dropdown loads from a new unauthenticated endpoint
`GET /departments/public`, so the list is there before the user logs in.

---

## 3. Status starts as New and changes by itself

`POST /tickets` now inserts the row with **status `New`** and returns
immediately. The AI match runs in a FastAPI background task straight after and
updates the row to Self-Heal Ready / Matched / Ask More / Escalated.

- The complaint page shows the ticket as **New** with "the AI match is running
  now", polls every 2 seconds, and the status and match percentage update in
  place without a refresh.
- The analyst and admin queues refresh every 5 seconds, so a ticket appears as
  New and then changes status on its own.
- If matching fails (knowledge base not loaded), the ticket is moved to
  Escalated and a `MATCH_FAILED` audit row records why, rather than being stuck
  on New forever.

---

## 4. Tickets → departments → that department's tickets

`src/components/tickets/DepartmentTickets.jsx`, for **both** admin and analyst.
Clicking **Tickets** in the left sidebar shows one card per department with its
open / closed / escalated counts. Clicking a department opens only that
department's queue, with an "All departments" link back. The Dashboard still
shows the combined list.

---

## 5. The analyst can see how the match was made

Clicking **View** now fetches the full record from `GET /tickets/{hash}` and the
panel shows:

- **The rule that produced the score** — "Exact SOP rule" when the complaint
  names an SOP that maps to exactly one article (forced to 100%), otherwise
  "Semantic similarity" with an explanation of the mpnet comparison.
- **The matched article** — code, title, SOP number, body extract, and a warning
  when the article is on the exclusion list.
- **Top matching sentences** — the three article sentences that scored highest,
  each with its own percentage and the words shared with the complaint
  highlighted as chips.
- **Cosine similarity** and the confidence band as separate fields.
- **Clarification rounds** — the questions asked, the answers given, and the
  score before/after each round.
- The full SHA-256 hash at the bottom.

While a ticket is still `New`, the panel says the match is running instead of
showing dead action buttons.

---

## 6. Admin can add knowledge-base articles

New **Knowledge Base** screen under Administration (`KnowledgeBase.jsx`).
Storing the row is not enough for an article to be usable, so ingestion does
the whole job in one call:

1. writes the row to the **articles** table (code, title, body, department,
   version, SOP number, exclusion flag)
2. extracts the SOP number from the text when it is not given, and generates an
   `ART-XXXXXXXX` code when one is not supplied
3. tags the article with its department and `sop-<number>`
4. splits the body into sentences, embeds each one, and writes them to
   **article_embeddings** (`chunk_no >= 1`, the rows the matcher reads)
5. reloads the matcher, so the very next ticket in that department can match it

Three ways in:

- **Paste an article** — department, title, body, optional code / SOP number,
  and an exclusion-list checkbox that blocks automated self-healing.
- **Upload .md / .txt** — the first `# heading` becomes the title; a file named
  `ART-1234ABCD.md` keeps that code.
- **Upload .csv** — columns `department, title, body`, optionally
  `article_code, sop_id, no_auto_execute`. Bad rows are reported individually
  and the good ones still load.

Reusing an existing article code replaces that article, bumps its version and
re-embeds it. A **Stored Articles** table lists everything with its embedded
sentence count — a count of 0 means the matcher cannot reach it yet.

Endpoints: `GET /admin/articles`, `POST /admin/articles`,
`POST /admin/articles/upload` (all admin-only).

---

## 7. Audit logs

Real data from `GET /admin/audit-logs`, rows now identified by the ticket hash.
Clicking any row opens the full event: who did it, the ticket it touched
(description, status, score, band, article, override note), the raw details the
engine recorded, and the SHA-256 integrity hash at that moment.

---

## 8. Override review for the 95-99% band

`src/components/tickets/OverrideModal.jsx` replaces the old `prompt()` box.
Clicking **Override** on a ticket scoring 95-99% opens a review dialog showing
the complaint, the article the AI picked, and the confidence, then asks for:

- a **mandatory justification note** (10-250 characters, live counter) stored on
  the ticket and in the audit trail, and
- an optional **"apply the matched remediation now"** checkbox, which runs the
  matched article's self-heal script as part of the approval.

The checkbox is disabled, with the reason shown, when the article has no script
or is on the exclusion list — and the server refuses it independently, records
`SELF_HEAL_BLOCKED`, and leaves the ticket open.

Server side: `GET /tickets/{ref}/override-context` supplies the review data and
`POST /tickets/{ref}/override` enforces the note length, the 95% floor, that the
ticket is not already closed, and analyst/admin role. The audit row records the
note, score, band, article and whether remediation ran.

---

## 9. Security hardening

See **SECURITY.md** for the full write-up. In short: Nginx TLS termination with
the API and database unpublished (`deploy/`), CSP / HSTS / X-Content-Type-Options
and friends on every response, default-deny JWT middleware so no endpoint can be
public by accident, and a 2 MB upload cap enforced at the edge, in middleware and
in the handlers.

---

## 10. Also fixed

- An expired token used to leave you in a half-working workspace with zero
  tickets everywhere. A 401 now logs you out cleanly, and ticket-loading
  failures show an error instead of failing silently.
- Public `POST /auth/signup` is gone; `POST /auth/users` needs an admin token.

---

## Run it

```bash
cd backend
uvicorn app.main:app --reload
# expect: "Bootstrap: added tickets.ticket_uid."
#         "Bootstrap: generated hashes for N existing tickets."
#         "Bootstrap: fixed accounts ready (...)"

cd ../frontend
npm install
npm run dev          # then Ctrl+Shift+R in the browser
```

Logins: `admin / admin@123`, `analyst / analyst@123`.
Complaint users: `user1`, `user2`, `user3`, password `user@123`.

Match scores need the knowledge base: `python load_and_embed.py --data ../../data/raw/Selfhealing_Data`, then restart uvicorn.
