/**
 * Per-tutor focus lane resolver + helpers.
 *
 * When a student works with multiple tutors, each tutor sets their own
 * `tutorFocusByTutorId` entry on the LearningPlan. To stay non-noisy
 * for the common case of one tutor, we resolve a single
 * "current focus" at read-time:
 *
 *   1. If the student has an upcoming lesson, prefer the focus set by
 *      that lesson's tutor (so the home widget always matches the
 *      next tutor they'll see).
 *   2. Otherwise, fall back to the most recently set tutor focus.
 *   3. Otherwise, fall back to plan.nextLessonFocus (AI/rule-based).
 */

const Lesson = require('../models/Lesson');
const User = require('../models/User');

/**
 * Find the next upcoming non-cancelled lesson for a student in a given language.
 * Returns the lesson POJO or null.
 */
async function getNextUpcomingLesson(studentId, language) {
  if (!studentId || !language) return null;
  try {
    return await Lesson.findOne({
      studentId,
      subject: language,
      status: { $in: ['scheduled', 'confirmed'] },
      startTime: { $gt: new Date() }
    })
      .sort({ startTime: 1 })
      .populate('tutorId', 'firstName lastName name picture')
      .lean();
  } catch (e) {
    return null;
  }
}

/**
 * Resolve the focus that should be surfaced on the home widget right now.
 * Returns: { focus: string, source: 'upcoming-tutor'|'recent-lane'|'plan'|'none', tutor?: { id, name, picture } }
 */
async function resolveNextFocus(plan) {
  if (!plan) return { focus: '', source: 'none' };

  const lanes = Array.isArray(plan.tutorFocusByTutorId) ? plan.tutorFocusByTutorId : [];
  const lanesByTutor = new Map(lanes.map(e => [String(e.tutorId), e]));

  const next = await getNextUpcomingLesson(plan.studentId, plan.language);
  if (next?.tutorId) {
    const t = next.tutorId;
    const tid = String(t._id || t);
    const lane = lanesByTutor.get(tid);
    if (lane?.focus) {
      return {
        focus: lane.focus,
        source: 'upcoming-tutor',
        tutor: {
          id: tid,
          name: t.firstName || t.name || '',
          picture: t.picture || ''
        }
      };
    }
  }

  // Most recent lane wins among remaining options.
  if (lanes.length) {
    const recent = lanes
      .filter(e => e.focus)
      .slice()
      .sort((a, b) => new Date(b.setAt) - new Date(a.setAt))[0];
    if (recent) {
      return {
        focus: recent.focus,
        source: 'recent-lane',
        tutor: { id: String(recent.tutorId), name: recent.tutorName || '' }
      };
    }
  }

  if (plan.nextLessonFocus) {
    return { focus: plan.nextLessonFocus, source: 'plan' };
  }
  return { focus: '', source: 'none' };
}

/**
 * Build the student's "Coming Up" feed for the journey page.
 * Returns up to `limit` upcoming lessons enriched with per-tutor focus
 * if that tutor has one set in their lane.
 */
async function getComingUp(studentId, language, { limit = 5 } = {}) {
  if (!studentId || !language) return [];

  let lessons = [];
  try {
    lessons = await Lesson.find({
      studentId,
      subject: language,
      status: { $in: ['scheduled', 'confirmed'] },
      startTime: { $gt: new Date() }
    })
      .sort({ startTime: 1 })
      .limit(limit)
      .populate('tutorId', 'firstName lastName name picture')
      .lean();
  } catch (e) {
    return [];
  }
  return lessons;
}

/**
 * Recent notes by tutors *other than* the requesting tutor for this student.
 * Used in the pre-lesson briefing so each tutor sees what the others
 * have been working on. First-name only — keep the social weight low.
 */
function getOtherTutorNotes(plan, requestingTutorId, { limit = 3 } = {}) {
  if (!plan) return [];
  const lanes = Array.isArray(plan.tutorFocusByTutorId) ? plan.tutorFocusByTutorId : [];
  const tid = requestingTutorId ? String(requestingTutorId) : '';
  return lanes
    .filter(e => String(e.tutorId) !== tid && (e.note || e.focus))
    .slice()
    .sort((a, b) => new Date(b.setAt) - new Date(a.setAt))
    .slice(0, limit)
    .map(e => ({
      tutorFirstName: (e.tutorName || '').split(' ')[0] || 'Tutor',
      text: e.note || e.focus || '',
      setAt: e.setAt
    }));
}

module.exports = {
  resolveNextFocus,
  getComingUp,
  getOtherTutorNotes
};
