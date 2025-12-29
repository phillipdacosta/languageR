# 🚀 Audio Backup Setup Guide

## Quick Start (5 minutes)

### 1. Create GCS Bucket
```bash
# Set your project ID
export PROJECT_ID="your-gcp-project-id"

# Create the bucket
gsutil mb -l us-central1 gs://language-app-audio-backup

# Enable auto-delete after 2 days
cat > lifecycle.json << EOL
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 2}
      }
    ]
  }
}
EOL

gsutil lifecycle set lifecycle.json gs://language-app-audio-backup
rm lifecycle.json

echo "✅ Bucket created with 48-hour auto-delete"
```

### 2. Set Environment Variable (Optional)
```bash
# Add to backend/.env or backend/config.env
GCS_AUDIO_BACKUP_BUCKET=language-app-audio-backup

# If using different GCS credentials (optional)
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/different-key.json
```

### 3. Restart Server
```bash
cd backend
npm start

# Look for these logs:
# ✅ Audio cleanup cron job scheduled (every 6 hours)
# ✅ Transcription retry cron job scheduled (every hour)
# ✅ All audio cron jobs initialized
# ✅ Audio backup system initialized
```

### 4. Test It Works
```bash
# Join a lesson and speak for 30+ seconds
# Check backend logs for:

# 💾 Audio backed up to GCS: gs://language-app-audio-backup/lessons/...
# 🗑️  Will auto-delete at: 2024-12-30T...
# ✅ Backup info saved (transcription successful)

# Check stats API:
curl http://localhost:5001/api/transcription/backup-stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Monitoring

### Check Storage Usage
```bash
# Using gsutil
gsutil du -sh gs://language-app-audio-backup

# Using API
GET /api/transcription/backup-stats
```

### View Cron Job Logs
```bash
# Cleanup job (every 6 hours)
🧹 [CRON] Starting audio backup cleanup...
🧹 [CRON] Cleanup complete: 15 files deleted, 0 errors
📊 [CRON] Current storage: 24 files, 288.45 MB

# Retry job (every hour)
🔄 [CRON] Starting transcription retry...
🔄 [CRON] Retry complete: 3 retried, 2 succeeded, 1 failed
📊 [CRON] Pending retries: 1, Failed chunks: 1
```

---

## Troubleshooting

### Audio Not Being Backed Up
1. Check GCS credentials:
   ```bash
   echo $GOOGLE_APPLICATION_CREDENTIALS
   gsutil ls  # Should work
   ```

2. Check bucket exists:
   ```bash
   gsutil ls gs://language-app-audio-backup
   ```

3. Check server logs for errors:
   ```bash
   grep "Audio backup" backend/logs/*.log
   ```

### Retry Not Working
1. Check cron job is running:
   ```bash
   # Look for these in server logs:
   ✅ Transcription retry cron job scheduled (every hour)
   ```

2. Check for failed chunks:
   ```bash
   GET /api/transcription/backup-stats
   # Look at retry.pendingRetries
   ```

3. Manual retry:
   ```bash
   POST /api/transcription/TRANSCRIPT_ID/retry
   ```

---

## Cost Estimates

### Current Usage
- Check storage: `gsutil du -sh gs://language-app-audio-backup`
- Monthly cost: Storage (MB) × $0.020/GB

### Expected Costs
- 100 lessons/month: ~$0.05/month
- 1000 lessons/month: ~$0.50/month
- 10000 lessons/month: ~$5/month

**Negligible cost for huge reliability benefit!** 💸

---

## Next Steps

### Optional Frontend Features
1. **Profile Page**: Show audio backup status
2. **Lessons Page**: "Delete Audio" button
3. **Settings**: Configure retention period (24hr, 48hr, 7days)

### Optional Improvements
1. **Email Alerts**: Notify admin if retry fails 3 times
2. **Dashboard**: Visualize backup/retry stats
3. **Configurable Retention**: Let users choose retention period

---

**Setup Complete!** 🎉

Your app now has automatic audio backup with retry capabilities.
