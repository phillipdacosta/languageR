# Transcription Language Filter Bug Fix

## The Problem

**Issue:** When a student speaks only English during a Spanish lesson, Whisper was appearing to transcribe/translate the English into Spanish, and the English speech was being analyzed as if it were Spanish.

## Root Cause Analysis

### What Was Wrong (3 Critical Bugs)

1. **Language Hint Was Biasing Whisper**
   - We were passing `language: targetLanguage` (e.g., `'es'`) to Whisper
   - This parameter is a HINT that can bias Whisper to "hear" that language
   - When a student spoke English, Whisper might translate/hallucinate Spanish because we told it to expect Spanish

2. **Per-Segment Language Detection Doesn't Exist**
   - The code was checking `segment.language` which doesn't exist in Whisper's response
   - This field is **always undefined**
   - The fallback code assumed undefined = target language and allowed everything through

3. **Faulty Fallback Logic**
   ```javascript
   if (!segmentLanguage) {
     return true; // ❌ This allowed ALL segments through!
   }
   ```

## The Fix

### Changes Made to `backend/services/aiService.js`

**Before:**
```javascript
const transcription = await getOpenAIClient().audio.transcriptions.create({
  file: fileForUpload,
  model: 'whisper-1',
  language: targetLanguage, // ❌ This biases Whisper
  response_format: 'verbose_json',
  timestamp_granularities: ['segment']
});

// ❌ This code never worked - segment.language doesn't exist
const filteredSegments = transcription.segments?.filter(segment => {
  const segmentLanguage = segment.language; // Always undefined
  if (!segmentLanguage) {
    return true; // Accepts everything!
  }
  return segmentLanguage === targetLanguage;
});
```

**After:**
```javascript
// ✅ NO language hint - let Whisper detect naturally
const transcription = await getOpenAIClient().audio.transcriptions.create({
  file: fileForUpload,
  model: 'whisper-1',
  // NO 'language' parameter
  response_format: 'verbose_json',
  timestamp_granularities: ['segment']
});

// ✅ Check the TOP-LEVEL detected language (this actually exists!)
const detectedLanguage = transcription.language;

// ✅ Reject entire audio chunk if wrong language
if (detectedLanguage !== targetLanguage) {
  console.log(`🚫 REJECTED - Wrong language detected!`);
  return {
    text: '',
    segments: [],
    wasRejected: true
  };
}

// ✅ Language matches - accept all segments
return {
  text: transcription.text,
  segments: transcription.segments,
  wasRejected: false
};
```

## How It Works Now

### For a Spanish Lesson:

1. **Student speaks English** (30-second chunk)
   - Whisper transcribes: "Hello, how are you today?"
   - Whisper detects: `language: 'en'`
   - Backend checks: `'en' !== 'es'` → **REJECTED**
   - Result: Empty segments, not analyzed ✅

2. **Student speaks Spanish** (30-second chunk)
   - Whisper transcribes: "Hola, ¿cómo estás hoy?"
   - Whisper detects: `language: 'es'`
   - Backend checks: `'es' === 'es'` → **ACCEPTED**
   - Result: All segments saved and analyzed ✅

3. **Student speaks mixed languages** (30-second chunk)
   - Whisper detects the **dominant** language
   - If mostly English → Rejected
   - If mostly Spanish → Accepted
   - This is acceptable behavior for a language learning app

## Expected Log Output

### When English is spoken in a Spanish lesson:

```
🔍 ===== LANGUAGE VALIDATION =====
Target language: es (Spanish)
Detected language: en (English)
Speaker: student
Segments: 5

🚫 REJECTED - Wrong language detected!
   Expected: es (Spanish)
   Detected: en (English)
   Transcribed text: "Hello, how are you today? I'm doing well, thanks..."
   This audio chunk will NOT be analyzed.
=======================================
```

### When Spanish is spoken:

```
🔍 ===== LANGUAGE VALIDATION =====
Target language: es (Spanish)
Detected language: es (Spanish)
Speaker: student
Segments: 5

✅ Language matches target! All segments accepted.
📝 Transcribed text preview: "Hola, ¿cómo estás hoy? Estoy muy bien, gracias..."
=======================================
```

## Why This Approach is Better

### Chunk-Level Filtering (Our Approach)
- ✅ Avoids biasing Whisper with language hints
- ✅ More reliable language detection
- ✅ Simpler logic (one check vs. per-segment loops)
- ✅ Prevents hallucinations/translations
- ⚠️  May accept chunks with brief language mixing (acceptable)

### Per-Segment Filtering (Previous Attempt)
- ❌ Doesn't work - `segment.language` doesn't exist
- ❌ Would need multiple API calls (expensive)
- ❌ More complex to implement correctly

## Testing

To verify the fix works:

1. **Start a Spanish lesson**
2. **Speak only English for 30+ seconds**
3. **Check backend logs** - should see `🚫 REJECTED - Wrong language detected!`
4. **End the lesson**
5. **Check analysis** - should have no student segments (or error stating insufficient data)

## Impact

- ✅ Students speaking their native language will no longer be analyzed
- ✅ Mixed lessons work correctly (only target language chunks analyzed)
- ✅ No false positive analysis from wrong language speech
- ✅ More accurate proficiency assessments

## Configuration

No configuration changes needed. The system now:
- Automatically detects language per 30-second audio chunk
- Only analyzes chunks that match the lesson's target language
- Logs clear rejection messages for debugging

---

**Fixed:** January 21, 2026
**Files Modified:** `backend/services/aiService.js` (lines 766-840)

