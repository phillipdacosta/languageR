/**
 * Roadblock checkpoint content — tiered, honesty-labeled, save-friendly.
 *
 * The journey gate must ALWAYS produce something useful, but its content
 * source degrades gracefully so we never quiz a student on things they
 * never touched (the "what is cat in German?" bug):
 *
 *   Tier A — AI analysis ON: build the quiz DETERMINISTICALLY from the
 *            student's own mistakes (original → corrected). Zero AI, zero
 *            drift — it is provably "things you went over".
 *            Label: "Based on your recent lessons".
 *
 *   Tier B — AI off, but a tutor left notes/feedback/homework: one grounded
 *            AI extraction, restricted to that text. MC / true-false only,
 *            with fill-blank ONLY when a concrete correction exists.
 *            Label: "Based on your tutor's notes".
 *
 *   Tier C — Nothing found: a goal-inferred LEARNING moment (teach → check).
 *            MC / true-false only (no hard fill-blank). Every card is
 *            saveable to the review deck.
 *            Label: "A quick checkpoint".
 *
 * Personal quizzes are persisted scoped to the student (`personalForUserId`)
 * so they never leak into the shared pool, and are registered in
 * UserQuizHistory with trigger 'roadblock' so completion folds into the
 * skill belief AND a reopened gate re-serves the SAME quiz (idempotent).
 */

const OpenAI = require('openai');
const Quiz = require('../models/Quiz');
const UserQuizHistory = require('../models/UserQuizHistory');
const LessonAnalysis = require('../models/LessonAnalysis');
const TutorFeedback = require('../models/TutorFeedback');
const struggleAggregator = require('./struggleAggregator');
const bayes = require('./bayesianMastery');

// Bump whenever the generation/validation logic changes in a way that should
// invalidate previously-cached personal quizzes (forces a one-time rebuild on
// the next gate open). v2: reject meta-instruction examples + constructive tips.
const CONTENT_VERSION = 2;

let _openai = null;
function getOpenAIClient() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI API key is required.');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// Interface (UI) language code → English name, for instructing the model
// which language to translate the prompt INTO. Falls back to English.
const INTERFACE_LANG_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', 'pt-br': 'Portuguese', nl: 'Dutch', pl: 'Polish',
  ru: 'Russian', uk: 'Ukrainian', tr: 'Turkish', ar: 'Arabic', hi: 'Hindi',
  ja: 'Japanese', ko: 'Korean', zh: 'Chinese', 'zh-cn': 'Chinese',
  'zh-tw': 'Chinese (Traditional)', vi: 'Vietnamese', th: 'Thai',
  id: 'Indonesian', sv: 'Swedish', no: 'Norwegian', da: 'Danish',
  fi: 'Finnish', cs: 'Czech', el: 'Greek', he: 'Hebrew', ro: 'Romanian',
  hu: 'Hungarian'
};

function _interfaceLangName(code) {
  if (!code) return 'English';
  const key = String(code).toLowerCase();
  return INTERFACE_LANG_NAMES[key] || INTERFACE_LANG_NAMES[key.split('-')[0]] || 'English';
}

const GOAL_LABELS = {
  conversational: 'everyday conversation',
  exam_prep: 'your exam',
  professional: 'professional / work situations',
  travel: 'travel',
  relocation: 'living abroad',
  other: 'your goal'
};

function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _clean(s) { return String(s || '').trim(); }

// ─────────────────────────────────────────────────────────────────────
// Persistence + idempotency
// ─────────────────────────────────────────────────────────────────────

async function _getHistory(userId, language) {
  let history = await UserQuizHistory.findOne({ userId });
  if (!history) {
    history = new UserQuizHistory({ userId, language, seen: [] });
    await history.save();
  }
  return history;
}

/** Reuse a not-yet-completed roadblock quiz so a reopened gate is stable.
 *  Skips reuse when it was built for a different interface language so the
 *  prompt translations stay correct (and pre-translation quizzes refresh). */
