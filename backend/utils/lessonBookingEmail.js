const fs = require('fs');
const path = require('path');
const axios = require('axios');
const emailService = require('../services/emailService');
const { formatNameWithInitial, formatFirstName } = require('./nameFormatter');
const { resolveEmailFrontendUrl } = require('./appUrl');

const I18N_PATH = path.join(__dirname, 'lessonBookingEmail.i18n.json');
const TUTOR_I18N_PATH = path.join(__dirname, 'lessonBookingTutorEmail.i18n.json');
const I18N = JSON.parse(fs.readFileSync(I18N_PATH, 'utf8'));
const TUTOR_I18N = JSON.parse(fs.readFileSync(TUTOR_I18N_PATH, 'utf8'));
const EN_STUDENT = I18N.en;
const EN_TUTOR = TUTOR_I18N.en;

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

const DEFAULT_SUPPORT_EMAIL = 'support@languageapp.com';
const MASCOT_CARD_REGULAR_FILE = 'mascot-email-regular.png';
const MASCOT_CARD_TRIAL_FILE = 'mascot-email-first-step.png';

function resolveMascotCardImageUrl(isTrialLesson) {
  const file = isTrialLesson ? MASCOT_CARD_TRIAL_FILE : MASCOT_CARD_REGULAR_FILE;
  const explicitBase = process.env.EMAIL_ASSET_BASE_URL?.trim().replace(/\/$/, '');
  if (explicitBase) {
    return `${explicitBase}/${file}`;
  }

  const bucket = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'languager-videos-2025';
  const gcsBase = process.env.EMAIL_MASCOT_GCS_BASE?.trim().replace(/\/$/, '')
    || `https://storage.googleapis.com/${bucket}/email-assets`;
  return `${gcsBase}/${file}`;
}

function normalizeLocale(locale) {
  const code = String(locale || 'en').trim().toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.includes(code) ? code : 'en';
}

function pickLocaleStrings(locale) {
  const code = normalizeLocale(locale);
  return I18N[code] || I18N.en;
}

function pickTutorLocaleStrings(locale) {
  const code = normalizeLocale(locale);
  return TUTOR_I18N[code] || TUTOR_I18N.en;
}

function interpolate(template, params) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (
    params[key] !== undefined && params[key] !== null ? String(params[key]) : ''
  ));
}

function resolveLessonLanguage(lesson, tutor, fallback = 'language') {
  if (lesson.bookingData?.selectedLanguage) {
    return lesson.bookingData.selectedLanguage;
  }
  if (lesson.subject && lesson.subject !== 'Language Lesson') {
    return lesson.subject.replace(/\s+Lesson$/i, '').trim();
  }
  if (tutor?.onboardingData?.languages?.length) {
    return tutor.onboardingData.languages[0];
  }
  return fallback;
}

function formatLessonDateTime(startTime, locale, timezone) {
  const date = new Date(startTime);
  const intlLocale = LOCALE_MAP[normalizeLocale(locale)] || 'en-US';
  const tz = timezone || 'UTC';

  const lessonDate = new Intl.DateTimeFormat(intlLocale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: tz
  }).format(date);

  const lessonTime = new Intl.DateTimeFormat(intlLocale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: intlLocale.startsWith('en') || ['ar', 'hi'].includes(normalizeLocale(locale)),
    timeZone: tz
  }).format(date);

  return { lessonDate, lessonTime };
}

function formatLessonDateTimeLine(startTime, locale, timezone) {
  const date = new Date(startTime);
  const intlLocale = LOCALE_MAP[normalizeLocale(locale)] || 'en-US';
  const tz = timezone || 'UTC';

  return new Intl.DateTimeFormat(intlLocale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: intlLocale.startsWith('en') || ['ar', 'hi'].includes(normalizeLocale(locale)),
    timeZone: tz
  }).format(date);
}

