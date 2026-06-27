/**
 * Chapter generation service.
 *
 * Two paths:
 *   - Free   → deterministic template per CEFR level, goal-flavored phase content.
 *   - Premium → AI generation that tunes phases to the student's struggles
 *               and trajectory in the chapter they just completed.
 *
 * Both paths return 4 phases ready to assign to plan.phases.
 *
 * Premium AI failure → silent fallback to template (G7).
 *
 * Used by learningPlanService._completeChapterAndGenerateNext and
 * _demoteOneChapter.
 */

const OpenAI = require('openai');
const entitlements = require('./entitlementsService');

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

// ─────────────────────────────────────────────────────────────────────
// Templates (free path, deterministic)
// ─────────────────────────────────────────────────────────────────────

// Per-CEFR-level skeleton phases. Each phase template is goal-flavored
// at runtime (we slot the student's goal into focusAreas + suggestedTopics).
//
// Phase order within a chapter is intentional: foundation → practice →
// real-world application → consolidation. This mirrors the existing
// structure new plans are seeded with.
const CHAPTER_TEMPLATES = {
  A1: {
    title: 'Beginner Foundations',
    phases: [
      {
        title: 'Greetings, numbers, and basic verbs',
        description: 'Learn to introduce yourself, count, and express simple needs.',
        focusAreas: ['greetings', 'numbers 1-100', 'basic verbs (be, have, do)'],
        exitCriteria: 'Can introduce yourself and ask basic questions.',
        estimatedLessons: 5
      },
      {
        title: 'Daily life vocabulary',
        description: 'Vocabulary for food, family, daily routine, and time.',
        focusAreas: ['daily routine', 'food and drink', 'family members'],
        exitCriteria: 'Can describe your day in 4-5 sentences.',
        estimatedLessons: 5
      },
      {
        title: 'Simple conversations',
        description: 'Hold short exchanges in shops, cafés, and on the street.',
        focusAreas: ['ordering', 'directions', 'asking questions'],
        exitCriteria: 'Can complete a basic transaction.',
        estimatedLessons: 5
      },
      {
        title: 'Personal stories',
        description: 'Talk about yourself in past, present, and future.',
        focusAreas: ['simple past', 'simple future', 'connecting words'],
        exitCriteria: 'Can tell a 1-minute story about your week.',
        estimatedLessons: 5
      }
    ]
  },
  A2: {
    title: 'Elementary Expansion',
    phases: [
      {
        title: 'Past tense fluency',
        description: 'Speak comfortably about past events and experiences.',
        focusAreas: ['past tense', 'time expressions', 'sequencing'],
        exitCriteria: 'Tell a 2-minute story about a past event.',
        estimatedLessons: 5
      },
      {
        title: 'Future plans and intentions',
        description: 'Talk about plans, goals, and predictions.',
        focusAreas: ['future tense', 'modal verbs', 'plans vs intentions'],
        exitCriteria: 'Describe your plans for next month with detail.',
        estimatedLessons: 5
      },
      {
        title: 'Opinions and preferences',
        description: 'Express likes, dislikes, and reasoning behind preferences.',
        focusAreas: ['opinion phrases', 'comparatives', 'reason connectors'],
        exitCriteria: 'Compare two options and explain your choice.',
        estimatedLessons: 5
      },
      {
        title: 'Real-world A2',
        description: 'Apply A2 skills in travel, work, and social contexts.',
        focusAreas: ['situational dialogues', 'cultural notes', 'small talk'],
        exitCriteria: 'Hold a 5-minute conversation on a familiar topic.',
        estimatedLessons: 5
      }
    ]
  },
  B1: {
    title: 'Intermediate Confidence',
    phases: [
      {
        title: 'Complex past structures',
        description: 'Master past perfect, conditionals, and reported speech.',
        focusAreas: ['past perfect', 'reported speech', 'time clauses'],
        exitCriteria: 'Recount a complex story with multiple time references.',
        estimatedLessons: 5
      },
      {
        title: 'Conditionals and hypotheticals',
        description: 'Talk about hypothetical situations and "what if" scenarios.',
        focusAreas: ['1st/2nd conditional', 'hypothetical phrases', 'wish'],
        exitCriteria: 'Discuss "what if" in a 3-minute conversation.',
        estimatedLessons: 5
      },
      {
        title: 'Abstract topics',
        description: 'Discuss feelings, society, and personal beliefs.',
        focusAreas: ['abstract nouns', 'opinion essays', 'agreeing/disagreeing'],
        exitCriteria: 'Defend an opinion with 3+ supporting reasons.',
        estimatedLessons: 5
      },
      {
        title: 'B1 application',
        description: 'Use B1 skills in professional or academic contexts.',
        focusAreas: ['workplace vocab', 'meeting phrases', 'presentation language'],
        exitCriteria: 'Give a 3-minute presentation on a familiar topic.',
        estimatedLessons: 5
      }
    ]
  },
  B2: {
    title: 'Upper-Intermediate Fluency',
    phases: [
      {
        title: 'Nuance and idioms',
        description: 'Add idioms and natural expressions to your speech.',
        focusAreas: ['common idioms', 'collocations', 'register awareness'],
        exitCriteria: 'Use 5+ idioms naturally in conversation.',
        estimatedLessons: 5
      },
      {
        title: 'Argumentation',
        description: 'Construct and defend arguments with sophistication.',
        focusAreas: ['advanced connectors', 'concession', 'rebuttal phrases'],
        exitCriteria: 'Hold a 5-minute debate on a current event.',
        estimatedLessons: 5
      },
      {
        title: 'Cultural depth',
        description: 'Engage with culture, media, and humor.',
        focusAreas: ['cultural references', 'humor', 'media literacy'],
        exitCriteria: 'Discuss a film, book, or news article with confidence.',
        estimatedLessons: 5
      },
      {
        title: 'B2 polish',
        description: 'Refine accuracy and flow across all contexts.',
        focusAreas: ['error correction', 'fluency drills', 'speed and rhythm'],
        exitCriteria: 'Speak for 5 minutes with minimal hesitation.',
        estimatedLessons: 5
      }
    ]
  },
  C1: {
    title: 'Advanced Mastery',
    phases: [
      {
        title: 'Sophisticated structures',
        description: 'Master complex grammar and rhetorical devices.',
        focusAreas: ['inversion', 'cleft sentences', 'subjunctive'],
        exitCriteria: 'Use C1-level structures appropriately in formal contexts.',
        estimatedLessons: 5
      },
      {
        title: 'Specialized vocabulary',
        description: 'Build expertise in your professional or academic field.',
        focusAreas: ['domain-specific vocab', 'jargon', 'technical phrasing'],
        exitCriteria: 'Discuss your field with a native speaker.',
        estimatedLessons: 5
      },
      {
        title: 'Persuasion and rhetoric',
        description: 'Persuade, negotiate, and lead conversations.',
        focusAreas: ['persuasive language', 'negotiation phrases', 'leadership tone'],
        exitCriteria: 'Lead a 10-minute meeting or discussion.',
        estimatedLessons: 5
      },
      {
        title: 'C1 consolidation',
        description: 'Lock in fluency and prepare for near-native expression.',
        focusAreas: ['register switching', 'subtle nuances', 'cultural fluency'],
        exitCriteria: 'Switch register seamlessly between formal and casual.',
        estimatedLessons: 5
      }
    ]
  },
  C2: {
    title: 'Near-Native Expression',
    phases: [
      {
        title: 'Stylistic precision',
        description: 'Choose the perfect word for every context.',
        focusAreas: ['lexical precision', 'stylistic variation', 'literary devices'],
        exitCriteria: 'Edit your own writing for style and tone.',
        estimatedLessons: 5
      },
      {
        title: 'Cultural mastery',
        description: 'Engage with literature, history, and current affairs at depth.',
        focusAreas: ['cultural commentary', 'historical context', 'literary analysis'],
        exitCriteria: 'Analyze a piece of literature or a complex article.',
        estimatedLessons: 5
      },
      {
        title: 'Expert communication',
        description: 'Communicate with the precision of a near-native speaker.',
        focusAreas: ['academic writing', 'public speaking', 'professional negotiation'],
        exitCriteria: 'Deliver a polished 15-minute presentation.',
        estimatedLessons: 5
      },
      {
        title: 'C2 mastery',
        description: 'Final polish — you are now a C2 speaker.',
        focusAreas: ['nuance refinement', 'creative expression', 'mastery maintenance'],
        exitCriteria: 'Indistinguishable from a fluent speaker in most contexts.',
        estimatedLessons: 5
      }
    ]
  }
};