async function _findPendingRoadblockQuiz(history, language, interfaceLanguage) {
  const pending = (history.seen || [])
    .slice()
    .reverse()
    .find(s => s.trigger === 'roadblock' && String(s.language) === String(language) && !s.completedAt);
  if (!pending?.quizId) return null;
  const quiz = await Quiz.findOne({ _id: pending.quizId, retiredAt: null }).lean();
  if (!quiz) return null;
  if ((quiz.builtForInterfaceLang || '') !== (interfaceLanguage || '')) return null;
  // Stale content (built by an older generator) → rebuild instead of reuse.
  if ((quiz.quizVersion || 1) !== CONTENT_VERSION) return null;
  return { quiz, personalizedHeader: pending.personalizedHeader || '', tier: pending.theme || '' };
}

async function _persistPersonalQuiz({ userId, language, level, struggleKey, title, description, questions, source, tier, personalizedHeader, interfaceLanguage }) {
  const doc = new Quiz({
    language,
    level,
    struggle: struggleKey,
    type: 'drill',
    title: title.slice(0, 50),
    description: description || '',
    questions,
    templateVariant: 0,
    source,
    personalForUserId: userId,
    builtForInterfaceLang: interfaceLanguage || '',
    quizVersion: CONTENT_VERSION
  });
  await doc.save();

  const history = await _getHistory(userId, language);
  history.seen.push({
    quizId: doc._id,
    language,
    struggle: struggleKey,
    pushedAt: new Date(),
    trigger: 'roadblock',
    theme: tier,
    personalizedHeader: personalizedHeader || ''
  });
  await history.save();

  return doc.toObject();
}

// ─────────────────────────────────────────────────────────────────────
// Tier A — grounded in the student's OWN mistakes (deterministic)
// ─────────────────────────────────────────────────────────────────────

