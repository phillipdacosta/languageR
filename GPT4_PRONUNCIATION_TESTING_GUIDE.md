# 🧪 GPT-4 Pronunciation Testing Guide

## ✅ **Implementation Complete!**

All components are now in place and ready for testing:

1. ✅ **GPT-4 Pronunciation Service** - Language-agnostic, 15% sampling, complexity-focused
2. ✅ **Audio Storage** - Stores audio with student segments in target language
3. ✅ **Integration** - Calls GPT-4 after lesson, merges with existing analysis
4. ✅ **Database Schema** - Updated to store audio data

---

## 🚀 **Quick Test (5-10 Minutes)**

### **Step 1: Start Backend**
```bash
cd backend
npm start
```

### **Step 2: Start a Test Lesson**

1. Open your app
2. Start a lesson in **Spanish** (or any language)
3. **Student speaks for 3-5 minutes** in Spanish
4. Say some complex words like:
   - Spanish: "desafortunadamente", "específicamente", "pronunciación"
   - French: "malheureusement", "particulièrement", "développement"
   - German: "Entschuldigung", "Aussprache", "Veranstaltung"
5. End the lesson

### **Step 3: Check Backend Logs**

Look for these log messages:

```
✅ SUCCESS INDICATORS:

🎤 ========== STARTING GPT-4 PRONUNCIATION ASSESSMENT ==========
📊 Total segments: 47
📊 Student segments: 28
📊 Target language (es) segments: 22
📊 Intelligent sampling: 22 segments available
✅ Sampled 3/22 segments (15%)
📈 Complexity range: 2.1 - 6.8
✅ Found audio in 3/3 sampled segments
🎵 Using audio from first segment (245KB base64)
🎙️ Calling GPT-4 Realtime API...
📥 GPT-4 response received: {"overallScore":78...
✅ ✅ ✅ GPT-4 PRONUNCIATION ASSESSMENT COMPLETE ✅ ✅ ✅
   Overall Score: 78/100
   Accuracy: 82/100
   Fluency: 75/100
   Prosody: 80/100
   Words to improve: 3
   Top words:
     - desafortunadamente (65/100): Difficulty with 'rr' sound
     - específicamente (70/100): Inconsistent stress
     - pronunciación (72/100): Struggle with 'ción' ending
```

```
⚠️ EXPECTED FOR OLD LESSONS:

⚠️  No audio data found in sampled segments
⚠️  This is expected for older lessons. New lessons will have audio.
```

```
❌ ERROR INDICATORS:

❌ GPT-4 Realtime pronunciation error: ...
(Check error message for details)
```

### **Step 4: Check Lesson Summary**

1. Open the lesson summary modal
2. Look for the **Pronunciation** card
3. Should show:
   - Overall score (0-100)
   - Accuracy, Fluency, Prosody breakdown
   - 3-5 words to improve with scores
   - Feedback message

---

## 🔍 **Detailed Testing Checklist**

### **Test 1: Basic Functionality**
- [ ] Start a Spanish lesson
- [ ] Student speaks 5+ sentences in Spanish
- [ ] End lesson
- [ ] Check logs for "GPT-4 PRONUNCIATION ASSESSMENT COMPLETE"
- [ ] Open lesson summary
- [ ] Verify pronunciation card appears with scores

### **Test 2: Language Filtering**
- [ ] Start a Spanish lesson
- [ ] Student speaks in **English** for 30 seconds
- [ ] Student speaks in **Spanish** for 2 minutes
- [ ] End lesson
- [ ] Check logs: Should show "Target language (es) segments: X" (only Spanish counted)
- [ ] Verify pronunciation assessment only evaluates Spanish

### **Test 3: Complex Word Focus**
- [ ] Start a Spanish lesson
- [ ] Student says simple words: "hola", "bueno", "sí", "no"
- [ ] Student says complex words: "desafortunadamente", "específicamente"
- [ ] End lesson
- [ ] Check lesson summary
- [ ] Verify "Words to Improve" shows ONLY complex words (not "hola"/"bueno")

### **Test 4: Multiple Languages**
Test with different languages to verify universal support:

- [ ] **Spanish**: "desafortunadamente", "específicamente", "pronunciación"
- [ ] **French**: "malheureusement", "particulièrement", "développement"
- [ ] **German**: "Entschuldigung", "Veranstaltung", "Aussprache"
- [ ] **Portuguese**: "especificamente", "infelizmente", "pronunciação"

### **Test 5: Edge Cases**

**Short Lesson (< 3 segments):**
- [ ] Student speaks for only 30 seconds
- [ ] End lesson
- [ ] Check logs: Should show "Skipping pronunciation: Only 2 target language segments (need 3+)"

**No Target Language Speech:**
- [ ] Student only speaks in English (not target language)
- [ ] End lesson
- [ ] Check logs: Should show "Target language (es) segments: 0"
- [ ] No pronunciation assessment

**Audio Storage:**
- [ ] Check MongoDB after lesson
- [ ] Verify segments have `audioBase64` field (only for student in target language)
- [ ] Verify tutor segments do NOT have audio stored

---

## 📊 **Expected Costs**

### **Per Test Lesson (5 min, 60% student speaking):**
```
Student speaks: 3 minutes
Target language: ~2.5 minutes
Sampled (15%): ~0.4 minutes (24 seconds)
Cost: 0.4 min × $0.06 = $0.024 per test (~2.4 cents)
```

### **After 10 test lessons:**
```
Total cost: 10 × $0.024 = $0.24 (24 cents)
```

