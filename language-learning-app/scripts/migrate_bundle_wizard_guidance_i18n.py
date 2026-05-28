#!/usr/bin/env python3
"""Flatten WIZARD_GUIDANCE.BUNDLE.* to BUNDLE_SHARE, BUNDLE_TITLE, … in all locale files."""
from __future__ import annotations

import json
from pathlib import Path

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

STEP_MAP = {
    "SHARE": "BUNDLE_SHARE",
    "TITLE": "BUNDLE_TITLE",
    "DESCRIPTION": "BUNDLE_DESCRIPTION",
    "MATERIALS": "BUNDLE_MATERIALS",
    "COVER": "BUNDLE_COVER",
    "LANGUAGE_LEVEL": "BUNDLE_LANGUAGE_LEVEL",
    "TAGS": "BUNDLE_TAGS",
    "PRICE": "BUNDLE_PRICE",
}


def migrate_file(path: Path) -> bool:
    data = json.loads(path.read_text(encoding="utf-8"))
    cm = data.get("CREATE_MATERIAL")
    if not isinstance(cm, dict):
        return False
    wg = cm.get("WIZARD_GUIDANCE")
    if not isinstance(wg, dict):
        return False
    bundle = wg.pop("BUNDLE", None)
    if not isinstance(bundle, dict):
        return False
    changed = False
    for step, new_key in STEP_MAP.items():
        section = bundle.get(step)
        if isinstance(section, dict):
            wg[new_key] = section
            changed = True
    if changed:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed


def main() -> None:
    count = 0
    for path in sorted(I18N_DIR.glob("*.json")):
        if migrate_file(path):
            print(f"migrated {path.name}")
            count += 1
    print(f"Done: {count} files migrated.")


if __name__ == "__main__":
    main()
