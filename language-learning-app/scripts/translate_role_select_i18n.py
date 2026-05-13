#!/usr/bin/env python3
"""Merge ROLE_SELECT.* from en.json into every locale via Google Translate."""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

from deep_translator import GoogleTranslator

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

LANG_MAP: dict[str, str] = {
    "ar": "ar",
    "cs": "cs",
    "da": "da",
    "de": "de",
    "el": "el",
    "es": "es",
    "fa": "fa",
    "fi": "fi",
    "fr": "fr",
    "he": "iw",
    "hi": "hi",
    "id": "id",
    "it": "it",
    "ja": "ja",
    "ko": "ko",
    "ms": "ms",
    "nl": "nl",
    "no": "no",
    "pl": "pl",
    "pt": "pt",
    "ro": "ro",
    "ru": "ru",
    "sv": "sv",
    "th": "th",
    "tr": "tr",
    "uk": "uk",
    "vi": "vi",
    "zh": "zh-CN",
}

RS_KEYS: tuple[str, ...] = (
    "TITLE",
    "SUBTITLE",
    "STUDENT_TITLE",
    "STUDENT_DESC",
    "TUTOR_TITLE",
    "TUTOR_DESC",
    "NEXT",
)

PH_RE = re.compile(r"\{\{[^}]+\}\}")


def mask_placeholders(s: str) -> tuple[str, list[str]]:
    found: list[str] = []

    def repl(m: re.Match[str]) -> str:
        found.append(m.group(0))
        return f"\ue000{len(found) - 1}\ue001"

    return PH_RE.sub(repl, s), found


def unmask_placeholders(s: str, found: list[str]) -> str:
    out = s
    for i, ph in enumerate(found):
        out = out.replace(f"\ue000{i}\ue001", ph)
    return out


def translate_one(translator: GoogleTranslator, text: str) -> str:
    masked, holders = mask_placeholders(text)
    last_err: Exception | None = None
    for st in range(6):
        try:
            return unmask_placeholders(translator.translate(masked), holders)
        except Exception as e:
            last_err = e
            time.sleep(0.4 * (2**st))
    raise RuntimeError(f"translate failed: {last_err}") from last_err


def capitalize_sentence_start(s: str) -> str:
    """Uppercase the first alphabetic character (fixes MT lowercasing e.g. 'je suis tuteur')."""
    if not s or not isinstance(s, str):
        return s
    s = s.strip()
    for i, ch in enumerate(s):
        if ch.isalpha():
            if ch.islower():
                return s[:i] + ch.upper() + s[i + 1 :]
            break
    return s


def write_atomic(path: Path, data: Any) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def process_file(en_rs: dict[str, str], path: Path, dry_run: bool, args_force: bool) -> int:
    stem = path.stem
    if stem == "en":
        return 0
    gt = LANG_MAP.get(stem)
    if not gt:
        raise SystemExit(f"No LANG_MAP for {stem}")

    data = json.loads(path.read_text(encoding="utf-8"))
    existing = data.get("ROLE_SELECT")
    if isinstance(existing, dict) and not args_force:
        if all(
            k in existing and str(existing.get(k, "")).strip()
            for k in RS_KEYS
        ):
            return 0

    sources = [en_rs[k] for k in RS_KEYS]
    if dry_run:
        print(f"{path.name}: would set ROLE_SELECT ({len(sources)} strings)")
        return len(sources)

    translator = GoogleTranslator(source="en", target=gt)
    translated: list[str] = []
    for s in sources:
        translated.append(translate_one(translator, s))
        time.sleep(0.12)

    data["ROLE_SELECT"] = {
        k: capitalize_sentence_start(v) for k, v in zip(RS_KEYS, translated)
    }
    write_atomic(path, data)
    print(f"{path.name}: ROLE_SELECT written", flush=True)
    return len(RS_KEYS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="Locale stem, e.g. de")
    ap.add_argument("--force", action="store_true", help="Overwrite existing ROLE_SELECT")
    args = ap.parse_args()

    en = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    en_rs = en.get("ROLE_SELECT", {})
    if not isinstance(en_rs, dict):
        raise SystemExit("en.json missing ROLE_SELECT")
    for k in RS_KEYS:
        if k not in en_rs or not str(en_rs[k]).strip():
            raise SystemExit(f"en.json ROLE_SELECT missing {k}")

    paths = sorted(I18N_DIR.glob("*.json"))
    if args.only:
        paths = [I18N_DIR / f"{args.only}.json"]

    total = 0
    for path in paths:
        if path.name == "en.json":
            continue
        total += process_file(en_rs, path, args.dry_run, args.force)

    print("Total string slots processed:", total)


if __name__ == "__main__":
    main()