function buildParticipantFields(person, lesson, locale, timezone) {
  const firstName = formatFirstName(person);
  return {
    participantFirstName: firstName,
    participantInitial: (firstName || '?').charAt(0).toUpperCase(),
    participantImageUrl: person?.picture || '',
    lessonDateTimeLine: formatLessonDateTimeLine(lesson.startTime, locale, timezone)
  };
}

async function loadStudentPlanContext(student, language, tutorId) {
  const { GOAL_TYPE_LABELS, LEVEL_LABELS } = require('../services/learningPlanService');
  const perTutorLane = require('../services/perTutorLaneService');
  const LearningPlan = require('../models/LearningPlan');

  let goalValue = '';
  let levelValue = '';
  let focusValue = '';

  const onboardingGoal = student?.onboardingData?.learningGoal;
  if (onboardingGoal?.type) {
    goalValue = GOAL_TYPE_LABELS[onboardingGoal.type] || onboardingGoal.type;
    if (onboardingGoal.description) {
      goalValue += ` — ${onboardingGoal.description}`;
    }
  }
  if (onboardingGoal?.selfAssessedLevel) {
    levelValue = LEVEL_LABELS[onboardingGoal.selfAssessedLevel] || onboardingGoal.selfAssessedLevel;
  }

  if (!student?._id || !language) {
    return {
      hasContext: Boolean(goalValue || levelValue || focusValue),
      goalValue,
      levelValue,
      focusValue
    };
  }

  try {
    const plan = await LearningPlan.findOne({
      studentId: student._id,
      language,
      status: { $in: ['draft', 'active', 'completed', 'mastery_mode', 'unframed', 'paused'] }
    }).lean();

    if (plan?.goal?.type) {
      goalValue = GOAL_TYPE_LABELS[plan.goal.type] || plan.goal.type;
      if (plan.goal.description) {
        goalValue += ` — ${plan.goal.description}`;
      }
    }
    if (plan?.selfAssessedLevel) {
      levelValue = LEVEL_LABELS[plan.selfAssessedLevel] || plan.selfAssessedLevel;
    }
    if (plan) {
      const resolved = tutorId
        ? perTutorLane.resolveFocusForTutor(plan, String(tutorId))
        : { focus: plan.nextLessonFocus };
      focusValue = resolved?.focus || plan.nextLessonFocus || '';
    }
  } catch (error) {
    console.warn('[EMAIL] Could not load learning plan for booking email:', error.message);
  }

  return {
    hasContext: Boolean(goalValue || levelValue || focusValue),
    goalValue,
    levelValue,
    focusValue
  };
}

function getEmailLinkBaseUrl() {
  return resolveEmailFrontendUrl();
}

