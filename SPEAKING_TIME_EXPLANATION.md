# Speaking Time / Study Time - Explanation & Fix

**Issue:** Speaking time showing as "0 m" for student `phillip.dacosta@gmail.com`

---

## What is "Speaking Time"?

**Speaking Time** (formerly labeled "Total Study Time") represents the **total amount of time the student actively spoke during their lessons**.

### How It's Calculated:

1. **During Analysis** (`backend/services/aiService.js`, line 787):
   ```javascript
   const estimatedMinutes = Math.ceil(studentSegments.length * 0.15);
   const speakingTimeMinutes = estimatedMinutes;
   ```

2. **What it measures:**
   - Counts the number of **student speech segments** (not tutor segments)
   - Estimates ~0.15 minutes (9 seconds) per segment
   - **This is the student's active speaking time, NOT total lesson duration**

3. **Stored in** `LessonAnalysis.progressionMetrics.speakingTimeMinutes`

4. **Displayed on Progress page:**
   - Main hero section: Total speaking time across all lessons
   - Milestone snapshots: Speaking time per 5-lesson milestone

---

## Why It Might Show "0 m"

### Possible Causes:

1. **Lessons completed before this field was added**
   - Old lessons don't have `progressionMetrics.speakingTimeMinutes`
   - Default value is `0` or `undefined`

2. **Analysis didn't complete properly**
   - If analysis failed or was interrupted
   - Field might not be populated

3. **Transcription has no student segments**
   - If transcription didn't capture student speech
   - Edge case, but possible

---

## How to Fix

### Option 1: Reanalyze Recent Lessons
For `phillip.dacosta@gmail.com`, you can reanalyze their recent lessons to populate the `speakingTimeMinutes` field.

### Option 2: Manual Check
Query the database to see if `speakingTimeMinutes` exists:
```javascript
db.lessonanalyses.find({
  studentId: ObjectId("...")
}).forEach(doc => {
  print(doc._id + ": " + (doc.progressionMetrics?.speakingTimeMinutes || "MISSING"));
});
```

### Option 3: Migration Script
Create a script to backfill speaking time for old analyses based on transcript segment count.

---

## UI Improvements Made

### 1. Label Changed:
- **Before:** "Total Study Time" (confusing - sounds like total lesson time)
- **After:** "Speaking Time" with sublabel "Your active practice"
- This makes it clear it's the student's speaking time, not total lesson duration

### 2. Example Display:
```
🔥 5 day
Streak
Consecutive days

2h 30m
Speaking Time
Your active practice
```

---

## Technical Details

### Data Flow:
1. **Transcription** → Segments captured (student vs tutor)
2. **AI Analysis** → Calculates `speakingTimeMinutes` from student segment count
3. **LessonAnalysis saved** → Stored in `progressionMetrics.speakingTimeMinutes`
4. **Progress page loads** → Sums up all `speakingTimeMinutes` values
5. **Display** → Formatted as "Xh Ym"

### Calculation Example:
- Lesson has 100 student segments
- Estimated time: `100 × 0.15 = 15 minutes`
- Stored as: `speakingTimeMinutes: 15`
- Displayed as: "15 m"

---

## Next Steps

To fix the "0 m" issue for `phillip.dacosta@gmail.com`:

1. Check if their lessons have `speakingTimeMinutes` populated
2. If missing, either:
   - Reanalyze recent lessons
   - Run a backfill script based on transcript data
3. Verify the field is being populated correctly for new lessons

---

**Status:** UI labels updated ✅  
**Issue:** Need to investigate why existing lessons show 0 minutes

