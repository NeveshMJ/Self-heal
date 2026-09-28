"""
Self-heal runner: runs a whitelisted fix script inside a locked-down
Docker container, with exclusion-list checks and audit logging.

Terminal test:  python selfheal/run_sandbox.py SOP-521
The API will call run_selfheal(sop_id, article_id, ticket_id, user_id).
"""
import os
import sys
import json
import traceback
from pathlib import Path

import psycopg
from dotenv import load_dotenv

print("Runner started.")

try:
    import docker
except ImportError:
    print("ERROR: 'docker' not installed. Run: pip install docker")
    sys.exit(1)

load_dotenv()
BASE = Path(__file__).resolve().parent
SCRIPTS = BASE / "scripts"
TARGETS = BASE / "targets"
WHITELISTED_SCRIPT = "apply_config.py"
TIMEOUT_SECONDS = 30


def db():
    return psycopg.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"))


def audit(ticket_id, user_id, action, details):
    """Write one row to ticket_audit (never fails the heal if logging fails)."""
    try:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO ticket_audit (ticket_id, user_id, action, details)
                   VALUES (%s, %s, %s, %s)""",
                (ticket_id, user_id, action, json.dumps(details)))
            conn.commit()
    except Exception as e:
        print(f"(audit log failed: {e})")


def is_excluded(article_id):
    if not article_id:
        return False
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM articles WHERE id=%s AND no_auto_execute=true", (article_id,))
        if cur.fetchone():
            return True
        cur.execute("SELECT 1 FROM exclusion_list WHERE article_id=%s", (article_id,))
        return cur.fetchone() is not None


def run_selfheal(sop_id, article_id=None, ticket_id=None, user_id="system"):
    script = SCRIPTS / WHITELISTED_SCRIPT
    target = TARGETS / f"{sop_id}.json"

    # --- safety checks ---
    if not script.resolve().is_relative_to(SCRIPTS.resolve()):
        return {"ok": False, "error": "script not in whitelisted folder"}
    if not target.exists():
        return {"ok": False, "error": f"no target for {sop_id}"}
    if is_excluded(article_id):
        audit(ticket_id, user_id, "SELF_HEAL_BLOCKED",
              {"article_id": article_id, "reason": "exclusion_list"})
        return {"ok": False, "error": "article is on the exclusion list; auto-heal blocked"}

    print("Connecting to Docker...")
    client = docker.from_env()
    client.ping()
    print("Docker connected. Running fix in sandbox...")

    volumes = {
        str(SCRIPTS): {"bind": "/opt/selfheal", "mode": "ro"},
        str(TARGETS): {"bind": "/work", "mode": "rw"},
    }

    container = None
    try:
        container = client.containers.run(
            image="python:3.12-slim",
            command=["python", f"/opt/selfheal/{WHITELISTED_SCRIPT}", f"/work/{sop_id}.json"],
            volumes=volumes,
            network_disabled=True,
            mem_limit="128m",
            detach=True,
        )
        result = container.wait(timeout=TIMEOUT_SECONDS)
        output = container.logs().decode("utf-8")
        exit_code = result.get("StatusCode", 1)
        success = exit_code == 0 and "RESULT: SUCCESS" in output

        print("---- container output ----")
        print(output)
        print("--------------------------")

        audit(ticket_id, user_id,
              "SELF_HEAL_SUCCESS" if success else "SELF_HEAL_FAILED",
              {"sop_id": sop_id, "article_id": article_id,
               "exit_code": exit_code, "output": output})
        return {"ok": success, "logs": output, "exit_code": exit_code}
    except Exception as e:
        audit(ticket_id, user_id, "SELF_HEAL_ERROR",
              {"sop_id": sop_id, "error": str(e)})
        return {"ok": False, "error": str(e)}
    finally:
        if container:
            try:
                container.remove(force=True)
            except Exception:
                pass


if __name__ == "__main__":
    sop = sys.argv[1] if len(sys.argv) > 1 else "SOP-521"
    print(f"Healing: {sop}")
    try:
        result = run_selfheal(sop, user_id="terminal-test")
        print("\n=== RESULT ===")
        print("Success:", result.get("ok"), "| error:", result.get("error"))
    except Exception:
        traceback.print_exc()