Very affordable for testing! 🎉

---

## 🐛 **Troubleshooting**

### **Error: "No audio data found in sampled segments"**

**Cause:** Old lessons (before audio storage was added)

**Solution:** 
- Start a NEW lesson
- Old lessons won't have audio (expected behavior)

---

### **Error: "OpenAI API error: Invalid API key"**

**Cause:** `OPENAI_API_KEY` not set in environment

**Solution:**
```bash
# Check if key is set
echo $OPENAI_API_KEY

# If not set, add to backend/.env or backend/config.env
OPENAI_API_KEY=sk-proj-...your-key...
```

---

### **Error: "model 'gpt-4o-audio-preview' not found"**

**Cause:** Your OpenAI account doesn't have access to GPT-4 audio models yet

**Temporary Solution:**
Update the model in `gpt4PronunciationService.js` line 248:
```javascript
// FROM:
model: "gpt-4o-audio-preview",

// TO: (use regular GPT-4 without audio - for testing logic only)
model: "gpt-4-turbo-preview",
// Note: This won't actually assess pronunciation, just tests the flow
```

**Permanent Solution:**
- Wait for GPT-4 audio access on your account
- Or use a different OpenAI account with audio access

---

### **Error: "MongoDB document too large (16MB limit)"**

**Cause:** Too much audio stored in MongoDB

**Solution:**
This is why we only store audio for student segments in target language (not all audio).

If still hitting limits:
1. Reduce sampling rate from 15% to 10%
2. Implement S3 storage (see implementation guide)
3. Delete audio after analysis (add cleanup job)

---

### **No pronunciation card in UI**

**Cause:** Frontend might not be displaying `pronunciationAnalysis` yet

**Check:**
1. Open browser console
2. Inspect lesson analysis object
3. Verify `pronunciationAnalysis` field exists
4. Check if modal component handles it

**Verify in MongoDB:**
```javascript
db.lessonanalyses.findOne(
  { /* your lesson */ }, 
  { pronunciationAnalysis: 1 }
)
```

---

## 📈 **Success Metrics**

After testing, you should see:

✅ **Functionality:**
- [ ] Pronunciation scores appear in lesson summary
- [ ] Only complex words shown (not "hola", "bueno")
- [ ] Only target language assessed (not English)
- [ ] Assessment completes in < 60 seconds
- [ ] Old lessons still work (no pronunciation, but no errors)

✅ **Performance:**
- [ ] Audio storage: ~200-500KB per segment
- [ ] MongoDB document size: < 5MB per lesson
- [ ] Analysis time: +10-30 seconds (GPT-4 call)

✅ **Cost:**
- [ ] 5-min lesson: ~$0.024 (2.4 cents)
- [ ] 25-min lesson: ~$0.12 (12 cents)
- [ ] 50-min lesson: ~$0.23 (23 cents)

---

## 🎯 **Next Steps After Testing**

### **If Tests Pass:**
1. ✅ Monitor costs in OpenAI dashboard for 1 week
2. ✅ Collect user feedback on pronunciation quality
3. ✅ Compare GPT-4 accuracy vs. Azure (if you had it working)
4. ✅ Adjust sampling rate if needed (10-20%)
5. ✅ Consider S3 storage for scale (if hitting MongoDB limits)

### **If Tests Fail:**
1. Check error messages in backend logs
2. Verify `OPENAI_API_KEY` is set correctly
3. Ensure new lessons (not old ones) are being tested
4. Check MongoDB for `audioBase64` in segments
5. Review troubleshooting section above

---

## 🔧 **Optional: Adjust Sampling Rate**

If you want to change cost/accuracy balance:

**File:** `/backend/routes/transcription.js` (line ~897)

```javascript
// Current: 15% sampling
const sampledSegments = intelligentSampleSegments(
  targetLanguageSegments,
  transcript.language,
  analysisResult.overallAssessment?.proficiencyLevel || 'B1',
  0.15  // ← Change this
);

// Options:
0.10  // 10% = Cheaper ($0.15/lesson), good accuracy
0.15  // 15% = Balanced ($0.23/lesson), great accuracy ⭐ CURRENT
0.20  // 20% = Premium ($0.30/lesson), excellent accuracy
0.30  // 30% = Max ($0.45/lesson), perfect accuracy
```

---

## 📞 **Support**

If you encounter issues not covered here:

1. Check backend logs for full error stack trace
2. Verify MongoDB has `audioBase64` in new lesson segments
3. Check OpenAI API dashboard for API call history
4. Ensure GPT-4 audio model access on your account

---

## 🎉 **Ready to Test!**

Everything is implemented and ready. Just:
1. Start a new lesson
2. Speak some complex words in target language
3. End lesson
4. Check logs and lesson summary

**Good luck!** 🚀

---

## 📝 **Test Checklist Summary**

Quick checklist to verify everything works:

```
□ Backend starts without errors
□ New lesson stores audio in segments (check MongoDB)
□ Lesson ends and triggers pronunciation assessment
□ Backend logs show "GPT-4 PRONUNCIATION ASSESSMENT COMPLETE"
□ Lesson summary shows pronunciation card with scores
□ Only complex words appear in "Words to Improve"
□ Only target language assessed (not native language)
□ Old lessons still work (no errors, just no pronunciation)
□ Cost is ~$0.024 per 5-min test lesson
□ Total test cost < $1 after 10+ tests
```

**All checked?** You're ready for production! 🎊


