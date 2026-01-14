# GPT-4 Hallucinating Grammar Scores - Fix

**Date:** December 12, 2024  
**Lesson ID:** `693c7d25d29ca8a3e4e8406d`  
**Issue:** Contradictory grammar progress statements  
**Status:** ✅ FIXED

---

## 🐛 Problem

The lesson analysis showed **contradictory information** about grammar progress:

### What the UI Showed

1. **Grammar Accuracy Progress Card**: 
   - Last Session: **85%**
   - This Session: **92%**
   - Change: **+7%** ✅ (Correct)

2. **Progress Text** (red warning box):
   - "Grammar accuracy **declined** from **98%** to 92%. Made 1 agreement error compared to near-perfect performance last lesson." ❌ (Wrong)

### The Contradiction

- **Accurate data** (from `progressionMetrics`): Shows **improvement** from 85% → 92%
- **Hallucinated text** (from `progressFromLastLesson`): Says **decline** from 98% → 92%
- **GPT-4 invented** the "98%" number - it never existed

---

## 🔍 Root Cause Analysis

### Database Investigation

Queried the analysis for lesson `693c7d25d29ca8a3e4e8406d`:

```javascript
// CURRENT LESSON
Grammar Score: 92%
grammarAccuracyChange: +7

// PREVIOUS LESSON (from DB)
Previous Grammar Score: 85%
Previous Lesson Date: 2025-12-12T20:29:46.056Z

// ACTUAL CHANGE
85% → 92% = +7% improvement ✅
```

### The Hallucination

GPT-4 wrote in `overallAssessment.progressFromLastLesson`:
```
"Grammar accuracy declined from 98% to 92%. Made 1 agreement error..."
```

**Problems:**
1. ❌ Used "declined" when it should be "improved"
2. ❌ Invented "98%" (previous was actually 85%)
3. ❌ Got the direction completely wrong

### Why This Happened

Looking at `aiService.js`, the prompt provided GPT-4 with the correct data:

**Lines 867-880**: Previous lesson data is passed in the prompt:
```javascript
📊 PREVIOUS LESSON HISTORY (for progression tracking):

📌 MOST RECENT LESSON (12/12/2025):
- Proficiency Level: B2
- Grammar Accuracy: 85%     // ← CORRECT DATA PROVIDED
- Fluency Score: 80/100
- Error Rate: 1.5 errors/min
...
```

**But Line 1086** had a misleading hardcoded example:
```javascript
// OLD INSTRUCTION (Line 1086)
"Grammar accuracy declined from 98% to 85%. Made 3 agreement/tense errors..."
```

**The Problem:**
- GPT-4 was copying the **pattern** from the example
- It saw "declined from 98%" and **reused that phrasing**
- It **ignored** the actual numbers from the previous lesson data
- **Result**: Hallucinated "98%" instead of using the real "85%"

---

## ✅ Solution

### Fix #1: Remove Misleading Example

**File**: `backend/services/aiService.js` (Line 1084-1091)

**Before:**
```javascript
7. For progressFromLastLesson: 
   - If proficiency level is C2 AND current also shows C2, leave empty or state "Native speaker..."
   - **CRITICAL**: If previous level was C2 but current lesson shows errors, you MUST downgrade to C1 or B2 and explain: "Grammar accuracy declined from 98% to 85%..." // ❌ Bad example
```

**After:**
```javascript
7. For progressFromLastLesson: 
   - **CRITICAL**: You MUST use the EXACT grammar accuracy score from the "PREVIOUS LESSON HISTORY" section above. DO NOT make up or hallucinate previous scores.
   - **REQUIRED**: Calculate change using: (current grammarAnalysis.accuracyScore) - (previous lesson's Grammar Accuracy from history section)
   - **EXAMPLE**: If previous lesson shows "Grammar Accuracy: 85%" and current is 92%, write: "Grammar accuracy improved from 85% to 92%." NOT "declined from 98% to 92%"
```

**Key Changes:**
- ✅ Explicit instruction to use EXACT scores from previous lesson data
- ✅ Removed misleading hardcoded example with fake numbers
- ✅ Added correct example showing how to reference previous data
- ✅ Added "DO NOT hallucinate" warning

### Fix #2: Strengthen JSON Schema Description

**File**: `backend/services/aiService.js` (Line 1236)

**Before:**
```javascript
"progressFromLastLesson": "string - For C2 (native) speakers: leave empty... Otherwise: MUST include specific metrics with numbers. Good: 'Grammar accuracy improved from 70% to 75%'"
```

**After:**
```javascript
"progressFromLastLesson": "string - **CRITICAL**: Use EXACT scores from PREVIOUS LESSON HISTORY above, DO NOT hallucinate numbers. ... Good: 'Grammar accuracy improved from 85% to 92%' (using exact previous score). Bad: 'Grammar accuracy declined from 98% to 92%' (when previous was actually 85%)..."
```

**Key Changes:**
- ✅ Added "DO NOT hallucinate numbers" at the beginning
- ✅ Added explicit bad example showing the exact mistake GPT-4 made
- ✅ Emphasized using "EXACT scores from PREVIOUS LESSON HISTORY"

