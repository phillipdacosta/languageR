/**
 * Spanish skill taxonomy.
 *
 * Coverage target: every pattern likely to be flagged by GPT-4 on a
 * typical A1–B2 Spanish lesson. C1+ entries cover the most-named
 * advanced struggles. Add new skills here freely — the canonicalizer
 * uses aliases for fuzzy matching, so coverage scales with this list.
 *
 * Conventions
 *   - id namespace: es.<category>.<subdomain>.<specific>
 *   - prerequisites point UP the dependency graph (you can't reach this
 *     skill cleanly without the listed prereqs)
 *   - aliases should include both the GPT-flavored phrasing
 *     ("subjunctive mood") and the linguistically precise label
 *     ("present subjunctive")
 */

module.exports = [
  // ── Verb conjugation / tense ──────────────────────────────────────
  {
    id: 'es.grammar.verb.regular_conjugation',
    displayName: {
      en: 'Regular verb conjugation',
      es: 'Conjugación de verbos regulares'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'verb conjugation',
      'regular verb conjugation',
      'verb endings',
      'conjugating regular verbs',
      'ar er ir verbs'
    ],
    impactWeight: 1.5,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.verb.irregular_conjugation',
    displayName: {
      en: 'Irregular verb conjugation',
      es: 'Conjugación de verbos irregulares'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.verb.regular_conjugation'],
    aliases: [
      'irregular verbs',
      'irregular verb conjugation',
      'stem changing verbs',
      'stem-changing verbs'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.tense.present_indicative',
    displayName: {
      en: 'Present indicative',
      es: 'Presente de indicativo'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['es.grammar.verb.regular_conjugation'],
    aliases: [
      'present tense',
      'present indicative',
      'simple present',
      'presente'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.tense.preterite',
    displayName: {
      en: 'Preterite (simple past)',
      es: 'Pretérito indefinido'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [
      'es.grammar.verb.regular_conjugation',
      'es.grammar.tense.present_indicative'
    ],
    aliases: [
      'preterite',
      'preterit',
      'simple past',
      'past tense',
      'pretérito',
      'pretérito indefinido'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.tense.imperfect',
    displayName: {
      en: 'Imperfect past',
      es: 'Pretérito imperfecto'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.tense.preterite'],
    aliases: [
      'imperfect',
      'imperfect tense',
      'imperfect past',
      'imperfecto'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.tense.preterite_vs_imperfect',
    displayName: {
      en: 'Preterite vs imperfect',
      es: 'Indefinido vs imperfecto'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: [
      'es.grammar.tense.preterite',
      'es.grammar.tense.imperfect'
    ],
    aliases: [
      'preterite vs imperfect',
      'past tense choice',
      'pretérito vs imperfecto',
      'indefinido vs imperfecto',
      'tense consistency'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.tense.present_perfect',
    displayName: {
      en: 'Present perfect',
      es: 'Pretérito perfecto compuesto'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.tense.preterite'],
    aliases: [
      'present perfect',
      'perfect tense',
      'have done',
      'pretérito perfecto'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional']
  },
  {
    id: 'es.grammar.tense.future_simple',
    displayName: {
      en: 'Future tense',
      es: 'Futuro simple'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.tense.present_indicative'],
    aliases: [
      'future tense',
      'simple future',
      'futuro',
      'ir a + infinitive'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.tense.conditional',
    displayName: {
      en: 'Conditional tense',
      es: 'Condicional'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['es.grammar.tense.future_simple'],
    aliases: [
      'conditional',
      'conditional tense',
      'would do',
      'condicional'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.mood.subjunctive_present',
    displayName: {
      en: 'Present subjunctive',
      es: 'Subjuntivo presente'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: [
      'es.grammar.tense.present_indicative',
      'es.grammar.verb.regular_conjugation'
    ],
    aliases: [
      'subjunctive',
      'subjunctive mood',
      'present subjunctive',
      'subjuntivo',
      'subjunctive present',
      'mood errors',
      'verb mood'
    ],
    impactWeight: 1.5,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.mood.subjunctive_emotion',
    displayName: {
      en: 'Subjunctive with emotion verbs',
      es: 'Subjuntivo con verbos de emoción'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['es.grammar.mood.subjunctive_present'],
    aliases: [
      'subjunctive emotion',
      'subjunctive with emotion',
      'subjuntivo emoción',
      'wishes hopes feelings',
      'verbs of emotion'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.mood.imperative',
    displayName: {
      en: 'Imperative',
      es: 'Imperativo'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.tense.present_indicative'],
    aliases: [
      'imperative',
      'commands',
      'imperativo'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.conditional_sentences',
    displayName: {
      en: 'Conditional sentences',
      es: 'Oraciones condicionales'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: [
      'es.grammar.mood.subjunctive_present',
      'es.grammar.tense.conditional'
    ],
    aliases: [
      'conditional sentences',
      'if clauses',
      'if then',
      'oraciones condicionales',
      'si clauses'
    ],
    impactWeight: 1.3,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },

  // ── Agreement (gender / number) ────────────────────────────────
  {
    id: 'es.grammar.agreement.gender',
    displayName: {
      en: 'Gender agreement',
      es: 'Concordancia de género'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'gender agreement',
      'noun gender',
      'masculine feminine agreement',
      'concordancia de género',
      'género'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.agreement.number',
    displayName: {
      en: 'Number agreement',
      es: 'Concordancia de número'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'number agreement',
      'plural forms',
      'singular plural agreement',
      'concordancia de número'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.agreement.subject_verb',
    displayName: {
      en: 'Subject-verb agreement',
      es: 'Concordancia sujeto-verbo'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['es.grammar.verb.regular_conjugation'],
    aliases: [
      'subject verb agreement',
      'agreement errors',
      'concordancia sujeto verbo',
      'verb agreement'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Articles / determiners ────────────────────────────────────
  {
    id: 'es.grammar.articles.definite',
    displayName: {
      en: 'Definite articles',
      es: 'Artículos definidos'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['es.grammar.agreement.gender'],
    aliases: [
      'definite articles',
      'el la los las',
      'the in spanish',
      'artículos definidos'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.articles.indefinite',
    displayName: {
      en: 'Indefinite articles',
      es: 'Artículos indefinidos'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['es.grammar.agreement.gender'],
    aliases: [
      'indefinite articles',
      'un una unos unas',
      'a an in spanish',
      'artículos indefinidos'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.articles.usage',
    displayName: {
      en: 'Article usage',
      es: 'Uso de artículos'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [
      'es.grammar.articles.definite',
      'es.grammar.articles.indefinite'
    ],
    aliases: [
      'article usage',
      'when to use articles',
      'omit article',
      'using articles'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Pronouns ──────────────────────────────────────────────────
  {
    id: 'es.grammar.pronouns.subject',
    displayName: {
      en: 'Subject pronouns',
      es: 'Pronombres de sujeto'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'subject pronouns',
      'yo tú él ella',
      'pronombres sujeto'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.pronouns.direct_object',
    displayName: {
      en: 'Direct object pronouns',
      es: 'Pronombres de objeto directo'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.pronouns.subject'],
    aliases: [
      'direct object pronouns',
      'lo la los las',
      'pronombres objeto directo'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.pronouns.indirect_object',
    displayName: {
      en: 'Indirect object pronouns',
      es: 'Pronombres de objeto indirecto'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.pronouns.subject'],
    aliases: [
      'indirect object pronouns',
      'le les',
      'pronombres objeto indirecto'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.pronouns.reflexive',
    displayName: {
      en: 'Reflexive pronouns',
      es: 'Pronombres reflexivos'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.pronouns.subject'],
    aliases: [
      'reflexive pronouns',
      'reflexive verbs',
      'me te se nos os se',
      'verbos reflexivos'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.pronouns.agreement',
    displayName: {
      en: 'Pronoun agreement',
      es: 'Concordancia pronominal'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [
      'es.grammar.agreement.gender',
      'es.grammar.pronouns.direct_object'
    ],
    aliases: [
      'pronoun agreement',
      'pronoun gender',
      'mismatched pronoun'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Ser / Estar / Haber ───────────────────────────────────────
  {
    id: 'es.grammar.copula.ser_vs_estar',
    displayName: {
      en: 'Ser vs estar',
      es: 'Ser vs estar'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['es.grammar.verb.regular_conjugation'],
    aliases: [
      'ser vs estar',
      'ser estar',
      'to be in spanish',
      'when to use ser',
      'when to use estar'
    ],
    impactWeight: 1.5,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.copula.haber_vs_tener',
    displayName: {
      en: 'Haber vs tener',
      es: 'Haber vs tener'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['es.grammar.copula.ser_vs_estar'],
    aliases: [
      'haber vs tener',
      'hay there is',
      'tener vs haber'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Prepositions ─────────────────────────────────────────────
  {
    id: 'es.grammar.prepositions.por_vs_para',
    displayName: {
      en: 'Por vs para',
      es: 'Por vs para'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'por vs para',
      'por para',
      'preposition errors',
      'por and para'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.prepositions.usage',
    displayName: {
      en: 'Preposition usage',
      es: 'Uso de preposiciones'
    },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'prepositions',
      'preposition usage',
      'wrong preposition',
      'a de en con'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Syntax ────────────────────────────────────────────────────
  {
    id: 'es.grammar.syntax.word_order',
    displayName: {
      en: 'Word order',
      es: 'Orden de palabras'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'word order',
      'sentence structure',
      'orden de palabras'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.syntax.negation',
    displayName: {
      en: 'Negation',
      es: 'Negación'
    },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'negation',
      'double negation',
      'no nada nadie nunca',
      'negative sentences'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.grammar.syntax.relative_clauses',
    displayName: {
      en: 'Relative clauses',
      es: 'Oraciones de relativo'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['es.grammar.syntax.word_order'],
    aliases: [
      'relative clauses',
      'que cual quien',
      'relative pronouns',
      'oraciones de relativo'
    ],
    impactWeight: 1.1,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.grammar.syntax.passive_voice',
    displayName: {
      en: 'Passive voice',
      es: 'Voz pasiva'
    },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['es.grammar.tense.present_indicative'],
    aliases: [
      'passive voice',
      'pasiva',
      'se passive',
      'voz pasiva'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },

  // ── Vocabulary ────────────────────────────────────────────────
  {
    id: 'es.vocab.false_friends',
    displayName: {
      en: 'False cognates',
      es: 'Falsos amigos'
    },
    category: 'vocabulary',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'false friends',
      'false cognates',
      'falsos amigos',
      'embarazada embarrassed'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'es.vocab.collocations',
    displayName: {
      en: 'Collocations',
      es: 'Colocaciones'
    },
    category: 'vocabulary',
    cefr: 'B1',
    prerequisites: [],
    aliases: [
      'collocations',
      'word combinations',
      'natural word pairs',
      'colocaciones'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'es.vocab.register',
    displayName: {
      en: 'Lexical register',
      es: 'Registro léxico'
    },
    category: 'vocabulary',
    cefr: 'B1',
    prerequisites: [],
    aliases: [
      'register',
      'formal vs informal vocab',
      'word choice register'
    ],
    impactWeight: 0.9,
    goalTags: ['professional', 'relocation', 'exam_prep']
  },

  // ── Pronunciation ─────────────────────────────────────────────
  {
    id: 'es.pronunciation.rolled_r',
    displayName: {
      en: 'Rolled R (trill)',
      es: 'Erre vibrante'
    },
    category: 'pronunciation',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'rolled r',
      'rr',
      'trill',
      'r vibrante',
      'erre'
    ],
    impactWeight: 0.9,
    goalTags: ['conversational', 'travel', 'relocation']
  },
  {
    id: 'es.pronunciation.vowel_clarity',
    displayName: {
      en: 'Vowel clarity',
      es: 'Claridad vocálica'
    },
    category: 'pronunciation',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'vowel clarity',
      'reduced vowels',
      'vowels',
      'vocales'
    ],
    impactWeight: 0.8,
    goalTags: ['conversational', 'travel', 'relocation']
  },
  {
    id: 'es.pronunciation.stress',
    displayName: {
      en: 'Word stress',
      es: 'Acentuación'
    },
    category: 'pronunciation',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'word stress',
      'syllable stress',
      'acentuación'
    ],
    impactWeight: 0.9,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  }
];
