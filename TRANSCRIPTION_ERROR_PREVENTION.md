# Transcription Error Prevention Improvements

## The Problem

The AI is analyzing transcription mistakes as if they were the student's actual language errors. Example:

**What student said**: "me saqué un gran **premio** de la luz" (I won a big prize from the lottery)  
**What AI heard**: "me saqué un gran **imprimo** de la luz"  
**Result**: AI flags "imprimo" (I print) as a word choice error ❌

The student likely said "premio" correctly, but the speech-to-text misheard it.

## Current System

You already have a transcription error detection system in `/backend/services/aiService.js`:

1. **Levenshtein Distance**: Checks if words are phonetically similar (e.g., "tiene"/"tienes")
2. **Threshold-based filtering**: Removes errors that look like transcription mishears
3. **Impact-based keeping**: Keeps high-impact errors even if they might be transcription issues

### Current Thresholds

```javascript
// Base threshold: 65% similar = likely transcription error
let threshold = 0.65;

// Short words: 80% similar
if (maxLength <= 3) threshold = 0.80;

// Long words: 60% similar  
if (maxLength >= 8) threshold = 0.60;
```

### Why "imprimo" → "premio" Slipped Through

```
Levenshtein distance: 5 edits
Similarity: ~42% (below 65% threshold)
Result: NOT flagged as transcription error ❌
```

## Recommended Solutions

### Solution 1: Context-Aware Validation (BEST)

Add a GPT-4 validation step that checks if the "error" makes sense in context:

```javascript
/**
 * Validate if detected error makes contextual sense
 * If the "wrong" word doesn't fit context, it's likely transcription error
 */
async function validateErrorContext(original, corrected, fullSentence, language) {
  const prompt = `Given this sentence in ${language}:
"${fullSentence}"

Someone used the word "${original}" but we think they meant "${corrected}".

Does "${original}" make ANY logical sense in this context? Consider:
1. Does it fit grammatically?
2. Does it create a comprehensible (even if imperfect) meaning?
3. Could a language learner plausibly have chosen this word?

If "${original}" makes ZERO sense contextually (seems like a speech recognition error), respond "TRANSCRIPTION_ERROR".
If it makes some sense (even if wrong), respond "REAL_ERROR".

Response:`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 20
  });

  const result = response.choices[0].message.content.trim();
  return result === 'TRANSCRIPTION_ERROR';
}
```

**Example:**
- "me saqué un gran **imprimo** de la luz" → Makes ZERO sense → TRANSCRIPTION_ERROR ✅
- "me saqué un gran **premio** de la luz" → Makes sense → REAL_ERROR (if this was wrong)

### Solution 2: Add Spanish-Specific Phonetic Patterns

Expand the transcription error detection for Spanish confusables:

```javascript
/**
 * Common Spanish transcription confusions
 * Add to aiService.js
 */
const SPANISH_CONFUSABLES = [
  // Similar sounds that ASR confuses
  { pairs: ['premio', 'imprimo'], reason: 'Similar vowel patterns' },
  { pairs: ['bien', 'vien'], reason: 'B/V confusion' },
  { pairs: ['haber', 'a ver'], reason: 'Homophones' },
  { pairs: ['sino', 'si no'], reason: 'Word separation' },
  { pairs: ['también', 'tan bien'], reason: 'Word separation' },
  { pairs: ['porque', 'por que', 'porqué', 'por qué'], reason: 'Homophone variants' },
  // Add more from real data
];

function isKnownConfusable(word1, word2, language) {
  if (language !== 'spanish') return false;
  
  const w1 = word1.toLowerCase().trim();
  const w2 = word2.toLowerCase().trim();
  
  for (const confusable of SPANISH_CONFUSABLES) {
    if (confusable.pairs.includes(w1) && confusable.pairs.includes(w2)) {
      console.log(`🔍 Known Spanish confusable: "${w1}" ↔ "${w2}" (${confusable.reason})`);
      return true;
    }
  }
  
  return false;
}
```

### Solution 3: Show Confidence Scores to Students (UI Enhancement)

Let students see which corrections have low confidence:

```typescript
// In lesson-analysis component
<div class="error-card" *ngFor="let error of errors">
  <div class="error-header">
    <h4>{{ error.title }}</h4>
    <ion-badge *ngIf="error.confidence < 70" color="warning">
      Low Confidence
    </ion-badge>
  </div>
  
  <div class="examples">
    <div class="example">
      <span class="wrong">❌ {{ error.original }}</span>
      <span class="correct">✅ {{ error.corrected }}</span>
      <ion-button *ngIf="error.confidence < 70" size="small" fill="clear">
        <ion-icon name="flag-outline"></ion-icon>
        Report
      </ion-button>
    </div>
  </div>
</div>
```

### Solution 4: Tutor Override System

Allow tutors to mark errors as false positives:

```typescript
// In lesson analysis, show tutor a review mode
interface ErrorReview {
  errorId: string;
  original: string;
  corrected: string;
  tutorVerdict: 'correct' | 'incorrect' | 'transcription_error' | null;
  tutorNote?: string;
}

// Backend endpoint
POST /api/lessons/:id/analysis/review-error
{
  errorId: "word_choice_1",
  verdict: "transcription_error",
  note: "Student said 'premio' correctly, ASR misheard"
}
```

### Solution 5: Real-Time Audio Playback

Store audio chunks and let students/tutors listen to the actual pronunciation:

