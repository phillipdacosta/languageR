#!/usr/bin/env python3
"""Sync JOURNEY.INTRO strings from en.json to all locale bundles."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from deep_translator import GoogleTranslator

I18N = Path(__file__).resolve().parents[1] / "src" / "assets" / "i18n"

LANG_MAP: dict[str, str] = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es", "fa": "fa",
    "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id", "it": "it", "ja": "ja",
    "ko": "ko", "ms": "ms", "nl": "nl", "no": "no", "pl": "pl", "pt": "pt", "ro": "ro",
    "ru": "ru", "sv": "sv", "th": "th", "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}

NATIVE: dict[str, re.Pattern[str]] = {
    "th": re.compile(r"[\u0e00-\u0e7f]"),
    "ja": re.compile(r"[\u3040-\u30ff\u4e00-\u9fff\u3000-\u303f]"),
    "ko": re.compile(r"[\uac00-\ud7a3]"),
    "zh": re.compile(r"[\u4e00-\u9fff]"),
    "ar": re.compile(r"[\u0600-\u06ff]"),
    "he": re.compile(r"[\u0590-\u05ff]"),
    "fa": re.compile(r"[\u0600-\u06ff]"),
    "hi": re.compile(r"[\u0900-\u097f]"),
    "ru": re.compile(r"[\u0400-\u04ff]"),
    "uk": re.compile(r"[\u0400-\u04ff]"),
    "el": re.compile(r"[\u0370-\u03ff]"),
}


def needs_retranslate(stem: str, loc_val: str | None, en_val: str) -> bool:
    if loc_val is None:
        return True
    if loc_val == en_val:
        return True
    rx = NATIVE.get(stem)
    if not rx:
        return False
    if rx.search(loc_val):
        return False
    return any(ch.isascii() and ch.isalpha() for ch in loc_val)


def translate_one(tr: GoogleTranslator, text: str) -> str:
    for attempt in range(5):
        try:
            return tr.translate(text)
        except Exception:
            time.sleep(0.6 * (attempt + 1))
    return text


def main() -> None:
    en = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    en_intro: dict[str, str] = en["JOURNEY"]["INTRO"]
    keys = list(en_intro.keys())
    total = 0

    for stem, gt in LANG_MAP.items():
        path = I18N / f"{stem}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        intro = data.setdefault("JOURNEY", {}).setdefault("INTRO", {})
        todo = {
            k: en_intro[k]
            for k in keys
            if needs_retranslate(
                stem,
                intro.get(k) if isinstance(intro.get(k), str) else None,
                en_intro[k],
            )
        }
        if not todo:
            print(f"{stem}: up to date")
            continue

        tr = GoogleTranslator(source="en", target=gt)
        ordered = list(todo.keys())
        texts = [todo[k] for k in ordered]
        translated: list[str] = []

        if len(texts) == 1:
            translated = [translate_one(tr, texts[0])]
        else:
            batch_ok = False
            for attempt in range(4):
                try:
                    batch = tr.translate_batch(texts)
                    if len(batch) == len(texts):
                        translated = batch
                        batch_ok = True
                        break
                except Exception:
                    time.sleep(0.8 * (attempt + 1))
            if not batch_ok:
                translated = [translate_one(tr, t) for t in texts]

        for k, val in zip(ordered, translated):
            intro[k] = val
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",encoding="utf-8")
        print(f"{stem}: translated {len(ordered)} keys")
        total += len(ordered)
        time.sleep(0.12)

    print(f"done — {total} keys updated")


if __name__ == "__main__":
    main()
