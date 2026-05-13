#!/usr/bin/env python3
"""
Translate tutor dashboard HOME strings into every locale.

Translates a fixed allow-list of HOME.* keys when the locale value still
matches English (en.json). Skips keys that already differ from en.
Writes via .tmp + replace to avoid corrupting JSON on interrupt.
"""
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

# Tutor home dashboard (tab1) + weekly goal widget
DASHBOARD_HOME_KEYS: tuple[str, ...] = (
    "YOUR_SCHEDULE",
    "QUICK_ACTIONS",
    "CLASSES_SUB",
    "CREATE_MATERIAL_SUB",
    "FORUM_SUB",
    "MY_REVIEWS",
    "MY_REVIEWS_SUB",
    "LESSON_SINGULAR",
    "LESSON_PLURAL",
    "WEEKLY_GOAL_TITLE",
    "WEEKLY_GOAL_EDIT_ARIA",
    "WEEKLY_GOAL_PROGRESS",
    "WEEKLY_GOAL_REACHED",
    "WEEKLY_GOAL_ON_PACE",
    "WEEKLY_GOAL_PER_DAY",
    "WEEKLY_GOAL_SCHEDULED_TO_GO",
    "WEEKLY_GOAL_SCHEDULED_ON_PACE",
    "WEEKLY_GOAL_OPEN_BOOKINGS",
    "WEEKLY_GOAL_ADD_AVAILABILITY",
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


def translate_texts(translator: GoogleTranslator, texts: list[str], chunk: int = 10) -> list[str]:
    out: list[str] = []
    for i in range(0, len(texts), chunk):
        batch = texts[i : i + chunk]
        masked: list[str] = []
        holders: list[list[str]] = []
        for t in batch:
            m, h = mask_placeholders(t)
            masked.append(m)
            holders.append(h)
        batch_ok = False
        for attempt in range(4):
            try:
                parts = translator.translate_batch(masked)
                if len(parts) != len(masked):
                    raise RuntimeError(f"batch size {len(parts)} != {len(masked)}")
                for p, h in zip(parts, holders):
                    out.append(unmask_placeholders(p, h))
                batch_ok = True
                break
            except Exception:
                time.sleep(0.5 * (attempt + 1))
        if not batch_ok:
            for m, h in zip(masked, holders):
                last_err: Exception | None = None
                for st in range(5):
                    try:
                        out.append(unmask_placeholders(translator.translate(m), h))
                        break
                    except Exception as e:
                        last_err = e
                        time.sleep(0.5 * (2**st))
                else:
                    raise RuntimeError(f"translate failed: {last_err}") from last_err
                time.sleep(0.05)
        time.sleep(0.2)
    return out


def process_file(en_home: dict[str, Any], path: Path, dry_run: bool) -> int:
    stem = path.stem
    if stem == "en":
        return 0
    gt = LANG_MAP.get(stem)
    if not gt:
        raise SystemExit(f"No LANG_MAP for {stem}")

    data = json.loads(path.read_text(encoding="utf-8"))
    home = data.setdefault("HOME", {})

    order: list[str] = []
    sources: list[str] = []
    for k in DASHBOARD_HOME_KEYS:
        if k not in en_home:
            continue
        ev = en_home[k]
        if not isinstance(ev, str) or not ev.strip():
            continue
        lv = home.get(k)
        if isinstance(lv, str) and lv != ev:
            continue
        order.append(k)
        sources.append(ev)

    if not order:
        return 0

    if dry_run:
        print(f"{path.name}: would translate {len(order)} keys")
        return len(order)

    translator = GoogleTranslator(source="en", target=gt)
    translated = translate_texts(translator, sources)

    for k, tv in zip(order, translated):
        home[k] = tv

    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)
    print(f"{path.name}: translated {len(order)} keys", flush=True)
    return len(order)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="Locale stem, e.g. de")
    args = ap.parse_args()

    en = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    en_home = en.get("HOME", {})
    if not isinstance(en_home, dict):
        raise SystemExit("en.json missing HOME")

    paths = sorted(I18N_DIR.glob("*.json"))
    if args.only:
        paths = [I18N_DIR / f"{args.only}.json"]

    total = 0
    for path in paths:
        if path.name == "en.json":
            continue
        total += process_file(en_home, path, args.dry_run)

    print("Total keys processed:", total)


if __name__ == "__main__":
    main()
