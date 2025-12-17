const OpenAI = require('openai');

/**
 * Calculate Levenshtein distance between two strings
 * Used to detect transcription errors (phonetically similar words)
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Calculate distances
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[len1][len2];
}

/**
 * Check if two words are phonetically similar (likely transcription error)
 */
function arePhoneticallySimilar(word1, word2) {
  const w1 = word1.toLowerCase().trim();
  const w2 = word2.toLowerCase().trim();
  
  if (w1 === w2) return false; // Exact match, not an error
  
  const distance = levenshteinDistance(w1, w2);
  const maxLength = Math.max(w1.length, w2.length);
  const similarity = 1 - (distance / maxLength);
  
  // 70% similar = likely transcription error
  // Examples: "apretas"/"aprietas" (93% similar), "peces"/"pelos" (60% similar)
  return similarity >= 0.65;
}

/**
 * Check if a correction represents a fused word transcription artifact
 * (e.g., "costumbrarselegir" → "acostumbrarse a elegir")
 * Language-agnostic heuristic: if original is one word, corrected is multiple words,
 * and they're very similar when joined, it's likely ASR smashing words together
 */
function isFusedWordTranscription(original, corrected) {
  const orig = original.trim();
  const corr = corrected.trim();

  // Only consider if original is a single "word"
  if (orig.split(/\s+/).length !== 1) return false;

  // If corrected is multiple words, join them
  const corrJoined = corr.replace(/\s+/g, '');

  // Use Levenshtein distance to check similarity
  const distance = levenshteinDistance(orig.toLowerCase(), corrJoined.toLowerCase());
  const maxLen = Math.max(orig.length, corrJoined.length);
  const similarity = 1 - distance / maxLen;

  // If very similar after joining, it was probably just ASR smashing them together
  return similarity >= 0.7; // tweak threshold if needed
}

/**
 * Filter and prioritize errors based on lesson duration
 */
function filterAndPrioritizeErrors(topErrors, lessonDurationMinutes) {
  if (!topErrors || topErrors.length === 0) return [];
  
  const maxErrors = lessonDurationMinutes <= 25 ? 8 : 12;
  
  console.log(`🔍 Filtering ${topErrors.length} errors for ${lessonDurationMinutes}min lesson (max: ${maxErrors})`);
  
  // Step 1: Detect transcription errors using Levenshtein + GPT-4 flags
  const analyzed = topErrors.map(err => {
    let isTranscriptionError = err.isLikelyTranscriptionError || false;
    
    // Additional check: if error has original/corrected, check Levenshtein
    if (err.examples && err.examples.length > 0) {
      const firstExample = err.examples[0];
      if (firstExample.original && firstExample.corrected) {
        // Extract first mismatched word pair
        const origWords = firstExample.original.toLowerCase().split(/\s+/);
        const corrWords = firstExample.corrected.toLowerCase().split(/\s+/);
        
        for (let i = 0; i < Math.min(origWords.length, corrWords.length); i++) {
          if (origWords[i] !== corrWords[i] && arePhoneticallySimilar(origWords[i], corrWords[i])) {
            isTranscriptionError = true;
            console.log(`   🔍 Detected transcription error: "${origWords[i]}" → "${corrWords[i]}" (phonetically similar)`);
            break;
          }
        }
      }
    }
    
    return {
      ...err,
      isTranscriptionError,
      priority: calculateErrorPriority(err, isTranscriptionError)
    };
  });
  
  // Step 2: Filter out high-confidence transcription errors (but keep if high impact)
  const filtered = analyzed.filter(err => 
    !err.isTranscriptionError || 
    (err.impact === 'high' && err.occurrences >= 3) // Keep if high impact and recurring
  );
  
  console.log(`   ✅ Kept ${filtered.length}/${topErrors.length} errors after transcription filtering`);
  
  // Step 3: Sort by priority
  filtered.sort((a, b) => b.priority - a.priority);
  
  // Step 4: Return top N
  const result = filtered.slice(0, maxErrors);
  console.log(`   📊 Returning top ${result.length} errors`);
  
  return result;
}

/**
 * Calculate error priority score for sorting
 */
function calculateErrorPriority(error, isTranscriptionError) {
  const impactScore = {
    'high': 10,
    'medium': 5,
    'low': 2
  };
  
  let score = impactScore[error.impact] || 5;
  score += error.occurrences || 0; // Add occurrence count
  
  // Penalize likely transcription errors
  if (isTranscriptionError) {
    score *= 0.3;
  }
  
  return score;
}

// Already imported at top of file - removed duplicate
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Lazy initialization - only create client when actually needed
let openai = null;

function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key is required. Please set OPENAI_API_KEY in your environment variables.');
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    console.log('✅ OpenAI client initialized');
  }
  return openai;
}

// Configuration for analysis
const ANALYSIS_CONFIG = {
  // Token limits (to control cost and quality)
  MAX_STUDENT_WORDS: 2000,  // ~2,600 tokens
  MAX_TUTOR_WORDS: 800,     // ~1,000 tokens
  MAX_TOTAL_TOKENS: 8000,   // Soft limit for input
  
  // Sampling strategy for long transcripts
  SAMPLE_BEGINNING_PERCENT: 0.35,  // First 35% of lesson
  SAMPLE_MIDDLE_PERCENT: 0.25,     // Middle 25% 
  SAMPLE_END_PERCENT: 0.40,        // Last 40% (most recent)
  
  // Cost tracking (GPT-4o pricing per 1M tokens)
  COST_PER_INPUT_TOKEN: 0.0000025,   // $2.50 per 1M
  COST_PER_OUTPUT_TOKEN: 0.000010,   // $10.00 per 1M
  
  // Quality thresholds
  MIN_WORDS_FOR_ANALYSIS: 50,
  WARN_THRESHOLD_WORDS: 3000
};

/**
 * Estimate token count from text (rough: 1 token ≈ 0.75 words)
 */
function estimateTokens(text) {
  const words = text.split(/\s+/).length;
  return Math.ceil(words * 1.33);
}

/**
 * Get language name from ISO code for better prompts
 */
function getLanguageName(code) {
  const languageNames = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'nl': 'Dutch',
    'pl': 'Polish',
    'tr': 'Turkish',
    'sv': 'Swedish',
    'no': 'Norwegian',
    'da': 'Danish',
    'fi': 'Finnish',
    'el': 'Greek',
    'cs': 'Czech',
    'ro': 'Romanian',
    'uk': 'Ukrainian',
    'vi': 'Vietnamese',
    'th': 'Thai',
    'id': 'Indonesian',
    'ms': 'Malay',
    'he': 'Hebrew',
    'fa': 'Persian'
  };
  return languageNames[code] || code.toUpperCase();
}

/**
 * Calculate estimated API cost
 */
function estimateCost(inputTokens, outputTokens = 2000) {
  const inputCost = inputTokens * ANALYSIS_CONFIG.COST_PER_INPUT_TOKEN;
  const outputCost = outputTokens * ANALYSIS_CONFIG.COST_PER_OUTPUT_TOKEN;
  return {
    inputCost: inputCost.toFixed(4),
    outputCost: outputCost.toFixed(4),
    totalCost: (inputCost + outputCost).toFixed(4)
  };
}

/**
 * Clean transcript by removing incomplete sentences and transcription errors
 * @param {string} text - Transcript text to clean
 * @returns {string} - Cleaned transcript
 */
function cleanTranscript(text) {
  if (!text || text.trim().length === 0) {
    return text;
  }
  
  // Split into sentences/segments
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const cleanedLines = [];
  
  for (const line of lines) {
    // Skip incomplete sentences (end with ellipsis, trailing dots, or just a few words)
    if (line.endsWith('...') || 
        line.match(/^[A-Za-záéíóúñÁÉÍÓÚÑ]{1,3}\s*\.\.\.?\s*$/i) ||
        (line.split(/\s+/).length <= 2 && line.includes('...'))) {
      console.log(`⏭️  Skipping incomplete sentence: "${line}"`);
      continue;
    }
    
    // Skip obvious transcription errors/advertisements
    // Common patterns: language learning ads, unrelated promotional content
    const adPatterns = [
      /¿Estás listo para hablar/i,
      /¿Por qué .* es tan/i,
      /nuevo lenguaje a nivel/i,
      /en solo \d+ días/i,
      /Pimsleur/i,
      /Duolingo/i,
      /Babbel/i,
      /Rosetta Stone/i,
      /language learning app/i,
      /start your free trial/i,
      /subscribe now/i
    ];
    
    const isAdvertisement = adPatterns.some(pattern => pattern.test(line));
    if (isAdvertisement) {
      console.log(`⏭️  Skipping advertisement/transcription error: "${line.substring(0, 50)}..."`);
      continue;
    }
    
    // Keep the line if it passes filters
    cleanedLines.push(line);
  }
  
  const cleaned = cleanedLines.join('\n');
  
  if (cleaned.length < text.length) {
    const reduction = ((1 - cleaned.length / text.length) * 100).toFixed(1);
    console.log(`🧹 Cleaned transcript: removed ${text.split('\n').length - cleanedLines.length} incomplete/error segments (${reduction}% reduction)`);
  }
  
  return cleaned;
}

/**
 * Intelligently sample transcript segments for long lessons
 * Strategy: Take beginning (context), middle (variety), and end (recent)
 */
