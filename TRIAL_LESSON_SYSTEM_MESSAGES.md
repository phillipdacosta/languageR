# Trial Lesson System Messages

## Overview

This feature automatically sends a professional, multilingual system message to tutors when a student books their first lesson (trial lesson). The message provides helpful preparation tips and includes clickable links to the student's profile.

## Features

### ✅ Multilingual Support
System messages are sent in the tutor's preferred interface language:
- **English** (en)
- **Spanish** (es)
- **German** (de)
- **French** (fr)
- **Portuguese** (pt)

### ✅ Professional Content
The message includes:
- **Student Information**: Name and profile link
- **Lesson Details**: Date, time, and duration
- **Preparation Tips**: 5 actionable suggestions
- **Support Information**: Contact details for assistance

### ✅ Smart Delivery
- Sent only for **trial lessons** (first lesson with a tutor)
- Delivered via existing messaging infrastructure
- Real-time WebSocket notification
- Marked as `visibleToTutorOnly` to prevent student confusion
- Appears in Messages tab with system message styling

## Technical Implementation

### Backend Components

#### 1. System Messages Utility (`backend/utils/systemMessages.js`)

**Purpose**: Generate multilingual system messages

**Key Function**:
```javascript
generateTrialLessonMessage({
  studentName,      // Student's display name
  studentId,        // For profile link
  startTime,        // Lesson start time (Date object)
  duration,         // Lesson duration in minutes
  tutorLanguage     // Tutor's interface language (en|es|de|fr|pt)
})
```

**Returns**: Formatted Markdown message with:
- Localized date/time formatting
- Translated content
- Clickable profile link

#### 2. Lesson Creation Route Update (`backend/routes/lessons.js`)

**Changes**:
```javascript
// Import additions
const Message = require('../models/Message');
const { generateTrialLessonMessage } = require('../utils/systemMessages');

// After creating trial lesson notification (lines 437-489)
if (isTrialLesson) {
  // Get tutor's language preference
  const tutorLanguage = tutor.interfaceLanguage || 'en';
  
  // Generate message
  const systemMessageContent = generateTrialLessonMessage({...});
  
  // Create system message
  await Message.create({
    conversationId,
    senderId: 'system',
    receiverId: tutor._id.toString(),
    content: systemMessageContent,
    type: 'system',
    isSystemMessage: true,
    visibleToTutorOnly: true,
    triggerType: 'book_lesson'
  });
  
  // WebSocket notification
  if (req.io && req.connectedUsers) {
    emit('new_message', {...});
  }
}
```

### Frontend Components

#### Translation Keys

Added to all 5 language files (`language-learning-app/src/assets/i18n/*.json`):

```json
"MESSAGES": {
  "TRIAL_LESSON_SYSTEM_MESSAGE": {
    "TITLE": "New Trial Lesson Scheduled",
    "INTRO": "A new student has booked a trial lesson with you.",
    "STUDENT_LABEL": "Student",
    "DATE_LABEL": "Date",
    "START_TIME_LABEL": "Start Time",
    "DURATION_LABEL": "Duration",
    "DURATION_MINUTES": "{{duration}} minutes",
    "PREPARATION_INTRO": "This is your first session together...",
    "TIP_1": "Review the student's",
    "TIP_1_LINK": "profile",
    "TIP_1_SUFFIX": "to understand their level, goals, and interests.",
    "TIP_2": "Arrive a few minutes early...",
    "TIP_3": "Prepare a short introduction activity...",
    "TIP_4": "Ask about their objectives...",
    "TIP_5": "Be welcoming and supportive...",
    "SUPPORT_TEXT": "If you have any questions, feel free to contact support..."
  }
}
```

**Note**: Frontend UI for rendering the system message already exists in the messaging components. Messages with `type: 'system'` and `isSystemMessage: true` are automatically styled differently.

## Message Content

### English Example

```markdown
**New Trial Lesson Scheduled**

A new student has booked a trial lesson with you.

**Student:** John D.

**Date:** Monday, December 19, 2025

**Start Time:** 3:00 PM

**Duration:** 50 minutes

This is your first session together, so it's a great opportunity to make a strong impression. Here are a few suggestions to help you prepare:

• Review the student's [profile](/tabs/profile/abc123) to understand their level, goals, and interests.

• Arrive a few minutes early—you can join the lesson directly from your Home Page or the Lessons tab.

• Prepare a short introduction activity to help break the ice and understand their speaking ability.

• Ask about their objectives and preferred learning style; this will help guide future lessons.

• Be welcoming and supportive—trial sessions often determine whether the student will continue with you.

If you have any questions, feel free to contact support at any time.
```

### Spanish Example

```markdown
**Nueva Lección de Prueba Programada**

Un nuevo estudiante ha reservado una lección de prueba contigo.

**Estudiante:** John D.

**Fecha:** lunes, 19 de diciembre de 2025

**Hora de Inicio:** 15:00

**Duración:** 50 minutos

Esta es su primera sesión juntos, así que es una gran oportunidad para causar una buena impresión. Aquí hay algunas sugerencias para ayudarte a prepararte:

• Revisa el [perfil](/tabs/profile/abc123) del estudiante para comprender su nivel, objetivos e intereses.

• Llega unos minutos antes: puedes unirte a la lección directamente desde tu Página Principal o la pestaña de Lecciones.

• Prepara una actividad de introducción corta para romper el hielo y comprender su capacidad de hablar.

• Pregunta sobre sus objetivos y estilo de aprendizaje preferido; esto ayudará a guiar las lecciones futuras.

• Sé acogedor y solidario: las sesiones de prueba a menudo determinan si el estudiante continuará contigo.

Si tienes alguna pregunta, no dudes en contactar al soporte en cualquier momento.
```

