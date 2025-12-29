/**
 * System Messages Utility
 * Generates multilingual system messages for various events
 */

// Translation dictionary for trial lesson system messages
const translations = {
  en: {
    title: 'New Trial Lesson Scheduled',
    intro: 'A new student has booked a trial lesson with you.',
    studentLabel: 'Student',
    dateLabel: 'Date',
    startTimeLabel: 'Start Time',
    durationLabel: 'Duration',
    durationMinutes: (minutes) => `${minutes} minutes`,
    preparationIntro: "This is your first session together, so it's a great opportunity to make a strong impression. Here are a few suggestions to help you prepare:",
    tip1: "Review the student's [profile]({{profileUrl}}) to understand their level, goals, and interests.",
    tip2: "Arrive a few minutes early—you can join the lesson directly from your Home Page or the Lessons tab.",
    tip3: "Prepare a short introduction activity to help break the ice and understand their speaking ability.",
    tip4: "Ask about their objectives and preferred learning style; this will help guide future lessons.",
    tip5: "Be welcoming and supportive—trial sessions often determine whether the student will continue with you.",
    supportText: "If you have any questions, feel free to contact support at any time."
  },
  es: {
    title: 'Nueva Lección de Prueba Programada',
    intro: 'Un nuevo estudiante ha reservado una lección de prueba contigo.',
    studentLabel: 'Estudiante',
    dateLabel: 'Fecha',
    startTimeLabel: 'Hora de Inicio',
    durationLabel: 'Duración',
    durationMinutes: (minutes) => `${minutes} minutos`,
    preparationIntro: 'Esta es su primera sesión juntos, así que es una gran oportunidad para causar una buena impresión. Aquí hay algunas sugerencias para ayudarte a prepararte:',
    tip1: 'Revisa el [perfil]({{profileUrl}}) del estudiante para comprender su nivel, objetivos e intereses.',
    tip2: 'Llega unos minutos antes: puedes unirte a la lección directamente desde tu Página Principal o la pestaña de Lecciones.',
    tip3: 'Prepara una actividad de introducción corta para romper el hielo y comprender su capacidad de hablar.',
    tip4: 'Pregunta sobre sus objetivos y estilo de aprendizaje preferido; esto ayudará a guiar las lecciones futuras.',
    tip5: 'Sé acogedor y solidario: las sesiones de prueba a menudo determinan si el estudiante continuará contigo.',
    supportText: 'Si tienes alguna pregunta, no dudes en contactar al soporte en cualquier momento.'
  },
  de: {
    title: 'Neue Probestunde geplant',
    intro: 'Ein neuer Schüler hat eine Probestunde mit Ihnen gebucht.',
    studentLabel: 'Schüler',
    dateLabel: 'Datum',
    startTimeLabel: 'Startzeit',
    durationLabel: 'Dauer',
    durationMinutes: (minutes) => `${minutes} Minuten`,
    preparationIntro: 'Dies ist Ihre erste gemeinsame Sitzung, also eine großartige Gelegenheit, einen guten Eindruck zu hinterlassen. Hier sind einige Vorschläge, die Ihnen bei der Vorbereitung helfen:',
    tip1: 'Überprüfen Sie das [Profil]({{profileUrl}}) des Schülers, um sein Niveau, seine Ziele und Interessen zu verstehen.',
    tip2: 'Kommen Sie ein paar Minuten früher an—Sie können der Lektion direkt von Ihrer Startseite oder der Lektionen-Registerkarte beitreten.',
    tip3: 'Bereiten Sie eine kurze Einführungsaktivität vor, um das Eis zu brechen und ihre Sprechfähigkeit zu verstehen.',
    tip4: 'Fragen Sie nach ihren Zielen und bevorzugtem Lernstil; dies wird helfen, zukünftige Lektionen zu gestalten.',
    tip5: 'Seien Sie freundlich und unterstützend—Probesitzungen bestimmen oft, ob der Schüler bei Ihnen weitermachen wird.',
    supportText: 'Wenn Sie Fragen haben, können Sie sich jederzeit an den Support wenden.'
  },
  fr: {
    title: 'Nouvelle leçon d\'essai programmée',
    intro: 'Un nouvel étudiant a réservé une leçon d\'essai avec vous.',
    studentLabel: 'Étudiant',
    dateLabel: 'Date',
    startTimeLabel: 'Heure de début',
    durationLabel: 'Durée',
    durationMinutes: (minutes) => `${minutes} minutes`,
    preparationIntro: 'C\'est votre première session ensemble, c\'est donc une excellente occasion de faire bonne impression. Voici quelques suggestions pour vous aider à vous préparer:',
    tip1: 'Consultez le [profil]({{profileUrl}}) de l\'étudiant pour comprendre son niveau, ses objectifs et ses intérêts.',
    tip2: 'Arrivez quelques minutes en avance—vous pouvez rejoindre la leçon directement depuis votre page d\'accueil ou l\'onglet Leçons.',
    tip3: 'Préparez une courte activité d\'introduction pour briser la glace et comprendre leur capacité d\'expression.',
    tip4: 'Renseignez-vous sur leurs objectifs et leur style d\'apprentissage préféré ; cela aidera à guider les futures leçons.',
    tip5: 'Soyez accueillant et encourageant—les sessions d\'essai déterminent souvent si l\'étudiant continuera avec vous.',
    supportText: 'Si vous avez des questions, n\'hésitez pas à contacter le support à tout moment.'
  },
  pt: {
    title: 'Nova Aula Experimental Agendada',
    intro: 'Um novo aluno reservou uma aula experimental com você.',
    studentLabel: 'Aluno',
    dateLabel: 'Data',
    startTimeLabel: 'Horário de Início',
    durationLabel: 'Duração',
    durationMinutes: (minutes) => `${minutes} minutos`,
    preparationIntro: 'Esta é a primeira sessão de vocês juntos, portanto é uma ótima oportunidade para causar uma boa impressão. Aqui estão algumas sugestões para ajudá-lo a se preparar:',
    tip1: 'Revise o [perfil]({{profileUrl}}) do aluno para entender seu nível, objetivos e interesses.',
    tip2: 'Chegue alguns minutos mais cedo—você pode entrar na aula diretamente da sua Página Inicial ou da aba Aulas.',
    tip3: 'Prepare uma atividade de introdução curta para quebrar o gelo e entender sua capacidade de falar.',
    tip4: 'Pergunte sobre seus objetivos e estilo de aprendizagem preferido; isso ajudará a orientar as aulas futuras.',
    tip5: 'Seja acolhedor e solidário—as sessões experimentais muitas vezes determinam se o aluno continuará com você.',
    supportText: 'Se você tiver alguma dúvida, sinta-se à vontade para entrar em contato com o suporte a qualquer momento.'
  }
};

