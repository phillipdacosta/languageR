#!/usr/bin/env python3
"""Inject EVENT_DETAILS.LESSON_SCREEN into web and mobile en.json (idempotent)."""
from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LESSON_SCREEN = {
    "BACK_ARIA": "Go back",
    "SIDEBAR_LESSON_DETAILS": "Lesson details",
    "SIDEBAR_CLASS_DETAILS": "Class details",
    "STAT_LESSON_ONE": "lesson",
    "STAT_LESSONS_MANY": "lessons",
    "GUEST_RATING": "guest rating",
    "DURATION": "duration",
    "STUDENTS": "students",
    "OFFICE_HOURS": "Office hours",
    "INSTANT_BOOKING": "Instant booking",
    "PAYMENT_METHOD": "Payment method",
    "ACTUAL_DURATION": "Actual duration",
    "FINAL_CHARGE": "Final charge",
    "DEFAULT_SUBJECT": "Language Lesson",
    "LAST_SESSION": "Last session",
    "RECOMMENDED_FOCUS": "Recommended focus",
    "FB_TUTOR_PENDING_SUB": "Leave feedback while the lesson is fresh",
    "FB_TUTOR_DONE_TITLE": "You already provided feedback!",
    "FB_TUTOR_DONE_SUB": "Submitted {{date}}",
    "FB_STUDENT_DONE_TITLE": "{{name}} provided feedback!",
    "FB_AWAITING_TITLE": "Awaiting feedback from {{name}}",
    "FB_AWAITING_SUB": "Your tutor's feedback will appear here once submitted",
    "NOTES": "Notes",
    "SCORE_GRAMMAR": "Grammar",
    "SCORE_FLUENCY": "Fluency",
    "SCORE_PRONUNCIATION": "Pronunciation",
    "SCORE_VOCABULARY": "Vocabulary",
    "PRACTICE_AREAS": "Practice these areas",
    "BASED_ON_RECENT": "Based on your recent lessons",
    "MATERIAL_SAVE": "Save",
    "MATERIAL_SAVED": "Saved",
    "MATERIAL_FREE": "Free",
    "FINDING_RECOMMENDATIONS": "Finding recommendations…",
    "TUTOR_NOTE": "Tutor note",
    "YOUR_FEEDBACK": "Your feedback",
    "YOUR_NOTE": "Your note",
    "STRENGTHS": "Strengths",
    "AREAS_TO_IMPROVE": "Areas to improve",
    "FB_STRUCTURED_NOTES": "Notes",
    "PROVIDED_META": "Provided {{date}}",
    "TUTOR_FEEDBACK": "Tutor feedback",
    "LOADING_FEEDBACK": "Loading feedback…",
    "CANCELLATION": "Cancellation",
    "CANCELLED_BY": "Cancelled by",
    "REASON": "Reason",
    "DATE": "Date",
    "LATE_CANCEL_TAG": "Late cancellation — fee may apply",
    "ISSUE_REPORTED": "Issue reported",
    "TYPE": "Type",
    "DETAILS": "Details",
    "REPORTED": "Reported",
    "UNDER_INVESTIGATION": "Under investigation",
    "RESCHEDULE_PROPOSAL": "Reschedule proposal",
    "STATUS": "Status",
    "PROPOSED_TIME": "Proposed time",
    "LEARNING_PLAN": "Learning Plan",
    "GOAL": "Goal",
    "PHASE": "Phase",
    "FOCUS": "Focus",
    "LEARNING_MATERIALS": "Learning Materials",
    "MATERIALS_COUNT": "{{count}} available",
    "TUTOR_LABEL": "Tutor:",
    "ROLE_TUTOR_SUFFIX": "tutor",
    "GROUP_CLASS": "Group class",
    "CLASS_DEFAULT_ALT": "Class",
    "CLASS_ABOUT": "About this class",
    "CLASS_STUDENTS_HEADING": "Students",
    "CLASS_PAID": "Paid",
    "CLASS_PENDING": "Pending",
    "CLASS_NO_STUDENTS_PAST": "No students enrolled",
    "CLASS_NO_STUDENTS_YET": "No students enrolled yet",
    "CLASS_CANCEL_MINIMUM": "Minimum enrollment not met",
    "REVENUE": "Revenue",
    "REVENUE_PAID_META": "{{paid}} of {{total}} students paid",
    "SESSIONS_COUNT": "{{count}} sessions",
    "REBOOK": "Rebook",
    "MESSAGE": "Message",
    "RESCHEDULE_OR_CANCEL": "Reschedule or cancel",
    "BTN_RESCHEDULE": "Reschedule",
    "BTN_CANCEL_CLASS": "Cancel class",
    "NO_CANCEL_REASON": "No reason provided",
    "ROLE_TUTOR": "Tutor",
    "ROLE_STUDENT": "Student",
    "ROLE_SYSTEM": "System",
    "ROLE_ADMIN": "Admin",
    "ROLE_UNKNOWN": "Unknown",
    "RESOLVED": "Resolved",
    "RESOLUTION_NO_ISSUE": "Resolved — No issue found",
    "RESOLUTION_REFUNDED": "Resolved — Refunded",
    "RESOLUTION_PARTIAL": "Resolved — Partially refunded",
    "RESOLUTION_NO_ACTION": "Resolved — No action taken",
    "ISSUE_FALLBACK": "Issue reported",
    "AWAITING_FEEDBACK_TITLE": "Awaiting tutor feedback",
    "AWAITING_FEEDBACK_SUB": "Your tutor hasn't submitted feedback yet",
    "ANALYSIS_GENERATING_TITLE": "Generating analysis",
    "ANALYSIS_GENERATING_SUB": "Your lesson analysis is being prepared…",
    "ANALYSIS_UNAVAILABLE_TITLE": "Analysis unavailable",
    "ANALYSIS_UNAVAILABLE_SUB": "We couldn't generate an analysis for this lesson",
    "ANALYSIS_UNAVAILABLE_BODY": "No analysis available for this lesson. This can happen when audio wasn't captured or there wasn't enough speech detected.",
    "FB_TUTOR_PENDING_TITLE": "Feedback outstanding",
    "VIEW_FULL_ANALYSIS": "View full analysis →",
    "LOADING_ANALYSIS": "Loading analysis…",
    "PER_STUDENT": "per student",
    "CLASS_BADGE": "Class",
    "PUBLIC": "Public",
    "LEVEL": "Level",
    "LEAVE_CLASS": "Leave class",
    "GO_BACK": "Go back",
    "YOUR_TUTOR_BADGE": "Your tutor",
    "TUTOR_DISPLAY_FALLBACK": "Your tutor",
    "ROLE_STUDENT_SUFFIX": "student",
    "TOPICS_COVERED": "Topics covered",
    "AREAS_FOR_IMPROVEMENT": "Areas for improvement",
}


def inject(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    ed = data.setdefault("EVENT_DETAILS", {})
    ed["LESSON_SCREEN"] = deepcopy(LESSON_SCREEN)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    inject(ROOT / "language-learning-app" / "src" / "assets" / "i18n" / "en.json")
    inject(ROOT / "mobile" / "src" / "i18n" / "locales" / "en.json")
    print("Injected EVENT_DETAILS.LESSON_SCREEN into web + mobile en.json")


if __name__ == "__main__":
    main()