function sampleTranscript(segments, maxWords, role = 'student') {
  if (!segments || segments.length === 0) {
    return '';
  }
  
  const fullText = segments.map(s => s.text).join(' ');
  const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
  
  console.log(`📊 ${role} transcript: ${segments.length} segments, ${wordCount} words`);
  
  // If under limit, use full transcript
  if (wordCount <= maxWords) {
    console.log(`✅ Using full ${role} transcript (under ${maxWords} word limit)`);
    return segments.map(s => s.text).join('\n');
  }
  
  // Calculate sampling portions
  const segmentCount = segments.length;
  const beginIdx = Math.floor(segmentCount * ANALYSIS_CONFIG.SAMPLE_BEGINNING_PERCENT);
  const middleStart = Math.floor(segmentCount * 0.35);
  const middleEnd = Math.floor(segmentCount * 0.60);
  const middleSize = Math.floor(segmentCount * ANALYSIS_CONFIG.SAMPLE_MIDDLE_PERCENT);
  const endStart = Math.floor(segmentCount * (1 - ANALYSIS_CONFIG.SAMPLE_END_PERCENT));
  
  // Extract samples
  const beginning = segments.slice(0, beginIdx);
  const middle = segments.slice(middleStart, middleStart + middleSize);
  const end = segments.slice(endStart);
  
  const sampled = [...beginning, ...middle, ...end];
  const sampledText = sampled.map(s => s.text).join('\n');
  const sampledWords = sampledText.split(/\s+/).filter(w => w.length > 0).length;
  
  console.log(`⚡ Sampled ${role} transcript:`);
  console.log(`   - Beginning: ${beginning.length} segments (${ANALYSIS_CONFIG.SAMPLE_BEGINNING_PERCENT * 100}%)`);
  console.log(`   - Middle: ${middle.length} segments (${ANALYSIS_CONFIG.SAMPLE_MIDDLE_PERCENT * 100}%)`);
  console.log(`   - End: ${end.length} segments (${ANALYSIS_CONFIG.SAMPLE_END_PERCENT * 100}%)`);
  console.log(`   - Total: ${sampled.length}/${segmentCount} segments, ${sampledWords} words`);
  console.log(`   - Reduction: ${((1 - sampledWords/wordCount) * 100).toFixed(1)}%`);
  
  return sampledText;
}

const CORRECTION_SYSTEM_MESSAGE = `
You are an expert MULTILINGUAL language teacher.

Your job:
- Receive short pieces of TRANSCRIBED SPOKEN LANGUAGE.
- Correct ONLY REAL grammatical / usage errors.
- Return structured JSON using the provided schema.
- You MUST remain LANGUAGE-AGNOSTIC and work for any language.

========================
GENERAL PRINCIPLES
========================
1. The input text is a transcript of SPEECH, not writing.
   - Speakers do NOT spell or punctuate when they talk.
   - Many oddities are due to speech-to-text transcription, not the speaker.

2. Work in the SAME language as the input text.
   - Do NOT translate into another language.
   - If a language code is provided, assume that language unless the text clearly contradicts it.
   - If no language code is provided, detect the language and return it in "detected_language".

3. You must make MINIMAL changes.
   - Preserve the speaker's meaning and style.
   - Do NOT rewrite everything to sound "fancier" or more formal.
   - Only touch words that are clearly wrong for grammar/usage.

========================
WHAT YOU MAY CORRECT
========================
You may ONLY correct:

- Grammar (person/number/case agreement, word order, required auxiliaries, etc.)
- Tense / aspect / mood
- Agreement (subject–verb, noun–adjective, pronoun–antecedent, etc.)
- Prepositions and case markers
- Clear word-choice errors where the chosen word is incorrect in context
- Missing or extra function words (articles, clitics, particles, pronouns) when this creates a grammatical error

You must NOT treat as errors:

- Punctuation choices (commas, periods, etc.)
- Capitalization
- Pure “spelling” differences in transcribed speech, unless they clearly change the word to a different, incorrect word
- Vulgar language, slang, or informal words that are valid in the language
- Regional variants that are grammatically acceptable

========================
SEVERITY LEVELS
========================
For every change, assign a severity:

- "error": Grammatically wrong in standard language, regardless of style.
- "style": Grammatically acceptable, but a more natural or standard alternative exists.
- "optional": Very minor, purely stylistic or register-based suggestion.

If something is grammatically correct but you would slightly prefer another form, use "style" or "optional", NOT "error".

========================
SUBJECT / AGREEMENT SAFETY RULES (CRITICAL, LANGUAGE-AGNOSTIC)
========================
Agreement mistakes are easy to misjudge in transcripts. To avoid false positives:

1. NEVER assume the subject is the speaker ("I", "yo", etc.) just because it is a monologue.
   - Subject can be the speaker, another person, or an object previously mentioned.

2. Only mark subject–verb agreement as an "error" when the subject is EXPLICIT and UNAMBIGUOUS:
   - There is a clear subject pronoun (I/you/he/she/we/they, yo/tú/él/ella, etc.), OR
   - There is a clear noun phrase that must be the subject in that clause, and the verb form clearly does not match.

   Examples of REAL agreement errors:
   - "I goes", "he go", "yo duermoS", "nosotros habla", "she sleep in that room".
   - Subject and verb person/number clearly conflict and there is no alternative valid reading.

3. If the subject could reasonably be more than one person (speaker vs someone else), and BOTH verb forms would be grammatical with different meanings:
   - DO NOT treat this as an error.
   - At most, you may suggest an alternative as "style" if context strongly hints one meaning, but avoid changing it if you are not 100% sure.

4. Relative clauses and similar structures:
   - In patterns like "the room where he sleeps", "el cuarto en el que duerme", "la personne qui dort", "das Zimmer, in dem er schläft":
     * The subject of the verb inside the clause is the thing/person being referred to.
     * Both “he sleeps” and “I sleep” can be correct in different sentences.
   - ONLY change "sleeps" → "sleep" / "duerme" → "duermo" etc. if the SUBJECT in that clause is explicitly the speaker and the current form is impossible.

5. If you are NOT completely certain that an agreement pattern is wrong in context, you MUST:
   - Either leave it unchanged, OR
   - Mark the suggestion as "style" or "optional", NOT "error".

========================
TRANSCRIPTION ARTIFACTS (CRITICAL)
========================
The text comes from automatic speech recognition and may contain transcription errors.

You must NOT mark as "error":

- Misheard or garbled words that do not form a meaningful alternative.
- Slight letter/character differences that sound similar (e.g., nearby sounds in that language) IF both could be valid pronunciation.
- Broken or incomplete sentences at the end of segments.
- Advertising / system messages that may have been inserted by the platform.

When you suspect a transcription artifact:
- Prefer to IGNORE it rather than "correcting" it.
- Only correct if the speaker’s intended phrase is VERY clear and the current form is not a valid word/structure in the language.

SPECIAL CASE: FUSED OR GARBLED "WORDS"

Many speech-to-text systems fuse multiple spoken words into a single token, or output non-words.

Examples (language-agnostic idea):
- "costumbrarselegir" → "acostumbrarse a elegir"
- "dontknow" → "don't know"
- "cierno" → "cierto"

When you see a token in the original text that:
- is very long, contains multiple morphemes, or is not a normal word in the language, AND
- your correction splits it into several words or fixes it to a normal word,

you MUST treat this as a **probable transcription artifact**, NOT a learner grammar error.

In these cases:
- Set severity to "optional" (or "style" if you strongly prefer the corrected form).
- In the "reason", explicitly mention "likely transcription artifact".
- type may still be "word_choice" or "grammar", but it is NOT an "error".
- DO NOT let such changes affect the learner's proficiency level or grammar accuracy.

If you are unsure whether something is a real word or an ASR artifact, PREFER to treat it as a transcription artifact and use severity "optional".

========================
INCOMPLETE / SPOKEN SENTENCES
========================
Do NOT treat normal spoken phenomena as errors:

- Sentence fragments, false starts, or self-corrections.
- Incomplete sentences that trail off.
- Discourse markers and fillers (e.g., “like”, “you know”, “bueno”, “pues”, “ehm”, etc.).

These are natural in speech. Only correct them if they create a true grammatical error inside the part that is actually spoken.

========================
OUTPUT REQUIREMENTS
========================
1. Keep the corrected text in the SAME language as the input.
2. Make only the MINIMAL set of changes needed.
3. Use the JSON schema exactly as specified:
   - "detected_language"
   - "language_confidence"
   - "corrected_text"
   - "overall_comment"
   - "changes": [ { "original", "corrected", "type", "reason", "severity" } ]

4. "type" must be one of:
   - "grammar"
   - "tense"
   - "preposition"
   - "agreement"
   - "word_choice"

5. Do NOT invent changes just to fill the list.
   - If you find no real errors, "changes" may be an empty array.
   - In that case, "corrected_text" should be identical (or nearly identical) to the input.
   

6. Respond ONLY with valid JSON according to the provided schema. Do NOT include any extra commentary outside the JSON.

7. These rules apply to ALL languages. Examples are illustrative only and do not imply that the rule is limited to the languages shown.

`;  
// Language-agnostic correction schema
const multilingualCorrectionSchema = {
  name: "MultilingualCorrectionResponse",
  schema: {
    type: "object",
    properties: {
      detected_language: { type: "string" },
      language_confidence: { type: "number" },
      corrected_text: { type: "string" },
      overall_comment: { type: "string" },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            original: { type: "string" },
            corrected: { type: "string" },
            type: {
              type: "string",
              enum: [
                "grammar",
                "tense",
                "preposition",
                "agreement",
                "word_choice",
              ],
            },
            reason: { type: "string" },
            severity: {
              type: "string",
              enum: ["error", "style", "optional"],
            },
          },
          required: ["original", "corrected", "type", "reason", "severity"],
          additionalProperties: false,
        },
      },
    },
    required: ["detected_language", "language_confidence", "corrected_text", "overall_comment", "changes"],
    additionalProperties: false,
  },
  strict: true,
};

