const express = require('express');
const router = express.Router();
const { verifyToken, getUserFromRequest } = require('../middleware/videoUploadMiddleware');
const TutorFeedback = require('../models/TutorFeedback');
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const Notification = require('../models/Notification');

/**
 * @route   GET /api/tutor-feedback/pending
 * @desc    Get all pending feedback requests for a tutor
 *          Also self-heals: detects completed lessons with AI-disabled students
 *          that are missing TutorFeedback records and creates them on-the-fly.
 * @access  Private (Tutors only)
 */
router.get('/pending', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can access feedback requests' });
    }
    
    // ── SELF-HEALING BACKFILL ──────────────────────────────────────
    // Find completed lessons (last 30 days) where AI analysis was DISABLED
    // that are missing a TutorFeedback record. For AI-analyzed lessons,
    // tutor feedback is optional and no pending record is created.
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const completedLessons = await Lesson.find({
        tutorId: user._id,
        status: 'completed',
        isTrialLesson: { $ne: true },
        aiAnalysisEnabledAtTime: false, // Only non-AI lessons require feedback
        startTime: { $gte: thirtyDaysAgo }
      })
      .select('_id studentId')
      .lean();
      
      // Batch-check which lessons already have feedback records
      const lessonIds = completedLessons.map(l => l._id);
      const existingFeedbacks = await TutorFeedback.find({
        lessonId: { $in: lessonIds }
      }).select('lessonId').lean();
      const existingLessonIds = new Set(existingFeedbacks.map(f => f.lessonId.toString()));
      
      for (const lesson of completedLessons) {
        if (existingLessonIds.has(lesson._id.toString())) continue; // Already tracked
        
        const studentId = typeof lesson.studentId === 'object' ? lesson.studentId._id : lesson.studentId;
        
        console.log(`🔧 [Backfill] Creating missing TutorFeedback for lesson ${lesson._id} (tutor: ${user._id}, student: ${studentId})`);
        
        await TutorFeedback.create({
          lessonId: lesson._id,
          tutorId: user._id,
          studentId: studentId,
          status: 'pending',
          required: true
        });
      }
    } catch (backfillError) {
      // Backfill is best-effort — don't fail the whole request
      console.error('⚠️ [Backfill] Error during self-healing backfill:', backfillError.message);
    }
    // ── END BACKFILL ───────────────────────────────────────────────
    
    // Find REQUIRED pending feedback only (supports both _id and auth0Id storage)
    // required: { $ne: false } matches true and undefined (legacy records)
    const pendingFeedback = await TutorFeedback.find({
      $or: [
        { tutorId: user._id },
        { tutorId: user.auth0Id }
      ],
      status: 'pending',
      required: { $ne: false }
    })
    .sort({ createdAt: -1 })
    .lean();
    
    // Populate with lesson and student details (including last known CEFR)
    const LessonAnalysis = require('../models/LessonAnalysis');
    
    const feedbackWithDetails = await Promise.all(
      pendingFeedback.map(async (feedback) => {
        const lesson = await Lesson.findById(feedback.lessonId)
          .select('startTime endTime subject duration')
          .lean();
        const student = await User.findById(feedback.studentId)
          .select('name firstName lastName picture auth0Id')
          .lean();
        
        // Format student name
        let studentName = 'Unknown Student';
        if (student) {
          if (student.firstName && student.lastName) {
            studentName = `${student.firstName} ${student.lastName.charAt(0)}.`;
          } else if (student.name) {
            const parts = student.name.split(' ');
            if (parts.length >= 2) {
              studentName = `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
            } else {
              studentName = student.name;
            }
          }
        }
        
        // Fetch student's last known CEFR level from most recent LessonAnalysis
        // studentId in LessonAnalysis is stored as MongoDB ObjectId string
        let lastCefrLevel = null;
        let lastCefrDate = null;
        if (student) {
          try {
            const lastAnalysis = await LessonAnalysis.findOne({
              studentId: student._id,
              'overallAssessment.proficiencyLevel': { $exists: true },
              status: 'completed'
            })
            .sort({ lessonDate: -1 })
            .select('overallAssessment.proficiencyLevel lessonDate')
            .lean();
            
            if (lastAnalysis) {
              lastCefrLevel = lastAnalysis.overallAssessment?.proficiencyLevel;
              lastCefrDate = lastAnalysis.lessonDate;
            }
          } catch (cefrErr) {
            console.error('⚠️ Error fetching last CEFR:', cefrErr.message);
          }
        }
        
        return {
          ...feedback,
          lesson,
          studentName,
          studentPicture: student?.picture,
          lastCefrLevel,
          lastCefrDate
        };
      })
    );
    
    res.json({
      success: true,
      pendingFeedback: feedbackWithDetails,
      count: feedbackWithDetails.length
    });
  } catch (error) {
    console.error('❌ Error fetching pending feedback:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/tutor-feedback/:feedbackId/submit
 * @desc    Submit tutor feedback for a lesson
 * @access  Private (Tutors only)
 */
router.post('/:feedbackId/submit', verifyToken, async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { strengths, areasForImprovement, homework, overallNotes, estimatedCefrLevel } = req.body;
    
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can submit feedback' });
    }
    
    // Find feedback
    const feedback = await TutorFeedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({ success: false, message: 'Feedback request not found' });
    }
    
    // Verify tutor owns this feedback (supports both _id and auth0Id storage)
    const feedbackTutorId = feedback.tutorId?.toString();
    if (feedbackTutorId !== user._id.toString() && feedbackTutorId !== user.auth0Id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Validate required fields
    if (!strengths || strengths.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one strength is required' });
    }
    
    if (!areasForImprovement || areasForImprovement.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one area for improvement is required' });
    }
    
    // Validate CEFR level (required)
    const validCefrLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    if (!estimatedCefrLevel || !validCefrLevels.includes(estimatedCefrLevel)) {
      return res.status(400).json({ success: false, message: 'A valid CEFR level estimate is required (A1–C2)' });
    }
    
    // Update feedback
    feedback.strengths = strengths;
    feedback.areasForImprovement = areasForImprovement;
    feedback.homework = homework || '';
    feedback.overallNotes = overallNotes || '';
    feedback.estimatedCefrLevel = estimatedCefrLevel;
    feedback.status = 'completed';
    feedback.providedAt = new Date();
    await feedback.save();
    
    // Update lesson
    const lesson = await Lesson.findById(feedback.lessonId);
    if (lesson) {
      lesson.requiresTutorFeedback = false;
      await lesson.save();
    }
    
    // ── Create LessonAnalysis with source: 'tutor' ──────────────────
    // This feeds into the student's CEFR milestone tracking on the progress page.
    // Without this, students with AI disabled have zero progress data.
    try {
      const LessonAnalysis = require('../models/LessonAnalysis');
      
      // Check if a LessonAnalysis already exists for this lesson
      const existingAnalysis = await LessonAnalysis.findOne({ lessonId: feedback.lessonId });
      
      if (!existingAnalysis && lesson) {
        // Map CEFR to approximate numeric scores for consistency
        const cefrScoreMap = {
          'A1': { grammar: 30, fluency: 25, vocab: 'limited', confidence: 70 },
          'A2': { grammar: 50, fluency: 45, vocab: 'limited', confidence: 75 },
          'B1': { grammar: 65, fluency: 60, vocab: 'moderate', confidence: 80 },
          'B2': { grammar: 78, fluency: 75, vocab: 'good', confidence: 85 },
          'C1': { grammar: 90, fluency: 85, vocab: 'excellent', confidence: 90 },
          'C2': { grammar: 97, fluency: 95, vocab: 'excellent', confidence: 95 }
        };
        
        const scores = cefrScoreMap[estimatedCefrLevel] || cefrScoreMap['B1'];
        
        // Use MongoDB ObjectIds (as strings) — matches the format used by AI-generated
        // analyses and the my-analyses query (which filters by user._id)
        const studentObjectId = feedback.studentId?.toString();
        const tutorObjectId = user._id.toString();
        
        // Normalize language to match AI-generated analyses (strip " Lesson" suffix)
        const rawLang = lesson.subject || 'Unknown';
        const normalizedLang = rawLang.replace(/\s*lesson$/i, '').trim() || rawLang;
        
        await LessonAnalysis.create({
          lessonId: feedback.lessonId,
          studentId: studentObjectId,
          tutorId: tutorObjectId,
          language: normalizedLang,
          lessonDate: lesson.startTime || new Date(),
          source: 'tutor',
          status: 'completed',
          overallAssessment: {
            proficiencyLevel: estimatedCefrLevel,
            confidence: scores.confidence,
            summary: `Tutor assessment: ${strengths.join('; ')}. Areas to improve: ${areasForImprovement.join('; ')}`
          },
          strengths: strengths,
          areasForImprovement: areasForImprovement,
          grammarAnalysis: {
            accuracyScore: scores.grammar,
            mistakeTypes: [],
            suggestions: areasForImprovement
          },
          fluencyAnalysis: {
            overallFluencyScore: scores.fluency,
            speakingSpeed: 'natural',
            pauseFrequency: 'normal'
          },
          vocabularyAnalysis: {
            vocabularyRange: scores.vocab,
            uniqueWordCount: 0,
            wordsUsed: [],
            suggestedWords: []
          },
          progressionMetrics: {
            speakingTimeMinutes: lesson.clientSpeakingSeconds?.studentSeconds
              ? Math.ceil(lesson.clientSpeakingSeconds.studentSeconds / 60)
              : (lesson.duration || 25)
          },
          studentSummary: overallNotes || `Tutor feedback: ${strengths[0]}. Focus on: ${areasForImprovement[0]}.`,
          homeworkSuggestions: homework ? [homework] : [],
          aiModel: 'tutor-manual'
        });
        
        console.log(`📊 Created LessonAnalysis (source: tutor) for lesson ${feedback.lessonId} — CEFR: ${estimatedCefrLevel}`);
      } else if (existingAnalysis) {
        console.log(`ℹ️ LessonAnalysis already exists for lesson ${feedback.lessonId} — skipping creation`);
      }
    } catch (analysisErr) {
      // Don't fail the feedback submission if analysis creation fails
      console.error('⚠️ Error creating tutor LessonAnalysis:', analysisErr.message);
    }
    
    // Notify student — feedback.studentId may be ObjectId or auth0Id string
    let student = await User.findById(feedback.studentId).catch(() => null);
    if (!student) {
      // Fallback: try auth0Id lookup for older records
      student = await User.findOne({ auth0Id: feedback.studentId });
    }
    
    if (student) {
      try {
        // Format lesson date/time for notification
        let lessonDateStr = '';
        if (lesson && lesson.startTime) {
          const d = new Date(lesson.startTime);
          lessonDateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
            ' at ' +
            d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        }
        
        // Format tutor display name
        let tutorDisplayName = user.name || 'Your tutor';
        if (user.firstName && user.lastName) {
          tutorDisplayName = `${user.firstName} ${user.lastName.charAt(0)}.`;
        } else if (user.name) {
          const parts = user.name.split(' ');
          if (parts.length >= 2) {
            tutorDisplayName = `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
          }
        }
        
        const notifMessage = lessonDateStr
          ? `${tutorDisplayName} left feedback for your lesson on ${lessonDateStr}.`
          : `${tutorDisplayName} has provided feedback on your recent lesson.`;
        
        await Notification.create({
          userId: student._id,
          type: 'feedback_received',
          title: 'Feedback Available! 📝',
          message: notifMessage,
          relatedUserId: user._id,
          relatedUserPicture: user.picture || null,
          data: {
            lessonId: feedback.lessonId,
            tutorName: tutorDisplayName
          }
        });
      } catch (notifErr) {
        console.error('⚠️ Error creating feedback_received notification:', notifErr.message);
      }
      
      // Emit WebSocket event using student's auth0Id (rooms are keyed by auth0Id)
      const io = req.app.get('io');
      if (io && student.auth0Id) {
        io.to(`user:${student.auth0Id}`).emit('feedback_received', {
          lessonId: feedback.lessonId,
          tutorName: user.name
        });
      }
    }
    
    // ── Update or create learning plan after tutor feedback ─────────────
    try {
      const LearningPlanModel = require('../models/LearningPlan');
      const learningPlanService = require('../services/learningPlanService');

      const planStudent = student || await User.findById(feedback.studentId).catch(() => null) || await User.findOne({ auth0Id: feedback.studentId });

      if (planStudent && lesson) {
        const planLang = (lesson.subject || 'Unknown').replace(/\s*lesson$/i, '').trim() || lesson.subject || 'Unknown';
        // Include 'draft' (and other live statuses) — updatePlanAfterLesson is
        // what flips a draft plan to active on the first analyzed lesson.
        // Filtering on 'active' only meant fresh-from-onboarding plans never
        // received lesson updates.
        const existingPlan = await LearningPlanModel.findOne({
          studentId: planStudent._id,
          language: planLang,
          status: { $in: ['draft', 'active', 'mastery_mode', 'unframed', 'paused'] }
        });

        if (existingPlan) {
          const latestAnalysis = await LessonAnalysis.findOne({
            lessonId: feedback.lessonId,
            status: 'completed'
          }).lean();
          if (latestAnalysis) {
            await learningPlanService.updatePlanAfterLesson(existingPlan._id, latestAnalysis);
          }
        } else if (lesson.isTrialLesson && planStudent.onboardingData?.learningGoal?.type) {
          const newPlan = await learningPlanService.generateInitialPlan(planStudent._id, planLang);

          if (newPlan) {
            const goalLabel = learningPlanService.GOAL_TYPE_LABELS[planStudent.onboardingData.learningGoal.type] || 'reach your goal';
            await Notification.create({
              userId: planStudent._id,
              type: 'learning_plan_ready',
              title: 'Your Learning Plan is Ready! 🎯',
              message: `Based on your first lesson, we've created a personalized path to help you ${goalLabel.toLowerCase()} in <strong>${planLang}</strong>.`,
              data: {
                language: planLang,
                planId: newPlan._id.toString(),
                hasActionButton: true,
                actionButtonText: 'View Plan',
                actionRoute: '/tabs/progress'
              },
              read: false
            });

            const io = req.app.get('io');
            if (io && planStudent.auth0Id) {
              io.to(`user:${planStudent.auth0Id}`).emit('learning_plan_ready', {
                language: planLang,
                planId: newPlan._id.toString()
              });
            }
          }
        }
      }
    } catch (planErr) {
      console.error('⚠️ Learning plan update after tutor feedback failed (non-blocking):', planErr.message);
    }

    // ── Check for progress milestone (every 5 lessons) ─────────────
    // Since tutor feedback creates a LessonAnalysis, we need to check if
    // the student just hit a 5-lesson milestone.
    try {
      const LessonAnalysisMilestone = require('../models/LessonAnalysis');
      
      const studentUser = student || await User.findById(feedback.studentId).catch(() => null) || await User.findOne({ auth0Id: feedback.studentId });
      
      if (studentUser && lesson) {
        const milestoneLang = (lesson.subject || 'Unknown').replace(/\s*lesson$/i, '').trim() || lesson.subject || 'Unknown';
        const allAnalyses = await LessonAnalysisMilestone.find({
          studentId: studentUser._id.toString(),
          language: milestoneLang,
          status: 'completed'
        })
          .populate({
            path: 'lessonId',
            select: 'isTrialLesson isOfficeHours officeHoursType'
          })
          .sort({ lessonDate: 1 })
          .lean();
        
        const filtered = allAnalyses.filter(a => {
          const l = a.lessonId;
          if (!l) return true;
          if (l.isTrialLesson === true) return false;
          if (l.isOfficeHours === true && l.officeHoursType === 'quick') return false;
          return true;
        });
        
        const totalLessons = filtered.length;
        const isMilestone = totalLessons > 0 && totalLessons % 5 === 0;
        
        if (isMilestone) {
          const existingMilestoneNotif = await Notification.findOne({
            userId: studentUser._id,
            type: 'progress_milestone',
            'data.language': lesson.subject,
            'data.milestone': totalLessons
          });
          
          if (!existingMilestoneNotif) {
            const milestoneBlock = filtered.slice(-5);
            const levelMap = { 'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6 };
            const levelNames = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2' };
            
            const cefrLevels = milestoneBlock.map(a => levelMap[a.overallAssessment?.proficiencyLevel] || 3);
            const avgCefrNum = Math.round(cefrLevels.reduce((s, l) => s + l, 0) / cefrLevels.length);
            const avgCefrLevel = levelNames[Math.max(1, Math.min(6, avgCefrNum))];
            
            const grammarScores = milestoneBlock.map(a => a.grammarAnalysis?.accuracyScore || 0).filter(s => s > 0);
            const fluencyScores = milestoneBlock.map(a => a.fluencyAnalysis?.overallFluencyScore || 0).filter(s => s > 0);
            const vocabToScore = (range) => ({ 'limited': 30, 'moderate': 55, 'good': 75, 'excellent': 92 }[range] || 50);
            const vocabScores = milestoneBlock.map(a => vocabToScore(a.vocabularyAnalysis?.vocabularyRange)).filter(s => s > 0);
            
            const avgGrammar = grammarScores.length > 0 ? Math.round(grammarScores.reduce((s, v) => s + v, 0) / grammarScores.length) : 0;
            const avgFluency = fluencyScores.length > 0 ? Math.round(fluencyScores.reduce((s, v) => s + v, 0) / fluencyScores.length) : 0;
            const avgVocab = vocabScores.length > 0 ? Math.round(vocabScores.reduce((s, v) => s + v, 0) / vocabScores.length) : 0;
            const totalStudyTime = milestoneBlock.reduce((s, a) => s + (a.progressionMetrics?.speakingTimeMinutes || 0), 0);
            
            const milestoneNumber = totalLessons / 5;
            const lang = milestoneLang;
            
            const milestoneMsg = milestoneNumber === 1
              ? `🎉 You've unlocked your Progress Profile after 5 <strong>${lang}</strong> lessons! Tap to see your full breakdown.`
              : `📊 Milestone ${milestoneNumber} complete! You've finished ${totalLessons} <strong>${lang}</strong> lessons. Tap to see how you've improved.`;
            
            await Notification.create({
              userId: studentUser._id,
              type: 'progress_milestone',
              title: milestoneNumber === 1 ? `Progress Profile Unlocked! 🏆` : `${lang} Milestone ${milestoneNumber}! 🎯`,
              message: milestoneMsg,
              data: {
                language: lang,
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
            
            console.log(`🎯 Created progress milestone notification for student ${studentUser._id} — milestone ${milestoneNumber}, ${totalLessons} lessons, avg CEFR: ${avgCefrLevel}`);
          }
        }
      }
    } catch (milestoneErr) {
      console.error('⚠️ Error checking milestone after tutor feedback:', milestoneErr.message);
    }
    
    // ── Recalculate coaching metrics immediately ──────────────────
    // So the tutor sees updated stats on /tabs/progress right away
    // instead of waiting for the daily 2 AM cron job.
    try {
      const { evaluateTutorForBadge } = require('../jobs/evaluateCoachingBadges');
      // Re-fetch the tutor user (not lean) so it can be saved
      const tutorUser = await User.findById(user._id);
      if (tutorUser) {
        const evalResult = await evaluateTutorForBadge(tutorUser);
        console.log(`📊 Real-time coaching metrics updated for tutor ${user._id}:`, evalResult.metrics);
      }
    } catch (evalErr) {
      // Non-critical — cron job will catch up
      console.error('⚠️ Error recalculating coaching metrics (non-critical):', evalErr.message);
    }
    
    console.log(`✅ Tutor feedback submitted for lesson ${feedback.lessonId} — CEFR: ${estimatedCefrLevel}`);
    
    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      feedback
    });
  } catch (error) {
    console.error('❌ Error submitting feedback:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/tutor-feedback/lesson/:lessonId
 * @desc    Get feedback for a specific lesson
 * @access  Private
 */
router.get('/lesson/:lessonId', verifyToken, async (req, res) => {
  try {
    const { lessonId } = req.params;
    
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Find feedback
    const feedback = await TutorFeedback.findOne({ lessonId }).lean();
    
    if (!feedback) {
      return res.status(404).json({ 
        success: false, 
        message: 'No feedback found for this lesson',
        hasFeedback: false
      });
    }
    
    // Verify user is student or tutor of this lesson
    // feedback.studentId/tutorId may be ObjectId or auth0Id string
    const userId = user._id.toString();
    const userAuth0 = user.auth0Id;
    const fbStudentId = feedback.studentId?.toString();
    const fbTutorId = feedback.tutorId?.toString();
    
    const isStudent = fbStudentId === userId || fbStudentId === userAuth0;
    const isTutor = fbTutorId === userId || fbTutorId === userAuth0;
    
    if (!isStudent && !isTutor) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    res.json({
      success: true,
      feedback,
      hasFeedback: true
    });
  } catch (error) {
    console.error('❌ Error fetching feedback:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

