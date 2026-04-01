const express = require('express');
const router = express.Router();
const ContentTag = require('../models/ContentTag');
const { verifyToken } = require('../middleware/videoUploadMiddleware');

// ── GET /api/taxonomy — Full tag tree (public, cached) ──────────────────
router.get('/', async (req, res) => {
  try {
    const tags = await ContentTag.find({ active: true }).sort({ category: 1, sortOrder: 1 }).lean();

    const tree = {};
    const tagMap = {};

    for (const tag of tags) {
      tagMap[tag.tagId] = { ...tag, children: [] };
    }

    for (const tag of tags) {
      if (tag.parent && tagMap[tag.parent]) {
        tagMap[tag.parent].children.push(tagMap[tag.tagId]);
      } else if (!tag.parent || tag.depth === 'category') {
        if (!tree[tag.category]) tree[tag.category] = [];
        tree[tag.category].push(tagMap[tag.tagId]);
      }
    }

    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ success: true, taxonomy: tree });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch taxonomy' });
  }
});

// ── GET /api/taxonomy/flat — Flat list for pickers ──────────────────────
router.get('/flat', async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { active: true };
    if (category) filter.category = category;

    const tags = await ContentTag.find(filter).sort({ category: 1, sortOrder: 1 }).lean();

    const formatted = tags.map(t => ({
      tagId: t.tagId,
      category: t.category,
      parent: t.parent,
      depth: t.depth,
      labels: t.labels instanceof Map ? Object.fromEntries(t.labels) : t.labels,
      sortOrder: t.sortOrder
    }));

    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ success: true, tags: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch tags' });
  }
});

// ── GET /api/taxonomy/:category — Subtree by category ───────────────────
router.get('/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const validCategories = ['grammar', 'vocabulary', 'skills', 'topics'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ success: false, message: 'Invalid category' });
    }

    const tags = await ContentTag.find({ category, active: true }).sort({ sortOrder: 1 }).lean();
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ success: true, tags });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch category' });
  }
});

// ── POST /api/taxonomy/seed — Seed initial taxonomy (admin) ─────────────
router.post('/seed', verifyToken, async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const existing = await ContentTag.countDocuments();
    if (existing > 0) {
      return res.status(409).json({
        success: false,
        message: `Taxonomy already seeded (${existing} tags). Use force=true to reseed.`,
        count: existing
      });
    }

    const tags = getSeedTags();
    await ContentTag.insertMany(tags, { ordered: false });

    res.json({ success: true, message: `Seeded ${tags.length} tags`, count: tags.length });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Seed failed', error: error.message });
  }
});

// ── POST /api/taxonomy — Add tag (admin) ────────────────────────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const { tagId, category, parent, labels, depth, sortOrder } = req.body;
    if (!tagId || !category || !labels || !labels.en || !depth) {
      return res.status(400).json({ success: false, message: 'tagId, category, labels.en, and depth are required' });
    }

    const tag = await ContentTag.create({ tagId, category, parent, labels, depth, sortOrder: sortOrder || 0 });
    res.status(201).json({ success: true, tag });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Tag ID already exists' });
    }
    res.status(500).json({ success: false, message: 'Failed to create tag' });
  }
});

// ── PUT /api/taxonomy/:tagId — Update tag (admin) ───────────────────────
router.put('/:tagId', verifyToken, async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const { labels, sortOrder, active } = req.body;
    const update = {};
    if (labels) update.labels = labels;
    if (sortOrder !== undefined) update.sortOrder = sortOrder;
    if (active !== undefined) update.active = active;

    const tag = await ContentTag.findOneAndUpdate(
      { tagId: req.params.tagId },
      { $set: update },
      { new: true }
    );

    if (!tag) return res.status(404).json({ success: false, message: 'Tag not found' });
    res.json({ success: true, tag });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update tag' });
  }
});

// ── Seed data ───────────────────────────────────────────────────────────

