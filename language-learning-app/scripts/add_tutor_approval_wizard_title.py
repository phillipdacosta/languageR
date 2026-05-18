#!/usr/bin/env python3
"""Insert TUTOR_APPROVAL.WIZARD_FLOW_TITLE into locale JSON files (skip en, es)."""
import json
from pathlib import Path

I18N = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"
SKIP = {"en.json", "es.json"}

def main() -> None:
    for path in sorted(I18N.glob("*.json")):
        if path.name in SKIP:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        ta = data.get("TUTOR_APPROVAL")
        if not isinstance(ta, dict) or "WIZARD_FLOW_TITLE" in ta:
            continue
        new_ta = {"WIZARD_FLOW_TITLE": "Tutor Approval", **ta}
        data["TUTOR_APPROVAL"] = new_ta
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("updated", path.name)

if __name__ == "__main__":
    main()
