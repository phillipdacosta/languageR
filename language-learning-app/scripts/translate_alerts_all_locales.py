#!/usr/bin/env python3
"""Translate ALERTS section where values still match en.json."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from deep_translator import GoogleTranslator

from alerts_modals_i18n_data import ALERTS_EN

I18N = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"
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


def collect_stale(en_b: dict, loc_b: dict, updates: dict[str, str]) -> None:
    for k, ev in en_b.items():
        if isinstance(ev, dict):
            lb = loc_b.get(k)
            if not isinstance(lb, dict):
                loc_b[k] = {}
                lb = loc_b[k]
            collect_stale(ev, lb, updates)
        elif isinstance(ev, str) and loc_b.get(k) == ev:
            updates[k] = ev


def apply_updates(branch: dict, en_b: dict, flat: dict[str, str]) -> None:
    for k, ev in en_b.items():
        if isinstance(ev, dict):
            apply_updates(branch.setdefault(k, {}), ev, flat)
        elif k in flat:
            branch[k] = flat[k]


def translate_batch(tr: GoogleTranslator, texts: list[str]) -> list[str]:
    out: list[str] = []
    for i in range(0, len(texts), 12):
        batch = texts[i : i + 12]
        masked, holders = [], []
        for t in batch:
            m, h = mask(t)
            masked.append(m)
            holders.append(h)
        ok = False
        for attempt in range(5):
            try:
                parts = tr.translate_batch(masked)
                if len(parts) == len(masked):
                    for p, h in zip(parts, holders):
                        out.append(unmask(p or "", h))
                    ok = True
                    break
            except Exception:
                time.sleep(0.6 * (attempt + 1))
        if not ok:
            for m, h in zip(masked, holders):
                out.append(unmask(tr.translate(m), h))
                time.sleep(0.1)
        time.sleep(0.12)
    return out


def main() -> None:
    en = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    en_alerts = en["ALERTS"]
    for stem, gt in LANG_MAP.items():
        path = I18N / f"{stem}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        loc_alerts = data.setdefault("ALERTS", json.loads(json.dumps(en_alerts)))
        updates: dict[str, str] = {}
        collect_stale(en_alerts, loc_alerts, updates)
        if not updates:
            print(f"{stem}: up to date ({len(updates)})")
            continue
        keys = list(updates.keys())
        texts = [updates[k] for k in keys]
        tr = GoogleTranslator(source="en", target=gt)
        translated = translate_batch(tr, texts)
        flat = dict(zip(keys, translated))
        apply_updates(loc_alerts, en_alerts, flat)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{stem}: translated {len(keys)} keys")
    print("finished")


if __name__ == "__main__":
    main()
