/**
 * Quiz service — premium personalized quiz pipeline.
 *
 * Architecture:
 *   - Shared `Quiz` pool, queryable by (language, level, struggle, type).
 *   - Per-user `UserQuizHistory` tracks seen, ratings, push timestamps.
 *   - Two trigger points:
 *       1. Immediate post-lesson: push 1 quiz tied to the most-flagged
 *          struggle from THIS lesson. Inline in lesson summary.
 *       2. End-of-day batch (cron at 8pm local): aggregate the day's
 *          distinct struggle signals, push up to 1 more (cap 2/day).
 *   - 48h cooldown per (user, struggle) — never drill the same point twice
 *     in 2 days.
 *   - 2 quizzes per user per day cap.
 *   - Auto-pause if 5 consecutive thumbs-down (14d).
 *   - Two-pass AI generation (generate → verify) when the pool is empty.
 *   - Free students browse the quiz pool manually (no auto-push, G28).
 *
 * See docs/learning-journey/architecture.md (quiz selection flow).
 */

const OpenAI = require('openai');
const Quiz = require('../models/Quiz');
const UserQuizHistory = require('../models/UserQuizHistory');
const LearningPlan = require('../models/LearningPlan');
const User = require('../models/User');
const entitlements = require('./entitlementsService');

let openai = null;
function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI API key is required.');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const DAILY_PUSH_CAP = 2;
const STRUGGLE_COOLDOWN_HOURS = 48;

// CEFR difficulty guardrails — injected into generation + verification so the
// model can't drift above the student's level (the #1 cause of "too hard"
// checkpoint questions). Language-agnostic; phrased in grammar concepts.
const CEFR_GUARDRAILS = {
  A1: 'Absolute beginner. Use ONLY present tense and simple, high-frequency everyday vocabulary. Keep sentences short (3–7 words). Allowed: basic statements, yes/no and simple wh- questions, "to be"/"to have", present-tense modal verbs, articles, numbers, greetings, basic everyday nouns. FORBID anything harder: NO subjunctive/conditional moods, NO past or future tenses, NO subordinate or relative clauses, NO passive voice, NO idioms.',
  A2: 'Elementary. Present tense plus the single most common past tense; simple modal verbs; basic connectors (and/but/because). Short, concrete sentences. Avoid subjunctive/conditional moods, passive voice, and complex multi-clause sentences.',
  B1: 'Intermediate. Common tenses (present, past, simple future) and straightforward subordinate clauses; light conditional for politeness only. Everyday and familiar work/school topics. Avoid literary or highly idiomatic language.',
  B2: 'Upper-intermediate. Full range of common tenses, passive voice, and conditional/subjunctive; nuanced connectors and some common idioms.',
  C1: 'Advanced. Abstract topics, idiomatic usage, and register awareness are fair game.',
  C2: 'Mastery. Native-like nuance, idiom, and literary/academic register.'
};
function cefrGuardrail(level) {
  return CEFR_GUARDRAILS[level] || CEFR_GUARDRAILS.A1;
}

/** A readable focus label from a (possibly dotted/"unknown") skill id. */
function _focusLabel(struggle, displayName) {
  if (displayName && typeof displayName === 'string') return displayName;
  return String(struggle || '')
    .replace(/^[a-z]+\.(unknown\.)?/i, '')
    .replace(/_/g, ' ')
    .trim();
}

/** Format up to 3 of the student's real mistakes to ground generation. */
function _formatExamplesForPrompt(examples) {
  if (!Array.isArray(examples) || examples.length === 0) return '';
  return examples
    .slice(0, 3)
    .map((ex, i) => {
      const said = ex?.original || ex?.text || ex?.utterance || '';
      const fix = ex?.correction || ex?.corrected || ex?.fix || '';
      if (!said) return '';
      return `${i + 1}. Student said: "${said}"${fix ? ` → correct: "${fix}"` : ''}`;
    })
    .filter(Boolean)
    .join('\n');
}

