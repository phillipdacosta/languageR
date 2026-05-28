#!/usr/bin/env python3
"""Translate EVENT_DETAILS strings that are missing or still identical to en.json."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

from deep_translator import GoogleTranslator

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

LANG_MAP: dict[str, str] = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es",
    "fa": "fa", "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id",
    "it": "it", "ja": "ja", "ko": "ko", "ms": "ms", "nl": "nl", "no": "no",
    "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "sv": "sv", "th": "th",
    "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}

PH_RE = re.compile(r"\{\{[^}]+\}\}")
SKIP_KEYS = frozenset({"CLASS_DEFAULT_ALT"})


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


def deep_merge_missing(dst: dict[str, Any], src: dict[str, Any]) -> None:
    for k, v in src.items():
        if k not in dst:
            dst[k] = json.loads(json.dumps(v))
        elif isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge_missing(dst[k], v)


def collect_updates(en_branch: dict[str, Any], loc_branch: dict[str, Any], updates: dict[str, str]) -> None:
    for k, ev in en_branch.items():
        if isinstance(ev, dict):
            lb = loc_branch.get(k)
            if not isinstance(lb, dict):
                loc_branch[k] = {}
                lb = loc_branch[k]
            collect_updates(ev, lb, updates)
            continue
        if not isinstance(ev, str) or not ev.strip() or k in SKIP_KEYS:
            continue
        lv = loc_branch.get(k)
        if not isinstance(lv, str) or lv == ev:
            updates[k] = ev


def apply_updates(branch: dict[str, Any], en_branch: dict[str, Any], flat: dict[str, str]) -> None:
    for k, ev in en_branch.items():
        if isinstance(ev, dict):
            lb = branch.setdefault(k, {})
            if isinstance(lb, dict):
                apply_updates(lb, ev, flat)
        elif k in flat:
            branch[k] = flat[k]


def translate_texts(translator: GoogleTranslator, texts: list[str], chunk: int = 12) -> list[str]:
    out: list[str] = []
    for i in range(0, len(texts), chunk):
        batch = texts[i : i + chunk]
        masked, holders = [], []
        for t in batch:
            m, h = mask_placeholders(t)
            masked.append(m)
            holders.append(h)
        for attempt in range(4):
            try:
                parts = translator.translate_batch(masked)
                if len(parts) == len(masked):
                    for p, h in zip(parts, holders):
                        out.append(unmask_placeholders(p, h))
                    break
            except Exception:
                time.sleep(0.4 * (attempt + 1))
        else:
            for m, h in zip(masked, holders):
                out.append(unmask_placeholders(translator.translate(m), h))
                time.sleep(0.05)
        time.sleep(0.15)
    return out


def process_locale(en: dict[str, Any], path: Path, dry_run: bool) -> int:
    stem = path.stem
    if stem == "en":
        return 0
    gt = LANG_MAP.get(stem)
    if not gt:
        return 0

    data = json.loads(path.read_text(encoding="utf-8"))
    en_ed = en.get("EVENT_DETAILS")
    if not isinstance(en_ed, dict):
        return 0

    if "EVENT_DETAILS" not in data or not isinstance(data["EVENT_DETAILS"], dict):
        data["EVENT_DETAILS"] = json.loads(json.dumps(en_ed))
    else:
        deep_merge_missing(data["EVENT_DETAILS"], en_ed)

    updates: dict[str, str] = {}
    collect_updates(en_ed, data["EVENT_DETAILS"], updates)
    if not updates:
        return 0
    if dry_run:
        return len(updates)

    keys = list(updates.keys())
    translated = translate_texts(GoogleTranslator(source="en", target=gt), [updates[k] for k in keys])
    flat = dict(zip(keys, translated))
    apply_updates(data["EVENT_DETAILS"], en_ed, flat)

    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    print(f"  [{stem}] {len(keys)} strings", flush=True)
    return len(keys)


def main() -> None:
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--only", help="Locale stem, e.g. de")
    args = p.parse_args()

    en = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    paths = sorted(I18N_DIR.glob("*.json"))
    if args.only:
        paths = [I18N_DIR / f"{args.only}.json"]

    total = 0
    for path in paths:
        if path.name == "en.json":
            continue
        n = process_locale(en, path, args.dry_run)
        if n:
            print(f"{path.name}: {n}{' (dry-run)' if args.dry_run else ''}")
            total += n
    print("Total:", total)


if __name__ == "__main__":
    main()
