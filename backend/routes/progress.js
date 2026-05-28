const express = require('express');
const router = express.Router();
const LessonAnalysis = require('../models/LessonAnalysis');
const LearningPlan = require('../models/LearningPlan');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const struggleAggregator = require('../services/struggleAggregator');

// Hand-curated descriptions for the most common struggle categories.
// Used to enrich the aggregator's output when the taxonomy doesn't
// carry a description field. Looked up by either raw issue string
// (legacy) or by displayName from the taxonomy (new).
const ERROR_DESCRIPTIONS = {
  // Spanish-specific
  'present subjunctive': 'Using special verb forms to express wishes, doubts, or hypothetical situations',
  'subjunctive mood': 'Using special verb forms to express wishes, doubts, or hypothetical situations',
  'subjunctive with emotion verbs': 'Using the subjunctive after verbs that express feelings or desires',
  'ser vs estar': 'Choosing between the two Spanish verbs for "to be"',
  'por vs para': 'Choosing the right preposition for purpose, duration, or destination',
  'preterite vs imperfect': 'Choosing the correct past tense for what happened vs what was happening',
  'gender agreement': 'Making adjectives and articles match the noun\'s gender',
  'number agreement': 'Making words plural to match the noun',
  'conditional sentences': 'Expressing "if-then" situations correctly',
  // English-specific
  'past simple vs present perfect': 'Choosing between completed past actions and connected-to-present actions',
  'articles (a, an, the)': 'Knowing when (and which) article to use',
  'phrasal verbs': 'Verb + preposition combinations like "pick up" or "put off"',
  // Universal
  'filler words': 'Reducing "um", "uh" and similar fillers',
  'hesitation and pauses': 'Smoother delivery without long thinking pauses'
};

/**
 * @route   GET /api/progress/struggles/:language
 * @desc    Top recurring struggles for the student, ranked by the
 *          system's priority scorer over the last 5 lessons. Reads
 *          from the canonical struggleAggregator so the home widget,
 *          the next-lesson focus picker, and this surface always
 *          agree on the student's #1 struggle.
 * @access  Private
 */