// A usable correction is an actual minimal pair of LEARNER TEXT — not a
// meta-instruction like "(reduce fillers)" or an error label. Garbage in →
// a nonsensical "which is correct?" question, so we reject hard.
function _isUsableCorrection(original, corrected) {
  if (!original || !corrected) return false;
  if (original.toLowerCase() === corrected.toLowerCase()) return false;
  // Parenthetical annotations / coaching notes, not sample text.
  if (/[()\[\]]/.test(original) || /[()\[\]]/.test(corrected)) return false;
  // Instruction-style phrasing ("reduce ...", "use more ...", "avoid ...").
  const instruction = /^(reduce|use|avoid|add|remove|drop|replace|try|remember|practice|practise|focus|work on|include|consider|more|less|fewer|don'?t|do not)\b/i;
  if (instruction.test(original) || instruction.test(corrected)) return false;
  // Common meta keywords that show up in fluency/coaching notes.
  if (/\bfiller|\bpause|\bintonation|\bpronunciation\b/i.test(`${original} ${corrected}`)) return false;
  // Must contain real letters and not be paragraph-length.
  if (!/\p{L}/u.test(original) || !/\p{L}/u.test(corrected)) return false;
  if (original.length > 120 || corrected.length > 120) return false;
  return true;
}

function _exampleToQuestion(ex) {
  const original = _clean(ex.original);
  const corrected = _clean(ex.corrected);
  if (!_isUsableCorrection(original, corrected)) return null;

  // Build a CONSTRUCTIVE tip. The analysis explanation usually describes
  // what was WRONG ("Incorrect article…"), which reads badly as "here's the
  // idea". So lead with the fix, and only append the analysis note when it
  // reads like guidance (not an error label).
  const note = _clean(ex.explanation);
  const isErrorLabel = /incorrect|wrong|error|mistake|should not|avoid|missing|misuse/i.test(note);
  const tip = `The correct version is "${corrected}".` + (note && !isErrorLabel ? ` ${note}` : '');

  const options = _shuffle([corrected, original]);
  return {
    question: {
      type: 'multiple_choice',
      prompt: 'Which version is correct?',
      promptKey: 'JOURNEY.ROADBLOCK.WHICH_CORRECT',
      options,
      correctAnswer: corrected,
      explanation: tip,
      example: corrected
    },
    reviewItem: {
      itemType: 'correction',
      original,
      corrected,
      explanation: note,
      errorType: 'other'
    }
  };
}

function _buildTierAFromStruggles(struggles) {
  const questions = [];
  const reviewItems = [];
  const seen = new Set();
  for (const s of struggles) {
    if (bayes.isMastered(s.belief)) continue;
    for (const ex of (s.examples || [])) {
      const key = `${_clean(ex.original).toLowerCase()}→${_clean(ex.corrected).toLowerCase()}`;
      if (seen.has(key)) continue;
      const built = _exampleToQuestion(ex);
      if (!built) continue;
      seen.add(key);
      questions.push(built.question);
      reviewItems.push({ ...built.reviewItem, context: s.displayName || '' });
      if (questions.length >= 6) break;
    }
    if (questions.length >= 6) break;
  }
  return { questions, reviewItems };
}

// ─────────────────────────────────────────────────────────────────────
// Tier B — grounded in tutor-left notes (one AI extraction)
// ─────────────────────────────────────────────────────────────────────

async function _collectTutorSignal({ user, language }) {
  const snippets = [];

  // Tutor feedback (manual flow used when AI analysis is off).
  const feedback = await TutorFeedback.find({ studentId: user.auth0Id })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  for (const f of feedback) {
    (f.areasForImprovement || []).forEach(t => snippets.push(_clean(t)));
    if (f.homework) snippets.push(`Homework: ${_clean(f.homework)}`);
    if (f.overallNotes) snippets.push(_clean(f.overallNotes));
  }

  // Tutor notes attached to lesson analyses (present even when AI summary off).
  const analyses = await LessonAnalysis.find({ studentId: String(user._id), language })
    .sort({ lessonDate: -1 })
    .limit(5)
    .select('tutorNote')
    .lean();
  for (const a of analyses) {
    if (a.tutorNote?.text) snippets.push(_clean(a.tutorNote.text));
    if (a.tutorNote?.homework) snippets.push(`Homework: ${_clean(a.tutorNote.homework)}`);
  }

  return snippets.filter(Boolean).slice(0, 12);
}

async function _buildTierBFromTutorSignal({ language, level, snippets, interfaceLangName }) {
  const prompt = `A language tutor left these notes about a ${level} ${language} learner.
Build a short checkpoint quiz GROUNDED ONLY in these notes — do NOT invent
unrelated topics or vocabulary.

TUTOR NOTES:
${snippets.map((s, i) => `${i + 1}. ${s}`).join('\n')}

RULES:
- 4 to 6 questions, all derived from the notes above.
- Use ONLY "multiple_choice" or "true_false" question types.
- Use "fill_blank" ONLY if a note states a concrete correction with exactly
  one right answer; otherwise never use it.
- Every question solvable by a ${level} learner.
- Each question: a clear prompt, the correct answer, a 1-sentence explanation.
- For multiple_choice, "correctAnswer" MUST be EXACTLY one of the strings in
  "options" (copy it verbatim). Never let the answer be missing from options.
- "promptTranslation": the prompt translated into ${interfaceLangName} so the
  student understands what is being asked (leave "" if the prompt is already
  in ${interfaceLangName}).

Respond ONLY with valid JSON:
{ "title": "string (max 50 chars)", "description": "string",
  "questions": [ { "type": "multiple_choice|true_false|fill_blank",
    "prompt": "string", "promptTranslation": "string", "options": ["string"],
    "correctAnswer": "string", "explanation": "string" } ] }`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a language pedagogy expert. Respond with valid JSON only. Stay strictly within the tutor notes provided.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4,
    max_tokens: 1200,
    response_format: { type: 'json_object' }
  });
  const draft = JSON.parse(completion.choices[0].message.content);
  const questions = _normalizeQuestions(draft.questions);
  const reviewItems = snippets.slice(0, 6).map(s => ({
    itemType: 'tip',
    original: '',
    corrected: s,
    explanation: '',
    context: 'From your tutor',
    errorType: 'other'
  }));
  return { title: draft.title || 'Tutor checkpoint', description: draft.description || '', questions, reviewItems };
}

// ─────────────────────────────────────────────────────────────────────
// Tier C — goal-inferred learning moment (teach → check, MC/TF only)
// ─────────────────────────────────────────────────────────────────────

