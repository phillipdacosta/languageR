#!/usr/bin/env python3
"""Merge PROFILE_SCREEN timezone modal strings into all web + mobile locale JSON files."""

from __future__ import annotations

import json
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
WEB_I18N = APP_ROOT / "src" / "assets" / "i18n"
MOBILE_I18N = APP_ROOT.parent / "mobile" / "src" / "i18n" / "locales"

KEYS = (
    "TIMEZONE_MODAL_TITLE",
    "TIMEZONE_MODAL_DESC",
    "TIMEZONE_MODAL_CURRENT",
    "TIMEZONE_SEARCH_PLACEHOLDER",
)

LOCALE_STRINGS: dict[str, dict[str, str]] = {
    "ar": {
        "TIMEZONE_MODAL_TITLE": "اختر المنطقة الزمنية",
        "TIMEZONE_MODAL_DESC": "اختر المنطقة الزمنية المستخدمة لأوقات الدروس والتقويمات.",
        "TIMEZONE_MODAL_CURRENT": "الحالية: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "ابحث عن المناطق الزمنية...",
    },
    "cs": {
        "TIMEZONE_MODAL_TITLE": "Vyberte časové pásmo",
        "TIMEZONE_MODAL_DESC": "Zvolte časové pásmo pro časy lekcí a kalendáře.",
        "TIMEZONE_MODAL_CURRENT": "Aktuální: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Hledat časová pásma...",
    },
    "da": {
        "TIMEZONE_MODAL_TITLE": "Vælg tidszone",
        "TIMEZONE_MODAL_DESC": "Vælg den tidszone, der bruges til lektionstider og kalendere.",
        "TIMEZONE_MODAL_CURRENT": "Aktuel: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Søg efter tidszoner...",
    },
    "de": {
        "TIMEZONE_MODAL_TITLE": "Zeitzone auswählen",
        "TIMEZONE_MODAL_DESC": "Wählen Sie die Zeitzone für Lektionszeiten und Kalender.",
        "TIMEZONE_MODAL_CURRENT": "Aktuell: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Zeitzonen durchsuchen...",
    },
    "el": {
        "TIMEZONE_MODAL_TITLE": "Επιλέξτε ζώνη ώρας",
        "TIMEZONE_MODAL_DESC": "Επιλέξτε τη ζώνη ώρας για τους χρόνους μαθημάτων και τα ημερολόγια.",
        "TIMEZONE_MODAL_CURRENT": "Τρέχουσα: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Αναζήτηση ζωνών ώρας...",
    },
    "es": {
        "TIMEZONE_MODAL_TITLE": "Seleccionar zona horaria",
        "TIMEZONE_MODAL_DESC": "Elige la zona horaria para los horarios de las clases y los calendarios.",
        "TIMEZONE_MODAL_CURRENT": "Actual: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Buscar zonas horarias...",
    },
    "fa": {
        "TIMEZONE_MODAL_TITLE": "انتخاب منطقه زمانی",
        "TIMEZONE_MODAL_DESC": "منطقه زمانی را برای زمان‌های درس و تقویم‌ها انتخاب کنید.",
        "TIMEZONE_MODAL_CURRENT": "فعلی: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "جستجوی مناطق زمانی...",
    },
    "fi": {
        "TIMEZONE_MODAL_TITLE": "Valitse aikavyöhyke",
        "TIMEZONE_MODAL_DESC": "Valitse aikavyöhyke oppituntien aikoja ja kalentereita varten.",
        "TIMEZONE_MODAL_CURRENT": "Nykyinen: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Hae aikavyöhykkeitä...",
    },
    "fr": {
        "TIMEZONE_MODAL_TITLE": "Sélectionner le fuseau horaire",
        "TIMEZONE_MODAL_DESC": "Choisissez le fuseau horaire pour les horaires des cours et les calendriers.",
        "TIMEZONE_MODAL_CURRENT": "Actuel : {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Rechercher des fuseaux horaires...",
    },
    "he": {
        "TIMEZONE_MODAL_TITLE": "בחר אזור זמן",
        "TIMEZONE_MODAL_DESC": "בחר את אזור הזמן עבור מועדי השיעורים והיומנים.",
        "TIMEZONE_MODAL_CURRENT": "נוכחי: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "חפש אזורי זמן...",
    },
    "hi": {
        "TIMEZONE_MODAL_TITLE": "समय क्षेत्र चुनें",
        "TIMEZONE_MODAL_DESC": "पाठ समय और कैलेंडर के लिए उपयोग किया जाने वाला समय क्षेत्र चुनें।",
        "TIMEZONE_MODAL_CURRENT": "वर्तमान: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "समय क्षेत्र खोजें...",
    },
    "id": {
        "TIMEZONE_MODAL_TITLE": "Pilih zona waktu",
        "TIMEZONE_MODAL_DESC": "Pilih zona waktu untuk jadwal pelajaran dan kalender.",
        "TIMEZONE_MODAL_CURRENT": "Saat ini: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Cari zona waktu...",
    },
    "it": {
        "TIMEZONE_MODAL_TITLE": "Seleziona fuso orario",
        "TIMEZONE_MODAL_DESC": "Scegli il fuso orario per gli orari delle lezioni e i calendari.",
        "TIMEZONE_MODAL_CURRENT": "Attuale: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Cerca fusi orari...",
    },
    "ja": {
        "TIMEZONE_MODAL_TITLE": "タイムゾーンを選択",
        "TIMEZONE_MODAL_DESC": "レッスン時間とカレンダーに使うタイムゾーンを選びます。",
        "TIMEZONE_MODAL_CURRENT": "現在: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "タイムゾーンを検索...",
    },
    "ko": {
        "TIMEZONE_MODAL_TITLE": "시간대 선택",
        "TIMEZONE_MODAL_DESC": "수업 시간과 캘린더에 사용할 시간대를 선택하세요.",
        "TIMEZONE_MODAL_CURRENT": "현재: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "시간대 검색...",
    },
    "ms": {
        "TIMEZONE_MODAL_TITLE": "Pilih zon masa",
        "TIMEZONE_MODAL_DESC": "Pilih zon masa untuk masa pelajaran dan kalendar.",
        "TIMEZONE_MODAL_CURRENT": "Semasa: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Cari zon masa...",
    },
    "nl": {
        "TIMEZONE_MODAL_TITLE": "Tijdzone selecteren",
        "TIMEZONE_MODAL_DESC": "Kies de tijdzone voor lestijden en agenda's.",
        "TIMEZONE_MODAL_CURRENT": "Huidig: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Zoek tijdzones...",
    },
    "no": {
        "TIMEZONE_MODAL_TITLE": "Velg tidssone",
        "TIMEZONE_MODAL_DESC": "Velg tidssonen som brukes til leksjonstider og kalendere.",
        "TIMEZONE_MODAL_CURRENT": "Nåværende: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Søk etter tidssoner...",
    },
    "pl": {
        "TIMEZONE_MODAL_TITLE": "Wybierz strefę czasową",
        "TIMEZONE_MODAL_DESC": "Wybierz strefę czasową dla godzin lekcji i kalendarzy.",
        "TIMEZONE_MODAL_CURRENT": "Bieżąca: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Szukaj stref czasowych...",
    },
    "pt": {
        "TIMEZONE_MODAL_TITLE": "Selecionar fuso horário",
        "TIMEZONE_MODAL_DESC": "Escolha o fuso horário usado para os horários das aulas e calendários.",
        "TIMEZONE_MODAL_CURRENT": "Atual: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Pesquisar fusos horários...",
    },
    "ro": {
        "TIMEZONE_MODAL_TITLE": "Selectează fusul orar",
        "TIMEZONE_MODAL_DESC": "Alege fusul orar pentru orele lecțiilor și calendare.",
        "TIMEZONE_MODAL_CURRENT": "Actual: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Caută fusuri orare...",
    },
    "ru": {
        "TIMEZONE_MODAL_TITLE": "Выберите часовой пояс",
        "TIMEZONE_MODAL_DESC": "Выберите часовой пояс для времени уроков и календарей.",
        "TIMEZONE_MODAL_CURRENT": "Текущий: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Искать часовые пояса...",
    },
    "sv": {
        "TIMEZONE_MODAL_TITLE": "Välj tidszon",
        "TIMEZONE_MODAL_DESC": "Välj tidszon för lektionstider och kalendrar.",
        "TIMEZONE_MODAL_CURRENT": "Nuvarande: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Sök tidszoner...",
    },
    "th": {
        "TIMEZONE_MODAL_TITLE": "เลือกเขตเวลา",
        "TIMEZONE_MODAL_DESC": "เลือกเขตเวลาสำหรับเวลาเรียนและปฏิทิน",
        "TIMEZONE_MODAL_CURRENT": "ปัจจุบัน: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "ค้นหาเขตเวลา...",
    },
    "tr": {
        "TIMEZONE_MODAL_TITLE": "Saat dilimini seçin",
        "TIMEZONE_MODAL_DESC": "Ders saatleri ve takvimler için kullanılan saat dilimini seçin.",
        "TIMEZONE_MODAL_CURRENT": "Şu anki: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Saat dilimlerinde ara...",
    },
    "uk": {
        "TIMEZONE_MODAL_TITLE": "Виберіть часовий пояс",
        "TIMEZONE_MODAL_DESC": "Оберіть часовий пояс для часу уроків і календарів.",
        "TIMEZONE_MODAL_CURRENT": "Поточний: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Шукати часові пояси...",
    },
    "vi": {
        "TIMEZONE_MODAL_TITLE": "Chọn múi giờ",
        "TIMEZONE_MODAL_DESC": "Chọn múi giờ dùng cho giờ học và lịch.",
        "TIMEZONE_MODAL_CURRENT": "Hiện tại: {{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "Tìm múi giờ...",
    },
    "zh": {
        "TIMEZONE_MODAL_TITLE": "选择时区",
        "TIMEZONE_MODAL_DESC": "选择用于课程时间和日历的时区。",
        "TIMEZONE_MODAL_CURRENT": "当前：{{value}}",
        "TIMEZONE_SEARCH_PLACEHOLDER": "搜索时区...",
    },
}


