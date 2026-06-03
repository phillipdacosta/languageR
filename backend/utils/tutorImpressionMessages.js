/**
 * Tutor quick-impression celebration messages for the student inbox.
 *
 * When a tutor selects excellent / great / good (not needs-work) and sends a
 * note, we surface a Preply-style celebratory line + icon in the thread.
 * Copy is rendered in the student's interfaceLanguage at write time and stored
 * on Message.systemMessage for re-rendering.
 */

const Message = require('../models/Message');
const User = require('../models/User');
const { formatNameWithInitial } = require('./nameFormatter');

const SUPPORTED_LOCALES = [
  'en', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi',
  'nl', 'pl', 'tr', 'sv', 'no', 'da', 'fi', 'el', 'cs', 'ro', 'uk', 'vi',
  'th', 'id', 'ms', 'he', 'fa'
];

const CELEBRATION_IMPRESSIONS = new Set(['excellent', 'great', 'good']);

const ICON_KEYS = {
  excellent: ['excellent-rock-on', 'excellent-star', 'excellent-fire', 'excellent-trophy', 'excellent-sparkles'],
  great: ['great-clap', 'great-muscle', 'great-check', 'great-star', 'great-hands'],
  good: ['good-thumbs', 'good-heart', 'good-seedling', 'good-sun', 'good-chart']
};

const STRINGS = {
  excellent: {
    en: [
      '{{tutorName}} was really impressed with how you showed up in today\'s lesson.',
      '{{tutorName}} flagged your last session as top-tier — seriously strong work.',
      'That lesson stood out. {{tutorName}} noticed the extra spark.',
      '{{tutorName}} left glowing feedback after your latest lesson.',
      'Your tutor saw excellence today — {{tutorName}} wanted you to know.'
    ],
    es: [
      '{{tutorName}} quedó muy impresionado con cómo te presentaste en la lección de hoy.',
      '{{tutorName}} marcó tu última sesión como de primer nivel — trabajo muy sólido.',
      'Esa lección destacó. {{tutorName}} notó algo especial.',
      '{{tutorName}} dejó un comentario muy positivo después de tu última lección.',
      'Tu tutor vio excelencia hoy — {{tutorName}} quería que lo supieras.'
    ],
    fr: [
      '{{tutorName}} a été vraiment impressionné par ta prestation dans la leçon d\'aujourd\'hui.',
      '{{tutorName}} a classé ta dernière séance au top — travail vraiment solide.',
      'Cette leçon s\'est démarquée. {{tutorName}} a remarqué un vrai plus.',
      '{{tutorName}} a laissé un retour très positif après ta dernière leçon.',
      'Ton tuteur a vu de l\'excellence aujourd\'hui — {{tutorName}} voulait te le dire.'
    ]
  },
  great: {
    en: [
      '{{tutorName}} thought your last lesson went really well.',
      'Solid session today — {{tutorName}} noticed the progress you made.',
      '{{tutorName}} singled out your last lesson for strong performance.',
      'Your tutor walked away from today feeling good about your work.',
      '{{tutorName}} marked this lesson as a clear step forward.'
    ],
    es: [
      'A {{tutorName}} le pareció que tu última lección fue muy buena.',
      'Sesión sólida hoy — {{tutorName}} notó el progreso que hiciste.',
      '{{tutorName}} destacó tu última lección por un buen desempeño.',
      'Tu tutor terminó hoy con buenas sensaciones sobre tu trabajo.',
      '{{tutorName}} marcó esta lección como un paso claro hacia adelante.'
    ],
    fr: [
      '{{tutorName}} a trouvé que ta dernière leçon s\'est très bien passée.',
      'Belle séance aujourd\'hui — {{tutorName}} a remarqué tes progrès.',
      '{{tutorName}} a souligné ta dernière leçon pour sa bonne performance.',
      'Ton tuteur repart de cette séance avec une bonne impression de ton travail.',
      '{{tutorName}} voit cette leçon comme une vraie avancée.'
    ]
  },
  good: {
    en: [
      '{{tutorName}} noticed the effort you brought to today\'s lesson.',
      'Your tutor appreciated how you showed up in this session — keep building on it.',
      '{{tutorName}} highlighted your commitment in the latest lesson.',
      'Steady effort today — {{tutorName}} sees you putting in the work.',
      '{{tutorName}} wanted to acknowledge the energy you brought to class.'
    ],
    es: [
      '{{tutorName}} notó el esfuerzo que pusiste en la lección de hoy.',
      'Tu tutor valoró cómo te presentaste en esta sesión — sigue construyendo sobre eso.',
      '{{tutorName}} destacó tu compromiso en la última lección.',
      'Esfuerzo constante hoy — {{tutorName}} ve que estás trabajando duro.',
      '{{tutorName}} quiso reconocer la energía que trajiste a clase.'
    ],
    fr: [
      '{{tutorName}} a remarqué l\'effort que tu as mis dans la leçon d\'aujourd\'hui.',
      'Ton tuteur a apprécié ta présence dans cette séance — continue sur cette lancée.',
      '{{tutorName}} a souligné ton engagement lors de la dernière leçon.',
      'Effort régulier aujourd\'hui — {{tutorName}} voit que tu travailles dur.',
      '{{tutorName}} voulait saluer l\'énergie que tu as apportée en cours.'
    ]
  }
};