/**
 * Correct text using structured GPT-4 with JSON schema (professional-grade accuracy)
 * @param {string} text - Text to correct
 * @param {string} languageCode - ISO language code (es, en, fr, etc.)
 * @returns {Promise<Object>} - Structured correction results
 */
async function correctTextWithStructuredOutput(text, languageCode) {
  try {
    console.log(`🔍 Structured Correction: Analyzing ${text.length} characters in ${languageCode}...`);
    
    const userPrompt = `
You will correct the following text.

If a language_code is provided, assume the text is written in that language.
If it's missing or seems inconsistent, detect the real language and use that.

language_code: ${languageCode || "null"}

TEXT:
${text}

IMPORTANT GUIDELINES:
- This is SPOKEN language (transcription), so colloquialisms and informal expressions are normal and acceptable
- Only mark things as "error" if they are grammatically incorrect in standard language
- Discourse markers, fillers, and colloquial variants should be marked as "style" or "optional", not "error"
- Preserve the natural, spoken quality of the text
- For Spanish: "es que", "pues", dropping "de" in "darse cuenta que" are colloquial but acceptable - mark as "style" if suggesting changes
- Regional variations in prepositions (e.g., "subir en el coche" vs "subir al coche") are both acceptable - mark as "style" if suggesting standardization
- DO NOT "correct" vulgar language, slang, or offensive words - if the speaker said it intentionally, preserve it
- DO NOT "correct" valid words just because they might be considered inappropriate - preserve what was actually said
- DO NOT mark incomplete sentences as errors - if a sentence is cut off (ends with "..."), that's normal in speech, not an error
- DO NOT try to "complete" or "correct" incomplete sentences - incomplete speech is normal in conversations
- Before correcting spelling, verify the correction makes sense in context - if the "corrected" version is nonsensical, the original is likely correct
- Skip obvious transcription errors or advertisements - they should have been filtered already
`;

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-2024-08-06",
      temperature: 0,
      messages: [
        { role: "system", content: CORRECTION_SYSTEM_MESSAGE },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: multilingualCorrectionSchema,
      },
    });

    const result = JSON.parse(response.choices[0].message.content);
    
    console.log(`✅ Structured Correction: Found ${result.changes.length} corrections`);
    if (result.changes.length > 0) {
      console.log(`📝 Sample corrections (first 3):`);
      result.changes.slice(0, 3).forEach((change, i) => {
        console.log(`   ${i+1}. "${change.original}" → "${change.corrected}"`);
        console.log(`      Reason: ${change.reason}`);
        console.log(`      Type: ${change.type}, Severity: ${change.severity}`);
      });
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Structured correction error:', error.message);
    // Return minimal valid structure if correction fails
    return {
      detected_language: languageCode || 'unknown',
      language_confidence: 0,
      corrected_text: text,
      overall_comment: 'Correction unavailable',
      changes: []
    };
  }
}

/**
 * Transcribe audio using OpenAI Whisper API
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} language - Language code (e.g., 'es' for Spanish, 'en' for English)
 * @returns {Promise<{text: string, segments: Array}>}
 */
/**
 * Transcribe audio using OpenAI Whisper API
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} language - Language code (e.g., 'es' for Spanish, 'en' for English)
 * @returns {Promise<{text: string, segments: Array}>}
 */