```typescript
// In error display
<ion-button (click)="playAudioSegment(error.timestamp)">
  <ion-icon name="volume-high-outline"></ion-icon>
  Listen to this section
</ion-button>
```

## Implementation Priority

### Phase 1: Quick Wins (1-2 hours)
1. ✅ Add known Spanish confusables list
2. ✅ Implement `isKnownConfusable()` check
3. ✅ Update filtering logic to catch these cases

### Phase 2: Context Validation (2-3 hours)
1. ✅ Add `validateErrorContext()` function
2. ✅ Call it for word_choice and vocabulary errors
3. ✅ Filter out errors flagged as TRANSCRIPTION_ERROR

### Phase 3: UI Improvements (3-4 hours)
1. Add confidence badges to error display
2. Add "Report incorrect" button for students
3. Show confidence scores in analysis

### Phase 4: Tutor Tools (4-6 hours)
1. Add tutor review mode for errors
2. Store tutor verdicts in database
3. Use verdicts to improve future detection

### Phase 5: Audio Playback (Future)
1. Store timestamped audio chunks
2. Add playback UI
3. Let users verify pronunciation themselves

## Immediate Fix for "imprimo" → "premio"

Add this to `backend/services/aiService.js`:

```javascript
// After line 62 in getLanguageEndingPatterns()
function getSpanishConfusables() {
  return [
    ['premio', 'imprimo'],
    ['premio', 'primero'], // Another common confusion
    ['bien', 'vien'],
    ['haber', 'a ver'],
    ['también', 'tan bien'],
    ['sino', 'si no'],
    ['porque', 'por que'],
    // Add more as you discover them
  ];
}

// After line 122 in arePhoneticallySimilar()
// Add this check BEFORE returning similarity >= threshold
if (language === 'spanish') {
  const confusables = getSpanishConfusables();
  for (const [word1, word2] of confusables) {
    if ((w1 === word1 && w2 === word2) || (w1 === word2 && w2 === word1)) {
      console.log(`🔍 Known Spanish confusable detected: "${w1}" ↔ "${w2}"`);
      return true; // Treat as transcription error
    }
  }
}

return similarity >= threshold;
```

## Long-Term: Azure Pronunciation Assessment

You have Azure pronunciation assessment integrated. Consider using it to:

1. **Get pronunciation scores**: If student scored 90+ on a word, don't flag it as an error
2. **Compare ASR alternatives**: Azure returns multiple transcription hypotheses
3. **Use confidence scores**: Low confidence = more likely transcription error

Example:
```javascript
// If Azure says: "premio" = 95% confidence, accuracy score 92
// But GPT-4 sees: "imprimo"
// → Trust Azure, it's a transcription error
```

## Measuring Success

Track these metrics:

1. **False positive rate**: % of flagged errors students report as incorrect
2. **Student feedback**: "Was this feedback helpful?" on each error
3. **Tutor corrections**: How often tutors override AI analysis
4. **Retention of errors**: Do flagged errors recur in later lessons? (real errors should, transcription errors shouldn't)

## Example Update

Here's what the error filtering would look like with Phase 1 + Phase 2:

```javascript
async function filterAndPrioritizeErrors(topErrors, lessonDurationMinutes, transcript, language) {
  // ... existing code ...
  
  // NEW: Step 1.5 - Check for known confusables
  analyzed = analyzed.map(err => {
    if (err.examples && err.examples.length > 0) {
      const firstExample = err.examples[0];
      if (firstExample.original && firstExample.corrected) {
        const origWords = firstExample.original.toLowerCase().split(/\s+/);
        const corrWords = firstExample.corrected.toLowerCase().split(/\s+/);
        
        for (let i = 0; i < Math.min(origWords.length, corrWords.length); i++) {
          if (isKnownConfusable(origWords[i], corrWords[i], language)) {
            err.isTranscriptionError = true;
            console.log(`   🔍 Known confusable detected: "${origWords[i]}" → "${corrWords[i]}"`);
            break;
          }
        }
      }
    }
    return err;
  });
  
  // NEW: Step 1.6 - Context validation for word choice errors
  for (const err of analyzed) {
    if (err.type === 'word_choice' && err.examples && err.examples.length > 0) {
      const firstExample = err.examples[0];
      const isTranscriptionError = await validateErrorContext(
        firstExample.original,
        firstExample.corrected,
        firstExample.original, // Full sentence
        language
      );
      
      if (isTranscriptionError) {
        err.isTranscriptionError = true;
        console.log(`   🔍 Context validation flagged as transcription error: "${firstExample.original}"`);
      }
    }
  }
  
  // Rest of existing filtering logic...
}
```

## Testing the Fix

Create test cases:

```javascript
// Test cases for transcription error detection
const testCases = [
  {
    original: "me saqué un gran imprimo de la luz",
    corrected: "me saqué un gran premio de la luz",
    shouldFlag: true,
    reason: "Known confusable + context makes no sense"
  },
  {
    original: "yo tiene hambre",
    corrected: "yo tengo hambre",
    shouldFlag: false,
    reason: "Real conjugation error"
  },
  {
    original: "quiero vien a la tienda",
    corrected: "quiero ir bien a la tienda",
    shouldFlag: true,
    reason: "Known confusable (bien/vien)"
  }
];
```

## Status

❌ **Not yet implemented** - Awaiting your approval to proceed

Would you like me to implement:
- [ ] Phase 1 (known confusables)
- [ ] Phase 2 (context validation)
- [ ] Phase 3 (UI improvements)
- [ ] All of the above

Let me know which approach you prefer!



