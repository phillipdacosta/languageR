#!/usr/bin/env python3
"""Translate keys in a top-level i18n section that still match en.json."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from deep_translator import GoogleTranslator

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"
LANG_MAP = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es",
    "fa": "fa", "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id",
    "it": "it", "ja": "ja", "ko": "ko", "ms": "ms", "nl": "nl", "no": "no",
    "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "sv": "sv", "th": "th",
    "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}
SKIP_KEYS = frozenset()
PH_RE = re.compile(r"\{\{[^}]+\}\}")


def mask(s: str) -> tuple[str, list[str]]:
    found: list[str] = []

    def repl(m: re.Match[str]) -> str:
        found.append(m.group(0))
        return f"\ue000{len(found) - 1}\ue001"

    return PH_RE.sub(repl, s), found


def unmask(s: str, found: list[str]) -> str:
    for i, ph in enumerate(found):
        s = s.replace(f"\ue000{i}\ue001", ph)
    return s


def collect_stale(en_branch: dict, loc_branch: dict, updates: dict, path_prefix: str = "") -> None:
    for k, ev in en_branch.items():
        key_path = f"{path_prefix}{k}" if path_prefix else k
        if isinstance(ev, dict):
            if not isinstance(loc_branch.get(k), dict):
                loc_branch[k] = {}
            collect_stale(ev, loc_branch[k], updates, f"{key_path}.")
        elif isinstance(ev, str) and ev.strip() and k not in SKIP_KEYS:
            lv = loc_branch.get(k) if isinstance(loc_branch, dict) else None
            if lv is None or lv == ev:
                updates[key_path] = ev


def set_nested(branch: dict, key_path: str, value: str) -> None:
    parts = key_path.split(".")
    cur = branch
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value


def translate_one(translator: GoogleTranslator, text: str) -> str:
    masked, holders = mask(text)
    for attempt in range(6):
        try:
            return unmask(translator.translate(masked), holders)
        except Exception as e:
            if attempt == 5:
                raise
            time.sleep(0.8 * (attempt + 1))
    return text


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: translate_section_stale.py SECTION [locale ...]", file=sys.stderr)
        sys.exit(1)
    section = sys.argv[1]
    only = sys.argv[2:] if len(sys.argv) > 2 else None
    en_data = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    if section not in en_data:
        print(f"Section {section!r} not found in en.json", file=sys.stderr)
        sys.exit(1)
    en_branch = en_data[section]

    for path in sorted(I18N_DIR.glob("*.json")):
        stem = path.stem
        if stem == "en" or (only and stem not in only):
            continue
        gt = LANG_MAP.get(stem)
        if not gt:
            continue

        data = json.loads(path.read_text(encoding="utf-8"))
        loc_branch = data.setdefault(section, {})
        updates: dict[str, str] = {}
        collect_stale(en_branch, loc_branch, updates)
        if not updates:
            print(f"{stem}: ok", flush=True)
            continue

        print(f"{stem}: {len(updates)} strings...", flush=True)
        translator = GoogleTranslator(source="en", target=gt)
        for i, (key_path, en_text) in enumerate(updates.items()):
            try:
                translated = translate_one(translator, en_text)
                if translated and translated != en_text:
                    set_nested(loc_branch, key_path, translated)
                else:
                    time.sleep(1.5)
                    translated = translate_one(translator, en_text)
                    if translated:
                        set_nested(loc_branch, key_path, translated)
            except Exception as err:
                print(f"  WARN {key_path}: {err}", flush=True)
            if (i + 1) % 10 == 0:
                print(f"  {stem}: {i + 1}/{len(updates)}", flush=True)
            time.sleep(0.12)

        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{stem}: done", flush=True)


if __name__ == "__main__":
    main()
