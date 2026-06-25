/**
 * One-off: correct a LessonTranscript's `language` to match the lesson subject.
 * The /start route had tagged it from the student's profile (languages[0])
 * instead of the actual lesson subject, mislabeling a Spanish lesson as German.
 *
 * Usage: node fix-transcript-language.js <lessonId>
 * READS the lesson subject, then sets transcript.language accordingly.
 */
const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const Lesson = require('./models/Lesson');
const LessonTranscript = require('./models/LessonTranscript');

(async () => {
  const lessonId = process.argv[2];
  if (!lessonId) {
    console.error('❌ Usage: node fix-transcript-language.js <lessonId>');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);

  const lesson = await Lesson.findById(lessonId).lean();
  if (!lesson) {
    console.error('❌ Lesson not found');
    process.exit(1);
  }
  const subjectLanguage = (lesson.subject || '').replace(/\s*Lesson$/i, '').trim();
  if (!subjectLanguage) {
    console.error(`❌ Could not derive language from subject: "${lesson.subject}"`);
    process.exit(1);
  }

  const transcript = await LessonTranscript.findOne({ lessonId });
  if (!transcript) {
    console.error('❌ No transcript found for this lesson');
    process.exit(1);
  }

  const before = transcript.language;
  transcript.language = subjectLanguage;
  await transcript.save();

  console.log(`✅ Lesson subject: "${lesson.subject}" → language "${subjectLanguage}"`);
  console.log(`✅ Transcript language: "${before}" → "${transcript.language}" (status: ${transcript.status})`);

  await mongoose.connection.close();
  process.exit(0);
})();