// ── Open-answer detection (fill_blank with infinitely many valid answers) ──
const BLANK_MARKERS_RE = /_{2,}|\.{3,}|\[\s*blank\s*\]|\(\s*\)/i;
const OPEN_ANSWER_PROMPT_RE = [
  /\bhei[ßs]e\b/i,
  /\bmy name is\b/i,
  /\bme llamo\b/i,
  /\bje m'?appelle\b/i,
  /\bmi chiamo\b/i,
  /\bich bin\b/i,
  /\bsoy\b/i,
  /\bje suis\b/i,
  /\bintroduce yourself\b/i,
  /\byour name\b/i
];

function _inferOpenAnswer(question) {
  if (!question || question.openAnswer === true) return true;
  if (question.openAnswer === false) return false;
  const type = question.type;
  if (type !== 'fill_blank' && type !== 'translate') return false;
  const prompt = String(question.prompt || '');
  if (!BLANK_MARKERS_RE.test(prompt)) return false;
  return OPEN_ANSWER_PROMPT_RE.some(re => re.test(prompt));
}

/** Tag open-ended blanks and normalize question shape before save. */
function _normalizeQuizQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map(q => {
    const next = { ...q };
    if (_inferOpenAnswer(next)) {
      next.openAnswer = true;
    }
    return next;
  });
}

const AUTO_PAUSE_AFTER_NEGATIVE_RATINGS = 5;
const AUTO_PAUSE_DURATION_DAYS = 14;
const POOL_VARIANTS_TARGET = 5;

// Triggers the *user* initiates on demand. These bypass the premium gate,
// the daily push cap, and the per-struggle cooldown — the student explicitly
// asked for (or hit a gate that requires) the quiz. 'roadblock' is the
// journey-map checkpoint gate (mandatory, un-failable).
const USER_INITIATED_TRIGGERS = new Set(['manual', 'roadblock']);

// Mongoose Map keys cannot contain "." or "$". Struggle skillIds are dotted
// (e.g. "german.unknown.practice_more_..."), so sanitize before using them as
// keys in `lastPushedByStruggle`. Read + write must use the same encoding.
function _safeMapKey(key) {
  return String(key).replace(/[.$]/g, '_');
}

// ─────────────────────────────────────────────────────────────────────
// Selection
// ─────────────────────────────────────────────────────────────────────

/**
 * Select and push a quiz to the user for a given struggle.
 *
 * Returns one of:
 *   - { pushed: true, quiz, personalizedHeader }
 *   - { pushed: false, reason }
 */