async function _buildTierCFromGoal({ language, level, goalType, goalDescription, interfaceLangName }) {
  const goalLabel = GOAL_LABELS[goalType] || GOAL_LABELS.other;
  const prompt = `Create a short, encouraging LEARNING checkpoint for a ${level}
${language} learner whose goal is ${goalLabel}${goalDescription ? ` ("${goalDescription}")` : ''}.

This is a TEACH-THEN-CHECK moment (the student has no recorded mistakes yet),
so first teach a useful phrase, then check recognition.

RULES:
- 4 to 5 items, all relevant to the goal "${goalLabel}" and within ${level}.
- Use ONLY "multiple_choice" or "true_false". NEVER use fill_blank or translate.
- For each item, teach a concrete, useful ${language} phrase in the "example"
  field (the target-language phrase) and put its meaning + when to use it
  (written in ${interfaceLangName}) in "explanation".
- The prompt should check recognition (e.g. "Which phrase asks for directions?").
- "correctAnswer" MUST be EXACTLY one of the strings in "options" (copy it
  verbatim). Never let the correct answer be missing from the options.
- "promptTranslation": the prompt translated into ${interfaceLangName} so the
  student understands what is being asked (leave "" if already in ${interfaceLangName}).

Respond ONLY with valid JSON:
{ "title": "string (max 50 chars)", "description": "string",
  "questions": [ { "type": "multiple_choice|true_false", "prompt": "string",
    "promptTranslation": "string", "options": ["string"], "correctAnswer": "string",
    "explanation": "string", "example": "target-language phrase" } ] }`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a friendly language coach. Respond with valid JSON only. Teach genuinely useful, level-appropriate phrases for the stated goal.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_tokens: 1200,
    response_format: { type: 'json_object' }
  });
  const draft = JSON.parse(completion.choices[0].message.content);
  const questions = _normalizeQuestions(draft.questions);
  const reviewItems = questions
    .filter(q => _clean(q.example))
    .map(q => ({
      itemType: 'phrase',
      original: '',
      corrected: _clean(q.example),
      explanation: _clean(q.explanation),
      context: `For ${goalLabel}`,
      errorType: 'other'
    }));
  return { title: draft.title || 'Quick checkpoint', description: draft.description || '', questions, reviewItems };
}

// ─────────────────────────────────────────────────────────────────────
// Shared question normalization (maps true_false → multiple_choice so the
// existing modal renders it; strips unsafe fill-blank).
// ─────────────────────────────────────────────────────────────────────

