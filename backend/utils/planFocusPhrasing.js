/**
 * Plan focus lines are suggestions for tutors — never commitments to students.
 * Use in AI prompts and post-process stored focus text.
 */

const PLAN_FOCUS_PHRASING_PROMPT_BLOCK = `PLAN FOCUS PHRASING (REQUIRED):
- nextLessonFocus is a SUGGESTION for the tutor, not a promise to the student.
- NEVER use "We will", "You will", "This lesson will", or any wording that guarantees what will happen.
- Use recommendatory phrasing: "Consider…", "Practice…", "Explore…", "Review…", "Try…", or activity verbs like "Drill", "Roleplay" as ideas the tutor may adapt.
- Do not write as a fixed agenda — the tutor decides what actually happens in the lesson.`;

const DEFINITIVE_PATTERNS = [
  [/^we will focus on /i, 'Suggested focus: '],
  [/^we'll focus on /i, 'Suggested focus: '],
  [/^we will /i, 'Suggested: '],
  [/^we'll /i, 'Suggested: '],
  [/^this lesson will focus on /i, 'Suggested focus: '],
  [/^this lesson will /i, 'Suggested: '],
  [/^the lesson will focus on /i, 'Suggested focus: '],
  [/^the lesson will /i, 'Suggested: '],
  [/^you will learn /i, 'Consider learning '],
  [/^you will practice /i, 'Consider practicing '],
  [/^you will work on /i, 'Consider working on '],
  [/^you will /i, 'Consider '],
  [/^you'll learn /i, 'Consider learning '],
  [/^you'll practice /i, 'Consider practicing '],
  [/^you'll work on /i, 'Consider working on '],
  [/^you'll /i, 'Consider '],
];

function normalizePlanFocusText(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '';

  for (const [pattern, replacement] of DEFINITIVE_PATTERNS) {
    if (pattern.test(t)) {
      t = t.replace(pattern, replacement);
      break;
    }
  }

  return t;
}

function isDefinitivePlanFocus(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  return /^(we will|we'll|this lesson will|the lesson will|you will|you'll)\b/i.test(t);
}

module.exports = {
  PLAN_FOCUS_PHRASING_PROMPT_BLOCK,
  normalizePlanFocusText,
  isDefinitivePlanFocus,
};
