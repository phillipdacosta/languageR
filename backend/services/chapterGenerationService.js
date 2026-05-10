/**
 * Chapter generation service.
 *
 * Two paths:
 *   - Free   → deterministic template per CEFR level, goal-flavored phase content.
 *   - Premium → AI generation that tunes phases to the student's struggles
 *               and trajectory in the chapter they just completed.
 *
 * Both paths return 4 phases ready to assign to plan.phases.
 *
 * Premium AI failure → silent fallback to template (G7).
 *
 * Used by learningPlanService._completeChapterAndGenerateNext and
 * _demoteOneChapter.
 */

const OpenAI = require('openai');
const entitlements = require('./entitlementsService');

let openai = null;
function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key is required.');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ─────────────────────────────────────────────────────────────────────
// Templates (free path, deterministic)
// ─────────────────────────────────────────────────────────────────────

// Per-CEFR-level skeleton phases. Each phase template is goal-flavored
// at runtime (we slot the student's goal into focusAreas + suggestedTopics).
//
// Phase order within a chapter is intentional: foundation → practice →
// real-world application → consolidation. This mirrors the existing
// structure new plans are seeded with.
const CHAPTER_TEMPLATES = {
  A1: {
    title: 'Beginner Foundations',
    phases: [
      {
        title: 'Greetings, numbers, and basic verbs',
        description: 'Learn to introduce yourself, count, and express simple needs.',
        focusAreas: ['greetings', 'numbers 1-100', 'basic verbs (be, have, do)'],
        exitCriteria: 'Can introduce yourself and ask basic questions.',
        estimatedLessons: 5
      },
      {
        title: 'Daily life vocabulary',
        description: 'Vocabulary for food, family, daily routine, and time.',
        focusAreas: ['daily routine', 'food and drink', 'family members'],
        exitCriteria: 'Can describe your day in 4-5 sentences.',
        estimatedLessons: 5
      },
      {
        title: 'Simple conversations',
        description: 'Hold short exchanges in shops, cafés, and on the street.',
        focusAreas: ['ordering', 'directions', 'asking questions'],
        exitCriteria: 'Can complete a basic transaction.',
        estimatedLessons: 5
      },
      {
        title: 'Personal stories',
        description: 'Talk about yourself in past, present, and future.',
        focusAreas: ['simple past', 'simple future', 'connecting words'],
        exitCriteria: 'Can tell a 1-minute story about your week.',
        estimatedLessons: 5
      }
    ]
  },
  A2: {
    title: 'Elementary Expansion',
    phases: [
      {
        title: 'Past tense fluency',
        description: 'Speak comfortably about past events and experiences.',
        focusAreas: ['past tense', 'time expressions', 'sequencing'],
        exitCriteria: 'Tell a 2-minute story about a past event.',
        estimatedLessons: 5
      },
      {
        title: 'Future plans and intentions',
        description: 'Talk about plans, goals, and predictions.',
        focusAreas: ['future tense', 'modal verbs', 'plans vs intentions'],
        exitCriteria: 'Describe your plans for next month with detail.',
        estimatedLessons: 5
      },
      {
        title: 'Opinions and preferences',
        description: 'Express likes, dislikes, and reasoning behind preferences.',
        focusAreas: ['opinion phrases', 'comparatives', 'reason connectors'],
        exitCriteria: 'Compare two options and explain your choice.',
        estimatedLessons: 5
      },
      {
        title: 'Real-world A2',
        description: 'Apply A2 skills in travel, work, and social contexts.',
        focusAreas: ['situational dialogues', 'cultural notes', 'small talk'],
        exitCriteria: 'Hold a 5-minute conversation on a familiar topic.',
        estimatedLessons: 5
      }
    ]
  },
  B1: {
    title: 'Intermediate Confidence',
    phases: [
      {
        title: 'Complex past structures',
        description: 'Master past perfect, conditionals, and reported speech.',
        focusAreas: ['past perfect', 'reported speech', 'time clauses'],
        exitCriteria: 'Recount a complex story with multiple time references.',
        estimatedLessons: 5
      },
      {
        title: 'Conditionals and hypotheticals',
        description: 'Talk about hypothetical situations and "what if" scenarios.',
        focusAreas: ['1st/2nd conditional', 'hypothetical phrases', 'wish'],
        exitCriteria: 'Discuss "what if" in a 3-minute conversation.',
        estimatedLessons: 5
      },
      {
        title: 'Abstract topics',
        description: 'Discuss feelings, society, and personal beliefs.',
        focusAreas: ['abstract nouns', 'opinion essays', 'agreeing/disagreeing'],
        exitCriteria: 'Defend an opinion with 3+ supporting reasons.',
        estimatedLessons: 5
      },
      {
        title: 'B1 application',
        description: 'Use B1 skills in professional or academic contexts.',
        focusAreas: ['workplace vocab', 'meeting phrases', 'presentation language'],
        exitCriteria: 'Give a 3-minute presentation on a familiar topic.',
        estimatedLessons: 5
      }
    ]
  },
  B2: {
    title: 'Upper-Intermediate Fluency',
    phases: [
      {
        title: 'Nuance and idioms',
        description: 'Add idioms and natural expressions to your speech.',
        focusAreas: ['common idioms', 'collocations', 'register awareness'],
        exitCriteria: 'Use 5+ idioms naturally in conversation.',
        estimatedLessons: 5
      },
      {
        title: 'Argumentation',
        description: 'Construct and defend arguments with sophistication.',
        focusAreas: ['advanced connectors', 'concession', 'rebuttal phrases'],
        exitCriteria: 'Hold a 5-minute debate on a current event.',
        estimatedLessons: 5
      },
      {
        title: 'Cultural depth',
        description: 'Engage with culture, media, and humor.',
        focusAreas: ['cultural references', 'humor', 'media literacy'],
        exitCriteria: 'Discuss a film, book, or news article with confidence.',
        estimatedLessons: 5
      },
      {
        title: 'B2 polish',
        description: 'Refine accuracy and flow across all contexts.',
        focusAreas: ['error correction', 'fluency drills', 'speed and rhythm'],
        exitCriteria: 'Speak for 5 minutes with minimal hesitation.',
        estimatedLessons: 5
      }
    ]
  },
  C1: {
    title: 'Advanced Mastery',
    phases: [
      {
        title: 'Sophisticated structures',
        description: 'Master complex grammar and rhetorical devices.',
        focusAreas: ['inversion', 'cleft sentences', 'subjunctive'],
        exitCriteria: 'Use C1-level structures appropriately in formal contexts.',
        estimatedLessons: 5
      },
      {
        title: 'Specialized vocabulary',
        description: 'Build expertise in your professional or academic field.',
        focusAreas: ['domain-specific vocab', 'jargon', 'technical phrasing'],
        exitCriteria: 'Discuss your field with a native speaker.',
        estimatedLessons: 5
      },
      {
        title: 'Persuasion and rhetoric',
        description: 'Persuade, negotiate, and lead conversations.',
        focusAreas: ['persuasive language', 'negotiation phrases', 'leadership tone'],
        exitCriteria: 'Lead a 10-minute meeting or discussion.',
        estimatedLessons: 5
      },
      {
        title: 'C1 consolidation',
        description: 'Lock in fluency and prepare for near-native expression.',
        focusAreas: ['register switching', 'subtle nuances', 'cultural fluency'],
        exitCriteria: 'Switch register seamlessly between formal and casual.',
        estimatedLessons: 5
      }
    ]
  },
  C2: {
    title: 'Near-Native Expression',
    phases: [
      {
        title: 'Stylistic precision',
        description: 'Choose the perfect word for every context.',
        focusAreas: ['lexical precision', 'stylistic variation', 'literary devices'],
        exitCriteria: 'Edit your own writing for style and tone.',
        estimatedLessons: 5
      },
      {
        title: 'Cultural mastery',
        description: 'Engage with literature, history, and current affairs at depth.',
        focusAreas: ['cultural commentary', 'historical context', 'literary analysis'],
        exitCriteria: 'Analyze a piece of literature or a complex article.',
        estimatedLessons: 5
      },
      {
        title: 'Expert communication',
        description: 'Communicate with the precision of a near-native speaker.',
        focusAreas: ['academic writing', 'public speaking', 'professional negotiation'],
        exitCriteria: 'Deliver a polished 15-minute presentation.',
        estimatedLessons: 5
      },
      {
        title: 'C2 mastery',
        description: 'Final polish — you are now a C2 speaker.',
        focusAreas: ['nuance refinement', 'creative expression', 'mastery maintenance'],
        exitCriteria: 'Indistinguishable from a fluent speaker in most contexts.',
        estimatedLessons: 5
      }
    ]
  }
};