function _normalizeQuestions(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(q => {
      if (!q || !q.prompt || !q.correctAnswer) return null;
      let type = q.type;
      let options = Array.isArray(q.options) ? q.options.filter(Boolean) : [];

      const correctAnswer = _clean(q.correctAnswer);

      if (type === 'true_false') {
        type = 'multiple_choice';
        if (options.length < 2) options = ['True', 'False'];
      }
      // Personal-tier quizzes never serve a hard fill-blank unless it is a
      // single-answer concrete item — downgrade anything risky to MC.
      if (type === 'fill_blank' && options.length < 2) {
        // keep as fill_blank only if it clearly has one answer; otherwise drop.
        if (!correctAnswer) return null;
      }

      // CRITICAL safety: a multiple-choice question is un-passable (and the
      // gate is un-failable) if the correct answer isn't among the options.
      // Guarantee it is present, then de-dupe so it can always be selected.
      if (type !== 'fill_blank') {
        if (!correctAnswer) return null;
        const hasCorrect = options.some(o => _clean(o).toLowerCase() === correctAnswer.toLowerCase());
        if (!hasCorrect) options.push(correctAnswer);
        const seenOpt = new Set();
        options = options.filter(o => {
          const k = _clean(o).toLowerCase();
          if (!k || seenOpt.has(k)) return false;
          seenOpt.add(k);
          return true;
        });
        if (options.length < 2) return null;
      }

      return {
        type: type === 'fill_blank' ? 'fill_blank' : 'multiple_choice',
        prompt: _clean(q.prompt),
        promptTranslation: _clean(q.promptTranslation),
        options: type === 'fill_blank' ? [] : _shuffle(options),
        correctAnswer,
        acceptableAlternatives: Array.isArray(q.acceptableAlternatives) ? q.acceptableAlternatives : [],
        openAnswer: false,
        explanation: _clean(q.explanation),
        example: _clean(q.example)
      };
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────

/**
 * Build (or reuse) the gate package for a student.
 * @returns {Promise<{available, tier, label, quiz, struggle, struggleLabel,
 *   personalizedHeader, reviewItems, reason?}>}
 */
async function buildGate({ user, plan, language, level, interfaceLanguage }) {
  const interfaceLangName = _interfaceLangName(interfaceLanguage);
  const history = await _getHistory(user._id, language);

  // Idempotent reuse: a reopened gate serves the same pending quiz.
  const pending = await _findPendingRoadblockQuiz(history, language, interfaceLanguage);
  if (pending) {
    return {
      available: true,
      tier: pending.tier || 'reused',
      label: pending.personalizedHeader,
      quiz: pending.quiz,
      struggle: pending.quiz.struggle,
      struggleLabel: '',
      personalizedHeader: pending.personalizedHeader,
      reviewItems: []
    };
  }

  // ── Tier A: the student's own mistakes ──────────────────────────────
  const agg = await struggleAggregator.aggregateStruggles({ studentId: user._id, language, plan });
  const struggles = agg.struggles || [];
  const tierA = _buildTierAFromStruggles(struggles);
  if (tierA.questions.length >= 2) {
    const top = struggles.find(s => !bayes.isMastered(s.belief)) || struggles[0];
    const label = 'Based on what you practiced in recent lessons.';
    const quiz = await _persistPersonalQuiz({
      userId: user._id, language, level,
      struggleKey: top?.skillId || 'recent_mistakes',
      title: 'Checkpoint: your recent lessons',
      description: 'A quick check on what you worked on.',
      questions: tierA.questions,
      source: 'roadblock_personal',
      tier: 'A',
      personalizedHeader: label,
      interfaceLanguage
    });
    return {
      available: true, tier: 'A', label, quiz,
      struggle: top?.skillId || '', struggleLabel: top?.displayName || '',
      personalizedHeader: label, reviewItems: tierA.reviewItems
    };
  }

  // ── Tier B: tutor-left signal ───────────────────────────────────────
  try {
    const snippets = await _collectTutorSignal({ user, language });
    if (snippets.length > 0) {
      const built = await _buildTierBFromTutorSignal({ language, level, snippets, interfaceLangName });
      if (built.questions.length >= 2) {
        const label = "Based on your tutor's notes.";
        const quiz = await _persistPersonalQuiz({
          userId: user._id, language, level,
          struggleKey: 'tutor_notes',
          title: built.title, description: built.description,
          questions: built.questions, source: 'roadblock_personal',
          tier: 'B', personalizedHeader: label, interfaceLanguage
        });
        return {
          available: true, tier: 'B', label, quiz,
          struggle: 'tutor_notes', struggleLabel: '',
          personalizedHeader: label, reviewItems: built.reviewItems
        };
      }
    }
  } catch (err) {
    console.error('[Roadblock] Tier B extraction failed, falling through:', err.message);
  }

  // ── Tier C: goal-inferred learning moment ───────────────────────────
  try {
    const built = await _buildTierCFromGoal({
      language, level,
      goalType: plan?.goal?.type || 'other',
      goalDescription: plan?.goal?.description || '',
      interfaceLangName
    });
    if (built.questions.length >= 2) {
      const goalLabel = GOAL_LABELS[plan?.goal?.type] || GOAL_LABELS.other;
      const label = `A quick checkpoint for ${goalLabel}.`;
      const quiz = await _persistPersonalQuiz({
        userId: user._id, language, level,
        struggleKey: `goal_${plan?.goal?.type || 'other'}`,
        title: built.title, description: built.description,
        questions: built.questions, source: 'goal_inferred',
        tier: 'C', personalizedHeader: label, interfaceLanguage
      });
      return {
        available: true, tier: 'C', label, quiz,
        struggle: '', struggleLabel: '',
        personalizedHeader: label, reviewItems: built.reviewItems
      };
    }
  } catch (err) {
    console.error('[Roadblock] Tier C generation failed:', err.message);
  }

  // Truly nothing we can build — let the student cross with a friendly note.
  return { available: false, reason: 'no_content_available' };
}

module.exports = { buildGate };
