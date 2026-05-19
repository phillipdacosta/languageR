#!/usr/bin/env python3
"""Add ALERTS.MESSAGES.MORE to all locale i18n files."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from deep_translator import GoogleTranslator

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"
MORE_EN = "More..."

LANG_MAP = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es",
    "fa": "fa", "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id",
    "it": "it", "ja": "ja", "ko": "ko", "ms": "ms", "nl": "nl", "no": "no",
    "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "sv": "sv", "th": "th",
    "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}

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


def translate_one(translator: GoogleTranslator, text: str) -> str:
    masked, holders = mask(text)
    for attempt in range(6):
        try:
            return unmask(translator.translate(masked), holders)
        except Exception:
            time.sleep(0.7 * (attempt + 1))
    return text


def main() -> None:
    en_path = I18N_DIR / "en.json"
    en_data = json.loads(en_path.read_text(encoding="utf-8"))
    en_data.setdefault("ALERTS", {}).setdefault("MESSAGES", {})["MORE"] = MORE_EN
    en_path.write_text(json.dumps(en_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Updated en.json", flush=True)

    for path in sorted(I18N_DIR.glob("*.json")):
        stem = path.stem
        if stem == "en":
            continue
        gt = LANG_MAP.get(stem)
        if not gt:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        messages = data.setdefault("ALERTS", {}).setdefault("MESSAGES", {})
        if messages.get("MORE") and messages.get("MORE") != MORE_EN:
            print(f"{stem}: already has MORE", flush=True)
            continue
        translator = GoogleTranslator(source="en", target=gt)
        messages["MORE"] = translate_one(translator, MORE_EN)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{stem}: {messages['MORE']}", flush=True)
        time.sleep(0.08)


if __name__ == "__main__":
    main()