/**
 * Goal-flavored chapter overrides. The pedagogical *spine* at each level
 * is the same across goals (e.g. A1 = foundation → practice → application
 * → consolidation; B1 = complex past → conditionals → abstract topics →
 * application). What changes per goal is the **scenario surface**:
 *   - Phase titles describe the scenario the student practices in.
 *   - focusAreas keep the level's skill targets and add scenario-flavored
 *     vocab so the chip row reads true to the goal.
 *   - exitCriteria phrase the milestone in goal-appropriate terms
 *     (a Travel B1 student doesn't get "give a workplace presentation").
 *
 * Premium students get fully AI-generated phases once they complete
 * their first chapter — see `generateChapterWithAi`. These templates
 * power the free tier and the on-AI-failure fallback for premium.
 *
 * Shape mirrors `CHAPTER_TEMPLATES[level].phases`. When a goal isn't in
 * a level's map (or the goal is "other"), we fall back to the base
 * template via `_getTemplatePhases`.
 */
const CHAPTER_TEMPLATES_BY_GOAL = {
  A1: {
    professional: [
      {
        title: 'Greetings at work',
        description: 'Introduce yourself, your role, and exchange basic pleasantries with colleagues.',
        focusAreas: ['introducing your role', 'workplace greetings', 'common office vocabulary'],
        exitCriteria: 'Can introduce yourself and your role in 4-5 sentences.',
        estimatedLessons: 5
      },
      {
        title: 'Daily work vocabulary',
        description: 'Vocabulary for office life, tools, meetings, and time at work.',
        focusAreas: ['office items', 'work schedule', 'days and times'],
        exitCriteria: 'Can describe your typical workday in 4-5 sentences.',
        estimatedLessons: 5
      },
      {
        title: 'Workplace exchanges',
        description: 'Handle short, common interactions with colleagues and clients.',
        focusAreas: ['asking for help', 'small requests', 'short emails and chats'],
        exitCriteria: 'Can ask a colleague for help and respond politely.',
        estimatedLessons: 5
      },
      {
        title: 'Scheduling and updates',
        description: 'Talk about what you did, what you\'re working on, and what\'s next.',
        focusAreas: ['simple past at work', 'plans for the week', 'connecting words'],
        exitCriteria: 'Can give a 1-minute status update on a project.',
        estimatedLessons: 5
      }
    ],
    travel: [
      {
        title: 'Travel greetings and survival',
        description: 'Get by with greetings, polite phrases, and asking for basics.',
        focusAreas: ['polite greetings', 'numbers and prices', 'please / thank you / excuse me'],
        exitCriteria: 'Can greet, ask for prices, and say thanks confidently.',
        estimatedLessons: 5
      },
      {
        title: 'Getting around',
        description: 'Vocabulary for transport, directions, and accommodation.',
        focusAreas: ['transport vocabulary', 'asking for directions', 'check-in phrases'],
        exitCriteria: 'Can find your hotel and ask for directions to a landmark.',
        estimatedLessons: 5
      },
      {
        title: 'Cafés, shops, and restaurants',
        description: 'Handle the everyday transactions a traveler runs into.',
        focusAreas: ['ordering food and drink', 'asking what something is', 'paying'],
        exitCriteria: 'Can order a meal and pay without switching languages.',
        estimatedLessons: 5
      },
      {
        title: 'Stories from the road',
        description: 'Talk about where you\'ve been, where you\'re going, and what you saw.',
        focusAreas: ['simple past', 'simple future', 'connecting words'],
        exitCriteria: 'Can recap a day of your trip in 4-5 sentences.',
        estimatedLessons: 5
      }
    ],
    exam_prep: [
      {
        title: 'Exam-style introductions',
        description: 'Master the personal-info opener every entry-level exam uses.',
        focusAreas: ['self-introduction', 'family and home', 'numbers and dates'],
        exitCriteria: 'Can answer a 1-minute "tell me about yourself" prompt.',
        estimatedLessons: 5
      },
      {
        title: 'Daily life under exam pressure',
        description: 'Build the descriptive vocabulary exam tasks lean on most.',
        focusAreas: ['daily routine', 'home and food', 'time expressions'],
        exitCriteria: 'Can describe a typical day to an examiner clearly.',
        estimatedLessons: 5
      },
      {
        title: 'Short exchanges for role-plays',
        description: 'Practice the question-answer rhythm exam role-plays expect.',
        focusAreas: ['question formation', 'ordering and directions', 'short replies'],
        exitCriteria: 'Can complete a 2-minute scripted role-play.',
        estimatedLessons: 5
      },
      {
        title: 'Past, present, future — for the exam',
        description: 'Tie tenses together so timed prompts feel familiar.',
        focusAreas: ['simple past', 'simple future', 'sequencing words'],
        exitCriteria: 'Can tell a 1-minute story across three time frames.',
        estimatedLessons: 5
      }
    ],
    relocation: [
      {
        title: 'Settling-in basics',
        description: 'The greetings, intros, and "I\'m new here" phrases for daily life.',
        focusAreas: ['greetings and introductions', 'asking for repetition', 'numbers and prices'],
        exitCriteria: 'Can introduce yourself to a neighbor or shopkeeper.',
        estimatedLessons: 5
      },
      {
        title: 'Home and neighborhood vocabulary',
        description: 'Vocabulary for your home, the shops nearby, and the people you meet.',
        focusAreas: ['home and rooms', 'shops and services', 'people and family'],
        exitCriteria: 'Can describe your neighborhood in 4-5 sentences.',
        estimatedLessons: 5
      },
      {
        title: 'Errands and admin',
        description: 'Handle the small transactions that fill a week — groceries, mail, appointments.',
        focusAreas: ['shopping basics', 'making appointments', 'asking for help'],
        exitCriteria: 'Can buy groceries and book a simple appointment.',
        estimatedLessons: 5
      },
      {
        title: 'Your story so far',
        description: 'Talk about where you\'re from, what brought you here, and what\'s next.',
        focusAreas: ['simple past', 'simple future', 'reasons and plans'],
        exitCriteria: 'Can explain why you moved in 4-5 sentences.',
        estimatedLessons: 5
      }
    ],
    conversational: [
      {
        title: 'First conversations',
        description: 'Greet people, introduce yourself, and exchange basic info.',
        focusAreas: ['greetings', 'introductions', 'numbers 1-100'],
        exitCriteria: 'Can hold a 1-minute introductory conversation.',
        estimatedLessons: 5
      },
      {
        title: 'Everyday vocabulary',
        description: 'Vocabulary for daily life, food, family, and time.',
        focusAreas: ['daily routine', 'food and drink', 'family members'],
        exitCriteria: 'Can describe your day to a new friend.',
        estimatedLessons: 5
      },
      {
        title: 'Casual exchanges',
        description: 'Short, friendly conversations in cafés, shops, and on the street.',
        focusAreas: ['ordering', 'small talk', 'asking questions'],
        exitCriteria: 'Can chat casually with a stranger for 2 minutes.',
        estimatedLessons: 5
      },
      {
        title: 'Telling your story',
        description: 'Talk about your past, present, and what you\'re looking forward to.',
        focusAreas: ['simple past', 'simple future', 'connecting words'],
        exitCriteria: 'Can tell a 1-minute story about your week.',
        estimatedLessons: 5
      }
    ]
  },

  // A2 — Elementary Expansion. Spine: past tense → future plans →
  // opinions/preferences → real-world application.
  A2: {
    conversational: [
      {
        title: 'Past tense in stories',
        description: 'Speak comfortably about recent events with friends.',
        focusAreas: ['past tense', 'time expressions', 'sequencing'],
        exitCriteria: 'Tell a 2-minute story about your weekend.',
        estimatedLessons: 5
      },
      {
        title: 'Plans with friends',
        description: 'Talk about social plans, intentions, and predictions.',
        focusAreas: ['future tense', 'modal verbs', 'plans vs intentions'],
        exitCriteria: 'Describe your plans for next month socially.',
        estimatedLessons: 5
      },
      {
        title: 'Opinions on everyday topics',
        description: 'Compare options and explain everyday preferences.',
        focusAreas: ['opinion phrases', 'comparatives', 'reason connectors'],
        exitCriteria: 'Compare two restaurants or movies and pick one.',
        estimatedLessons: 5
      },
      {
        title: 'Real conversations',
        description: 'Apply A2 skills in everyday social settings.',
        focusAreas: ['situational dialogues', 'small talk', 'casual register'],
        exitCriteria: 'Hold a 5-minute conversation about your hobbies.',
        estimatedLessons: 5
      }
    ],
    professional: [
      {
        title: 'Past tense at work',
        description: 'Recap recent work events and project history.',
        focusAreas: ['past tense in updates', 'sequencing', 'time expressions'],
        exitCriteria: 'Recap a recent project in 2 minutes.',
        estimatedLessons: 5
      },
      {
        title: 'Plans at work',
        description: 'Talk about workplace plans, intentions, and next steps.',
        focusAreas: ['future tense', 'modal verbs (need to, should)', 'plans vs intentions'],
        exitCriteria: 'Outline a workplace plan for next month.',
        estimatedLessons: 5
      },
      {
        title: 'Opinions in meetings',
        description: 'Compare options and recommend one in a workplace setting.',
        focusAreas: ['opinion phrases', 'comparatives', 'reason connectors'],
        exitCriteria: 'Compare two proposals and recommend one.',
        estimatedLessons: 5
      },
      {
        title: 'Real workplace conversations',
        description: 'Apply A2 skills in everyday work contexts.',
        focusAreas: ['workplace small talk', 'polite register', 'project updates'],
        exitCriteria: 'Hold a 5-minute workplace conversation about a current task.',
        estimatedLessons: 5
      }
    ],
    travel: [
      {
        title: 'Past tense travel stories',
        description: 'Speak comfortably about past trips and experiences.',
        focusAreas: ['past tense', 'time expressions', 'sequencing'],
        exitCriteria: 'Tell a 2-minute story about a recent trip.',
        estimatedLessons: 5
      },
      {
        title: 'Future travel plans',
        description: 'Talk about itineraries, intentions, and predictions.',
        focusAreas: ['future tense', 'modal verbs', 'plans vs intentions'],
        exitCriteria: 'Describe your next trip in detail.',
        estimatedLessons: 5
      },
      {
        title: 'Opinions about places',
        description: 'Compare destinations and explain travel preferences.',
        focusAreas: ['opinion phrases', 'comparatives', 'reason connectors'],
        exitCriteria: 'Compare two cities or hotels and pick one.',
        estimatedLessons: 5
      },
      {
        title: 'Conversations with locals',
        description: 'Apply A2 skills with hosts, guides, and locals.',
        focusAreas: ['travel dialogues', 'small talk with locals', 'cultural notes'],
        exitCriteria: 'Hold a 5-minute conversation with a local about your trip.',
        estimatedLessons: 5
      }
    ],
    exam_prep: [
      {
        title: 'Narrating past events',
        description: 'Build the past-tense fluency exam role-plays expect.',
        focusAreas: ['past tense', 'time expressions', 'sequencing'],
        exitCriteria: 'Tell a 2-minute exam-style past-event story.',
        estimatedLessons: 5
      },
      {
        title: 'Future plans on the exam',
        description: 'Talk about upcoming plans under exam conditions.',
        focusAreas: ['future tense', 'modal verbs', 'plans vs intentions'],
        exitCriteria: 'Describe plans for next month for the examiner.',
        estimatedLessons: 5
      },
      {
        title: 'Comparing options for role-plays',
        description: 'Justify a choice between two options to an examiner.',
        focusAreas: ['opinion phrases', 'comparatives', 'reason connectors'],
        exitCriteria: 'Compare two options and justify your choice.',
        estimatedLessons: 5
      },
      {
        title: 'Mock-exam conversations',
        description: 'Apply A2 skills in full exam-style role-plays.',
        focusAreas: ['situational dialogues', 'exam phrasing', 'register'],
        exitCriteria: 'Complete a 5-minute mock exam interview.',
        estimatedLessons: 5
      }
    ],
    relocation: [
      {
        title: 'The story of your move',
        description: 'Speak comfortably about your move and life before.',
        focusAreas: ['past tense', 'time expressions', 'sequencing'],
        exitCriteria: 'Tell a 2-minute story about why you moved.',
        estimatedLessons: 5
      },
      {
        title: 'Settling-in plans',
        description: 'Talk about plans for your first months in your new home.',
        focusAreas: ['future tense', 'modal verbs', 'plans vs intentions'],
        exitCriteria: 'Describe your plans for settling in.',
        estimatedLessons: 5
      },
      {
        title: 'Comparing old life and new',
        description: 'Compare your new place to where you used to live.',
        focusAreas: ['opinion phrases', 'comparatives', 'reason connectors'],
        exitCriteria: 'Compare your new and old homes with reasons.',
        estimatedLessons: 5
      },
      {
        title: 'Neighborhood conversations',
        description: 'Apply A2 skills with neighbors, shopkeepers, and locals.',
        focusAreas: ['neighborhood small talk', 'polite register', 'daily-life dialogues'],
        exitCriteria: 'Hold a 5-minute conversation with a neighbor about your week.',
        estimatedLessons: 5
      }
    ]
  },

  // B1 — Intermediate Confidence. Spine: complex past structures →
  // conditionals/hypotheticals → abstract topics → application.
  B1: {
    conversational: [
      {
        title: 'Layered stories',
        description: 'Recount stories with backstory, consequence, and reported speech.',
        focusAreas: ['past perfect', 'reported speech', 'time clauses'],
        exitCriteria: 'Recount a multi-part story to a friend.',
        estimatedLessons: 5
      },
      {
        title: '"What if" with friends',
        description: 'Discuss hypothetical situations and life choices.',
        focusAreas: ['1st/2nd conditional', 'hypothetical phrases', 'wish'],
        exitCriteria: 'Discuss what-if with a friend for 3 minutes.',
        estimatedLessons: 5
      },
      {
        title: 'Opinions on life and society',
        description: 'Defend a personal opinion with supporting reasons.',
        focusAreas: ['abstract nouns', 'agreeing/disagreeing', 'reason chains'],
        exitCriteria: 'Defend an opinion about a life choice with 3+ reasons.',
        estimatedLessons: 5
      },
      {
        title: 'Storytelling in social settings',
        description: 'Tell a polished story to a small group.',
        focusAreas: ['narrative pacing', 'audience awareness', 'connecting words'],
        exitCriteria: 'Give a 3-minute story at a social gathering.',
        estimatedLessons: 5
      }
    ],
    professional: [
      {
        title: 'Project history',
        description: 'Recount projects with their setup, decisions, and outcomes.',
        focusAreas: ['past perfect', 'reported speech', 'time clauses'],
        exitCriteria: 'Recount a project with its setup and outcome.',
        estimatedLessons: 5
      },
      {
        title: '"What if" in business decisions',
        description: 'Discuss hypothetical decisions and trade-offs at work.',
        focusAreas: ['1st/2nd conditional', 'hedging', 'hypothetical phrases'],
        exitCriteria: 'Discuss what-if scenarios for a project decision.',
        estimatedLessons: 5
      },
      {
        title: 'Defending a proposal',
        description: 'Argue for a proposal with structured reasoning.',
        focusAreas: ['abstract nouns', 'agreeing/disagreeing in meetings', 'reason chains'],
        exitCriteria: 'Defend a proposal with 3+ supporting reasons.',
        estimatedLessons: 5
      },
      {
        title: 'Project presentations',
        description: 'Present a project clearly to colleagues.',
        focusAreas: ['workplace vocab', 'meeting phrases', 'presentation language'],
        exitCriteria: 'Give a 3-minute project presentation.',
        estimatedLessons: 5
      }
    ],
    travel: [
      {
        title: 'Travel stories with depth',
        description: 'Recount layered travel stories with side plots and reported speech.',
        focusAreas: ['past perfect', 'reported speech', 'time clauses'],
        exitCriteria: 'Recount a multi-day trip with depth.',
        estimatedLessons: 5
      },
      {
        title: '"What if" on the road',
        description: 'Discuss hypothetical travel scenarios and choices.',
        focusAreas: ['1st/2nd conditional', 'hypothetical phrases', 'wish'],
        exitCriteria: 'Discuss what-if scenarios for a future trip.',
        estimatedLessons: 5
      },
      {
        title: 'Opinions about places',
        description: 'Defend a take on a destination, culture, or cuisine.',
        focusAreas: ['abstract nouns', 'cultural commentary', 'reason chains'],
        exitCriteria: 'Defend an opinion about a destination with 3+ reasons.',
        estimatedLessons: 5
      },
      {
        title: 'Trip recap or planning chats',
        description: 'Recommend, plan, or recount a trip in a flowing exchange.',
        focusAreas: ['recommendation language', 'storytelling', 'connecting words'],
        exitCriteria: 'Give a 3-minute trip recap or planning chat.',
        estimatedLessons: 5
      }
    ],
    exam_prep: [
      {
        title: 'Exam-style narration',
        description: 'Produce layered past-event monologues for the exam.',
        focusAreas: ['past perfect', 'reported speech', 'time clauses'],
        exitCriteria: 'Deliver an exam-style narration with depth.',
        estimatedLessons: 5
      },
      {
        title: 'Hypothetical exam prompts',
        description: 'Handle "what would you do if" prompts with confidence.',
        focusAreas: ['1st/2nd conditional', 'hypothetical phrases', 'wish'],
        exitCriteria: 'Handle a 3-minute hypothetical prompt.',
        estimatedLessons: 5
      },
      {
        title: 'Exam-essay opinions',
        description: 'Defend a position in an exam essay or monologue.',
        focusAreas: ['abstract nouns', 'opinion essays', 'reason chains'],
        exitCriteria: 'Defend an opinion in an exam task with 3+ reasons.',
        estimatedLessons: 5
      },
      {
        title: 'Exam-style presentations',
        description: 'Deliver a polished exam presentation under timed conditions.',
        focusAreas: ['presentation language', 'register', 'exam phrasing'],
        exitCriteria: 'Give a 3-minute exam-style presentation.',
        estimatedLessons: 5
      }
    ],
    relocation: [
      {
        title: 'Your move, in depth',
        description: 'Recount your move with its decisions and consequences.',
        focusAreas: ['past perfect', 'reported speech', 'time clauses'],
        exitCriteria: 'Recount your move with backstory and outcome.',
        estimatedLessons: 5
      },
      {
        title: '"What if" about your new life',
        description: 'Discuss hypothetical paths and trade-offs in your relocation.',
        focusAreas: ['1st/2nd conditional', 'hypothetical phrases', 'wish'],
        exitCriteria: 'Discuss what-if scenarios about your new life.',
        estimatedLessons: 5
      },
      {
        title: 'Cultural opinions',
        description: 'Defend a take on cultural differences with supporting reasons.',
        focusAreas: ['abstract nouns', 'cultural commentary', 'reason chains'],
        exitCriteria: 'Defend an opinion about cultural differences with 3+ reasons.',
        estimatedLessons: 5
      },
      {
        title: 'How you\'re adapting',
        description: 'Tell people how the transition is going in a flowing exchange.',
        focusAreas: ['storytelling', 'opinion + reasons', 'connecting words'],
        exitCriteria: 'Give a 3-minute talk about how you\'re adapting.',
        estimatedLessons: 5
      }
    ]
  },

  // B2 — Upper-Intermediate Fluency. Spine: nuance/idioms → argumentation
  // → cultural depth → polish.
  B2: {
    conversational: [
      {
        title: 'Idioms in casual talk',
        description: 'Use idioms and collocations naturally with friends.',
        focusAreas: ['common idioms', 'collocations', 'register awareness'],
        exitCriteria: 'Use 5+ idioms naturally in a casual conversation.',
        estimatedLessons: 5
      },
      {
        title: 'Friendly debate',
        description: 'Hold your own in a debate over a current topic.',
        focusAreas: ['advanced connectors', 'concession', 'rebuttal phrases'],
        exitCriteria: 'Hold a 5-minute friendly debate.',
        estimatedLessons: 5
      },
      {
        title: 'Pop-culture depth',
        description: 'Discuss films, books, and trending topics with confidence.',
        focusAreas: ['cultural references', 'humor', 'media literacy'],
        exitCriteria: 'Discuss a film or book with confidence.',
        estimatedLessons: 5
      },
      {
        title: 'Casual polish',
        description: 'Refine accuracy and flow in everyday speech.',
        focusAreas: ['error correction', 'fluency drills', 'rhythm'],
        exitCriteria: 'Speak for 5 minutes with minimal hesitation socially.',
        estimatedLessons: 5
      }
    ],
    professional: [
      {
        title: 'Workplace idioms',
        description: 'Use business idioms and collocations naturally.',
        focusAreas: ['business idioms', 'collocations', 'register awareness'],
        exitCriteria: 'Use 5+ workplace idioms naturally.',
        estimatedLessons: 5
      },
      {
        title: 'Debate in meetings',
        description: 'Make and rebut arguments in a workplace decision.',
        focusAreas: ['advanced connectors', 'concession', 'rebuttal phrases'],
        exitCriteria: 'Hold a 5-minute debate on a workplace decision.',
        estimatedLessons: 5
      },
      {
        title: 'Industry and culture',
        description: 'Discuss industry trends and company culture with confidence.',
        focusAreas: ['business commentary', 'media literacy', 'professional humor'],
        exitCriteria: 'Discuss industry trends with confidence.',
        estimatedLessons: 5
      },
      {
        title: 'Professional polish',
        description: 'Refine accuracy and flow in workplace settings.',
        focusAreas: ['error correction', 'fluency drills', 'professional rhythm'],
        exitCriteria: 'Speak for 5 minutes with minimal hesitation at work.',
        estimatedLessons: 5
      }
    ],
    travel: [
      {
        title: 'Idioms with locals',
        description: 'Pick up and use idioms naturally in travel conversations.',
        focusAreas: ['common idioms', 'regional expressions', 'register awareness'],
        exitCriteria: 'Use 5+ idioms naturally with a local host.',
        estimatedLessons: 5
      },
      {
        title: 'Debating destinations',
        description: 'Argue for and against destinations or cultural takes.',
        focusAreas: ['advanced connectors', 'concession', 'rebuttal phrases'],
        exitCriteria: 'Hold a 5-minute debate about destinations or culture.',
        estimatedLessons: 5
      },
      {
        title: 'Culture on the road',
        description: 'Discuss history, food, and culture of a destination at depth.',
        focusAreas: ['cultural references', 'regional humor', 'media literacy'],
        exitCriteria: 'Discuss the culture of a destination with confidence.',
        estimatedLessons: 5
      },
      {
        title: 'Travel polish',
        description: 'Refine accuracy and flow in travel scenarios.',
        focusAreas: ['error correction', 'fluency drills', 'rhythm'],
        exitCriteria: 'Speak for 5 minutes with minimal hesitation while traveling.',
        estimatedLessons: 5
      }
    ],
    exam_prep: [
      {
        title: 'Idioms for the exam',
        description: 'Use idioms appropriately in exam speaking and writing.',
        focusAreas: ['common idioms', 'collocations', 'register awareness'],
        exitCriteria: 'Use 5+ idioms appropriately in exam tasks.',
        estimatedLessons: 5
      },
      {
        title: 'Argumentation in exam essays',
        description: 'Construct exam-quality arguments on current events.',
        focusAreas: ['advanced connectors', 'concession', 'rebuttal phrases'],
        exitCriteria: 'Construct a 5-minute argument on a current event.',
        estimatedLessons: 5
      },
      {
        title: 'Cultural depth for the exam',
        description: 'Discuss films, books, or articles at exam quality.',
        focusAreas: ['cultural references', 'humor', 'media literacy'],
        exitCriteria: 'Deliver an exam-quality cultural monologue.',
        estimatedLessons: 5
      },
      {
        title: 'Exam polish',
        description: 'Refine accuracy and flow under exam conditions.',
        focusAreas: ['error correction', 'fluency drills', 'exam pacing'],
        exitCriteria: 'Speak for 5 minutes with minimal hesitation on an exam task.',
        estimatedLessons: 5
      }
    ],
    relocation: [
      {
        title: 'Idioms in daily life',
        description: 'Pick up and use idioms naturally with locals.',
        focusAreas: ['common idioms', 'regional expressions', 'register awareness'],
        exitCriteria: 'Use 5+ idioms naturally with neighbors or colleagues.',
        estimatedLessons: 5
      },
      {
        title: 'Debating local topics',
        description: 'Argue your take on a community or local issue.',
        focusAreas: ['advanced connectors', 'concession', 'rebuttal phrases'],
        exitCriteria: 'Hold a 5-minute debate on a local topic.',
        estimatedLessons: 5
      },
      {
        title: 'Local culture in depth',
        description: 'Discuss local culture, history, and news with confidence.',
        focusAreas: ['cultural references', 'regional humor', 'media literacy'],
        exitCriteria: 'Discuss local culture with confidence.',
        estimatedLessons: 5
      },
      {
        title: 'Daily-life polish',
        description: 'Refine accuracy and flow across daily-life settings.',
        focusAreas: ['error correction', 'fluency drills', 'rhythm'],
        exitCriteria: 'Speak for 5 minutes with minimal hesitation in daily life.',
        estimatedLessons: 5
      }
    ]
  },

  // C1 — Advanced Mastery. Spine: sophisticated structures → specialized
  // vocabulary → persuasion/rhetoric → consolidation.
  C1: {
    conversational: [
      {
        title: 'Sophisticated everyday speech',
        description: 'Use C1 structures expressively in everyday talk.',
        focusAreas: ['inversion', 'cleft sentences', 'subjunctive'],
        exitCriteria: 'Use C1 structures naturally in casual speech.',
        estimatedLessons: 5
      },
      {
        title: 'Deep dives in your interests',
        description: 'Discuss your passions and interests at depth.',
        focusAreas: ['hobby-specific vocab', 'enthusiast language', 'cultural references'],
        exitCriteria: 'Discuss a passion topic with a native enthusiast.',
        estimatedLessons: 5
      },
      {
        title: 'Persuasion in social settings',
        description: 'Persuade and negotiate in extended social discussions.',
        focusAreas: ['persuasive language', 'negotiation phrases', 'leadership tone'],
        exitCriteria: 'Persuade a friend in a 10-minute discussion.',
        estimatedLessons: 5
      },
      {
        title: 'Casual register mastery',
        description: 'Switch register seamlessly across social contexts.',
        focusAreas: ['register switching', 'subtle nuance', 'cultural fluency'],
        exitCriteria: 'Switch register seamlessly across casual contexts.',
        estimatedLessons: 5
      }
    ],
    professional: [
      {
        title: 'Sophisticated business speech',
        description: 'Use C1 structures appropriately in formal business contexts.',
        focusAreas: ['inversion', 'cleft sentences', 'subjunctive'],
        exitCriteria: 'Use C1 structures naturally in formal business settings.',
        estimatedLessons: 5
      },
      {
        title: 'Your field at depth',
        description: 'Discuss your professional field with a native speaker.',
        focusAreas: ['domain-specific vocab', 'jargon', 'technical phrasing'],
        exitCriteria: 'Discuss your field with a native speaker.',
        estimatedLessons: 5
      },
      {
        title: 'Negotiation and leadership',
        description: 'Lead negotiations and meetings with native-level command.',
        focusAreas: ['persuasive language', 'negotiation phrases', 'leadership tone'],
        exitCriteria: 'Lead a 10-minute meeting or negotiation.',
        estimatedLessons: 5
      },
      {
        title: 'Workplace register mastery',
        description: 'Switch register seamlessly across workplace contexts.',
        focusAreas: ['register switching', 'subtle nuance', 'cultural fluency'],
        exitCriteria: 'Switch register seamlessly between formal and casual at work.',
        estimatedLessons: 5
      }
    ],
    travel: [
      {
        title: 'Sophisticated travel speech',
        description: 'Use C1 structures expressively when recounting and discussing trips.',
        focusAreas: ['inversion', 'cleft sentences', 'subjunctive'],
        exitCriteria: 'Use C1 structures naturally in travel narratives.',
        estimatedLessons: 5
      },
      {
        title: 'Travel and culture at depth',
        description: 'Discuss travel, history, and culture with a local expert.',
        focusAreas: ['regional vocab', 'cultural jargon', 'sophisticated travel phrasing'],
        exitCriteria: 'Discuss culture or history at depth with a local expert.',
        estimatedLessons: 5
      },
      {
        title: 'Persuasion on the road',
        description: 'Negotiate and persuade in extended travel conversations.',
        focusAreas: ['persuasive language', 'negotiation phrases', 'host-guest dynamics'],
        exitCriteria: 'Negotiate or persuade in a 10-minute travel conversation.',
        estimatedLessons: 5
      },
      {
        title: 'Travel register mastery',
        description: 'Switch register seamlessly across travel contexts.',
        focusAreas: ['register switching', 'subtle nuance', 'cultural fluency'],
        exitCriteria: 'Switch register seamlessly between formal and casual on the road.',
        estimatedLessons: 5
      }
    ],
    exam_prep: [
      {
        title: 'Sophisticated exam structures',
        description: 'Use C1 structures appropriately in exam essays and monologues.',
        focusAreas: ['inversion', 'cleft sentences', 'subjunctive'],
        exitCriteria: 'Use C1 structures naturally in exam tasks.',
        estimatedLessons: 5
      },
      {
        title: 'Exam-topic depth',
        description: 'Discuss exam-typical themes (society, science, culture) with depth.',
        focusAreas: ['academic vocab', 'exam-domain jargon', 'formal phrasing'],
        exitCriteria: 'Discuss an exam-typical topic with depth.',
        estimatedLessons: 5
      },
      {
        title: 'Argumentative exam tasks',
        description: 'Construct extended argumentative essays and debate-style monologues.',
        focusAreas: ['persuasive language', 'argumentation', 'formal tone'],
        exitCriteria: 'Deliver a 10-minute argumentative exam task.',
        estimatedLessons: 5
      },
      {
        title: 'Exam register mastery',
        description: 'Switch register seamlessly across formal and informal exam tasks.',
        focusAreas: ['register switching', 'exam-appropriate nuance', 'cultural fluency'],
        exitCriteria: 'Switch register seamlessly across exam task types.',
        estimatedLessons: 5
      }
    ],
    relocation: [
      {
        title: 'Sophisticated daily-life speech',
        description: 'Use C1 structures expressively in your new life.',
        focusAreas: ['inversion', 'cleft sentences', 'subjunctive'],
        exitCriteria: 'Use C1 structures naturally in daily conversations.',
        estimatedLessons: 5
      },
      {
        title: 'Local affairs at depth',
        description: 'Discuss local politics, culture, and news at depth.',
        focusAreas: ['local-affairs vocab', 'regional jargon', 'civic phrasing'],
        exitCriteria: 'Discuss local politics or news at depth.',
        estimatedLessons: 5
      },
      {
        title: 'Civic and social advocacy',
        description: 'Advocate for a position in community settings.',
        focusAreas: ['persuasive language', 'advocacy phrases', 'civic register'],
        exitCriteria: 'Advocate for a position in a 10-minute community discussion.',
        estimatedLessons: 5
      },
      {
        title: 'Local register mastery',
        description: 'Switch register seamlessly across local contexts.',
        focusAreas: ['register switching', 'subtle nuance', 'cultural fluency'],
        exitCriteria: 'Switch register seamlessly between formal and casual locally.',
        estimatedLessons: 5
      }
    ]
  },

  // C2 — Near-Native Expression. Spine: stylistic precision →
  // cultural mastery → expert communication → mastery.
  C2: {
    conversational: [
      {
        title: 'Stylistic precision in speech',
        description: 'Choose the perfect word and tone for every casual context.',
        focusAreas: ['lexical precision', 'stylistic variation', 'literary devices'],
        exitCriteria: 'Edit your own speech for style and tone.',
        estimatedLessons: 5
      },
      {
        title: 'Pop-culture mastery',
        description: 'Analyze films, songs, and literature at depth.',
        focusAreas: ['cultural commentary', 'literary analysis', 'media depth'],
        exitCriteria: 'Analyze a film, song, or piece of literature at depth.',
        estimatedLessons: 5
      },
      {
        title: 'Expert talks on your passions',
        description: 'Deliver a polished talk on a passion topic.',
        focusAreas: ['public speaking', 'persuasive structure', 'narrative control'],
        exitCriteria: 'Deliver a polished 15-minute talk on a passion topic.',
        estimatedLessons: 5
      },
      {
        title: 'Casual mastery',
        description: 'Final polish — indistinguishable from a fluent native socially.',
        focusAreas: ['nuance refinement', 'creative expression', 'mastery maintenance'],
        exitCriteria: 'Indistinguishable from a fluent speaker in any casual context.',
        estimatedLessons: 5
      }
    ],
    professional: [
      {
        title: 'Stylistic precision at work',
        description: 'Choose the perfect word and tone for business writing and speech.',
        focusAreas: ['lexical precision', 'business stylistic variation', 'register'],
        exitCriteria: 'Edit your own emails and proposals for style and tone.',
        estimatedLessons: 5
      },
      {
        title: 'Business and industry mastery',
        description: 'Analyze industry trends and business literature at depth.',
        focusAreas: ['business commentary', 'market literacy', 'industry analysis'],
        exitCriteria: 'Analyze industry trends or business literature at depth.',
        estimatedLessons: 5
      },
      {
        title: 'Expert business communication',
        description: 'Deliver a polished professional presentation or negotiation.',
        focusAreas: ['public speaking', 'professional negotiation', 'academic writing'],
        exitCriteria: 'Deliver a polished 15-minute professional presentation.',
        estimatedLessons: 5
      },
      {
        title: 'Professional mastery',
        description: 'Final polish — indistinguishable from a fluent native at work.',
        focusAreas: ['nuance refinement', 'professional creativity', 'mastery maintenance'],
        exitCriteria: 'Indistinguishable from a fluent speaker in any professional context.',
        estimatedLessons: 5
      }
    ],
    travel: [
      {
        title: 'Stylistic precision in travel writing',
        description: 'Choose the perfect word and tone for narratives and recommendations.',
        focusAreas: ['lexical precision', 'stylistic variation', 'descriptive prose'],
        exitCriteria: 'Edit a travel narrative for style and tone.',
        estimatedLessons: 5
      },
      {
        title: 'Travel-culture mastery',
        description: 'Analyze the history, literature, and culture of a destination at depth.',
        focusAreas: ['cultural commentary', 'historical context', 'regional literary analysis'],
        exitCriteria: 'Analyze the culture or history of a destination at depth.',
        estimatedLessons: 5
      },
      {
        title: 'Expert travel communication',
        description: 'Deliver a polished travel talk, interview, or guided tour.',
        focusAreas: ['public speaking', 'storytelling', 'persuasive description'],
        exitCriteria: 'Deliver a polished 15-minute travel talk or interview.',
        estimatedLessons: 5
      },
      {
        title: 'Travel mastery',
        description: 'Final polish — indistinguishable from a fluent native on the road.',
        focusAreas: ['nuance refinement', 'regional mastery', 'mastery maintenance'],
        exitCriteria: 'Indistinguishable from a fluent speaker in any travel context.',
        estimatedLessons: 5
      }
    ],
    exam_prep: [
      {
        title: 'Stylistic precision for the exam',
        description: 'Choose the perfect word and tone for exam essays.',
        focusAreas: ['lexical precision', 'stylistic variation', 'literary devices'],
        exitCriteria: 'Edit your own exam essays for style and tone.',
        estimatedLessons: 5
      },
      {
        title: 'Exam-task cultural analysis',
        description: 'Analyze literature and articles to C2 exam standard.',
        focusAreas: ['cultural commentary', 'literary analysis', 'critical reading'],
        exitCriteria: 'Analyze a literary or media piece to exam standard.',
        estimatedLessons: 5
      },
      {
        title: 'Expert exam communication',
        description: 'Deliver a polished extended exam essay or monologue.',
        focusAreas: ['academic writing', 'public speaking', 'examiner-ready precision'],
        exitCriteria: 'Deliver a polished 15-minute exam task.',
        estimatedLessons: 5
      },
      {
        title: 'Exam mastery',
        description: 'Final polish — indistinguishable from a fluent native on any exam task.',
        focusAreas: ['nuance refinement', 'exam-level creativity', 'mastery maintenance'],
        exitCriteria: 'Indistinguishable from a fluent speaker on any exam task.',
        estimatedLessons: 5
      }
    ],
    relocation: [
      {
        title: 'Stylistic precision in daily correspondence',
        description: 'Choose the perfect word and tone for everyday writing and speech.',
        focusAreas: ['lexical precision', 'stylistic variation', 'register'],
        exitCriteria: 'Edit your own correspondence for style and tone.',
        estimatedLessons: 5
      },
      {
        title: 'Mastery of your new home',
        description: 'Analyze the history, literature, and culture of your country at depth.',
        focusAreas: ['cultural commentary', 'historical context', 'local media literacy'],
        exitCriteria: 'Analyze the culture or history of your country at depth.',
        estimatedLessons: 5
      },
      {
        title: 'Expert local communication',
        description: 'Deliver a polished talk in a community or civic setting.',
        focusAreas: ['public speaking', 'persuasive structure', 'civic register'],
        exitCriteria: 'Deliver a polished 15-minute talk in a community setting.',
        estimatedLessons: 5
      },
      {
        title: 'Daily-life mastery',
        description: 'Final polish — indistinguishable from a fluent native in any daily context.',
        focusAreas: ['nuance refinement', 'cultural mastery', 'mastery maintenance'],
        exitCriteria: 'Indistinguishable from a fluent speaker in any daily-life context.',
        estimatedLessons: 5
      }
    ]
  }
};

