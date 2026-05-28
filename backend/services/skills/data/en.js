/**
 * English skill taxonomy.
 *
 * Starter set covering the most-named English-learning struggles.
 * Extend freely — the canonicalizer falls back to fuzzy matching
 * against `aliases`, so coverage scales with this list.
 */

module.exports = [
  // ── Verb tenses ──────────────────────────────────────────────
  {
    id: 'en.grammar.tense.present_simple',
    displayName: {
      en: 'Present simple'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'present simple',
      'simple present',
      'present tense',
      'verb conjugation'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.tense.present_continuous',
    displayName: {
      en: 'Present continuous'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['en.grammar.tense.present_simple'],
    aliases: [
      'present continuous',
      'present progressive',
      'be + ing'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.tense.past_simple',
    displayName: {
      en: 'Past simple'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['en.grammar.tense.present_simple'],
    aliases: [
      'past simple',
      'simple past',
      'past tense',
      'preterite'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.tense.present_perfect',
    displayName: {
      en: 'Present perfect'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['en.grammar.tense.past_simple'],
    aliases: [
      'present perfect',
      'have done',
      'have been'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'en.grammar.tense.past_vs_present_perfect',
    displayName: {
      en: 'Past simple vs present perfect'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: [
      'en.grammar.tense.past_simple',
      'en.grammar.tense.present_perfect'
    ],
    aliases: [
      'past simple vs present perfect',
      'tense consistency',
      'past perfect choice'
    ],
    impactWeight: 1.4,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'en.grammar.tense.future',
    displayName: {
      en: 'Future tense'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['en.grammar.tense.present_simple'],
    aliases: [
      'future tense',
      'will going to',
      'future forms'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.modal_verbs',
    displayName: {
      en: 'Modal verbs'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['en.grammar.tense.present_simple'],
    aliases: [
      'modal verbs',
      'modals',
      'can must should',
      'should could would'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'en.grammar.conditional_sentences',
    displayName: {
      en: 'Conditional sentences'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: [
      'en.grammar.tense.past_simple',
      'en.grammar.modal_verbs'
    ],
    aliases: [
      'conditional sentences',
      'if clauses',
      'if then',
      'zero first second third conditional'
    ],
    impactWeight: 1.3,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },

  // ── Articles / determiners ────────────────────────────────────
  {
    id: 'en.grammar.articles',
    displayName: {
      en: 'Articles (a, an, the)'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'article usage',
      'articles',
      'a an the',
      'definite indefinite articles'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Pronouns / agreement ──────────────────────────────────────
  {
    id: 'en.grammar.agreement.subject_verb',
    displayName: {
      en: 'Subject-verb agreement'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['en.grammar.tense.present_simple'],
    aliases: [
      'subject verb agreement',
      'agreement errors',
      'singular plural agreement'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.pronouns',
    displayName: {
      en: 'Pronoun usage'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'pronoun agreement',
      'pronouns',
      'he she it they',
      'i me you'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Syntax ────────────────────────────────────────────────────
  {
    id: 'en.grammar.syntax.word_order',
    displayName: {
      en: 'Word order'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'word order',
      'sentence structure',
      'syntax'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.syntax.questions',
    displayName: {
      en: 'Question formation'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['en.grammar.syntax.word_order'],
    aliases: [
      'question formation',
      'do does did',
      'wh questions',
      'inverted word order'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.syntax.negation',
    displayName: {
      en: 'Negation'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['en.grammar.tense.present_simple'],
    aliases: [
      'negation',
      'negative sentences',
      'don\'t doesn\'t didn\'t'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.syntax.passive_voice',
    displayName: {
      en: 'Passive voice'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['en.grammar.tense.past_simple'],
    aliases: [
      'passive voice',
      'passive'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'en.grammar.syntax.relative_clauses',
    displayName: {
      en: 'Relative clauses'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['en.grammar.pronouns'],
    aliases: [
      'relative clauses',
      'who which that',
      'relative pronouns'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },

  // ── Prepositions ─────────────────────────────────────────────
  {
    id: 'en.grammar.prepositions',
    displayName: {
      en: 'Prepositions'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'prepositions',
      'preposition errors',
      'in on at',
      'wrong preposition'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.grammar.phrasal_verbs',
    displayName: {
      en: 'Phrasal verbs'
    },
    category: 'vocabulary',
    cefr: 'B1',
    prerequisites: ['en.grammar.prepositions'],
    aliases: [
      'phrasal verbs',
      'verb + preposition',
      'pick up put off'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'professional', 'relocation']
  },

  // ── Vocabulary ────────────────────────────────────────────────
  {
    id: 'en.vocab.collocations',
    displayName: {
      en: 'Collocations'
    },
    category: 'vocabulary',
    cefr: 'B1',
    prerequisites: [],
    aliases: [
      'collocations',
      'natural word combinations'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'en.vocab.false_friends',
    displayName: {
      en: 'False cognates'
    },
    category: 'vocabulary',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'false friends',
      'false cognates'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },

  // ── Pronunciation ─────────────────────────────────────────────
  {
    id: 'en.pronunciation.th_sounds',
    displayName: {
      en: 'TH sounds'
    },
    category: 'pronunciation',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'th sound',
      'th pronunciation',
      'voiced voiceless th'
    ],
    impactWeight: 0.9,
    goalTags: ['conversational', 'professional', 'travel', 'relocation']
  },
  {
    id: 'en.pronunciation.word_stress',
    displayName: {
      en: 'Word stress'
    },
    category: 'pronunciation',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'word stress',
      'syllable stress',
      'stress pattern'
    ],
    impactWeight: 0.9,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'en.pronunciation.vowel_clarity',
    displayName: {
      en: 'Vowel clarity'
    },
    category: 'pronunciation',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'vowel clarity',
      'reduced vowels',
      'short vs long vowels'
    ],
    impactWeight: 0.8,
    goalTags: ['conversational', 'professional', 'travel', 'relocation']
  }
];
