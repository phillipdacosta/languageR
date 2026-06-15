/**
 * Universal skills — concepts that apply across every language.
 *
 * These act as a fallback bucket when a language-specific taxonomy
 * doesn't have a more precise mapping. They also let us aggregate
 * cross-language patterns ("you tend to hesitate a lot regardless of
 * language") down the road.
 */

module.exports = [
  {
    id: 'universal.fluency.filler_words',
    displayName: {
      en: 'Filler words',
      es: 'Muletillas',
      fr: 'Mots de remplissage',
      de: 'Füllwörter'
    },
    category: 'fluency',
    cefr: null,
    prerequisites: [],
    aliases: [
      'filler words',
      'fillers',
      'um and uh',
      'muletillas',
      'hesitation fillers'
    ],
    impactWeight: 0.7,
    goalTags: ['conversational', 'professional', 'exam_prep']
  },
  {
    id: 'universal.fluency.hesitation',
    displayName: {
      en: 'Hesitation and pauses',
      es: 'Vacilación y pausas'
    },
    category: 'fluency',
    cefr: null,
    prerequisites: [],
    aliases: [
      'hesitation',
      'pauses',
      'long pauses',
      'pause frequency',
      'thinking aloud'
    ],
    impactWeight: 0.8,
    goalTags: ['conversational', 'professional', 'exam_prep']
  },
  {
    id: 'universal.fluency.self_correction',
    displayName: {
      en: 'Self-correction',
      es: 'Autocorrección'
    },
    category: 'fluency',
    cefr: null,
    prerequisites: [],
    aliases: [
      'self correction',
      'self-correction',
      'restarts',
      'false starts'
    ],
    impactWeight: 0.6,
    goalTags: ['conversational', 'professional']
  },
  {
    id: 'universal.fluency.speaking_speed',
    displayName: {
      en: 'Speaking speed',
      es: 'Velocidad al hablar'
    },
    category: 'fluency',
    cefr: null,
    prerequisites: [],
    aliases: [
      'speaking speed',
      'pace',
      'too slow',
      'too fast'
    ],
    impactWeight: 0.6,
    goalTags: ['conversational', 'professional', 'exam_prep']
  },
  {
    id: 'universal.discourse.cohesion',
    displayName: {
      en: 'Discourse cohesion',
      es: 'Cohesión del discurso'
    },
    category: 'discourse',
    cefr: 'B1',
    prerequisites: [],
    aliases: [
      'cohesion',
      'sentence linking',
      'connector overuse',
      'choppy sentences'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation']
  },
  {
    // Surfaced by the deterministic complexityAnalyzer when a student with
    // enough speech leans on short, simple sentences and rarely subordinates
    // — i.e. "overuse of simple structures when more is expected".
    id: 'universal.discourse.sentence_complexity',
    displayName: {
      en: 'Sentence complexity',
      es: 'Complejidad de las oraciones',
      fr: 'Complexité des phrases',
      de: 'Satzkomplexität',
      it: 'Complessità delle frasi',
      pt: 'Complexidade das frases'
    },
    category: 'discourse',
    cefr: 'B1',
    prerequisites: [],
    aliases: [
      'sentence complexity',
      'simple sentences',
      'overuse of simple structures',
      'short sentences',
      'lack of subordination',
      'more complex sentences',
      'sentence variety',
      'subordinate clauses'
    ],
    impactWeight: 1.0,
    goalTags: ['exam_prep', 'professional', 'relocation', 'conversational']
  },
  {
    id: 'universal.pragmatics.register',
    displayName: {
      en: 'Register and politeness',
      es: 'Registro y cortesía'
    },
    category: 'pragmatics',
    cefr: 'A2',
    prerequisites: [],
    aliases: [
      'register',
      'politeness',
      'formal informal',
      'tone'
    ],
    impactWeight: 1.0,
    goalTags: ['professional', 'relocation', 'travel']
  }
];