/**
 * Look up the phase array best matching the level + goal combination,
 * falling back gracefully when no goal-specific override exists.
 */
function _getTemplatePhases(level, goalType) {
  const baseLevel = CHAPTER_TEMPLATES[level] ? level : 'A1';
  const goalKey = goalType || 'conversational';
  const goalOverride = CHAPTER_TEMPLATES_BY_GOAL[baseLevel]
    && CHAPTER_TEMPLATES_BY_GOAL[baseLevel][goalKey];
  if (Array.isArray(goalOverride) && goalOverride.length) {
    return goalOverride;
  }
  return CHAPTER_TEMPLATES[baseLevel].phases;
}

/**
 * Generate a chapter from a CEFR template, lightly flavored by the
 * student's goal. Deterministic — no AI cost. Used by:
 *   - free students always
 *   - premium students as fallback when AI fails (G7)
 *   - all students on demotion (no AI cost on regression)
 */
function generateChapterFromTemplate(level, goal) {
  const goalDescription = goal?.description || '';
  const goalType = goal?.type || 'conversational';
  const phases = _getTemplatePhases(level, goalType);

  // Pace-tuned baseline lesson budget per phase. We deliberately keep
  // the template's 4-phase pedagogical structure intact (free users
  // always get foundation → practice → application → consolidation), but
  // we let the student's stated timeline shrink/grow the per-phase
  // lesson count. Mastery floor/ceiling still apply at runtime.
  let baselineLessons = null;
  try {
    const pace = require('./paceService');
    baselineLessons = pace.describe(goal).estimatedLessonsPerPhase;
  } catch (_) {
    baselineLessons = null;
  }

  return phases.map((p) => {
    const goalTopic = _goalTopicSeed(goalType, goalDescription);
    return {
      title: p.title,
      description: p.description,
      focusAreas: p.focusAreas.slice(),
      suggestedTopics: goalTopic ? [goalTopic] : [],
      exitCriteria: p.exitCriteria,
      estimatedLessons: baselineLessons || p.estimatedLessons
    };
  });
}

