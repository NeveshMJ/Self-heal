-- ============================================================
-- Self-Healing Controller — database schema
-- ============================================================

-- ---------- reference / lookup ----------

CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,          -- folder name, e.g. Corporate_Banking
    display_name TEXT                           -- e.g. Corporate Banking
);

-- Records the SHA-256 of every raw input file (PS: data provenance).
CREATE TABLE source_files (
    id          SERIAL PRIMARY KEY,
    filename    TEXT NOT NULL,
    sha256      TEXT NOT NULL,
    loaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- knowledge base ----------

CREATE TABLE articles (
    id              TEXT PRIMARY KEY,           -- ART-87C7B85B (from the file name)
    department_id   INTEGER NOT NULL REFERENCES departments(id),
    title           TEXT NOT NULL,
    body_text       TEXT NOT NULL,
    sop_id          TEXT,                       -- extracted SOP number, e.g. 622
    script_path     TEXT,                       -- fix script, if any (Self-Heal)
    no_auto_execute BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE if on the exclusion list
    version         INTEGER NOT NULL DEFAULT 1,
    content_sha256  TEXT,                       -- hash of the source file
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_articles_department ON articles(department_id);
CREATE INDEX idx_articles_sop        ON articles(sop_id);

CREATE TABLE article_tags (
    article_id  TEXT NOT NULL REFERENCES articles(id),
    tag         TEXT NOT NULL,
    PRIMARY KEY (article_id, tag)
);

-- One row per edit, so the UI can show history and roll back (PS advanced task).
CREATE TABLE article_versions (
    id          SERIAL PRIMARY KEY,
    article_id  TEXT NOT NULL REFERENCES articles(id),
    version     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    body_text   TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Semantic vectors, stored separately (PS intermediate task).
-- Kept as a JSON array of floats to avoid the pgvector extension for now.
CREATE TABLE article_embeddings (
    article_id  TEXT NOT NULL REFERENCES articles(id),
    chunk_no    INTEGER NOT NULL DEFAULT 0,     -- 0 = whole article, or one per step
    chunk_text  TEXT NOT NULL,
    embedding   JSONB NOT NULL,
    PRIMARY KEY (article_id, chunk_no)
);

-- Article IDs that must never be auto-executed (kept even if not in the KB).
CREATE TABLE exclusion_list (
    article_id  TEXT PRIMARY KEY
);

-- ---------- tickets ----------

CREATE TABLE tickets (
    id                  TEXT PRIMARY KEY,       -- TCK-33B7885FCD
    department_id       INTEGER NOT NULL REFERENCES departments(id),
    description         TEXT NOT NULL,          -- current text (may grow after Ask More)
    original_description TEXT NOT NULL,         -- as first submitted (never changed)
    requestor_id        TEXT,
    requestor_geography TEXT,
    status              TEXT NOT NULL DEFAULT 'NEW',
    match_score         NUMERIC(5,2),           -- 0.00 to 100.00
    matched_article_id  TEXT REFERENCES articles(id),
    original_hash       TEXT NOT NULL,          -- SHA-256 of original_description
    current_hash        TEXT NOT NULL,          -- SHA-256 of description
    clarify_round       INTEGER NOT NULL DEFAULT 0,
    it_user_action      TEXT,                   -- filled in when closed
    closure_time        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_department ON tickets(department_id);
CREATE INDEX idx_tickets_status     ON tickets(status);
CREATE INDEX idx_tickets_score      ON tickets(match_score);

-- The answer key, kept apart so the matcher can't peek (your test set).
CREATE TABLE ticket_reference (
    ticket_id           TEXT PRIMARY KEY,
    expected_article_id TEXT,                   -- NULL for the "low" tickets
    expected_bucket     TEXT NOT NULL           -- high / mid / low
);

-- Clarification loop history (one row per Ask More round).
CREATE TABLE clarification_rounds (
    id            SERIAL PRIMARY KEY,
    ticket_id     TEXT NOT NULL REFERENCES tickets(id),
    round_no      INTEGER NOT NULL,
    questions     JSONB,
    answers       JSONB,
    score_before  NUMERIC(5,2),
    score_after   NUMERIC(5,2),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- audit ----------

-- Append-only. In Docker Compose, give the app's DB user no UPDATE/DELETE on this.
CREATE TABLE ticket_audit (
    audit_id    SERIAL PRIMARY KEY,
    ticket_id   TEXT REFERENCES tickets(id),
    user_id     TEXT,                           -- id only, never a name (PS: no PII)
    action      TEXT NOT NULL,                  -- CREATED, MATCHED, OVERRIDDEN, SELF_HEAL, ESCALATED...
    details     JSONB,
    ticket_hash TEXT,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_ticket ON ticket_audit(ticket_id);

-- ---------- users / roles ----------

CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,                -- bcrypt/argon2, never plain
    role          TEXT NOT NULL                 -- admin / analyst / viewer
);

-- ---------- costing (for the Insights tab) ----------

CREATE TABLE cost_rates (
    metric      TEXT PRIMARY KEY,
    value_eur   NUMERIC
);

CREATE TABLE cost_avoidance (
    department          TEXT PRIMARY KEY,        -- exclude the GRAND_TOTAL row on load
    saved_engineer_hours NUMERIC,
    total_savings_eur   NUMERIC
);