/**
 * Generate a trial lesson system message in the tutor's preferred language
 * @param {Object} params - Message parameters
 * @param {string} params.studentName - The student's name
 * @param {string} params.studentId - The student's ID for profile link
 * @param {Date} params.startTime - Lesson start time
 * @param {number} params.duration - Lesson duration in minutes
 * @param {string} params.tutorLanguage - Tutor's interface language (en, es, de, fr, pt)
 * @returns {string} Formatted markdown message
 */
function generateTrialLessonMessage({ studentName, studentId, startTime, duration, tutorLanguage = 'en' }) {
  // Default to English if language not supported
  const lang = translations[tutorLanguage] || translations.en;
  
  // Format date and time
  const date = startTime.toLocaleDateString(tutorLanguage === 'en' ? 'en-US' : tutorLanguage === 'es' ? 'es-ES' : tutorLanguage === 'de' ? 'de-DE' : tutorLanguage === 'fr' ? 'fr-FR' : 'pt-BR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const time = startTime.toLocaleTimeString(tutorLanguage === 'en' ? 'en-US' : tutorLanguage === 'es' ? 'es-ES' : tutorLanguage === 'de' ? 'de-DE' : tutorLanguage === 'fr' ? 'fr-FR' : 'pt-BR', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: tutorLanguage === 'en'
  });
  
  // Build profile URL (frontend route)
  const profileUrl = `/student/${studentId}`;
  
  // Replace profile URL placeholder in tip1
  const tip1 = lang.tip1.replace('{{profileUrl}}', profileUrl);
  
  // Build the message (plain text format with HTML for bold)
  const message = `<strong>${lang.title}</strong>

${lang.intro}

${lang.studentLabel}: ${studentName}
${lang.dateLabel}: <strong>${date}</strong>
${lang.startTimeLabel}: <strong>${time}</strong>
${lang.durationLabel}: ${typeof lang.durationMinutes === 'function' ? lang.durationMinutes(duration) : lang.durationMinutes}

${lang.preparationIntro}

• ${tip1}

• ${lang.tip2}

• ${lang.tip3}

• ${lang.tip4}

• ${lang.tip5}

${lang.supportText}`;

  return message;
}

module.exports = {
  generateTrialLessonMessage
};

