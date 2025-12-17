const express = require('express');
const router = express.Router();
const LessonAnalysis = require('../models/LessonAnalysis');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

/**
 * @route   GET /api/progress/struggles/:language
 * @desc    Get recurring struggles for a student in a specific language (last 5 lessons)
 * @access  Private
 */
router.get('/struggles/:language', verifyToken, async (req, res) => {
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
 * @desc    Check if student hit a 5-lesson milestone and create notification if needed
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
    
    // Count total completed lessons for this language (excluding trial & quick office hours)
    const allCompletedLessons = await LessonAnalysis.find({
      studentId: user._id,
      language: language,
      status: 'completed'
    })
      .populate({
        path: 'lessonId',
        select: 'isTrialLesson isOfficeHours officeHoursType'
      })
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
        type: 'struggle_milestone',
        'data.language': language,
        'data.milestone': totalLessons
      });
      
      if (!existingNotification) {
        // Get struggle data from last 5 REGULAR lessons (already filtered)
        const strugglesLessons = await LessonAnalysis.find({
          studentId: user._id,
          language: language,
          status: 'completed'
        })
          .populate({
            path: 'lessonId',
            select: 'isTrialLesson isOfficeHours officeHoursType'
          })
          .sort({ lessonDate: -1 })
          .select('topErrors progressionMetrics lessonId')
          .lean();
        
        // Filter and take last 5
        const recentLessons = strugglesLessons
          .filter(lesson => {
            const lessonData = lesson.lessonId;
            if (!lessonData) return true;
            if (lessonData.isTrialLesson === true) return false;
            if (lessonData.isOfficeHours === true && lessonData.officeHoursType === 'quick') return false;
            return true;
          })
          .slice(0, 5);

        
        // Count struggles
        const struggleMap = new Map();
        recentLessons.forEach(lesson => {
          lesson.topErrors?.forEach(error => {
            const key = error.issue.toLowerCase().trim();
            if (!struggleMap.has(key)) {
              struggleMap.set(key, { issue: error.issue, count: 0 });
            }
            struggleMap.get(key).count += 1;
          });
        });
        
        const topStruggle = Array.from(struggleMap.values())
          .filter(s => s.count >= 2)
          .sort((a, b) => b.count - a.count)[0];
        
        // Create notification
        const message = topStruggle 
          ? `You've completed ${totalLessons} ${language} lessons! We've noticed you're working on ${topStruggle.issue}. Check your progress page for insights.`
          : `Great progress! You've completed ${totalLessons} ${language} lessons. Check your progress page to see how you're doing!`;
        
        await Notification.create({
          userId: user._id,
          type: 'struggle_milestone',
          title: `${language} Progress Milestone! 🎯`,
          message: message,
          data: {
            language: language,
            milestone: totalLessons,
            topStruggle: topStruggle?.issue
          },
          read: false
        });
        
        console.log(`✅ Created struggle milestone notification for ${user._id} - ${language} (${totalLessons} lessons)`);
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