async function transcribeAudio(audioBuffer, targetLanguage = 'en', speaker = 'student') {
  try {
    console.log(`🎙️ Transcribing audio for ${speaker} in target language: ${targetLanguage}`);
    console.log(`🎙️ Audio buffer size: ${audioBuffer.length} bytes`);
    
    // Validate buffer
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }
    
    console.log(`🎙️ Calling Whisper API with language: "${targetLanguage}"...`);
    
    // Detect actual file type from buffer
    const isMP3 = audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0; // MP3 magic bytes
    const isWebM = audioBuffer[0] === 0x1A && audioBuffer[1] === 0x45 && audioBuffer[2] === 0xDF && audioBuffer[3] === 0xA3; // WebM magic bytes
    
    // Determine file type and name
    let fileType, fileName;
    if (isMP3) {
      fileType = 'audio/mpeg';
      fileName = 'audio.mp3';
    } else if (isWebM) {
      fileType = 'audio/webm'; // Whisper accepts WebM with Opus codec
      fileName = 'audio.webm';
    } else {
      // Default to mp3 if we can't detect (assume conversion happened)
      fileType = 'audio/mpeg';
      fileName = 'audio.mp3';
    }
    
    console.log(`📝 Detected file type: ${fileType} (isMP3: ${isMP3}, isWebM: ${isWebM})`);
    
    // Create a proper File object using OpenAI's toFile utility
    const fileForUpload = await OpenAI.toFile(audioBuffer, fileName, {
      type: fileType
    });
    
    console.log(`🎙️ File created for upload:`, {
      name: fileForUpload.name,
      type: fileForUpload.type,
      size: fileForUpload.size
    });
    
    const transcription = await getOpenAIClient().audio.transcriptions.create({
      file: fileForUpload,
      model: 'whisper-1',
      language: targetLanguage, // Target language hint for Whisper
      response_format: 'verbose_json', // Get timestamps and segments
      timestamp_granularities: ['segment']
    });
    
    console.log(`✅ Raw transcription completed: ${transcription.segments?.length || 0} segments`);
    
    // Filter segments - only keep those in the target language
    const filteredSegments = transcription.segments?.filter(segment => {
      // Whisper detects language per segment
      const segmentLanguage = segment.language || targetLanguage;
      const isTargetLanguage = segmentLanguage === targetLanguage;
      
      if (!isTargetLanguage) {
        console.log(`⏭️  Skipping segment in ${segmentLanguage}: "${segment.text}"`);
      }
      
      return isTargetLanguage;
    }) || [];
    
    // Reconstruct text from filtered segments
    const filteredText = filteredSegments.map(s => s.text).join(' ').trim();
    
    console.log(`✅ Filtered transcription: ${filteredSegments.length} segments in ${targetLanguage}`);
    console.log(`📝 Final text: "${filteredText}"`);
    
    return {
      text: filteredText,
      segments: filteredSegments,
      language: targetLanguage,
      duration: transcription.duration,
      originalSegmentCount: transcription.segments?.length || 0,
      filteredSegmentCount: filteredSegments.length
    };
    
  } catch (error) {
    console.error('❌ Error transcribing audio:', error.message);
    console.error('❌ Language code used:', targetLanguage);
    console.error('❌ Full error:', error);
    console.error('❌ Error response:', error.response?.data);
    
    // Provide more helpful error message
    if (error.message && error.message.includes('language')) {
      throw new Error(`Transcription failed: Invalid language code "${targetLanguage}". Must be a valid ISO-639-1 code (e.g., es, en, fr).`);
    }
    
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

/**
 * Analyze lesson transcript using GPT-4
 * @param {Object} params - Analysis parameters
 * @returns {Promise<Object>} - Analysis results
 */
async function analyzeLessonTranscript({
  transcript,
  language,
  studentNativeLanguage = 'en',  // NEW: Language for feedback
  studentSegments,
  tutorSegments,
  previousAnalyses = []
}) {
  try {
    console.log(`🤖 ========================================`);
    console.log(`🤖 STARTING GPT-4 ANALYSIS`);
    console.log(`🤖 ========================================`);
    console.log(`🤖 Analyzing lesson transcript for ${language} learning...`);
    
    // CRITICAL: Verify we have actual student data
    if (!studentSegments || studentSegments.length === 0) {
      throw new Error('CRITICAL ERROR: No student segments provided to GPT-4. Cannot analyze empty transcript.');
    }
    
    // Calculate lesson duration estimate (segments typically ~5-10 seconds each)
    const estimatedMinutes = Math.ceil(studentSegments.length * 0.15); // rough estimate
    const speakingTimeMinutes = estimatedMinutes; // Use for prompt variable
    console.log(`📊 Estimated lesson duration: ~${estimatedMinutes} minutes`);
    console.log(`📊 Student segments: ${studentSegments.length}`);
    console.log(`📊 Tutor segments: ${tutorSegments.length}`);
    
    // Count total words for quality check
    const totalStudentWords = studentSegments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
    const totalTutorWords = tutorSegments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
    
    // LESSON TYPE DETECTION (Language-agnostic)
    const lessonContext = {
      hasTutorSpeech: tutorSegments.length > 0,
      studentTutorRatio: totalStudentWords / (totalTutorWords || 1),
      lessonType: null,
      analysisInstructions: ''
    };
    
    if (!lessonContext.hasTutorSpeech) {
      lessonContext.lessonType = 'solo_reading_practice';
      lessonContext.analysisInstructions = `
⚠️ LESSON CONTEXT: This appears to be SOLO READING PRACTICE (no tutor speech detected).

IMPORTANT INSTRUCTIONS:
- The student is reading or practicing from source material (articles, stories, videos, etc.)
- DO NOT penalize the student for slang, colloquialisms, or regional dialects in the content
- Regional variations are VALID and not errors
- Focus on: pronunciation fluency, reading comprehension, and natural delivery
- ONLY flag vocabulary/grammar errors if the student MISREAD or MISPRONOUNCED something
- If content contains slang/informal language, note it as "exposure to authentic materials" in strengths`;
      
      console.log(`🎯 Lesson Type: SOLO READING PRACTICE - Will adjust analysis criteria`);
    } else if (lessonContext.studentTutorRatio > 4) {
      lessonContext.lessonType = 'student_speaking_practice';
      lessonContext.analysisInstructions = `
⚠️ LESSON CONTEXT: STUDENT-DOMINATED CONVERSATION (student speaks ${lessonContext.studentTutorRatio.toFixed(1)}x more than tutor).

IMPORTANT INSTRUCTIONS:
- This is speaking practice where student is doing most of the talking
- Focus on natural conversation skills, grammar, and vocabulary choices
- Regional dialects and colloquialisms are acceptable if used correctly in context
- Prioritize: grammar accuracy, appropriate vocabulary choices, and conversational fluency`;
      
      console.log(`🎯 Lesson Type: STUDENT SPEAKING PRACTICE - Student dominates conversation`);
    } else if (lessonContext.studentTutorRatio < 0.5) {
      lessonContext.lessonType = 'tutor_instruction';
      lessonContext.analysisInstructions = `
⚠️ LESSON CONTEXT: TUTOR-LED INSTRUCTION (tutor speaks ${(1/lessonContext.studentTutorRatio).toFixed(1)}x more than student).

IMPORTANT INSTRUCTIONS:
- This is primarily instruction/lecture with limited student responses
- Student may be responding to specific questions or prompts
- Focus on comprehension responses and targeted practice
- Be lenient with complexity - student may be practicing specific structures`;
      
      console.log(`🎯 Lesson Type: TUTOR INSTRUCTION - Tutor-led session`);
    } else {
      lessonContext.lessonType = 'balanced_conversation';
      lessonContext.analysisInstructions = `
⚠️ LESSON CONTEXT: BALANCED CONVERSATION (student ratio: ${lessonContext.studentTutorRatio.toFixed(1)}).

IMPORTANT INSTRUCTIONS:
- Natural back-and-forth conversation
- Analyze full range of skills: grammar, vocabulary, fluency, comprehension
- Regional variations and appropriate colloquialisms are acceptable`;
      
      console.log(`🎯 Lesson Type: BALANCED CONVERSATION - Normal lesson flow`);
    }
    
    console.log(`📊 Student words: ${totalStudentWords}, Tutor words: ${totalTutorWords}`);
    
    if (totalStudentWords < ANALYSIS_CONFIG.MIN_WORDS_FOR_ANALYSIS) {
      console.warn(`⚠️  Very short transcript (${totalStudentWords} words). Analysis may be limited.`);
    }
    
    if (totalStudentWords > ANALYSIS_CONFIG.WARN_THRESHOLD_WORDS) {
      console.log(`📊 Long transcript detected (${totalStudentWords} words) - will use intelligent sampling`);
    }
    
    // Build context from previous lessons with detailed metrics
    const previousContext = previousAnalyses.length > 0 
      ? `\n\n📊 PREVIOUS LESSON HISTORY (for progression tracking):\n${previousAnalyses.map((a, i) => 
          `\n${i === 0 ? '📌 MOST RECENT LESSON' : `Previous Lesson ${i + 1}`} (${new Date(a.lessonDate).toLocaleDateString()}):\n` +
          `- Proficiency Level: ${a.overallAssessment.proficiencyLevel}\n` +
          `- Grammar Accuracy: ${a.grammarAnalysis?.accuracyScore || 'N/A'}%\n` +
          `- Fluency Score: ${a.fluencyAnalysis?.overallFluencyScore || 'N/A'}/100\n` +
          `- Vocabulary: ${a.vocabularyAnalysis?.uniqueWordCount || 'N/A'} unique words\n` +
          `- Error Rate: ${a.progressionMetrics?.errorRate || 'N/A'} errors/min\n` +
          `- Speaking Time: ${a.progressionMetrics?.speakingTimeMinutes || 'N/A'} min\n` +
          `- Complex Sentences: ${a.progressionMetrics?.complexSentencesUsed || 'N/A'}\n` +
          `- Topics: ${a.topicsDiscussed?.join(', ') || 'N/A'}\n` +
          `- Mistakes: ${a.grammarAnalysis?.mistakeTypes?.map(m => `${m.type} (${m.frequency}x)`).join(', ') || 'N/A'}\n` +
          `- Persistent Issues: ${a.progressionMetrics?.persistentChallenges?.join(', ') || a.areasForImprovement?.join(', ') || 'N/A'}\n` +
          `- Summary: ${a.overallAssessment.summary}`
        ).join('\n')}\n\n🎯 CRITICAL: For "previousProficiencyLevel" use the level from the MOST RECENT LESSON above (${previousAnalyses[0].overallAssessment.proficiencyLevel}). Compare this current lesson to that MOST RECENT lesson with SPECIFIC NUMBERS and CONCRETE EXAMPLES. Do NOT use vague terms like "slight improvement" or "some progress".`
      : '\n\n📊 FIRST LESSON: This is the student\'s first analyzed lesson. Establish baseline metrics.';
    
    // Sample transcripts intelligently for long lessons
    console.log(`\n🎯 ========================================`);
    console.log(`🎯 PREPARING TRANSCRIPTS FOR ANALYSIS`);
    console.log(`🎯 ========================================`);
    
    let studentText = sampleTranscript(studentSegments, ANALYSIS_CONFIG.MAX_STUDENT_WORDS, 'student');
    const tutorText = sampleTranscript(tutorSegments, ANALYSIS_CONFIG.MAX_TUTOR_WORDS, 'tutor');
    
    // Clean transcript: remove incomplete sentences and transcription errors
    console.log(`\n🧹 ========================================`);
    console.log(`🧹 CLEANING TRANSCRIPT...`);
    console.log(`🧹 ========================================`);
    studentText = cleanTranscript(studentText);
    
    // STEP 1: Get structured corrections using GPT-4 with JSON schema
    console.log(`\n🔍 ========================================`);
    console.log(`🔍 STEP 1: Running Structured Grammar Correction...`);
    console.log(`🔍 ========================================`);
    
    const correctionResult = await correctTextWithStructuredOutput(studentText, language);
    
    // Filter out punctuation errors - they're likely transcription artifacts from Whisper
    let meaningfulCorrections = correctionResult.changes.filter(change => 
      change.type !== 'punctuation' && change.type !== 'spelling'
    );
    const filteredCount = correctionResult.changes.length - meaningfulCorrections.length;
    
    if (filteredCount > 0) {
      console.log(`⚠️  Filtered out ${filteredCount} punctuation/spelling errors (transcription artifacts)`);
    }
    
    // Validate corrections - filter out nonsensical ones
    // Common issue: Model tries to "sanitize" vulgar language or makes incorrect corrections
    const validatedCorrections = meaningfulCorrections.filter(change => {
      const originalLower = change.original.toLowerCase().trim();
      const correctedLower = change.corrected.toLowerCase().trim();
      
      // Skip if original and corrected are the same
      if (originalLower === correctedLower) {
        console.log(`⏭️  Skipping correction where original = corrected: "${change.original}"`);
        return false;
      }
      
      // Skip corrections that are ONLY adding accent marks (written conventions, not spoken errors)
      // Remove all accent marks and compare - if they're the same, it's just an accent difference
      const removeAccents = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const originalNoAccents = removeAccents(originalLower);
      const correctedNoAccents = removeAccents(correctedLower);
      
      if (originalNoAccents === correctedNoAccents) {
        console.log(`⏭️  Skipping accent mark correction (transcription artifact): "${change.original}" → "${change.corrected}"`);
        return false;
      }
      
      // Skip corrections that try to "complete" incomplete sentences
      // If original ends with "..." or is clearly incomplete, don't mark as error
      if (change.original.endsWith('...') || 
          change.original.match(/^[A-Za-záéíóúñÁÉÍÓÚÑ]{1,3}\s*\.\.\.?\s*$/i)) {
        console.log(`⏭️  Skipping correction of incomplete sentence: "${change.original}" → "${change.corrected}"`);
        return false;
      }
      
      // Skip if correction is trying to complete a sentence that was cut off
      // Check if original is very short and corrected adds significant content
      const originalWords = change.original.split(/\s+/).length;
      const correctedWords = change.corrected.split(/\s+/).length;
      if (originalWords <= 3 && correctedWords > originalWords + 2) {
        console.log(`⏭️  Skipping correction that tries to complete sentence: "${change.original}" → "${change.corrected}"`);
        return false;
      }
      
      return true;
    });
    
    const invalidCount = meaningfulCorrections.length - validatedCorrections.length;
    if (invalidCount > 0) {
      console.log(`⚠️  Filtered out ${invalidCount} invalid/nonsensical corrections`);
    }
    
    meaningfulCorrections = validatedCorrections;
    
    // Filter out fused word transcription artifacts (code-level heuristic)
    // This catches cases where ASR fused multiple words into one token
    const beforeFusedFilter = meaningfulCorrections.length;
    meaningfulCorrections = meaningfulCorrections.filter(change => {
      if (change.type === 'word_choice' || change.type === 'grammar') {
        if (isFusedWordTranscription(change.original, change.corrected)) {
          console.log(
            `⏭️  Treating fused word as transcription artifact: ` +
            `"${change.original}" → "${change.corrected}"`
          );
          return false;  // don't treat as a real error
        }
      }
      return true;
    });
    
    const filteredFused = beforeFusedFilter - meaningfulCorrections.length;
    if (filteredFused > 0) {
      console.log(`⚠️  Filtered out ${filteredFused} fused word transcription artifacts`);
    }
    
    console.log(`✅ Structured Correction found ${meaningfulCorrections.length} meaningful corrections`);
    if (meaningfulCorrections.length > 0) {
      console.log(`📝 Sample corrections (first 3):`);
      meaningfulCorrections.slice(0, 3).forEach((change, i) => {
        console.log(`   ${i+1}. "${change.original}" → "${change.corrected}"`);
        console.log(`      ${change.reason} (${change.type}, ${change.severity})`);
      });
    }
    
    // FIX 1: Filter by severity === "error" only (exclude "style" and "optional")
    // This prevents minor stylistic suggestions from affecting grammar scores
    const beforeSeverityFilter = meaningfulCorrections.length;
    meaningfulCorrections = meaningfulCorrections.filter(change => {
      if (change.severity !== 'error') {
        console.log(
          `⏭️  Ignoring non-error correction (severity=${change.severity}): ` +
          `"${change.original}" → "${change.corrected}"`
        );
        return false;
      }
      return true;
    });
    
    const filteredBySeverity = beforeSeverityFilter - meaningfulCorrections.length;
    if (filteredBySeverity > 0) {
      console.log(`⚠️  Filtered out ${filteredBySeverity} style/optional corrections (keeping only severity="error")`);
    }
    
    console.log(`✅ Final verified error count: ${meaningfulCorrections.length}`);
    
    // Store verified error count for prompt
    const verifiedErrorCount = meaningfulCorrections.length;
    
    // Format corrections for GPT-4 analysis (using filtered corrections)
    const correctionsContext = meaningfulCorrections.length > 0 
      ? `\n\n🔍 VERIFIED GRAMMAR CORRECTIONS (GPT-4 Structured Output):\n` +
        `Language: ${correctionResult.detected_language} (confidence: ${correctionResult.language_confidence})\n` +
        `Found ${meaningfulCorrections.length} meaningful corrections (punctuation/spelling/style suggestions excluded - ONLY real errors):\n\n` +
        meaningfulCorrections.map((change, i) => 
          `${i + 1}. "${change.original}" → "${change.corrected}"\n` +
          `   Type: ${change.type}\n` +
          `   Reason: ${change.reason}\n` +
          `   Severity: ${change.severity}\n`
        ).join('\n') +
        `\nOverall: ${correctionResult.overall_comment}\n` +
        `\n**Use these verified corrections for your grammarAnalysis.mistakeTypes. Group them by type and severity.**`
      : '\n\n🔍 VERIFIED_ERROR_COUNT: 0 - No real grammatical errors detected. (Style/optional suggestions were filtered out.)\n';
    
    // Estimate tokens and cost AFTER getting corrections
    const studentTokens = estimateTokens(studentText);
    const tutorTokens = estimateTokens(tutorText);
    const contextTokens = estimateTokens(previousContext + correctionsContext);
    const totalInputTokens = studentTokens + tutorTokens + contextTokens + 1000; // +1000 for prompt
    
    const costEstimate = estimateCost(totalInputTokens);
    
    console.log(`\n💰 COST ESTIMATION:`);
    console.log(`   Input tokens: ~${totalInputTokens.toLocaleString()}`);
    console.log(`   Output tokens: ~2,000 (estimated)`);
    console.log(`   Estimated cost: $${costEstimate.totalCost} (input: $${costEstimate.inputCost}, output: $${costEstimate.outputCost})`);
    
    if (totalInputTokens > ANALYSIS_CONFIG.MAX_TOTAL_TOKENS) {
      console.warn(`⚠️  Token count (${totalInputTokens}) exceeds soft limit (${ANALYSIS_CONFIG.MAX_TOTAL_TOKENS})`);
      console.warn(`⚠️  Consider increasing sampling to reduce cost`);
    }
    
    // CRITICAL DEBUG: Log what we're sending to GPT-4
    console.log(`🤖 ========================================`);
    console.log(`🤖 STUDENT TRANSCRIPT BEING SENT TO GPT-4:`);
    console.log(`🤖 ========================================`);
    console.log(studentText.substring(0, 500) + (studentText.length > 500 ? '...' : ''));
    console.log(`🤖 ========================================`);
    console.log(`🤖 Total student text length: ${studentText.length} characters`);
    console.log(`🤖 Total tutor text length: ${tutorText.length} characters`);
    console.log(`🤖 ========================================`);
    
    const prompt = `You are an expert ${language} language teacher analyzing a student's lesson.
${lessonContext.analysisInstructions}

STUDENT'S TRANSCRIPT:
${studentText}

TUTOR'S TRANSCRIPT:
${tutorText}
${correctionsContext}
${previousContext}

**CRITICAL INSTRUCTIONS:**
1. Analyze ONLY the student transcript above - do not use generic templates
2. Extract topicsDiscussed from what the student ACTUALLY said (e.g., "going to the supermarket and meeting a friend" NOT "daily routines")
3. Create homework based on what they ACTUALLY discussed - reference SPECIFIC things they talked about (e.g., "Write about YOUR experience at the supermarket yesterday" NOT "Write a short story")
4. Use the verified corrections for grammarAnalysis.mistakeTypes
5. All examples must be EXACT quotes from the transcript above
6. **REGIONAL DIALECT & SLANG HANDLING** (Language-agnostic):
   - Regional variations (e.g., Mexican vs Castilian Spanish, Brazilian vs European Portuguese) are VALID
   - Slang and colloquialisms are acceptable if used appropriately in context
   - ONLY flag as errors if: (a) student misused a word, or (b) made grammatical mistakes
   - DO NOT penalize authentic regional expressions or slang that matches the content being practiced
   - If lesson type is "solo_reading_practice": assume slang/colloquialisms are from source material
7. For progressFromLastLesson: 
   - **CRITICAL**: You MUST use the EXACT grammar accuracy score from the "PREVIOUS LESSON HISTORY" section above. DO NOT make up or hallucinate previous scores.
   - **REQUIRED**: Calculate change using: (current grammarAnalysis.accuracyScore) - (previous lesson's Grammar Accuracy from history section)
   - If proficiency level is C2 (native/near-native) **AND current lesson also shows C2-level performance with no significant errors**, leave empty or state "Native speaker - comparisons not applicable"
   - If first lesson, state "First analyzed lesson - baseline established at [LEVEL] level with [X]% grammar accuracy."
   - Otherwise, be SPECIFIC with numbers and comparisons. NO second-person pronouns (no "you", "your"). FORBIDDEN phrases: "slight improvement", "some progress", "generally better", "you made", "vocabulary expanded". 
   - **EXAMPLE**: If previous lesson shows "Grammar Accuracy: 85%" and current is 92%, write: "Grammar accuracy improved from 85% to 92%." NOT "declined from 98% to 92%"
   - DO NOT mention vocabulary expansion - focus on grammar and errors only.
8. For summary in overallAssessment: Use third-person or describe topics objectively (e.g., "Discussed going to the supermarket and meeting a friend" NOT "You discussed...")
9. **FIND ALL MEANINGFUL ERRORS - COMPREHENSIVE ANALYSIS**: 
   - **"Meaningful" = errors that indicate areas for improvement, NOT only critical/severe errors**
   - **LESSON LENGTH CONTEXT** (speaking time: ${speakingTimeMinutes} minutes):
     ${speakingTimeMinutes > 20 ? `
     - This is a LONG conversation (${speakingTimeMinutes} min). Identify 6-12 error patterns for comprehensive feedback.
     - Include minor/moderate patterns if they repeat (frequency ≥ 2)
     - Students need detailed feedback for extended practice sessions` : ''}
     ${speakingTimeMinutes >= 10 && speakingTimeMinutes <= 20 ? `
     - This is a STANDARD conversation (${speakingTimeMinutes} min). Identify 4-8 error patterns.
     - Include all recurring patterns, not just critical ones` : ''}
     ${speakingTimeMinutes < 10 ? `
     - This is a SHORT conversation (${speakingTimeMinutes} min). Identify 3-6 most important error patterns.
     - Focus on patterns that repeat or indicate systematic issues` : ''}
   - **CRITICAL**: If errors are found (agreement, tense, vocabulary, preposition, reflexive verbs, word choice), proficiency level MUST reflect this
   - Real errors → downgrade from C2 to C1 or B2 depending on severity
   - 1-2 minor errors → C1 (Advanced)
   - 3+ errors or systematic issues → B2 (Upper Intermediate) or lower
   - **ERROR CATEGORIES TO CHECK** (don't skip any):
     * Tense errors (preterite/imperfect confusion, present/past mixing)
     * Agreement errors (gender, number)
     * Reflexive verb errors (missing 'se', 'me', 'te')
     * Preposition errors (missing or incorrect)
     * Word choice errors (wrong verb, noun, or adjective)
     * Conjugation errors
   - For C2/native assessment: Written accent marks (like á, é, í, ó, ú) in spoken transcription are NOT errors - native speakers naturally omit these when speaking
   - For C1 speakers: Look for genuine errors. May have 2-4 error patterns.
   - For B2 and below: Identify all actual learning opportunities
   - Examples of things that are NOT errors: missing written accents in transcription, colloquialisms, informal expressions, discourse markers, regional variations
   - Examples of things that ARE errors: agreement mistakes ("llenado" vs "lleno"), wrong verb choice ("miraba" vs "veía"), missing prepositions ("desde meses" vs "desde hace meses"), missing reflexive ("relajé" vs "me relajé")
9. **CRITICAL - COMPLETE ERROR EXAMPLES**: For each errorPattern, the number of examples MUST match the frequency count. If frequency is 3, provide 3 examples. If frequency is 2, provide 2 examples. DO NOT summarize or provide fewer examples than the frequency indicates - students need to see ALL their mistakes.
10. **IGNORE PUNCTUATION ERRORS**: Do NOT include punctuation errors in your analysis. Punctuation issues in transcripts are typically transcription artifacts from speech-to-text, not actual student mistakes. Focus on grammar, tenses, vocabulary, and word choice.
11. **NO "SPELLING ERRORS"**: There is NO spelling in spoken language. All text is transcribed speech. What might look like "spelling errors" are actually transcription artifacts from the speech-to-text system mishearing. DO NOT flag spelling errors - they don't exist in spoken language.
12. **IGNORE ACCENT MARK "ERRORS" IN TRANSCRIPTION**: Missing written accent marks (diacritics, tone marks) in transcribed speech are NOT errors - these are transcription artifacts. Native speakers do not "pronounce" written accent marks. If the ONLY difference is accent marks, this is NOT a meaningful error to report.
12. **IGNORE INCOMPLETE SENTENCES**: Do NOT mark incomplete sentences (those ending with "..." or cut off mid-word) as errors. Incomplete speech is normal in conversations - people pause, get interrupted, or change their mind. Only mark actual grammar errors in complete sentences.
13. **IGNORE TRANSCRIPTION ERRORS**: Do NOT include obvious transcription errors (like advertisements, unrelated content, or system messages) in your analysis. These should have been filtered out already, but if you see any, skip them.

**🎯 VERIFIED_ERROR_COUNT: ${verifiedErrorCount}**

**CRITICAL - USE VERIFIED_ERROR_COUNT TO SET SCORES AND LEVEL:**

The VERIFIED_ERROR_COUNT above represents ONLY real grammatical errors (severity="error"). Style suggestions and optional improvements have been filtered out.

**YOU MUST tie grammarAccuracy and proficiencyLevel directly to VERIFIED_ERROR_COUNT:**

- **If VERIFIED_ERROR_COUNT === 0:**
  * grammarAnalysis.accuracyScore MUST be between 95 and 100
  * proficiencyLevel MUST be C2 (Native/Near-Native) if speech is fluent and natural
  * errorPatterns MUST be an empty array []
  * conversationQuality MUST be "advanced" or "native-like"
  * overallFluencyScore MUST be at least 85
  * **DO NOT output B2 with 75% grammar if there are ZERO errors!**

- **If VERIFIED_ERROR_COUNT is 1-2 and all are low/moderate severity:**
  * grammarAnalysis.accuracyScore MUST be between 90 and 95
  * proficiencyLevel MUST be at least C1, and MAY be C2 if fluency is high and vocabulary is advanced
  * conversationQuality SHOULD be "advanced"
  * overallFluencyScore SHOULD be at least 80 unless there are clear pauses or hesitations

- **If VERIFIED_ERROR_COUNT is 3-5:**
  * grammarAnalysis.accuracyScore MUST be between 75 and 90
  * proficiencyLevel should be B2 or C1 depending on fluency, vocabulary complexity, and error severity
  * conversationQuality can be "intermediate" or "advanced"

- **If VERIFIED_ERROR_COUNT > 5:**
  * grammarAnalysis.accuracyScore MUST be below 80
  * proficiencyLevel should be B2 or lower
  * conversationQuality should reflect the error frequency

**EXAMPLES OF CORRECT ASSESSMENTS:**
✅ VERIFIED_ERROR_COUNT=0, fluent speech → accuracyScore=98, proficiencyLevel=C2, errorPatterns=[]
✅ VERIFIED_ERROR_COUNT=1, advanced vocab → accuracyScore=92, proficiencyLevel=C1 or C2
✅ VERIFIED_ERROR_COUNT=3, good fluency → accuracyScore=82, proficiencyLevel=B2 or C1

**EXAMPLES OF WRONG ASSESSMENTS (DO NOT DO THIS):**
❌ VERIFIED_ERROR_COUNT=0 → accuracyScore=70, proficiencyLevel=B2 (CONTRADICTORY!)
❌ VERIFIED_ERROR_COUNT=1 → accuracyScore=75, proficiencyLevel=B2 (TOO HARSH!)
❌ VERIFIED_ERROR_COUNT=5 → accuracyScore=95, proficiencyLevel=C2 (CONTRADICTORY!)

14. **PROFICIENCY LEVEL ASSESSMENT - RATE WHAT YOU SEE, NOT WHAT YOU EXPECT**: 
    - **CRITICAL**: Assess proficiency based on ACTUAL performance in THIS lesson ONLY
    - **ZERO ERRORS + NATURAL SPEECH = C2** - Do not downgrade perfect speech because of previous ratings
    - **Colloquial expressions ARE markers of high proficiency** - "ni puta gracia", "tía", "Bua" = NATIVE LEVEL
    - **Perfect grammar + natural discourse markers = C2**, regardless of previous level
    
    **Clear Guidelines:**
    - **0 errors + natural/colloquial speech**: C2 (Native/Near-Native)
    - **1-2 minor errors + advanced vocabulary**: C1-C2 (Advanced/Native)
    - **3-5 errors + good fluency**: B2-C1 (Upper-Intermediate/Advanced)
    - **6+ errors or basic mistakes**: B1-B2 (Intermediate/Upper-Intermediate)
    - **Fundamental errors (basic grammar, word order)**: A2-B1 (Elementary/Intermediate)
    
    **Recognizing Native/C2 Level:**
    - Uses colloquial expressions naturally ("tía", "Bua", "vaya", "ni puta gracia")
    - Perfect verb conjugations with no hesitation
    - Natural discourse flow with fillers/markers
    - Complex sentence structures used effortlessly
    - If all above = C2, even if previous lesson was B2
    
    **When to Downgrade from Previous Level:**
    - ONLY if you find ACTUAL ERRORS in this transcript
    - Be specific about what errors you found
    - Don't downgrade just because you "expect" errors
    
    **CRITICAL: Previous Level Is NOT a Ceiling (Fix 3):**
    - The previousProficiencyLevel is provided for context ONLY - it is NOT a maximum cap
    - **Large jumps ARE allowed** (e.g., B2 → C2, B1 → C1) when VERIFIED_ERROR_COUNT is 0 and speech is fluent and natural
    - If this lesson shows C1 or C2 performance (VERIFIED_ERROR_COUNT ≤ 1, advanced vocabulary, natural flow), you MUST upgrade even if previousProficiencyLevel was B1 or B2
    - **DO NOT "play it safe" by staying at B2** just to maintain consistency with previous level
    - Assess ONLY this lesson's actual performance, then describe the improvement in progressionMetrics.progressFromLastLesson
    - Example: If previous was B2 (75% grammar, 3 errors) and current is VERIFIED_ERROR_COUNT=0 with natural speech → Rate as C2, not B2
    - **Judge what you SEE, not what you expect based on history**
    
15. **SCORE CONSISTENCY WITH PROFICIENCY LEVEL** (CRITICAL - SCORES MUST MATCH ERRORS):
    - **If you found 0 errors → Grammar score MUST be 95-100%** (C2 level)
    - **If you found 1-2 minor errors → Grammar score 90-95%** (C1-C2 level)
    - **If you found 3-5 errors → Grammar score 80-90%** (C1-B2 level)
    - **If grammar score is 70% → You MUST have found 5+ errors** (B2 level or below)
    
    **CRITICAL: Scores MUST be consistent with:**
    1. The errors you found (or didn't find)
    2. The level you assigned
    3. Each other
    
    **Level-to-Score Mapping:**
    - **C2 (Native/Near-Native)**: 95-100% grammar, 90-100% fluency, **0-1 minor errors MAX**
    - **C1 (Advanced)**: 85-95% grammar, 80-90% fluency, **1-3 errors**
    - **B2 (Upper Intermediate)**: 75-85% grammar, 70-80% fluency, **3-6 errors**
    - **B1 (Intermediate)**: 65-75% grammar, 60-70% fluency, **6-10 errors**
    - **A2 (Elementary)**: 50-65% grammar, 40-60% fluency, **10+ errors**
    
    **Examples of WRONG/CONTRADICTORY assessments:**
    ❌ "70% grammar score, 0 errors found, B2 level" ← CONTRADICTORY! 0 errors = 95-100% grammar = C2
    ❌ "C2 level, 5 errors found, 75% grammar" ← CONTRADICTORY! 5 errors = B2 level, not C2
    ❌ "B2 level, 98% grammar, natural colloquial speech" ← CONTRADICTORY! 98% grammar + natural = C2
    
    **Examples of CORRECT assessments:**
    ✅ "0 errors found, 98% grammar, uses 'tía' and 'Bua' naturally → C2 level"
    ✅ "3 tense errors, 82% grammar, good fluency → B2 level"
    ✅ "1 agreement error, 92% grammar, advanced vocabulary → C1 level"

Respond ONLY with valid JSON:
{
  "overallAssessment": {
    "proficiencyLevel": "string (A1/A2/B1/B2/C1/C2)",
    "confidence": 85,
    "summary": "string - MUST reference specific topics from transcript (e.g., 'Discussed going to the supermarket, meeting friend Maria, and declining coffee')",
    "progressFromLastLesson": "string - **CRITICAL**: Use EXACT scores from PREVIOUS LESSON HISTORY above, DO NOT hallucinate numbers. For C2 (native) speakers with C2 performance: leave empty or 'Native speaker - comparisons not applicable'. For first lesson: 'First analyzed lesson - baseline established at [LEVEL] level with [X]% grammar accuracy.' Otherwise: MUST include specific metrics with ACTUAL numbers from previous lesson data, NO second-person pronouns. Good: 'Grammar accuracy improved from 85% to 92%' (using exact previous score). Bad: 'Grammar accuracy declined from 98% to 92%' (when previous was actually 85%), 'You made 3 fewer errors' or 'slight improvement' or 'Vocabulary expanded by X words'. DO NOT mention vocabulary expansion."
  },
  "progressionMetrics": {
    "previousProficiencyLevel": "string (A1/A2/B1/B2/C1/C2)",
    "proficiencyChange": "string (improved/maintained/declined/first_lesson)",
    "errorRate": 1.5,
    "errorRateChange": -10,
    "vocabularyGrowth": 5,
    "fluencyImprovement": 3,
    "grammarAccuracyChange": -2,
    "confidenceLevel": 5,
    "speakingTimeMinutes": 10,
    "complexSentencesUsed": 2,
    "keyImprovements": ["string"],
    "persistentChallenges": ["string"]
  },
  "errorPatterns": [
    {
      "pattern": "[Name of error pattern]",
      "frequency": 8,
      "severity": "high",
      "examples": [
        {"original": "[EXACT quote from transcript]", "corrected": "[corrected]", "explanation": "[why]"},
        {"original": "[EXACT quote from transcript]", "corrected": "[corrected]", "explanation": "[why]"},
        {"original": "[EXACT quote from transcript]", "corrected": "[corrected]", "explanation": "[why]"}
      ],
      "practiceNeeded": "[specific practice recommendation]"
    },
    {
      "pattern": "[Another error pattern]",
      "frequency": 4,
      "severity": "medium",
      "examples": [
        {"original": "[EXACT quote from transcript]", "corrected": "[corrected]", "explanation": "[why]"},
        {"original": "[EXACT quote from transcript]", "corrected": "[corrected]", "explanation": "[why]"}
      ],
      "practiceNeeded": "[specific practice recommendation]"
    }
  ],
  "topErrors": [
    {
      "rank": 1,
      "issue": "string - from actual errors",
      "impact": "string (low/medium/high)",
      "occurrences": 2,
      "teachingPriority": "string",
      "isLikelyTranscriptionError": false,
      "examples": [
        {"original": "[exact quote]", "corrected": "[correction]", "explanation": "[why]"}
      ]
    }
    // PROVIDE UP TO 15-20 ERRORS if they exist
    // Each error should represent a PATTERN (e.g., "Verb conjugation errors")
    // Include isLikelyTranscriptionError: true if words are phonetically similar
    // Examples of transcription errors: "apretas"→"aprietas", "peces"→"pelos"
  ],
  "correctedExcerpts": [
    {
      "context": "[Describe what the student was talking about]",
      "original": "[EXACT quote from student transcript - 1-2 sentences]",
      "corrected": "[Corrected version]",
      "keyCorrections": ["[change1]", "[change2]", "[change3]"]
    },
    {
      "context": "[Another topic the student discussed]",
      "original": "[EXACT quote from student transcript - 1-2 sentences]",
      "corrected": "[Corrected version]",
      "keyCorrections": ["[change1]", "[change2]"]
    },
    {
      "context": "[Another topic]",
      "original": "[EXACT quote - 1-2 sentences]",
      "corrected": "[Corrected version]",
      "keyCorrections": ["[change1]", "[change2]"]
    },
    {
      "context": "[Another topic]",
      "original": "[EXACT quote - 1-2 sentences]",
      "corrected": "[Corrected version]",
      "keyCorrections": ["[change1]"]
    }
  ],
  "strengths": ["What the student did well - be specific"],
  "areasForImprovement": ["Specific areas to work on - reference actual errors"],
  "grammarAnalysis": {
    "mistakeTypes": [
      {
        "type": "string - error category",
        "examples": ["exact quote → correction"],
        "frequency": 2,
        "severity": "string (low/medium/high)"
      }
    ],
    "suggestions": ["string - based on actual errors"],
    "accuracyScore": 75 (MUST match proficiency: C2=95-100, C1=85-95, B2=75-85, B1=65-75, A2=50-65, A1=30-50)
  },
  "vocabularyAnalysis": {
    "uniqueWordCount": 80,
    "vocabularyRange": "string (limited/moderate/good/excellent)",
    "suggestedWords": ["word (translation)"],
    "advancedWordsUsed": ["words from transcript"]
  },
  "fluencyAnalysis": {
    "speakingSpeed": "string (slow/moderate/fast)",
    "pauseFrequency": "string (frequent/occasional/rare)",
    "fillerWords": {
      "count": 2,
      "examples": ["actual fillers"]
    },
    "overallFluencyScore": 70 (MUST match proficiency: C2=90-100, C1=80-90, B2=70-80, B1=60-70, A2=40-60, A1=20-40),
    "notes": "string"
  },
  "topicsDiscussed": ["ONLY specific topics from actual transcript - use what they SAID, not categories like 'daily routines' or 'past events'. Examples: 'Going to the supermarket', 'Meeting their friend Ana', 'Declining coffee because already had too much'"],
  "conversationQuality": "string (basic/intermediate/advanced)",
  "recommendedFocus": ["string - based on actual errors"],
  "suggestedExercises": ["string - specific to errors found"],
  "homeworkSuggestions": ["string - MUST reference what student ACTUALLY discussed. MUST be in ${getLanguageName(studentNativeLanguage)}. Good: 'Write 3-4 sentences about the next time you plan to meet your friend, focusing on using the correct gender pronouns.' Bad: 'Write a short story about a recent outing.'"],
  "studentSummary": "string - MUST be in ${getLanguageName(studentNativeLanguage)}. MUST be personalized and include 1-2 ACTUAL QUOTED EXAMPLES from the transcript in ${getLanguageName(language)} with ${getLanguageName(studentNativeLanguage)} translations. Example for English speaker learning Spanish: 'You told a great story about bumping into your friend at the supermarket! You said \"me encontré con una amiga\" (I met a friend) which was perfect. However, you said \"acompañarle\" when it should be \"acompañarla\" since you're referring to your female friend.' Example for Spanish speaker learning German: 'Contaste una gran historia sobre encontrarte con tu amigo. Dijiste \"Ich habe meine Freundin getroffen\" (Me encontré con mi amiga) perfectamente. Sin embargo, dijiste \"mit eine\" cuando debería ser \"mit einer\" en caso dativo.' REQUIRED: Must include at least one quoted example with correction."
}`;

    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',  // Changed from gpt-4-turbo-preview - better at structured output
      messages: [
        {
          role: 'system',
          content: `You are an expert language teacher providing detailed analysis.

**LANGUAGE INSTRUCTION - CRITICAL:**
The student is a native ${getLanguageName(studentNativeLanguage)} speaker learning ${getLanguageName(language)}.
**ALL feedback, explanations, and text MUST be written in ${getLanguageName(studentNativeLanguage)}.** 
The ONLY exception is when quoting the student's ${getLanguageName(language)} speech - keep those quotes in ${getLanguageName(language)} but add ${getLanguageName(studentNativeLanguage)} translations in parentheses.

Example for Spanish speaker learning German:
"¡Excelente trabajo contando la historia sobre ir al supermercado! Dijiste \"Ich bin zum Supermarkt gegangen\" (Fui al supermercado), lo cual fue perfecto. Sin embargo, dijiste \"mit eine Freundin\" cuando debería ser \"mit einer Freundin\" porque el caso dativo requiere \"einer\" para sustantivos femeninos."

Example for English speaker learning Spanish:
"Great job telling the story about going to the supermarket! You said \"Fui al supermercado\" (I went to the supermarket), which was perfect. However, you said \"acompañarle\" when it should be \"acompañarla\" because you're referring to your female friend."

CRITICAL REQUIREMENTS:
1. NEVER use generic or templated language
2. ALWAYS reference specific things the student said WITH ACTUAL QUOTES
3. ALWAYS include specific numbers when comparing to previous lessons (e.g., "75% vs 70%", "2 errors vs 5 errors")
4. FORBIDDEN phrases: "slight improvement", "some progress", "generally better", "past event", "daily routines"
5. REQUIRED: Specific quotes, specific topics, specific metrics
6. For homework: Reference what they ACTUALLY talked about in THIS lesson
7. For progress: Compare with NUMBERS from previous lesson data provided (if first lesson, state "First analyzed lesson - baseline established")
8. For studentSummary: MUST include 1-2 actual quoted errors with corrections in quotes (if errors exist; if no errors, focus on strengths and natural fluency)
9. DO NOT include punctuation, spelling, or accent mark differences - these are transcription artifacts, not real errors
10. FOCUS ON: Grammar, tenses, verb conjugations, vocabulary, word choice, agreement (gender/number), prepositions
11. **EMPTY ERROR ARRAYS ARE VALID**: If there are no real errors, empty errorPatterns[] and correctedExcerpts[] arrays are perfectly acceptable. DO NOT hallucinate errors.

TRANSCRIPTION ERROR DETECTION (CRITICAL):
The transcript is generated by speech-to-text AI and may contain errors. Before flagging student errors:
1. Check if the "incorrect" word sounds phonetically similar to the "correct" word
   - Examples: "apretas"/"aprietas", "peces"/"pelos", "dice"/"dices"
2. If phonetically similar AND the correction seems minor, mark as "isLikelyTranscriptionError": true
3. Only flag CLEAR, UNAMBIGUOUS grammar/vocabulary errors
4. If a native speaker wouldn't make this mistake, it's likely transcription
5. DO NOT count transcription errors toward CEFR level assessment

PROFICIENCY LEVEL ASSESSMENT (CRITICAL):
- A1 (Beginner): Very basic phrases, frequent systematic errors, limited vocabulary, needs constant help, simple sentence structures only
- A2 (Elementary): Simple sentences, basic grammar, common systematic errors, limited vocabulary range, can handle familiar topics with difficulty
- B1 (Intermediate): Can handle familiar topics, some complex sentences, occasional errors (not systematic), good vocabulary, can express ideas with some effort
- B2 (Upper Intermediate): Fluent on familiar topics, complex sentences, rare errors, wide vocabulary, can discuss abstract topics
- C1 (Advanced): Near-native fluency, sophisticated language, very rare errors, extensive vocabulary, natural expression of complex ideas
- C2 (Native/Near-Native): Native-like fluency, natural expressions, colloquialisms, idiomatic usage, NO systematic errors, effortless communication

NATIVE SPEAKER INDICATORS (mark as C2):
- Natural use of colloquialisms, discourse markers, and informal expressions (e.g., "es que", "pues", "bueno")
- Idiomatic expressions and regional variations used naturally
- Natural flow and rhythm of speech
- Complex sentence structures used effortlessly
- Vocabulary includes slang, informal terms, and cultural references
- "Errors" are actually just colloquial/informal but correct usage
- High fluency with natural pauses and fillers (not errors)
- Regional preposition variations (e.g., "subir en el coche" vs "subir al coche")
- Dropping prepositions in informal speech (e.g., "darse cuenta que" vs "darse cuenta de que")

IMPORTANT: If the speaker uses colloquialisms, informal expressions, discourse markers, and regional variations naturally, they are likely C1-C2, NOT A2. Colloquial speech patterns are SIGNS of high proficiency, not errors. Only mark as A2 if there are SYSTEMATIC grammar errors and limited vocabulary.

CRITICAL: ASSESS WHAT YOU SEE, NOT WHAT YOU EXPECT
- **0 errors found + natural/colloquial speech = C2 level** (Native/Near-Native)
- **Colloquial expressions = HIGH PROFICIENCY**, not errors:
  * Spanish: "tía", "Bua", "ni puta gracia", "vaya" = NATIVE MARKERS
  * French: "ben", "ouais", "putain", "genre" = NATIVE MARKERS
  * Any language: Natural fillers, discourse markers = HIGH PROFICIENCY
- **Perfect grammar (0 errors) + natural flow = C2**, regardless of previous level
- Missing accent marks in transcription are NOT errors - ignore them
- **If you find REAL errors**, flag them and adjust the level accordingly
- **DO NOT lower scores** because you "expect" someone at B2 to have errors
- **If errorPatterns[] is empty → grammar score MUST be 95-100%** (C2 level)

PRONUNCIATION & TRANSCRIPTION ERRORS (CRITICAL):
**The transcript you receive may contain TRANSCRIPTION ERRORS from speech-to-text (Whisper/Deepgram), NOT actual student mistakes.**

Common Transcription Artifacts to IGNORE:
- Single-word variations that could be STT errors (e.g., "hacer había" vs "hacía")
- Missing accent marks or punctuation
- Mishearing similar-sounding words (e.g., "que" vs "qué")
- Incomplete sentences or truncated words at segment boundaries

PRONUNCIATION ERROR GUIDELINES BY LEVEL:
- **C1/C2 (Advanced/Native)**: DO NOT flag pronunciation errors unless there's a CLEAR PATTERN across multiple instances. Single "pronunciation errors" are almost certainly transcription mistakes, not real errors.
- **B2 (Upper-Intermediate)**: Only flag pronunciation if you see the same error 2+ times
- **B1 and below**: Can flag individual pronunciation issues, but still be cautious

When in doubt about a "pronunciation error":
- If it appears only ONCE → likely transcription error, IGNORE IT
- If the student is C1/C2 → almost certainly transcription error, IGNORE IT
- If it's a subtle word variation (hacer/hacía, que/qué) → likely transcription error, IGNORE IT
- Only flag if there's a CLEAR, REPEATED pattern that indicates actual mispronunciation

Example of REAL pronunciation pattern: Student says "hacer" instead of "hacía" 4 times in different contexts
Example of TRANSCRIPTION ERROR: Student says "¿Que hacer había eso por?" once (likely said correctly as "¿Qué hacía eso por?" but STT misheard it)

SCORE CONSISTENCY (CRITICAL):
- Your scores MUST match the proficiency level you assign:
  * C2: grammar 95-100%, fluency 90-100
  * C1: grammar 85-95%, fluency 80-90
  * B2: grammar 75-85%, fluency 70-80
- Do NOT assign C2 level with 75% grammar or 70 fluency - this is contradictory
- If errorPatterns array is empty or minimal, grammar score should be 95-100

Example of GOOD studentSummary (for intermediate): "Great work discussing your trip to the supermarket! You said 'me encontré con una amiga que no veía desde hace mucho tiempo' - the tense 'hace' should be 'hacía' in this past context. Also, you said 'acompañarle' when it should be 'acompañarla' for your female friend."

Example of GOOD studentSummary (for native C2): "Excellent natural conversation about family advice! Your Spanish is native-level - you use colloquial expressions and discourse markers naturally. Keep practicing to maintain your fluency!"

Example of BAD studentSummary: "You effectively narrated a past event and need to work on tense consistency and pronoun agreement."

You MUST include errorPatterns and correctedExcerpts arrays with actual quotes from the student transcript. Always respond with valid JSON only.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,  // Lower temperature for more consistent structure following
      max_tokens: 3500,
      response_format: { type: 'json_object' }
    });
    
    console.log(`🤖 ========================================`);
    console.log(`🤖 GPT-4 API CALL COMPLETED`);
    console.log(`🤖 Model: ${completion.model || 'gpt-4o'}`);
    console.log(`🤖 Tokens used: ${completion.usage?.total_tokens || 'unknown'}`);
    
    // Calculate actual cost
    if (completion.usage) {
      const actualCost = estimateCost(
        completion.usage.prompt_tokens,
        completion.usage.completion_tokens
      );
      console.log(`💰 Actual cost: $${actualCost.totalCost} (input: $${actualCost.inputCost}, output: $${actualCost.outputCost})`);
      console.log(`📊 Token breakdown: ${completion.usage.prompt_tokens} input + ${completion.usage.completion_tokens} output`);
    }
    
    console.log(`🤖 ========================================`);
    
    const analysisText = completion.choices[0].message.content;
    console.log(`🤖 Raw GPT-4 Response (first 500 chars):`);
    console.log(analysisText.substring(0, 500) + '...');
    console.log(`🤖 ========================================`);
    
    const analysis = JSON.parse(analysisText);
    
    // Add metadata about sampling if transcript was long
    const fullWordCount = studentSegments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
    const sampledWordCount = studentText.split(/\s+/).length;
    
    if (sampledWordCount < fullWordCount) {
      const reductionPercent = ((1 - sampledWordCount/fullWordCount) * 100).toFixed(0);
      console.log(`📝 Note: Long lesson transcript was intelligently sampled (${reductionPercent}% reduction)`);
      console.log(`📝 Analysis based on ${sampledWordCount} words from beginning, middle, and end of lesson`);
      
      // Add a note to the analysis
      analysis._samplingNote = {
        wasSampled: true,
        originalWords: fullWordCount,
        sampledWords: sampledWordCount,
        reductionPercent: parseInt(reductionPercent),
        strategy: 'beginning-middle-end'
      };
    }
    
    console.log(`✅ Analysis completed: ${analysis.overallAssessment.proficiencyLevel} level detected`);
    console.log(`✅ Student summary: ${analysis.studentSummary.substring(0, 100)}...`);
    console.log(`🤖 ========================================`);
    
    return analysis;
    
  } catch (error) {
    console.error('❌ Error analyzing transcript:', error);
    throw new Error(`Analysis failed: ${error.message}`);
  }
}

/**
 * Generate personalized recommendations based on multiple lessons
 * @param {Array} analyses - Array of lesson analyses
 * @returns {Promise<Object>} - Personalized recommendations
 */
async function generateProgressReport(analyses) {
  try {
    if (analyses.length === 0) {
      throw new Error('No analyses provided');
    }
    
    console.log(`📊 Generating progress report from ${analyses.length} lessons...`);
    
    const prompt = `You are analyzing a student's progress across ${analyses.length} language lessons.

LESSON HISTORY:
${analyses.map((a, i) => `
Lesson ${i + 1} (${new Date(a.lessonDate).toLocaleDateString()}):
- Level: ${a.overallAssessment.proficiencyLevel}
- Strengths: ${a.strengths.join(', ')}
- Improvements needed: ${a.areasForImprovement.join(', ')}
- Topics: ${a.topicsDiscussed.join(', ')}
`).join('\n')}

Provide a comprehensive progress report:

1. **Overall Trend** (improving/stable/declining in which areas)
2. **Consistent Strengths** (what they're consistently good at)
3. **Persistent Challenges** (recurring issues to address)
4. **Recommended Next Steps** (specific actions for continued progress)
5. **Motivation Message** (encouraging message about their journey)

Respond ONLY with valid JSON in this format:
{
  "overallTrend": {
    "direction": "improving",
    "details": "..."
  },
  "consistentStrengths": ["...", "..."],
  "persistentChallenges": ["...", "..."],
  "recommendedNextSteps": ["...", "..."],
  "motivationMessage": "..."
}`;

    const completion = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert language teacher providing progress analysis. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });
    
    const report = JSON.parse(completion.choices[0].message.content);
    
    console.log(`✅ Progress report generated`);
    
    return report;
    
  } catch (error) {
    console.error('❌ Error generating progress report:', error);
    throw new Error(`Progress report failed: ${error.message}`);
  }
}

module.exports = {
  transcribeAudio,
  analyzeLessonTranscript,
  generateProgressReport,
  filterAndPrioritizeErrors
};

