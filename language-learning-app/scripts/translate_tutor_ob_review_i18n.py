#!/usr/bin/env python3
"""Translate ONBOARDING.TUTOR_OB review/sidebar strings when still identical to en.json."""
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

TUTOR_OB_REVIEW_KEYS: tuple[str, ...] = (
    "PREVIEW_TITLE",
    "PREVIEW_SUBTITLE",
    "PREVIEW_BASIC_INFO",
    "PREVIEW_TUTOR_BADGE",
    "PREVIEW_SETUP_STATUS",
    "PREVIEW_SETUP_STATUS_INCOMPLETE",
    "PREVIEW_SETUP_HEADING",
    "PREVIEW_PROGRESS_INCOMPLETE",
    "PREVIEW_CHECKLIST_BASIC",
    "PREVIEW_CHECKLIST_TEACHING",
    "PREVIEW_CHECKLIST_PROFILE",
    "PREVIEW_CHECKLIST_AVAILABILITY",
    "PREVIEW_PROGRESS_ALL_SET",
    "PREVIEW_EDIT_LATER_NOTE",
    "PREVIEW_TIMEZONE",
    "PREVIEW_SCHEDULE_LABEL",
    "PREVIEW_NAME",
    "PREVIEW_FROM",
    "PREVIEW_RESIDES",
    "PREVIEW_TEACHING",
    "PREVIEW_NATIVE_LANG",
    "PREVIEW_TEACHES",
    "PREVIEW_EXPERIENCE",
    "PREVIEW_AVAILABILITY",
    "PREVIEW_PROFILE",
    "PREVIEW_SUMMARY",
    "PREVIEW_BIO",
    "PREVIEW_RATE",
    "PREVIEW_HOURLY_RATE",
    "WIZARD_FLOW_TITLE",
    "WIZARD_REVIEW_LINK",
)

STUDENT_REVIEW_KEYS: tuple[str, ...] = (
    "PREVIEW_STUDENT_BADGE",
    "PREVIEW_CHECKLIST_ABOUT",
    "PREVIEW_CHECKLIST_LEARNING",
    "PREVIEW_CHECKLIST_GOALS",
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
    for _ in range(6):
        try:
            out = translator.translate(masked)
            return unmask_placeholders(out, holders)
        except Exception as e:
            last_err = e
            time.sleep(0.4)
    raise RuntimeError(f"translate failed: {text!r}") from last_err


def process_locale(en_ob: dict[str, Any], path: Path, dry_run: bool) -> int:
    stem = path.stem
    if stem == "en":
        return 0
    gt = LANG_MAP.get(stem)
    if not gt:
        return 0

    data = json.loads(path.read_text(encoding="utf-8"))
    loc_ob = data.setdefault("ONBOARDING", {}).setdefault("TUTOR_OB", {})
    en_tutor = en_ob.get("TUTOR_OB", {})
    if not isinstance(en_tutor, dict):
        en_tutor = {}

    to_translate: list[tuple[str, str, str]] = []
    for key in TUTOR_OB_REVIEW_KEYS:
        en_val = en_tutor.get(key)
        if not isinstance(en_val, str) or not en_val.strip():
            continue
        loc_val = loc_ob.get(key)
        if loc_val is None or loc_val == en_val:
            to_translate.append(("TUTOR_OB", key, en_val))

    en_student = en_ob.get("STUDENT", {})
    loc_student = data.setdefault("ONBOARDING", {}).setdefault("STUDENT", {})
    if isinstance(en_student, dict):
        for key in STUDENT_REVIEW_KEYS:
            en_val = en_student.get(key)
            if not isinstance(en_val, str) or not en_val.strip():
                continue
            loc_val = loc_student.get(key) if isinstance(loc_student, dict) else None
            if loc_val is None or loc_val == en_val:
                to_translate.append(("STUDENT", key, en_val))

    en_also = en_ob.get("PREVIEW_ALSO_SPEAKS")
    if isinstance(en_also, str):
        loc_also = data.get("ONBOARDING", {}).get("PREVIEW_ALSO_SPEAKS")
        if loc_also is None or loc_also == en_also:
            to_translate.append(("__ROOT__", "__PREVIEW_ALSO_SPEAKS__", en_also))

    if not to_translate:
        return 0
    if dry_run:
        return len(to_translate)

    translator = GoogleTranslator(source="en", target=gt)
    for section, key, en_val in to_translate:
        translated = translate_one(translator, en_val)
        if section == "__ROOT__" and key == "__PREVIEW_ALSO_SPEAKS__":
            data["ONBOARDING"]["PREVIEW_ALSO_SPEAKS"] = translated
        elif section == "STUDENT":
            data["ONBOARDING"]["STUDENT"][key] = translated
        else:
            loc_ob[key] = translated
        time.sleep(0.12)

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  {path.name}: {len(to_translate)} strings", flush=True)
    return len(to_translate)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--only", help="Locale stem, e.g. fr")
    args = p.parse_args()

    en = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    en_ob = en.get("ONBOARDING", {})

    paths = sorted(I18N_DIR.glob("*.json"))
    if args.only:
        paths = [I18N_DIR / f"{args.only}.json"]

    total = 0
    for path in paths:
        if path.name == "en.json":
            continue
        total += process_locale(en_ob, path, args.dry_run)

    print("Total:", total)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