function buildLessonBookedTemplateData({
  student,
  tutor,
  lesson,
  language,
  isTrialLesson = false,
  planContext = null
}) {
  const locale = normalizeLocale(student?.interfaceLanguage || student?.profile?.preferredLanguage);
  const strings = pickLocaleStrings(locale);
  const variant = isTrialLesson ? strings.trial : strings.regular;
  const enVariant = isTrialLesson ? EN_STUDENT.trial : EN_STUDENT.regular;
  const studentName = formatFirstName(student);
  const tutorName = formatNameWithInitial(tutor);
  const tutorFirstName = formatFirstName(tutor);
  const lessonLanguage = language || resolveLessonLanguage(lesson, tutor);
  const timezone = student?.profile?.timezone || 'UTC';
  const { lessonDate, lessonTime } = formatLessonDateTime(lesson.startTime, locale, timezone);
  const linkBaseUrl = getEmailLinkBaseUrl();
  const lessonId = lesson._id?.toString?.() || lesson.id;

  const params = {
    studentName,
    tutorName,
    tutorFirstName,
    language: lessonLanguage,
    minutes: lesson.duration || 50
  };

  const participantFields = buildParticipantFields(tutor, lesson, locale, timezone);
  const showFirstLessonGuide = isTrialLesson;

  return {
    locale,
    brandName: 'Barnabi',
    brandMascotImageUrl: `${linkBaseUrl}/assets/mascot-toolbar.png`,
    brandWordmarkImageUrl: `${linkBaseUrl}/assets/barnabi-logo.png`,
    emailEyebrow: variant.emailEyebrow,
    emailTitle: variant.emailTitle,
    emailIntro: variant.emailIntro || '',
    emailGreeting: interpolate(variant.emailGreeting, params),
    emailBody: interpolate(variant.emailBody, params),
    ...participantFields,
    showFirstLessonGuide,
    firstLessonGuideTitle: variant.firstLessonGuideTitle || enVariant.firstLessonGuideTitle || '',
    firstLessonGuideIntro: interpolate(
      variant.firstLessonGuideIntro || enVariant.firstLessonGuideIntro || '',
      params
    ),
    firstLessonBullet1: interpolate(
      variant.firstLessonBullet1 || enVariant.firstLessonBullet1 || '',
      params
    ),
    firstLessonBullet2: interpolate(
      variant.firstLessonBullet2 || enVariant.firstLessonBullet2 || '',
      params
    ),
    firstLessonBullet3: interpolate(
      variant.firstLessonBullet3 || enVariant.firstLessonBullet3 || '',
      params
    ),
    mascotImageUrl: resolveMascotCardImageUrl(isTrialLesson),
    mascotTitle: variant.mascotTitle,
    mascotText: variant.mascotText,
    lessonDetailsTitle: strings.lessonDetailsTitle,
    tutorLabel: strings.tutorLabel,
    tutorName,
    dateLabel: strings.dateLabel,
    lessonDate,
    timeLabel: strings.timeLabel,
    lessonTime,
    durationLabel: strings.durationLabel,
    lessonDuration: interpolate(strings.durationMinutes, params),
    languageLabel: strings.languageLabel,
    lessonLanguage,
    lessonTypeLabel: strings.lessonTypeLabel,
    lessonType: variant.lessonType,
    lessonUrl: `${linkBaseUrl}/tabs/lessons/${lessonId}`,
    viewLessonButton: strings.viewLessonButton,
    dashboardText: strings.dashboardText,
    dashboardUrl: `${linkBaseUrl}/tabs/home`,
    dashboardLinkText: strings.dashboardLinkText,
    footerReason: strings.footerReason,
    footerHelpText: strings.footerHelpText,
    supportEmail: process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL,
    subject: interpolate(variant.subject, params) || interpolate(enVariant.subject, params)
      || (isTrialLesson
        ? `Your trial ${lessonLanguage} lesson with ${tutorName} is confirmed`
        : `Your ${lessonLanguage} lesson with ${tutorName} is confirmed`),
    showStudentContext: false
  };
}