router.get('/struggles/:language', verifyToken, async (req, res) => {
  try {
    const { language } = req.params;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Load the plan so the aggregator can read beliefs + goal context.
    // Plan may not exist for a brand-new student; aggregator handles
    // null plan gracefully.
    const plan = await LearningPlan.findOne({ studentId: user._id, language });

    const agg = await struggleAggregator.aggregateStruggles({
      studentId: user._id,
      language,
      plan,
      windowSize: struggleAggregator.DEFAULT_WINDOW,
      limit: 5
    });

    if (!agg.hasEnoughData || agg.struggles.length === 0) {
      return res.json({
        success: true,
        hasEnoughData: false,
        message: agg.lessonsAnalyzed === 0
          ? 'No completed lessons yet for this language'
          : `Need more data to identify patterns (${agg.lessonsAnalyzed} lesson${agg.lessonsAnalyzed === 1 ? '' : 's'} analyzed)`,
        lessonsCompleted: agg.lessonsAnalyzed,
        lessonsAnalyzed: agg.lessonsAnalyzed
      });
    }

    const descLookup = (title) => {
      if (typeof title !== 'string') return null;
      return ERROR_DESCRIPTIONS[title.toLowerCase().trim()] || null;
    };

    // Map aggregator output to the response shape the frontend already
    // consumes. The new `score` and `factors` are additive — clients
    // that don't read them will still work.
    const struggles = agg.struggles.map(s => ({
      // Skill identity (NEW)
      skillId: s.skillId,
      category: s.category,
      cefr: s.cefr,
      // Display
      issue: s.displayName,
      userFriendlyTitle: s.displayName,
      description: descLookup(s.displayName) || 'A recurring pattern in your recent lessons',
      // Examples
      examples: (s.examples || []).slice(0, 2).map(ex => ({
        original: ex.original,
        corrected: ex.corrected,
        explanation: ex.explanation
      })),
      // Frequency / impact (kept for legacy clients)
      appearances: s.appearances,
      lessonsAnalyzed: agg.lessonsAnalyzed,
      frequency: `${s.appearances}/${agg.lessonsAnalyzed}`,
      percentage: Math.round((s.appearances / agg.lessonsAnalyzed) * 100),
      impact: s.highestImpact,
      // Scoring (NEW)
      score: s.score,
      factors: s.factors,
      // Belief snapshot (NEW)
      belief: s.belief ? {
        mean: Number((s.belief.alpha / (s.belief.alpha + s.belief.beta)).toFixed(3)),
        alpha: s.belief.alpha,
        beta: s.belief.beta
      } : null,
      lastSeenAt: s.lastSeenAt,
      isSyntheticSkill: s.isSyntheticSkill
    }));

    res.json({
      success: true,
      hasEnoughData: true,
      language,
      lessonsAnalyzed: agg.lessonsAnalyzed,
      struggles,
      activeFocusSkillId: plan?.activeFocusSkillId || null,
      activeFocusSource: plan?.activeFocusSource || null,
      dateRange: {
        from: struggles.length > 0 ? struggles[struggles.length - 1]?.lastSeenAt : null,
        to: struggles.length > 0 ? struggles[0]?.lastSeenAt : null
      }
    });
  } catch (error) {
    console.error('❌ Error getting struggles:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get struggles',
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// LEGACY: original /struggles handler retained below for reference.
// Routing only invokes the version above. Keeping the helper for any
// downstream code that imported ERROR_DESCRIPTIONS-shaped data.
// ─────────────────────────────────────────────────────────────────

router.get('/_legacy_struggles/:language', verifyToken, async (req, res) => {
  try {
    const { language } = req.params;
    
    // Get user from token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Get last 5 completed lessons for this language (excluding trial & quick office hours)
    const allLessons = await LessonAnalysis.find({
      studentId: user._id,
      language: language,
      status: 'completed'
    })
      .populate({
        path: 'lessonId',
        select: 'isTrialLesson isOfficeHours officeHoursType'
      })
      .sort({ lessonDate: -1 })
      .select('topErrors errorPatterns progressionMetrics lessonDate tutorId lessonId')
      .lean();
    
    // Filter out trial lessons and quick office hours
    const recentLessons = allLessons
      .filter(lesson => {
        const lessonData = lesson.lessonId;
        if (!lessonData) return true; // Include if no lesson data (shouldn't happen)
        
        // Exclude trial lessons
        if (lessonData.isTrialLesson === true) return false;
        
        // Exclude quick office hours
        if (lessonData.isOfficeHours === true && lessonData.officeHoursType === 'quick') return false;
        
        return true;
      })
      .slice(0, 5); // Take only 5 after filtering
    
    console.log(`📊 [Struggles] Filtered to ${recentLessons.length} lessons from ${allLessons.length} total for ${language}`);

    
    if (recentLessons.length < 5) {
      return res.json({
        success: true,
        hasEnoughData: false,
        message: 'Need at least 5 lessons to identify patterns',
        lessonsCompleted: recentLessons.length
      });
    }
    
    // Helper function to get user-friendly description for error types
    const getErrorDescription = (issue) => {
      const descriptions = {
        'agreement errors': {
          title: 'Subject-Verb Agreement',
          description: 'Making sure verbs match their subjects'
        },
        'verb conjugation': {
          title: 'Verb Conjugation',
          description: 'Using the correct verb form for different tenses and subjects'
        },
        'verb conjugation errors': {
          title: 'Verb Conjugation',
          description: 'Using the correct verb form for different tenses and subjects'
        },
        'article usage': {
          title: 'Articles (a, an, the)',
          description: 'Knowing when to use articles'
        },
        'preposition errors': {
          title: 'Prepositions',
          description: 'Using the right prepositions'
        },
        'pronoun agreement': {
          title: 'Pronoun Agreement',
          description: 'Making sure pronouns match the nouns they replace'
        },
        'subjunctive mood': {
          title: 'Subjunctive Mood',
          description: 'Using special verb forms to express wishes, doubts, or hypothetical situations'
        },
        'tense consistency': {
          title: 'Tense Consistency',
          description: 'Keeping the same time frame throughout your sentences'
        },
        'word order': {
          title: 'Word Order',
          description: 'Putting words in the correct sequence in sentences'
        },
        'conditional sentences': {
          title: 'Conditional Sentences',
          description: 'Expressing "if-then" situations correctly'
        },
        'relative clauses': {
          title: 'Relative Clauses',
          description: 'Using relative pronouns to add information'
        },
        'passive voice': {
          title: 'Passive Voice',
          description: 'Forming sentences where the subject receives the action'
        },
        'modal verbs': {
          title: 'Modal Verbs',
          description: 'Using modal verbs correctly'
        },
        'plural forms': {
          title: 'Plural Forms',
          description: 'Making nouns plural correctly'
        },
        'possessive forms': {
          title: 'Possessive Forms',
          description: 'Showing ownership correctly'
        }
      };
      
      const normalized = issue.toLowerCase().trim();
      return descriptions[normalized] || {
        title: issue,
        description: 'A recurring pattern in your recent lessons'
      };
    };
    
    // Aggregate struggles across lessons
    const struggleMap = new Map();
    
    recentLessons.forEach(lesson => {
      // Process topErrors
      lesson.topErrors?.forEach(error => {
        const key = error.issue.toLowerCase().trim();
        const errorInfo = getErrorDescription(error.issue);
        
        if (!struggleMap.has(key)) {
          struggleMap.set(key, {
            issue: error.issue,
            userFriendlyTitle: errorInfo.title,
            description: errorInfo.description,
            example: errorInfo.example,
            appearances: 0,
            totalOccurrences: 0,
            highestImpact: error.impact || 'medium',
            lessonDates: [],
            examples: [] // Collect examples from errorPatterns if available
          });
        }
        const struggle = struggleMap.get(key);
        struggle.appearances += 1;
        struggle.totalOccurrences += error.occurrences || 1;
        struggle.lessonDates.push(lesson.lessonDate);
        
        // Keep highest impact level
        const impactLevels = { low: 1, medium: 2, high: 3 };
        if (impactLevels[error.impact] > impactLevels[struggle.highestImpact]) {
          struggle.highestImpact = error.impact;
        }
      });
      
      // Also check errorPatterns for examples
      lesson.errorPatterns?.forEach(pattern => {
        const key = pattern.pattern?.toLowerCase().trim();
        if (key && struggleMap.has(key)) {
          const struggle = struggleMap.get(key);
          // Add examples if available
          if (pattern.examples && pattern.examples.length > 0) {
            pattern.examples.forEach(ex => {
              if (ex.original && ex.corrected && !struggle.examples.find(e => 
                e.original === ex.original && e.corrected === ex.corrected
              )) {
                struggle.examples.push({
                  original: ex.original,
                  corrected: ex.corrected,
                  explanation: ex.explanation
                });
              }
            });
          }
        }
      });
      
      // Also check persistentChallenges
      lesson.progressionMetrics?.persistentChallenges?.forEach(challenge => {
        const key = challenge.toLowerCase().trim();
        const errorInfo = getErrorDescription(challenge);
        
        if (!struggleMap.has(key)) {
          struggleMap.set(key, {
            issue: challenge,
            userFriendlyTitle: errorInfo.title,
            description: errorInfo.description,
            example: errorInfo.example,
            appearances: 1,
            totalOccurrences: 1,
            highestImpact: 'medium',
            lessonDates: [lesson.lessonDate],
            examples: []
          });
        } else {
          const struggle = struggleMap.get(key);
          struggle.appearances += 1;
          struggle.totalOccurrences += 1;
          if (!struggle.lessonDates.includes(lesson.lessonDate)) {
            struggle.lessonDates.push(lesson.lessonDate);
          }
        }
      });
    });
    
    // Filter to only show struggles that appeared in 2+ lessons
    const recurringStruggles = Array.from(struggleMap.values())
      .filter(s => s.appearances >= 2)
      .sort((a, b) => {
        // Sort by frequency first, then by impact
        if (b.appearances !== a.appearances) {
          return b.appearances - a.appearances;
        }
        const impactLevels = { low: 1, medium: 2, high: 3 };
        return impactLevels[b.highestImpact] - impactLevels[a.highestImpact];
      })
      .slice(0, 5) // Top 5 struggles
      .map(s => ({
        issue: s.issue,
        userFriendlyTitle: s.userFriendlyTitle || s.issue,
        description: s.description || 'A recurring pattern in your recent lessons',
        examples: s.examples?.slice(0, 2) || [], // Include up to 2 examples
        frequency: `${s.appearances}/${recentLessons.length}`,
        appearances: s.appearances,
        lessonsAnalyzed: recentLessons.length,
        impact: s.highestImpact,
        percentage: Math.round((s.appearances / recentLessons.length) * 100)
      }));
    
    res.json({
      success: true,
      hasEnoughData: true,
      language: language,
      lessonsAnalyzed: recentLessons.length,
      struggles: recurringStruggles,
      dateRange: {
        from: recentLessons[recentLessons.length - 1]?.lessonDate,
        to: recentLessons[0]?.lessonDate
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting struggles:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get struggles', 
      error: error.message 
    });
  }
});

/**
 * @route   GET /api/progress/check-milestone/:language
 * @desc    Check if student hit a 5-lesson milestone and create notification if needed.
 *          Calculates averages for the milestone block and includes them in the notification.
 * @access  Private
 */
router.get('/check-milestone/:language', verifyToken, async (req, res) => {
  try {
    const { language } = req.params;
    
    // Get user from token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Get all completed analyses for this language (excluding trial & quick office hours)
    const allCompletedLessons = await LessonAnalysis.find({
      studentId: user._id,
      language: language,
      status: 'completed'
    })
      .populate({
        path: 'lessonId',
        select: 'isTrialLesson isOfficeHours officeHoursType'
      })
      .sort({ lessonDate: 1 }) // oldest first for milestone block calculation
      .lean();
    
    // Filter out trial lessons and quick office hours
    const filteredLessons = allCompletedLessons.filter(lesson => {
      const lessonData = lesson.lessonId;
      if (!lessonData) return true;
      if (lessonData.isTrialLesson === true) return false;
      if (lessonData.isOfficeHours === true && lessonData.officeHoursType === 'quick') return false;
      return true;
    });
    
    const totalLessons = filteredLessons.length;
    console.log(`📊 [Milestone] ${totalLessons} regular lessons (filtered from ${allCompletedLessons.length} total) for ${language}`);
    
    const isMilestone = totalLessons > 0 && totalLessons % 5 === 0;
    
    if (isMilestone) {
      // Check if we already created a notification for this milestone
      const existingNotification = await Notification.findOne({
        userId: user._id,
        type: 'progress_milestone',
        'data.language': language,
        'data.milestone': totalLessons
      });
      
      if (!existingNotification) {
        // Get the most recent 5-lesson block for averages
        const milestoneBlock = filteredLessons.slice(-5);
        
        // Calculate averages for this milestone block
        const levelMap = { 'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6 };
        const levelNames = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2' };
        
        const cefrLevels = milestoneBlock.map(a => levelMap[a.overallAssessment?.proficiencyLevel] || 3);
        const avgCefrNum = Math.round(cefrLevels.reduce((s, l) => s + l, 0) / cefrLevels.length);
        const avgCefrLevel = levelNames[Math.max(1, Math.min(6, avgCefrNum))];
        
        const grammarScores = milestoneBlock.map(a => a.grammarAnalysis?.accuracyScore || 0).filter(s => s > 0);
        const fluencyScores = milestoneBlock.map(a => a.fluencyAnalysis?.overallFluencyScore || 0).filter(s => s > 0);
        
        const vocabToScore = (range) => {
          const map = { 'limited': 30, 'moderate': 55, 'good': 75, 'excellent': 92 };
          return map[range] || 50;
        };
        const vocabScores = milestoneBlock.map(a => vocabToScore(a.vocabularyAnalysis?.vocabularyRange)).filter(s => s > 0);
        
        const avgGrammar = grammarScores.length > 0 ? Math.round(grammarScores.reduce((s, v) => s + v, 0) / grammarScores.length) : 0;
        const avgFluency = fluencyScores.length > 0 ? Math.round(fluencyScores.reduce((s, v) => s + v, 0) / fluencyScores.length) : 0;
        const avgVocab = vocabScores.length > 0 ? Math.round(vocabScores.reduce((s, v) => s + v, 0) / vocabScores.length) : 0;
        const totalStudyTime = milestoneBlock.reduce((s, a) => s + (a.progressionMetrics?.speakingTimeMinutes || 0), 0);
        
        const milestoneNumber = totalLessons / 5;
        
        // Create rich notification with averages and action button
        const message = milestoneNumber === 1
          ? `🎉 You've unlocked your Progress Profile after 5 <strong>${language}</strong> lessons! Tap to see your full breakdown.`
          : `📊 Milestone ${milestoneNumber} complete! You've finished ${totalLessons} <strong>${language}</strong> lessons. Tap to see how you've improved.`;
        
        await Notification.create({
          userId: user._id,
          type: 'progress_milestone',
          title: milestoneNumber === 1 ? `Progress Profile Unlocked! 🏆` : `${language} Milestone ${milestoneNumber}! 🎯`,
          message: message,
          data: {
            language: language,
            milestone: totalLessons,
            milestoneNumber: milestoneNumber,
            avgCefrLevel: avgCefrLevel,
            avgGrammar: avgGrammar,
            avgFluency: avgFluency,
            avgVocab: avgVocab,
            totalStudyTime: totalStudyTime,
            hasActionButton: true,
            actionButtonText: 'View Progress',
            actionRoute: '/tabs/progress'
          },
          read: false
        });
        
        console.log(`✅ Created progress milestone notification for ${user._id} - ${language} (milestone ${milestoneNumber}, ${totalLessons} lessons, avg CEFR: ${avgCefrLevel})`);
      }
    }
    
    res.json({
      success: true,
      isMilestone,
      totalLessons,
      language
    });
    
  } catch (error) {
    console.error('❌ Error checking milestone:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to check milestone', 
      error: error.message 
    });
  }
});

module.exports = router;
