#!/usr/bin/env python3
"""Normalize ROLE_SELECT strings: first alphabetic character uppercase if lowercase."""
from __future__ import annotations

import json
from pathlib import Path

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

RS_KEYS = (
    "TITLE",
    "SUBTITLE",
    "STUDENT_TITLE",
    "STUDENT_DESC",
    "TUTOR_TITLE",
    "TUTOR_DESC",
    "NEXT",
)


def capitalize_sentence_start(s: str) -> str:
    if not s or not isinstance(s, str):
        return s
    t = s.strip()
    for i, ch in enumerate(t):
        if ch.isalpha():
            if ch.islower():
                return t[:i] + ch.upper() + t[i + 1 :]
            break
    return t


def main() -> None:
    for path in sorted(I18N_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        rs = data.get("ROLE_SELECT")
        if not isinstance(rs, dict):
            continue
        changed = False
        for k in RS_KEYS:
            v = rs.get(k)
            if not isinstance(v, str) or not v:
                continue
            nv = capitalize_sentence_start(v)
            if nv != v:
                rs[k] = nv
                changed = True
        if not changed:
            continue
        data["ROLE_SELECT"] = rs
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)
        print("updated", path.name)


if __name__ == "__main__":
    main()