async function selectAndPushQuiz(opts) {
  const { userId, language, struggle, trigger = 'manual', lessonContext = null, level: explicitLevel = null, struggleContext = null } = opts;
  if (!userId || !language || !struggle) {
    return { pushed: false, reason: 'missing_required_args' };
  }

  const userInitiated = USER_INITIATED_TRIGGERS.has(trigger);

  // Premium gate. Free students don't get auto-push (G28), but user-initiated
  // quizzes (manual practice, roadblock checkpoints) are available to everyone.
  const user = await User.findById(userId).select('subscription userType').lean();
  if (!entitlements.isPremium(user) && !userInitiated) {
    return { pushed: false, reason: 'free_tier_no_auto_push' };
  }

  // Resolve user's current level (chapter level on plan; fallback to A1).
  let level = explicitLevel;
  if (!level) {
    const plan = await LearningPlan.findOne({ studentId: userId, language }).select('chapterLevel').lean();
    level = plan?.chapterLevel || 'A1';
  }

  const history = await _getOrCreateHistory(userId, language);

  // Roadblock checkpoints must be idempotent. A gate that's reopened (or the
  // journey re-entered) before the student passes has to re-serve the SAME
  // quiz — never generate a new one. Without this, every open burns two AI
  // calls and bloats the pool, because each push is logged to `seen` and then
  // excluded from the next pool query, forcing fresh generation each time.
  if (trigger === 'roadblock') {
    const pending = (history.seen || [])
      .slice()
      .reverse()
      .find(s =>
        s.trigger === 'roadblock' &&
        s.struggle === struggle &&
        String(s.language) === String(language) &&
        !s.completedAt
      );
    if (pending?.quizId) {
      const existing = await Quiz.findOne({ _id: pending.quizId, retiredAt: null }).lean();
      if (existing) {
        return {
          pushed: true,
          quiz: existing,
          personalizedHeader: pending.personalizedHeader || '',
          reused: true
        };
      }
    }
  }

  // Auto-pause check (G26).
  if (history.autoPushPausedUntil && new Date(history.autoPushPausedUntil) > new Date()) {
    return { pushed: false, reason: 'auto_paused' };
  }

  // Daily cap.
  const todayKey = _todayKey();
  const used = (history.dailyPushCounts?.get?.(todayKey) ?? history.dailyPushCounts?.[todayKey]) || 0;
  if (used >= DAILY_PUSH_CAP && !userInitiated) {
    return { pushed: false, reason: 'daily_cap' };
  }

  // 48h per-struggle cooldown.
  const struggleKey = _safeMapKey(struggle);
  const lastPush = history.lastPushedByStruggle?.get?.(struggleKey) ?? history.lastPushedByStruggle?.[struggleKey];
  if (lastPush && (Date.now() - new Date(lastPush).getTime()) < STRUGGLE_COOLDOWN_HOURS * 60 * 60 * 1000) {
    if (!userInitiated) return { pushed: false, reason: 'struggle_cooldown' };
  }

  // Pool query: pick a variant the user hasn't seen for this struggle yet.
  const seenIds = (history.seen || [])
    .filter(s => s.struggle === struggle && String(s.language) === String(language))
    .map(s => s.quizId);

  let quiz = await Quiz.findOne({
    language,
    level,
    struggle,
    retiredAt: null,
    _id: { $nin: seenIds }
  }).sort({ templateVariant: 1 }).lean();

  // Pool empty? Generate fresh + persist + use.
  if (!quiz) {
    try {
      quiz = await generateAndSaveQuiz({
        language,
        level,
        struggle,
        displayName: struggleContext?.displayName || '',
        examples: struggleContext?.examples || []
      });
    } catch (err) {
      console.error('[Quiz] Pool empty AND generation failed:', err.message);
      return { pushed: false, reason: 'generation_failed' };
    }
  }

  if (!quiz) return { pushed: false, reason: 'no_quiz_available' };

  // Personalized header card per push (cheap, reusable body).
  let personalizedHeader = '';
  try {
    personalizedHeader = await _generatePersonalizedHeader({
      lessonContext,
      struggle,
      level,
      language
    });
  } catch (err) {
    console.warn('[Quiz] Header generation failed, using default:', err.message);
    personalizedHeader = `A quick drill on ${struggle.replace(/_/g, ' ')} based on what we worked on.`;
  }

  // Persist push to history.
  history.seen.push({
    quizId: quiz._id,
    language,
    struggle,
    pushedAt: new Date(),
    trigger,
    personalizedHeader
  });
  history.lastPushedByStruggle = history.lastPushedByStruggle || new Map();
  if (typeof history.lastPushedByStruggle.set === 'function') {
    history.lastPushedByStruggle.set(struggleKey, new Date());
  } else {
    history.lastPushedByStruggle[struggleKey] = new Date();
  }
  if (typeof history.dailyPushCounts.set === 'function') {
    history.dailyPushCounts.set(todayKey, used + 1);
  } else {
    history.dailyPushCounts[todayKey] = used + 1;
  }
  await history.save();

  // Bump impression on the quiz.
  await Quiz.updateOne({ _id: quiz._id }, { $inc: { 'qualityMetrics.impressions': 1 } });

  return { pushed: true, quiz, personalizedHeader };
}

/**
 * Mark a quiz as completed (and rate it 1 / 0 / -1). Drives auto-pause +
 * pool quality metrics.
 */