function buildLessonBookedTutorTemplateData({
  student,
  tutor,
  lesson,
  language,
  isTrialLesson = false,
  planContext = null
}) {
  const locale = normalizeLocale(tutor?.interfaceLanguage || tutor?.profile?.preferredLanguage);
  const strings = pickTutorLocaleStrings(locale);
  const variant = isTrialLesson ? strings.trial : strings.regular;
  const tutorFirstName = formatFirstName(tutor);
  const studentName = formatNameWithInitial(student);
  const studentFirstName = formatFirstName(student);
  const lessonLanguage = language || resolveLessonLanguage(lesson, tutor);
  const timezone = tutor?.profile?.timezone || 'UTC';
  const { lessonDate, lessonTime } = formatLessonDateTime(lesson.startTime, locale, timezone);
  const linkBaseUrl = getEmailLinkBaseUrl();
  const lessonId = lesson._id?.toString?.() || lesson.id;
  const ctx = planContext || {
    hasContext: false,
    goalValue: '',
    levelValue: '',
    focusValue: ''
  };

  const params = {
    tutorFirstName,
    studentName,
    studentFirstName,
    language: lessonLanguage,
    minutes: lesson.duration || 50
  };

  const participantFields = buildParticipantFields(student, lesson, locale, timezone);

  return {
    locale,
    brandName: 'Barnabi',
    brandMascotImageUrl: `${linkBaseUrl}/assets/mascot-toolbar.png`,
    brandWordmarkImageUrl: `${linkBaseUrl}/assets/barnabi-logo.png`,
    emailEyebrow: variant.emailEyebrow,
    emailTitle: variant.emailTitle,
    emailIntro: variant.emailIntro || '',
    emailGreeting: interpolate(variant.emailGreeting, params),
    emailBody: interpolate(variant.emailBody, params),
    ...participantFields,
    showFirstLessonGuide: false,
    firstLessonGuideTitle: '',
    firstLessonGuideIntro: '',
    firstLessonBullet1: '',
    firstLessonBullet2: '',
    firstLessonBullet3: '',
    showStudentContext: ctx.hasContext,
    showStudentContextGoal: Boolean(ctx.goalValue),
    showStudentContextLevel: Boolean(ctx.levelValue),
    showStudentContextFocus: Boolean(ctx.focusValue),
    studentContextTitle: interpolate(
      strings.studentContextTitle || EN_TUTOR.studentContextTitle,
      params
    ),
    studentContextGoalLabel: strings.studentContextGoalLabel || EN_TUTOR.studentContextGoalLabel,
    studentContextGoalValue: ctx.goalValue,
    studentContextLevelLabel: strings.studentContextLevelLabel || EN_TUTOR.studentContextLevelLabel,
    studentContextLevelValue: ctx.levelValue,
    studentContextFocusLabel: strings.studentContextFocusLabel || EN_TUTOR.studentContextFocusLabel,
    studentContextFocusValue: ctx.focusValue,
    mascotImageUrl: resolveMascotCardImageUrl(isTrialLesson),
    mascotTitle: variant.mascotTitle,
    mascotText: variant.mascotText,
    lessonDetailsTitle: strings.lessonDetailsTitle,
    tutorLabel: strings.studentLabel,
    tutorName: studentName,
    dateLabel: strings.dateLabel,
    lessonDate,
    timeLabel: strings.timeLabel,
    lessonTime,
    durationLabel: strings.durationLabel,
    lessonDuration: interpolate(strings.durationMinutes, params),
    languageLabel: strings.languageLabel,
    lessonLanguage,
    lessonTypeLabel: strings.lessonTypeLabel,
    lessonType: variant.lessonType,
    lessonUrl: `${linkBaseUrl}/tabs/lessons/${lessonId}`,
    viewLessonButton: strings.viewLessonButton,
    dashboardText: strings.dashboardText,
    dashboardUrl: `${linkBaseUrl}/tabs/tutor-calendar`,
    dashboardLinkText: strings.dashboardLinkText,
    footerReason: strings.footerReason,
    footerHelpText: strings.footerHelpText,
    supportEmail: process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL,
    subject: interpolate(variant.subject, params) || interpolate(
      (isTrialLesson ? EN_TUTOR.trial : EN_TUTOR.regular).subject,
      params
    ) || (isTrialLesson
      ? `${studentName} booked a trial ${lessonLanguage} lesson with you`
      : `${studentName} booked a ${lessonLanguage} lesson with you`)
  };
}

async function sendEmailResult({
  sendFn,
  recipientEmail,
  recipientLabel,
  dynamicTemplateData,
  isConfigured = () => emailService.isConfigured()
}) {
  const config = emailService.getConfigStatus();
  const configured = isConfigured();

  if (!recipientEmail) {
    console.log(`📧 [EMAIL] Skipping lesson booked ${recipientLabel} email — no email`);
    return {
      sent: false,
      reason: `no_${recipientLabel}_email`,
      configured: config.configured,
      config
    };
  }

  if (!configured) {
    console.log(`📧 [EMAIL] SendGrid lesson booked ${recipientLabel} email skipped — not configured`);
    return {
      sent: false,
      reason: 'sendgrid_not_configured',
      configured: false,
      config,
      to: recipientEmail
    };
  }

  try {
    await sendFn({
      to: recipientEmail,
      dynamicTemplateData,
      subject: dynamicTemplateData.subject
    });

    console.log(`📧 [EMAIL] Sent lesson booked email to ${recipientLabel}:`, recipientEmail);

    return {
      sent: true,
      to: recipientEmail,
      subject: dynamicTemplateData.subject,
      configured: true,
      config
    };
  } catch (error) {
    const sendGridError = error?.response?.body || error.message;
    console.error(`📧 [EMAIL] Failed to send lesson booked email to ${recipientLabel}:`, sendGridError);
    return {
      sent: false,
      reason: 'sendgrid_error',
      configured: true,
      config,
      to: recipientEmail,
      subject: dynamicTemplateData.subject,
      error: typeof sendGridError === 'string' ? sendGridError : JSON.stringify(sendGridError)
    };
  }
}

