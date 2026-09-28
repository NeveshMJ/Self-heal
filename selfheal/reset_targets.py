import json
from pathlib import Path

TARGETS = Path(__file__).resolve().parent / "targets"
for f in TARGETS.glob("SOP-*.json"):
    cfg = json.loads(f.read_text())
    cfg["status"] = "BROKEN"
    cfg["config_applied"] = False
    cfg.pop("healed_at", None)
    f.write_text(json.dumps(cfg, indent=2))
    print("reset", f.name)