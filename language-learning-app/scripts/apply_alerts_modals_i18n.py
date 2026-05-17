#!/usr/bin/env python3
"""Merge ALERTS into en.json and translate to all locale files."""
from __future__ import annotations

import json
import time
from pathlib import Path

from deep_translator import GoogleTranslator

from alerts_modals_i18n_data import ALERTS_EN

ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = ROOT / "src" / "assets" / "i18n"

LANG_MAP = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es",
    "fa": "fa", "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id",
    "it": "it", "ja": "ja", "ko": "ko", "ms": "ms", "nl": "nl", "no": "no",
    "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "sv": "sv", "th": "th",
    "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}

PH_RE = __import__("re").compile(r"\{\{[^}]+\}\}")


def mask(s: str) -> tuple[str, list[str]]:
    found: list[str] = []

    def repl(m):
        found.append(m.group(0))
        return f"\ue000{len(found) - 1}\ue001"

    return PH_RE.sub(repl, s), found


def unmask(s: str, found: list[str]) -> str:
    for i, ph in enumerate(found):
        s = s.replace(f"\ue000{i}\ue001", ph)
    return s


def flatten(d: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out


def unflatten(flat: dict[str, str]) -> dict:
    root: dict = {}
    for path, val in flat.items():
        parts = path.split(".")
        cur = root
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = val
    return root


def deep_merge(dst: dict, src: dict) -> None:
    for k, v in src.items():
        if k in dst and isinstance(dst[k], dict) and isinstance(v, dict):
            deep_merge(dst[k], v)
        else:
            dst[k] = v


def translate_batch(translator: GoogleTranslator, texts: list[str]) -> list[str]:
    out: list[str] = []
    for i in range(0, len(texts), 8):
        batch = texts[i : i + 8]
        masked, holders = [], []
        for t in batch:
            m, h = mask(t)
            masked.append(m)
            holders.append(h)
        for attempt in range(4):
            try:
                parts = translator.translate_batch(masked)
                if len(parts) == len(masked):
                    for p, h in zip(parts, holders):
                        out.append(unmask(p, h))
                    break
            except Exception:
                time.sleep(0.4 * (attempt + 1))
        else:
            for m, h in zip(masked, holders):
                for st in range(5):
                    try:
                        out.append(unmask(translator.translate(m), h))
                        break
                    except Exception:
                        time.sleep(0.3 * (2**st))
                time.sleep(0.05)
        time.sleep(0.15)
    return out


def main() -> None:
    en_path = I18N_DIR / "en.json"
    en = json.loads(en_path.read_text(encoding="utf-8"))
    deep_merge(en, {"ALERTS": ALERTS_EN})
    en_path.write_text(json.dumps(en, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Updated en.json ALERTS")

    flat_en = flatten(ALERTS_EN, "ALERTS")
    keys = list(flat_en.keys())
    texts = [flat_en[k] for k in keys]

    for stem, gt in LANG_MAP.items():
        path = I18N_DIR / f"{stem}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        translator = GoogleTranslator(source="en", target=gt)
        translated = translate_batch(translator, texts)
        flat_loc = {k: v for k, v in zip(keys, translated)}
        branch = unflatten(flat_loc)
        if "ALERTS" not in data:
            data["ALERTS"] = {}
        deep_merge(data["ALERTS"], branch.get("ALERTS", branch))
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"  {stem}.json ({len(keys)} keys)")

    print("Done.")


if __name__ == "__main__":
    main()