function _goalTopicSeed(goalType, goalDescription) {
  const seeds = {
    conversational: 'casual conversations with friends',
    travel: 'travel, transport, accommodation',
    professional: 'workplace and meetings',
    exam_prep: 'exam-style tasks and rubrics',
    relocation: 'living abroad scenarios',
    other: ''
  };
  const base = seeds[goalType] || '';
  if (goalDescription) return `${base ? base + ' · ' : ''}${goalDescription}`.slice(0, 120);
  return base;
}

// ─────────────────────────────────────────────────────────────────────
// AI generation (premium path)
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate the next chapter using AI, tuned to the student's mastery
 * trajectory and persistent struggles in the chapter they just completed.
 *
 * Returns 4 phases (same shape as template). Throws on error so the caller
 * can fall back to template (G7).
 */
async function generateChapterWithAi(plan, opts) {
  const {
    completedChapterIndex,
    completedChapterLevel,
    nextLevel,
    completedPhases
  } = opts;

  const goal = plan.goal || {};
  const language = plan.language;

  // Compress the completed chapter to a small summary the model can reason about.
  const trajectory = (completedPhases || []).map((p, i) => ({
    phase: i + 1,
    title: p.title,
    lessonsCompleted: p.lessonsCompleted || 0,
    masteryAverage: p.masteryAverage,
    finishedFocus: (p.focusAreas || []).slice(0, 4)
  }));

  // Pull persistent struggles from the plan history (anything the rule path
  // surfaced repeatedly). Keep it tight to keep the prompt small.
  const recentStruggles = _extractRecentStruggles(plan);

  const pace = require('./paceService');
  const paceDescriptor = pace.describe(goal);

  const prompt = `Generate the next chapter of a personalized language learning plan.

LANGUAGE: ${language}
GOAL: ${goal.type || 'conversational'} — ${goal.description || ''}
COMPLETED CHAPTER: ${completedChapterLevel} (chapter ${completedChapterIndex + 1})
NEXT CHAPTER: ${nextLevel}
${pace.buildAiPromptLine(goal)}

TRAJECTORY THROUGH COMPLETED CHAPTER:
${JSON.stringify(trajectory, null, 2)}

PERSISTENT STRUGGLES (focus the new chapter to reinforce these where natural):
${recentStruggles.length > 0 ? recentStruggles.map(s => `- ${s}`).join('\n') : '(none flagged)'}

Design ${paceDescriptor.phaseCount} sequential phases for the ${nextLevel} chapter that:
1. Build on what they mastered in ${completedChapterLevel}
2. Address persistent struggles where they're naturally relevant (don't force it)
3. Stay keyed to their stated goal (${goal.type})
4. Progress from foundation → practice → application → consolidation
5. Each phase has ~${paceDescriptor.estimatedLessonsPerPhase} estimated lessons (urgency adjusts cadence, not depth-per-lesson)
6. Each phase has a CONCRETE exit criterion (e.g., "tell a 3-minute story", not "feel comfortable")

Return JSON:
{
  "phases": [
    {
      "title": "string (max 50 chars)",
      "description": "string (1-2 sentences)",
      "focusAreas": ["string", ...],
      "suggestedTopics": ["string — concrete conversation scenarios"],
      "exitCriteria": "string — concrete observable milestone",
      "estimatedLessons": 5
    }
  ]
}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert language teacher creating personalized chapter plans. Always respond with valid JSON only. Be concrete and language-specific. Phase descriptions and focus areas are suggestions for tutors — avoid "We will" or other commitment language.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty AI response.');
  const parsed = JSON.parse(raw);
  const phases = parsed.phases;
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error('AI returned no phases.');
  }

  // Clamp / sanitize, sized to the pace-derived phase count (3-5).
  const targetPhaseCount = Math.max(3, Math.min(5, paceDescriptor.phaseCount));
  const baselineLessons = paceDescriptor.estimatedLessonsPerPhase;
  const cleaned = phases.slice(0, targetPhaseCount).map((p) => ({
    title: String(p.title || '').trim().slice(0, 60),
    description: String(p.description || '').trim().slice(0, 280),
    focusAreas: Array.isArray(p.focusAreas) ? p.focusAreas.map(s => String(s).slice(0, 60)).slice(0, 6) : [],
    suggestedTopics: Array.isArray(p.suggestedTopics) ? p.suggestedTopics.map(s => String(s).slice(0, 80)).slice(0, 4) : [],
    exitCriteria: String(p.exitCriteria || '').trim().slice(0, 200),
    estimatedLessons: Number.isFinite(p.estimatedLessons) ? Math.max(3, Math.min(8, p.estimatedLessons)) : baselineLessons
  }));

  // Pad if AI returned fewer than the pace-target. Use template phases.
  if (cleaned.length < targetPhaseCount) {
    const tpl = generateChapterFromTemplate(nextLevel, goal);
    while (cleaned.length < targetPhaseCount && tpl[cleaned.length]) {
      cleaned.push(tpl[cleaned.length]);
    }
  }

  return cleaned;
}

function _extractRecentStruggles(plan) {
  // Pull the last ~10 history entries, look for any associated reasons that
  // suggest the student got stuck. This is intentionally heuristic — we
  // don't want a perfect signal here; we want to nudge the AI.
  const recent = (plan.history || []).slice(-15);
  const stuckReasons = recent
    .filter(h => ['min_lessons', 'mastery_below_threshold', 'decay_warning'].includes(h.reason))
    .map(h => h.changeDescription);
  // Dedupe and cap.
  return [...new Set(stuckReasons)].slice(0, 5);
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point used by learningPlanService
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate the next chapter's 4 phases.
 *
 * Routes:
 *   - Premium + not-forceTemplate → AI path; on error, fall back to template.
 *   - Free OR forceTemplate → template path.
 *
 * @param {Object} plan       The learning plan (Mongoose doc; needs .studentId)
 * @param {Object} opts
 * @param {Number} opts.completedChapterIndex
 * @param {String} opts.completedChapterLevel
 * @param {String} opts.nextLevel
 * @param {Array}  opts.completedPhases
 * @param {Boolean} [opts.forceTemplate]   demotion / fallback path
 * @returns {Promise<Array>}  4 phase objects
 */
async function generateNextChapter(plan, opts) {
  const { nextLevel, forceTemplate } = opts;
  const goal = plan.goal || {};

  // Decide path.
  let usePremiumAi = false;
  if (!forceTemplate) {
    try {
      const User = require('../models/User');
      const student = await User.findById(plan.studentId).lean();
      usePremiumAi = entitlements.canUseAdaptivePlanAi(student);
    } catch (err) {
      console.warn('[ChapterGen] Could not determine entitlement, defaulting to template:', err.message);
      usePremiumAi = false;
    }
  }

  if (usePremiumAi) {
    try {
      const phases = await generateChapterWithAi(plan, opts);
      console.log(`✨ [ChapterGen] AI generated ${phases.length} phases for ${nextLevel}`);
      return phases;
    } catch (err) {
      console.error('[ChapterGen] AI generation failed, using template fallback:', err.message);
      // Fall through to template (G7).
    }
  }

  const phases = generateChapterFromTemplate(nextLevel, goal);
  console.log(`📋 [ChapterGen] Template generated ${phases.length} phases for ${nextLevel}`);
  return phases;
}

// ─────────────────────────────────────────────────────────────────────
// Goal-change regeneration (preserves chapter, rewrites phases)
// ─────────────────────────────────────────────────────────────────────

/**
 * Regenerate the CURRENT chapter's phases when the student changes their
 * goal mid-chapter. The student's demonstrated CEFR (chapterIndex /
 * chapterLevel) is preserved — only the phases themselves are rewritten
 * to reflect the new goal.
 *
 * Premium → AI with goal-change context (knows what they had, what
 *           changed, and not to repeat the same titles verbatim).
 * Free    → deterministic template at the same CEFR level, lightly
 *           goal-flavored.
 * AI failure → silent template fallback (G7).
 *
 * @param {Object} plan
 * @param {Object} opts
 * @param {Object} opts.oldGoal       The previous plan.goal snapshot.
 * @param {Array}  opts.previousPhases  Snapshot of plan.phases BEFORE the regen.
 * @returns {Promise<Array>} 4 phase objects (no lessonsCompleted/scores yet)
 */
async function regenerateChapterForGoalChange(plan, opts = {}) {
  const goal = plan.goal || {};
  const level = plan.chapterLevel || 'A1';

  // Decide path same way as generateNextChapter.
  let usePremiumAi = false;
  try {
    const User = require('../models/User');
    const student = await User.findById(plan.studentId).lean();
    usePremiumAi = entitlements.canUseAdaptivePlanAi(student);
  } catch (err) {
    console.warn('[ChapterGen/GoalChange] Could not determine entitlement, defaulting to template:', err.message);
    usePremiumAi = false;
  }

  if (usePremiumAi) {
    try {
      const phases = await _regenerateChapterForGoalChangeWithAi(plan, opts);
      console.log(`✨ [ChapterGen/GoalChange] AI regenerated ${phases.length} phases at ${level} for new goal`);
      return phases;
    } catch (err) {
      console.error('[ChapterGen/GoalChange] AI regen failed, using template fallback:', err.message);
      // Fall through to template (G7).
    }
  }

  const phases = generateChapterFromTemplate(level, goal);
  console.log(`📋 [ChapterGen/GoalChange] Template regenerated ${phases.length} phases at ${level}`);
  return phases;
}

/**
 * Internal: AI regen for goal change. Tells the model the previous
 * phase shape so it can deliberately produce different phases that are
 * still calibrated to the student's demonstrated CEFR level.
 */
async function _regenerateChapterForGoalChangeWithAi(plan, opts) {
  const goal = plan.goal || {};
  const oldGoal = opts.oldGoal || {};
  const previousPhases = Array.isArray(opts.previousPhases) ? opts.previousPhases : [];
  const language = plan.language;
  const level = plan.chapterLevel || 'A1';

  const prevList = previousPhases
    .slice(0, 6)
    .map((p, i) => `  ${i + 1}. ${p.title || ''} — ${(p.description || '').slice(0, 80)}`)
    .join('\n') || '(none)';

  const goalLine = (g) => {
    const t = g?.type || 'conversational';
    const d = g?.description ? ` — ${g.description}` : '';
    return `${t}${d}`;
  };

  const pace = require('./paceService');
  const paceDescriptor = pace.describe(goal);

  const prompt = `The student has changed their language-learning goal. Rewrite the current chapter's phases to reflect the new goal — but DO NOT change their level (they have demonstrated proficiency at ${level} and we are preserving that).

LANGUAGE: ${language}
CURRENT CEFR LEVEL: ${level} (preserved)
PREVIOUS GOAL: ${goalLine(oldGoal)}
NEW GOAL: ${goalLine(goal)}
TARGET LEVEL: ${goal.targetLevel || 'not specified'}
TIMELINE: ${goal.timeline || 'no_rush'}
${pace.buildAiPromptLine(goal)}

PHASES THEY HAD BEFORE (do NOT repeat verbatim — vary topics + framing):
${prevList}

Design ${paceDescriptor.phaseCount} sequential phases for the ${level} chapter, calibrated to the new goal and pace:
1. Stay AT the ${level} level — do not pitch above or below
2. Reframe content for the NEW goal type (${goal.type || 'conversational'})
3. Genuinely different from the previous phases (different titles, different scenarios)
4. Progress: foundation → practice → application → consolidation
5. Each phase has ~${paceDescriptor.estimatedLessonsPerPhase} estimated lessons
6. Each phase has a CONCRETE exit criterion (e.g., "tell a 3-minute story", not "feel comfortable")

Return JSON:
{
  "phases": [
    {
      "title": "string (max 50 chars)",
      "description": "string (1-2 sentences)",
      "focusAreas": ["string", ...],
      "suggestedTopics": ["string — concrete conversation scenarios"],
      "exitCriteria": "string — concrete observable milestone",
      "estimatedLessons": 5
    }
  ]
}`;

  const completion = await getOpenAIClient().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert language teacher. The student is keeping their current level but pivoting their goal — rewrite their chapter accordingly. Always respond with valid JSON only. Be concrete and language-specific.'
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });

  const raw = JSON.parse(completion.choices[0].message.content || '{}');
  const phases = Array.isArray(raw.phases) ? raw.phases : [];
  const targetPhaseCount = Math.max(3, Math.min(5, paceDescriptor.phaseCount));
  if (phases.length < Math.max(3, targetPhaseCount - 1)) {
    throw new Error(`AI returned ${phases.length} phases, expected ~${targetPhaseCount}`);
  }

  return phases.slice(0, targetPhaseCount).map((p) => ({
    title: String(p.title || '').slice(0, 80),
    description: String(p.description || '').slice(0, 280),
    focusAreas: Array.isArray(p.focusAreas) ? p.focusAreas.slice(0, 6) : [],
    suggestedTopics: Array.isArray(p.suggestedTopics) ? p.suggestedTopics.slice(0, 6) : [],
    exitCriteria: String(p.exitCriteria || '').slice(0, 200),
    estimatedLessons: Number.isFinite(p.estimatedLessons) ? Math.max(3, Math.min(10, p.estimatedLessons)) : paceDescriptor.estimatedLessonsPerPhase
  }));
}

module.exports = {
  generateNextChapter,
  generateChapterFromTemplate,
  generateChapterWithAi,
  regenerateChapterForGoalChange,
  CHAPTER_TEMPLATES
};
