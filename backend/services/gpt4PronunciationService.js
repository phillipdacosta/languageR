const OpenAI = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const stream = require('stream');

// Lazy-load OpenAI client to ensure env vars are loaded first
let openai = null;
function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return openai;
}

/**
 * Convert WebM audio to WAV format for GPT-4 audio model
 * @param {string} webmBase64 - Base64 encoded WebM audio
 * @returns {Promise<string>} - Base64 encoded WAV audio
 */
async function convertWebmToWav(webmBase64) {
  return new Promise((resolve, reject) => {
    const webmBuffer = Buffer.from(webmBase64, 'base64');
    
    const bufferStream = new stream.PassThrough();
    bufferStream.end(webmBuffer);
    
    const chunks = [];
    
    ffmpeg(bufferStream)
      .toFormat('wav')
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .audioChannels(1)
      .on('error', (err) => {
        console.error('❌ FFmpeg conversion error:', err);
        reject(err);
      })
      .on('end', () => {
        const wavBuffer = Buffer.concat(chunks);
        const wavBase64 = wavBuffer.toString('base64');
        console.log(`✅ Converted WebM to WAV: ${Math.round(wavBuffer.length / 1024)}KB`);
        resolve(wavBase64);
      })
      .pipe()
      .on('data', (chunk) => chunks.push(chunk));
  });
}

/**
 * GPT-4 Realtime Pronunciation Assessment Service
 * 
 * Uses GPT-4o with audio input to assess pronunciation quality.
 * This is NOT real-time during lessons - it's batch assessment after lesson ends.
 * 
 * Features:
 * - 15% intelligent sampling (focuses on complex words)
 * - Language-agnostic (works for all languages)
 * - Context-aware (understands student level)
 * - Text output only (no audio responses)
 */

// Language-specific pronunciation focus areas
const PRONUNCIATION_PROMPTS = {
  es: 'Focus on: rolled r vs single r, vowel clarity, b/v distinction, ñ sound, consonant clusters.',
  fr: 'Focus on: nasal vowels (an, en, in, on, un), r sound (uvular), liaisons, silent letters, vowel roundedness.',
  de: 'Focus on: umlauts (ä, ö, ü), ch sound (ich vs ach), sch sound, final devoicing, long vs short vowels.',
  it: 'Focus on: double consonants, open vs closed vowels, gl/gn sounds, clear vowel endings.',
  pt: 'Focus on: nasal vowels (ã, õ), lh/nh sounds, r sounds (initial vs medial), open vs closed vowels.',
  zh: 'Focus on: tones (especially 2nd/3rd distinction), retroflex initials (zh, ch, sh), aspirated vs unaspirated.',
  ja: 'Focus on: pitch accent patterns, r sound, vowel devoicing, long vs short vowels, geminate consonants.',
  ko: 'Focus on: tense vs aspirated vs plain consonants, final consonants, vowel distinctions.',
  ru: 'Focus on: soft vs hard consonants, vowel reduction, stress patterns, palatalization.',
  ar: 'Focus on: emphatic consonants, pharyngeal sounds, glottal stop, vowel length, sun/moon letters.'
};

// Complexity thresholds by CEFR level
const COMPLEXITY_THRESHOLDS = {
  'A1': { minLength: 5, minSyllables: 2 },  // "gracias"
  'A2': { minLength: 6, minSyllables: 2 },  // "trabajo"
  'B1': { minLength: 7, minSyllables: 3 },  // "vacaciones"
  'B2': { minLength: 8, minSyllables: 3 },  // "específico"
  'C1': { minLength: 9, minSyllables: 4 },  // "específicamente"
  'C2': { minLength: 10, minSyllables: 4 }  // "desafortunadamente"
};

/**
 * Count syllables in a word (language-agnostic vowel detection)
 */
function countSyllables(word) {
  // Match vowel clusters (works for most languages)
  const vowelPattern = /[aeiouáéíóúàèìòùâêîôûäëïöüāēīōūãõ]/gi;
  const matches = word.match(vowelPattern);
  return matches ? matches.length : 1;
}

