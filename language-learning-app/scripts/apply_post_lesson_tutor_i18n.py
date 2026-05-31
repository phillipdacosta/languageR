#!/usr/bin/env python3
"""Merge POST_LESSON.TUTOR into en.json and translate all locales."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

from deep_translator import GoogleTranslator

from post_lesson_tutor_i18n_data import POST_LESSON_TUTOR_EN

ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = ROOT / "src" / "assets" / "i18n"

LANG_MAP = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es",
    "fa": "fa", "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id",
    "it": "it", "ja": "ja", "ko": "ko", "ms": "ms", "nl": "nl", "no": "no",
    "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "sv": "sv", "th": "th",
    "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}

PH_RE = re.compile(r"\{\{[^}]+\}\}")
LEAK_MARKERS = (
    "Label UI", "UI-etikett", "Translate to", "Traduire en", "Terjemah ke",
)


def is_leaked(s: str) -> bool:
    return any(m in s for m in LEAK_MARKERS)


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


def translate_one(translator: GoogleTranslator, text: str) -> str:
    masked, holders = mask(text)
    for attempt in range(6):
        try:
            out = unmask(translator.translate(masked), holders)
            if out and not is_leaked(out):
                return out
        except Exception:
            time.sleep(0.7 * (attempt + 1))
    return text


def needs_translation(loc_val: Any, en_val: str) -> bool:
    if not isinstance(loc_val, str) or not loc_val.strip():
        return True
    if loc_val == en_val:
        return True
    return is_leaked(loc_val)


def ensure_post_lesson(data: dict) -> dict:
    post = data.get("POST_LESSON")
    if not isinstance(post, dict):
        post = {}
        data["POST_LESSON"] = post
    return post


def translate_dict(translator: GoogleTranslator, en_map: dict[str, str], loc_map: dict[str, str]) -> int:
    count = 0
    for key, en_text in en_map.items():
        if needs_translation(loc_map.get(key), en_text):
            loc_map[key] = translate_one(translator, en_text)
            count += 1
            time.sleep(0.08)
    return count


def merge_en() -> None:
    en_path = I18N_DIR / "en.json"
    data = json.loads(en_path.read_text(encoding="utf-8"))
    post = ensure_post_lesson(data)
    post["TUTOR"] = POST_LESSON_TUTOR_EN
    alerts = data.setdefault("ALERTS", {}).setdefault("POST_LESSON", {})
    alerts["COMPLETE_FEEDBACK"] = POST_LESSON_TUTOR_EN["COMPLETE_FEEDBACK"]
    en_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Merged POST_LESSON.TUTOR into en.json", flush=True)


def translate_locales(only: list[str] | None = None) -> None:
    en_data = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    en_post = en_data.get("POST_LESSON", {})
    en_soft = en_post.get("SOFT_PLAN_PROMPT", {}) if isinstance(en_post, dict) else {}
    en_tutor = POST_LESSON_TUTOR_EN
    en_complete_feedback = en_tutor["COMPLETE_FEEDBACK"]

    for path in sorted(I18N_DIR.glob("*.json")):
        stem = path.stem
        if stem == "en" or (only and stem not in only):
            continue
        gt = LANG_MAP.get(stem)
        if not gt:
            continue

        data = json.loads(path.read_text(encoding="utf-8"))
        post = ensure_post_lesson(data)
        tutor = post.setdefault("TUTOR", {})
        translator = GoogleTranslator(source="en", target=gt)

        tutor_count = translate_dict(translator, en_tutor, tutor)
        soft_count = 0
        if isinstance(en_soft, dict) and en_soft:
            soft = post.setdefault("SOFT_PLAN_PROMPT", {})
            if isinstance(soft, dict):
                soft_count = translate_dict(translator, en_soft, soft)

        alerts = data.setdefault("ALERTS", {}).setdefault("POST_LESSON", {})
        alert_count = 0
        if needs_translation(alerts.get("COMPLETE_FEEDBACK"), en_complete_feedback):
            alerts["COMPLETE_FEEDBACK"] = translate_one(translator, en_complete_feedback)
            alert_count = 1

        total = tutor_count + soft_count + alert_count
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{stem}: {total} keys updated", flush=True)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("all", "en"):
        merge_en()
    if cmd in ("all", "translate"):
        only = sys.argv[2:] if cmd == "translate" else None
        translate_locales(only or None)


if __name__ == "__main__":
    main()