async function recordQuizCompletion({ userId, quizId, rating = 0 }) {
  if (!userId || !quizId) return null;
  const history = await UserQuizHistory.findOne({ userId });
  if (!history) return null;

  const entry = (history.seen || []).slice().reverse().find(s => String(s.quizId) === String(quizId));
  if (!entry) return null;
  entry.completedAt = new Date();
  if (rating === 1 || rating === -1) entry.rating = rating;
  history.markModified('seen');

  // Negative-streak detection (G26): inspect the last AUTO_PAUSE_AFTER_NEGATIVE_RATINGS entries.
  const lastN = (history.seen || []).slice(-AUTO_PAUSE_AFTER_NEGATIVE_RATINGS);
  if (lastN.length >= AUTO_PAUSE_AFTER_NEGATIVE_RATINGS && lastN.every(e => e.rating === -1)) {
    history.autoPushPausedUntil = new Date(Date.now() + AUTO_PAUSE_DURATION_DAYS * 24 * 60 * 60 * 1000);
  }

  await history.save();

  // Pool quality metrics.
  const inc = { 'qualityMetrics.completions': 1 };
  if (rating === 1) inc['qualityMetrics.thumbsUp'] = 1;
  if (rating === -1) inc['qualityMetrics.thumbsDown'] = 1;
  await Quiz.updateOne({ _id: quizId }, { $inc: inc });

  // Auto-retire quizzes with > 30% thumbs down once they have meaningful volume.
  const updated = await Quiz.findById(quizId).lean();
  if (updated && (updated.qualityMetrics.completions || 0) >= 20) {
    const total = updated.qualityMetrics.thumbsUp + updated.qualityMetrics.thumbsDown;
    if (total > 0 && (updated.qualityMetrics.thumbsDown / total) > 0.3) {
      await Quiz.updateOne({ _id: quizId }, { $set: { retiredAt: new Date() } });
      console.warn(`[Quiz] Auto-retired quiz ${quizId} (>30% thumbs down).`);
    }
  }

  return entry;
}

// ─────────────────────────────────────────────────────────────────────
// AI generation (two-pass: generate → verify)
// ─────────────────────────────────────────────────────────────────────

async function generateAndSaveQuiz({ language, level, struggle, type = 'drill', displayName = '', examples = [] }) {
  // Determine variant index — fill the pool to POOL_VARIANTS_TARGET.
  const existingCount = await Quiz.countDocuments({ language, level, struggle, type, retiredAt: null });
  const templateVariant = existingCount;

  const draft = await _generateQuizDraft({ language, level, struggle, type, displayName, examples });
  const verified = await _verifyQuizDraft(draft, { language, level, struggle, displayName });
  verified.questions = _normalizeQuizQuestions(verified.questions);

  const doc = new Quiz({
    language,
    level,
    struggle,
    type,
    title: verified.title,
    description: verified.description || '',
    questions: verified.questions,
    templateVariant,
    source: 'ai_generated',
    quizVersion: 1
  });
  await doc.save();
  console.log(`📝 [Quiz] Generated quiz for ${language} ${level} ${struggle} (variant ${templateVariant})`);
  return doc.toObject();
}