/**
 * Generate a chapter from a CEFR template, lightly flavored by the
 * student's goal. Deterministic — no AI cost. Used by:
 *   - free students always
 *   - premium students as fallback when AI fails (G7)
 *   - all students on demotion (no AI cost on regression)
 */
function generateChapterFromTemplate(level, goal) {
  const tpl = CHAPTER_TEMPLATES[level] || CHAPTER_TEMPLATES.A1;
  const goalDescription = goal?.description || '';
  const goalType = goal?.type || 'conversational';

  // Pace-tuned baseline lesson budget per phase. We deliberately keep
  // the template's 4-phase pedagogical structure intact (free users
  // always get foundation → practice → application → consolidation), but
  // we let the student's stated timeline shrink/grow the per-phase
  // lesson count. Mastery floor/ceiling still apply at runtime.
  let baselineLessons = null;
  try {
    const pace = require('./paceService');
    baselineLessons = pace.describe(goal).estimatedLessonsPerPhase;
  } catch (_) {
    baselineLessons = null;
  }

  return tpl.phases.map((p) => {
    const goalTopic = _goalTopicSeed(goalType, goalDescription);
    return {
      title: p.title,
      description: p.description,
      focusAreas: p.focusAreas.slice(),
      suggestedTopics: goalTopic ? [goalTopic] : [],
      exitCriteria: p.exitCriteria,
      estimatedLessons: baselineLessons || p.estimatedLessons
    };
  });
}

