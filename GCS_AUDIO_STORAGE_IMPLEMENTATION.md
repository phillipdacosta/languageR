# GCS Audio Storage Implementation - IN PROGRESS

## Current Status

✅ **Completed:**
1. Pronunciation UI added to lesson-analysis page
2. GCS SDK installed
3. Cloud Storage Service created (`cloudStorageService.js`)
4. Transcription route updated to use GCS
5. MongoDB schema updated with `audioGcsPath` field

⚠️ **In Progress:**
- Updating pronunciation service to download from GCS

## Architecture

### Audio Storage Flow:
```
1. Client uploads audio chunk → Backend
2. Backend transcribes with Whisper
3. Backend uploads audio to GCS → Get GCS path
4. Backend stores GCS path in MongoDB (not base64)
5. MongoDB document: ~100 bytes per segment (vs 500KB with base64)
```

### Pronunciation Assessment Flow:
```
1. After lesson ends, get sampled segments
2. Download audio from GCS for sampled segments only
3. Convert WebM → WAV
4. Send to GPT-4 for pronunciation assessment
5. Store results in MongoDB
6. (Optional) Delete audio from GCS after X days
```

### Cost Analysis:

**MongoDB Savings:**
- Old: 24 segments × 555KB = 13MB per lesson
- New: 24 segments × 100 bytes = 2.4KB per lesson
- Savings: **99.98% reduction in MongoDB storage**

**GCS Costs:**
- Storage: $0.020/GB/month
- 1000 lessons/month × 500KB = 500MB
- Monthly cost: ~$0.01 storage + ~$0.01 operations = **$0.02/month**

**ROI:** Massive MongoDB savings, negligible GCS cost

## Environment Variables Needed

✅ **Already Configured!** You're using:
```bash
GOOGLE_CLOUD_PROJECT_ID=languager-476418
GOOGLE_CLOUD_BUCKET_NAME=languager-videos-2025
GOOGLE_CLOUD_KEY_FILE=./languager-476418-5b48a8bc00f8.json
```

**Storage Structure:**
- Videos: `gs://languager-videos-2025/videos/{lessonId}/...`
- Audio: `gs://languager-videos-2025/audio/{lessonId}/segment-{n}.webm`

## GCS Bucket Setup

✅ **Already Set Up!** Using existing bucket: `languager-videos-2025`

Optional improvements:
1. Set lifecycle policy (auto-delete audio after 90 days):
   ```bash
   gsutil lifecycle set lifecycle.json gs://languager-videos-2025
   ```

   `lifecycle.json`:
   ```json
   {
     "lifecycle": {
       "rule": [
         {
           "action": {"type": "Delete"},
           "condition": {
             "age": 90,
             "matchesPrefix": ["audio/"]
           }
         }
       ]
     }
   }
   ```

## Audio Playback

For playback in UI, generate signed URLs:
```javascript
const { getSignedUrl } = require('./services/cloudStorageService');

// In API route:
const signedUrl = await getSignedUrl(segment.audioGcsPath, 60); // 60 min expiry
res.json({ audioUrl: signedUrl });
```

## Next Steps

1. ✅ Add GCS download logic to pronunciation service
2. ⏳ Test full flow with new lesson
3. ⏳ Add audio playback UI component
4. ⏳ Set up GCS bucket in production
5. ⏳ Add cleanup job to delete old audio

## Files Modified

- `/backend/services/cloudStorageService.js` (NEW)
- `/backend/routes/transcription.js` (Updated)
- `/backend/models/LessonTranscript.js` (Updated)
- `/language-learning-app/src/app/lesson-analysis/lesson-analysis.page.html` (Updated)
- `/language-learning-app/src/app/lesson-analysis/lesson-analysis.page.scss` (Updated)

## Backend Restart Required

After adding environment variables, restart backend:
```bash
pkill -9 -f "node.*server.js"
cd backend && npm start
```




