const OpenAI = require('openai');
const LearningPlan = require('../models/LearningPlan');
const LessonAnalysis = require('../models/LessonAnalysis');
const User = require('../models/User');

let openai = null;

function getOpenAIClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key is required.');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

const GOAL_TYPE_LABELS = {
  conversational: 'Become conversational',
  exam_prep: 'Prepare for an exam',
  professional: 'Use it for work',
  travel: 'Travel and get by',
  relocation: 'Moving to a new country',
  other: 'Custom goal'
};

const LEVEL_LABELS = {
  complete_beginner: 'Complete beginner',
  some_basics: 'Knows some basics',
  simple_conversations: 'Can hold simple conversations',
  intermediate: 'Intermediate, wants to improve',
  advanced: 'Advanced, refining skills'
};

const LEVEL_TO_CEFR = {
  complete_beginner: 'A1',
  some_basics: 'A1-A2',
  simple_conversations: 'A2-B1',
  intermediate: 'B1-B2',
  advanced: 'B2-C1'
};

function buildAnalysisContext(analysis) {
  if (!analysis) return 'No lesson data available yet.';

  const parts = [];
  if (analysis.overallAssessment?.proficiencyLevel) {
    parts.push(`CEFR level: ${analysis.overallAssessment.proficiencyLevel}`);
  }
  if (analysis.overallAssessment?.summary) {
    parts.push(`Summary: ${analysis.overallAssessment.summary}`);
  }
  if (analysis.grammarAnalysis?.accuracyScore) {
    parts.push(`Grammar accuracy: ${analysis.grammarAnalysis.accuracyScore}%`);
  }
  if (analysis.fluencyAnalysis?.overallFluencyScore) {
    parts.push(`Fluency score: ${analysis.fluencyAnalysis.overallFluencyScore}%`);
  }
  if (analysis.vocabularyAnalysis?.vocabularyRange) {
    parts.push(`Vocabulary range: ${analysis.vocabularyAnalysis.vocabularyRange}`);
  }
  if (analysis.progressionMetrics?.persistentChallenges?.length) {
    parts.push(`Persistent challenges: ${analysis.progressionMetrics.persistentChallenges.join(', ')}`);
  }
  if (analysis.progressionMetrics?.keyImprovements?.length) {
    parts.push(`Key improvements: ${analysis.progressionMetrics.keyImprovements.join(', ')}`);
  }
  if (analysis.topicsDiscussed?.length) {
    parts.push(`Topics discussed: ${analysis.topicsDiscussed.join(', ')}`);
  }
  if (analysis.homeworkSuggestions?.length) {
    parts.push(`Homework suggestions: ${analysis.homeworkSuggestions.join(', ')}`);
  }
  return parts.join('\n');
}

function compactPlanForPrompt(plan) {
  return {
    goal: `${GOAL_TYPE_LABELS[plan.goal?.type] || plan.goal?.type}${plan.goal?.description ? ': ' + plan.goal.description : ''}`,
    targetLevel: plan.goal?.targetLevel || 'not specified',
    timeline: plan.goal?.timelinePressure || 'no_rush',
    currentPhase: plan.currentPhaseIndex,
    phases: plan.phases.map((p, i) => ({
      index: i,
      title: p.title,
      status: p.status,
      lessonsCompleted: p.lessonsCompleted,
      estimatedLessons: p.estimatedLessons,
      focusAreas: p.focusAreas
    })),
    recentOverrides: (plan.tutorOverrides || []).slice(-3).map(o => ({
      action: o.action,
      note: o.note,
      tutorName: o.tutorName
    }))
  };
}

/**
 * Generate the initial learning plan after a trial/first lesson.
 */
