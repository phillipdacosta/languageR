#!/usr/bin/env python3
"""Merge VIDEO_CALL into en.json, translate all locales, patch HTML template."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from deep_translator import GoogleTranslator

from video_call_i18n_data import VIDEO_CALL_EN

ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = ROOT / "src" / "assets" / "i18n"
HTML_PATH = ROOT / "src" / "app" / "video-call" / "video-call.page.html"

LANG_MAP = {
    "ar": "ar", "cs": "cs", "da": "da", "de": "de", "el": "el", "es": "es",
    "fa": "fa", "fi": "fi", "fr": "fr", "he": "iw", "hi": "hi", "id": "id",
    "it": "it", "ja": "ja", "ko": "ko", "ms": "ms", "nl": "nl", "no": "no",
    "pl": "pl", "pt": "pt", "ro": "ro", "ru": "ru", "sv": "sv", "th": "th",
    "tr": "tr", "uk": "uk", "vi": "vi", "zh": "zh-CN",
}

PH_RE = re.compile(r"\{\{[^}]+\}\}")
LEAK_MARKERS = (
    "Label UI", "UI-etikett", "UI-etiket", "UI-label", "UI-Label",
    "Etykieta interfejsu", "Etichetă UI", "Étiquette d'interface",
    "kullanıcı arayüzü", "Sprachlern-App", "aplik pembelajaran",
    "Terjemah ke", "Terjemahkan ke", "Translate to", "Traduire en",
    "Oversett til", "Oversæt til", "Przetłumacz",
)

HTML_REPLACEMENTS: list[tuple[str, str]] = [
    (">Leaving...<", ">{{ 'VIDEO_CALL.LEAVING' | translate }}<"),
    (">Over booked time<", ">{{ 'VIDEO_CALL.OVER_BOOKED_TIME' | translate }}<"),
    (
        "Your next lesson starts in {{ getNextEventDisplayTime() }}",
        "{{ 'VIDEO_CALL.NEXT_LESSON_STARTS' | translate:{ time: nextLessonStartsText } }}",
    ),
    (">Whiteboard<", ">{{ 'VIDEO_CALL.WHITEBOARD' | translate }}<"),
    (">Loading whiteboard...<", ">{{ 'VIDEO_CALL.LOADING_WHITEBOARD' | translate }}<"),
    (">Whiteboard unavailable<", ">{{ 'VIDEO_CALL.WHITEBOARD_UNAVAILABLE' | translate }}<"),
    (">Retry<", ">{{ 'VIDEO_CALL.RETRY' | translate }}<"),
    (">Screen Sharing<", ">{{ 'VIDEO_CALL.SCREEN_SHARING' | translate }}<"),
    (">Stop Sharing<", ">{{ 'VIDEO_CALL.STOP_SHARING' | translate }}<"),
    (">You<", ">{{ 'VIDEO_CALL.YOU' | translate }}<"),
    ("'Participant'", "'VIDEO_CALL.PARTICIPANT' | translate"),
    (">Camera Off<", ">{{ 'VIDEO_CALL.CAMERA_OFF' | translate }}<"),
    (">Waiting for other participants...<", ">{{ 'VIDEO_CALL.WAITING_PARTICIPANTS' | translate }}<"),
    (">Waiting for tutor...<", ">{{ 'VIDEO_CALL.WAITING_TUTOR' | translate }}<"),
    ("'Tutor'", "'VIDEO_CALL.TUTOR' | translate"),
    ("Student wants:", "{{ 'VIDEO_CALL.STUDENT_WANTS' | translate }}"),
    (">Virtual Background<", ">{{ 'VIDEO_CALL.VIRTUAL_BACKGROUND' | translate }}<"),
    (">Enable Blur<", ">{{ 'VIDEO_CALL.ENABLE_BLUR' | translate }}<"),
    (">Black Background<", ">{{ 'VIDEO_CALL.BLACK_BACKGROUND' | translate }}<"),
    (">Normal<", ">{{ 'VIDEO_CALL.NORMAL' | translate }}<"),
    (">Virtual background active<", ">{{ 'VIDEO_CALL.VB_ACTIVE' | translate }}<"),
    ('Chat with {{ remoteParticipantLabel }}', "{{ 'VIDEO_CALL.CHAT_WITH' | translate:{ name: remoteParticipantLabel } }}"),
    (">Resources & Documents<", ">{{ 'VIDEO_CALL.RESOURCES_DOCUMENTS' | translate }}<"),
    (">Loading messages...<", ">{{ 'VIDEO_CALL.LOADING_MESSAGES' | translate }}<"),
    (">No messages yet<", ">{{ 'VIDEO_CALL.NO_MESSAGES_YET' | translate }}<"),
    (">Correction<", ">{{ 'VIDEO_CALL.CORRECTION' | translate }}<"),
    (">Reply<", ">{{ 'VIDEO_CALL.REPLY' | translate }}<"),
    (">Copy<", ">{{ 'VIDEO_CALL.COPY' | translate }}<"),
    (">📷 Photo<", ">{{ 'VIDEO_CALL.REPLY_PHOTO' | translate }}<"),
    (">📄 {{ message.replyTo.fileName }}<", ">{{ 'VIDEO_CALL.REPLY_FILE' | translate }} {{ message.replyTo.fileName }}<"),
    (">🎤 Voice message<", ">{{ 'VIDEO_CALL.REPLY_VOICE' | translate }}<"),
    (
        "Replying to {{ isMyMessage(replyingToMessage) ? 'yourself' : remoteParticipantLabel }}",
        "{{ 'VIDEO_CALL.REPLYING_TO' | translate:{ name: (isMyMessage(replyingToMessage) ? replyingToYourselfLabel : remoteParticipantLabel) } }}",
    ),
    ("Voice note {{ pendingVoiceNote.duration }}s", "{{ 'VIDEO_CALL.VOICE_NOTE' | translate:{ duration: pendingVoiceNote.duration } }}"),
    (">Discard<", ">{{ 'VIDEO_CALL.DISCARD' | translate }}<"),
    (">Send<", ">{{ 'VIDEO_CALL.SEND' | translate }}<"),
    (">Add Correction<", ">{{ 'VIDEO_CALL.ADD_CORRECTION' | translate }}<"),
    (">✗ What they said<", ">{{ 'VIDEO_CALL.WHAT_THEY_SAID' | translate }}<"),
    (">✓ Correct version<", ">{{ 'VIDEO_CALL.CORRECT_VERSION' | translate }}<"),
    ('placeholder="e.g. I go yesterday..."', '[placeholder]="\'VIDEO_CALL.CORRECTION_ORIGINAL_PLACEHOLDER\' | translate"'),
    ('placeholder="e.g. I went yesterday..."', '[placeholder]="\'VIDEO_CALL.CORRECTION_FIXED_PLACEHOLDER\' | translate"'),
    (">Send Correction<", ">{{ 'VIDEO_CALL.SEND_CORRECTION' | translate }}<"),
    ('placeholder="Write your message..."', '[placeholder]="\'VIDEO_CALL.WRITE_MESSAGE\' | translate"'),
    (">Uploading...<", ">{{ 'VIDEO_CALL.UPLOADING' | translate }}<"),
    ("Recording... {{formatRecordingDuration()}}", "{{ 'VIDEO_CALL.RECORDING' | translate:{ duration: recordingDurationLabel } }}"),
    (">Lesson Notes<", ">{{ 'VIDEO_CALL.LESSON_NOTES' | translate }}<"),
    (">Not visible to student at this time<", ">{{ 'VIDEO_CALL.NOT_VISIBLE_STUDENT' | translate }}<"),
    (">Quick Impression<", ">{{ 'VIDEO_CALL.QUICK_IMPRESSION' | translate }}<"),
    (">Strengths<", ">{{ 'VIDEO_CALL.STRENGTHS' | translate }}<"),
    (">Areas to Improve<", ">{{ 'VIDEO_CALL.AREAS_IMPROVE' | translate }}<"),
    (">Key Error Areas<", ">{{ 'VIDEO_CALL.KEY_ERROR_AREAS' | translate }}<"),
    (">Your Note<", ">{{ 'VIDEO_CALL.YOUR_NOTE' | translate }}<"),
    ('placeholder="Write your notes during the lesson..."', '[placeholder]="\'VIDEO_CALL.NOTE_PLACEHOLDER\' | translate"'),
    (">Homework (Optional)<", ">{{ 'VIDEO_CALL.HOMEWORK_OPTIONAL' | translate }}<"),
    ('placeholder="Suggest practice..."', '[placeholder]="\'VIDEO_CALL.HOMEWORK_PLACEHOLDER\' | translate"'),
    (">Saving...<", ">{{ 'VIDEO_CALL.SAVING' | translate }}<"),
    (">Saved<", ">{{ 'VIDEO_CALL.SAVED' | translate }}<"),
    (">Vocabulary<", ">{{ 'VIDEO_CALL.VOCABULARY' | translate }}<"),
    (">No words yet<", ">{{ 'VIDEO_CALL.NO_WORDS_YET' | translate }}<"),
    (">Add new vocabulary during the lesson<", ">{{ 'VIDEO_CALL.ADD_VOCAB_HINT' | translate }}<"),
    ('placeholder="Word or phrase"', '[placeholder]="\'VIDEO_CALL.WORD_OR_PHRASE\' | translate"'),
    ('placeholder="Translation"', '[placeholder]="\'VIDEO_CALL.TRANSLATION\' | translate"'),
    ('placeholder="Example sentence (optional)"', '[placeholder]="\'VIDEO_CALL.EXAMPLE_OPTIONAL\' | translate"'),
    (">Cancel<", ">{{ 'VIDEO_CALL.CANCEL' | translate }}<"),
    (">Add word<", ">{{ 'VIDEO_CALL.ADD_WORD' | translate }}<"),
    (">Lesson Goals<", ">{{ 'VIDEO_CALL.LESSON_GOALS' | translate }}<"),
    (">Optional<", ">{{ 'VIDEO_CALL.OPTIONAL' | translate }}<"),
    (">No goals set<", ">{{ 'VIDEO_CALL.NO_GOALS' | translate }}<"),
    (">Set goals to stay focused during the lesson<", ">{{ 'VIDEO_CALL.SET_GOALS_HINT' | translate }}<"),
    ('placeholder="What do you want to work on?"', '[placeholder]="\'VIDEO_CALL.GOAL_PLACEHOLDER\' | translate"'),
    (">Add goal<", ">{{ 'VIDEO_CALL.ADD_GOAL' | translate }}<"),
    ("{{ isMuted ? 'Unmute' : 'Mute' }}", "{{ (isMuted ? 'VIDEO_CALL.UNMUTE' : 'VIDEO_CALL.MUTE') | translate }}"),
    ("{{ isVideoOff ? 'Start Video' : 'Camera' }}", "{{ (isVideoOff ? 'VIDEO_CALL.START_VIDEO' : 'VIDEO_CALL.CAMERA') | translate }}"),
    ("{{ isScreenSharing ? 'Stop Share' : 'Share' }}", "{{ (isScreenSharing ? 'VIDEO_CALL.STOP_SHARE' : 'VIDEO_CALL.SHARE') | translate }}"),
    (">Chat<", ">{{ 'VIDEO_CALL.CHAT' | translate }}<"),
    (">More<", ">{{ 'VIDEO_CALL.MORE' | translate }}<"),
    ("{{ isEndingCall ? 'Leaving...' : 'Leave' }}", "{{ (isEndingCall ? 'VIDEO_CALL.LEAVING' : 'VIDEO_CALL.LEAVE') | translate }}"),
    (">Effects<", ">{{ 'VIDEO_CALL.EFFECTS' | translate }}<"),
    (">Goals<", ">{{ 'VIDEO_CALL.GOALS' | translate }}<"),
    (">Notes<", ">{{ 'VIDEO_CALL.NOTES' | translate }}<"),
    (">Speaking Time<", ">{{ 'VIDEO_CALL.SPEAKING_TIME' | translate }}<"),
    (">Tracking starts when lesson begins<", ">{{ 'VIDEO_CALL.TRACKING_STARTS' | translate }}<"),
]


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


def translate_one(translator: GoogleTranslator, text: str) -> str:
    masked, holders = mask(text)
    for attempt in range(6):
        try:
            out = unmask(translator.translate(masked), holders)
            if out and not is_leaked(out):
                return out
        except Exception:
            time.sleep(0.7 * (attempt + 1))
    return text


def merge_en() -> None:
    en_path = I18N_DIR / "en.json"
    data = json.loads(en_path.read_text(encoding="utf-8"))
    data["VIDEO_CALL"] = VIDEO_CALL_EN
    en_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Merged VIDEO_CALL into en.json", flush=True)


def translate_locales(only: list[str] | None = None) -> None:
    en_vc = VIDEO_CALL_EN
    for path in sorted(I18N_DIR.glob("*.json")):
        stem = path.stem
        if stem == "en" or (only and stem not in only):
            continue
        gt = LANG_MAP.get(stem)
        if not gt:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        vc = data.setdefault("VIDEO_CALL", {})
        todo = {k: v for k, v in en_vc.items() if vc.get(k) != v or is_leaked(str(vc.get(k, "")))}
        if not todo:
            print(f"{stem}: ok", flush=True)
            continue
        print(f"{stem}: {len(todo)} keys...", flush=True)
        translator = GoogleTranslator(source="en", target=gt)
        for k, en_text in todo.items():
            vc[k] = translate_one(translator, en_text)
            time.sleep(0.1)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{stem}: done", flush=True)


def patch_html() -> None:
    html = HTML_PATH.read_text(encoding="utf-8")
    for old, new in HTML_REPLACEMENTS:
        if old not in html:
            print(f"WARN missing in HTML: {old[:50]!r}", flush=True)
            continue
        html = html.replace(old, new)
    HTML_PATH.write_text(html, encoding="utf-8")
    print("Patched video-call.page.html", flush=True)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("all", "en"):
        merge_en()
    if cmd in ("all", "translate"):
        only = sys.argv[2:] if cmd == "translate" else None
        translate_locales(only or None)
    if cmd in ("all", "html"):
        patch_html()


if __name__ == "__main__":
    main()
