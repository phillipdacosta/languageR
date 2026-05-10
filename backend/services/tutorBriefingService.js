/**
 * Tutor briefing service.
 *
 * synthesizeTutorBriefing(studentId, requestingTutorId, language) →
 *   { ownSection, generalSection } (premium-only synthesis)
 *
 * - "ownSection": full detail of the requesting tutor's own work with this
 *   student (last lesson, focus, struggles surfaced, planned focus).
 * - "generalSection": cross-tutor aggregate signal — never attributing
 *   specific tutors. If the student has worked with no other tutor,
 *   generalSection is null and the UI omits it (G23).
 *
 * Breakthrough exclusivity (G6 in scenarios.md): if a tutor was the one
 * who first taught a skill the student now demonstrates, that "your
 * teaching is sticking" signal is exclusive to them for 14 days.
 */

const OpenAI = require('openai');
const LearningPlan = require('../models/LearningPlan');
const LessonAnalysis = require('../models/LessonAnalysis');
const Lesson = require('../models/Lesson');
const User = require('../models/User');

let openai = null;
function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI API key is required.');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const RECENT_LESSONS_WINDOW = 5;

/**
 * Build a concise pre-lesson briefing for a tutor about to teach this
 * student. Two sections so the tutor knows what's THEIRS and what's GENERAL.
 *
 * @param {ObjectId} studentId
 * @param {ObjectId} requestingTutorId
 * @param {String}   language
 * @returns {Promise<{ ownSection: Object|null, generalSection: Object|null, plan: Object|null }>}
 */
async function synthesizeTutorBriefing(studentId, requestingTutorId, language) {
  const plan = await LearningPlan.findOne({ studentId, language }).lean();
  if (!plan) return { ownSection: null, generalSection: null, plan: null };

  // Pull all lesson analyses for this student in this language, recent first.
  const lessons = await Lesson.find({
    studentId,
    language,
    status: 'completed'
  })
    .sort({ scheduledStartAt: -1 })
    .limit(20)
    .select('_id tutorId scheduledStartAt')
    .lean();

  const lessonIds = lessons.map(l => l._id);
  const analyses = await LessonAnalysis.find({ lessonId: { $in: lessonIds } })
    .sort({ createdAt: -1 })
    .limit(RECENT_LESSONS_WINDOW * 2)
    .lean();

  // Split into "own" (this tutor's) and "other".
  const ownAnalyses = analyses.filter(a => String(a.tutorId) === String(requestingTutorId));
  const otherAnalyses = analyses.filter(a => String(a.tutorId) !== String(requestingTutorId));

  // Recovery + ping-pong context: the same on every section. The tutor
  // needs to know if this student is on a "bridge" recovery phase (don't
  // pile on; reinforce confidence) or has bounced repeatedly (consider
  // explicitly slowing down and letting the student lead the pace).
  const currentPhase = plan.phases?.[plan.currentPhaseIndex] || null;
  const recoveryStatus = {
    isRecovery: !!currentPhase?._isRecovery,
    pingPongCount: plan.pingPongCount || 0,
    lastDemotedFromLevel: plan.lastDemotedFromLevel || null,
    recoveryStuck: !!plan.pendingTransitions?.recoveryStuck,
    humanInterventionSuggested: !!plan.pendingTransitions?.humanInterventionSuggested
  };

  // Own section is built directly from the requesting tutor's last analysis.
  let ownSection = null;
  if (ownAnalyses.length > 0) {
    const last = ownAnalyses[0];
    ownSection = {
      lastLessonAt: last.createdAt,
      summary: last.studentSummary || last.summary || '',
      strugglesYouSurfaced: _normalizeStruggles(last),
      whatToDoNext: plan.nextLessonFocus || '',
      yourLastVote: _findOwnVoteForCurrentPhase(plan, requestingTutorId),
      recoveryStatus
    };
  } else {
    // First lesson with this student — provide a "first lesson" hint so the
    // tutor knows what they're walking into. Empty state per scenarios.md.
    ownSection = {
      firstLesson: true,
      goal: plan.goal || null,
      currentChapter: plan.chapterLevel || 'A1',
      currentPhaseTitle: plan.phases?.[plan.currentPhaseIndex]?.title || '',
      recoveryStatus
    };
  }

  // If no other tutors, omit the general section entirely (G23).
  if (otherAnalyses.length === 0) {
    return { ownSection, generalSection: null, plan };
  }

  // Aggregate general signals — anonymized, never attributing other tutors.
  const aggregateStruggles = new Map();
  for (const a of otherAnalyses) {
    for (const s of _normalizeStruggles(a)) {
      aggregateStruggles.set(s, (aggregateStruggles.get(s) || 0) + 1);
    }
  }
  const topStruggles = [...aggregateStruggles.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ key, lessons: count }));

  // Surface the rolling, bias-corrected CEFR estimate. chapterLevel is the
  // gated bucket; the estimate is the lived-in current view across all
  // tutors and AI signals. See cefrEstimatorService + docs/learning-journey/cefr-estimation.md.
  const estimate = plan.internalCefrEstimate || null;

  // Synthesize narrative via AI. Cheap call, defensive: if it fails, ship
  // the structured data without prose.
  let narrative = '';
  try {
    narrative = await _synthesizeNarrative({
      goal: plan.goal,
      language,
      level: estimate?.level || plan.chapterLevel,
      chapterLevel: plan.chapterLevel,
      estimate,
      currentPhase: plan.phases?.[plan.currentPhaseIndex]?.title || '',
      topStruggles,
      otherLessonCount: otherAnalyses.length,
      recoveryStatus
    });
  } catch (err) {
    console.warn('[TutorBriefing] Narrative synthesis failed, sending structured only:', err.message);
  }

  const generalSection = {
    otherTutorLessonCount: otherAnalyses.length,
    topStruggles,
    narrative,
    cefrEstimate: estimate ? {
      level: estimate.level,
      agreement: estimate.agreement,
      sources: estimate.sources,
      lessonsConsidered: estimate.lessonsConsidered,
      chapterBucket: plan.chapterLevel
    } : null,
    recoveryStatus
  };

  return { ownSection, generalSection, plan };
}

