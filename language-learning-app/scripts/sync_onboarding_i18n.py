#!/usr/bin/env python3
"""Merge ONBOARDING keys from en.json into all other locale files (missing keys only)."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def deep_merge_onboarding(target: dict, source_onboarding: dict) -> None:
    if "ONBOARDING" not in source_onboarding:
        return
    src_ob = source_onboarding["ONBOARDING"]
    if "ONBOARDING" not in target:
        target["ONBOARDING"] = {}
    dst_ob = target["ONBOARDING"]

    def merge(dst: dict, src: dict) -> None:
        for k, v in src.items():
            if k not in dst:
                dst[k] = v
                continue
            if isinstance(v, dict) and isinstance(dst[k], dict):
                merge(dst[k], v)

    merge(dst_ob, src_ob)


def main() -> int:
    i18n = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"
    en_path = i18n / "en.json"
    if not en_path.exists():
        print("Missing en.json", file=sys.stderr)
        return 1
    en_data = json.loads(en_path.read_text(encoding="utf-8"))
    en_ob = en_data.get("ONBOARDING", {})

    for path in sorted(i18n.glob("*.json")):
        if path.name == "en.json":
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        before = json.dumps(data.get("ONBOARDING", {}), sort_keys=True)
        deep_merge_onboarding(data, {"ONBOARDING": en_ob})
        after = json.dumps(data.get("ONBOARDING", {}), sort_keys=True)
        if before != after:
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print("updated", path.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