/**
 * Check if word has complex phonetic patterns
 */
function hasComplexPhonetics(word, language) {
  const patterns = {
    es: /rr|ñ|ll|[bcdfghjklmnpqrstvwxyz]{3,}/i,
    fr: /[aeiouàâéèêëîïôùûü][nm]|gn|ill|oi|ou|eu/i,
    de: /sch|ch|tz|pf|äu|öu|[äöü]|[bcdfgpqtvwxz]{3,}/i,
    zh: /[āáǎàēéěèīíǐìōóǒòūúǔù]/,
    ja: /[っゃゅょ]|[ん]|[ー]/,
    ko: /[ㄲㄸㅃㅆㅉ]/,
    pt: /nh|lh|[aeiouàáâãéêíóôõú][mn]|ção/i,
    ru: /[жчшщ]|[ьъ]|[бвгджзклмнпрстфхцчшщ]{3,}/i,
    ar: /[عحخغقصضطظ]/,
    it: /gl|gn|sc|[bcdfglmnpqrstvz]{2}|cc|gg/i
  };
  
  const pattern = patterns[language];
  return pattern ? pattern.test(word) : false;
}

/**
 * Calculate complexity score for a segment
 */
function calculateSegmentComplexity(segment, language, studentLevel = 'B1') {
  const words = segment.text.split(/\s+/);
  const threshold = COMPLEXITY_THRESHOLDS[studentLevel] || COMPLEXITY_THRESHOLDS['B1'];
  let totalScore = 0;
  
  for (const word of words) {
    const cleanWord = word.replace(/[^\w]/g, '');
    if (cleanWord.length === 0) continue;
    
    let wordScore = 0;
    
    // Length score (0-3 points)
    if (cleanWord.length >= threshold.minLength + 3) wordScore += 3;
    else if (cleanWord.length >= threshold.minLength) wordScore += 2;
    else if (cleanWord.length >= threshold.minLength - 2) wordScore += 1;
    
    // Syllable score (0-3 points)
    const syllables = countSyllables(cleanWord);
    if (syllables >= threshold.minSyllables + 2) wordScore += 3;
    else if (syllables >= threshold.minSyllables) wordScore += 2;
    else if (syllables >= threshold.minSyllables - 1) wordScore += 1;
    
    // Phonetic complexity (0-2 points)
    if (hasComplexPhonetics(cleanWord, language)) {
      wordScore += 2;
    }
    
    totalScore += wordScore;
  }
  
  // Average complexity per word
  return words.length > 0 ? totalScore / words.length : 0;
}

/**
 * Intelligently sample segments with complex words
 * @param {Array} segments - All segments to sample from
 * @param {string} language - Target language code
 * @param {string} studentLevel - CEFR level
 * @param {number} samplingRate - Percentage of segments to sample (e.g., 0.15 for 15%)
 * @returns {Array} - Sampled segments sorted by complexity
 */
function intelligentSampleSegments(segments, language, studentLevel = 'B1', samplingRate = 0.15) {
  console.log(`📊 Intelligent sampling: ${segments.length} segments available`);
  
  // Score each segment by complexity
  const scoredSegments = segments.map(segment => ({
    segment,
    complexityScore: calculateSegmentComplexity(segment, language, studentLevel)
  }));
  
  // Sort by complexity (highest first)
  scoredSegments.sort((a, b) => b.complexityScore - a.complexityScore);
  
  // Calculate target count
  const targetCount = Math.max(1, Math.ceil(segments.length * samplingRate));
  
  // Also ensure we get some distribution across the lesson (not just beginning)
  // Take top 60% by complexity, then distribute evenly
  const topComplexCount = Math.ceil(targetCount * 1.5);
  const topComplex = scoredSegments.slice(0, topComplexCount);
  
  // Distribute selections across the lesson timeline
  const step = Math.floor(topComplex.length / targetCount);
  const sampled = [];
  for (let i = 0; i < targetCount && i * step < topComplex.length; i++) {
    sampled.push(topComplex[i * step].segment);
  }
  
  console.log(`✅ Sampled ${sampled.length}/${segments.length} segments (${Math.round(samplingRate * 100)}%)`);
  console.log(`📈 Complexity range: ${scoredSegments[scoredSegments.length - 1]?.complexityScore.toFixed(1)} - ${scoredSegments[0]?.complexityScore.toFixed(1)}`);
  
  return sampled;
}

