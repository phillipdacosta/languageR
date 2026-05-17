#!/usr/bin/env python3
"""Fix PRE_CALL MIC/CAMERA on/off strings mistranslated as prepositions."""
from __future__ import annotations

import json
from pathlib import Path

I18N = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

# mic (masc/neutral), camera (fem where grammar differs)
FIXES: dict[str, dict[str, str]] = {
    "fr": {
        "MIC_ON": "activé",
        "MIC_OFF": "désactivé",
        "CAMERA_ON": "activée",
        "CAMERA_OFF": "désactivée",
    },
    "pt": {
        "MIC_ON": "ligado",
        "MIC_OFF": "desligado",
        "CAMERA_ON": "ligada",
        "CAMERA_OFF": "desligada",
    },
    "it": {
        "MIC_ON": "acceso",
        "MIC_OFF": "spento",
        "CAMERA_ON": "accesa",
        "CAMERA_OFF": "spenta",
    },
    "pl": {
        "MIC_ON": "włączony",
        "MIC_OFF": "wyłączony",
        "CAMERA_ON": "włączona",
        "CAMERA_OFF": "wyłączona",
    },
    "cs": {
        "MIC_ON": "zapnuto",
        "MIC_OFF": "vypnuto",
        "CAMERA_ON": "zapnuto",
        "CAMERA_OFF": "vypnuto",
    },
    "ru": {
        "MIC_ON": "включён",
        "MIC_OFF": "выключен",
        "CAMERA_ON": "включена",
        "CAMERA_OFF": "выключена",
    },
    "ro": {
        "MIC_ON": "pornit",
        "MIC_OFF": "oprit",
        "CAMERA_ON": "pornită",
        "CAMERA_OFF": "oprită",
    },
    "vi": {
        "MIC_ON": "bật",
        "MIC_OFF": "tắt",
        "CAMERA_ON": "bật",
        "CAMERA_OFF": "tắt",
    },
    "id": {
        "MIC_ON": "aktif",
        "MIC_OFF": "mati",
        "CAMERA_ON": "aktif",
        "CAMERA_OFF": "mati",
    },
    "el": {
        "MIC_ON": "ενεργό",
        "MIC_OFF": "ανενεργό",
        "CAMERA_ON": "ενεργή",
        "CAMERA_OFF": "ανενεργή",
    },
    "ja": {
        "MIC_ON": "オン",
        "MIC_OFF": "オフ",
        "CAMERA_ON": "オン",
        "CAMERA_OFF": "オフ",
    },
    "ko": {
        "MIC_ON": "켜짐",
        "MIC_OFF": "꺼짐",
        "CAMERA_ON": "켜짐",
        "CAMERA_OFF": "꺼짐",
    },
    "zh": {
        "MIC_ON": "开启",
        "MIC_OFF": "关闭",
        "CAMERA_ON": "开启",
        "CAMERA_OFF": "关闭",
    },
    "th": {
        "MIC_ON": "เปิด",
        "MIC_OFF": "ปิด",
        "CAMERA_ON": "เปิด",
        "CAMERA_OFF": "ปิด",
    },
    "hi": {
        "MIC_ON": "चालू",
        "MIC_OFF": "बंद",
        "CAMERA_ON": "चालू",
        "CAMERA_OFF": "बंद",
    },
    "ar": {
        "MIC_ON": "مفعّل",
        "MIC_OFF": "معطّل",
        "CAMERA_ON": "مفعّلة",
        "CAMERA_OFF": "معطّلة",
    },
    "he": {
        "MIC_ON": "פועל",
        "MIC_OFF": "כבוי",
        "CAMERA_ON": "פועלת",
        "CAMERA_OFF": "כבויה",
    },
}


def main() -> None:
    for stem, keys in FIXES.items():
        path = I18N / f"{stem}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        pre = data.setdefault("PRE_CALL", {})
        for k, v in keys.items():
            pre[k] = v
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"fixed {stem}")


if __name__ == "__main__":
    main()
