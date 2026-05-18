/**
 * Post-lesson material recommendation service.
 *
 * For *free* students, after a lesson analysis completes we surface
 * struggle-matched materials (quizzes / readings / listenings / bundles)
 * directly on their Learning Plan. This is the engagement loop they get
 * in lieu of the per-lesson AI plan refresh that premium students get.
 *
 * Call site: backend/services/learningPlanService.js (post-lesson branch).
 *
 * The scoring is intentionally close to the existing
 * GET /api/materials/recommended/:language endpoint so the two surfaces
 * stay consistent.
 */

const TutorMaterial = require('../models/TutorMaterial');
const ContentTag = require('../models/ContentTag');
const MaterialProgress = require('../models/MaterialProgress');
const LessonAnalysis = require('../models/LessonAnalysis');

function cefrToMaterialLevel(cefr) {
  if (['A1', 'A2'].includes(cefr)) return 'beginner';
  if (['B1', 'B2'].includes(cefr)) return 'intermediate';
  return 'advanced';
}

function buildStruggleWeights(currentAnalysis, recentAnalyses) {
  const weights = new Map();
  const add = (kw, w) => {
    const k = (kw || '').toString().toLowerCase().trim();
    if (!k) return;
    weights.set(k, Math.max(weights.get(k) || 0, w));
  };

  if (currentAnalysis) {
    (currentAnalysis.topErrors || []).forEach(e => add(e.issue, 4));
    (currentAnalysis.errorPatterns || []).forEach(p => add(p.pattern, 4));
    (currentAnalysis.progressionMetrics?.persistentChallenges || []).forEach(c => add(c, 4));
    (currentAnalysis.recommendedFocus || []).forEach(f => add(f, 4));
    (currentAnalysis.areasForImprovement || []).forEach(a => add(a, 3));
  }

  recentAnalyses.forEach((a, i) => {
    const w = i === 0 ? 3 : i === 1 ? 2 : 1;
    (a.topErrors || []).forEach(e => add(e.issue, w));
    (a.errorPatterns || []).forEach(p => add(p.pattern, w));
    (a.progressionMetrics?.persistentChallenges || []).forEach(c => add(c, w));
  });

  return weights;
}

async function loadTagLabels() {
  const tags = await ContentTag.find({ active: true }).lean();
  const map = {};
  tags.forEach(tag => {
    const labels = [];
    if (tag.labels) {
      const labelObj = tag.labels instanceof Map ? Object.fromEntries(tag.labels) : tag.labels;
      Object.values(labelObj).forEach(l => l && labels.push(String(l).toLowerCase()));
    }
    map[tag.tagId] = labels;
  });
  return map;
}

function scoreMaterial(material, struggleWeights, tagLabelMap, currentTutorId) {
  const topics = (material.topics || []).map(t => t.toLowerCase());
  const sTags = (material.structuredTags || []).map(t => t.toLowerCase());
  const tagLabels = sTags.flatMap(tagId => tagLabelMap[tagId] || [tagId]);
  const searchable = [...topics, ...tagLabels];

  let score = 0;
  const matched = new Set();

  struggleWeights.forEach((weight, keyword) => {
    const sWords = keyword.split(/\s+/);
    searchable.forEach(t => {
      const tWords = t.split(/\s+/);
      const overlap = sWords.some(sw => tWords.some(tw => tw.includes(sw) || sw.includes(tw)));
      if (overlap) {
        const basePoints = sTags.length > 0 ? 15 : 10;
        score += basePoints * weight;
        matched.add(keyword);
      }
    });
  });

  if (currentTutorId && material.tutorId?.toString() === currentTutorId.toString()) {
    score += 20;
  }

  return { score, matched: [...matched] };
}

/**
 * Compute and return the top struggle-matched materials for a student.
 * Pure function — does NOT persist; the caller decides what to do with the result.
 *
 * @param {Object} opts
 * @param {String|ObjectId} opts.studentId
 * @param {String} opts.language
 * @param {Object} [opts.lessonAnalysis] — current lesson's analysis (already fetched)
 * @param {String|ObjectId} [opts.currentTutorId]
 * @param {Number} [opts.limit] — default 5
 * @returns {Promise<Array<{materialId, matchedStruggles, score, material}>>}
 */
async function computeRecommendations({ studentId, language, lessonAnalysis = null, currentTutorId = null, limit = 5 }) {
  if (!studentId || !language) return [];

  const latestAnalysisForLevel = lessonAnalysis || await LessonAnalysis.findOne({
    studentId: studentId.toString(),
    language,
    status: 'completed'
  }).sort({ lessonDate: -1 }).lean();

  const studentCefr = latestAnalysisForLevel?.overallAssessment?.proficiencyLevel || 'A1';
  const studentLevel = cefrToMaterialLevel(studentCefr);

  const recentAnalyses = await LessonAnalysis.find({
    studentId: studentId.toString(),
    language,
    status: 'completed',
    ...(lessonAnalysis?._id ? { _id: { $ne: lessonAnalysis._id } } : {})
  })
    .sort({ lessonDate: -1 })
    .limit(5)
    .select('topErrors errorPatterns progressionMetrics')
    .lean();

  const struggleWeights = buildStruggleWeights(lessonAnalysis, recentAnalyses);
  if (struggleWeights.size === 0) return [];

  const completed = await MaterialProgress.find({
    studentId,
    completed: true
  }).select('materialId').lean();
  const completedIds = completed.map(c => c.materialId);

  const candidates = await TutorMaterial.find({
    language: { $regex: new RegExp(`^${language}$`, 'i') },
    level: { $in: [studentLevel, 'any'] },
    status: 'published',
    _id: { $nin: completedIds },
    tutorId: { $ne: studentId }
  })
    .sort({ 'stats.averageScore': -1 })
    .limit(40)
    .lean();

  if (candidates.length === 0) return [];

  const tagLabelMap = await loadTagLabels();

  const scored = candidates
    .map(m => {
      const { score, matched } = scoreMaterial(m, struggleWeights, tagLabelMap, currentTutorId);
      return { material: m, score, matched };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(s => ({
    materialId: s.material._id,
    matchedStruggles: s.matched,
    score: s.score,
    material: s.material
  }));
}

module.exports = {
  computeRecommendations,
  cefrToMaterialLevel
};
