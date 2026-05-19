#!/usr/bin/env python3
"""Add MESSAGES voice-note / composer strings to en.json and all locale files."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from deep_translator import GoogleTranslator

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

MESSAGES_VOICE_EN = {
    "VOICE_NOTE": "Voice note {{duration}}s",
    "DISCARD": "Discard",
    "SEND": "Send",
    "UPLOADING": "Uploading...",
    "RECORDING": "Recording... {{duration}}s",
}

# Reuse VIDEO_CALL translations when available (same meaning).
VIDEO_CALL_KEY_MAP = {
    "VOICE_NOTE": "VOICE_NOTE",
    "DISCARD": "DISCARD",
    "SEND": "SEND",
    "UPLOADING": "UPLOADING",
    "RECORDING": "RECORDING",
}

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


def merge_en() -> None:
    path = I18N_DIR / "en.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    messages = data.setdefault("MESSAGES", {})
    messages.update(MESSAGES_VOICE_EN)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Updated en.json MESSAGES", flush=True)


def translate_locales() -> None:
    for path in sorted(I18N_DIR.glob("*.json")):
        stem = path.stem
        if stem == "en":
            continue
        gt = LANG_MAP.get(stem)
        if not gt:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        messages = data.setdefault("MESSAGES", {})
        vc = data.get("VIDEO_CALL") or {}
        translator = GoogleTranslator(source="en", target=gt)
        updated = 0
        for key, en_text in MESSAGES_VOICE_EN.items():
            if messages.get(key) == en_text and stem != "en":
                pass  # still English — retranslate
            vc_key = VIDEO_CALL_KEY_MAP.get(key)
            if vc_key and vc.get(vc_key) and vc.get(vc_key) != MESSAGES_VOICE_EN.get(key):
                val = vc[vc_key]
                if key == "RECORDING" and not val.rstrip().endswith("s"):
                    val = val.rstrip() + "s"
                messages[key] = val
                updated += 1
                continue
            if messages.get(key) and messages.get(key) != en_text:
                continue
            messages[key] = translate_one(translator, en_text)
            updated += 1
            time.sleep(0.08)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{stem}: updated {updated} keys", flush=True)


if __name__ == "__main__":
    merge_en()
    translate_locales()