/**
 * Send the student a SendGrid confirmation email after a lesson is booked.
 * Non-blocking callers should `.catch()` this promise.
 */
async function sendLessonBookedEmail({
  student,
  tutor,
  lesson,
  language,
  isTrialLesson = false
}) {
  const planContext = await loadStudentPlanContext(student, language, tutor?._id);
  const dynamicTemplateData = buildLessonBookedTemplateData({
    student,
    tutor,
    lesson,
    language,
    isTrialLesson,
    planContext
  });

  return sendEmailResult({
    sendFn: emailService.sendLessonBookedEmail.bind(emailService),
    recipientEmail: student?.email,
    recipientLabel: 'student',
    dynamicTemplateData
  });
}

async function sendLessonBookedTutorEmail({
  student,
  tutor,
  lesson,
  language,
  isTrialLesson = false
}) {
  const planContext = await loadStudentPlanContext(student, language, tutor?._id);
  const dynamicTemplateData = buildLessonBookedTutorTemplateData({
    student,
    tutor,
    lesson,
    language,
    isTrialLesson,
    planContext
  });

  return sendEmailResult({
    sendFn: emailService.sendLessonBookedTutorEmail.bind(emailService),
    recipientEmail: tutor?.email,
    recipientLabel: 'tutor',
    dynamicTemplateData,
    isConfigured: () => emailService.isTutorConfigured()
  });
}

async function sendLessonBookedEmails({
  student,
  tutor,
  lesson,
  language,
  isTrialLesson = false
}) {
  const [studentResult, tutorResult] = await Promise.all([
    sendLessonBookedEmail({ student, tutor, lesson, language, isTrialLesson }),
    sendLessonBookedTutorEmail({ student, tutor, lesson, language, isTrialLesson })
  ]);

  return { student: studentResult, tutor: tutorResult };
}

function resolveLessonLanguageFromEntities(lesson, tutor) {
  return resolveLessonLanguage(lesson, tutor);
}

async function loadLessonBookingContext(lessonId) {
  const Lesson = require('../models/Lesson');
  const lesson = await Lesson.findById(lessonId)
    .populate('tutorId', 'name firstName lastName email picture interfaceLanguage onboardingData auth0Id profile')
    .populate('studentId', 'name firstName lastName email picture auth0Id interfaceLanguage profile onboardingData');

  if (!lesson) {
    const err = new Error('Lesson not found');
    err.statusCode = 404;
    throw err;
  }

  const student = lesson.studentId;
  const tutor = lesson.tutorId;
  const language = resolveLessonLanguage(lesson, tutor);
  const isTrialLesson = !!lesson.isTrialLesson;

  return {
    student,
    tutor,
    lesson,
    language,
    isTrialLesson,
    planContext: await loadStudentPlanContext(student, language, tutor?._id),
    payload: { student, tutor, lesson, language, isTrialLesson }
  };
}

async function checkPublicUrl(url) {
  if (!url) {
    return { url, ok: false, status: null, error: 'missing_url' };
  }
  try {
    const response = await axios.head(url, {
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true
    });
    return {
      url,
      ok: response.status >= 200 && response.status < 400,
      status: response.status
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      error: error.message
    };
  }
}