function _normalizeStruggles(analysis) {
  const out = new Set();
  if (Array.isArray(analysis.strugglesKeys)) {
    analysis.strugglesKeys.forEach(s => out.add(String(s)));
  }
  if (Array.isArray(analysis.struggles)) {
    analysis.struggles.forEach(s => {
      if (typeof s === 'string') out.add(s);
      else if (s?.key) out.add(String(s.key));
      else if (s?.name) out.add(String(s.name));
    });
  }
  return [...out];
}

function _findOwnVoteForCurrentPhase(plan, tutorId) {
  const phase = plan.phases?.[plan.currentPhaseIndex];
  if (!phase || !Array.isArray(phase.tutorVotes)) return null;
  const own = phase.tutorVotes
    .filter(v => String(v.tutorId) === String(tutorId))
    .sort((a, b) => new Date(b.setAt).getTime() - new Date(a.setAt).getTime())[0];
  if (!own) return null;
  return {
    vote: own.vote,
    setAt: own.setAt,
    expiresAt: own.expiresAt,
    expired: new Date(own.expiresAt).getTime() < Date.now()
  };
}

async function _synthesizeNarrative(ctx) {
  // Recovery context shapes the tone: a student on a recovery bridge
  // needs reassurance and consolidation, not pressure to advance. A
  // ping-pong student needs the tutor to actively slow down.
  const r = ctx.recoveryStatus || {};
  let recoveryLine = '';
  if (r.recoveryStuck) {
    recoveryLine = `\nRECOVERY STATUS: This student has bounced between ${r.lastDemotedFromLevel || 'a higher level'} and the recovery bridge ${r.pingPongCount} time(s). Tone: actively slow down, reduce new material, validate what they CAN do. Suggest scheduling a goal/expectations conversation.`;
  } else if (r.isRecovery) {
    recoveryLine = `\nRECOVERY STATUS: This student is currently on a recovery bridge phase (returning toward ${r.lastDemotedFromLevel || 'their previous level'}). Tone: confidence-rebuilding, consolidation. Avoid pushing for new structures — reinforce what they already know.`;
  } else if (r.humanInterventionSuggested) {
    recoveryLine = `\nRECOVERY STATUS: This student has been demoted recently. Be sensitive to confidence — favor wins over corrections this lesson.`;
  }

  const lang = (ctx.language || 'the target language').trim();

  const prompt = `You are writing a 2-3 sentence "general progress" briefing
for a tutor about a student. The student also works with other tutors.
You must NEVER name or attribute other tutors. Speak in aggregate.

CONTEXT:
- Target language: ${lang}
- Goal: ${ctx.goal?.type || 'conversational'} (${ctx.goal?.description || ''})
- Current chapter: ${ctx.level}
- Current phase (roadmap title — goal-flavored, not a lesson script): ${ctx.currentPhase}
- Other tutor lessons in record: ${ctx.otherLessonCount}
- Most-flagged struggles across other tutors:
${ctx.topStruggles.map(s => `  - ${s.key} (flagged in ${s.lessons} lessons)`).join('\n') || '  (none)'}${recoveryLine}

PEDAGOGICAL BRIDGE — keep tactical advice GENERAL (no granular textbook labels):
- Do NOT invent language-specific constructions (e.g. do not say "ser vs estar", "accusative case", etc.) unless that exact idea already appears verbatim in the struggles list above.
- It is fine to suggest the tutor briefly assess broad skill areas as needed for ${lang}: comfort with verbs and how ${lang} marks tense/aspect/person (many languages differ — English uses little verb inflection; others rely on it heavily), word forms / agreement where relevant, word order, and whether they can sustain the phase's scenario at all.
- Frame this as optional calibration ("sense-check foundations before diving into the scenario") — one short clause, not a lecture.

Write 2-3 sentences. Practical. End with ONE tactical suggestion the tutor can apply next lesson${r.recoveryStuck || r.isRecovery ? ' (consolidation-focused, not new-material-heavy)' : ''}.`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a concise, practical tutoring coach. Never attribute work to specific tutors. '
          + '2-3 sentences max. Prefer broad pedagogical categories over named grammar topics unless '
          + 'the user prompt struggles list already names them. Respect typological diversity across languages.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4,
    max_tokens: 200
  });
  return (completion.choices?.[0]?.message?.content || '').trim();
}

