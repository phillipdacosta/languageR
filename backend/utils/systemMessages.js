/**
 * System Messages Utility
 *
 * Builds structured, multilingual system messages for various tutor-facing
 * events (trial booking, student interest, etc.).
 *
 * Architecture:
 *
 *   1. Each event has a TEMPLATE id (e.g. `trial_lesson_booked`,
 *      `student_interest`). Templates live in TEMPLATE_RENDERERS below.
 *
 *   2. `buildSystemMessage({ template, ... })` is the single factory used by
 *      every system-message trigger. It:
 *        a) Extracts a flat `params` object from the entities (student,
 *           tutor, lesson, plan, etc.).
 *        b) Renders a localized `content` string in the tutor's CURRENT
 *           interface language at write time (graceful fallback / for
 *           clients that consume the raw `content` field).
 *        c) Returns { template, params, locale, content, triggerType }
 *           ready to be persisted on Message.
 *
 *   3. `renderSystemMessage({ template, params }, locale)` re-renders the
 *      same payload in any locale at read time (e.g. if the tutor switches
 *      UI language).
 *
 *   4. The on-disk dictionary holds STATIC strings only. Dynamic fields
 *      (goal description, phase title, focus, struggles) are passed through
 *      verbatim — they're in the student's hand-typed language or in
 *      canonical skill keys produced by the analysis pipeline.
 *
 * Adding a new locale: add entries to systemMessages.i18n.json (or re-run
 * backend/scripts/translate_system_messages_i18n.py) and they are merged
 * into STRINGS at load time. Missing locales fall back to `en`.
 */

const {
  deriveTopStruggles,
  deriveEncouragementHints,
  isInRecoveryDip
} = require('../services/tutorBriefingService');

const SUPPORTED_LOCALES = [
  'en', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi',
  'nl', 'pl', 'tr', 'sv', 'no', 'da', 'fi', 'el', 'cs', 'ro', 'uk', 'vi',
  'th', 'id', 'ms', 'he', 'fa'
];

const LOCALE_MAP = {
  en: 'en-US', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR',
  it: 'it-IT', ru: 'ru-RU', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
  ar: 'ar-SA', hi: 'hi-IN', nl: 'nl-NL', pl: 'pl-PL', tr: 'tr-TR',
  sv: 'sv-SE', no: 'nb-NO', da: 'da-DK', fi: 'fi-FI', el: 'el-GR',
  cs: 'cs-CZ', ro: 'ro-RO', uk: 'uk-UA', vi: 'vi-VN', th: 'th-TH',
  id: 'id-ID', ms: 'ms-MY', he: 'he-IL', fa: 'fa-IR'
};

// ─────────────────────────────────────────────────────────────────────────
//  Static dictionaries (per-template, per-locale)
//
//  Core trial_lesson_booked strings for es/de/fr/pt live here. All other
//  locales + student_interest are merged from systemMessages.i18n.json.
// ─────────────────────────────────────────────────────────────────────────