function summarizeRecipientDebug({
  role,
  to,
  templateData,
  configured,
  templateId
}) {
  return {
    role,
    to: to || null,
    configured,
    wouldSend: Boolean(to && configured),
    templateId: templateId || null,
    locale: templateData.locale,
    subject: templateData.subject,
    emailTitle: templateData.emailTitle,
    emailEyebrow: templateData.emailEyebrow,
    mascotTitle: templateData.mascotTitle,
    lessonUrl: templateData.lessonUrl,
    dashboardUrl: templateData.dashboardUrl,
    brandMascotImageUrl: templateData.brandMascotImageUrl,
    brandWordmarkImageUrl: templateData.brandWordmarkImageUrl,
    mascotImageUrl: templateData.mascotImageUrl
  };
}

async function getLessonBookedEmailDebugForLessonId(lessonId) {
  const ctx = await loadLessonBookingContext(lessonId);
  const studentTemplateData = buildLessonBookedTemplateData({
    ...ctx.payload,
    planContext: ctx.planContext
  });
  const tutorTemplateData = buildLessonBookedTutorTemplateData({
    ...ctx.payload,
    planContext: ctx.planContext
  });
  const config = emailService.getConfigStatus();

  const studentSummary = summarizeRecipientDebug({
    role: 'student',
    to: ctx.student?.email,
    templateData: studentTemplateData,
    configured: emailService.isConfigured(),
    templateId: config.templateId
  });

  const tutorSummary = summarizeRecipientDebug({
    role: 'tutor',
    to: ctx.tutor?.email,
    templateData: tutorTemplateData,
    configured: emailService.isTutorConfigured(),
    templateId: config.tutorTemplateId || config.templateId
  });

  const urlsToCheck = [
    studentSummary.brandMascotImageUrl,
    studentSummary.brandWordmarkImageUrl,
    studentSummary.mascotImageUrl,
    tutorSummary.mascotImageUrl
  ];
  const uniqueUrls = [...new Set(urlsToCheck.filter(Boolean))];
  const urlChecks = await Promise.all(uniqueUrls.map((url) => checkPublicUrl(url)));
  const urlCheckMap = Object.fromEntries(urlChecks.map((check) => [check.url, check]));

  const attachUrlChecks = (summary) => ({
    ...summary,
    urlChecks: {
      brandMascotImageUrl: urlCheckMap[summary.brandMascotImageUrl] || null,
      brandWordmarkImageUrl: urlCheckMap[summary.brandWordmarkImageUrl] || null,
      mascotImageUrl: urlCheckMap[summary.mascotImageUrl] || null
    }
  });

  return {
    success: true,
    lessonId: ctx.lesson._id?.toString?.() || lessonId,
    isTrialLesson: ctx.isTrialLesson,
    language: ctx.language,
    sendGrid: config,
    student: attachUrlChecks(studentSummary),
    tutor: attachUrlChecks(tutorSummary),
    hints: [
      'SendGrid template Subject must be set to {{subject}} (or {{{subject}}}).',
      'Gmail cannot load localhost image URLs — card mascots use public GCS URLs.',
      'Brand header images use the deployed frontend /assets URLs.',
      'Set SENDGRID_LESSON_BOOKED_TUTOR_TEMPLATE_ID only if tutors use a separate template.'
    ]
  };
}

async function sendLessonBookedEmailForLessonId(lessonId, { recipient = 'student' } = {}) {
  const ctx = await loadLessonBookingContext(lessonId);
  const payload = ctx.payload;

  if (recipient === 'tutor') {
    return sendLessonBookedTutorEmail(payload);
  }
  if (recipient === 'both') {
    return sendLessonBookedEmails(payload);
  }
  return sendLessonBookedEmail(payload);
}

module.exports = {
  buildLessonBookedTemplateData,
  buildLessonBookedTutorTemplateData,
  loadStudentPlanContext,
  sendLessonBookedEmail,
  sendLessonBookedTutorEmail,
  sendLessonBookedEmails,
  sendLessonBookedEmailForLessonId,
  getLessonBookedEmailDebugForLessonId,
  resolveLessonLanguageFromEntities,
  normalizeLocale,
  SUPPORTED_LOCALES
};
