#!/usr/bin/env python3
"""
Fill missing translations for tutor checklist + approval flow.

- HOME.GROWTH: any string value still identical to en.json
- TUTOR_APPROVAL: same
- PROFILE_SCREEN: deep-merge from en when missing keys; translate strings still identical to en

Uses Google Translate via deep-translator; preserves {{placeholders}}.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from deep_translator import GoogleTranslator

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

# file stem -> Google Translate target code
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

PH_RE = re.compile(r"\{\{[^}]+\}\}")

# Example / technical strings: keep as-is (do not send to MT)
SKIP_TRANSLATE_KEYS = frozenset(
    {
        "PAYPAL_EMAIL_PLACEHOLDER",
    }
)

# For these UI locales, if text has no native-script characters but still
# contains Latin letters, treat as untranslated and re-sync from English source.
NATIVE_SCRIPT_CHECK: dict[str, re.Pattern[str]] = {
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


def should_retranslate_from_en(lang: str, loc_val: str | None, en_val: str, key: str) -> bool:
    if key in SKIP_TRANSLATE_KEYS:
        return False
    if loc_val is None or loc_val == en_val:
        return True
    rx = NATIVE_SCRIPT_CHECK.get(lang)
    if not rx:
        return False
    if rx.search(loc_val):
        return False
    # Leftover English (or other Latin) in a Thai/Japanese/etc. bundle
    if re.search(r"[A-Za-z]{3,}", loc_val):
        return True
    return False


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


def deep_merge_missing_strings(dst: dict[str, Any], src: dict[str, Any]) -> None:
    """Add keys from src missing in dst (same level, string leaves only)."""
    for k, v in src.items():
        if k not in dst:
            dst[k] = v
            continue
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge_missing_strings(dst[k], v)  # type: ignore[arg-type]


def collect_string_updates(
    lang: str,
    en_branch: dict[str, Any],
    loc_branch: dict[str, Any],
    updates: dict[str, str],
) -> None:
    for k, ev in en_branch.items():
        if isinstance(ev, dict):
            lb = loc_branch.get(k)
            if not isinstance(lb, dict):
                loc_branch[k] = {}
                lb = loc_branch[k]
            collect_string_updates(lang, ev, lb, updates)  # type: ignore[arg-type]
            continue
        if not isinstance(ev, str) or not ev.strip():
            continue
        lv = loc_branch.get(k)
        loc_str = lv if isinstance(lv, str) else None
        if should_retranslate_from_en(lang, loc_str, ev, k):
            updates[k] = ev


def apply_flat_updates(branch: dict[str, Any], en_branch: dict[str, Any], flat: dict[str, str]) -> None:
    if not flat:
        return
    for k, ev in en_branch.items():
        if isinstance(ev, dict):
            lb = branch.setdefault(k, {})
            if isinstance(lb, dict):
                apply_flat_updates(lb, ev, flat)
        elif k in flat:
            branch[k] = flat[k]


def translate_texts(translator: GoogleTranslator, texts: list[str], chunk: int = 10) -> list[str]:
    """Prefer small batches; fall back to single calls on batch failure."""
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


def process_locale(en: dict[str, Any], path: Path, dry_run: bool) -> int:
    stem = path.stem
    if stem == "en":
        return 0
    gt = LANG_MAP.get(stem)
    if not gt:
        raise SystemExit(f"No LANG_MAP for {stem}")

    data = json.loads(path.read_text(encoding="utf-8"))

    # 1) Ensure PROFILE_SCREEN exists and has all keys from en
    en_ps = en.get("PROFILE_SCREEN")
    if isinstance(en_ps, dict):
        if "PROFILE_SCREEN" not in data or not isinstance(data["PROFILE_SCREEN"], dict):
            data["PROFILE_SCREEN"] = json.loads(json.dumps(en_ps))
        else:
            deep_merge_missing_strings(data["PROFILE_SCREEN"], en_ps)

    updates: dict[str, str] = {}
    collect_string_updates(stem, en["HOME"]["GROWTH"], data.setdefault("HOME", {}).setdefault("GROWTH", {}), updates)
    collect_string_updates(stem, en["TUTOR_APPROVAL"], data.setdefault("TUTOR_APPROVAL", {}), updates)
    if isinstance(en.get("PROFILE_SCREEN"), dict):
        collect_string_updates(
            stem,
            en["PROFILE_SCREEN"],
            data.setdefault("PROFILE_SCREEN", {}),
            updates,
        )

    if not updates:
        return 0

    keys_order = list(updates.keys())
    if dry_run:
        return len(keys_order)

    texts = [updates[k] for k in keys_order]
    translator = GoogleTranslator(source="en", target=gt)
    translated = translate_texts(translator, texts)
    print(f"  [{stem}] translated {len(texts)} strings", flush=True)

    flat_out = dict(zip(keys_order, translated))
    apply_flat_updates(data["HOME"]["GROWTH"], en["HOME"]["GROWTH"], flat_out)
    apply_flat_updates(data["TUTOR_APPROVAL"], en["TUTOR_APPROVAL"], flat_out)
    if isinstance(data.get("PROFILE_SCREEN"), dict) and isinstance(en.get("PROFILE_SCREEN"), dict):
        apply_flat_updates(data["PROFILE_SCREEN"], en["PROFILE_SCREEN"], flat_out)

    if not dry_run:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(path)
    return len(keys_order)


def main() -> None:
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true", help="Only print counts, do not write files")
    p.add_argument("--only", help="Process a single locale stem, e.g. th")
    args = p.parse_args()

    en_path = I18N_DIR / "en.json"
    en = json.loads(en_path.read_text(encoding="utf-8"))

    total_strings = 0
    paths = sorted(I18N_DIR.glob("*.json"))
    if args.only:
        paths = [I18N_DIR / f"{args.only}.json"]
        if not paths[0].is_file():
            raise SystemExit(f"Missing {paths[0]}")

    for path in paths:
        if path.name == "en.json":
            continue
        n = process_locale(en, path, dry_run=args.dry_run)
        if n:
            print(f"{path.name}: {n} strings {'(dry-run)' if args.dry_run else 'updated'}")
            total_strings += n

    print("Total string slots processed:", total_strings)


if __name__ == "__main__":
    main()
