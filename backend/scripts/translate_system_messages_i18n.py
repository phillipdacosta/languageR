#!/usr/bin/env python3
"""Fast batch translator for system message i18n."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from deep_translator import GoogleTranslator

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "backend" / "utils" / "systemMessages.i18n.json"

LANG_MAP = {
    "es": "es", "fr": "fr", "pt": "pt", "de": "de", "it": "it", "ru": "ru",
    "zh": "zh-CN", "ja": "ja", "ko": "ko", "ar": "ar", "hi": "hi", "nl": "nl",
    "pl": "pl", "tr": "tr", "sv": "sv", "no": "no", "da": "da", "fi": "fi",
    "el": "el", "cs": "cs", "ro": "ro", "uk": "uk", "vi": "vi", "th": "th",
    "id": "id", "ms": "ms", "he": "iw", "fa": "fa",
}

STUDENT_INTEREST_EN = {
    "titleFavorite": "A student saved your profile",
    "titleBookLesson": "A student is about to book with you",
    "introFavorite": "{{studentName}} saved your profile and may want to learn {{languageText}} with you.",
    "introBookLesson": "{{studentName}} started booking a {{languageText}} lesson with you but hasn't finalized it yet.",
    "noPlanFallback": "They haven't built out a learning plan yet, so a warm, curious first message can go a long way — ask what brought them to {{languageText}} and what they'd like to get out of lessons.",
    "journeyTitle": "What we know about their journey",
    "journeyGoalLabel": "Goal",
    "journeyLevelLabel": "Self-assessed level",
    "journeyCefrLabel": "Working level",
    "journeyPhaseLabel": "Current phase",
    "journeyFocusLabel": "Currently working on",
    "strugglesTitle": "Where they tend to struggle",
    "encouragementTitle": "Ways to encourage them",
    "ctaTitle": "How to win them over",
    "ctaTipReachOut": "Send a short, personal message — reference their goal so they feel seen.",
    "ctaTipMethodology": "Briefly share how you'd approach their level and goal — concrete trumps generic.",
    "ctaTipQuestion": 'Invite a question back ("anything you\'d like to know about how I teach?") to keep the conversation going.',
    "recoveryNote": "Heads up: they've had a confidence dip recently. Lead with reassurance, not pressure.",
    "supportText": "If you have any questions, feel free to contact support at any time.",
}

TRIAL_SUPPLEMENT_EN = {
    "journeyCefrLabel": "Working level",
    "strugglesTitle": "What they tend to struggle with",
    "encouragementTitle": "Ways to encourage them",
    "recoveryNote": "Heads up: this student has recently had a confidence dip. Favor wins over corrections and consolidate before pushing new material.",
}

SEP = "\n<<<SEP>>>\n"
PH_RE = re.compile(r"\{\{[^}]+\}\}")


def protect(text: str) -> tuple[str, list[str]]:
    phs: list[str] = []
    def repl(m):
        phs.append(m.group(0))
        return f"__PH{len(phs)-1}__"
    return PH_RE.sub(repl, text), phs


def restore(text: str, phs: list[str]) -> str:
    for i, ph in enumerate(phs):
        text = text.replace(f"__PH{i}__", ph)
    return text


def translate_dict(source: dict[str, str], locale: str) -> dict[str, str]:
    keys = list(source.keys())
    protected_blocks: list[str] = []
    all_phs: list[list[str]] = []
    for k in keys:
        p, phs = protect(source[k])
        protected_blocks.append(p)
        all_phs.append(phs)
    joined = SEP.join(protected_blocks)
    target = LANG_MAP[locale]
    translated_joined = GoogleTranslator(source="en", target=target).translate(joined)
    parts = translated_joined.split("<<<SEP>>>")
    if len(parts) != len(keys):
        # fallback: translate one-by-one
        out = {}
        for k in keys:
            p, phs = protect(source[k])
            t = GoogleTranslator(source="en", target=target).translate(p)
            out[k] = restore(t, phs)
            time.sleep(0.05)
        return out
    out = {}
    for k, part, phs in zip(keys, parts, all_phs):
        out[k] = restore(part.strip(), phs)
    return out


def main() -> None:
    data = {
        "student_interest": {"en": STUDENT_INTEREST_EN},
        "trial_lesson_booked_supplement": {"en": TRIAL_SUPPLEMENT_EN},
    }
    for locale in LANG_MAP:
        print(f"Translating {locale}...", flush=True)
        try:
            data["student_interest"][locale] = translate_dict(STUDENT_INTEREST_EN, locale)
            data["trial_lesson_booked_supplement"][locale] = translate_dict(TRIAL_SUPPLEMENT_EN, locale)
        except Exception as e:
            print(f"  ERROR {locale}: {e}", flush=True)
            raise
        time.sleep(0.3)
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
