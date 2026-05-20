const express = require('express');
const router = express.Router();
const LearningPlan = require('../models/LearningPlan');
const LessonAnalysis = require('../models/LessonAnalysis');
const User = require('../models/User');
const TutorMaterial = require('../models/TutorMaterial');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const learningPlanService = require('../services/learningPlanService');
const entitlements = require('../services/entitlementsService');
const perTutorLane = require('../services/perTutorLaneService');
const mastery = require('../services/masteryService');

/**
 * @route   GET /api/learning-plan/:language
 * @desc    Get active learning plan for authenticated student
 * @access  Private
 */
router.get('/:language', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language,
      // Include 'unframed' and 'paused' so the client can render the
      // "without a plan" home state and the journey-paused empty state
      // instead of treating them as "no plan exists".
      status: { $in: ['draft', 'active', 'completed', 'mastery_mode', 'unframed', 'paused'] }
    }).lean();

    if (!plan) {
      return res.status(404).json({ success: false, message: 'No learning plan found' });
    }

    // Soft "Want a plan?" prompt eligibility — surfaced on post-lesson and
    // home so students who chose to learn at their own pace get a gentle,
    // throttled nudge instead of a constant CTA. See docs/learning-journey/
    // voice-and-framing.md.
    if (plan.status === 'unframed' || plan.status === 'paused') {
      const lessonsTotal = await LessonAnalysis.countDocuments({
        studentId: user._id.toString(),
        language: req.params.language,
        status: 'completed'
      });
      const lessonsSince = Math.max(0, lessonsTotal - (plan.lessonsAtUnframed || 0));
      const dismissedAgeMs = plan.softPlanPromptDismissedAt
        ? Date.now() - new Date(plan.softPlanPromptDismissedAt).getTime()
        : Infinity;
      const dismissalTtlMs = 30 * 24 * 60 * 60 * 1000;
      plan.softPlanPrompt = {
        eligible: lessonsSince >= 3 && dismissedAgeMs > dismissalTtlMs,
        lessonsSince,
        dismissedAt: plan.softPlanPromptDismissedAt || null
      };
    }

    // Resolve the per-tutor lane focus for the home widget. We attach
    // both the resolved focus and the source so the UI can show a small
    // "with <Tutor>" hint when the focus came from a specific tutor.
    const resolved = await perTutorLane.resolveNextFocus(plan);
    if (resolved.focus) {
      plan.nextLessonFocus = resolved.focus;
    }
    plan.nextLessonFocusSource = resolved.source;
    plan.nextLessonFocusTutor = resolved.tutor || null;

    // Strip raw tutorVotes from student-facing payload; replace with a
    // privacy-safe aggregate (G30 — students see consensus signal, not who
    // voted what). Also strips from chaptersCompleted for symmetry.
    const stripVotes = (phase) => {
      if (!phase) return phase;
      const votes = (phase.tutorVotes || []).filter(v => new Date(v.expiresAt).getTime() > Date.now());
      const advances = votes.filter(v => v.vote === 'advance').length;
      const holds = votes.filter(v => v.vote === 'hold').length;
      const { tutorVotes, ...rest } = phase;
      return {
        ...rest,
        tutorVoteSummary: {
          advances,
          holds,
          total: votes.length,
          consensus: advances > holds ? 'advance' : holds > advances ? 'hold' : 'split'
        }
      };
    };
    if (Array.isArray(plan.phases)) plan.phases = plan.phases.map(stripVotes);
    if (Array.isArray(plan.chaptersCompleted)) {
      plan.chaptersCompleted = plan.chaptersCompleted.map(c => ({
        ...c,
        phases: (c.phases || []).map(stripVotes)
      }));
    }

    // Attach a coarse, *student-facing* progress state to each non-completed
    // phase. Hides the raw mastery score and the 70 threshold from the UI so
    // each lesson doesn't feel like an exam. See masteryService.phaseProgressState.
    if (Array.isArray(plan.phases)) {
      const totalPhases = plan.phases.length;
      plan.phases = plan.phases.map((p, i) => {
        if (!p || p.status === 'completed') return p;
        const hasMore = i < totalPhases - 1;
        const ps = mastery.phaseProgressState(p, hasMore);
        return {
          ...p,
          progressState: ps.state,
          windowProgressPercent: ps.windowProgressPercent
        };
      });
    }

    // CEFR scale visual data: bold the revealed level, dim the rest.
    // Frontend uses this to render the A1..C2 chip on the journey page header
    // without recomputing logic. Hidden until first reveal.
    if (plan.revealedCefrLevel?.level) {
      const ALL = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      plan.cefrScale = ALL.map(l => ({
        level: l,
        active: l === plan.revealedCefrLevel.level
      }));
    }

    res.json({
      success: true,
      plan,
      entitlements: entitlements.describeForClient(user)
    });
  } catch (error) {
    console.error('Error fetching learning plan:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/cefr-reveal/ack
 * @desc    Acknowledge the latest CEFR reveal (clears the pending flag so the
 *          first-reveal modal / re-reveal toast doesn't show again).
 * @access  Private (student)
 */
router.post('/:language/cefr-reveal/ack', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    });
    if (!plan) return res.status(404).json({ success: false, message: 'No learning plan found' });

    plan.pendingCefrReveal = false;
    await plan.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error acknowledging CEFR reveal:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/:language/coming-up
 * @desc    Upcoming lessons for the student in this language, with each
 *          tutor's per-lane focus folded in. Drives the journey page's
 *          "Coming Up" section. Tap-through to /lessons/:id is handled
 *          on the client.
 * @access  Private (student)
 */
router.get('/:language/coming-up', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    }).lean();

    const lessons = await perTutorLane.getComingUp(user._id, req.params.language, { limit: 5 });
    const lanes = Array.isArray(plan?.tutorFocusByTutorId) ? plan.tutorFocusByTutorId : [];
    const lanesByTutor = new Map(lanes.map(e => [String(e.tutorId), e]));

    const items = lessons.map(l => {
      const t = l.tutorId || {};
      const tid = String(t._id || t);
      const lane = lanesByTutor.get(tid);
      return {
        lessonId: String(l._id),
        startTime: l.startTime,
        duration: l.duration || null,
        tutor: {
          id: tid,
          firstName: t.firstName || '',
          name: t.name || `${t.firstName || ''} ${t.lastName || ''}`.trim(),
          picture: t.picture || ''
        },
        focus: lane?.focus || '',
        // Surfaced so the journey/home widget can swap "Next lesson focus"
        // for a trial-aware framing when the literal next event is a
        // meet-and-greet (per-tutor trial — true even for a 10-lesson
        // student booking with a new tutor for the first time).
        isTrialLesson: !!l.isTrialLesson
      };
    });

    res.json({ success: true, items });
  } catch (error) {
    console.error('Error fetching coming-up:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/initial
 * @desc    Student-triggered draft plan creation (no lesson required)
 * @access  Private (student, post-onboarding)
 */
router.post('/initial', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const language = req.body?.language
      || user.onboardingData?.languages?.[0]
      || null;
    if (!language) {
      return res.status(400).json({ success: false, message: 'Language is required (or set one in onboarding).' });
    }

    if (!user.onboardingData?.learningGoal?.type) {
      return res.status(400).json({
        success: false,
        message: 'A learning goal is required before generating a plan.'
      });
    }

    const existing = await LearningPlan.findOne({ studentId: user._id, language }).lean();
    if (existing) {
      return res.json({ success: true, plan: existing, created: false });
    }

    const plan = await learningPlanService.generateInitialPlan(user._id, language);
    if (!plan) {
      return res.status(500).json({ success: false, message: 'Failed to create plan' });
    }

    res.json({
      success: true,
      plan,
      created: true,
      entitlements: entitlements.describeForClient(user)
    });
  } catch (error) {
    console.error('Error creating initial learning plan:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/:language/recommended-materials
 * @desc    Returns the snapshot of struggle-matched materials saved on the plan
 *          (populated for free students after each lesson). Lightweight: no scoring.
 * @access  Private (student)
 */
router.get('/:language/recommended-materials', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    }).lean();

    if (!plan || !plan.recommendedMaterials || plan.recommendedMaterials.length === 0) {
      return res.json({ success: true, materials: [], updatedAt: null });
    }

    const ids = plan.recommendedMaterials
      .filter(r => !r.dismissedAt)
      .map(r => r.materialId);
    const materials = await TutorMaterial.find({
      _id: { $in: ids },
      status: 'published'
    })
      .populate('tutorId', 'name firstName lastName picture')
      .lean();

    const matchMap = new Map(plan.recommendedMaterials.map(r => [r.materialId.toString(), r.matchedStruggles || []]));
    const enriched = materials.map(m => ({
      ...m,
      matchedStruggles: matchMap.get(m._id.toString()) || []
    }));

    res.json({
      success: true,
      materials: enriched,
      updatedAt: plan.recommendedMaterialsUpdatedAt || null
    });
  } catch (error) {
    console.error('Error fetching plan-recommended materials:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/student/:studentId/:language
 * @desc    Tutor fetches a student's learning plan
 * @access  Private (tutor)
 */
router.get('/student/:studentId/:language', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const plan = await LearningPlan.findOne({
      studentId: req.params.studentId,
      language: req.params.language,
      status: { $in: ['active', 'completed'] }
    }).lean();

    if (!plan) {
      return res.status(404).json({ success: false, message: 'No learning plan found' });
    }

    res.json({ success: true, plan });
  } catch (error) {
    console.error('Error fetching student learning plan:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/student/:studentId/summary
 * @desc    Lightweight plan summary for pre-call / event-details (tutor use)
 * @access  Private
 */
router.get('/student/:studentId/summary', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const plans = await LearningPlan.find({
      studentId: req.params.studentId,
      status: { $in: ['active', 'completed'] }
    }).lean();

    if (!plans.length) {
      return res.status(404).json({ success: false, message: 'No learning plan found' });
    }

    const summaries = plans.map(plan => ({
      _id: plan._id,
      language: plan.language,
      status: plan.status,
      goal: plan.goal,
      currentPhaseIndex: plan.currentPhaseIndex,
      totalPhases: plan.phases.length,
      currentPhase: plan.phases[plan.currentPhaseIndex] || null,
      studentSummary: plan.studentSummary,
      nextLessonFocus: plan.nextLessonFocus,
      tutorOverrides: (plan.tutorOverrides || []).slice(-5),
      selfAssessedLevel: plan.selfAssessedLevel
    }));

    res.json({ success: true, summaries });
  } catch (error) {
    console.error('Error fetching plan summary:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/student/:studentId/:language/lesson-prep
 * @desc    One-shot pre-lesson briefing for a tutor opening event details.
 *          Combines plan summary (mastery, focus) with the most recent
 *          completed analysis (top errors, persistent challenges, recent
 *          corrected excerpts) so the tutor walks in prepared.
 *
 *          Designed to be cheap: runs on every event-details open. No AI calls.
 * @access  Private (tutor of the lesson — light authz check)
 */
router.get('/student/:studentId/:language/lesson-prep', verifyToken, async (req, res) => {
  try {
    const requester = await User.findOne({ auth0Id: req.user.sub });
    if (!requester) return res.status(404).json({ success: false, message: 'User not found' });

    // Tutors may fetch this for any of their students. Students may fetch
    // their own. Anything else gets 403.
    const isSelf = requester._id.toString() === req.params.studentId;
    if (!isSelf && requester.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const { studentId, language } = req.params;

    // Did this tutor ever complete a lesson with this student? Used to
    // surface "first lesson together" hints in the briefing UI so the
    // tutor pays extra attention.
    const Lesson = require('../models/Lesson');
    let priorLessonCount = 0;
    if (!isSelf && requester.userType === 'tutor') {
      try {
        priorLessonCount = await Lesson.countDocuments({
          tutorId: requester._id,
          studentId,
          status: 'completed',
          ...(language ? { subject: language } : {})
        });
      } catch (_e) { priorLessonCount = 0; }
    }

    const [plan, latestAnalysis] = await Promise.all([
      LearningPlan.findOne({
        studentId,
        language,
        status: { $in: ['draft', 'active', 'completed'] }
      }).lean(),
      LessonAnalysis.findOne({
        studentId: studentId.toString(),
        language,
        status: 'completed'
      })
        .sort({ lessonDate: -1 })
        .select([
          'lessonId',
          'lessonDate',
          'overallAssessment.proficiencyLevel',
          'overallAssessment.summary',
          'topErrors',
          'errorPatterns.pattern',
          'errorPatterns.severity',
          'progressionMetrics.persistentChallenges',
          'progressionMetrics.proficiencyChange',
          'areasForImprovement',
          'recommendedFocus',
          'correctedExcerpts'
        ].join(' '))
        .lean()
    ]);

    if (!plan && !latestAnalysis) {
      return res.json({ success: true, prep: null });
    }

    const currentPhase = plan?.phases?.[plan.currentPhaseIndex] || null;

    // Deterministically craft a 2–3-bullet mini agenda for the tutor.
    const agenda = [];
    if (plan?.nextLessonFocus) {
      agenda.push(plan.nextLessonFocus);
    }
    const topErr = latestAnalysis?.topErrors?.[0];
    if (topErr?.issue) {
      agenda.push(`Address recurring issue: ${topErr.issue}`);
    }
    const persistent = latestAnalysis?.progressionMetrics?.persistentChallenges?.[0];
    if (persistent && !agenda.some(a => a.toLowerCase().includes(persistent.toLowerCase()))) {
      agenda.push(`Revisit persistent challenge: ${persistent}`);
    }
    if (currentPhase?.suggestedTopics?.length && agenda.length < 3) {
      agenda.push(`Suggested topic: ${currentPhase.suggestedTopics[0]}`);
    }

    // Anonymized recent notes from *other* tutors (first-name only).
    // Helps the requesting tutor not duplicate or contradict what
    // another tutor has been working on with this student.
    const otherTutorNotes = !isSelf && requester.userType === 'tutor'
      ? perTutorLane.getOtherTutorNotes(plan, requester._id, { limit: 3 })
      : [];

    // AI-synthesized two-section briefing (Batch 7). Only if the student
    // is premium AND the requester is a tutor. Cheap call (200-400 tokens).
    let aiBriefing = null;
    if (!isSelf && requester.userType === 'tutor') {
      try {
        const studentDoc = await User.findById(studentId).select('subscription userType').lean();
        if (studentDoc && entitlements.isPremium(studentDoc)) {
          const tutorBriefingService = require('../services/tutorBriefingService');
          const synth = await tutorBriefingService.synthesizeTutorBriefing(
            studentId, requester._id, language
          );
          aiBriefing = {
            ownSection: synth.ownSection,
            generalSection: synth.generalSection
          };
        }
      } catch (err) {
        console.error('[lesson-prep] AI briefing failed (non-blocking):', err.message);
      }
    }

    res.json({
      success: true,
      prep: {
        plan: plan ? {
          _id: plan._id,
          language: plan.language,
          status: plan.status,
          goal: plan.goal,
          studentSummary: plan.studentSummary,
          nextLessonFocus: plan.nextLessonFocus,
          currentPhaseIndex: plan.currentPhaseIndex,
          totalPhases: plan.phases?.length || 0,
          currentPhase: currentPhase ? {
            title: currentPhase.title,
            description: currentPhase.description,
            focusAreas: currentPhase.focusAreas || [],
            suggestedTopics: currentPhase.suggestedTopics || [],
            exitCriteria: currentPhase.exitCriteria,
            lessonsCompleted: currentPhase.lessonsCompleted || 0,
            estimatedLessons: currentPhase.estimatedLessons || 5,
            masteryAverage: currentPhase.masteryAverage ?? null,
            lessonScores: currentPhase.lessonScores || [],
            // Cue tutors that this phase reflects the student's own framing.
            studentEditedAt: currentPhase.studentEditedAt || null,
            // Requesting tutor's OWN latest vote (G30 — never expose others'
            // votes to a tutor). Null if they haven't voted yet.
            yourVote: (() => {
              if (!requester || requester.userType !== 'tutor') return null;
              const own = (currentPhase.tutorVotes || [])
                .filter(v => String(v.tutorId) === String(requester._id))
                .sort((a, b) => new Date(b.setAt).getTime() - new Date(a.setAt).getTime())[0];
              if (!own) return null;
              return {
                vote: own.vote,
                setAt: own.setAt,
                expiresAt: own.expiresAt,
                expired: new Date(own.expiresAt).getTime() < Date.now(),
                note: own.note || ''
              };
            })()
          } : null,
          tutorOverrides: (plan.tutorOverrides || []).slice(-3)
        } : null,
        latestAnalysis: latestAnalysis ? {
          lessonId: latestAnalysis.lessonId,
          lessonDate: latestAnalysis.lessonDate,
          proficiencyLevel: latestAnalysis.overallAssessment?.proficiencyLevel,
          summary: latestAnalysis.overallAssessment?.summary,
          topErrors: (latestAnalysis.topErrors || []).slice(0, 3),
          errorPatterns: (latestAnalysis.errorPatterns || []).slice(0, 3),
          persistentChallenges: latestAnalysis.progressionMetrics?.persistentChallenges || [],
          proficiencyChange: latestAnalysis.progressionMetrics?.proficiencyChange || null,
          areasForImprovement: (latestAnalysis.areasForImprovement || []).slice(0, 3),
          recommendedFocus: (latestAnalysis.recommendedFocus || []).slice(0, 3),
          correctedExcerpts: (latestAnalysis.correctedExcerpts || []).slice(0, 3)
        } : null,
        agenda,
        // 0 = first time tutor is teaching this student in this language.
        // The client uses this to expand the briefing by default and show
        // a small "First lesson with this student" badge.
        priorLessonCount,
        firstTimePairing: priorLessonCount === 0,
        otherTutorNotes,
        // Premium-only AI synthesis. Null for free students. Tutors render
        // the two sections side-by-side; "ownSection" is full detail of
        // their own work; "generalSection" is anonymized cross-tutor signal.
        aiBriefing
      }
    });
  } catch (error) {
    console.error('Error fetching lesson prep:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   PUT /api/learning-plan/goal
 * @desc    Student updates their goal (triggers plan regeneration with 7-day cooldown)
 * @access  Private
 */
router.put('/goal', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { language, goal } = req.body;
    if (!language || !goal?.type) {
      return res.status(400).json({ success: false, message: 'language and goal.type are required' });
    }

    const plan = await learningPlanService.regeneratePlan(user._id, language, goal);

    res.json({ success: true, plan });
  } catch (error) {
    if (error.statusCode === 429) {
      return res.status(429).json({
        success: false,
        message: 'Goal change cooldown active',
        nextChangeAvailableAt: error.nextChangeAvailableAt,
        cooldownDays: error.cooldownDays || 7
      });
    }
    console.error('Error updating goal:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/tutor-override
 * @desc    Tutor submits an override (extend phase, adjust focus, add note)
 * @access  Private (tutor)
 */
router.post('/tutor-override', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { studentId, language, action, note } = req.body;
    if (!studentId || !language || !action) {
      return res.status(400).json({ success: false, message: 'studentId, language, and action are required' });
    }

    // Vote model (Batch 10): advance_phase and extend_phase no longer
    // mutate the plan directly. They become votes that bias the mastery
    // threshold by ±5 (see backend/services/masteryService.js applyTutorVoteBias).
    // skip_phase / adjust_focus / add_note remain authoritative actions —
    // tutors retain full control over content, only the timing of progress
    // becomes a collaborative signal.
    const validActions = ['extend_phase', 'advance_phase', 'skip_phase', 'adjust_focus', 'add_note'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ success: false, message: `Invalid action. Must be one of: ${validActions.join(', ')}` });
    }

    const plan = await LearningPlan.findOne({
      studentId,
      language,
      status: { $in: ['active', 'mastery_mode'] }
    });

    if (!plan) {
      return res.status(404).json({ success: false, message: 'No active learning plan found' });
    }

    let tutorDisplayName = user.name || 'Tutor';
    if (user.firstName && user.lastName) {
      tutorDisplayName = `${user.firstName} ${user.lastName.charAt(0)}.`;
    }

    plan.tutorOverrides.push({
      tutorId: user._id,
      tutorName: tutorDisplayName,
      date: new Date(),
      action,
      note: note || ''
    });

    // ── advance_phase / extend_phase → VOTE (Batch 10) ──────────────
    if (action === 'advance_phase' || action === 'extend_phase') {
      const phase = plan.phases[plan.currentPhaseIndex];
      if (!phase) {
        return res.status(400).json({ success: false, message: 'No active phase to vote on.' });
      }
      const voteValue = action === 'advance_phase' ? 'advance' : 'hold';
      // One vote per tutor — latest replaces previous (G29).
      phase.tutorVotes = (phase.tutorVotes || []).filter(v => String(v.tutorId) !== String(user._id));
      phase.tutorVotes.push({
        tutorId: user._id,
        tutorName: tutorDisplayName,
        vote: voteValue,
        note: note || '',
        setAt: new Date(),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      });
      plan.history.push({
        date: new Date(),
        changeDescription: voteValue === 'advance'
          ? `Tutor ${tutorDisplayName} voted to advance phase`
          : `Tutor ${tutorDisplayName} voted to hold phase`,
        phaseIndexBefore: plan.currentPhaseIndex,
        phaseIndexAfter: plan.currentPhaseIndex,
        masteryAtAdvance: phase.masteryAverage ?? null,
        reason: voteValue === 'advance' ? 'tutor_vote_advance' : 'tutor_vote_hold'
      });
      // No phase mutation here — the mastery gate consumes the vote on the
      // next lesson update (or chapter graduation evaluation).
    } else if (action === 'skip_phase' && plan.currentPhaseIndex < plan.phases.length - 1) {
      // skip_phase remains authoritative — it's an explicit override, not
      // a timing signal. Same as before.
      const currentPhase = plan.phases[plan.currentPhaseIndex];
      if (currentPhase) {
        currentPhase.status = 'completed';
        currentPhase.completedAt = new Date();
      }
      plan.currentPhaseIndex += 1;
      const nextPhase = plan.phases[plan.currentPhaseIndex];
      if (nextPhase) {
        nextPhase.status = 'active';
      }
      plan.history.push({
        date: new Date(),
        changeDescription: `Phase skipped by tutor ${tutorDisplayName}`,
        phaseIndexBefore: plan.currentPhaseIndex - 1,
        phaseIndexAfter: plan.currentPhaseIndex,
        reason: 'tutor_skip'
      });
    } else if (action === 'adjust_focus') {
      // Multi-tutor model: each tutor owns their own focus lane. We
      // still update the top-level `nextLessonFocus` so single-tutor
      // students see the change immediately, but the resolver in
      // GET /:language will pick the right lane when the student has
      // upcoming lessons with multiple tutors.
      if (note) {
        plan.nextLessonFocus = note;
        plan.tutorFocusByTutorId = (plan.tutorFocusByTutorId || []).filter(
          e => String(e.tutorId) !== String(user._id)
        );
        plan.tutorFocusByTutorId.push({
          tutorId: user._id,
          tutorName: tutorDisplayName,
          focus: note,
          note: '',
          setAt: new Date()
        });
      }
      plan.history.push({
        date: new Date(),
        changeDescription: `Focus adjusted by tutor ${tutorDisplayName}: ${note || ''}`,
        phaseIndexBefore: plan.currentPhaseIndex,
        phaseIndexAfter: plan.currentPhaseIndex
      });
    } else if (action === 'add_note') {
      // Capture the tutor note in their lane so other tutors can see
      // "last 3 notes by other tutors" in their pre-lesson briefing.
      if (note) {
        plan.tutorFocusByTutorId = (plan.tutorFocusByTutorId || []);
        plan.tutorFocusByTutorId.push({
          tutorId: user._id,
          tutorName: tutorDisplayName,
          focus: '',
          note,
          setAt: new Date()
        });
      }
      plan.history.push({
        date: new Date(),
        changeDescription: `Note added by tutor ${tutorDisplayName}: ${note || ''}`,
        phaseIndexBefore: plan.currentPhaseIndex,
        phaseIndexAfter: plan.currentPhaseIndex
      });
    }

    plan.lastUpdatedAt = new Date();
    await plan.save();

    // Strip other tutors' votes from the response (G30 — tutors only see
    // their own vote).
    const planView = plan.toObject();
    if (Array.isArray(planView.phases)) {
      planView.phases = planView.phases.map(p => ({
        ...p,
        tutorVotes: (p.tutorVotes || []).filter(v => String(v.tutorId) === String(user._id))
      }));
    }

    res.json({ success: true, plan: planView });
  } catch (error) {
    console.error('Error submitting tutor override:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Edit-mode endpoints (student-driven). Free + Premium.
// ─────────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/learning-plan/:language/warmup
 * @desc    Premium pre-lesson warm-up card (Batch 9). Returns a 2-min
 *          mini-quiz tied to the student's nextLessonFocus when their next
 *          scheduled lesson is in the next 30 minutes.
 *
 *          Free students get { warmup: null } — they already see the
 *          previous-lesson notes elsewhere.
 *
 *          Response: { warmup: null | { lessonId, startsAt, focus, quiz } }
 * @access  Private (student)
 */
router.get('/:language/warmup', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!entitlements.isPremium(user)) {
      return res.json({ success: true, warmup: null, reason: 'free_tier' });
    }

    const Lesson = require('../models/Lesson');
    const now = new Date();
    const thirtyMinAhead = new Date(now.getTime() + 30 * 60 * 1000);

    const upcoming = await Lesson.findOne({
      studentId: user._id,
      subject: req.params.language,
      status: { $in: ['scheduled', 'confirmed'] },
      scheduledStartAt: { $gte: now, $lte: thirtyMinAhead }
    }).sort({ scheduledStartAt: 1 }).lean();

    if (!upcoming) {
      return res.json({ success: true, warmup: null, reason: 'no_upcoming_lesson' });
    }

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    }).select('nextLessonFocus chapterLevel currentPhaseIndex phases').lean();

    if (!plan?.nextLessonFocus) {
      return res.json({ success: true, warmup: null, reason: 'no_focus' });
    }

    // Pick the most-flagged struggle from the active phase as warmup target.
    // If we have nothing, skip — better no warmup than a generic one.
    const phase = plan.phases?.[plan.currentPhaseIndex];
    const struggle = (phase?.focusAreas?.[0] || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!struggle) {
      return res.json({ success: true, warmup: null, reason: 'no_struggle_signal' });
    }

    // Source a quiz from the pool (or generate fresh) — same pipeline as Batch 8
    // immediate push, just bypass the daily cap and persist as 'manual'.
    const quizService = require('../services/quizService');
    const r = await quizService.selectAndPushQuiz({
      userId: user._id,
      language: req.params.language,
      struggle,
      level: plan.chapterLevel || 'A1',
      trigger: 'manual',
      lessonContext: plan.nextLessonFocus
    });

    if (!r.pushed) {
      return res.json({ success: true, warmup: null, reason: r.reason || 'no_quiz' });
    }

    res.json({
      success: true,
      warmup: {
        lessonId: upcoming._id,
        startsAt: upcoming.scheduledStartAt,
        focus: plan.nextLessonFocus,
        quiz: r.quiz,
        personalizedHeader: r.personalizedHeader
      }
    });
  } catch (error) {
    console.error('Error fetching warmup:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/:language/chapters
 * @desc    List the student's completed chapters (read-only history).
 *          Used by the "Past maps" view (Batch 6). Returns just the
 *          chapter snapshots — phase content is included so we can render
 *          a mini-thumbnail map.
 * @access  Private (student)
 */
router.get('/:language/chapters', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    }).select('chaptersCompleted chapterIndex chapterLevel chapterTheme').lean();

    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    res.json({
      success: true,
      currentChapter: {
        index: plan.chapterIndex || 0,
        level: plan.chapterLevel || 'A1',
        theme: plan.chapterTheme || 'a1-desert'
      },
      completed: (plan.chaptersCompleted || []).map(c => ({
        index: c.index,
        level: c.level,
        theme: c.theme,
        completedAt: c.completedAt,
        masteryAtCompletion: c.masteryAtCompletion,
        exitReason: c.exitReason,
        phaseTitles: (c.phases || []).map(p => p.title || '')
      }))
    });
  } catch (error) {
    console.error('Error fetching chapter history:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/:language/history
 * @desc    Return the audit log (plan.history) for timeline rendering.
 *          Used by the "Plan history" view (Batch 6). Capped at the last
 *          200 entries to keep the response light.
 * @access  Private (student)
 */
router.get('/:language/history', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    }).select('history').lean();

    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const history = (plan.history || []).slice(-200).reverse();
    res.json({ success: true, history });
  } catch (error) {
    console.error('Error fetching plan history:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/intro-seen
 * @desc    Mark the "Your roadmap is ready" intro sheet as seen so it
 *          doesn't show again. Idempotent — first write wins.
 * @access  Private (student)
 */
router.post('/:language/intro-seen', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    if (!plan.journeyIntroSeenAt) {
      plan.journeyIntroSeenAt = new Date();
      await plan.save();
    }
    res.json({ success: true, journeyIntroSeenAt: plan.journeyIntroSeenAt });
  } catch (error) {
    console.error('Error marking intro seen:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/ack-transition
 * @desc    Acknowledge a pending chapter transition flag (graduation,
 *          demotion, promotion, mastery mode, decay warning, human
 *          intervention). Body: { flag: 'chapterJustCompleted' | ... }.
 *          Increments celebrationShownCount for chapter transitions and
 *          clears the flag once the student has acknowledged it (or after
 *          3 displays — G33).
 * @access  Private (student)
 */
router.post('/:language/ack-transition', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    });
    if (!plan) return res.status(404).json({ success: false, message: 'Plan not found' });

    const flag = req.body?.flag;
    const allowed = [
      'chapterJustCompleted', 'chapterDemotionPending', 'chapterPromotionPending',
      'masteryModeEntered', 'decayWarning', 'humanInterventionSuggested',
      'phaseSplit', 'recoveryStuck'
    ];
    if (!allowed.includes(flag)) {
      return res.status(400).json({ success: false, message: 'Invalid flag.' });
    }

    plan.pendingTransitions = plan.pendingTransitions || {};
    plan.pendingTransitions[flag] = false;
    // celebrationShownCount tracks chapter transitions specifically.
    if (['chapterJustCompleted', 'chapterDemotionPending', 'chapterPromotionPending'].includes(flag)) {
      plan.pendingTransitions.celebrationShownCount = 0;
    }
    await plan.save();

    res.json({ success: true, pendingTransitions: plan.pendingTransitions });
  } catch (error) {
    console.error('Error ack-transition:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/skip
 * @desc    Switch to "learn at your own pace" mode. If a plan already
 *          exists, it's converted to 'unframed' (chapter history preserved).
 *          If no plan exists, a thin unframed shell is created. Idempotent.
 * @access  Private (student)
 */
router.post('/:language/skip', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await learningPlanService.unframeExistingPlan(
      user._id,
      req.params.language
    );

    res.json({
      success: true,
      plan,
      entitlements: entitlements.describeForClient(user)
    });
  } catch (error) {
    console.error('Error switching plan to unframed:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/pause
 * @desc    Pause an active plan. Preserves all phase / chapter state.
 *          Idempotent: pausing a paused plan is a no-op.
 * @access  Private (student)
 */
router.post('/:language/pause', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await learningPlanService.pausePlan(user._id, req.params.language);
    res.json({
      success: true,
      plan,
      entitlements: entitlements.describeForClient(user)
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('Error pausing plan:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/resume
 * @desc    Resume a paused plan. Restores 'active' (or 'draft' if no
 *          lessons have happened yet).
 * @access  Private (student)
 */
router.post('/:language/resume', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await learningPlanService.resumePlan(user._id, req.params.language);
    res.json({
      success: true,
      plan,
      entitlements: entitlements.describeForClient(user)
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('Error resuming plan:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/promote
 * @desc    Promote an unframed plan to a structured plan with the supplied
 *          goal. Same payload shape as the goal-change route.
 * @access  Private (student)
 */
router.post('/:language/promote', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const newGoal = req.body?.goal;
    if (!newGoal?.type) {
      return res.status(400).json({ success: false, message: 'A goal type is required.' });
    }

    const plan = await learningPlanService.promoteUnframedPlan(
      user._id,
      req.params.language,
      newGoal
    );
    if (!plan) return res.status(404).json({ success: false, message: 'No plan to promote.' });

    res.json({
      success: true,
      plan,
      entitlements: entitlements.describeForClient(user)
    });
  } catch (error) {
    console.error('Error promoting unframed plan:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/soft-prompt/dismiss
 * @desc    Dismiss the "Want a plan?" soft prompt. Throttles re-firing
 *          for 30 days from the dismissal moment.
 * @access  Private (student)
 */
router.post('/:language/soft-prompt/dismiss', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await learningPlanService.dismissSoftPlanPrompt(user._id, req.params.language);
    res.json({ success: true });
  } catch (error) {
    console.error('Error dismissing soft prompt:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/:language/edit-permissions
 * @desc    What can this student do to their plan right now?
 *          Used by the journey edit UI to show/hide AI regen + counters.
 * @access  Private (student)
 */
router.get('/:language/edit-permissions', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const plan = await LearningPlan.findOne({
      studentId: user._id,
      language: req.params.language
    });

    const isPremium = entitlements.isPremium(user);
    const aiStatus = learningPlanService.getAiRegenerationStatus(plan);

    res.json({
      success: true,
      permissions: {
        canEditPhases: !!plan,
        canReorderLockedPhases: !!plan,
        canRegenWithAi: isPremium && !!plan && aiStatus.remaining > 0,
        isPremium,
        regen: aiStatus
      }
    });
  } catch (error) {
    console.error('Error reading edit-permissions:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   PUT /api/learning-plan/:language/phase/:phaseIndex
 * @desc    Edit a single phase (title / description / focusAreas / suggestedTopics).
 * @access  Private (student, plan owner only)
 */
router.put('/:language/phase/:phaseIndex', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const updates = {
      title: req.body?.title,
      description: req.body?.description,
      focusAreas: req.body?.focusAreas,
      suggestedTopics: req.body?.suggestedTopics
    };

    const plan = await learningPlanService.editPhase(
      user._id,
      req.params.language,
      req.params.phaseIndex,
      updates
    );
    res.json({ success: true, plan });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('Error editing phase:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/reorder-phases
 * @desc    Move one locked phase to a new position. Body: { fromIndex, toIndex }
 * @access  Private (student)
 */
router.post('/:language/reorder-phases', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { fromIndex, toIndex } = req.body || {};
    const plan = await learningPlanService.reorderLockedPhases(
      user._id,
      req.params.language,
      fromIndex,
      toIndex
    );
    res.json({ success: true, plan });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('Error reordering phases:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/regenerate-ai
 * @desc    Premium-only: ask the AI to rewrite the plan, with optional reason.
 *          Rate-limited to 2 per rolling 30-day window per plan.
 * @access  Private (student, premium)
 */
router.post('/:language/regenerate-ai', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const reason = (req.body?.reason || '').toString();
    const plan = await learningPlanService.regeneratePlanWithAi(
      user._id,
      req.params.language,
      reason
    );

    res.json({
      success: true,
      plan,
      regen: learningPlanService.getAiRegenerationStatus(plan)
    });
  } catch (error) {
    if (error.statusCode === 429) {
      return res.status(429).json({
        success: false,
        message: 'AI regeneration limit reached',
        nextRegenAvailableAt: error.nextRegenAvailableAt,
        regenLimit: error.regenLimit
      });
    }
    if (error.statusCode === 403 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('Error regenerating plan with AI:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/learning-plan/:language/mastery-weekly
 * @desc    Mastery Mode (Batch 13). Returns this week's micro-challenge
 *          if the student is in `mastery_mode`. If they're eligible for
 *          a fresh one and one hasn't been pushed in 7d, this triggers
 *          the push (idempotent — same result if called repeatedly).
 *          Returns 200 with `{ challenge: null, reason }` for non-eligible
 *          plans (e.g. not in mastery mode) so the UI can render an
 *          empty state cleanly.
 * @access  Private (student, premium)
 */
router.get('/:language/mastery-weekly', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const quizService = require('../services/quizService');
    const Quiz = require('../models/Quiz');
    const UserQuizHistory = require('../models/UserQuizHistory');

    // Trigger push if eligible (idempotent — does nothing if already
    // pushed within the 7d window).
    const pushResult = await quizService.maybePushMasteryWeekly({
      userId: user._id,
      language: req.params.language
    });

    // Whether or not we just pushed, return the latest mastery challenge
    // entry for this user/language.
    const history = await UserQuizHistory.findOne({ userId: user._id });
    const latest = (history?.seen || [])
      .filter(s => s.trigger === 'mastery_mode_weekly' && s.language === req.params.language)
      .sort((a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime())[0];

    if (!latest) {
      return res.json({
        success: true,
        challenge: null,
        reason: pushResult.reason || 'no_challenge',
        nextEligibleAt: pushResult.nextEligibleAt || null
      });
    }

    const quiz = await Quiz.findById(latest.quizId).lean();
    return res.json({
      success: true,
      challenge: {
        quizId: latest.quizId,
        theme: latest.theme,
        pushedAt: latest.pushedAt,
        startedAt: latest.startedAt,
        completedAt: latest.completedAt,
        rating: latest.rating,
        personalizedHeader: latest.personalizedHeader,
        quiz
      },
      // When the NEXT challenge becomes available (7d after this push).
      nextEligibleAt: new Date(new Date(latest.pushedAt).getTime() + 7 * 24 * 60 * 60 * 1000)
    });
  } catch (error) {
    console.error('Error fetching mastery weekly:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/chat
 * @desc    Premium-only conversational plan editing (Batch 12). Sends a
 *          chat history; returns AI reply + optional structured proposed
 *          edits for the current chapter. Does NOT mutate the plan.
 *          Body: { messages: [{ role: 'user'|'assistant', content }] }
 * @access  Private (student, premium)
 */
router.post('/:language/chat', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const result = await learningPlanService.proposePlanEdits(
      user._id,
      req.params.language,
      messages
    );
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 403 || error.statusCode === 404 || error.statusCode === 502) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('Error in plan chat:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/learning-plan/:language/chat/apply
 * @desc    Premium-only. Apply edits previously proposed via /chat.
 *          Consumes one AI regeneration credit (2/30-day budget).
 *          Body: { phases: [<phase>], summary?: string }
 * @access  Private (student, premium)
 */
router.post('/:language/chat/apply', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const phases = Array.isArray(req.body?.phases) ? req.body.phases : [];
    const summary = (req.body?.summary || '').toString();
    const { plan, regen } = await learningPlanService.applyProposedEdits(
      user._id,
      req.params.language,
      phases,
      summary
    );
    res.json({ success: true, plan, regen });
  } catch (error) {
    if (error.statusCode === 429) {
      return res.status(429).json({
        success: false,
        message: 'AI regeneration limit reached',
        nextRegenAvailableAt: error.nextRegenAvailableAt,
        regenLimit: error.regenLimit
      });
    }
    if (error.statusCode === 400 || error.statusCode === 403 || error.statusCode === 404) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error('Error applying chat edits:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
