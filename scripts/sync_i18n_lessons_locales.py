#!/usr/bin/env python3
"""Merge missing LESSONS_PAGE / EVENT_DETAILS / HOME keys from en.json into all other locale files."""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def deep_merge_missing(dst: dict, src: dict) -> None:
    for k, v in src.items():
        if k not in dst:
            dst[k] = deepcopy(v)
        elif isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge_missing(dst[k], v)


def sync_file(en_path: Path, loc_path: Path, sections: list[str]) -> None:
    en = json.loads(en_path.read_text(encoding="utf-8"))
    loc = json.loads(loc_path.read_text(encoding="utf-8"))
    for sec in sections:
        if sec not in en:
            continue
        if sec not in loc:
            loc[sec] = deepcopy(en[sec])
        else:
            deep_merge_missing(loc[sec], en[sec])
    loc_path.write_text(json.dumps(loc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    web_dir = ROOT / "language-learning-app" / "src" / "assets" / "i18n"
    en_web = web_dir / "en.json"
    for p in sorted(web_dir.glob("*.json")):
        if p.name == "en.json":
            continue
        sync_file(en_web, p, ["LESSONS_PAGE", "EVENT_DETAILS", "HOME"])

    mobile_dir = ROOT / "mobile" / "src" / "i18n" / "locales"
    en_m = mobile_dir / "en.json"
    for p in sorted(mobile_dir.glob("*.json")):
        if p.name == "en.json":
            continue
        sync_file(en_m, p, ["LESSONS_PAGE", "EVENT_DETAILS"])

    print("Synced web: LESSONS_PAGE, EVENT_DETAILS, HOME")
    print("Synced mobile: LESSONS_PAGE, EVENT_DETAILS")


if __name__ == "__main__":
    main()