const STRINGS = {
  trial_lesson_booked: {
    en: {
      title: 'New Trial Lesson Scheduled',
      intro: 'A new student has booked a trial lesson with you.',
      studentLabel: 'Student',
      dateLabel: 'Date',
      startTimeLabel: 'Start Time',
      durationLabel: 'Duration',
      durationMinutes: (m) => `${m} minutes`,
      preparationIntro: "This is your first session together, so it's a great opportunity to make a strong impression. Here are a few suggestions to help you prepare:",
      tip1: "Review the student's [profile]({{profileUrl}}) to understand their level, goals, and interests.",
      tip2: 'Arrive a few minutes early—you can join the lesson directly from your Home Page or the Lessons tab.',
      tip3: 'Prepare a short introduction activity to help break the ice and understand their speaking ability.',
      tip4: 'Ask about their objectives and preferred learning style; this will help guide future lessons.',
      tip5: 'Be welcoming and supportive—trial sessions often determine whether the student will continue with you.',
      supportText: 'If you have any questions, feel free to contact support at any time.',
      journeyTitle: 'Their journey so far',
      journeyGoalLabel: 'Goal',
      journeyLevelLabel: 'Self-assessed level',
      journeyCefrLabel: 'Working level',
      journeyPhaseLabel: 'Current phase',
      journeyFocusLabel: 'Suggested focus',
      strugglesTitle: 'What they tend to struggle with',
      encouragementTitle: 'Ways to encourage them',
      recoveryNote: 'Heads up: this student has recently had a confidence dip. Favor wins over corrections and consolidate before pushing new material.'
    },
    es: {
      title: 'Nueva Lección de Prueba Programada',
      intro: 'Un nuevo estudiante ha reservado una lección de prueba contigo.',
      studentLabel: 'Estudiante',
      dateLabel: 'Fecha',
      startTimeLabel: 'Hora de Inicio',
      durationLabel: 'Duración',
      durationMinutes: (m) => `${m} minutos`,
      preparationIntro: 'Esta es su primera sesión juntos, así que es una gran oportunidad para causar una buena impresión. Aquí hay algunas sugerencias para ayudarte a prepararte:',
      tip1: 'Revisa el [perfil]({{profileUrl}}) del estudiante para comprender su nivel, objetivos e intereses.',
      tip2: 'Llega unos minutos antes: puedes unirte a la lección directamente desde tu Página Principal o la pestaña de Lecciones.',
      tip3: 'Prepara una actividad de introducción corta para romper el hielo y comprender su capacidad de hablar.',
      tip4: 'Pregunta sobre sus objetivos y estilo de aprendizaje preferido; esto ayudará a guiar las lecciones futuras.',
      tip5: 'Sé acogedor y solidario: las sesiones de prueba a menudo determinan si el estudiante continuará contigo.',
      supportText: 'Si tienes alguna pregunta, no dudes en contactar al soporte en cualquier momento.',
      journeyTitle: 'Su trayectoria hasta ahora',
      journeyGoalLabel: 'Objetivo',
      journeyLevelLabel: 'Nivel autoevaluado',
      journeyPhaseLabel: 'Fase actual',
      journeyFocusLabel: 'Enfoque sugerido'
    },
    de: {
      title: 'Neue Probestunde geplant',
      intro: 'Ein neuer Schüler hat eine Probestunde mit Ihnen gebucht.',
      studentLabel: 'Schüler',
      dateLabel: 'Datum',
      startTimeLabel: 'Startzeit',
      durationLabel: 'Dauer',
      durationMinutes: (m) => `${m} Minuten`,
      preparationIntro: 'Dies ist Ihre erste gemeinsame Sitzung, also eine großartige Gelegenheit, einen guten Eindruck zu hinterlassen. Hier sind einige Vorschläge, die Ihnen bei der Vorbereitung helfen:',
      tip1: 'Überprüfen Sie das [Profil]({{profileUrl}}) des Schülers, um sein Niveau, seine Ziele und Interessen zu verstehen.',
      tip2: 'Kommen Sie ein paar Minuten früher an—Sie können der Lektion direkt von Ihrer Startseite oder der Lektionen-Registerkarte beitreten.',
      tip3: 'Bereiten Sie eine kurze Einführungsaktivität vor, um das Eis zu brechen und ihre Sprechfähigkeit zu verstehen.',
      tip4: 'Fragen Sie nach ihren Zielen und bevorzugtem Lernstil; dies wird helfen, zukünftige Lektionen zu gestalten.',
      tip5: 'Seien Sie freundlich und unterstützend—Probesitzungen bestimmen oft, ob der Schüler bei Ihnen weitermachen wird.',
      supportText: 'Wenn Sie Fragen haben, können Sie sich jederzeit an den Support wenden.',
      journeyTitle: 'Sein bisheriger Lernweg',
      journeyGoalLabel: 'Ziel',
      journeyLevelLabel: 'Selbsteingeschätztes Niveau',
      journeyPhaseLabel: 'Aktuelle Phase',
      journeyFocusLabel: 'Vorgeschlagener Schwerpunkt'
    },
    fr: {
      title: 'Nouvelle leçon d\'essai programmée',
      intro: 'Un nouvel étudiant a réservé une leçon d\'essai avec vous.',
      studentLabel: 'Étudiant',
      dateLabel: 'Date',
      startTimeLabel: 'Heure de début',
      durationLabel: 'Durée',
      durationMinutes: (m) => `${m} minutes`,
      preparationIntro: "C'est votre première session ensemble, c'est donc une excellente occasion de faire bonne impression. Voici quelques suggestions pour vous aider à vous préparer:",
      tip1: "Consultez le [profil]({{profileUrl}}) de l'étudiant pour comprendre son niveau, ses objectifs et ses intérêts.",
      tip2: "Arrivez quelques minutes en avance—vous pouvez rejoindre la leçon directement depuis votre page d'accueil ou l'onglet Leçons.",
      tip3: "Préparez une courte activité d'introduction pour briser la glace et comprendre leur capacité d'expression.",
      tip4: 'Renseignez-vous sur leurs objectifs et leur style d\'apprentissage préféré ; cela aidera à guider les futures leçons.',
      tip5: "Soyez accueillant et encourageant—les sessions d'essai déterminent souvent si l'étudiant continuera avec vous.",
      supportText: "Si vous avez des questions, n'hésitez pas à contacter le support à tout moment.",
      journeyTitle: "Son parcours jusqu'à présent",
      journeyGoalLabel: 'Objectif',
      journeyLevelLabel: 'Niveau auto-évalué',
      journeyPhaseLabel: 'Phase actuelle',
      journeyFocusLabel: 'Focus suggéré'
    },
    pt: {
      title: 'Nova Aula Experimental Agendada',
      intro: 'Um novo aluno reservou uma aula experimental com você.',
      studentLabel: 'Aluno',
      dateLabel: 'Data',
      startTimeLabel: 'Horário de Início',
      durationLabel: 'Duração',
      durationMinutes: (m) => `${m} minutos`,
      preparationIntro: 'Esta é a primeira sessão de vocês juntos, portanto é uma ótima oportunidade para causar uma boa impressão. Aqui estão algumas sugestões para ajudá-lo a se preparar:',
      tip1: 'Revise o [perfil]({{profileUrl}}) do aluno para entender seu nível, objetivos e interesses.',
      tip2: 'Chegue alguns minutos mais cedo—você pode entrar na aula diretamente da sua Página Inicial ou da aba Aulas.',
      tip3: 'Prepare uma atividade de introdução curta para quebrar o gelo e entender sua capacidade de falar.',
      tip4: 'Pergunte sobre seus objetivos e estilo de aprendizagem preferido; isso ajudará a orientar as aulas futuras.',
      tip5: 'Seja acolhedor e solidário—as sessões experimentais muitas vezes determinam se o aluno continuará com você.',
      supportText: 'Se você tiver alguma dúvida, sinta-se à vontade para entrar em contato com o suporte a qualquer momento.',
      journeyTitle: 'Sua jornada até agora',
      journeyGoalLabel: 'Objetivo',
      journeyLevelLabel: 'Nível autoavaliado',
      journeyPhaseLabel: 'Fase atual',
      journeyFocusLabel: 'Foco sugerido'
    }
  },

  // student_interest — en inline; all other locales merged from i18n JSON.
  student_interest: {
    en: {
      titleFavorite: 'A student saved your profile',
      titleBookLesson: 'A student is about to book with you',
      introFavorite: '{{studentName}} saved your profile and may want to learn {{languageText}} with you.',
      introBookLesson: '{{studentName}} started booking a {{languageText}} lesson with you but hasn\'t finalized it yet.',
      noPlanFallback: 'They haven\'t built out a learning plan yet, so a warm, curious first message can go a long way — ask what brought them to {{languageText}} and what they\'d like to get out of lessons.',
      journeyTitle: 'What we know about their journey',
      journeyGoalLabel: 'Goal',
      journeyLevelLabel: 'Self-assessed level',
      journeyCefrLabel: 'Working level',
      journeyPhaseLabel: 'Current phase',
      journeyFocusLabel: 'Currently working on',
      strugglesTitle: 'Where they tend to struggle',
      encouragementTitle: 'Ways to encourage them',
      ctaTitle: 'How to win them over',
      ctaTipReachOut: 'Send a short, personal message — reference their goal so they feel seen.',
      ctaTipMethodology: 'Briefly share how you\'d approach their level and goal — concrete trumps generic.',
      ctaTipQuestion: 'Invite a question back ("anything you\'d like to know about how I teach?") to keep the conversation going.',
      recoveryNote: 'Heads up: they\'ve had a confidence dip recently. Lead with reassurance, not pressure.',
      supportText: 'If you have any questions, feel free to contact support at any time.'
    }
  }
};