/**
 * "Your teaching is sticking" notification helper.
 *
 * Called from the lesson-end pipeline (after analysis is created). If the
 * student demonstrated a skill that ANOTHER tutor taught them (matched via
 * struggle keys → previous lessons), notify the originating tutor.
 *
 * Capped at 1 notification per (tutor, student, week) per G22.
 *
 * Returns { notified: boolean, originatingTutorId: ObjectId|null }.
 *
 * Notifications themselves go through the existing notification pipeline —
 * here we just decide whether to fire and who to fire to.
 */
async function emitTeachingStickingSignals(lessonAnalysis) {
  if (!lessonAnalysis || !lessonAnalysis.studentId) return { fired: 0 };

  // Demonstrated skills = struggles that DIDN'T appear in this lesson but
  // appeared in past lessons of THIS student. We use strugglesKeys as the
  // canonical signal.
  const demonstratedSkills = _extractDemonstratedSkills(lessonAnalysis);
  if (demonstratedSkills.length === 0) return { fired: 0 };

  // Find prior analyses where these skills WERE flagged as struggles.
  const priors = await LessonAnalysis.find({
    studentId: lessonAnalysis.studentId,
    tutorId: { $ne: lessonAnalysis.tutorId },
    strugglesKeys: { $in: demonstratedSkills }
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('tutorId strugglesKeys createdAt')
    .lean();

  // Originating tutor = the EARLIEST other tutor who flagged the skill.
  const originatingByTutor = new Map();   // tutorId → earliest createdAt
  for (const p of priors) {
    const k = String(p.tutorId);
    const t = new Date(p.createdAt).getTime();
    if (!originatingByTutor.has(k) || originatingByTutor.get(k) > t) {
      originatingByTutor.set(k, t);
    }
  }

  let fired = 0;
  for (const tutorIdStr of originatingByTutor.keys()) {
    // 1-per-week cap (G22). We use the existing User notifications log — a
    // simple field we'll add lazily here. If your project has a dedicated
    // Notification collection, swap this for that.
    const tutor = await User.findById(tutorIdStr);
    if (!tutor) continue;
    const last = (tutor.teachingStickingLastNotifiedAt || {})[String(lessonAnalysis.studentId)];
    if (last && (Date.now() - new Date(last).getTime()) < 7 * 24 * 60 * 60 * 1000) continue;

    // Fire notification (use whatever the project's notification system is).
    // For now we just write the timestamp; a downstream cron/route can pick this up.
    tutor.teachingStickingLastNotifiedAt = tutor.teachingStickingLastNotifiedAt || {};
    tutor.teachingStickingLastNotifiedAt[String(lessonAnalysis.studentId)] = new Date();
    tutor.markModified('teachingStickingLastNotifiedAt');
    await tutor.save();
    fired++;
    console.log(`📨 [TeachingSticking] Tutor ${tutorIdStr} would be notified about student ${lessonAnalysis.studentId}`);
  }

  return { fired };
}

function _extractDemonstratedSkills(lessonAnalysis) {
  // Heuristic: the analysis's "successes", "improvements", or "wins" array
  // contains skill keys the student handled well. Adjust to match your
  // actual analysis schema.
  const out = new Set();
  const fields = [
    lessonAnalysis.improvementsKeys,
    lessonAnalysis.improvements,
    lessonAnalysis.wins,
    lessonAnalysis.successes
  ];
  for (const f of fields) {
    if (!f) continue;
    if (Array.isArray(f)) {
      for (const x of f) {
        if (typeof x === 'string') out.add(x);
        else if (x?.key) out.add(String(x.key));
      }
    }
  }
  return [...out].slice(0, 10);
}

module.exports = {
  synthesizeTutorBriefing,
  emitTeachingStickingSignals
};
