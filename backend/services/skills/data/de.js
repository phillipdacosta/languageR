/**
 * German skill taxonomy.
 *
 * Coverage target: the patterns GPT-4 most often flags on A1–B2 German
 * lessons (cases, articles/gender, verb conjugation, word order, modal
 * and separable verbs, tenses) plus the highest-signal B2/C1 struggles.
 *
 * Conventions
 *   - id namespace: de.<category>.<subdomain>.<specific>
 *   - prerequisites point UP the dependency graph
 *   - aliases include BOTH the GPT-flavored phrasing ("verb conjugation",
 *     "der die das") and the precise grammatical label ("present tense",
 *     "definite articles") so the canonicalizer's fuzzy matcher has many
 *     surfaces to hit. The richer the aliases, the fewer struggles fall
 *     into `de.unknown.*`.
 */

module.exports = [
  // ── Verb conjugation / tense ──────────────────────────────────────
  {
    id: 'de.grammar.verb.present_tense',
    displayName: { en: 'Present tense conjugation' },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'present tense',
      'verb conjugation',
      'conjugating verbs',
      'verb endings',
      'present tense conjugation',
      'regular verb conjugation',
      'conjugation',
      'subject verb agreement',
      'verb agreement'
    ],
    impactWeight: 1.5,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.verb.irregular_present',
    displayName: { en: 'Irregular / stem-changing verbs' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['de.grammar.verb.present_tense'],
    aliases: [
      'irregular verbs',
      'strong verbs',
      'stem changing verbs',
      'stem vowel change',
      'vowel change verbs',
      'sein haben werden',
      'sein and haben'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.verb.modal_verbs',
    displayName: { en: 'Modal verbs' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['de.grammar.verb.present_tense'],
    aliases: [
      'modal verbs',
      'modals',
      'koennen muessen wollen',
      'können müssen wollen',
      'can must want',
      'duerfen sollen moegen',
      'using modal verbs'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.verb.separable_verbs',
    displayName: { en: 'Separable & inseparable verbs' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['de.grammar.verb.present_tense'],
    aliases: [
      'separable verbs',
      'separable prefix verbs',
      'inseparable verbs',
      'prefix verbs',
      'trennbare verben',
      'separable prefixes'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.verb.perfect_tense',
    displayName: { en: 'Perfect tense (Perfekt)' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['de.grammar.verb.present_tense'],
    aliases: [
      'perfect tense',
      'present perfect',
      'perfekt',
      'past participle',
      'haben sein perfect',
      'auxiliary verb choice',
      'partizip',
      'talking about the past'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.verb.simple_past',
    displayName: { en: 'Simple past (Präteritum)' },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['de.grammar.verb.perfect_tense'],
    aliases: [
      'simple past',
      'preterite',
      'praeteritum',
      'präteritum',
      'imperfect tense',
      'past tense narration',
      'written past tense'
    ],
    impactWeight: 1.2,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'de.grammar.verb.future_tense',
    displayName: { en: 'Future tense (Futur I)' },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['de.grammar.verb.present_tense'],
    aliases: [
      'future tense',
      'futur',
      'werden future',
      'talking about the future',
      'will future'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.verb.imperative',
    displayName: { en: 'Imperative (commands)' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['de.grammar.verb.present_tense'],
    aliases: [
      'imperative',
      'commands',
      'giving commands',
      'imperative mood',
      'imperativ'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.verb.konjunktiv_ii',
    displayName: { en: 'Subjunctive II (Konjunktiv II)' },
    category: 'grammar',
    cefr: 'B2',
    prerequisites: ['de.grammar.verb.simple_past'],
    aliases: [
      'subjunctive',
      'konjunktiv',
      'konjunktiv ii',
      'conditional',
      'wuerde would',
      'würde would',
      'hypothetical',
      'polite requests konjunktiv'
    ],
    impactWeight: 1.1,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'de.grammar.verb.passive_voice',
    displayName: { en: 'Passive voice' },
    category: 'grammar',
    cefr: 'B2',
    prerequisites: ['de.grammar.verb.perfect_tense'],
    aliases: [
      'passive voice',
      'passive',
      'werden passive',
      'passiv',
      'active vs passive'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'de.grammar.verb.reflexive_verbs',
    displayName: { en: 'Reflexive verbs' },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['de.grammar.verb.present_tense'],
    aliases: [
      'reflexive verbs',
      'reflexive pronouns',
      'sich verbs',
      'reflexivpronomen'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'exam_prep', 'relocation']
  },

  // ── Cases ─────────────────────────────────────────────────────────
  {
    id: 'de.grammar.cases.nominative',
    displayName: { en: 'Nominative case' },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'nominative case',
      'nominative',
      'subject case',
      'nominativ'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.cases.accusative',
    displayName: { en: 'Accusative case' },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['de.grammar.cases.nominative'],
    aliases: [
      'accusative case',
      'accusative',
      'direct object case',
      'akkusativ',
      'den dem accusative'
    ],
    impactWeight: 1.5,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.cases.dative',
    displayName: { en: 'Dative case' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['de.grammar.cases.accusative'],
    aliases: [
      'dative case',
      'dative',
      'indirect object case',
      'dativ',
      'dem der dative'
    ],
    impactWeight: 1.5,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.cases.genitive',
    displayName: { en: 'Genitive case' },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['de.grammar.cases.dative'],
    aliases: [
      'genitive case',
      'genitive',
      'possessive case',
      'genitiv'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'de.grammar.cases.case_system',
    displayName: { en: 'Case usage (overall)' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['de.grammar.cases.nominative'],
    aliases: [
      'cases',
      'case system',
      'german cases',
      'choosing the right case',
      'case agreement',
      'four cases',
      'noun cases'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Articles, gender & determiners ────────────────────────────────
  {
    id: 'de.grammar.articles.gender',
    displayName: { en: 'Noun gender (der/die/das)' },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'noun gender',
      'gender',
      'grammatical gender',
      'der die das',
      'masculine feminine neuter',
      'genus',
      'guessing gender'
    ],
    impactWeight: 1.5,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.articles.definite_indefinite',
    displayName: { en: 'Definite & indefinite articles' },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: ['de.grammar.articles.gender'],
    aliases: [
      'definite articles',
      'indefinite articles',
      'articles',
      'der die das ein eine',
      'using articles',
      'article declension',
      'artikel'
    ],
    impactWeight: 1.4,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.articles.possessives',
    displayName: { en: 'Possessive articles' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: ['de.grammar.articles.definite_indefinite'],
    aliases: [
      'possessive articles',
      'possessive determiners',
      'mein dein sein',
      'possessives',
      'possessivartikel'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'exam_prep', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.negation.nicht_kein',
    displayName: { en: 'Negation (nicht / kein)' },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'negation',
      'nicht kein',
      'nicht vs kein',
      'negating sentences',
      'how to say not',
      'verneinung'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'travel', 'relocation']
  },

  // ── Adjectives & adverbs ──────────────────────────────────────────
  {
    id: 'de.grammar.adjectives.endings',
    displayName: { en: 'Adjective endings (declension)' },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['de.grammar.cases.case_system', 'de.grammar.articles.definite_indefinite'],
    aliases: [
      'adjective endings',
      'adjective declension',
      'adjective agreement',
      'declining adjectives',
      'adjektivdeklination',
      'adjective inflection'
    ],
    impactWeight: 1.3,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'de.grammar.adjectives.comparatives',
    displayName: { en: 'Comparatives & superlatives' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'comparatives',
      'superlatives',
      'comparison',
      'comparative superlative',
      'bigger biggest',
      'steigerung'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Pronouns ──────────────────────────────────────────────────────
  {
    id: 'de.grammar.pronouns.personal',
    displayName: { en: 'Personal pronouns' },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'personal pronouns',
      'pronouns',
      'ich du er sie es',
      'pronoun case',
      'mir mich dir dich',
      'personalpronomen'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Prepositions ──────────────────────────────────────────────────
  {
    id: 'de.grammar.prepositions.two_way',
    displayName: { en: 'Two-way prepositions (Wechselpräpositionen)' },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['de.grammar.cases.dative'],
    aliases: [
      'two way prepositions',
      'dual prepositions',
      'wechselpraepositionen',
      'wechselpräpositionen',
      'accusative dative prepositions',
      'in an auf prepositions',
      'preposition case'
    ],
    impactWeight: 1.3,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.prepositions.usage',
    displayName: { en: 'Preposition usage' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'prepositions',
      'using prepositions',
      'preposition choice',
      'praepositionen',
      'fixed prepositions'
    ],
    impactWeight: 1.2,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },

  // ── Word order / syntax ───────────────────────────────────────────
  {
    id: 'de.grammar.word_order.verb_second',
    displayName: { en: 'Verb-second word order (V2)' },
    category: 'grammar',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'word order',
      'sentence structure',
      'verb position',
      'verb second',
      'v2 word order',
      'main clause word order',
      'satzstellung',
      'wortstellung',
      'verb placement'
    ],
    impactWeight: 1.5,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.grammar.word_order.subordinate_clause',
    displayName: { en: 'Subordinate clause word order' },
    category: 'grammar',
    cefr: 'B1',
    prerequisites: ['de.grammar.word_order.verb_second'],
    aliases: [
      'subordinate clause word order',
      'verb final',
      'verb at the end',
      'weil dass word order',
      'nebensatz',
      'subordinate clauses',
      'conjunction word order'
    ],
    impactWeight: 1.4,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'de.grammar.syntax.connectors',
    displayName: { en: 'Conjunctions & connectors' },
    category: 'grammar',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'conjunctions',
      'connectors',
      'connecting words',
      'und aber oder weil',
      'coordinating conjunctions',
      'subordinating conjunctions',
      'linking words',
      'konjunktionen'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'exam_prep', 'professional', 'relocation']
  },
  {
    id: 'de.grammar.syntax.relative_clauses',
    displayName: { en: 'Relative clauses' },
    category: 'grammar',
    cefr: 'B2',
    prerequisites: ['de.grammar.word_order.subordinate_clause'],
    aliases: [
      'relative clauses',
      'relative pronouns',
      'der die das relative',
      'relativsatz'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },

  // ── Vocabulary ────────────────────────────────────────────────────
  {
    id: 'de.vocabulary.everyday',
    displayName: { en: 'Everyday vocabulary' },
    category: 'vocabulary',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'vocabulary',
      'word choice',
      'everyday vocabulary',
      'wortschatz',
      'building vocabulary',
      'finding the right word',
      'limited vocabulary'
    ],
    impactWeight: 1.1,
    goalTags: ['conversational', 'exam_prep', 'professional', 'travel', 'relocation']
  },
  {
    id: 'de.vocabulary.false_friends',
    displayName: { en: 'False friends' },
    category: 'vocabulary',
    cefr: 'B1',
    prerequisites: [],
    aliases: [
      'false friends',
      'false cognates',
      'falsche freunde',
      'misleading cognates'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    id: 'de.vocabulary.separable_prefixes_meaning',
    displayName: { en: 'Prefix meanings' },
    category: 'vocabulary',
    cefr: 'B2',
    prerequisites: [],
    aliases: [
      'prefix meanings',
      'verb prefixes meaning',
      'ver be ent prefixes',
      'word formation'
    ],
    impactWeight: 0.9,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },

  // ── Pronunciation ─────────────────────────────────────────────────
  {
    id: 'de.pronunciation.umlauts',
    displayName: { en: 'Umlauts (ä, ö, ü)' },
    category: 'pronunciation',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'umlauts',
      'umlaut',
      'ae oe ue',
      'ä ö ü',
      'vowel pronunciation',
      'pronouncing umlauts'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'travel', 'relocation']
  },
  {
    id: 'de.pronunciation.ch_r_sounds',
    displayName: { en: 'ch / r sounds' },
    category: 'pronunciation',
    cefr: 'A1',
    prerequisites: [],
    aliases: [
      'ch sound',
      'r sound',
      'guttural r',
      'ich ach laut',
      'pronouncing ch',
      'rolling r'
    ],
    impactWeight: 1.0,
    goalTags: ['conversational', 'travel', 'relocation']
  }
];