async function _generateQuizDraft({ language, level, struggle, type, displayName = '', examples = [] }) {
  const focus = _focusLabel(struggle, displayName);
  const exampleBlock = _formatExamplesForPrompt(examples);
  const prompt = `Create a personalized practice quiz for a language learner.

LANGUAGE: ${language}
CEFR LEVEL: ${level}
LEVEL CONSTRAINTS (STRICT — do not exceed): ${cefrGuardrail(level)}
FOCUS (what to practice): ${focus}
TYPE: ${type}
${exampleBlock ? `\nWHAT THE STUDENT ACTUALLY GOT WRONG — ground the quiz in THESE exact situations and vocabulary (corrected), do not invent unrelated topics:\n${exampleBlock}\n` : ''}
Generate 5-7 questions that ALL target the FOCUS above, STRICTLY within the
CEFR LEVEL CONSTRAINTS. Every question MUST be solvable by a ${level} learner.
If a question would require grammar or vocabulary beyond ${level}, rewrite it
simpler. Prefer reusing the vocabulary and situations from the student's
examples above so it feels like what they actually practiced.

Each question must include:
- a clear prompt
- the correct answer
- 1-2 acceptable alternatives where applicable
- a 1-sentence explanation
- a real-world example

Avoid fluff. The quiz should feel like targeted drilling, not a textbook chapter.

FILL-IN-THE-BLANK RULES (critical):
- fill_blank and translate items must have ONE clear correct answer OR be marked
  openAnswer:true when ANY reasonable answer works (e.g. "Ich heiße ___" — any name).
- NEVER use fill_blank where many answers are valid but only one is in correctAnswer
  (bad: blank for a name when "Anna" is the only accepted answer).
- For grammar drills (articles, verb forms, word order), embed enough context in
  the prompt that the expected word is unambiguous, OR use multiple_choice instead.
- Prefer multiple_choice for A1 pattern recognition ("Which sentence introduces
  your name?") over open name blanks.
- Set openAnswer:true ONLY when the blank accepts any valid free-text (names,
  professions in intro drills, etc.).

Respond ONLY with valid JSON:
{
  "title": "string (max 50 chars, descriptive)",
  "description": "string (1 sentence describing what they'll practice)",
  "questions": [
    {
      "type": "multiple_choice | fill_blank | translate",
      "prompt": "string",
      "options": ["string", ...],
      "correctAnswer": "string",
      "acceptableAlternatives": ["string", ...],
      "openAnswer": false,
      "explanation": "string",
      "example": "string"
    }
  ]
}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a language pedagogy expert. Always respond with valid JSON. Be concrete; questions must clearly target the named struggle.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });
  return JSON.parse(completion.choices[0].message.content);
}

/**
 * Pass 2: verify every answer. We give the model the draft and ask it to
 * either confirm or correct each question. This catches the most common
 * AI mistake (G19): wrong answers in fill-in-blank or translate items.
 */
async function _verifyQuizDraft(draft, { language, level, struggle, displayName = '' }) {
  const prompt = `Verify this quiz draft on TWO axes: (1) answer correctness, and
(2) CEFR level-appropriateness for a ${level} learner.

LANGUAGE: ${language}
CEFR LEVEL: ${level}
LEVEL CONSTRAINTS (STRICT): ${cefrGuardrail(level)}
FOCUS: ${_focusLabel(struggle, displayName)}

For each question:
- If the correctAnswer or acceptableAlternatives are wrong, fix them.
- If the question uses grammar or vocabulary ABOVE ${level} (per the constraints
  above), REWRITE the prompt/options so it is solvable at ${level} while still
  practicing the FOCUS. Keep it simple.
- If a fill_blank has many valid answers (e.g. a name after "Ich heiße"), set
  openAnswer:true OR convert to multiple_choice. Never leave a name-blank with
  only one hardcoded correctAnswer.

DRAFT:
${JSON.stringify(draft, null, 2)}

Return the corrected JSON in the same format. Do not change prompts or
explanations unless they are factually wrong or above ${level}.`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a language correctness verifier. Always respond with valid JSON in the same shape as the input. Only modify answers and alternatives if they are wrong.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });
  const verified = JSON.parse(completion.choices[0].message.content);

  // Sanity defaults if verifier corrupted shape.
  if (!verified.title) verified.title = draft.title;
  if (!Array.isArray(verified.questions) || verified.questions.length === 0) {
    verified.questions = draft.questions || [];
  }
  return verified;
}

async function _generatePersonalizedHeader({ lessonContext, struggle, language, level }) {
  if (!lessonContext) {
    return `Quick drill on ${struggle.replace(/_/g, ' ')} based on your recent lesson.`;
  }
  const prompt = `Write 1-2 sentences for a "personalized header" card that
prefaces a practice quiz. Keep it warm, specific, and brief.

LANGUAGE: ${language}
LEVEL: ${level}
STRUGGLE: ${struggle}
LESSON CONTEXT (what just happened): ${lessonContext}

Return JUST the sentence(s), no JSON.`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a warm, concise tutoring coach. 1-2 sentences max.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 120
  });
  return (completion.choices?.[0]?.message?.content || '').trim();
}

// ─────────────────────────────────────────────────────────────────────
// Trigger A — Immediate post-lesson
// ─────────────────────────────────────────────────────────────────────

/**
 * Hook called from the lesson-end pipeline. Picks the most-flagged
 * struggle from THIS lesson's analysis and pushes one quiz immediately.
 */
async function pushImmediateFromLesson(lessonAnalysis) {
  if (!lessonAnalysis || !lessonAnalysis.studentId) return { pushed: false, reason: 'no_analysis' };

  const struggle = _topStruggleFromAnalysis(lessonAnalysis);
  if (!struggle) return { pushed: false, reason: 'no_struggle' };

  const language = lessonAnalysis.language;
  const lessonContext = lessonAnalysis.summary || lessonAnalysis.studentSummary || '';

  return selectAndPushQuiz({
    userId: lessonAnalysis.studentId,
    language,
    struggle,
    trigger: 'immediate_post_lesson',
    lessonContext
  });
}

/**
 * Pre-generate (warm) the roadblock checkpoint quiz for a student's current
 * top struggle so the pool is ready BEFORE they reach the gate. Mirrors the
 * selection logic of the /quizzes/roadblock route but never pushes to history
 * (no `seen` entry) — it only fills the shared pool. Best-effort; safe to call
 * fire-and-forget after a lesson is analyzed.
 */
async function prewarmRoadblockQuiz({ studentId, language, plan = null }) {
  if (!studentId || !language) return { warmed: false, reason: 'missing_args' };

  const struggleAggregator = require('./struggleAggregator');
  const bayes = require('./bayesianMastery');

  let planDoc = plan;
  if (!planDoc) {
    planDoc = await LearningPlan.findOne({ studentId, language })
      .select('chapterLevel goal skillBeliefs')
      .lean();
  }
  const level = planDoc?.chapterLevel || 'A1';

  const agg = await struggleAggregator.aggregateStruggles({ studentId, language, plan: planDoc });
  const struggles = agg.struggles || [];
  const top = struggles.find(s => !bayes.isMastered(s.belief)) || null;
  if (!top) return { warmed: false, reason: 'no_struggle' };

  // Already pooled for this (language, level, struggle)? Nothing to do.
  const existing = await Quiz.findOne({
    language,
    level,
    struggle: top.skillId,
    retiredAt: null
  }).select('_id').lean();
  if (existing) return { warmed: true, reason: 'already_pooled' };

  try {
    await generateAndSaveQuiz({
      language,
      level,
      struggle: top.skillId,
      displayName: top.displayName || '',
      examples: top.examples || []
    });
    console.log(`🔥 [Quiz] Pre-warmed roadblock quiz for ${language} ${level} ${top.skillId}`);
    return { warmed: true, reason: 'generated' };
  } catch (err) {
    console.warn('[Quiz] Roadblock pre-warm generation failed:', err.message);
    return { warmed: false, reason: 'generation_failed' };
  }
}

function _topStruggleFromAnalysis(analysis) {
  if (Array.isArray(analysis.strugglesKeys) && analysis.strugglesKeys.length) {
    return analysis.strugglesKeys[0];
  }
  if (Array.isArray(analysis.struggles) && analysis.struggles.length) {
    const first = analysis.struggles[0];
    return typeof first === 'string' ? first : (first?.key || first?.name || null);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Trigger B — End-of-day batch
// ─────────────────────────────────────────────────────────────────────

/**
 * Cron entry point. Aggregates each premium user's day-of struggles
 * across all lessons, picks the top distinct one, pushes 1 quiz IF
 * there's still daily-cap headroom.
 *
 * Designed to be called once per timezone bucket (8pm local). For now
 * we just iterate all premium students and let per-user cap/cooldown
 * filtering decide whether to fire.
 */
async function runEndOfDayBatch({ olderThanHours = 24 } = {}) {
  const since = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const LessonAnalysis = require('../models/LessonAnalysis');

  // Group analyses by student → struggle counts, since `since`.
  const recent = await LessonAnalysis.find({ createdAt: { $gte: since } })
    .select('studentId language strugglesKeys struggles summary studentSummary')
    .lean();

  const byStudent = new Map();
  for (const a of recent) {
    const key = `${a.studentId}|${a.language}`;
    if (!byStudent.has(key)) byStudent.set(key, { studentId: a.studentId, language: a.language, struggles: new Map(), context: '' });
    const bucket = byStudent.get(key);
    const struggles = Array.isArray(a.strugglesKeys) ? a.strugglesKeys : [];
    for (const s of struggles) bucket.struggles.set(s, (bucket.struggles.get(s) || 0) + 1);
    if (!bucket.context) bucket.context = a.summary || a.studentSummary || '';
  }

  let fired = 0;
  for (const bucket of byStudent.values()) {
    if (bucket.struggles.size === 0) continue;
    const top = [...bucket.struggles.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const r = await selectAndPushQuiz({
      userId: bucket.studentId,
      language: bucket.language,
      struggle: top,
      trigger: 'end_of_day_batch',
      lessonContext: bucket.context
    });
    if (r.pushed) fired++;
  }
  console.log(`📦 [Quiz] EOD batch fired ${fired} pushes across ${byStudent.size} users.`);
  return { fired, considered: byStudent.size };
}

// ─────────────────────────────────────────────────────────────────────
// Mastery Mode weekly micro-challenges (Batch 13)
//
// After a student's plan reaches `mastery_mode` (post-C2), they no
// longer accumulate mastery scores in the traditional sense. Instead,
// once a week they receive a single "C2 micro-challenge" — a quiz
// pulled from a curated mastery pool (or AI-generated if the pool is
// thin). These quizzes:
//   - Bypass the per-struggle 48h cooldown (they're not struggle-driven)
//   - Bypass the daily push cap (max 1/week is its own limit)
//   - Are tagged with `trigger='mastery_mode_weekly'` in history
// ─────────────────────────────────────────────────────────────────────

const MASTERY_MODE_WEEKLY_INTERVAL_HOURS = 24 * 7;

// Hand-picked C2 themes the AI rotates through. These are intentionally
// varied — Mastery Mode is about breadth, not drilling weaknesses.
const MASTERY_MODE_THEMES = [
  'idiomatic_expressions',
  'register_shifts',
  'subtle_connotations',
  'literary_excerpts',
  'persuasive_rhetoric',
  'cultural_references',
  'phrasal_nuance',
  'academic_writing'
];

/**
 * Idempotent: returns immediately if the user got a mastery quiz within
 * the last week. Otherwise picks a fresh theme they haven't seen yet
 * and pushes a quiz.
 *
 * Returns `{ pushed: boolean, reason?: string, quizId?, theme? }`.
 */
async function maybePushMasteryWeekly({ userId, language }) {
  const LearningPlan = require('../models/LearningPlan');
  const User = require('../models/User');
  const entitlements = require('./entitlementsService');

  const user = await User.findById(userId);
  if (!user) return { pushed: false, reason: 'no_user' };
  if (!entitlements.isPremium(user)) return { pushed: false, reason: 'not_premium' };

  const plan = await LearningPlan.findOne({ studentId: userId, language });
  if (!plan) return { pushed: false, reason: 'no_plan' };
  if (plan.status !== 'mastery_mode') return { pushed: false, reason: 'not_mastery_mode' };

  const history = await _getOrCreateHistory(userId, language);
  const lastMastery = (history.seen || [])
    .filter(s => s.trigger === 'mastery_mode_weekly')
    .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())[0];

  if (lastMastery) {
    const ageHours = (Date.now() - new Date(lastMastery.pushedAt).getTime()) / 3_600_000;
    if (ageHours < MASTERY_MODE_WEEKLY_INTERVAL_HOURS) {
      return { pushed: false, reason: 'too_soon', nextEligibleAt: new Date(new Date(lastMastery.pushedAt).getTime() + MASTERY_MODE_WEEKLY_INTERVAL_HOURS * 3_600_000) };
    }
  }

  // Pick the next theme they haven't seen recently. Cycles through.
  const seenThemes = new Set(
    (history.seen || [])
      .filter(s => s.trigger === 'mastery_mode_weekly' && s.theme)
      .slice(-MASTERY_MODE_THEMES.length)
      .map(s => s.theme)
  );
  const theme = MASTERY_MODE_THEMES.find(t => !seenThemes.has(t)) || MASTERY_MODE_THEMES[0];

  // Try to find an existing C2 quiz on this theme. If empty, generate.
  let quiz = await Quiz.findOne({
    language,
    level: 'C2',
    struggle: theme,
    type: 'mastery_weekly',
    retiredAt: null
  });
  if (!quiz) {
    try {
      quiz = await generateAndSaveQuiz({
        language,
        level: 'C2',
        struggle: theme,
        type: 'mastery_weekly'
      });
    } catch (err) {
      console.error('[Quiz/Mastery] Generation failed:', err.message);
      return { pushed: false, reason: 'generation_failed' };
    }
  }

  history.seen.push({
    quizId: quiz._id,
    language,
    struggle: theme,
    pushedAt: new Date(),
    trigger: 'mastery_mode_weekly',
    theme,
    personalizedHeader: `This week's Mastery challenge: ${theme.replace(/_/g, ' ')}.`
  });
  await history.save();

  console.log(`🏛️  [Quiz/Mastery] Pushed weekly challenge to ${userId} (theme=${theme}, quiz=${quiz._id})`);
  return { pushed: true, quizId: quiz._id, theme };
}

