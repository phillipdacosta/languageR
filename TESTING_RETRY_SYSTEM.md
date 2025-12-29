# 🧪 Testing the Audio Backup & Retry System

## Setup Complete ✅

You can now simulate AI service downtime to test the retry system.

**Recent Fix (Dec 28, 2025):** Added language normalization to retry service. The system now automatically converts language names like "Spanish" to ISO-639-1 codes like "es" before calling Whisper API.

---

## Test 1: Whisper Downtime (Transcription Failure)

### Step 1: Enable Whisper Failure Mode
```bash
# Edit backend/config.env
FORCE_WHISPER_FAILURE=true
```

### Step 2: Restart Backend
```bash
cd backend
npm start
```

### Step 3: Do a Short Lesson
1. Start a 1-on-1 lesson (as student)
2. Speak for 30+ seconds in the target language
3. End the lesson normally

### Step 4: Verify Failure
**Check logs for:**
```
🧪 TEST MODE: Simulating Whisper API failure
❌ Whisper transcription failed
💾 Audio backed up to GCS: gs://languager-videos-2025/lessons/...
💾 Backup info saved for retry
```

**Check GCS:**
- Go to: https://console.cloud.google.com/storage/browser/languager-videos-2025/lessons
- You should see audio files backed up

**Check MongoDB (optional):**
```javascript
db.lessontranscripts.findOne(
  { lessonId: ObjectId("YOUR_LESSON_ID") },
  { audioChunks: 1 }
)
// Should show: audioChunks[].transcribed = false
```

### Step 5: "Fix" Whisper (Simulate Recovery)
```bash
# Edit backend/config.env
FORCE_WHISPER_FAILURE=false
```

### Step 6: Restart Backend
```bash
cd backend
npm start
```

### Step 7: Trigger Retry Manually (Don't Wait for Cron)
```bash
cd backend
node test-retry-system.js
```

### Step 8: Verify Success
**Check output:**
```
🔄 TESTING TRANSCRIPTION RETRY...
   ✅ Retried: 2
   ✅ Succeeded: 2
   ❌ Failed: 0
```

**Check the lesson:**
- Go to your app → /tabs/progress or /tabs/home/lessons
- The analysis should now be available!

---

## Test 2: GPT-4 Downtime (Analysis Failure)

### Step 1: Do a Normal Lesson First
1. Make sure `FORCE_WHISPER_FAILURE=false`
2. Do a short lesson (transcription will work)
3. **BEFORE the lesson ends**, proceed to Step 2

### Step 2: Enable GPT-4 Failure Mode (While Lesson is Running)
```bash
# Edit backend/config.env
FORCE_GPT4_FAILURE=true
```

### Step 3: Restart Backend (In Another Terminal)
```bash
cd backend
npm start
```

### Step 4: End the Lesson
- End the lesson normally
- Transcription completes successfully
- Analysis fails

### Step 5: Verify Failure
**Check logs:**
```
✅ Whisper transcription result: {...}
🤖 STARTING GPT-4 ANALYSIS
🧪 TEST MODE: Simulating GPT-4 API failure
❌ Error in analyzeLesson
💾 Analysis marked as failed - will retry automatically
```

**Check in app:**
- Go to /tabs/home/lessons
- Lesson shows "Generating analysis..." or "Analysis not available"

### Step 6: "Fix" GPT-4 (Simulate Recovery)
```bash
# Edit backend/config.env
FORCE_GPT4_FAILURE=false
```

### Step 7: Restart Backend
```bash
cd backend
npm start
```

### Step 8: Trigger Retry
```bash
cd backend
node test-retry-system.js
```

### Step 9: Verify Success
**Check output:**
```
🔄 TESTING ANALYSIS RETRY...
   ✅ Retried: 1
   ✅ Succeeded: 1
   ❌ Failed: 0
```

**Check in app:**
- Refresh /tabs/home/lessons
- Analysis should now be available!
- Click "View Analysis" to see the full report

---

## Test 3: Both Services Down (Worst Case)

### Step 1: Enable Both Failures
```bash
# Edit backend/config.env
FORCE_WHISPER_FAILURE=true
FORCE_GPT4_FAILURE=true
```

### Step 2: Do a Lesson
- Transcription fails → Audio backed up
- No analysis attempted (no transcript yet)

### Step 3: Fix Whisper First
```bash
FORCE_WHISPER_FAILURE=false
FORCE_GPT4_FAILURE=true  # Still down
```

### Step 4: Retry
```bash
node test-retry-system.js
```
- Transcription succeeds
- Analysis fails (GPT-4 still down)

### Step 5: Fix GPT-4
```bash
FORCE_WHISPER_FAILURE=false
FORCE_GPT4_FAILURE=false  # Now fixed
```

### Step 6: Final Retry
```bash
node test-retry-system.js
```
- Analysis succeeds!

---

## Automatic Retry (Production Behavior)

In production, you don't need to run the test script manually. The cron jobs will handle it:

- **Transcription Retry**: Every hour at :15 (e.g., 3:15 PM, 4:15 PM)
- **Analysis Retry**: Every hour at :30 (e.g., 3:30 PM, 4:30 PM)

**To wait for auto-retry:**
1. Enable failure mode
2. Do lesson (fails)
3. Disable failure mode
4. Wait for next :15 or :30
5. Check logs for "🔄 [CRON] Starting transcription retry..." or "🔄 [CRON] Starting analysis retry..."

---

## Check Retry Status Anytime

### Via API:
```bash
curl http://localhost:3000/api/transcription/backup-stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Via Test Script:
```bash
node test-retry-system.js
```

---

## Clean Up After Testing

### Remove Test Flags:
```bash
# Edit backend/config.env
FORCE_WHISPER_FAILURE=false
FORCE_GPT4_FAILURE=false
```

### Restart Backend:
```bash
cd backend
npm start
```

---

## Expected Results

✅ **Audio Backup**: Always works (even when services are down)  
✅ **Transcription Retry**: Max 3 attempts, 48-hour window  
✅ **Analysis Retry**: Max 3 attempts, no time limit  
✅ **Student Experience**: Delayed analysis (1-3 hours) but always delivered  
✅ **Cost**: < $1/month for 1000 lessons  

---

## Troubleshooting

**If retry doesn't work:**
1. Check MongoDB: Are `audioChunks` present?
2. Check GCS: Are audio files there?
3. Check logs: Any errors during retry?
4. Check attempts: < 3 attempts remaining?
5. Check expiry: Not older than 48 hours?

**Common issues:**
- Forgetting to restart backend after config change
- Testing with class/office hours/trial (transcription skipped)
- Audio files expired (> 48 hours old)
- Max retry attempts exceeded (3 failures)

---

**Happy Testing!** 🚀

