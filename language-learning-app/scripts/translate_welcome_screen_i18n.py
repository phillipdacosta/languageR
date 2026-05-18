#!/usr/bin/env python3
"""Sync ONBOARDING.WELCOME_SCREEN from en.json into every locale via Google Translate."""
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

WELCOME_KEYS: tuple[str, ...] = (
    "GREETING",
    "SUBTITLE",
    "TUTOR_GREETING",
    "TUTOR_SUBTITLE",
    "CTA",
    "BACK",
    "TRUST_SECURE",
    "TRUST_TIME",
    "TRUST_FREE",
    "FEAT1_TITLE",
    "FEAT1_DESC",
    "FEAT2_TITLE",
    "FEAT2_DESC",
    "FEAT3_TITLE",
    "FEAT3_DESC",
    "TUTOR_FEAT1_TITLE",
    "TUTOR_FEAT1_DESC",
    "TUTOR_FEAT2_TITLE",
    "TUTOR_FEAT2_DESC",
    "TUTOR_FEAT3_TITLE",
    "TUTOR_FEAT3_DESC",
    "HOW_LABEL",
    "HOW_STEP1",
    "HOW_STEP2",
    "HOW_STEP3",
    "TUTOR_HOW_STEP1",
    "TUTOR_HOW_STEP2",
    "TUTOR_HOW_STEP3",
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


def process_file(en_ws: dict[str, str], path: Path, dry_run: bool) -> int:
    stem = path.stem
    if stem == "en":
        return 0
    gt = LANG_MAP.get(stem)
    if not gt:
        raise SystemExit(f"No LANG_MAP for {stem}")

    data = json.loads(path.read_text(encoding="utf-8"))
    onboarding = data.get("ONBOARDING")
    if not isinstance(onboarding, dict):
        raise SystemExit(f"{path.name}: missing ONBOARDING")

    if dry_run:
        print(f"{path.name}: would translate WELCOME_SCREEN ({len(WELCOME_KEYS)} strings)")
        return len(WELCOME_KEYS)

    translator = GoogleTranslator(source="en", target=gt)
    out: dict[str, str] = {}
    for k in WELCOME_KEYS:
        src = en_ws[k]
        out[k] = capitalize_sentence_start(translate_one(translator, src))
        time.sleep(0.12)

    onboarding["WELCOME_SCREEN"] = out
    data["ONBOARDING"] = onboarding
    write_atomic(path, data)
    print(f"{path.name}: WELCOME_SCREEN written", flush=True)
    return len(WELCOME_KEYS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="Locale stem, e.g. de")
    args = ap.parse_args()

    en = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    ob = en.get("ONBOARDING", {})
    if not isinstance(ob, dict):
        raise SystemExit("en.json missing ONBOARDING")
    en_ws = ob.get("WELCOME_SCREEN", {})
    if not isinstance(en_ws, dict):
        raise SystemExit("en.json missing ONBOARDING.WELCOME_SCREEN")
    for k in WELCOME_KEYS:
        if k not in en_ws or not str(en_ws[k]).strip():
            raise SystemExit(f"en.json WELCOME_SCREEN missing {k}")

    paths = sorted(I18N_DIR.glob("*.json"))
    if args.only:
        paths = [I18N_DIR / f"{args.only}.json"]

    total = 0
    for path in paths:
        if path.name == "en.json":
            continue
        total += process_file(en_ws, path, args.dry_run)

    print("Total string slots processed:", total)


if __name__ == "__main__":
    main()
