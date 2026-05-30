#!/usr/bin/env python3
"""Fix VIDEO_CALL screen-share button labels (SHARE / STOP_SHARE / STOP_SHARING)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = ROOT / "src" / "assets" / "i18n"

# Curated short labels for the screen-share control (not generic "share/stock").
LOCALES: dict[str, dict[str, str]] = {
    "de": {
        "SHARE": "Freigeben",
        "STOP_SHARE": "Freigabe beenden",
        "STOP_SHARING": "Freigabe beenden",
    },
    "es": {
        "SHARE": "Compartir pantalla",
        "STOP_SHARE": "Dejar de compartir",
        "STOP_SHARING": "Dejar de compartir",
    },
    "fr": {
        "SHARE": "Partager l'écran",
        "STOP_SHARE": "Arrêter le partage",
        "STOP_SHARING": "Arrêter le partage",
    },
    "pt": {
        "SHARE": "Compartilhar tela",
        "STOP_SHARE": "Parar compartilhamento",
        "STOP_SHARING": "Parar compartilhamento",
    },
    "it": {
        "SHARE": "Condividi schermo",
        "STOP_SHARE": "Interrompi condivisione",
        "STOP_SHARING": "Interrompi condivisione",
    },
    "nl": {
        "SHARE": "Scherm delen",
        "STOP_SHARE": "Stop met delen",
        "STOP_SHARING": "Stop met delen",
    },
    "pl": {
        "SHARE": "Udostępnij ekran",
        "STOP_SHARE": "Zatrzymaj udostępnianie",
        "STOP_SHARING": "Zatrzymaj udostępnianie",
    },
    "cs": {
        "SHARE": "Sdílet obrazovku",
        "STOP_SHARE": "Zastavit sdílení",
        "STOP_SHARING": "Zastavit sdílení",
    },
    "ro": {
        "SHARE": "Partajează ecranul",
        "STOP_SHARE": "Oprește partajarea",
        "STOP_SHARING": "Oprește partajarea",
    },
    "ru": {
        "SHARE": "Поделиться экраном",
        "STOP_SHARE": "Остановить демонстрацию",
        "STOP_SHARING": "Остановить демонстрацию",
    },
    "uk": {
        "SHARE": "Поділитися екраном",
        "STOP_SHARE": "Зупинити демонстрацію",
        "STOP_SHARING": "Зупинити демонстрацію",
    },
    "el": {
        "SHARE": "Κοινοποίηση οθόνης",
        "STOP_SHARE": "Διακοπή κοινοποίησης",
        "STOP_SHARING": "Διακοπή κοινοποίησης",
    },
    "tr": {
        "SHARE": "Ekranı paylaş",
        "STOP_SHARE": "Paylaşımı durdur",
        "STOP_SHARING": "Paylaşımı durdur",
    },
    "sv": {
        "SHARE": "Dela skärm",
        "STOP_SHARE": "Sluta dela",
        "STOP_SHARING": "Sluta dela",
    },
    "no": {
        "SHARE": "Del skjerm",
        "STOP_SHARE": "Stopp deling",
        "STOP_SHARING": "Stopp deling",
    },
    "da": {
        "SHARE": "Del skærm",
        "STOP_SHARE": "Stop deling",
        "STOP_SHARING": "Stop deling",
    },
    "fi": {
        "SHARE": "Jaa näyttö",
        "STOP_SHARE": "Lopeta jakaminen",
        "STOP_SHARING": "Lopeta jakaminen",
    },
    "ja": {
        "SHARE": "画面共有",
        "STOP_SHARE": "共有を停止",
        "STOP_SHARING": "共有を停止",
    },
    "ko": {
        "SHARE": "화면 공유",
        "STOP_SHARE": "공유 중지",
        "STOP_SHARING": "공유 중지",
    },
    "zh": {
        "SHARE": "共享屏幕",
        "STOP_SHARE": "停止共享",
        "STOP_SHARING": "停止共享",
    },
    "ar": {
        "SHARE": "مشاركة الشاشة",
        "STOP_SHARE": "إيقاف المشاركة",
        "STOP_SHARING": "إيقاف المشاركة",
    },
    "he": {
        "SHARE": "שיתוף מסך",
        "STOP_SHARE": "הפסק שיתוף",
        "STOP_SHARING": "הפסק שיתוף",
    },
    "fa": {
        "SHARE": "اشتراک‌گذاری صفحه",
        "STOP_SHARE": "توقف اشتراک‌گذاری",
        "STOP_SHARING": "توقف اشتراک‌گذاری",
    },
    "hi": {
        "SHARE": "स्क्रीन साझा करें",
        "STOP_SHARE": "साझा करना बंद करें",
        "STOP_SHARING": "साझा करना बंद करें",
    },
    "th": {
        "SHARE": "แชร์หน้าจอ",
        "STOP_SHARE": "หยุดแชร์",
        "STOP_SHARING": "หยุดแชร์",
    },
    "vi": {
        "SHARE": "Chia sẻ màn hình",
        "STOP_SHARE": "Dừng chia sẻ",
        "STOP_SHARING": "Dừng chia sẻ",
    },
    "id": {
        "SHARE": "Bagikan layar",
        "STOP_SHARE": "Berhenti berbagi",
        "STOP_SHARING": "Berhenti berbagi",
    },
    "ms": {
        "SHARE": "Kongsi skrin",
        "STOP_SHARE": "Berhenti kongsi",
        "STOP_SHARING": "Berhenti kongsi",
    },
}


def main() -> None:
    updated = 0
    for code, keys in LOCALES.items():
        path = I18N_DIR / f"{code}.json"
        if not path.exists():
            print(f"skip missing {path}")
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        vc = data.get("VIDEO_CALL")
        if not isinstance(vc, dict):
            print(f"skip no VIDEO_CALL in {code}")
            continue
        for k, v in keys.items():
            if vc.get(k) != v:
                vc[k] = v
                updated += 1
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"ok {code}")
    print(f"patched {updated} keys across {len(LOCALES)} locales")


if __name__ == "__main__":
    main()
