#!/usr/bin/env python3
"""Replace i18n values where an AI translation prompt was saved as the string."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from deep_translator import GoogleTranslator

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"
LANG_MAP = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es",
    "fa": "fa", "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id",
    "it": "it", "ja": "ja", "ko": "ko", "ms": "ms", "nl": "nl", "no": "no",
    "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "sv": "sv", "th": "th",
    "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}
PH_RE = re.compile(r"\{\{[^}]+\}\}")

LEAK_MARKERS = (
    "Label UI",
    "UI-etikett",
    "UI-etiket",
    "UI-label",
    "UI-Label",
    "Etykieta interfejsu",
    "Etichetă UI",
    "Étiquette d'interface",
    "kullanıcı arayüzü etiketi",
    "Sprachlern-App",
    "aplik pembelajaran bahasa",
    "aplicatie de învățare",
    "aplicação de aprendizagem",
    "aplicación de aprendizaje",
    "aplikasi pembelajaran bahasa",
    "språkopplæringsapp",
    "språkinlärningsapp",
    "sprogindlæringsapp",
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


def walk_strings(
    en_branch: dict[str, Any],
    loc_branch: dict[str, Any],
    leaks: list[tuple[str, str]],
    prefix: str = "",
) -> None:
    for k, ev in en_branch.items():
        path = f"{prefix}{k}" if prefix else k
        if isinstance(ev, dict):
            lb = loc_branch.get(k)
            if isinstance(lb, dict):
                walk_strings(ev, lb, leaks, f"{path}.")
            continue
        if not isinstance(ev, str):
            continue
        lv = loc_branch.get(k)
        if isinstance(lv, str) and is_leaked(lv):
            leaks.append((path, ev))


def set_nested(branch: dict[str, Any], path: str, value: str) -> None:
    parts = path.split(".")
    cur = branch
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value


def translate_one(translator: GoogleTranslator, text: str) -> str:
    masked, holders = mask(text)
    for attempt in range(5):
        try:
            return unmask(translator.translate(masked), holders)
        except Exception:
            time.sleep(0.6 * (attempt + 1))
    return text


def main() -> None:
    en = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    total = 0

    for path in sorted(I18N_DIR.glob("*.json")):
        stem = path.stem
        if stem == "en":
            continue
        gt = LANG_MAP.get(stem)
        if not gt:
            continue

        data = json.loads(path.read_text(encoding="utf-8"))
        leaks: list[tuple[str, str]] = []
        walk_strings(en, data, leaks)
        if not leaks:
            continue

        print(f"{stem}: fixing {len(leaks)} leaked strings...", flush=True)
        translator = GoogleTranslator(source="en", target=gt)
        for i, (key_path, en_text) in enumerate(leaks):
            translated = translate_one(translator, en_text)
            if translated:
                set_nested(data, key_path, translated)
            time.sleep(0.1)
            if (i + 1) % 5 == 0:
                print(f"  {stem}: {i + 1}/{len(leaks)}", flush=True)

        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        total += len(leaks)
        print(f"{stem}: done", flush=True)

    print(f"Total fixed: {total}", flush=True)


if __name__ == "__main__":
    main()