---

## 🎯 How The Fix Works

### New Flow

1. **AI Service provides previous lesson data** (Lines 867-880):
   ```
   📌 MOST RECENT LESSON:
   - Grammar Accuracy: 85%
   ```

2. **GPT-4 receives instruction** (Line 1084):
   ```
   You MUST use the EXACT grammar accuracy score from the "PREVIOUS LESSON HISTORY" section above
   ```

3. **GPT-4 calculates**:
   ```
   Previous: 85% (from PREVIOUS LESSON HISTORY)
   Current: 92% (from current analysis)
   Change: 92 - 85 = +7%
   Direction: Improved
   ```

4. **GPT-4 writes**:
   ```
   "Grammar accuracy improved from 85% to 92%"
   ```

5. **Result**: Accurate, non-hallucinated progress text ✅

---

## 📊 Impact

### Before Fix
- ❌ GPT-4 copied patterns from hardcoded examples
- ❌ Hallucinated previous scores (e.g., "98%" when it was "85%")
- ❌ Got improvement direction wrong (said "declined" when it improved)
- ❌ Contradicted the accurate numerical data in `progressionMetrics`
- ❌ Confused students with conflicting information

### After Fix
- ✅ GPT-4 must reference actual previous lesson data
- ✅ Uses exact scores from database
- ✅ Correctly identifies improvement vs. decline
- ✅ Consistent with numerical metrics
- ✅ Accurate, trustworthy feedback for students

---

## 🧪 Testing

### Test Case 1: Improvement
**Scenario:** Previous 75%, Current 85%
- **Expected:** "Grammar accuracy improved from 75% to 85%"
- **Should NOT say:** "declined from 90% to 85%" or any hallucinated number

### Test Case 2: Decline
**Scenario:** Previous 95%, Current 88%
- **Expected:** "Grammar accuracy declined from 95% to 88%"
- **Should NOT say:** "declined from 98% to 88%" (wrong previous score)

### Test Case 3: First Lesson
**Scenario:** No previous lesson
- **Expected:** "First analyzed lesson - baseline established at B2 level with 82% grammar accuracy."
- **Should NOT:** Reference any previous scores

### Test Case 4: Native Speaker (C2)
**Scenario:** Previous C2 (98%), Current C2 (98%), 0 errors
- **Expected:** "Native speaker - comparisons not applicable" or empty
- **Should NOT:** Compare scores unnecessarily

---

## 🔍 Related Issues

### Why `progressionMetrics.grammarAccuracyChange` Was Correct

The `grammarAccuracyChange` field is calculated by the **AI Service code** (not GPT-4), which:
1. Fetches previous analyses from database
2. Extracts previous `grammarAnalysis.accuracyScore`
3. Calculates: `current - previous`
4. Stores accurate numerical change

This is why the **"Grammar Accuracy Progress" card was correct** - it uses the code-calculated value, not GPT-4 generated text.

### Why `progressFromLastLesson` Was Wrong

The `progressFromLastLesson` is **prose text generated by GPT-4**, which:
1. Receives previous lesson data in prompt
2. Should reference those numbers
3. But was copying patterns from examples instead
4. **Hallucinated** numbers that matched the example pattern

---

## 📝 Key Learnings

1. **LLMs can hallucinate even with correct data in context**
   - GPT-4 had the right data (85%) but wrote the wrong number (98%)
   - Hardcoded examples in prompts can be copied verbatim

2. **Separate code-calculated vs. LLM-generated fields**
   - `grammarAccuracyChange: 7` ✅ (Code-calculated, reliable)
   - `progressFromLastLesson: "declined from 98%..."` ❌ (LLM-generated, unreliable)

3. **Explicit anti-hallucination instructions needed**
   - "DO NOT make up numbers" is not enough
   - Need: "Use EXACT scores from section X above"
   - Need: Explicit bad examples showing the exact error

4. **Testing with ground truth is critical**
   - User correctly identified the contradiction
   - Database query confirmed the hallucination
   - Automated tests should check LLM output against DB truth

---

## ✅ Deployment Checklist

- [x] Fix #1: Update `progressFromLastLesson` instruction
- [x] Fix #2: Strengthen JSON schema description
- [x] Backend restarted with fixes
- [x] Documentation created
- [ ] Test with next completed lesson
- [ ] Verify no hallucinations in progress text
- [ ] Monitor for similar issues in other generated text fields

---

## 🚀 Next Steps

### Immediate
- ✅ Fix has been deployed
- ⏳ Next lesson analysis will use new instructions
- ⏳ Monitor `progressFromLastLesson` for accuracy

### Future Improvements
1. **Add validation layer**: Code should verify that numbers in LLM-generated text match database values
2. **Structured output only**: Consider moving all numerical comparisons to structured fields (like `grammarAccuracyChange`) and away from prose text
3. **Post-processing check**: Regex check for numbers in `progressFromLastLesson` and validate against actual previous scores

---

**Status:** Ready for testing with next lesson ✅