async function generateInitialPlan(studentId, language) {
  console.log(`📋 [LearningPlan] Generating initial plan for student ${studentId}, language: ${language}`);

  const user = await User.findById(studentId);
  if (!user?.onboardingData?.learningGoal?.type) {
    console.log('⚠️ [LearningPlan] No learning goal set — skipping plan generation');
    return null;
  }

  const goal = user.onboardingData.learningGoal;
  const selfLevel = goal.selfAssessedLevel || 'some_basics';
  const estimatedCefr = LEVEL_TO_CEFR[selfLevel] || 'A2';

  const latestAnalysis = await LessonAnalysis.findOne({
    studentId: studentId.toString(),
    language,
    status: 'completed'
  }).sort({ lessonDate: -1 }).lean();

  const analysisContext = buildAnalysisContext(latestAnalysis);
  const actualCefr = latestAnalysis?.overallAssessment?.proficiencyLevel || estimatedCefr;

  const prompt = `You are an expert language teacher creating a personalized learning plan.

STUDENT PROFILE:
- Learning: ${language}
- Native language: ${user.nativeLanguage || 'unknown'}
- Goal: ${GOAL_TYPE_LABELS[goal.type] || goal.type}${goal.description ? ' — ' + goal.description : ''}
- Self-assessed level: ${LEVEL_LABELS[selfLevel] || selfLevel}
- AI-assessed CEFR: ${actualCefr}
- Target level: ${goal.targetLevel || 'not specified'}
- Timeline: ${goal.timeline || 'no rush'}

LATEST LESSON DATA:
${analysisContext}

Create a structured learning plan with 3-5 phases. Each phase should be achievable in roughly 5 lessons. The plan should be specific to ${language}, not generic.

IMPORTANT:
- The first phase should be "active" status, all others "locked"
- exitCriteria should be qualitative and encouraging, not percentage-based
- suggestedTopics should be conversation scenarios the student would actually enjoy
- focusAreas should target specific ${language} grammar/vocabulary areas
- studentSummary should be warm, encouraging, second-person ("You're...")
- nextLessonFocus should be specific and actionable for the tutor

Respond ONLY with valid JSON:
{
  "phases": [
    {
      "title": "string",
      "description": "string — warm, encouraging description",
      "focusAreas": ["string"],
      "suggestedTopics": ["string — real conversation scenarios"],
      "exitCriteria": "string — qualitative milestone",
      "estimatedLessons": 5,
      "status": "active | locked"
    }
  ],
  "weeklyRecommendations": {
    "lessonFrequency": "string (e.g. '2x per week')",
    "selfStudyMinutes": 15,
    "focusBetweenLessons": "string — specific practice advice"
  },
  "studentSummary": "string — warm, personal summary of where they are and what's ahead",
  "nextLessonFocus": "string — specific focus for the upcoming lesson"
}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert language teacher who creates personalized, encouraging learning plans. Always respond with valid JSON only. Be specific to the target language, not generic.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(completion.choices[0].message.content);
  console.log(`✅ [LearningPlan] AI generated ${result.phases?.length || 0} phases`);

  const plan = await LearningPlan.findOneAndUpdate(
    { studentId, language },
    {
      studentId,
      language,
      goal: {
        type: goal.type,
        description: goal.description || '',
        targetLevel: goal.targetLevel || '',
        timeline: goal.timeline || 'no_rush',
        timelinePressure: goal.timeline || 'no_rush',
        targetDate: goal.targetDate || null
      },
      selfAssessedLevel: selfLevel,
      currentPhaseIndex: 0,
      phases: (result.phases || []).map((p, i) => ({
        title: p.title,
        description: p.description || '',
        focusAreas: p.focusAreas || [],
        suggestedTopics: p.suggestedTopics || [],
        exitCriteria: p.exitCriteria || '',
        estimatedLessons: p.estimatedLessons || 5,
        lessonsCompleted: 0,
        status: i === 0 ? 'active' : 'locked'
      })),
      weeklyRecommendations: result.weeklyRecommendations || {},
      studentSummary: result.studentSummary || '',
      nextLessonFocus: result.nextLessonFocus || '',
      lastUpdatedAt: new Date(),
      lastGoalChangedAt: new Date(),
      status: 'active',
      history: [{
        date: new Date(),
        changeDescription: 'Initial learning plan created',
        phaseIndexBefore: null,
        phaseIndexAfter: 0
      }]
    },
    { upsert: true, new: true, runValidators: true }
  );

  console.log(`✅ [LearningPlan] Plan saved: ${plan._id}`);
  return plan;
}

/**
 * Update the plan after a lesson analysis completes.
 */
async function updatePlanAfterLesson(planId, lessonAnalysis) {
  const plan = await LearningPlan.findById(planId);
  if (!plan || plan.status !== 'active') return null;

  console.log(`📋 [LearningPlan] Updating plan ${planId} after lesson analysis`);

  const compactPlan = compactPlanForPrompt(plan);
  const analysisContext = buildAnalysisContext(lessonAnalysis);

  const prompt = `You are updating a student's learning plan after their latest lesson.

CURRENT PLAN:
${JSON.stringify(compactPlan, null, 2)}

LATEST LESSON ANALYSIS:
${analysisContext}

Based on the lesson data, update the plan:
1. Should the current phase advance? (Only if exit criteria are met)
2. Update lessonsCompleted for the current phase (+1)
3. Refresh the studentSummary with warm, encouraging language referencing this lesson
4. Set a specific nextLessonFocus based on what the student needs
5. If a tutor override requested extending/advancing, respect that

IMPORTANT:
- studentSummary should be warm, second-person ("You're making great progress...")
- nextLessonFocus should be specific and actionable
- Only advance phases when exit criteria are clearly met
- If advancing, set new phase to "active" and old to "completed"

Respond ONLY with valid JSON:
{
  "shouldAdvancePhase": false,
  "currentPhaseLessonsCompleted": 3,
  "studentSummary": "string — warm update",
  "nextLessonFocus": "string — specific focus",
  "weeklyRecommendations": {
    "focusBetweenLessons": "string — updated practice advice"
  },
  "planAdjustmentNote": "string — brief note about what changed, or empty"
}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert language teacher updating a student learning plan. Always respond with valid JSON only. Be encouraging and specific.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 800,
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(completion.choices[0].message.content);

  const prevPhaseIndex = plan.currentPhaseIndex;
  const currentPhase = plan.phases[plan.currentPhaseIndex];

  if (currentPhase) {
    currentPhase.lessonsCompleted = result.currentPhaseLessonsCompleted || (currentPhase.lessonsCompleted + 1);
  }

  if (result.shouldAdvancePhase && plan.currentPhaseIndex < plan.phases.length - 1) {
    if (currentPhase) {
      currentPhase.status = 'completed';
      currentPhase.completedAt = new Date();
    }
    plan.currentPhaseIndex += 1;
    const nextPhase = plan.phases[plan.currentPhaseIndex];
    if (nextPhase) {
      nextPhase.status = 'active';
    }
  }

  const allPhasesCompleted = plan.phases.every(p => p.status === 'completed');
  if (allPhasesCompleted) {
    plan.status = 'completed';
  }

  plan.studentSummary = result.studentSummary || plan.studentSummary;
  plan.nextLessonFocus = result.nextLessonFocus || plan.nextLessonFocus;
  if (result.weeklyRecommendations?.focusBetweenLessons) {
    plan.weeklyRecommendations.focusBetweenLessons = result.weeklyRecommendations.focusBetweenLessons;
  }
  plan.lastUpdatedAt = new Date();
  plan.lastUpdatedFromLessonId = lessonAnalysis.lessonId || null;

  plan.history.push({
    date: new Date(),
    lessonId: lessonAnalysis.lessonId || null,
    changeDescription: result.planAdjustmentNote || (result.shouldAdvancePhase ? `Advanced to Phase ${plan.currentPhaseIndex + 1}` : 'Plan updated after lesson'),
    phaseIndexBefore: prevPhaseIndex,
    phaseIndexAfter: plan.currentPhaseIndex
  });

  await plan.save();
  console.log(`✅ [LearningPlan] Plan updated. Phase: ${plan.currentPhaseIndex + 1}/${plan.phases.length}, advanced: ${result.shouldAdvancePhase}`);
  return plan;
}

