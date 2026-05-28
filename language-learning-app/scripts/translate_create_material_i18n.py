#!/usr/bin/env python3
"""Translate CREATE_MATERIAL strings (incl. bundle wizard) into all locales."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from deep_translator import GoogleTranslator
from deep_translator.exceptions import TranslationNotFound

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

LANG_MAP: dict[str, str] = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es",
    "fa": "fa", "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id",
    "it": "it", "ja": "ja", "ko": "ko", "ms": "ms", "nl": "nl", "no": "no",
    "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "sv": "sv", "th": "th",
    "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}

PH_RE = re.compile(r"\{\{[^}]+\}\}")

# Top-level CREATE_MATERIAL keys always checked (quiz wizard, gateway, etc.)
TOP_LEVEL_KEYS = frozenset({
    "MODAL_GO_BACK", "MODAL_TITLE", "VIEW_EXISTING", "CREATED", "CREATE_NEW",
    "CREATE_NEW_DESC", "CREATE_FIRST", "CARD_ADDED_DATE",
    "PRICING_DESC", "PRICING_WIZ_FLOW_TITLE", "DETAILS_WIZ_NEXT", "DETAILS_WIZ_FLOW_TITLE",
    "QUIZ_WIZ_FLOW_TITLE", "PREVIEW_WIZ_FLOW_TITLE", "QUIZ_PREVIEW_BTN",
    "QUIZ_ADD_QUESTION",
    "PUBLISH_PRIVATE_NOTICE", "PUBLISH_SHARE_STUDENTS_DESC", "PUBLISH_SHARE_STUDENTS_BTN",
    "PUBLISH_SHARED_DONE", "TOAST_SHARE_FAILED",
    "VISIBILITY_LABEL", "VISIBILITY_PRIVATE", "VISIBILITY_PAST_STUDENTS",
    "VISIBILITY_PAST_STUDENTS_SHORT", "VISIBILITY_PUBLIC", "VISIBILITY_TOGGLE_LABEL",
    "ALERT_MAKE_PUBLIC_TITLE", "ALERT_MAKE_PUBLIC_MSG", "ALERT_MAKE_PUBLIC_BTN",
    "TOAST_VISIBILITY_FAILED", "SHARE_WITH_STUDENTS", "SHARE_MANAGE",
    "FIELD_VIDEO_CHECKING", "FIELD_VIDEO_NOT_EMBEDDABLE_TITLE", "FIELD_VIDEO_NOT_EMBEDDABLE_DESC",
    "FIELD_VIDEO_OPEN_ON_PROVIDER",
    "DETAILS_WIZ_TITLE_H", "DETAILS_WIZ_TITLE_D", "DETAILS_WIZ_DESCRIPTION_H", "DETAILS_WIZ_DESCRIPTION_D",
    "DETAILS_WIZ_WHY_H", "DETAILS_WIZ_WHY_D", "DETAILS_WIZ_LANG_H", "DETAILS_WIZ_LANG_D",
    "DETAILS_WIZ_TAGS_H", "DETAILS_WIZ_TAGS_D", "DETAILS_WIZ_TOPICS_H", "DETAILS_WIZ_TOPICS_D",
    "DETAILS_WIZ_THUMBNAIL_D_VIDEO", "DETAILS_WIZ_THUMBNAIL_D_READING", "DETAILS_WIZ_THUMBNAIL_D_LISTENING",
    "DETAILS_WIZ_THUMBNAIL_H", "DETAILS_WIZ_VIDEO_H", "DETAILS_WIZ_VIDEO_D",
    "DETAILS_WIZ_PASSAGE_H", "DETAILS_WIZ_PASSAGE_D", "DETAILS_WIZ_AUDIO_H", "DETAILS_WIZ_AUDIO_D",
    "DETAILS_WIZ_PRICE_H", "DETAILS_WIZ_PRICE_D",
    "TYPE_VIDEO_QUIZ_LINK_ACTION",
    "GATEWAY_COL_MATERIALS", "GATEWAY_COL_BUNDLES",
    "GATEWAY_MATERIALS_COUNT_ONE", "GATEWAY_MATERIALS_COUNT_OTHER",
    "GATEWAY_VIEW_BUNDLES", "GATEWAY_BUNDLES_COUNT_ONE", "GATEWAY_BUNDLES_COUNT_OTHER",
    "BUNDLE_GATEWAY_CREATE_NEW", "BUNDLE_GATEWAY_CREATE_FIRST",
    "BUNDLE_GATEWAY_CREATE_NEW_DESC", "BUNDLE_GATEWAY_CREATE_FIRST_DESC",
    "LIBRARY_LIST_BACK", "LIBRARY_FOOTER_NEW_MATERIAL", "LIBRARY_FOOTER_NEW_BUNDLE",
    "LIBRARY_LIST_NEW_BUNDLE", "BUNDLE_CREATE_TITLE", "BUNDLE_EDIT_TITLE",
    "SAVE_DRAFT", "BUNDLE_SAVE_DRAFT", "DETAILS_WIZ_NEXT", "CONTINUE_TO_QUIZ",
    "SUBMIT_PUBLISH", "SUBMIT_SAVE",
    "FIELD_TAGS", "FIELD_TAGS_HINT", "FIELD_CUSTOM_TOPICS", "FIELD_CUSTOM_TOPICS_HINT",
    "FIELD_CUSTOM_TOPICS_PLACEHOLDER", "TAG_PICKER_SEARCH_PLACEHOLDER", "TAG_PICKER_MAX_TAGS",
    "QUIZ_OPTION_PLACEHOLDER", "QUIZ_ANSWER_PLACEHOLDER",
    "BUNDLE_WIZ_SHARE_FLOW_TITLE", "BUNDLE_WIZ_FLOW_TITLE", "BUNDLE_EDITING_BADGE",
    "LABEL_OPTIONAL", "BUNDLE_MATERIAL_QUESTIONS", "BUNDLE_PAID_IN_FREE_TITLE",
    "BUNDLE_PAID_IN_FREE_BODY",
    "BUNDLES_LIST_EMPTY_TITLE", "BUNDLES_LIST_EMPTY_DESC",
})

# All CREATE_MATERIAL keys with these prefixes are translated when missing or still English.
KEY_PREFIXES = ("BUNDLE_", "BUNDLE_WIZ_")


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
            deep_merge_missing(dst[k], v)  # type: ignore[arg-type]


def collect_wizard_guidance_recursive(
    en_node: dict[str, Any],
    loc_node: dict[str, Any],
    key_prefix: str,
    updates: dict[str, str],
) -> None:
    """Collect all string leaves under WIZARD_GUIDANCE (incl. nested BUNDLE.SHARE.*)."""
    for k, ev in en_node.items():
        full_key = f"{key_prefix}.{k}" if key_prefix else k
        if isinstance(ev, str) and ev.strip():
            lv = loc_node.get(k) if isinstance(loc_node, dict) else None
            if not isinstance(lv, str) or lv == ev:
                updates[full_key] = ev
        elif isinstance(ev, dict):
            if not isinstance(loc_node, dict):
                continue
            if k not in loc_node or not isinstance(loc_node.get(k), dict):
                loc_node[k] = {}
            collect_wizard_guidance_recursive(ev, loc_node[k], full_key, updates)


def collect_top_level(en_cm: dict[str, Any], loc_cm: dict[str, Any], updates: dict[str, str]) -> None:
    for k in TOP_LEVEL_KEYS:
        ev = en_cm.get(k)
        if isinstance(ev, str) and ev.strip():
            lv = loc_cm.get(k)
            if not isinstance(lv, str) or lv == ev:
                updates[k] = ev

    for k, ev in en_cm.items():
        if not any(k.startswith(p) for p in KEY_PREFIXES):
            continue
        if isinstance(ev, str) and ev.strip():
            lv = loc_cm.get(k)
            if not isinstance(lv, str) or lv == ev:
                updates[k] = ev


def set_by_path(branch: dict[str, Any], key_path: str, value: str) -> None:
    parts = key_path.split(".")
    cur = branch
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value


def translate_batch(translator: GoogleTranslator, texts: list[str]) -> list[str]:
    out: list[str] = []
    for i in range(0, len(texts), 12):
        batch = texts[i : i + 12]
        masked, holders = [], []
        for t in batch:
            m, h = mask_placeholders(t)
            masked.append(m)
            holders.append(h)
        for attempt in range(5):
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
                try:
                    out.append(unmask_placeholders(translator.translate(m), h))
                except TranslationNotFound:
                    out.append(unmask_placeholders(m, h))
                time.sleep(0.08)
        time.sleep(0.1)
    return out


def main() -> None:
    import sys

    only = set(sys.argv[1:]) if len(sys.argv) > 1 else None
    en = json.loads((I18N_DIR / "en.json").read_text(encoding="utf-8"))
    en_cm = en["CREATE_MATERIAL"]
    en_wg = en_cm.get("WIZARD_GUIDANCE", {})
    total = 0

    for path in sorted(I18N_DIR.glob("*.json")):
        stem = path.stem
        if stem == "en":
            continue
        if only is not None and stem not in only:
            continue
        gt = LANG_MAP[stem]

        data = json.loads(path.read_text(encoding="utf-8"))
        loc_cm = data.setdefault("CREATE_MATERIAL", {})
        if not isinstance(loc_cm, dict):
            loc_cm = {}
            data["CREATE_MATERIAL"] = loc_cm

        deep_merge_missing(loc_cm, en_cm)
        loc_wg = loc_cm.setdefault("WIZARD_GUIDANCE", {})
        if not isinstance(loc_wg, dict):
            loc_wg = {}
            loc_cm["WIZARD_GUIDANCE"] = loc_wg

        updates: dict[str, str] = {}
        collect_top_level(en_cm, loc_cm, updates)
        if isinstance(en_wg, dict):
            collect_wizard_guidance_recursive(en_wg, loc_wg, "WIZARD_GUIDANCE", updates)

        if "QUIZ_ADD_QUESTION" in en_cm:
            ev = en_cm["QUIZ_ADD_QUESTION"]
            lv = loc_cm.get("QUIZ_ADD_QUESTION")
            if not isinstance(lv, str) or lv == ev:
                updates["QUIZ_ADD_QUESTION"] = ev

        if not updates:
            print(f"[{stem}] skip (up to date)")
            continue

        translator = GoogleTranslator(source="en", target=gt)
        keys = list(updates.keys())
        translated = translate_batch(translator, [updates[k] for k in keys])
        for k, t in zip(keys, translated):
            set_by_path(loc_cm, k, t)

        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[{stem}] {len(keys)} keys", flush=True)
        total += len(keys)

    print(f"Done: {total} translations.")


if __name__ == "__main__":
    main()