def merge_into_profile_screen(path: Path, strings: dict[str, str]) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    ps = data.get("PROFILE_SCREEN")
    if not isinstance(ps, dict):
        raise SystemExit(f"{path}: missing PROFILE_SCREEN object")
    for k in KEYS:
        if k not in strings:
            raise SystemExit(f"{path}: missing key {k}")
        ps[k] = strings[k]
    data["PROFILE_SCREEN"] = ps
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    en_src = json.loads((WEB_I18N / "en.json").read_text(encoding="utf-8"))["PROFILE_SCREEN"]
    en_bundle = {k: en_src[k] for k in KEYS}

    for path in sorted(WEB_I18N.glob("*.json")):
        code = path.stem
        strings = en_bundle if code == "en" else LOCALE_STRINGS.get(code, en_bundle)
        merge_into_profile_screen(path, strings)
        print("web", code)

    if MOBILE_I18N.is_dir():
        for path in sorted(MOBILE_I18N.glob("*.json")):
            code = path.stem
            strings = en_bundle if code == "en" else LOCALE_STRINGS.get(code, en_bundle)
            merge_into_profile_screen(path, strings)
            print("mobile", code)

    print("done — timezone modal PROFILE_SCREEN keys in all locales (web + mobile)")


if __name__ == "__main__":
    main()
