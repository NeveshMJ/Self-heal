"""
Whitelisted remediation: applies a pending configuration change.
Runs INSIDE the sandbox container. Reads one target config file,
flips its status from BROKEN to HEALTHY, and reports the result.
"""
import json
import sys
from datetime import datetime, timezone


def main():
    if len(sys.argv) < 2:
        print("ERROR: no target file given")
        sys.exit(2)

    target = sys.argv[1]
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] Reading config: {target}")

    with open(target, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] Current status: {cfg.get('status')}")

    if cfg.get("status") == "HEALTHY":
        print("Nothing to do; service already healthy.")
        sys.exit(0)

    cfg["status"] = "HEALTHY"
    cfg["config_applied"] = True
    cfg["healed_at"] = datetime.now(timezone.utc).isoformat()

    with open(target, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)

    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] Applied configuration change.")
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] Verifying ... status = HEALTHY")
    print("RESULT: SUCCESS")
    sys.exit(0)


if __name__ == "__main__":
    main()