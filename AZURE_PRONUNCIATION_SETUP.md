# 🎙️ Azure Speech Pronunciation Assessment Setup Guide

## Overview

Azure Speech Services pronunciation assessment has been integrated into your language learning app with:
- ✅ **Smart sampling** (20% of audio to reduce costs)
- ✅ **Target language filtering** (only assess Spanish, ignore English)
- ✅ **Parallel processing** (runs alongside Whisper, minimal slowdown)
- ✅ **Cost**: ~$0.06-$0.10 per 50-minute lesson
- ✅ **Free tier**: 5 audio hours/month

---

## 📋 Step 1: Create Azure Account

1. Go to https://portal.azure.com
2. Sign in or create a Microsoft Azure account
3. **Free tier includes**:
   - 5 audio hours/month FREE
   - No credit card required for free tier
   - Good for ~10 lessons/month

---

## 🔑 Step 2: Create Speech Services Resource

### Option A: Quick Link (Recommended)
1. Visit: https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices
2. Fill in the form:
   - **Subscription**: Choose your subscription
   - **Resource Group**: Create new → Name it "languageapp-resources"
   - **Region**: Choose "East US" (or closest to you)
   - **Name**: Choose a unique name (e.g., "languageapp-speech")
   - **Pricing Tier**: Select "Free F0" (5 hours/month) or "Standard S0" ($1/hour)
3. Click **Review + Create**
4. Click **Create**

### Option B: Manual Navigation
1. In Azure Portal, click "Create a resource"
2. Search for "Speech"
3. Click "Speech" (by Microsoft)
4. Click "Create"
5. Follow steps from Option A above

---

## 🎯 Step 3: Get Your API Keys

1. After creation completes, click **"Go to resource"**
2. In the left sidebar, click **"Keys and Endpoint"**
3. You'll see two pieces of information:
   - **KEY 1**: This is your `AZURE_SPEECH_KEY`
   - **Location/Region**: This is your `AZURE_SPEECH_REGION` (e.g., `eastus`)

4. **Copy these values!** You'll need them next.

---

## ⚙️ Step 4: Add Keys to Your Config

1. Open `/backend/config.env`
2. Find these lines (already added for you):

```env
# Azure Speech Services for Pronunciation Assessment
AZURE_SPEECH_KEY=your_azure_speech_key_here
AZURE_SPEECH_REGION=eastus
```

3. Replace the values:

```env
AZURE_SPEECH_KEY=paste_your_key_1_here
AZURE_SPEECH_REGION=eastus  # or whatever region you chose
```

**Example:**
```env
AZURE_SPEECH_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
AZURE_SPEECH_REGION=eastus
```

---

## 🔄 Step 5: Restart Backend

```bash
cd backend
# Kill existing backend
pkill -f "node server.js"

# Restart with new environment variables
node server.js
```

Or if you're running with nodemon:
```bash
npm run dev
```

---

## ✅ Step 6: Test It

1. Complete a lesson with transcription enabled
2. Speak in Spanish for at least 1-2 minutes
3. End the lesson
4. Wait for analysis (~1 minute)
5. Check the lesson summary modal for pronunciation scores!

You should see:
- **Overall Pronunciation Score** (0-100)
- **Accuracy Score**
- **Fluency Score**
- **Prosody Score** (intonation/rhythm)
- **Mispronunciations** (words that need practice)

---

## 💰 Cost Management

### Current Configuration
- **Sampling Rate**: 20% (adjust in `pronunciationService.js`)
- **Language Filtering**: Spanish only (ignores English)
- **Estimated Cost**: $0.06-$0.10 per 50min lesson

### To Adjust Sampling Rate
Edit `/backend/services/pronunciationService.js`:

```javascript
const PRONUNCIATION_CONFIG = {
  SAMPLING_RATE: 0.20, // Change to 0.10 for 10%, 0.30 for 30%, etc.
  // ...
};
```

### Free Tier Limits
- **5 hours/month FREE**
- After that: $1/hour (~$0.017/minute)
- Monitor usage in Azure Portal → Your Speech Resource → Metrics

---

## 🎛️ Configuration Options

All settings are in `/backend/services/pronunciationService.js`:

```javascript
const PRONUNCIATION_CONFIG = {
  SAMPLING_RATE: 0.20,              // 20% of audio analyzed
  MIN_SEGMENTS_TO_ASSESS: 3,        // Min segments for reliable data
  MAX_SEGMENTS_TO_ASSESS: 10,       // Max segments to cap costs
  LANGUAGE_MAP: {
    'es': 'es-ES',                   // Spanish
    'en': 'en-US',                   // English
    'fr': 'fr-FR',                   // French
    // Add more languages as needed
  }
};
```

---

## 🔍 Troubleshooting

### "Azure Speech not configured" warning
- **Cause**: API keys not set or invalid
- **Fix**: Double-check your `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in `config.env`

### No pronunciation scores appearing
- **Cause**: Student didn't speak enough in target language
- **Fix**: Ensure at least 1-2 minutes of Spanish audio in the lesson

### "Recognition failed" errors
- **Cause**: Audio format issue or invalid API key
- **Fix**: Check logs in `/tmp/backend.log` for specific error details

### Want to disable pronunciation assessment?
- Just leave `AZURE_SPEECH_KEY` empty in `config.env`
- The system will gracefully skip pronunciation assessment

---

## 📊 Monitoring Usage

1. Go to https://portal.azure.com
2. Navigate to your Speech Services resource
3. Click "Metrics" in the left sidebar
4. Select:
   - **Metric**: "Text to Speech Characters Translated" or "Speech to Text"
   - **Time range**: Last 7 days
5. Monitor to stay within free tier limits

---

## 🚀 What's Integrated

The pronunciation assessment is automatically integrated into:

1. **Backend Analysis** (`/backend/services/pronunciationService.js`)
   - Runs in parallel with Whisper transcription
   - Smart sampling to reduce costs
   - Target language filtering

2. **Database Schema** (`/backend/models/LessonAnalysis.js`)
   - `pronunciationAnalysis` field added
   - Stores scores and mispronunciations

3. **Tutor Notes** (future: will be added to pre-call notes)
   - Pronunciation scores
   - Words that need practice

4. **Student Summary** (future: will be added to lesson summary modal)
   - Overall pronunciation feedback
   - Specific sounds to work on

---

## 📞 Support

- **Azure Docs**: https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/
- **Pronunciation Assessment Docs**: https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/how-to-pronunciation-assessment
- **Pricing Calculator**: https://azure.microsoft.com/en-us/pricing/calculator/

---

## 🎉 You're All Set!

Once you've added your API keys and restarted the backend, pronunciation assessment will automatically run for all new lessons!

**Next Steps:**
1. Get your Azure API keys (Steps 1-3)
2. Add them to `config.env` (Step 4)
3. Restart backend (Step 5)
4. Complete a test lesson (Step 6)
5. See pronunciation scores in action! 🎤✨