function _goalTopicSeed(goalType, goalDescription) {
  const seeds = {
    conversational: 'casual conversations with friends',
    travel: 'travel, transport, accommodation',
    professional: 'workplace and meetings',
    exam_prep: 'exam-style tasks and rubrics',
    relocation: 'living abroad scenarios',
    other: ''
  };
  const base = seeds[goalType] || '';
  if (goalDescription) return `${base ? base + ' · ' : ''}${goalDescription}`.slice(0, 120);
  return base;
}

// ─────────────────────────────────────────────────────────────────────
// AI generation (premium path)
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate the next chapter using AI, tuned to the student's mastery
 * trajectory and persistent struggles in the chapter they just completed.
 *
 * Returns 4 phases (same shape as template). Throws on error so the caller
 * can fall back to template (G7).
 */
async function generateChapterWithAi(plan, opts) {
  const {
    completedChapterIndex,
    completedChapterLevel,
    nextLevel,
    completedPhases
  } = opts;

  const goal = plan.goal || {};
  const language = plan.language;

  // Compress the completed chapter to a small summary the model can reason about.
  const trajectory = (completedPhases || []).map((p, i) => ({
    phase: i + 1,
    title: p.title,
    lessonsCompleted: p.lessonsCompleted || 0,
    masteryAverage: p.masteryAverage,
    finishedFocus: (p.focusAreas || []).slice(0, 4)
  }));

  // Pull persistent struggles from the plan history (anything the rule path
  // surfaced repeatedly). Keep it tight to keep the prompt small.
  const recentStruggles = _extractRecentStruggles(plan);

  const pace = require('./paceService');
  const paceDescriptor = pace.describe(goal);

  const prompt = `Generate the next chapter of a personalized language learning plan.

LANGUAGE: ${language}
GOAL: ${goal.type || 'conversational'} — ${goal.description || ''}
COMPLETED CHAPTER: ${completedChapterLevel} (chapter ${completedChapterIndex + 1})
NEXT CHAPTER: ${nextLevel}
${pace.buildAiPromptLine(goal)}

TRAJECTORY THROUGH COMPLETED CHAPTER:
${JSON.stringify(trajectory, null, 2)}

PERSISTENT STRUGGLES (focus the new chapter to reinforce these where natural):
${recentStruggles.length > 0 ? recentStruggles.map(s => `- ${s}`).join('\n') : '(none flagged)'}

Design ${paceDescriptor.phaseCount} sequential phases for the ${nextLevel} chapter that:
1. Build on what they mastered in ${completedChapterLevel}
2. Address persistent struggles where they're naturally relevant (don't force it)
3. Stay keyed to their stated goal (${goal.type})
4. Progress from foundation → practice → application → consolidation
5. Each phase has ~${paceDescriptor.estimatedLessonsPerPhase} estimated lessons (urgency adjusts cadence, not depth-per-lesson)
6. Each phase has a CONCRETE exit criterion (e.g., "tell a 3-minute story", not "feel comfortable")

Return JSON:
{
  "phases": [
    {
      "title": "string (max 50 chars)",
      "description": "string (1-2 sentences)",
      "focusAreas": ["string", ...],
      "suggestedTopics": ["string — concrete conversation scenarios"],
      "exitCriteria": "string — concrete observable milestone",
      "estimatedLessons": 5
    }
  ]
}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert language teacher creating personalized chapter plans. Always respond with valid JSON only. Be concrete and language-specific.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty AI response.');
  const parsed = JSON.parse(raw);
  const phases = parsed.phases;
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error('AI returned no phases.');
  }

  // Clamp / sanitize, sized to the pace-derived phase count (3-5).
  const targetPhaseCount = Math.max(3, Math.min(5, paceDescriptor.phaseCount));
  const baselineLessons = paceDescriptor.estimatedLessonsPerPhase;
  const cleaned = phases.slice(0, targetPhaseCount).map((p) => ({
    title: String(p.title || '').trim().slice(0, 60),
    description: String(p.description || '').trim().slice(0, 280),
    focusAreas: Array.isArray(p.focusAreas) ? p.focusAreas.map(s => String(s).slice(0, 60)).slice(0, 6) : [],
    suggestedTopics: Array.isArray(p.suggestedTopics) ? p.suggestedTopics.map(s => String(s).slice(0, 80)).slice(0, 4) : [],
    exitCriteria: String(p.exitCriteria || '').trim().slice(0, 200),
    estimatedLessons: Number.isFinite(p.estimatedLessons) ? Math.max(3, Math.min(8, p.estimatedLessons)) : baselineLessons
  }));

  // Pad if AI returned fewer than the pace-target. Use template phases.
  if (cleaned.length < targetPhaseCount) {
    const tpl = generateChapterFromTemplate(nextLevel, goal);
    while (cleaned.length < targetPhaseCount && tpl[cleaned.length]) {
      cleaned.push(tpl[cleaned.length]);
    }
  }

  return cleaned;
}

function _extractRecentStruggles(plan) {
  // Pull the last ~10 history entries, look for any associated reasons that
  // suggest the student got stuck. This is intentionally heuristic — we
  // don't want a perfect signal here; we want to nudge the AI.
  const recent = (plan.history || []).slice(-15);
  const stuckReasons = recent
    .filter(h => ['min_lessons', 'mastery_below_threshold', 'decay_warning'].includes(h.reason))
    .map(h => h.changeDescription);
  // Dedupe and cap.
  return [...new Set(stuckReasons)].slice(0, 5);
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point used by learningPlanService
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate the next chapter's 4 phases.
 *
 * Routes:
 *   - Premium + not-forceTemplate → AI path; on error, fall back to template.
 *   - Free OR forceTemplate → template path.
 *
 * @param {Object} plan       The learning plan (Mongoose doc; needs .studentId)
 * @param {Object} opts
 * @param {Number} opts.completedChapterIndex
 * @param {String} opts.completedChapterLevel
 * @param {String} opts.nextLevel
 * @param {Array}  opts.completedPhases
 * @param {Boolean} [opts.forceTemplate]   demotion / fallback path
 * @returns {Promise<Array>}  4 phase objects
 */
async function generateNextChapter(plan, opts) {
  const { nextLevel, forceTemplate } = opts;
  const goal = plan.goal || {};

  // Decide path.
  let usePremiumAi = false;
  if (!forceTemplate) {
    try {
      const User = require('../models/User');
      const student = await User.findById(plan.studentId).lean();
      usePremiumAi = entitlements.canUseAdaptivePlanAi(student);
    } catch (err) {
      console.warn('[ChapterGen] Could not determine entitlement, defaulting to template:', err.message);
      usePremiumAi = false;
    }
  }

  if (usePremiumAi) {
    try {
      const phases = await generateChapterWithAi(plan, opts);
      console.log(`✨ [ChapterGen] AI generated ${phases.length} phases for ${nextLevel}`);
      return phases;
    } catch (err) {
      console.error('[ChapterGen] AI generation failed, using template fallback:', err.message);
      // Fall through to template (G7).
    }
  }

  const phases = generateChapterFromTemplate(nextLevel, goal);
  console.log(`📋 [ChapterGen] Template generated ${phases.length} phases for ${nextLevel}`);
  return phases;
}

// ─────────────────────────────────────────────────────────────────────
// Goal-change regeneration (preserves chapter, rewrites phases)
// ─────────────────────────────────────────────────────────────────────

/**
 * Regenerate the CURRENT chapter's phases when the student changes their
 * goal mid-chapter. The student's demonstrated CEFR (chapterIndex /
 * chapterLevel) is preserved — only the phases themselves are rewritten
 * to reflect the new goal.
 *
 * Premium → AI with goal-change context (knows what they had, what
 *           changed, and not to repeat the same titles verbatim).
 * Free    → deterministic template at the same CEFR level, lightly
 *           goal-flavored.
 * AI failure → silent template fallback (G7).
 *
 * @param {Object} plan
 * @param {Object} opts
 * @param {Object} opts.oldGoal       The previous plan.goal snapshot.
 * @param {Array}  opts.previousPhases  Snapshot of plan.phases BEFORE the regen.
 * @returns {Promise<Array>} 4 phase objects (no lessonsCompleted/scores yet)
 */
async function regenerateChapterForGoalChange(plan, opts = {}) {
  const goal = plan.goal || {};
  const level = plan.chapterLevel || 'A1';

  // Decide path same way as generateNextChapter.
  let usePremiumAi = false;
  try {
    const User = require('../models/User');
    const student = await User.findById(plan.studentId).lean();
    usePremiumAi = entitlements.canUseAdaptivePlanAi(student);
  } catch (err) {
    console.warn('[ChapterGen/GoalChange] Could not determine entitlement, defaulting to template:', err.message);
    usePremiumAi = false;
  }

  if (usePremiumAi) {
    try {
      const phases = await _regenerateChapterForGoalChangeWithAi(plan, opts);
      console.log(`✨ [ChapterGen/GoalChange] AI regenerated ${phases.length} phases at ${level} for new goal`);
      return phases;
    } catch (err) {
      console.error('[ChapterGen/GoalChange] AI regen failed, using template fallback:', err.message);
      // Fall through to template (G7).
    }
  }

  const phases = generateChapterFromTemplate(level, goal);
  console.log(`📋 [ChapterGen/GoalChange] Template regenerated ${phases.length} phases at ${level}`);
  return phases;
}

/**
 * Internal: AI regen for goal change. Tells the model the previous
 * phase shape so it can deliberately produce different phases that are
 * still calibrated to the student's demonstrated CEFR level.
 */
async function _regenerateChapterForGoalChangeWithAi(plan, opts) {
  const goal = plan.goal || {};
  const oldGoal = opts.oldGoal || {};
  const previousPhases = Array.isArray(opts.previousPhases) ? opts.previousPhases : [];
  const language = plan.language;
  const level = plan.chapterLevel || 'A1';

  const prevList = previousPhases
    .slice(0, 6)
    .map((p, i) => `  ${i + 1}. ${p.title || ''} — ${(p.description || '').slice(0, 80)}`)
    .join('\n') || '(none)';

  const goalLine = (g) => {
    const t = g?.type || 'conversational';
    const d = g?.description ? ` — ${g.description}` : '';
    return `${t}${d}`;
  };

  const pace = require('./paceService');
  const paceDescriptor = pace.describe(goal);

  const prompt = `The student has changed their language-learning goal. Rewrite the current chapter's phases to reflect the new goal — but DO NOT change their level (they have demonstrated proficiency at ${level} and we are preserving that).

LANGUAGE: ${language}
CURRENT CEFR LEVEL: ${level} (preserved)
PREVIOUS GOAL: ${goalLine(oldGoal)}
NEW GOAL: ${goalLine(goal)}
TARGET LEVEL: ${goal.targetLevel || 'not specified'}
TIMELINE: ${goal.timeline || 'no_rush'}
${pace.buildAiPromptLine(goal)}

PHASES THEY HAD BEFORE (do NOT repeat verbatim — vary topics + framing):
${prevList}

Design ${paceDescriptor.phaseCount} sequential phases for the ${level} chapter, calibrated to the new goal and pace:
1. Stay AT the ${level} level — do not pitch above or below
2. Reframe content for the NEW goal type (${goal.type || 'conversational'})
3. Genuinely different from the previous phases (different titles, different scenarios)
4. Progress: foundation → practice → application → consolidation
5. Each phase has ~${paceDescriptor.estimatedLessonsPerPhase} estimated lessons
6. Each phase has a CONCRETE exit criterion (e.g., "tell a 3-minute story", not "feel comfortable")

Return JSON:
{
  "phases": [
    {
      "title": "string (max 50 chars)",
      "description": "string (1-2 sentences)",
      "focusAreas": ["string", ...],
      "suggestedTopics": ["string — concrete conversation scenarios"],
      "exitCriteria": "string — concrete observable milestone",
      "estimatedLessons": 5
    }
  ]
}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert language teacher. The student is keeping their current level but pivoting their goal — rewrite their chapter accordingly. Always respond with valid JSON only. Be concrete and language-specific.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });

  const raw = JSON.parse(completion.choices[0].message.content || '{}');
  const phases = Array.isArray(raw.phases) ? raw.phases : [];
  const targetPhaseCount = Math.max(3, Math.min(5, paceDescriptor.phaseCount));
  if (phases.length < Math.max(3, targetPhaseCount - 1)) {
    throw new Error(`AI returned ${phases.length} phases, expected ~${targetPhaseCount}`);
  }

  return phases.slice(0, targetPhaseCount).map((p) => ({
    title: String(p.title || '').slice(0, 80),
    description: String(p.description || '').slice(0, 280),
    focusAreas: Array.isArray(p.focusAreas) ? p.focusAreas.slice(0, 6) : [],
    suggestedTopics: Array.isArray(p.suggestedTopics) ? p.suggestedTopics.slice(0, 6) : [],
    exitCriteria: String(p.exitCriteria || '').slice(0, 200),
    estimatedLessons: Number.isFinite(p.estimatedLessons) ? Math.max(3, Math.min(10, p.estimatedLessons)) : paceDescriptor.estimatedLessonsPerPhase
  }));
}

module.exports = {
  generateNextChapter,
  generateChapterFromTemplate,
  generateChapterWithAi,
  regenerateChapterForGoalChange,
  CHAPTER_TEMPLATES
};