function getSeedTags() {
  return [
    // ═══════════════════════════════════════════════════════
    // GRAMMAR — Category
    // ═══════════════════════════════════════════════════════
    { tagId: 'grammar', category: 'grammar', parent: null, depth: 'category', sortOrder: 0,
      labels: { en: 'Grammar', es: 'Gramática', fr: 'Grammaire', pt: 'Gramática', de: 'Grammatik', it: 'Grammatica', ja: '文法', ko: '문법', zh: '语法', ar: 'قواعد' } },

    // Tenses (subcategory)
    { tagId: 'grammar.tenses', category: 'grammar', parent: 'grammar', depth: 'subcategory', sortOrder: 0,
      labels: { en: 'Tenses', es: 'Tiempos verbales', fr: 'Temps', pt: 'Tempos verbais', de: 'Zeitformen', it: 'Tempi verbali', ja: '時制', ko: '시제', zh: '时态', ar: 'الأزمنة' } },

    { tagId: 'grammar.tenses.present', category: 'grammar', parent: 'grammar.tenses', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Present Tense', es: 'Presente', fr: 'Présent', pt: 'Presente', de: 'Präsens', it: 'Presente', ja: '現在形', ko: '현재 시제', zh: '现在时', ar: 'المضارع' } },

    { tagId: 'grammar.tenses.past_simple', category: 'grammar', parent: 'grammar.tenses', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Past Simple / Preterite', es: 'Pretérito indefinido', fr: 'Passé simple', pt: 'Pretérito perfeito', de: 'Präteritum', it: 'Passato remoto', ja: '過去形', ko: '과거 시제', zh: '一般过去时', ar: 'الماضي البسيط' } },

    { tagId: 'grammar.tenses.past_imperfect', category: 'grammar', parent: 'grammar.tenses', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Imperfect', es: 'Pretérito imperfecto', fr: 'Imparfait', pt: 'Pretérito imperfeito', de: 'Imperfekt', it: 'Imperfetto', ja: '未完了過去', ko: '미완료 과거', zh: '未完成过去时', ar: 'الماضي المستمر' } },

    { tagId: 'grammar.tenses.future', category: 'grammar', parent: 'grammar.tenses', depth: 'leaf', sortOrder: 3,
      labels: { en: 'Future Tense', es: 'Futuro', fr: 'Futur', pt: 'Futuro', de: 'Futur', it: 'Futuro', ja: '未来形', ko: '미래 시제', zh: '将来时', ar: 'المستقبل' } },

    { tagId: 'grammar.tenses.present_perfect', category: 'grammar', parent: 'grammar.tenses', depth: 'leaf', sortOrder: 4,
      labels: { en: 'Present Perfect', es: 'Pretérito perfecto', fr: 'Passé composé', pt: 'Pretérito perfeito composto', de: 'Perfekt', it: 'Passato prossimo', ja: '現在完了', ko: '현재완료', zh: '现在完成时', ar: 'المضارع التام' } },

    { tagId: 'grammar.tenses.past_perfect', category: 'grammar', parent: 'grammar.tenses', depth: 'leaf', sortOrder: 5,
      labels: { en: 'Past Perfect', es: 'Pretérito pluscuamperfecto', fr: 'Plus-que-parfait', pt: 'Pretérito mais-que-perfeito', de: 'Plusquamperfekt', it: 'Trapassato prossimo', ja: '過去完了', ko: '과거완료', zh: '过去完成时', ar: 'الماضي التام' } },

    { tagId: 'grammar.tenses.conditional', category: 'grammar', parent: 'grammar.tenses', depth: 'leaf', sortOrder: 6,
      labels: { en: 'Conditional', es: 'Condicional', fr: 'Conditionnel', pt: 'Condicional', de: 'Konjunktiv II', it: 'Condizionale', ja: '条件法', ko: '조건법', zh: '条件式', ar: 'الشرطي' } },

    // Moods (subcategory)
    { tagId: 'grammar.moods', category: 'grammar', parent: 'grammar', depth: 'subcategory', sortOrder: 1,
      labels: { en: 'Moods', es: 'Modos', fr: 'Modes', pt: 'Modos', de: 'Modi', it: 'Modi', ja: '法', ko: '서법', zh: '语气', ar: 'الأساليب' } },

    { tagId: 'grammar.moods.subjunctive', category: 'grammar', parent: 'grammar.moods', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Subjunctive', es: 'Subjuntivo', fr: 'Subjonctif', pt: 'Subjuntivo', de: 'Konjunktiv', it: 'Congiuntivo', ja: '接続法', ko: '접속법', zh: '虚拟语气', ar: 'الشرط' } },

    { tagId: 'grammar.moods.imperative', category: 'grammar', parent: 'grammar.moods', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Imperative', es: 'Imperativo', fr: 'Impératif', pt: 'Imperativo', de: 'Imperativ', it: 'Imperativo', ja: '命令法', ko: '명령법', zh: '祈使语气', ar: 'الأمر' } },

    // Parts of speech (subcategory)
    { tagId: 'grammar.parts_of_speech', category: 'grammar', parent: 'grammar', depth: 'subcategory', sortOrder: 2,
      labels: { en: 'Parts of Speech', es: 'Partes de la oración', fr: 'Parties du discours', pt: 'Classes gramaticais', de: 'Wortarten', it: 'Parti del discorso', ja: '品詞', ko: '품사', zh: '词性', ar: 'أقسام الكلام' } },

    { tagId: 'grammar.parts_of_speech.nouns', category: 'grammar', parent: 'grammar.parts_of_speech', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Nouns & Gender', es: 'Sustantivos y género', fr: 'Noms et genre', pt: 'Substantivos e gênero', de: 'Nomen & Genus', it: 'Nomi e genere', ja: '名詞', ko: '명사', zh: '名词', ar: 'الأسماء' } },

    { tagId: 'grammar.parts_of_speech.adjectives', category: 'grammar', parent: 'grammar.parts_of_speech', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Adjectives', es: 'Adjetivos', fr: 'Adjectifs', pt: 'Adjetivos', de: 'Adjektive', it: 'Aggettivi', ja: '形容詞', ko: '형용사', zh: '形容词', ar: 'الصفات' } },

    { tagId: 'grammar.parts_of_speech.adverbs', category: 'grammar', parent: 'grammar.parts_of_speech', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Adverbs', es: 'Adverbios', fr: 'Adverbes', pt: 'Advérbios', de: 'Adverbien', it: 'Avverbi', ja: '副詞', ko: '부사', zh: '副词', ar: 'الظروف' } },

    { tagId: 'grammar.parts_of_speech.pronouns', category: 'grammar', parent: 'grammar.parts_of_speech', depth: 'leaf', sortOrder: 3,
      labels: { en: 'Pronouns', es: 'Pronombres', fr: 'Pronoms', pt: 'Pronomes', de: 'Pronomen', it: 'Pronomi', ja: '代名詞', ko: '대명사', zh: '代词', ar: 'الضمائر' } },

    // Verb forms (subcategory)
    { tagId: 'grammar.verbs', category: 'grammar', parent: 'grammar', depth: 'subcategory', sortOrder: 3,
      labels: { en: 'Verb Forms', es: 'Formas verbales', fr: 'Formes verbales', pt: 'Formas verbais', de: 'Verbformen', it: 'Forme verbali', ja: '動詞形', ko: '동사 형태', zh: '动词形式', ar: 'أشكال الأفعال' } },

    { tagId: 'grammar.verbs.conjugation', category: 'grammar', parent: 'grammar.verbs', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Verb Conjugation', es: 'Conjugación', fr: 'Conjugaison', pt: 'Conjugação', de: 'Konjugation', it: 'Coniugazione', ja: '活用', ko: '활용', zh: '动词变位', ar: 'تصريف الأفعال' } },

    { tagId: 'grammar.verbs.irregular', category: 'grammar', parent: 'grammar.verbs', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Irregular Verbs', es: 'Verbos irregulares', fr: 'Verbes irréguliers', pt: 'Verbos irregulares', de: 'Unregelmäßige Verben', it: 'Verbi irregolari', ja: '不規則動詞', ko: '불규칙 동사', zh: '不规则动词', ar: 'أفعال شاذة' } },

    { tagId: 'grammar.verbs.reflexive', category: 'grammar', parent: 'grammar.verbs', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Reflexive Verbs', es: 'Verbos reflexivos', fr: 'Verbes réfléchis', pt: 'Verbos reflexivos', de: 'Reflexive Verben', it: 'Verbi riflessivi', ja: '再帰動詞', ko: '재귀 동사', zh: '反身动词', ar: 'أفعال منعكسة' } },

    { tagId: 'grammar.verbs.passive_voice', category: 'grammar', parent: 'grammar.verbs', depth: 'leaf', sortOrder: 3,
      labels: { en: 'Passive Voice', es: 'Voz pasiva', fr: 'Voix passive', pt: 'Voz passiva', de: 'Passiv', it: 'Voce passiva', ja: '受動態', ko: '수동태', zh: '被动语态', ar: 'المبني للمجهول' } },

    // Sentence structure (subcategory)
    { tagId: 'grammar.structure', category: 'grammar', parent: 'grammar', depth: 'subcategory', sortOrder: 4,
      labels: { en: 'Sentence Structure', es: 'Estructura oracional', fr: 'Structure de phrase', pt: 'Estrutura da frase', de: 'Satzstruktur', it: 'Struttura della frase', ja: '文構造', ko: '문장 구조', zh: '句子结构', ar: 'بنية الجملة' } },

    { tagId: 'grammar.structure.word_order', category: 'grammar', parent: 'grammar.structure', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Word Order', es: 'Orden de las palabras', fr: 'Ordre des mots', pt: 'Ordem das palavras', de: 'Wortstellung', it: 'Ordine delle parole', ja: '語順', ko: '어순', zh: '语序', ar: 'ترتيب الكلمات' } },

    { tagId: 'grammar.structure.prepositions', category: 'grammar', parent: 'grammar.structure', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Prepositions', es: 'Preposiciones', fr: 'Prépositions', pt: 'Preposições', de: 'Präpositionen', it: 'Preposizioni', ja: '前置詞', ko: '전치사', zh: '介词', ar: 'حروف الجر' } },

    { tagId: 'grammar.structure.articles', category: 'grammar', parent: 'grammar.structure', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Articles', es: 'Artículos', fr: 'Articles', pt: 'Artigos', de: 'Artikel', it: 'Articoli', ja: '冠詞', ko: '관사', zh: '冠词', ar: 'أدوات التعريف' } },

    { tagId: 'grammar.structure.conjunctions', category: 'grammar', parent: 'grammar.structure', depth: 'leaf', sortOrder: 3,
      labels: { en: 'Conjunctions', es: 'Conjunciones', fr: 'Conjonctions', pt: 'Conjunções', de: 'Konjunktionen', it: 'Congiunzioni', ja: '接続詞', ko: '접속사', zh: '连词', ar: 'أدوات الربط' } },

    { tagId: 'grammar.structure.relative_clauses', category: 'grammar', parent: 'grammar.structure', depth: 'leaf', sortOrder: 4,
      labels: { en: 'Relative Clauses', es: 'Oraciones relativas', fr: 'Propositions relatives', pt: 'Orações relativas', de: 'Relativsätze', it: 'Proposizioni relative', ja: '関係節', ko: '관계절', zh: '关系从句', ar: 'الجمل الموصولة' } },

    // Comparisons
    { tagId: 'grammar.comparisons', category: 'grammar', parent: 'grammar', depth: 'subcategory', sortOrder: 5,
      labels: { en: 'Comparisons', es: 'Comparaciones', fr: 'Comparaisons', pt: 'Comparações', de: 'Vergleiche', it: 'Comparazioni', ja: '比較', ko: '비교', zh: '比较', ar: 'المقارنات' } },

    { tagId: 'grammar.comparisons.comparative', category: 'grammar', parent: 'grammar.comparisons', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Comparative', es: 'Comparativo', fr: 'Comparatif', pt: 'Comparativo', de: 'Komparativ', it: 'Comparativo', ja: '比較級', ko: '비교급', zh: '比较级', ar: 'التفضيل' } },

    { tagId: 'grammar.comparisons.superlative', category: 'grammar', parent: 'grammar.comparisons', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Superlative', es: 'Superlativo', fr: 'Superlatif', pt: 'Superlativo', de: 'Superlativ', it: 'Superlativo', ja: '最上級', ko: '최상급', zh: '最高级', ar: 'أفعل التفضيل' } },

    // ═══════════════════════════════════════════════════════
    // VOCABULARY — Category
    // ═══════════════════════════════════════════════════════
    { tagId: 'vocabulary', category: 'vocabulary', parent: null, depth: 'category', sortOrder: 1,
      labels: { en: 'Vocabulary', es: 'Vocabulario', fr: 'Vocabulaire', pt: 'Vocabulário', de: 'Wortschatz', it: 'Vocabolario', ja: '語彙', ko: '어휘', zh: '词汇', ar: 'مفردات' } },

    // Everyday life
    { tagId: 'vocabulary.everyday', category: 'vocabulary', parent: 'vocabulary', depth: 'subcategory', sortOrder: 0,
      labels: { en: 'Everyday Life', es: 'Vida cotidiana', fr: 'Vie quotidienne', pt: 'Vida cotidiana', de: 'Alltag', it: 'Vita quotidiana', ja: '日常生活', ko: '일상생활', zh: '日常生活', ar: 'الحياة اليومية' } },

    { tagId: 'vocabulary.everyday.greetings', category: 'vocabulary', parent: 'vocabulary.everyday', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Greetings & Introductions', es: 'Saludos y presentaciones', fr: 'Salutations et présentations', pt: 'Saudações e apresentações', de: 'Begrüßungen', it: 'Saluti e presentazioni', ja: '挨拶と自己紹介', ko: '인사와 소개', zh: '问候与介绍', ar: 'التحيات والتعارف' } },

    { tagId: 'vocabulary.everyday.family', category: 'vocabulary', parent: 'vocabulary.everyday', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Family', es: 'Familia', fr: 'Famille', pt: 'Família', de: 'Familie', it: 'Famiglia', ja: '家族', ko: '가족', zh: '家庭', ar: 'العائلة' } },

    { tagId: 'vocabulary.everyday.home', category: 'vocabulary', parent: 'vocabulary.everyday', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Home & Housing', es: 'Hogar y vivienda', fr: 'Maison et logement', pt: 'Casa e moradia', de: 'Haus und Wohnung', it: 'Casa e abitazione', ja: '家と住居', ko: '집과 주거', zh: '家和住房', ar: 'المنزل والسكن' } },

    { tagId: 'vocabulary.everyday.shopping', category: 'vocabulary', parent: 'vocabulary.everyday', depth: 'leaf', sortOrder: 3,
      labels: { en: 'Shopping', es: 'Compras', fr: 'Achats', pt: 'Compras', de: 'Einkaufen', it: 'Acquisti', ja: '買い物', ko: '쇼핑', zh: '购物', ar: 'التسوق' } },

    { tagId: 'vocabulary.everyday.weather', category: 'vocabulary', parent: 'vocabulary.everyday', depth: 'leaf', sortOrder: 4,
      labels: { en: 'Weather & Seasons', es: 'Clima y estaciones', fr: 'Météo et saisons', pt: 'Clima e estações', de: 'Wetter und Jahreszeiten', it: 'Tempo e stagioni', ja: '天気と季節', ko: '날씨와 계절', zh: '天气与季节', ar: 'الطقس والفصول' } },

    { tagId: 'vocabulary.everyday.time', category: 'vocabulary', parent: 'vocabulary.everyday', depth: 'leaf', sortOrder: 5,
      labels: { en: 'Time & Dates', es: 'Hora y fechas', fr: 'Heure et dates', pt: 'Horas e datas', de: 'Zeit und Datum', it: 'Ora e date', ja: '時間と日付', ko: '시간과 날짜', zh: '时间与日期', ar: 'الوقت والتواريخ' } },

    { tagId: 'vocabulary.everyday.numbers', category: 'vocabulary', parent: 'vocabulary.everyday', depth: 'leaf', sortOrder: 6,
      labels: { en: 'Numbers & Counting', es: 'Números y conteo', fr: 'Nombres et comptage', pt: 'Números e contagem', de: 'Zahlen', it: 'Numeri', ja: '数字', ko: '숫자', zh: '数字', ar: 'الأرقام' } },

    { tagId: 'vocabulary.everyday.colors', category: 'vocabulary', parent: 'vocabulary.everyday', depth: 'leaf', sortOrder: 7,
      labels: { en: 'Colors & Descriptions', es: 'Colores y descripciones', fr: 'Couleurs et descriptions', pt: 'Cores e descrições', de: 'Farben und Beschreibungen', it: 'Colori e descrizioni', ja: '色と描写', ko: '색깔과 묘사', zh: '颜色与描述', ar: 'الألوان والأوصاف' } },

    // Travel
    { tagId: 'vocabulary.travel', category: 'vocabulary', parent: 'vocabulary', depth: 'subcategory', sortOrder: 1,
      labels: { en: 'Travel', es: 'Viajes', fr: 'Voyage', pt: 'Viagem', de: 'Reisen', it: 'Viaggi', ja: '旅行', ko: '여행', zh: '旅行', ar: 'السفر' } },

    { tagId: 'vocabulary.travel.airport', category: 'vocabulary', parent: 'vocabulary.travel', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Airport & Flights', es: 'Aeropuerto y vuelos', fr: 'Aéroport et vols', pt: 'Aeroporto e voos', de: 'Flughafen und Flüge', it: 'Aeroporto e voli', ja: '空港とフライト', ko: '공항과 항공편', zh: '机场与航班', ar: 'المطار والرحلات' } },

    { tagId: 'vocabulary.travel.hotel', category: 'vocabulary', parent: 'vocabulary.travel', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Hotels & Accommodation', es: 'Hoteles y alojamiento', fr: 'Hôtels et hébergement', pt: 'Hotéis e hospedagem', de: 'Hotels und Unterkunft', it: 'Hotel e alloggio', ja: 'ホテルと宿泊', ko: '호텔과 숙박', zh: '酒店与住宿', ar: 'الفنادق والإقامة' } },

    { tagId: 'vocabulary.travel.directions', category: 'vocabulary', parent: 'vocabulary.travel', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Directions & Transport', es: 'Direcciones y transporte', fr: 'Directions et transport', pt: 'Direções e transporte', de: 'Wegbeschreibung und Transport', it: 'Indicazioni e trasporti', ja: '道案内と交通', ko: '길 안내와 교통', zh: '方向与交通', ar: 'الاتجاهات والنقل' } },

    { tagId: 'vocabulary.travel.restaurant', category: 'vocabulary', parent: 'vocabulary.travel', depth: 'leaf', sortOrder: 3,
      labels: { en: 'Restaurants & Ordering', es: 'Restaurantes y pedidos', fr: 'Restaurants et commandes', pt: 'Restaurantes e pedidos', de: 'Restaurants und Bestellen', it: 'Ristoranti e ordinare', ja: 'レストランと注文', ko: '레스토랑과 주문', zh: '餐厅与点餐', ar: 'المطاعم والطلب' } },

    // Food & Drink
    { tagId: 'vocabulary.food', category: 'vocabulary', parent: 'vocabulary', depth: 'subcategory', sortOrder: 2,
      labels: { en: 'Food & Drink', es: 'Comida y bebida', fr: 'Nourriture et boisson', pt: 'Comida e bebida', de: 'Essen und Trinken', it: 'Cibo e bevande', ja: '食べ物と飲み物', ko: '음식과 음료', zh: '食物与饮料', ar: 'الطعام والشراب' } },

    { tagId: 'vocabulary.food.cooking', category: 'vocabulary', parent: 'vocabulary.food', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Cooking & Recipes', es: 'Cocina y recetas', fr: 'Cuisine et recettes', pt: 'Culinária e receitas', de: 'Kochen und Rezepte', it: 'Cucina e ricette', ja: '料理とレシピ', ko: '요리와 레시피', zh: '烹饪与食谱', ar: 'الطبخ والوصفات' } },

    { tagId: 'vocabulary.food.ingredients', category: 'vocabulary', parent: 'vocabulary.food', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Ingredients & Foods', es: 'Ingredientes y alimentos', fr: 'Ingrédients et aliments', pt: 'Ingredientes e alimentos', de: 'Zutaten und Lebensmittel', it: 'Ingredienti e cibi', ja: '食材', ko: '재료와 식품', zh: '食材', ar: 'المكونات والأطعمة' } },

    // Work & Business
    { tagId: 'vocabulary.business', category: 'vocabulary', parent: 'vocabulary', depth: 'subcategory', sortOrder: 3,
      labels: { en: 'Work & Business', es: 'Trabajo y negocios', fr: 'Travail et affaires', pt: 'Trabalho e negócios', de: 'Arbeit und Geschäft', it: 'Lavoro e affari', ja: '仕事とビジネス', ko: '직장과 비즈니스', zh: '工作与商务', ar: 'العمل والأعمال' } },

    { tagId: 'vocabulary.business.office', category: 'vocabulary', parent: 'vocabulary.business', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Office & Workplace', es: 'Oficina y lugar de trabajo', fr: 'Bureau et lieu de travail', pt: 'Escritório e local de trabalho', de: 'Büro und Arbeitsplatz', it: 'Ufficio e posto di lavoro', ja: 'オフィスと職場', ko: '사무실과 직장', zh: '办公室与工作场所', ar: 'المكتب وبيئة العمل' } },

    { tagId: 'vocabulary.business.meetings', category: 'vocabulary', parent: 'vocabulary.business', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Meetings & Presentations', es: 'Reuniones y presentaciones', fr: 'Réunions et présentations', pt: 'Reuniões e apresentações', de: 'Meetings und Präsentationen', it: 'Riunioni e presentazioni', ja: '会議とプレゼンテーション', ko: '회의와 발표', zh: '会议与演示', ar: 'الاجتماعات والعروض' } },

    { tagId: 'vocabulary.business.emails', category: 'vocabulary', parent: 'vocabulary.business', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Emails & Correspondence', es: 'Correos y correspondencia', fr: 'Emails et correspondance', pt: 'E-mails e correspondência', de: 'E-Mails und Korrespondenz', it: 'Email e corrispondenza', ja: 'メールと通信', ko: '이메일과 서신', zh: '邮件与通信', ar: 'البريد الإلكتروني والمراسلات' } },

    // Health
    { tagId: 'vocabulary.health', category: 'vocabulary', parent: 'vocabulary', depth: 'subcategory', sortOrder: 4,
      labels: { en: 'Health & Body', es: 'Salud y cuerpo', fr: 'Santé et corps', pt: 'Saúde e corpo', de: 'Gesundheit und Körper', it: 'Salute e corpo', ja: '健康と体', ko: '건강과 신체', zh: '健康与身体', ar: 'الصحة والجسم' } },

    { tagId: 'vocabulary.health.doctor', category: 'vocabulary', parent: 'vocabulary.health', depth: 'leaf', sortOrder: 0,
      labels: { en: 'At the Doctor', es: 'En el médico', fr: 'Chez le médecin', pt: 'No médico', de: 'Beim Arzt', it: 'Dal dottore', ja: '病院で', ko: '병원에서', zh: '看医生', ar: 'عند الطبيب' } },

    { tagId: 'vocabulary.health.body_parts', category: 'vocabulary', parent: 'vocabulary.health', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Body Parts', es: 'Partes del cuerpo', fr: 'Parties du corps', pt: 'Partes do corpo', de: 'Körperteile', it: 'Parti del corpo', ja: '体の部位', ko: '신체 부위', zh: '身体部位', ar: 'أجزاء الجسم' } },

    // Culture & Entertainment
    { tagId: 'vocabulary.culture', category: 'vocabulary', parent: 'vocabulary', depth: 'subcategory', sortOrder: 5,
      labels: { en: 'Culture & Entertainment', es: 'Cultura y entretenimiento', fr: 'Culture et divertissement', pt: 'Cultura e entretenimento', de: 'Kultur und Unterhaltung', it: 'Cultura e intrattenimento', ja: '文化と娯楽', ko: '문화와 오락', zh: '文化与娱乐', ar: 'الثقافة والترفيه' } },

    { tagId: 'vocabulary.culture.music', category: 'vocabulary', parent: 'vocabulary.culture', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Music & Film', es: 'Música y cine', fr: 'Musique et cinéma', pt: 'Música e cinema', de: 'Musik und Film', it: 'Musica e cinema', ja: '音楽と映画', ko: '음악과 영화', zh: '音乐与电影', ar: 'الموسيقى والأفلام' } },

    { tagId: 'vocabulary.culture.sports', category: 'vocabulary', parent: 'vocabulary.culture', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Sports & Hobbies', es: 'Deportes y pasatiempos', fr: 'Sports et loisirs', pt: 'Esportes e hobbies', de: 'Sport und Hobbys', it: 'Sport e hobby', ja: 'スポーツと趣味', ko: '스포츠와 취미', zh: '体育与爱好', ar: 'الرياضة والهوايات' } },

    { tagId: 'vocabulary.culture.traditions', category: 'vocabulary', parent: 'vocabulary.culture', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Traditions & Holidays', es: 'Tradiciones y fiestas', fr: 'Traditions et fêtes', pt: 'Tradições e feriados', de: 'Traditionen und Feiertage', it: 'Tradizioni e festività', ja: '伝統と祝日', ko: '전통과 명절', zh: '传统与节日', ar: 'التقاليد والأعياد' } },

    // ═══════════════════════════════════════════════════════
    // SKILLS — Category
    // ═══════════════════════════════════════════════════════
    { tagId: 'skills', category: 'skills', parent: null, depth: 'category', sortOrder: 2,
      labels: { en: 'Skills', es: 'Habilidades', fr: 'Compétences', pt: 'Habilidades', de: 'Fähigkeiten', it: 'Competenze', ja: 'スキル', ko: '기술', zh: '技能', ar: 'المهارات' } },

    { tagId: 'skills.speaking', category: 'skills', parent: 'skills', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Speaking', es: 'Expresión oral', fr: 'Expression orale', pt: 'Expressão oral', de: 'Sprechen', it: 'Parlato', ja: 'スピーキング', ko: '말하기', zh: '口语', ar: 'التحدث' } },

    { tagId: 'skills.listening', category: 'skills', parent: 'skills', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Listening', es: 'Comprensión auditiva', fr: 'Compréhension orale', pt: 'Compreensão auditiva', de: 'Hörverständnis', it: 'Ascolto', ja: 'リスニング', ko: '듣기', zh: '听力', ar: 'الاستماع' } },

    { tagId: 'skills.reading', category: 'skills', parent: 'skills', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Reading', es: 'Comprensión lectora', fr: 'Compréhension écrite', pt: 'Compreensão de leitura', de: 'Leseverständnis', it: 'Lettura', ja: 'リーディング', ko: '읽기', zh: '阅读', ar: 'القراءة' } },

    { tagId: 'skills.writing', category: 'skills', parent: 'skills', depth: 'leaf', sortOrder: 3,
      labels: { en: 'Writing', es: 'Expresión escrita', fr: 'Expression écrite', pt: 'Expressão escrita', de: 'Schreiben', it: 'Scrittura', ja: 'ライティング', ko: '쓰기', zh: '写作', ar: 'الكتابة' } },

    { tagId: 'skills.pronunciation', category: 'skills', parent: 'skills', depth: 'leaf', sortOrder: 4,
      labels: { en: 'Pronunciation', es: 'Pronunciación', fr: 'Prononciation', pt: 'Pronúncia', de: 'Aussprache', it: 'Pronuncia', ja: '発音', ko: '발음', zh: '发音', ar: 'النطق' } },

    // ═══════════════════════════════════════════════════════
    // TOPICS — Category (contextual / thematic)
    // ═══════════════════════════════════════════════════════
    { tagId: 'topics', category: 'topics', parent: null, depth: 'category', sortOrder: 3,
      labels: { en: 'Topics', es: 'Temas', fr: 'Sujets', pt: 'Temas', de: 'Themen', it: 'Argomenti', ja: 'トピック', ko: '주제', zh: '主题', ar: 'مواضيع' } },

    { tagId: 'topics.conversation', category: 'topics', parent: 'topics', depth: 'leaf', sortOrder: 0,
      labels: { en: 'Conversation Practice', es: 'Práctica de conversación', fr: 'Pratique de conversation', pt: 'Prática de conversação', de: 'Konversationsübung', it: 'Pratica di conversazione', ja: '会話練習', ko: '회화 연습', zh: '会话练习', ar: 'ممارسة المحادثة' } },

    { tagId: 'topics.idioms', category: 'topics', parent: 'topics', depth: 'leaf', sortOrder: 1,
      labels: { en: 'Idioms & Expressions', es: 'Modismos y expresiones', fr: 'Idiomes et expressions', pt: 'Expressões idiomáticas', de: 'Redewendungen', it: 'Modi di dire', ja: '慣用句', ko: '관용구', zh: '成语与表达', ar: 'التعبيرات الاصطلاحية' } },

    { tagId: 'topics.formal_speech', category: 'topics', parent: 'topics', depth: 'leaf', sortOrder: 2,
      labels: { en: 'Formal Speech', es: 'Registro formal', fr: 'Langage formel', pt: 'Linguagem formal', de: 'Formelle Sprache', it: 'Linguaggio formale', ja: '敬語・丁寧語', ko: '격식체', zh: '正式语言', ar: 'اللغة الرسمية' } },

    { tagId: 'topics.slang', category: 'topics', parent: 'topics', depth: 'leaf', sortOrder: 3,
      labels: { en: 'Slang & Colloquial', es: 'Argot y coloquial', fr: 'Argot et familier', pt: 'Gírias e coloquial', de: 'Umgangssprache', it: 'Slang e colloquiale', ja: 'スラング', ko: '속어', zh: '俚语', ar: 'العامية' } },

    { tagId: 'topics.exam_prep', category: 'topics', parent: 'topics', depth: 'leaf', sortOrder: 4,
      labels: { en: 'Exam Preparation', es: 'Preparación para exámenes', fr: "Préparation d'examens", pt: 'Preparação para exames', de: 'Prüfungsvorbereitung', it: 'Preparazione esami', ja: '試験対策', ko: '시험 준비', zh: '考试准备', ar: 'التحضير للامتحانات' } },

    { tagId: 'topics.academic', category: 'topics', parent: 'topics', depth: 'leaf', sortOrder: 5,
      labels: { en: 'Academic Language', es: 'Lenguaje académico', fr: 'Langage académique', pt: 'Linguagem acadêmica', de: 'Akademische Sprache', it: 'Linguaggio accademico', ja: 'アカデミック', ko: '학술 언어', zh: '学术语言', ar: 'اللغة الأكاديمية' } },

    { tagId: 'topics.children', category: 'topics', parent: 'topics', depth: 'leaf', sortOrder: 6,
      labels: { en: 'For Children', es: 'Para niños', fr: 'Pour enfants', pt: 'Para crianças', de: 'Für Kinder', it: 'Per bambini', ja: '子供向け', ko: '어린이용', zh: '儿童', ar: 'للأطفال' } },
  ];
}

module.exports = router;