// Merge auto-translated locale packs (student_interest + trial supplement keys).
const I18N = require('./systemMessages.i18n.json');

for (const [locale, strings] of Object.entries(I18N.student_interest || {})) {
  if (locale === 'en') continue;
  STRINGS.student_interest[locale] = strings;
}

for (const [locale, supplement] of Object.entries(I18N.trial_lesson_booked_supplement || {})) {
  if (locale === 'en') continue;
  if (!STRINGS.trial_lesson_booked[locale]) {
    STRINGS.trial_lesson_booked[locale] = {};
  }
  Object.assign(STRINGS.trial_lesson_booked[locale], supplement);
}

// ─────────────────────────────────────────────────────────────────────────
//  Locale helpers
// ─────────────────────────────────────────────────────────────────────────

function pickLocaleStrings(template, locale) {
  const dict = STRINGS[template];
  if (!dict) throw new Error(`Unknown system-message template: ${template}`);
  // Per-key fallback to English so partial translations don't produce
  // "undefined" strings. A locale that's been only half-translated will
  // show the translated keys it has and English for the rest, which is
  // strictly better than rendering broken markup.
  if (locale === 'en' || !dict[locale]) return dict.en;
  return { ...dict.en, ...dict[locale] };
}

function normalizeLocale(locale) {
  if (!locale) return 'en';
  const lc = String(locale).toLowerCase();
  return SUPPORTED_LOCALES.includes(lc) ? lc : 'en';
}