function normalizeLocale(locale) {
  if (!locale) return 'en';
  const lc = String(locale).toLowerCase().split(/[-_]/)[0].trim();
  return SUPPORTED_LOCALES.includes(lc) ? lc : 'en';
}

function interpolate(str, params) {
  if (!str) return '';
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = params?.[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function pickVariantStrings(impression, locale) {
  const bucket = STRINGS[impression];
  if (!bucket) return null;
  const localized = bucket[locale] || bucket.en;
  return localized && localized.length ? localized : bucket.en;
}

function pickRandomVariation(impression) {
  const icons = ICON_KEYS[impression] || ICON_KEYS.good;
  const index = Math.floor(Math.random() * 5);
  return {
    variation: index + 1,
    iconKey: icons[index] || icons[0]
  };
}

/**
 * @param {{ tutorName: string, impression: string, locale?: string }} opts
 */
function buildTutorImpressionCelebration(opts) {
  const impression = String(opts?.impression || '').trim().toLowerCase();
  if (!CELEBRATION_IMPRESSIONS.has(impression)) {
    return null;
  }

  const locale = normalizeLocale(opts?.locale);
  const variants = pickVariantStrings(impression, locale);
  const { variation, iconKey } = pickRandomVariation(impression);
  const textTemplate = variants[variation - 1] || variants[0];
  const params = {
    tutorName: opts?.tutorName || 'Your tutor',
    impression,
    variation,
    iconKey
  };

  return {
    template: 'tutor_impression_celebration',
    locale,
    params,
    content: interpolate(textTemplate, params),
    iconKey
  };
}

function renderTutorImpressionCelebration(payload, locale) {
  if (!payload || payload.template !== 'tutor_impression_celebration') {
    return payload?.content || '';
  }
  const impression = payload.params?.impression;
  const variation = payload.params?.variation || 1;
  const variants = pickVariantStrings(impression, normalizeLocale(locale));
  if (!variants) return payload.content || '';
  const textTemplate = variants[variation - 1] || variants[0];
  return interpolate(textTemplate, {
    ...payload.params,
    tutorName: payload.params?.tutorName || 'Your tutor'
  });
}

/**
 * Persist a celebration message in the tutor–student thread and optionally
 * push it over the socket to the student.
 */
async function sendTutorImpressionCelebrationMessage({
  lesson,
  tutor,
  student,
  quickImpression,
  io,
  connectedUsers
}) {
  const impression = String(quickImpression || '').trim().toLowerCase();
  if (!CELEBRATION_IMPRESSIONS.has(impression)) {
    return null;
  }

  let studentUser = student;
  if (!studentUser?.auth0Id && lesson?.studentId) {
    studentUser = await User.findById(lesson.studentId).select('auth0Id interfaceLanguage firstName lastName name picture');
  }
  let tutorUser = tutor;
  if (!tutorUser?.auth0Id && lesson?.tutorId) {
    tutorUser = await User.findById(lesson.tutorId).select('auth0Id firstName lastName name picture');
  }

  if (!studentUser?.auth0Id || !tutorUser?.auth0Id) {
    console.warn('[tutor-impression] Missing auth0Ids; skipping celebration message');
    return null;
  }

  const built = buildTutorImpressionCelebration({
    tutorName: formatNameWithInitial(tutorUser),
    impression,
    locale: studentUser.interfaceLanguage || 'en'
  });
  if (!built) return null;

  const ids = [studentUser.auth0Id, tutorUser.auth0Id].sort();
  const conversationId = `${ids[0]}_${ids[1]}`;

  const saved = await Message.create({
    conversationId,
    senderId: 'system',
    receiverId: studentUser.auth0Id,
    content: built.content,
    type: 'system',
    isSystemMessage: true,
    visibleToTutorOnly: false,
    read: false,
    systemMessage: {
      template: built.template,
      params: built.params,
      locale: built.locale
    }
  });

  const messageResponse = {
    id: saved._id.toString(),
    conversationId: saved.conversationId,
    senderId: saved.senderId,
    receiverId: saved.receiverId,
    content: saved.content,
    type: saved.type,
    isSystemMessage: true,
    systemMessage: saved.systemMessage,
    read: saved.read,
    createdAt: saved.createdAt
  };

  if (io) {
    io.to(`user:${studentUser.auth0Id}`).emit('new_message', messageResponse);
    io.to(`mongo:${studentUser._id}`).emit('new_message', messageResponse);
  }

  console.log('[tutor-impression] Celebration message sent', {
    conversationId,
    impression,
    variation: built.params.variation,
    iconKey: built.params.iconKey,
    locale: built.locale
  });

  return saved;
}

module.exports = {
  CELEBRATION_IMPRESSIONS,
  ICON_KEYS,
  buildTutorImpressionCelebration,
  renderTutorImpressionCelebration,
  sendTutorImpressionCelebrationMessage
};