/**
 * Regenerate plan when student changes their goal.
 * Enforces 7-day cooldown.
 */
async function regeneratePlan(studentId, language, newGoal) {
  const existing = await LearningPlan.findOne({ studentId, language });

  if (existing?.lastGoalChangedAt) {
    const daysSinceChange = (Date.now() - existing.lastGoalChangedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceChange < 7) {
      const nextAvailable = new Date(existing.lastGoalChangedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const error = new Error('Goal change cooldown active');
      error.statusCode = 429;
      error.nextChangeAvailableAt = nextAvailable;
      throw error;
    }
  }

  const user = await User.findById(studentId);
  if (user) {
    user.onboardingData = user.onboardingData || {};
    user.onboardingData.learningGoal = {
      type: newGoal.type,
      description: newGoal.description || '',
      targetLevel: newGoal.targetLevel || '',
      selfAssessedLevel: newGoal.selfAssessedLevel || user.onboardingData.learningGoal?.selfAssessedLevel || 'some_basics',
      timeline: newGoal.timeline || 'no_rush',
      targetDate: newGoal.targetDate || null
    };
    await user.save();
  }

  if (existing) {
    existing.history.push({
      date: new Date(),
      changeDescription: `Goal changed to: ${GOAL_TYPE_LABELS[newGoal.type] || newGoal.type}`,
      phaseIndexBefore: existing.currentPhaseIndex,
      phaseIndexAfter: null
    });
    await existing.save();
    await LearningPlan.deleteOne({ _id: existing._id });
  }

  return await generateInitialPlan(studentId, language);
}

module.exports = {
  generateInitialPlan,
  updatePlanAfterLesson,
  regeneratePlan,
  GOAL_TYPE_LABELS,
  LEVEL_LABELS
};
