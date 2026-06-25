/**
 * Read-only diagnostic for "no analysis available" on the post-lesson screen.
 *
 * Prints the Lesson, LessonTranscript, and LessonAnalysis documents for a given
 * lesson and applies the same decision logic the API/UI use, so you can tell at a
 * glance WHY analysis was (or wasn't) shown.
 *
 * Usage:
 *   node diagnose-missing-analysis.js <lessonId>
 *   node diagnose-missing-analysis.js            # falls back to DEFAULT_LESSON_ID
 *
 * This script only READS from the database. It makes no writes.
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './config.env' });

const DEFAULT_LESSON_ID = '6a2618c98b815f769f242bf8';

const Lesson = require('./models/Lesson');
const LessonAnalysis = require('./models/LessonAnalysis');
const LessonTranscript = require('./models/LessonTranscript');

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set (check backend/config.env)');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB Connected\n');
};

function hr(label) {
  console.log('\n' + '─'.repeat(60));
  if (label) console.log(label);
  console.log('─'.repeat(60));
}

async function diagnose(lessonId) {
  hr(`🔎 Diagnosing lessonId: ${lessonId}`);

  // ---- Lesson ------------------------------------------------------------
  const lesson = await Lesson.findById(lessonId).lean();
  hr('📚 LESSON');
  if (!lesson) {
    console.log('⚠️  No Lesson document found for this id.');
  } else {
    console.log('status:                 ', lesson.status);
    console.log('isTrialLesson:          ', lesson.isTrialLesson);
    console.log('language:               ', lesson.language);
    console.log('subject:                ', lesson.subject);
    console.log('duration (min):         ', lesson.duration);
    console.log('actualDurationMinutes:  ', lesson.actualDurationMinutes);
    console.log('aiAnalysisEnabledAtTime:', lesson.aiAnalysisEnabledAtTime);
    console.log('startTime:              ', lesson.startTime);
    console.log('endTime:                ', lesson.endTime);
  }

  // ---- Transcript --------------------------------------------------------
  const transcript = await LessonTranscript.findOne({ lessonId }).lean();
  hr('📝 TRANSCRIPT');
  let segmentCount = 0;
  let studentSegments = 0;
  let tutorSegments = 0;
  let transcriptStatus = 'not_found';
  if (!transcript) {
    console.log('⚠️  No LessonTranscript document found.');
  } else {
    transcriptStatus = transcript.status || 'unknown';
    segmentCount = transcript.segments?.length || 0;
    studentSegments = (transcript.segments || []).filter(s => s.speaker === 'student').length;
    tutorSegments = (transcript.segments || []).filter(s => s.speaker === 'tutor').length;
    const studentWords = (transcript.segments || [])
      .filter(s => s.speaker === 'student')
      .reduce((sum, s) => sum + (s.text ? s.text.split(/\s+/).length : 0), 0);

    console.log('status:           ', transcriptStatus);
    console.log('language:         ', transcript.language);
    console.log('segments total:   ', segmentCount);
    console.log('  student segs:   ', studentSegments);
    console.log('  tutor segs:     ', tutorSegments);
    console.log('  student words:  ', studentWords, studentWords < 30 ? '  ⚠️ below 30-word gate' : '');
    console.log('fullText length:  ', transcript.fullText ? transcript.fullText.length : 0);
    console.log('startTime:        ', transcript.startTime);
    console.log('endTime:          ', transcript.endTime);
    console.log('createdAt:        ', transcript.createdAt);
    console.log('updatedAt:        ', transcript.updatedAt);
    if (transcript.metadata) {
      console.log('metadata:         ', JSON.stringify(transcript.metadata));
    }

    // --- Audio chunks: did audio actually get uploaded, and was it transcribed?
    const chunks = transcript.audioChunks || [];
    console.log('\n  audioChunks:      ', chunks.length, chunks.length === 0 ? '  ⚠️ NO AUDIO EVER UPLOADED' : '');
    if (chunks.length > 0) {
      const bySpeaker = chunks.reduce((acc, c) => {
        acc[c.speaker || 'unknown'] = (acc[c.speaker || 'unknown'] || 0) + 1;
        return acc;
      }, {});
      const transcribedCount = chunks.filter(c => c.transcribed).length;
      const totalBytes = chunks.reduce((s, c) => s + (c.sizeBytes || 0), 0);
      const totalAttempts = chunks.reduce((s, c) => s + (c.transcriptionAttempts || 0), 0);
      console.log('    by speaker:     ', JSON.stringify(bySpeaker));
      console.log('    transcribed:    ', `${transcribedCount}/${chunks.length}`,
        transcribedCount === 0 ? '  ⚠️ none transcribed' : '');
      console.log('    total size:     ', `${(totalBytes / 1024).toFixed(1)} KB`,
        totalBytes === 0 ? '  ⚠️ zero bytes (empty audio)' : '');
      console.log('    total attempts: ', totalAttempts);
      console.log('    sample chunks:  ');
      chunks.slice(0, 5).forEach(c => {
        console.log(`      #${c.chunkIndex} ${c.speaker} ${(c.sizeBytes || 0)} bytes ` +
          `transcribed=${c.transcribed} attempts=${c.transcriptionAttempts || 0} ` +
          `at=${c.uploadedAt ? new Date(c.uploadedAt).toISOString() : '?'}`);
      });
    }

    // --- Audio energy: did the uploaded audio actually contain speech?
    const energy = transcript.audioEnergyMetrics || [];
    console.log('\n  audioEnergyMetrics:', energy.length);
    if (energy.length > 0) {
      const withSpeech = energy.filter(m => m.hasSpeech).length;
      const avgRms = energy.reduce((s, m) => s + (m.rmsLevelDb || -91), 0) / energy.length;
      const avgSilence = energy.reduce((s, m) => s + (m.silenceRatio || 0), 0) / energy.length;
      console.log('    chunks w/ speech:', `${withSpeech}/${energy.length}`,
        withSpeech === 0 ? '  ⚠️ VAD found NO speech energy' : '');
      console.log('    avg RMS (dB):    ', avgRms.toFixed(1));
      console.log('    avg silence:     ', `${(avgSilence * 100).toFixed(1)}%`);
    }

    // --- Tutor reference (Agora remote track) upload
    console.log('\n  tutorSpeechIntervals:', (transcript.tutorSpeechIntervals || []).length);
    if (transcript.tutorReferenceMeta) {
      console.log('    tutorReferenceMeta:', JSON.stringify(transcript.tutorReferenceMeta));
    }
  }

  // ---- Analysis ----------------------------------------------------------
  const analysis = await LessonAnalysis.findOne({ lessonId }).lean();
  hr('📊 ANALYSIS');
  if (!analysis) {
    console.log('⚠️  No LessonAnalysis document found.');
  } else {
    console.log('status:           ', analysis.status);
    console.log('source:           ', analysis.source || '(none)');
    console.log('error:            ', analysis.error || '(none)');
    console.log('language:         ', analysis.language);
    console.log('lessonDate:       ', analysis.lessonDate);
    console.log('createdAt:        ', analysis.createdAt);
    console.log('updatedAt:        ', analysis.updatedAt);
    if (analysis.overallAssessment) {
      console.log('proficiencyLevel: ', analysis.overallAssessment.proficiencyLevel);
    }
    if (analysis.tutorNote) {
      console.log('tutorNote.text:   ', analysis.tutorNote.text ? `"${analysis.tutorNote.text.slice(0, 80)}"` : '(empty)');
      console.log('tutorNote.addedAt:', analysis.tutorNote.addedAt);
      console.log('tutorNote.homework:', analysis.tutorNote.homework || '(none)');
    } else {
      console.log('tutorNote:         (none)');
    }
  }

  // ---- Verdict -----------------------------------------------------------
  hr('🧭 VERDICT (mirrors API + UI logic)');

  if (lesson?.isTrialLesson) {
    console.log('→ Trial lesson: API returns analysis:null/skipped. UI intentionally skips analysis.');
  } else if (analysis && analysis.status === 'completed') {
    console.log('→ Analysis EXISTS and is COMPLETED.');
    console.log('  If the user still saw "no analysis available", it was the 3-min poll TIMEOUT');
    console.log('  (60 polls × 3s). The row likely completed after the UI gave up — reopening shows it.');
  } else if (analysis && (analysis.status === 'insufficient_data' || analysis.status === 'failed')) {
    console.log(`→ Analysis row status = '${analysis.status}'. UI shows "no analysis".`);
    console.log(`  Reason: ${analysis.error || '(no error string saved)'}`);
  } else if (analysis && (analysis.status === 'pending' || analysis.status === 'processing')) {
    console.log(`→ Analysis row exists but is STUCK at '${analysis.status}'.`);
    console.log('  The API returns this row (not a 404), so the UI keeps polling and then hits the');
    console.log('  3-min TIMEOUT → "no analysis available". The row never reached a terminal state.');
    if (segmentCount === 0) {
      console.log('  Cause: transcript has 0 segments → analyzeLesson() throws "transcript is empty"');
      console.log('  and callers only .catch(log), so the pending row is never set to insufficient_data.');
      console.log('  The autoComplete cron cleanup only runs for recording/processing transcripts,');
      console.log(`  but this transcript is '${transcriptStatus}', so it was skipped.`);
    }
  } else {
    // No analysis row → reproduce the /lesson/:id/analysis 404 branch
    const willNeverGenerate =
      !transcript ||
      transcriptStatus === 'failed' ||
      (transcriptStatus === 'completed' && segmentCount === 0);
    const apiStatus = willNeverGenerate ? 'unavailable' : 'not_started';
    console.log(`→ No analysis row. API would return 404 with status='${apiStatus}'.`);
    if (apiStatus === 'unavailable') {
      console.log('  UI shows "no analysis available" immediately. Causes:');
      if (!transcript) console.log('   • No transcript at all → transcription never ran (no audio captured/uploaded).');
      if (transcriptStatus === 'failed') console.log('   • Transcript status = failed.');
      if (transcriptStatus === 'completed' && segmentCount === 0) console.log('   • Transcript completed but 0 segments (empty capture).');
    } else {
      console.log('  API says not_started → analysis pipeline had not produced a row yet.');
      console.log('  If never created, generation was never triggered or it crashed before upsert.');
      console.log('  (Check backend logs around lesson end / autoFinalizeLessons cron.)');
    }
  }

  console.log('');
}

(async () => {
  const lessonId = process.argv[2] || DEFAULT_LESSON_ID;
  try {
    await connectDB();
    await diagnose(lessonId);
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
})();
