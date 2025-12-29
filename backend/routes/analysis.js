const express = require('express');
const router = express.Router();
const LessonAnalysis = require('../models/LessonAnalysis');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

/**
 * @route   GET /api/analysis/student/:studentId/history
 * @desc    Get all analysis history for a student (progression tracking)
 * @access  Private (Student or their tutor)
 */
router.get('/student/:studentId/history', verifyToken, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { limit = 10, tutorId } = req.query;
    
    console.log(`📊 Fetching analysis history for student: ${studentId}`);
    
    // Build query
    const query = {
      studentId,
      status: 'completed'
    };
    
    // Optionally filter by tutor
    if (tutorId) {
      query.tutorId = tutorId;
    }
    
    // Get all completed analyses in chronological order
    const analyses = await LessonAnalysis.find(query)
      .sort({ lessonDate: 1 }) // Oldest first for progression view
      .limit(parseInt(limit))
      .populate('lessonId', 'subject startTime duration');
    
    console.log(`✅ Found ${analyses.length} completed analyses`);
    
    // Calculate progression summary
    const progressionSummary = calculateProgressionSummary(analyses);
    
    res.json({
      success: true,
      count: analyses.length,
      progression: progressionSummary,
      analyses: analyses.map(a => ({
        id: a._id,
        lessonId: a.lessonId,
        lessonDate: a.lessonDate,
        proficiencyLevel: a.overallAssessment.proficiencyLevel,
        summary: a.overallAssessment.summary,
        progressionMetrics: a.progressionMetrics,
        grammarAccuracy: a.grammarAnalysis?.accuracyScore,
        fluencyScore: a.fluencyAnalysis?.overallFluencyScore,
        vocabularyCount: a.vocabularyAnalysis?.uniqueWordCount,
        topicsDiscussed: a.topicsDiscussed,
        keyImprovements: a.progressionMetrics?.keyImprovements || [],
        persistentChallenges: a.progressionMetrics?.persistentChallenges || []
      }))
    });
    
  } catch (error) {
    console.error('❌ Error fetching analysis history:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/analysis/my-progress
 * @desc    Get logged-in student's own progress
 * @access  Private (Student only)
 */
router.get('/my-progress', verifyToken, async (req, res) => {
  try {
    const { tutorId, limit = 10 } = req.query;
    
    // Get student ID from authenticated user
    const User = require('../models/User');
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    console.log(`📊 Student ${user.email} requesting their progress`);
    
    const query = {
      studentId: user._id,
      status: 'completed'
    };
    
    if (tutorId) {
      query.tutorId = tutorId;
    }
    
    const analyses = await LessonAnalysis.find(query)
      .sort({ lessonDate: 1 })
      .limit(parseInt(limit))
      .populate('lessonId', 'subject startTime duration')
      .populate('tutorId', 'firstName lastName name picture');
    
    const progressionSummary = calculateProgressionSummary(analyses);
    
    res.json({
      success: true,
      count: analyses.length,
      progression: progressionSummary,
      analyses: analyses.map(a => ({
        id: a._id,
        lessonId: a.lessonId,
        tutorInfo: a.tutorId,
        lessonDate: a.lessonDate,
        proficiencyLevel: a.overallAssessment.proficiencyLevel,
        summary: a.overallAssessment.summary,
        progressionMetrics: a.progressionMetrics,
        strengths: a.strengths,
        areasForImprovement: a.areasForImprovement,
        grammarAccuracy: a.grammarAnalysis?.accuracyScore,
        fluencyScore: a.fluencyAnalysis?.overallFluencyScore,
        vocabularyCount: a.vocabularyAnalysis?.uniqueWordCount,
        recommendedFocus: a.recommendedFocus,
        homeworkSuggestions: a.homeworkSuggestions
      }))
    });
    
  } catch (error) {
    console.error('❌ Error fetching student progress:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
});

/**
 * Calculate progression summary metrics
 */
function calculateProgressionSummary(analyses) {
  if (analyses.length === 0) {
    return {
      totalLessons: 0,
      overallTrend: 'no_data'
    };
  }
  
  const first = analyses[0];
  const latest = analyses[analyses.length - 1];
  
  // Map proficiency levels to numeric values
  const levelMap = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
  
  const startLevel = levelMap[first.overallAssessment.proficiencyLevel] || 0;
  const currentLevel = levelMap[latest.overallAssessment.proficiencyLevel] || 0;
  
  // Calculate trends
  const errorRates = analyses
    .filter(a => a.progressionMetrics?.errorRate)
    .map(a => a.progressionMetrics.errorRate);
  
  const fluencyScores = analyses
    .filter(a => a.fluencyAnalysis?.overallFluencyScore)
    .map(a => a.fluencyAnalysis.overallFluencyScore);
  
  const vocabularyCounts = analyses
    .filter(a => a.vocabularyAnalysis?.uniqueWordCount)
    .map(a => a.vocabularyAnalysis.uniqueWordCount);
  
  return {
    totalLessons: analyses.length,
    startingLevel: first.overallAssessment.proficiencyLevel,
    currentLevel: latest.overallAssessment.proficiencyLevel,
    overallTrend: currentLevel > startLevel ? 'improving' : 
                  currentLevel < startLevel ? 'declining' : 'stable',
    levelProgress: currentLevel - startLevel,
    errorRateTrend: errorRates.length >= 2 ? 
      (errorRates[errorRates.length - 1] < errorRates[0] ? 'improving' : 'stable') : 'insufficient_data',
    fluencyTrend: fluencyScores.length >= 2 ?
      (fluencyScores[fluencyScores.length - 1] > fluencyScores[0] ? 'improving' : 'stable') : 'insufficient_data',
    vocabularyGrowth: vocabularyCounts.length >= 2 ?
      vocabularyCounts[vocabularyCounts.length - 1] - vocabularyCounts[0] : 0,
    averageErrorRate: errorRates.length > 0 ?
      (errorRates.reduce((a, b) => a + b, 0) / errorRates.length).toFixed(2) : null,
    averageFluencyScore: fluencyScores.length > 0 ?
      Math.round(fluencyScores.reduce((a, b) => a + b, 0) / fluencyScores.length) : null,
    latestVocabularyCount: vocabularyCounts.length > 0 ?
      vocabularyCounts[vocabularyCounts.length - 1] : null
  };
}

module.exports = router;



