const OpenAI = require('openai');
const FormData = require('form-data');
const fs = require('fs');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Transcribe audio using OpenAI Whisper API
 * @param {Buffer|Stream} audioFile - Audio file buffer or stream
 * @param {string} language - Language code (e.g., 'es' for Spanish, 'en' for English)
 * @returns {Promise<{text: string, segments: Array}>}
 */
async function transcribeAudio(audioFile, language = 'en') {
  try {
    console.log(`🎙️ Transcribing audio in language: ${language}`);
    
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: language,
      response_format: 'verbose_json', // Get timestamps and segments
      timestamp_granularities: ['segment']
    });
    
    console.log(`✅ Transcription completed: ${transcription.text.length} characters`);
    
    return {
      text: transcription.text,
      segments: transcription.segments || [],
      language: transcription.language,
      duration: transcription.duration
    };
    
  } catch (error) {
    console.error('❌ Error transcribing audio:', error);
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
  studentSegments,
  tutorSegments,
  previousAnalyses = []
}) {
  try {
    console.log(`🤖 Analyzing lesson transcript for ${language} learning...`);
    
    // Build context from previous lessons
    const previousContext = previousAnalyses.length > 0 
      ? `\n\nPrevious lesson notes:\n${previousAnalyses.map((a, i) => 
          `Lesson ${i + 1} (${new Date(a.lessonDate).toLocaleDateString()}):\n` +
          `- Level: ${a.overallAssessment.proficiencyLevel}\n` +
          `- Focus: ${a.topicsDiscussed.join(', ')}\n` +
          `- Improvements needed: ${a.areasForImprovement.join(', ')}`
        ).join('\n\n')}`
      : '';
    
    const prompt = `You are an expert ${language} language teacher analyzing a student's performance in a lesson.

STUDENT'S TRANSCRIPT (what the student said):
${studentSegments.map(s => s.text).join('\n')}

TUTOR'S TRANSCRIPT (what the tutor said):
${tutorSegments.map(s => s.text).join('\n')}
${previousContext}

Analyze the student's language performance and provide:

1. **Overall Proficiency Level** (CEFR: A1, A2, B1, B2, C1, or C2) with confidence percentage
2. **Summary** (2-3 sentences about their overall performance)
3. **Top 3 Strengths** (what they're doing well)
4. **Top 5 Areas for Improvement** (specific things to work on)
5. **Grammar Analysis**:
   - Common mistake types with examples
   - Accuracy score (0-100)
   - Specific suggestions
6. **Vocabulary Analysis**:
   - Vocabulary range assessment (limited/moderate/good/excellent)
   - Unique words count estimate
   - 5-10 advanced words they should learn
7. **Fluency Analysis**:
   - Speaking speed assessment
   - Filler words used (if any)
   - Overall fluency score (0-100)
8. **Topics Discussed** (list main conversation topics)
9. **Recommendations**:
   - 3-5 specific areas to focus on next lesson
   - 3-5 suggested exercises or activities
   - Homework ideas
10. **Student Summary** (friendly, encouraging 2-3 sentence summary to show the student)

Be constructive, encouraging, and specific. Focus on actionable feedback.

Respond ONLY with valid JSON in this exact format:
{
  "overallAssessment": {
    "proficiencyLevel": "B1",
    "confidence": 85,
    "summary": "...",
    "progressFromLastLesson": "..."
  },
  "strengths": ["...", "...", "..."],
  "areasForImprovement": ["...", "...", "..."],
  "grammarAnalysis": {
    "mistakeTypes": [
      {
        "type": "...",
        "examples": ["...", "..."],
        "frequency": 5,
        "severity": "moderate"
      }
    ],
    "suggestions": ["...", "..."],
    "accuracyScore": 75
  },
  "vocabularyAnalysis": {
    "uniqueWordCount": 150,
    "vocabularyRange": "moderate",
    "suggestedWords": ["...", "..."],
    "advancedWordsUsed": ["...", "..."]
  },
  "fluencyAnalysis": {
    "speakingSpeed": "natural",
    "pauseFrequency": "moderate",
    "fillerWords": {
      "count": 8,
      "examples": ["um", "like"]
    },
    "overallFluencyScore": 70
  },
  "topicsDiscussed": ["...", "..."],
  "conversationQuality": "intermediate",
  "recommendedFocus": ["...", "..."],
  "suggestedExercises": ["...", "..."],
  "homeworkSuggestions": ["...", "..."],
  "studentSummary": "Great job today! ..."
}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are an expert language teacher providing detailed, constructive analysis of student performance. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });
    
    const analysisText = completion.choices[0].message.content;
    const analysis = JSON.parse(analysisText);
    
    console.log(`✅ Analysis completed: ${analysis.overallAssessment.proficiencyLevel} level detected`);
    
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

    const completion = await openai.chat.completions.create({
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
  generateProgressReport
};

