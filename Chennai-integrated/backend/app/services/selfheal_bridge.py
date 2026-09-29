"""
Bridge between the API and the self-heal sandbox that was built separately.

IMPORTANT: this file does NOT reimplement self-heal. It calls the existing
run_selfheal() from the sandbox project (selfheal/run_sandbox.py) that was
already built and tested. Set SELFHEAL_DIR in .env to point at that folder.

If the sandbox isn't available (e.g. Docker not running, or path not set),
this returns a clear error instead of crashing the API.
"""
import importlib.util
import os
import sys
from pathlib import Path
from urllib.parse import urlparse


def _ensure_sandbox_db_env():
    """
    The sandbox (run_sandbox.py) connects using DB_HOST/DB_PORT/DB_NAME/
    DB_USER/DB_PASSWORD. This backend uses DATABASE_URL. Derive the DB_*
    vars from DATABASE_URL so the sandbox can connect to the same database.
    Does not modify the sandbox.
    """
    if os.getenv("DB_HOST"):
        return  # already set
    url = os.getenv("DATABASE_URL", "")
    if not url:
        return
    # e.g. postgresql+psycopg://selfheal:vibecoders@localhost:5417/selfheal
    clean = url.split("+")[0] + "://" + url.split("://", 1)[1] if "://" in url else url
    p = urlparse(clean)
    if p.hostname:
        os.environ.setdefault("DB_HOST", p.hostname)
    if p.port:
        os.environ.setdefault("DB_PORT", str(p.port))
    if p.username:
        os.environ.setdefault("DB_USER", p.username)
    if p.password:
        os.environ.setdefault("DB_PASSWORD", p.password)
    if p.path and len(p.path) > 1:
        os.environ.setdefault("DB_NAME", p.path.lstrip("/"))


def _load_run_selfheal():
    """
    Import run_selfheal from the sandbox folder named in SELFHEAL_DIR.
    Falls back to a sibling 'selfheal' folder next to the backend.
    """
    here = Path(__file__).resolve()
    backend_dir = here.parents[2]

    candidates = []
    env_dir = os.getenv("SELFHEAL_DIR")
    if env_dir:
        env_path = Path(env_dir)
        candidates.append(env_path)
        # a relative SELFHEAL_DIR is meant relative to backend/.env, not to
        # whatever folder uvicorn happened to be started from
        if not env_path.is_absolute():
            candidates.append((backend_dir / env_path).resolve())
    # common fallbacks: a 'selfheal' folder next to the backend, the repo,
    # or the folder the repo sits in
    candidates.append(here.parents[4] / "selfheal")
    candidates.append(here.parents[3] / "selfheal")
    candidates.append(here.parents[2] / "selfheal")

    for base in candidates:
        run_file = base / "run_sandbox.py"
        if run_file.exists():
            # make the sandbox folder importable (it uses local imports)
            if str(base) not in sys.path:
                sys.path.insert(0, str(base))
            spec = importlib.util.spec_from_file_location("run_sandbox", run_file)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return getattr(mod, "run_selfheal", None), str(base)
    return None, None


def run_heal(sop_key: str, article_code: str | None, ticket_id, user_id) -> dict:
    """
    sop_key: the target key the sandbox expects, e.g. "SOP-521"
             (stored in articles.script_path).
    Returns {"ok": bool, "logs": str, "error": str|None}.
    """
    fn, base = _load_run_selfheal()
    if fn is None:
        return {"ok": False, "error": "self-heal sandbox not found; set SELFHEAL_DIR in .env"}

    _ensure_sandbox_db_env()

    try:
        # run_selfheal(sop_id, article_id=None, ticket_id=None, user_id="system")
        # We pass article_id=None so the sandbox skips its own exclusion-list
        # DB lookup (the API already checks no_auto_execute before calling this).
        # The sandbox writes its own audit row; the API also writes one here.
        return fn(sop_key, article_id=None, ticket_id=str(ticket_id), user_id=str(user_id))
    except Exception as e:
        return {"ok": False, "error": f"self-heal call failed: {e}"}
