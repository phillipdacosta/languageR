# Disabled Features - Tutor Feedback System

This document tracks features that have been temporarily disabled but preserved in code for potential future use.

## Status: DISABLED ❌
**Date Disabled:** December 29, 2025  
**Reason:** AI analysis is now mandatory. Tutor feedback system was built as a fallback for when students disabled AI, but this created complexity and lower-quality feedback.

---

## What Was Disabled

### 1. **AI Analysis Toggle** (Student Settings)
**Files Modified:**
- `language-learning-app/src/app/profile/profile.page.html` (lines ~278-285)

**What It Did:**
- Allowed students to disable AI analysis in their profile settings
- When disabled, tutors were required to provide manual feedback instead

**Why Disabled:**
- AI analysis is core to the app's value proposition
- Manual tutor feedback cannot match AI quality/detail
- Creates support burden ("why isn't my progress working?")
- Tutors may rush through feedback or forget

---

### 2. **Tutor Feedback Creation** (Backend)
**Files Modified:**
- `backend/routes/lessons.js` (lines ~2004-2079)

**What It Did:**
- Checked if student had `aiAnalysisEnabled: false`
- Created `TutorFeedback` record when AI was disabled
- Sent notifications to tutor to provide feedback
- Emitted WebSocket `feedback_required` event

**Why Disabled:**
- No longer checking `aiAnalysisEnabled` setting
- AI analysis now generated for all completed lessons
- Tutor feedback system bypassed entirely

---

### 3. **Feedback UI (Frontend)**
**Files Modified:**
- `language-learning-app/src/app/tab1/tab1.page.html` (lines ~166-241)

**What It Did:**
- Displayed "Feedback Needed" section on tutor home page
- Showed pending feedback count and list
- "Test Feedback Form" button for development
- Debug card showing feedback status

**Why Disabled:**
- No feedback records created anymore
- UI would always show zero pending feedback
- Clutters the home page unnecessarily

---

### 4. **Feedback Loading Logic (Frontend)**
**Files Modified:**
- `language-learning-app/src/app/tab1/tab1.page.ts` (lines ~959-965)

**What It Did:**
- Called `loadPendingFeedback()` when tutor viewed home page
- Fetched pending feedback from `/api/tutor-feedback/pending`
- Triggered feedback alert if pending items existed

**Why Disabled:**
- No feedback created = no need to load
- Prevents unnecessary API calls

---

### 5. **Feedback WebSocket Listeners**
**Files Modified:**
- `language-learning-app/src/app/tab1/tab1.page.ts` (lines ~837-848)
- `language-learning-app/src/app/video-call/video-call.page.ts` (lines ~3029-3050)
- `language-learning-app/src/app/app.component.ts` (lines ~237-245)

**What It Did:**
- Listened for `feedback_required` WebSocket events
- Showed alerts/toasts to tutors when feedback was needed
- Updated pending feedback count in real-time

**Why Disabled:**
- `feedback_required` events no longer emitted
- No feedback prompts needed

---

## Code Preserved

All disabled code is wrapped in comments:

```typescript
/* 
TEMPORARILY DISABLED: [Feature Name]
TODO: Re-enable if we want to support AI-disabled mode

// ... original code ...
*/
```

This makes it easy to:
1. **Find disabled features:** Search for `TEMPORARILY DISABLED`
2. **Understand context:** Comments explain what was disabled and why
3. **Re-enable if needed:** Uncomment the blocks

---

## Related Systems Still Active

### ✅ **Still Working:**
- AI analysis generation (always runs)
- Transcription service (Whisper)
- Audio backup to GCS (48-hour retention)
- Retry system for Whisper/GPT failures
- Progress tracking and SERF scores
- Lesson analysis display for students

### ❌ **No Longer Active:**
- Student profile toggle for AI analysis
- Tutor feedback creation
- Tutor feedback form/page
- Feedback notifications
- Feedback WebSocket events

---

## Database Impact

### **Models Still Exist But Unused:**
- `TutorFeedback` model (backend/models/TutorFeedback.js)
- `User.profile.aiAnalysisEnabled` field

### **Existing Data:**
- Old `TutorFeedback` records remain in database
- Can be cleaned up or left for historical purposes

---

## If You Need to Re-Enable

### **Step 1: Uncomment Backend Logic**
```bash
# Search for disabled code in backend
grep -r "TEMPORARILY DISABLED" backend/routes/lessons.js
```

Uncomment the section that checks `aiAnalysisEnabled` and creates `TutorFeedback` records.

### **Step 2: Uncomment Frontend UI**
```bash
# Search for disabled UI elements
grep -r "TEMPORARILY DISABLED" language-learning-app/src/app/
```

Uncomment:
- Profile toggle (profile.page.html)
- Feedback section (tab1.page.html)
- Loading logic (tab1.page.ts)
- WebSocket listeners (tab1.page.ts, video-call.page.ts, app.component.ts)

### **Step 3: Test Flow**
1. Student disables AI in profile
2. Student completes a lesson
3. Tutor receives feedback notification
4. Tutor provides feedback
5. Student sees tutor feedback (not AI analysis)

### **Step 4: Update Documentation**
- Remove this file or mark as "RE-ENABLED"
- Update any user-facing docs about AI analysis

---

## Alternative: Structured Feedback System

If re-enabling, consider implementing **structured dropdowns** instead of free-form text:

```typescript
{
  focusAreas: [
    "grammar.subjunctive",
    "pronunciation.r_sounds"
  ],
  ratings: {
    speaking: 4,
    grammar: 3,
    vocabulary: 4,
    listening: 5
  }
}
```

This provides:
- ✅ Trackable data
- ✅ Approximate SERF scores
- ✅ Prevents rushed/generic feedback
- ✅ Faster for tutors (2-3 min vs 10 min)

See conversation history for full design proposal.

---

## Questions?

If you need to understand why something was disabled or how to re-enable it, search for:
- `TEMPORARILY DISABLED` in code
- This file (`DISABLED_FEATURES.md`)
- Git history around December 29, 2025