## How It Works

### 1. Trial Lesson Detection

```javascript
// Check if this is the student's first lesson with this tutor
const previousLessons = await Lesson.countDocuments({
  tutorId: tutorId,
  studentId: studentId,
  isOfficeHours: { $ne: true },
  status: { $in: ['scheduled', 'in_progress', 'completed'] }
});

const isTrialLesson = previousLessons === 0;
```

**Office hours sessions are excluded** from trial eligibility.

### 2. Message Generation

```javascript
// Get tutor's language preference
const tutorLanguage = tutor.interfaceLanguage || 'en';

// Generate localized message
const systemMessageContent = generateTrialLessonMessage({
  studentName: "John D.",
  studentId: "abc123",
  startTime: new Date("2025-12-19T15:00:00"),
  duration: 50,
  tutorLanguage: "es"  // Spanish
});
```

### 3. Message Storage

```javascript
// Create message in database
await Message.create({
  conversationId: Message.getConversationId(tutorId, studentId),
  senderId: 'system',
  receiverId: tutorId,
  content: systemMessageContent,
  type: 'system',
  isSystemMessage: true,
  visibleToTutorOnly: true,    // Student doesn't see this
  triggerType: 'book_lesson',  // For analytics
  read: false
});
```

### 4. Real-Time Notification

```javascript
// Notify tutor via WebSocket
if (tutorSocketId) {
  req.io.to(tutorSocketId).emit('new_message', {
    conversationId,
    type: 'system',
    isSystemMessage: true,
    message: 'You have a new system message about your trial lesson'
  });
}
```

## User Experience

### For Tutors

1. **Student books trial lesson**
2. **Tutor receives notification** (bell icon)
3. **Opens Messages tab**
4. **Sees system message** (distinct styling)
5. **Clicks student profile link** (opens in new tab)
6. **Reviews preparation tips**
7. **Arrives prepared for lesson**

### For Students

- **No system message visible** (visibleToTutorOnly: true)
- **Normal booking confirmation** (existing notification)
- **Can message tutor normally**

## Localization Details

### Date/Time Formatting

Each language uses appropriate locale formatting:

```javascript
// English: Monday, December 19, 2025 | 3:00 PM
lessonDate.toLocaleDateString('en-US', {...})
lessonDate.toLocaleTimeString('en-US', { hour12: true })

// Spanish: lunes, 19 de diciembre de 2025 | 15:00
lessonDate.toLocaleDateString('es-ES', {...})
lessonDate.toLocaleTimeString('es-ES', { hour12: false })

// German: Montag, 19. Dezember 2025 | 15:00
lessonDate.toLocaleDateString('de-DE', {...})
lessonDate.toLocaleTimeString('de-DE', { hour12: false })

// French: lundi 19 décembre 2025 | 15:00
lessonDate.toLocaleDateString('fr-FR', {...})
lessonDate.toLocaleTimeString('fr-FR', { hour12: false })

// Portuguese: segunda-feira, 19 de dezembro de 2025 | 15:00
lessonDate.toLocaleDateString('pt-BR', {...})
lessonDate.toLocaleTimeString('pt-BR', { hour12: false })
```

### Formality Level

- **Spanish & German**: Formal ("usted" / "Sie")
- **English, French, Portuguese**: Professional but friendly

## Error Handling

```javascript
try {
  // Create system message
  await Message.create({...});
  console.log('✅ System message sent to tutor');
} catch (systemMsgError) {
  console.error('❌ Error creating trial lesson system message:', systemMsgError);
  // Don't fail the lesson creation if system message fails
}
```

**Important**: System message failure does **not** prevent lesson creation. This ensures booking reliability.

## Testing

### Manual Testing

1. **Create new tutor account** (or use existing)
2. **Set interface language** (Profile > Settings)
3. **Create student account**
4. **Book first lesson** with the tutor
5. **Check tutor's Messages tab** → System message should appear
6. **Verify**:
   - Message in correct language
   - Student name correct
   - Date/time formatted properly
   - Duration matches
   - Profile link works
   - Tips are readable

### Testing Different Languages

```javascript
// In backend test environment
const tutor = await User.findById(tutorId);
tutor.interfaceLanguage = 'es';  // Change to: en, es, de, fr, pt
await tutor.save();

// Book lesson → Check message language
```

## Future Enhancements

### Potential Additions

1. **Rescheduled Lesson Reminder**
   - Send system message when trial lesson is rescheduled
   - Include new time/date

2. **Follow-up After Trial**
   - Ask tutor for feedback after trial lesson
   - Suggest next steps

3. **Custom Tutor Templates**
   - Allow tutors to customize their welcome message
   - Add personal touch while keeping structure

4. **Analytics**
   - Track system message open rates
   - Measure impact on trial-to-regular conversion

5. **More Languages**
   - Add Italian, Japanese, Chinese, etc.
   - Auto-detect from tutor location

## Files Modified

### Backend
- ✅ `backend/routes/lessons.js` - Added system message creation
- ✅ `backend/utils/systemMessages.js` - New utility module

### Frontend
- ✅ `language-learning-app/src/assets/i18n/en.json`
- ✅ `language-learning-app/src/assets/i18n/es.json`
- ✅ `language-learning-app/src/assets/i18n/de.json`
- ✅ `language-learning-app/src/assets/i18n/fr.json`
- ✅ `language-learning-app/src/assets/i18n/pt.json`

## Conclusion

This feature enhances the tutor experience by providing:
- **Professional onboarding** for new students
- **Actionable preparation tips**
- **Multilingual support** for global tutors
- **Seamless integration** with existing messaging

The system respects user preferences, handles errors gracefully, and provides a polished experience for tutors worldwide.