/**
 * Sweep all `mastery_mode` plans and push their weekly challenges if
 * eligible. Designed to run from a daily cron — `maybePushMasteryWeekly`
 * is idempotent so over-running is harmless.
 */
async function runMasteryModeWeeklySweep() {
  const LearningPlan = require('../models/LearningPlan');
  const plans = await LearningPlan.find({ status: 'mastery_mode' })
    .select('studentId language')
    .lean();

  let fired = 0;
  for (const p of plans) {
    try {
      const r = await maybePushMasteryWeekly({ userId: p.studentId, language: p.language });
      if (r.pushed) fired++;
    } catch (err) {
      console.error(`[Quiz/Mastery] Sweep failed for ${p.studentId}:`, err.message);
    }
  }
  console.log(`🏛️  [Quiz/Mastery] Weekly sweep: fired ${fired} of ${plans.length} mastery plans.`);
  return { fired, considered: plans.length };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function _getOrCreateHistory(userId, language) {
  let history = await UserQuizHistory.findOne({ userId });
  if (!history) {
    history = new UserQuizHistory({ userId, language, seen: [] });
    await history.save();
  }
  return history;
}

function _todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Used by the Materials Quiz section to list pushed/seen quizzes. */
async function listSeenForUser(userId, language) {
  const history = await UserQuizHistory.findOne({ userId, language }).lean();
  if (!history) return [];
  // Hydrate quiz docs in bulk.
  const ids = (history.seen || []).map(s => s.quizId);
  const quizzes = await Quiz.find({ _id: { $in: ids } }).lean();
  const byId = new Map(quizzes.map(q => [String(q._id), q]));
  return (history.seen || []).slice().reverse().map(s => ({
    quizId: s.quizId,
    pushedAt: s.pushedAt,
    completedAt: s.completedAt,
    rating: s.rating,
    trigger: s.trigger,
    personalizedHeader: s.personalizedHeader,
    quiz: byId.get(String(s.quizId)) || null
  }));
}

/** Browse the static (curated/AI) library — for free tier (G28) and for
 *  premium users who want to retake. */
async function browsePool({ language, level, struggle, limit = 20 }) {
  const q = { retiredAt: null };
  if (language) q.language = language;
  if (level) q.level = level;
  if (struggle) q.struggle = struggle;
  return Quiz.find(q).limit(limit).lean();
}

module.exports = {
  selectAndPushQuiz,
  recordQuizCompletion,
  pushImmediateFromLesson,
  prewarmRoadblockQuiz,
  runEndOfDayBatch,
  generateAndSaveQuiz,
  listSeenForUser,
  browsePool,
  // Batch 13 — Mastery Mode
  maybePushMasteryWeekly,
  runMasteryModeWeeklySweep,
  MASTERY_MODE_THEMES,
  MASTERY_MODE_WEEKLY_INTERVAL_HOURS,
  // Constants exported for tests + docs
  DAILY_PUSH_CAP,
  STRUGGLE_COOLDOWN_HOURS,
  AUTO_PAUSE_AFTER_NEGATIVE_RATINGS,
  AUTO_PAUSE_DURATION_DAYS,
  POOL_VARIANTS_TARGET
};
