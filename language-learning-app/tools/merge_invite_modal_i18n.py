#!/usr/bin/env python3
"""Merge HOME.INVITE_* strings into all locale JSON files using Google Translate (deep-translator)."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

try:
    from deep_translator import GoogleTranslator
except ImportError:
    print("pip install deep-translator", file=sys.stderr)
    raise

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

# File stem -> Google Translate target code
LANG_MAP = {
    "es": "es",
    "fr": "fr",
    "de": "de",
    "it": "it",
    "pt": "pt",
    "nl": "nl",
    "pl": "pl",
    "ru": "ru",
    "uk": "uk",
    "cs": "cs",
    "ro": "ro",
    "el": "el",
    "da": "da",
    "no": "no",
    "sv": "sv",
    "fi": "fi",
    "tr": "tr",
    "ar": "ar",
    "he": "iw",
    "fa": "fa",
    "hi": "hi",
    "th": "th",
    "vi": "vi",
    "id": "id",
    "ms": "ms",
    "ja": "ja",
    "ko": "ko",
    "zh": "zh-CN",
}


def protect_mustache(s: str) -> tuple[str, list[str]]:
    """Replace {{...}} with private-use chars so Google Translate leaves placeholders intact."""
    parts: list[str] = []
    base = 0xE000

    def repl(m: re.Match) -> str:
        i = len(parts)
        if i >= 64:
            raise ValueError("too many {{}} placeholders in one string")
        parts.append(m.group(0))
        return chr(base + i)

    out = re.sub(r"\{\{[^}]+\}\}", repl, s)
    return out, parts


def restore_mustache(s: str, parts: list[str]) -> str:
    base = 0xE000
    for i, p in enumerate(parts):
        s = s.replace(chr(base + i), p)
    return s


def load_en_invite_strings() -> dict[str, str]:
    with open(I18N_DIR / "en.json", encoding="utf-8") as f:
        data = json.load(f)
    home = data.get("HOME", {})
    return {k: v for k, v in home.items() if k.startswith("INVITE_") and isinstance(v, str)}


def merge_locale(path: Path, invite_en: dict[str, str]) -> None:
    stem = path.stem
    if stem == "en":
        return
    tgt = LANG_MAP.get(stem)
    if not tgt:
        print(f"skip (no LANG_MAP): {path.name}")
        return

    keys = sorted(invite_en.keys())
    originals = [invite_en[k] for k in keys]
    protected: list[str] = []
    part_lists: list[list[str]] = []
    for o in originals:
        p, pl = protect_mustache(o)
        protected.append(p)
        part_lists.append(pl)

    try:
        translator = GoogleTranslator(source="en", target=tgt)
        translated = translator.translate_batch(protected)
    except Exception as e:
        print(f"translate failed {stem} -> {tgt}: {e}", file=sys.stderr)
        raise

    if len(translated) != len(keys):
        raise RuntimeError(f"{stem}: expected {len(keys)} strings, got {len(translated)}")

    merged = {k: restore_mustache(t, part_lists[i]) for i, (k, t) in enumerate(zip(keys, translated))}

    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if "HOME" not in data:
        data["HOME"] = {}
    have = sum(1 for k in data["HOME"] if k.startswith("INVITE_"))
    if have >= len(invite_en):
        print(f"skip {path.name} (already {have} INVITE_* keys)")
        return
    data["HOME"].update(merged)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"updated {path.name} ({len(merged)} keys)")


def main() -> None:
    invite_en = load_en_invite_strings()
    if not invite_en:
        sys.exit("No INVITE_* keys in en.json HOME")
    paths = sorted(p for p in I18N_DIR.glob("*.json") if p.stem != "en")
    for i, path in enumerate(paths):
        merge_locale(path, invite_en)
        if i < len(paths) - 1:
            time.sleep(0.35)


if __name__ == "__main__":
    main()
