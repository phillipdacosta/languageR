const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const LessonTranscript = require('../models/LessonTranscript');
const Lesson = require('../models/Lesson');

/**
 * Set up Deepgram WebSocket proxy for real-time transcription
 */
function setupDeepgramWebSocket(server) {
  console.log('🎙️ Setting up Deepgram WebSocket server...');
  
  const wss = new WebSocket.Server({ 
    server,
    path: '/api/deepgram-audio'
  });
  
  wss.on('connection', async (ws, req) => {
    console.log('🎙️ New Deepgram audio connection');
    
    let deepgramConnection = null;
    let transcript = null;
    
    try {
      // Parse lesson ID and params from URL
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathParts = url.pathname.split('/');
      const lessonId = pathParts[pathParts.length - 1];
      const language = url.searchParams.get('language') || 'en';
      const speaker = url.searchParams.get('speaker') || 'student';
      
      console.log(`🎙️ Starting Deepgram transcription for lesson ${lessonId}, language: ${language}, speaker: ${speaker}`);
      
      // Create or get existing transcript
      transcript = await LessonTranscript.findOne({ lessonId });
      if (!transcript) {
        const lesson = await Lesson.findById(lessonId);
        if (!lesson) {
          console.error('❌ Lesson not found:', lessonId);
          ws.close(1000, 'Lesson not found');
          return;
        }
        
        transcript = await LessonTranscript.create({
          lessonId,
          studentId: lesson.studentId,
          tutorId: lesson.tutorId,
          language,
          startTime: new Date(),
          status: 'recording'
        });
        console.log('✅ Created new transcript:', transcript._id);
      } else {
        // Reset existing transcript for new session
        transcript.status = 'recording';
        transcript.segments = [];
        transcript.startTime = new Date();
        transcript.endTime = null;
        transcript.language = language;
        await transcript.save();
        console.log('🔄 Reset existing transcript:', transcript._id);
      }
      
      // Initialize Deepgram client
      const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
      
      // Create Deepgram live transcription connection
      deepgramConnection = deepgram.listen.live({
        model: 'nova-2',
        language: language,
        smart_format: true,
        punctuate: true,
        interim_results: false,
        endpointing: 300, // 300ms of silence = end of utterance
        channels: 1,
        sample_rate: 16000,
        encoding: 'linear16'
      });
      
      console.log('✅ Connected to Deepgram live transcription');
      
      // Handle Deepgram events
      deepgramConnection.addListener('open', () => {
        console.log('🎙️ Deepgram connection opened');
        
        // Send connection confirmation to client
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'connection',
            status: 'connected',
            transcriptId: transcript._id
          }));
        }
      });
      
      deepgramConnection.addListener('Results', async (data) => {
        try {
          const result = data.channel.alternatives[0];
          if (result && result.transcript && result.transcript.trim()) {
            const transcriptText = result.transcript.trim();
            console.log(`📝 Deepgram transcribed (${speaker}): "${transcriptText}"`);
            
            // Save to database
            await LessonTranscript.findByIdAndUpdate(transcript._id, {
              $push: {
                segments: {
                  timestamp: new Date(),
                  speaker: speaker,
                  text: transcriptText,
                  confidence: result.confidence || 0.9
                }
              }
            });
            
            // Send to client
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'transcript',
                text: transcriptText,
                timestamp: new Date().toISOString(),
                speaker: speaker,
                confidence: result.confidence || 0.9,
                isFinal: true
              }));
            }
          }
        } catch (error) {
          console.error('❌ Error processing Deepgram result:', error);
        }
      });
      
      deepgramConnection.addListener('error', (error) => {
        console.error('❌ Deepgram connection error:', error);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Deepgram connection error',
            error: error.message
          }));
        }
      });
      
      deepgramConnection.addListener('close', () => {
        console.log('🔌 Deepgram connection closed');
      });
      
      // Handle client messages (audio data)
      ws.on('message', (data) => {
        try {
          if (deepgramConnection && deepgramConnection.getReadyState() === 1) {
            // Forward audio data to Deepgram
            deepgramConnection.send(data);
          }
        } catch (error) {
          console.error('❌ Error sending audio to Deepgram:', error);
        }
      });
      
      // Handle client disconnect
      ws.on('close', () => {
        console.log('🔌 Client disconnected from Deepgram audio');
        if (deepgramConnection) {
          try {
            deepgramConnection.finish();
          } catch (error) {
            console.error('❌ Error closing Deepgram connection:', error);
          }
        }
      });
      
      ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        if (deepgramConnection) {
          try {
            deepgramConnection.finish();
          } catch (error) {
            console.error('❌ Error closing Deepgram connection:', error);
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Error setting up Deepgram connection:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Setup error: ' + error.message);
      }
    }
  });
  
  console.log('✅ Deepgram WebSocket server ready');
}

module.exports = { setupDeepgramWebSocket };

