#!/usr/bin/env python3
"""Add missing TUTOR_APPROVAL keys from en.json into every other locale file."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"
EN = ROOT / "en.json"


def main() -> None:
    en_ta = json.loads(EN.read_text(encoding="utf-8"))["TUTOR_APPROVAL"]
    for path in sorted(ROOT.glob("*.json")):
        if path.name == "en.json":
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        ta = data.get("TUTOR_APPROVAL")
        if not isinstance(ta, dict):
            continue
        changed = False
        for k, v in en_ta.items():
            if k not in ta:
                ta[k] = v
                changed = True
        if changed:
            data["TUTOR_APPROVAL"] = ta
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print("updated", path.name)


if __name__ == "__main__":
    main()
