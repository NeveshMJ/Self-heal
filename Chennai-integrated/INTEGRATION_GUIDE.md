# Integration Guide — Self-Heal Controller

This explains how the team's frontend + backend were integrated with the
real matcher and the self-heal sandbox, what changed, and the exact steps
to run it. **Your self-heal sandbox code (`selfheal/run_sandbox.py`, the
scripts, the targets) was NOT modified.** The backend calls it as-is.

---

## 1. The big picture

There were two separate systems:

- **Team backend** (this repo): clean FastAPI + SQLAlchemy, but the matcher
  was a placeholder and self-heal just set status = "Resolved". Article and
  ticket IDs are integers.
- **Your engine** (built separately): real mpnet matcher, SOP rule, T5
  Ask-More, and a working Docker self-heal sandbox. Uses text IDs
  (`ART-...`, `SOP-...`).

The integration keeps the team's API + frontend and plugs your real engine
into it. The one structural fix: the `articles` table now carries both the
integer `id` (for the ORM/frontend) **and** the text `article_code` +
`sop_id` (for your matcher and self-heal). Best of both.

---

## 2. What changed in the backend

New files:
- `app/services/matcher.py` — the real mpnet matcher (loads once at startup),
  with the SOP-exact = 100% rule and top-3 sentence interpretability.
- `app/services/selfheal_bridge.py` — calls your existing `run_selfheal()`
  in `selfheal/run_sandbox.py`. Does **not** reimplement it.
- `app/services/question_gen.py` — T5-small Ask-More with template fallback.
- `load_and_embed.py` — one-shot loader: fills the tables from the raw KB
  data, computes embeddings, links the 6 hero articles to self-heal targets,
  seeds demo users.

Changed files:
- `app/models/models.py` — added `article_code`, `sop_id`, `script_path`,
  `no_auto_execute` to Article; added hashes, band, cosine, clarify_round,
  override fields to Ticket; added `ArticleEmbedding` and `ClarificationRound`.
- `app/routers/tickets.py` — rewritten. Real matching on create, real
  self-heal (via the sandbox), override with a note, Ask-More question
  generation, answer submission with re-match, escalate. Every action writes
  an audit row. Returns `matchScore`, `department`, `status` fields the React
  UI already uses.
- `app/services/audit.py` — now stores a `details` JSON column.
- `app/main.py` — loads the matcher once at startup (lifespan).
- `requirements.txt`, `.env.example` — added engine deps; DB URL points at
  the `selfheal` database on port 5417; added `SELFHEAL_DIR`.

## 3. What changed in the frontend

- `src/api/client.js` — now attaches the JWT (`Authorization: Bearer ...`).
- `src/api/authApi.js` — `login()` stores the token and user.
- `src/api/ticketApi.js` — real endpoints, incl. `overrideTicket(id, note)`,
  `askMoreTicket`, `submitAnswers`, `createTicket`, `getDepartments`.
- `.env.example` — `VITE_API_URL`.

**Frontend components still to wire (small, listed in section 6)** — the team
is still building these, so they were left for them to finish against the new
API layer, rather than overwriting work in progress.

---

## 4. Folder layout expected

```
<repo root>/
├── Chennai-integrated/               (this folder)
│   ├── backend/
│   └── frontend/
├── selfheal/                         (your sandbox — run_sandbox.py, scripts/, targets/)
└── data/raw/Selfhealing_Data/        (knowledge_base/, exclusion_list.csv, ...)
```

`SELFHEAL_DIR` in `backend/.env` must point at your `selfheal/` folder.
The default is `../../selfheal` (adjust if your layout differs).

---

## 5. How to run (once)

**Backend**
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
copy .env.example .env            # then edit if needed
# start once so tables are created, or just run the loader (it creates them)
python load_and_embed.py --data ../../data/raw/Selfhealing_Data
uvicorn app.main:app --reload
```
Open http://localhost:8000/docs to test endpoints.

**Frontend**
```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```
Open http://localhost:5173.

**Fixed logins** (re-applied on every API start by `app/core/bootstrap.py`):

Staff login (the "Login" option on the home page):
- admin / admin@123
- analyst / analyst@123

End users (used by the "User" option when raising a complaint):
- user1 / user@123
- user2 / user@123
- user3 / user@123

There is no signup screen. `POST /auth/users` still exists for provisioning
extra accounts, but it now requires an admin token.

---

## 6. Frontend wiring still to do (for the team)

These are small changes against the new `ticketApi.js`:

1. **Login.jsx** — replace the localStorage check with:
   `import { login } from "../../api/authApi"` and call
   `await login({ username, password })`, then `onLogin(data.user)`.
2. **App.jsx** — on entering the app, load tickets from the API:
   `import { getTickets } from "./api/ticketApi"` and `setTicketList(await getTickets())`
   instead of the mock `tickets` import.
3. **TicketDetailPanel actions** in App.jsx — call the real API:
   - `onSelfHeal` → `await selfHealTicket(ticket.id)`
   - `onOverride` → prompt for a note, then `await overrideTicket(ticket.id, note)`
   - `onAskMore` → `const r = await askMoreTicket(ticket.id)`; show `r.questions`
     in a modal; on submit `await submitAnswers(ticket.id, answersText)`
   - `onEscalate` → `await escalateTicket(ticket.id)`
   After each, refresh the list with `getTickets()`.
4. The ticket fields already match: the API returns `matchScore`,
   `department`, `status`, so `TicketQueue` and `TicketDetailPanel` work as-is.

---

## 7. Self-heal: the ONE change you need to make

Your sandbox is called as-is, with one requirement: the API tells it which
target to heal using `articles.script_path`, which the loader sets to the
target key (e.g. `"SOP-521"`). Your `run_selfheal(sop_id, ...)` already
takes exactly that key and looks up `targets/<key>.json`. So:

- **No code change to `run_sandbox.py` is required** if your targets are
  named `SOP-521.json`, `SOP-313.json`, `SOP-667.json`, `SOP-904.json`,
  `SOP-691.json`, `SOP-671.json` (they are).
- Just make sure `SELFHEAL_DIR` in `backend/.env` points at your `selfheal/`
  folder so the bridge can import `run_selfheal`.
- Before a demo, reset the targets to BROKEN (`python selfheal/reset_targets.py`).

One thing to know: your sandbox writes its own audit row to *its* database
(the `selfheal` DB). The integrated backend also writes an audit row to the
app database. Both records exist; that's fine. If you want a single audit
trail, point both at the same database (they already both use `selfheal`).

---

## 8. What is real vs. simulated (for the judges)

- Matching: real (mpnet embeddings, cosine, SOP rule). ✅
- Self-heal: real Docker sandbox that changes a target file. ✅
- Ask More: real T5-small with template fallback + re-match. ✅
- The "broken service" is a demo config file, not a live bank system —
  state this as an assumption. ✅


## Knowledge Base batch upload
The Admin sidebar no longer exposes a separate Dataset Upload screen. Use Knowledge Base. Select a department and upload one or more `.md`/`.txt`/`.csv` files, or upload one ZIP with category folders such as `Retail_Banking/`, `Corporate_Banking/`, `Insurance/`, `Investment_Banking/`, `Data_Center/`, and `Laptop_Assets/`. The backend maps folder names to the `departments` table, safely extracts the archive, ingests each article, embeds it, and reloads the matcher.