function formatDateForLocale(date, locale) {
  const intlLocale = LOCALE_MAP[locale] || 'en-US';
  return date.toLocaleDateString(intlLocale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function formatTimeForLocale(date, locale) {
  const intlLocale = LOCALE_MAP[locale] || 'en-US';
  return date.toLocaleTimeString(intlLocale, {
    hour: 'numeric', minute: '2-digit', hour12: locale === 'en'
  });
}

function interpolate(str, params) {
  if (!str) return '';
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = params?.[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

// ─────────────────────────────────────────────────────────────────────────
//  Param extractors — pure functions over plain entities. No I/O.
//
//  These DON'T fetch anything. The factory hands in everything it needs.
//  Keeping it pure means buildSystemMessage stays cheap and testable.
// ─────────────────────────────────────────────────────────────────────────

function buildJourneyParamsFromPlan(plan) {
  if (!plan) return null;

  const phaseIdx = plan.currentPhaseIndex ?? 0;
  const phase = (plan.phases || [])[phaseIdx] || null;
  const totalPhases = (plan.phases || []).length;

  return {
    goalType: (plan.goal?.type || '').trim() || null,
    goalDescription: (plan.goal?.description || '').trim() || null,
    selfLevel: (plan.selfAssessedLevel || '').replace(/_/g, ' ').trim() || null,
    cefrLevel: plan.revealedCefrLevel?.level
            || plan.internalCefrEstimate?.level
            || plan.chapterLevel
            || null,
    phaseTitle: (phase?.title || '').trim() || null,
    phaseIdx: typeof phaseIdx === 'number' ? phaseIdx : null,
    totalPhases: totalPhases || null,
    nextFocus: (plan.nextLessonFocus || '').trim() || null,
    activeFocusSkillId: plan.activeFocusSkillId || null,
    activeFocusSource: plan.activeFocusSource || null
  };
}

function formatLanguageList(languages) {
  const list = (languages || []).filter(Boolean);
  if (list.length === 0) return 'language';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// ─────────────────────────────────────────────────────────────────────────
//  Render helpers
// ─────────────────────────────────────────────────────────────────────────

function renderJourneyBlock(params, t) {
  const lines = [];
  if (params.goalDescription || params.goalType) {
    lines.push(`• ${t.journeyGoalLabel}: <strong>${params.goalDescription || params.goalType}</strong>`);
  }
  if (params.selfLevel) {
    lines.push(`• ${t.journeyLevelLabel}: ${params.selfLevel}`);
  }
  if (params.cefrLevel && t.journeyCefrLabel) {
    lines.push(`• ${t.journeyCefrLabel}: <strong>${params.cefrLevel}</strong>`);
  }
  if (params.phaseTitle) {
    const frag = params.totalPhases
      ? `<strong>${params.phaseTitle}</strong> (${(params.phaseIdx ?? 0) + 1}/${params.totalPhases})`
      : `<strong>${params.phaseTitle}</strong>`;
    lines.push(`• ${t.journeyPhaseLabel}: ${frag}`);
  }
  if (params.nextFocus) {
    lines.push(`• ${t.journeyFocusLabel}: ${params.nextFocus}`);
  }
  if (!lines.length) return '';

  return `\n\n<strong>${t.journeyTitle}</strong>\n\n${lines.join('\n')}`;
}

function renderBulletedSection(title, items) {
  if (!items || items.length === 0) return '';
  if (!title) return '';
  const bullets = items.map(s => `• ${s}`).join('\n');
  return `\n\n<strong>${title}</strong>\n\n${bullets}`;
}

// ─────────────────────────────────────────────────────────────────────────
//  Template renderers
// ─────────────────────────────────────────────────────────────────────────

const TEMPLATE_RENDERERS = {
  trial_lesson_booked(params, locale) {
    const t = pickLocaleStrings('trial_lesson_booked', locale);
    const startTime = params.startTime ? new Date(params.startTime) : null;
    const date = startTime ? formatDateForLocale(startTime, locale) : '';
    const time = startTime ? formatTimeForLocale(startTime, locale) : '';

    const profileUrl = `/student/${params.studentId || ''}`;
    const tip1 = interpolate(t.tip1, { profileUrl });
    const durationStr = typeof t.durationMinutes === 'function'
      ? t.durationMinutes(params.duration)
      : `${params.duration}`;

    const journeyBlock = renderJourneyBlock(params, t);
    const strugglesBlock = renderBulletedSection(t.strugglesTitle, params.struggles);
    const encouragementBlock = renderBulletedSection(t.encouragementTitle, params.encouragement);
    const recoveryNote = params.recoveryDip && t.recoveryNote
      ? `\n\n<em>${t.recoveryNote}</em>`
      : '';

    return `<strong>${t.title}</strong>

${t.intro}

${t.studentLabel}: ${params.studentName}
${t.dateLabel}: <strong>${date}</strong>
${t.startTimeLabel}: <strong>${time}</strong>
${t.durationLabel}: ${durationStr}${journeyBlock}${strugglesBlock}${encouragementBlock}${recoveryNote}

${t.preparationIntro}

• ${tip1}

• ${t.tip2}

• ${t.tip3}

• ${t.tip4}

• ${t.tip5}

${t.supportText}`;
  },

  student_interest(params, locale) {
    const t = pickLocaleStrings('student_interest', locale);
    const isFavorite = params.triggerType === 'favorite';
    const title = isFavorite ? t.titleFavorite : t.titleBookLesson;
    const introTpl = isFavorite ? t.introFavorite : t.introBookLesson;
    const intro = interpolate(introTpl, {
      studentName: params.studentName,
      languageText: params.languageText
    });

    const hasPlan = !!(params.goalType || params.goalDescription
      || params.phaseTitle || params.nextFocus || params.cefrLevel);

    const body = hasPlan
      ? renderJourneyBlock(params, t)
      : `\n\n${interpolate(t.noPlanFallback, { languageText: params.languageText })}`;

    const strugglesBlock = renderBulletedSection(t.strugglesTitle, params.struggles);
    const encouragementBlock = renderBulletedSection(t.encouragementTitle, params.encouragement);
    const recoveryNote = params.recoveryDip && t.recoveryNote
      ? `\n\n<em>${t.recoveryNote}</em>`
      : '';

    const ctaTips = [t.ctaTipReachOut, t.ctaTipMethodology, t.ctaTipQuestion];
    const ctaBlock = renderBulletedSection(t.ctaTitle, ctaTips);

    return `👋 <strong>${title}</strong>

${intro}${body}${strugglesBlock}${encouragementBlock}${recoveryNote}${ctaBlock}

${t.supportText}`;
  }
};

// ─────────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a system message from entities. Single entry point for every
 * trigger (trial booking, student interest, future events).
 *
 * @param {Object}  opts
 * @param {String}  opts.template        Template id (e.g. 'trial_lesson_booked').
 * @param {Object}  opts.student         { _id, displayName }
 * @param {Object}  opts.tutor           { _id, interfaceLanguage, onboardingData, profile }
 * @param {Object}  [opts.lesson]        { startTime, duration } — for booking templates.
 * @param {Object}  [opts.plan]          LearningPlan POJO (lean()'d).
 * @param {String}  [opts.triggerType]   'favorite' | 'book_lesson' (for student_interest).
 * @param {Object}  [opts.extras]        Template-specific extra params.
 * @returns {{ template, params, locale, content, triggerType }}
 */
function buildSystemMessage(opts) {
  const { template, student, tutor, lesson, plan, triggerType, extras = {} } = opts || {};
  if (!template) throw new Error('buildSystemMessage: template is required');
  if (!TEMPLATE_RENDERERS[template]) throw new Error(`buildSystemMessage: unknown template ${template}`);

  const locale = normalizeLocale(tutor?.interfaceLanguage);

  const studentName = student?.displayName || student?.name || 'A student';
  const studentId = student?._id ? String(student._id) : null;

  const journey = buildJourneyParamsFromPlan(plan);
  const struggles = deriveTopStruggles(plan);
  const encouragement = deriveEncouragementHints(plan);
  const recoveryDip = isInRecoveryDip(plan);

  const tutorLanguages = tutor?.onboardingData?.languages || tutor?.profile?.languages || [];
  const languageText = formatLanguageList(tutorLanguages);

  const params = {
    studentName,
    studentId,
    languageText,
    triggerType: triggerType || null,
    ...(journey || {}),
    struggles,
    encouragement,
    recoveryDip,
    ...(lesson ? {
      startTime: lesson.startTime instanceof Date
        ? lesson.startTime.toISOString()
        : (lesson.startTime || null),
      duration: lesson.duration || null,
      lessonId: lesson._id
        ? String(lesson._id)
        : (lesson.id ? String(lesson.id) : null)
    } : {}),
    ...extras
  };

  const content = TEMPLATE_RENDERERS[template](params, locale);

  return { template, params, locale, content, triggerType: triggerType || null };
}

/**
 * Re-render a stored system message in a different locale.
 *
 * @param {{ template: string, params: Object }} payload
 * @param {String} locale
 * @returns {String} rendered content
 */
function renderSystemMessage(payload, locale) {
  if (!payload || !payload.template) return '';
  const renderer = TEMPLATE_RENDERERS[payload.template];
  if (!renderer) return '';
  return renderer(payload.params || {}, normalizeLocale(locale));
}

// ─────────────────────────────────────────────────────────────────────────
//  Backward-compat shim
//
//  Existing call sites use generateTrialLessonMessage(...). Keep it working
//  but route through the new factory so the rendering paths can't drift.
// ─────────────────────────────────────────────────────────────────────────

function generateTrialLessonMessage({ studentName, studentId, startTime, duration, tutorLanguage = 'en', plan = null }) {
  return buildSystemMessage({
    template: 'trial_lesson_booked',
    student: { _id: studentId, displayName: studentName },
    tutor: { interfaceLanguage: tutorLanguage },
    lesson: { startTime, duration },
    plan
  }).content;
}

function buildJourneyBlock({ plan, tutorLanguage = 'en' }) {
  const params = buildJourneyParamsFromPlan(plan);
  if (!params) return '';
  const t = pickLocaleStrings('trial_lesson_booked', normalizeLocale(tutorLanguage));
  return renderJourneyBlock(params, t);
}

module.exports = {
  buildSystemMessage,
  renderSystemMessage,
  buildJourneyParamsFromPlan,
  // Backward compat
  generateTrialLessonMessage,
  buildJourneyBlock
};
