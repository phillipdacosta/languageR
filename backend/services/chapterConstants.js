/**
 * Chapter constants — single source of truth for the CEFR-to-background
 * mapping and self-assessed-level → starting-chapter inference.
 *
 * Six chapters: A1, A2, B1, B2, C1, C2. Each has 4 phases.
 * After C2 graduation, plan enters mastery_mode (G5).
 */

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const CHAPTER_THEMES = {
  A1: 'a1-desert',
  A2: 'a2-coast',
  B1: 'b1-lake',
  B2: 'b2-snow',
  C1: 'c1-cherry',
  C2: 'c2-tuscany'
};

const CHAPTER_DISPLAY_NAMES = {
  A1: 'Desert Oasis',
  A2: 'Coastal Cliffs',
  B1: 'Mountain Lake',
  B2: 'Snowy Peaks',
  C1: 'Cherry Blossoms',
  C2: 'Rolling Hills'
};

// Map onboarding self-assessed level → starting chapter index.
// Calibration window in the first 3-5 lessons can adjust this up/down.
const SELF_ASSESSED_TO_CHAPTER_INDEX = {
  complete_beginner: 0,       // A1
  some_basics: 0,             // A1
  simple_conversations: 1,    // A2
  intermediate: 2,            // B1
  advanced: 4                 // C1 — give them headroom; calibration can demote
};

function levelForChapterIndex(idx) {
  return CEFR_LEVELS[Math.max(0, Math.min(5, idx))];
}

function themeForChapterIndex(idx) {
  return CHAPTER_THEMES[levelForChapterIndex(idx)];
}

function displayNameForChapterIndex(idx) {
  return CHAPTER_DISPLAY_NAMES[levelForChapterIndex(idx)];
}

function chapterIndexForSelfAssessedLevel(level) {
  return SELF_ASSESSED_TO_CHAPTER_INDEX[level] ?? 0;
}

module.exports = {
  CEFR_LEVELS,
  CHAPTER_THEMES,
  CHAPTER_DISPLAY_NAMES,
  SELF_ASSESSED_TO_CHAPTER_INDEX,
  levelForChapterIndex,
  themeForChapterIndex,
  displayNameForChapterIndex,
  chapterIndexForSelfAssessedLevel,
  TOTAL_CHAPTERS: CEFR_LEVELS.length,
  PHASES_PER_CHAPTER: 4
};