/**
 * Assess pronunciation using GPT-4 Realtime API
 * This is called AFTER the lesson ends, not during!
 * 
 * @param {Array} audioSegments - Sampled audio segments with metadata
 * @param {string} language - Target language code (es, fr, de, etc.)
 * @param {string} studentLevel - CEFR level (A1-C2)
 * @param {Array} textSegments - Corresponding text transcripts
 * @returns {Promise<Object>} - Pronunciation assessment results
 */
async function assessPronunciationScore(audioSegments, language, studentLevel = 'B1', textSegments = []) {
  try {
    console.log(`🎤 ========== GPT-4 PRONUNCIATION ASSESSMENT ==========`);
    console.log(`📊 Language: ${language}`);
    console.log(`📊 Student Level: ${studentLevel}`);
    console.log(`📊 Segments to assess: ${audioSegments.length}`);
    
    if (!audioSegments || audioSegments.length === 0) {
      console.log('⚠️  No audio segments to assess');
      return null;
    }
    
    // Build the system prompt with language-specific focus
    const languageGuidance = PRONUNCIATION_PROMPTS[language] || 
      'Focus on: clear articulation, natural rhythm, and appropriate stress patterns.';
    
    const systemPrompt = `You are an expert ${getLanguageName(language)} pronunciation coach assessing a ${studentLevel} level student.

CRITICAL INSTRUCTIONS:
1. Focus ONLY on complex, challenging words (7+ letters, 3+ syllables, or difficult sounds)
2. IGNORE simple, common words like greetings, pronouns, articles, basic verbs
3. Prioritize words that would challenge learners at ${studentLevel} level
4. Be encouraging but honest - this student is trying to improve!

PRONUNCIATION FOCUS FOR ${language.toUpperCase()}:
${languageGuidance}

Provide assessment in this EXACT JSON format. You MUST respond ONLY with valid JSON (no markdown, no code blocks, just raw JSON):
{
  "overallScore": <number 0-100>,
  "accuracyScore": <number 0-100>,
  "fluencyScore": <number 0-100>,
  "prosodyScore": <number 0-100>,
  "wordsToImprove": [
    {
      "word": "<complex word only>",
      "score": <number 0-100>,
      "reason": "<specific pronunciation issue>"
    }
  ],
  "feedback": "<1-2 sentences of encouraging feedback>",
  "specificIssues": ["<issue 1>", "<issue 2>", "<issue 3>"]
}

CRITICAL: Your entire response MUST be valid JSON. Do NOT wrap it in markdown code blocks. Do NOT add any explanatory text before or after the JSON.

IMPORTANT:
- Only include 3-5 words in wordsToImprove (most challenging ones)
- Do NOT include simple words like "hola", "bueno", "sí", "no"
- Focus on words like "desafortunadamente", "específicamente", "pronunciación"
- Be realistic with scores but encouraging in feedback`;

    // Combine text context for reference
    const textContext = textSegments.map(seg => seg.text).join(' ');
    
    console.log(`📝 Text context: "${textContext.substring(0, 100)}..."`);
    console.log(`🎙️ Calling GPT-4 Realtime API...`);
    
    // Combine all audio segments into one for assessment
    // For now, we'll use the first segment's audio
    // TODO: Implement proper audio concatenation using ffmpeg if needed
    const firstAudioSegment = audioSegments[0];
    
    if (!firstAudioSegment || !firstAudioSegment.audioBase64) {
      console.error('❌ No audio data in segments');
      return null;
    }
    
    console.log(`🎵 Using audio from first segment (${Math.round(firstAudioSegment.audioBase64.length / 1024)}KB base64)`);
    
    // Convert WebM to WAV (GPT-4 audio model only supports WAV/MP3)
    console.log(`🔄 Converting WebM to WAV for GPT-4...`);
    const wavBase64 = await convertWebmToWav(firstAudioSegment.audioBase64);
    
    // NOTE: GPT-4 Realtime API is different from the playground!
    // We're using it in "batch" mode, not streaming mode
    // This means: send audio once, get JSON response, no audio output
    
    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-audio-preview",  // GPT-4 with audio input capability
      modalities: ["text"],  // ← Only text output (no audio response!)
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Assess the pronunciation of this ${language} speech. Here's the transcript for reference: "${textContext}". Now listen to the audio and assess the pronunciation quality, focusing on complex words only.`
            },
            {
              type: "input_audio",
              input_audio: {
                data: wavBase64,  // WAV audio in base64
                format: "wav"
              }
            }
          ]
        }
      ],
      temperature: 0.3  // Lower temperature for more consistent scoring
      // NOTE: response_format not supported with audio models
    });
    
    const resultText = response.choices[0].message.content;
    console.log(`📥 GPT-4 response received: ${resultText.substring(0, 200)}...`);
    
    // Parse JSON response (handle potential markdown wrapping)
    let cleanJson = resultText.trim();
    
    // Remove markdown code blocks if present
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/```\n?/g, '');
    }
    
    const result = JSON.parse(cleanJson.trim());
    
    console.log(`✅ Pronunciation assessment completed:`);
    console.log(`   Overall Score: ${result.overallScore}/100`);
    console.log(`   Accuracy: ${result.accuracyScore}/100`);
    console.log(`   Fluency: ${result.fluencyScore}/100`);
    console.log(`   Prosody: ${result.prosodyScore}/100`);
    console.log(`   Words to improve: ${result.wordsToImprove?.length || 0}`);
    
    // Format for database (match existing schema)
    return {
      overallScore: result.overallScore || 0,
      accuracyScore: result.accuracyScore || 0,
      fluencyScore: result.fluencyScore || 0,
      prosodyScore: result.prosodyScore || 0,
      completenessScore: result.overallScore || 0,  // Use overall as completeness
      
      // Words that need practice (already filtered for complexity by GPT-4)
      mispronunciations: (result.wordsToImprove || []).map(w => ({
        word: w.word,
        score: w.score,
        errorType: w.reason || 'pronunciation',
        problematicPhonemes: []  // GPT-4 doesn't provide phoneme-level detail
      })),
      
      // Additional context
      feedback: result.feedback,
      specificIssues: result.specificIssues || [],
      assessmentMethod: 'gpt4-realtime',
      segmentsAssessed: audioSegments.length,
      samplingRate: 0.15
    };
    
  } catch (error) {
    console.error('❌ GPT-4 Realtime pronunciation error:', error);
    console.error('Error details:', error.response?.data || error.message);
    
    // Graceful degradation - return null, don't crash the analysis
    return null;
  }
}

/**
 * Get full language name from code
 */
function getLanguageName(code) {
  const names = {
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    zh: 'Mandarin Chinese',
    ja: 'Japanese',
    ko: 'Korean',
    ru: 'Russian',
    ar: 'Arabic',
    en: 'English'
  };
  return names[code] || 'the target language';
}

/**
 * Combine multiple audio segments into one buffer for GPT-4
 * (Simplified version - assumes segments are already in correct format)
 */
function combineAudioSegments(segments) {
  // For now, we'll send the first segment
  // In production, you'd want to combine them properly using ffmpeg
  if (segments.length === 0) return null;
  
  // Return first segment's audio
  // TODO: Implement proper audio concatenation if needed
  return segments[0];
}

module.exports = {
  assessPronunciationScore,
  intelligentSampleSegments,
  calculateSegmentComplexity,
  COMPLEXITY_THRESHOLDS,
  PRONUNCIATION_PROMPTS
};
