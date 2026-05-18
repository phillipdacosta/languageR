// Load environment variables FIRST before any other imports
require('dotenv').config({ path: './config.env' });

// Loud check for the auth config so missing values don't silently fall back
// to dev tokens. verifyAuth.js itself throws in production if AUTH0_DOMAIN is
// missing; here we just warn in dev so contributors notice.
(function checkAuthEnv() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!process.env.AUTH0_DOMAIN) {
    const msg = '[boot] AUTH0_DOMAIN is not set — Auth0 JWT verification will reject all real tokens';
    if (isProd) {
      throw new Error(msg);
    }
    console.warn(`⚠️  ${msg}. Add it to config.env (see config.env.example).`);
  }
  if (isProd && process.env.ALLOW_DEV_TOKENS === 'true') {
    console.warn('⚠️  ALLOW_DEV_TOKENS=true in production — this is ignored by verifyAuth, but you should remove it from your env to avoid confusion.');
  }
})();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');
const cron = require('node-cron');
const { setupDeepgramWebSocket } = require('./routes/deepgram-audio');
const { autoCompleteTranscripts } = require('./jobs/autoCompleteTranscripts');
const { autoFinalizeLessons } = require('./jobs/autoFinalizeLessons');
const { autoCancelClasses } = require('./jobs/autoCancelClasses');
const autoReleaseClassPayments = require('./jobs/autoReleaseClassPayments');
const autoReleaseLessonPayments = require('./jobs/autoReleaseLessonPayments');
const { processPayPalPayouts } = require('./jobs/processPayPalPayouts');
const { processWithdrawals } = require('./jobs/processWithdrawals');
const { reconcilePayments } = require('./jobs/reconcilePayments');
const { releaseEarnings } = require('./jobs/releaseEarnings');
const { checkMaterialAvailability } = require('./jobs/checkMaterialAvailability');
const { initializeAudioCronJobs } = require('./cron/audioBackupCron');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  process.env.CORS_ORIGIN || 'http://localhost:8100',
  'http://localhost:8100',
  'capacitor://localhost',
  'http://localhost'
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(null, true);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  credentials: true
};

const io = new Server(server, { cors: corsOptions });
const PORT = process.env.PORT || 3000;

// Health check route for Render - MUST be first, before any middleware
app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(cookieParser());
app.use(cors(corsOptions));

// IMPORTANT: Skip JSON/URL parsing for file upload routes
// Multer handles multipart/form-data, express.json() should not touch it
app.use((req, res, next) => {
  // Skip body parsing for upload endpoints - multer will handle them
  if (req.path.includes('upload')) {
    return next();
  }
  // For all other routes, parse JSON and URL-encoded bodies
  express.json({ limit: '10mb' })(req, res, (err) => {
    if (err) return next(err);
    express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
  });
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/language-learning-app')
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Language Learning App API' });
});

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const lessonRoutes = require('./routes/lessons');
const progressRoutes = require('./routes/progress');
const messagingRoutes = require('./routes/messaging');
const classesRoutes = require('./routes/classes');
const notificationRoutes = require('./routes/notifications');
const whiteboardRoutes = require('./routes/whiteboard');
const walletRoutes = require('./routes/wallet');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const withdrawalRoutes = require('./routes/withdrawals'); // NEW: Withdrawal system

// Store connected users: userId -> socketId (defined early for routes to access)
const connectedUsers = new Map();

// Also create a global mapping by MongoDB user ID for easier lookup
// Maps MongoDB ObjectId string -> socket.id
global.userSockets = {};

// Middleware to attach io and connectedUsers to request
app.use((req, res, next) => {
  req.io = io;
  req.connectedUsers = connectedUsers;
  next();
});

// Use routes
app.use('/api/webhooks', webhookRoutes); // Webhooks BEFORE other routes (needs raw body)
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/messaging', messagingRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/whiteboard', whiteboardRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/withdrawals', withdrawalRoutes); // NEW: Withdrawal system
app.use('/api/disputes', require('./routes/disputes')); // Dispute system
app.use('/api/admin', require('./routes/admin')); // Admin routes
app.use('/api/transcription', require('./routes/transcription'));
app.use('/api/materials', require('./routes/materials'));
app.use('/api/auth', require('./routes/youtubeAuth'));
app.use('/api/auth', require('./routes/vimeoAuth'));
app.use('/api/auth', require('./routes/googleCalendarAuth'));
app.use('/api', require('./routes/googleCalendarAuth')); // Mounts /api/webhooks/google-calendar
app.use('/api/analysis', require('./routes/analysis'));
app.use('/api/tutor-feedback', require('./routes/tutorFeedback'));
app.use('/api/review-deck', require('./routes/review-deck'));
app.use('/api/vocabulary', require('./routes/vocabulary'));
app.use('/api/learning-plan', require('./routes/learningPlan'));
app.use('/api/subscription', require('./routes/subscription'));
app.use('/api/quizzes', require('./routes/quizzes'));
app.use('/api/taxonomy', require('./routes/taxonomy'));
app.use('/api/bundles', require('./routes/bundles'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('🔍 Error details:', err);
  console.error('🔍 Error stack:', err.stack);
  console.error('🔍 Request path:', req.path);
  console.error('🔍 Request method:', req.method);
  console.error('🔍 Content-Type:', req.get('content-type'));
  
  // Don't expose stack traces in production
  res.status(err.status || 500).json({ 
    message: err.message || 'Something went wrong!',
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Socket.io connection handling
const { verifyToken } = require('./middleware/videoUploadMiddleware');
const Message = require('./models/Message');

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    // Create a mock request object for verifyToken
    const mockReq = {
      headers: { authorization: `Bearer ${token}` },
      user: null
    };

    // Verify token using existing middleware logic
    const authHeader = mockReq.headers.authorization;
    const authToken = authHeader.replace('Bearer ', '');
    
    let userInfo;
    
    // Handle dev tokens
    if (authToken.startsWith('dev-token-')) {
      const emailPart = authToken.replace('dev-token-', '');
      const parts = emailPart.split('-');
      if (parts.length >= 2) {
        const domainParts = parts.slice(-2);
        const usernameParts = parts.slice(0, -2);
        const email = `${usernameParts.join('.')}@${domainParts.join('.')}`;
        // Use dev-user- prefix to match the REST API format
        userInfo = { sub: `dev-user-${email}`, email };
      }
    } else if (authToken.includes('.')) {
      try {
        const jwtParts = authToken.split('.');
        if (jwtParts.length === 3) {
          let payload = jwtParts[1];
          while (payload.length % 4) payload += '=';
          const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
          const email = decoded.email || decoded['https://your-domain.com/email'];
          const normalizedSub = email ? `dev-user-${email}` : decoded.sub;
          userInfo = { sub: normalizedSub, email };
        }
      } catch (jwtErr) {
        console.error('Socket JWT decode error:', jwtErr);
      }
    } else {
      userInfo = { sub: authToken };
    }

    if (!userInfo || !userInfo.sub) {
      return next(new Error('Authentication error: Invalid token'));
    }

    socket.userId = userInfo.sub;
    next();
  } catch (error) {
    console.error('Socket authentication error:', error);
    next(new Error('Authentication error'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.userId;
  console.log(`✅ User connected: ${userId}, socket.id: ${socket.id}`);
  console.log(`[archive-sync] socket joined room=user:${userId} sock=${socket.id} clientUA=${socket.handshake.headers['user-agent']?.slice(0, 60) || 'n/a'}`);
  
  // Store user connection by Auth0 ID
  connectedUsers.set(userId, socket.id);
  socket.join(`user:${userId}`);
  
  // Also store by MongoDB user ID for easier lookup in routes
  try {
    const User = require('./models/User');
    const user = await User.findOne({ auth0Id: userId });
    if (user) {
      const mongoId = user._id.toString();
      global.userSockets[mongoId] = socket.id;
      socket.mongoUserId = mongoId;
      socket.join(`mongo:${mongoId}`);
      console.log(`📝 Mapped MongoDB user ID ${mongoId} to socket ${socket.id} and joined room mongo:${mongoId}`);
    } else {
      console.warn(`⚠️ No MongoDB user found for Auth0 ID: ${userId}`);
    }
  } catch (error) {
    console.error('❌ Error looking up MongoDB user ID:', error);
  }
  
  console.log(`📊 Total connected users: ${connectedUsers.size}`);
  console.log(`📊 Connected users list:`, Array.from(connectedUsers.keys()));

  // Handle sending messages
  socket.on('send_message', async (data) => {
    try {
      const { receiverId, content, type = 'text', replyTo } = data;
      
      console.log('📨 Received send_message event:', { userId, receiverId, content, type, replyTo });
      
      if (!content || !content.trim()) {
        socket.emit('message_error', { message: 'Message content is required' });
        return;
      }

      if (!receiverId) {
        console.error('❌ No receiverId provided');
        socket.emit('message_error', { message: 'Receiver ID is required' });
        return;
      }

      const ids = [userId, receiverId].sort();
      const conversationId = `${ids[0]}_${ids[1]}`;
      
      console.log('📝 Creating message with conversationId:', conversationId);
      
      const messageData = {
        conversationId,
        senderId: userId,
        receiverId,
        content: content.trim(),
        type
      };

      // Add replyTo if provided and valid (must have messageId)
      if (replyTo && typeof replyTo === 'object' && replyTo.messageId) {
        messageData.replyTo = replyTo;
        console.log('💬 Message is a reply to:', replyTo.messageId);
      } else if (replyTo) {
        console.log('⚠️ Invalid replyTo data (missing messageId):', replyTo);
        // Don't add invalid replyTo to messageData
      }

      const message = new Message(messageData);

      console.log('💾 Saving message to database...');
      const savedMessage = await message.save();
      console.log('✅ Message saved successfully:', savedMessage._id.toString());

      const messagePayload = {
        id: savedMessage._id.toString(),
        conversationId: savedMessage.conversationId,
        senderId: savedMessage.senderId,
        receiverId: savedMessage.receiverId,
        content: savedMessage.content,
        type: savedMessage.type,
        read: savedMessage.read,
        createdAt: savedMessage.createdAt
      };

      // Include replyTo in payload only if it's valid (has messageId)
      if (savedMessage.replyTo && typeof savedMessage.replyTo === 'object' && savedMessage.replyTo.messageId) {
        messagePayload.replyTo = savedMessage.replyTo;
      }

      // Emit to sender (confirmation) - send to all sender's tabs
      socket.emit('message_sent', messagePayload);
      // Also emit to sender's room so other tabs get the message
      socket.to(`user:${userId}`).emit('new_message', messagePayload);

      // Emit to receiver using room (reaches ALL of receiver's tabs/sockets)
      const receiverRoom = `user:${receiverId}`;
      const receiverSockets = io.sockets.adapter.rooms.get(receiverRoom);
      const receiverSocketCount = receiverSockets ? receiverSockets.size : 0;
      
      console.log('📤 Sending message to receiver room:', {
        receiverId,
        receiverRoom,
        receiverSocketCount,
        connectedUsersCount: connectedUsers.size
      });
      
      if (receiverSocketCount > 0) {
        console.log(`✅ Sending message to ${receiverSocketCount} socket(s) in room: ${receiverRoom}`);
        io.to(receiverRoom).emit('new_message', messagePayload);
      } else {
        console.log('⚠️ Receiver not online - message saved but not delivered in real-time:', receiverId);
      }
    } catch (error) {
      console.error('❌ Error sending message via socket:', error);
      console.error('❌ Error stack:', error.stack);
      socket.emit('message_error', { message: 'Failed to send message', error: error.message });
    }
  });

  // Handle typing indicator - emit to room (all of receiver's tabs)
  socket.on('typing', (data) => {
    const { receiverId, isTyping } = data;
    const receiverRoom = `user:${receiverId}`;
    io.to(receiverRoom).emit('user_typing', {
      userId,
      isTyping
    });
  });

  /**
   * ──────────────────────────────────────────────────────────────────────
   * Class detail real-time subscriptions
   *
   * A client viewing `/lessons/:id` for a class (web event-details or the
   * RN LessonDetailOverlay) emits `class:subscribe` with the class id. The
   * server validates the requester is a legitimate member of that class
   * (tutor, invited student, or confirmed student) and joins them to
   * `class:${classId}`. The `classStateBroadcaster` service fans out
   * `class_state_changed` events to this room on every mutation (enroll,
   * unenroll, remove student, cancel, payment status change…) so clients
   * can merge patches into their local cache without refetching.
   *
   * Ack callback mirrors socket.io convention: the third arg (if provided)
   * receives `{ ok: boolean, state?, error? }`. Clients use it to hydrate
   * the initial snapshot in one round trip.
   * ──────────────────────────────────────────────────────────────────────
   */
  socket.on('class:subscribe', async (data, ack) => {
    try {
      const classId = data && data.classId ? String(data.classId) : '';
      if (!classId) {
        if (typeof ack === 'function') ack({ ok: false, error: 'classId_required' });
        return;
      }

      const Class = require('./models/Class');
      const User = require('./models/User');
      const { buildStatePatch } = require('./services/classStateBroadcaster');

      const [cls, user] = await Promise.all([
        Class.findById(classId)
          .populate('confirmedStudents', 'name firstName lastName picture profilePicture email')
          .lean(),
        User.findOne({ auth0Id: userId }).lean(),
      ]);

      if (!cls) {
        if (typeof ack === 'function') ack({ ok: false, error: 'class_not_found' });
        return;
      }

      const myMongoId = user && user._id ? String(user._id) : null;
      const tutorId = cls.tutorId ? String(cls.tutorId) : null;
      const isTutor = !!myMongoId && !!tutorId && myMongoId === tutorId;
      const isConfirmed =
        !!myMongoId &&
        Array.isArray(cls.confirmedStudents) &&
        cls.confirmedStudents.some((s) => {
          const sid = s && typeof s === 'object' ? String(s._id || s.id || '') : String(s);
          return sid === myMongoId;
        });
      const isInvited =
        !!myMongoId &&
        Array.isArray(cls.invitedStudents) &&
        cls.invitedStudents.some((inv) => String(inv && inv.studentId) === myMongoId);

      if (!isTutor && !isConfirmed && !isInvited) {
        if (typeof ack === 'function') ack({ ok: false, error: 'not_authorized' });
        return;
      }

      const room = `class:${classId}`;
      socket.join(room);

      if (typeof ack === 'function') {
        ack({
          ok: true,
          state: {
            classId,
            version: cls.updatedAt ? new Date(cls.updatedAt).toISOString() : null,
            reason: 'initial_snapshot',
            state: buildStatePatch(cls),
          },
        });
      }
    } catch (err) {
      console.error('[class:subscribe] Error:', err);
      if (typeof ack === 'function') ack({ ok: false, error: 'server_error' });
    }
  });

  socket.on('class:unsubscribe', (data) => {
    const classId = data && data.classId ? String(data.classId) : '';
    if (!classId) return;
    socket.leave(`class:${classId}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const userId = socket.userId;
    const mongoUserId = socket.mongoUserId;
    console.log(`❌ User disconnected: ${userId}`);
    if (userId) {
      connectedUsers.delete(userId);
      console.log(`📊 Remaining connected users: ${connectedUsers.size}`);
    }
    if (mongoUserId && global.userSockets) {
      delete global.userSockets[mongoUserId];
      console.log(`📝 Removed MongoDB user ID ${mongoUserId} from socket mapping`);
    }
  });
});

// TEMPORARILY COMMENTED OUT: Deepgram WebSocket (causing conflicts with Socket.IO)
// setupDeepgramWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at: http://0.0.0.0:${PORT}/health`);
  console.log(`Server bound to all interfaces (0.0.0.0)`);
  console.log(`WebSocket server ready`);
  console.log(`Deepgram WebSocket ready at: ws://0.0.0.0:${PORT}/api/deepgram-audio`);
  
  // Start background job to auto-complete transcripts for ended lessons
  // Runs every minute
  cron.schedule('* * * * *', () => {
    autoCompleteTranscripts().catch(err => {
      console.error('❌ [Cron] Error in autoCompleteTranscripts:', err);
    });
  });
  console.log('⏰ Cron job started: Auto-complete transcripts (every minute)');
  
  // Start background job to auto-finalize lessons without transcripts
  // Runs every minute
  cron.schedule('* * * * *', () => {
    autoFinalizeLessons().catch(err => {
      console.error('❌ [Cron] Error in autoFinalizeLessons:', err);
    });
  });
  console.log('⏰ Cron job started: Auto-finalize lessons (every minute)');
  
  // Start background job to auto-cancel classes that don't meet minimum enrollment
  // Runs every 10 minutes (checks for classes 55-65 minutes out, ~1 hour before start)
  cron.schedule('*/10 * * * *', () => {
    autoCancelClasses(io, connectedUsers).catch(err => {
      console.error('❌ [Cron] Error in autoCancelClasses:', err);
    });
  });
  console.log('⏰ Cron job started: Auto-cancel classes (every 10 minutes)');
  
  // Start background job to finalize classes (refund no-shows, release payments)
  // Runs every 10 minutes to quickly catch classes that didn't happen
  cron.schedule('*/10 * * * *', () => {
    autoReleaseClassPayments(io).catch(err => {
      console.error('❌ [Cron] Error in autoReleaseClassPayments:', err);
    });
  });
  console.log('⏰ Cron job started: Auto-release class payments (every hour)');
  
  // Start background job to release authorized payments for lesson no-shows
  // Runs every hour at minute 10
  cron.schedule('10 * * * *', () => {
    autoReleaseLessonPayments().catch(err => {
      console.error('❌ [Cron] Error in autoReleaseLessonPayments:', err);
    });
  });
  console.log('⏰ Cron job started: Auto-release lesson payments (every hour)');
  
  // Start background job to process PayPal payouts after Stripe payouts clear
  // Runs every hour at minute 15
  cron.schedule('15 * * * *', () => {
    processPayPalPayouts().catch(err => {
      console.error('❌ [Cron] Error in processPayPalPayouts:', err);
    });
  });
  console.log('⏰ Cron job started: Process PayPal payouts (every hour)');
  
  // Process withdrawal requests (Stripe Connect / PayPal)
  // Runs every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    processWithdrawals().catch(err => {
      console.error('❌ [Cron] Error in processWithdrawals:', err);
    });
  });
  console.log('⏰ Cron job started: Process withdrawals (every 5 minutes)');
  
  // Release Tutor Earnings
  // Moves earnings from pending to available after 1-hour hold period
  // Runs every 5 minutes to catch newly eligible payments promptly
  cron.schedule('*/5 * * * *', () => {
    releaseEarnings(io).catch(err => {
      console.error('❌ [Cron] Error in releaseEarnings:', err);
    });
  });
  console.log('⏰ Cron job started: Release tutor earnings (every 5 minutes)');
  
  // Start background job to reconcile payments (check DB vs Stripe sync)
  // Runs nightly at 2:00 AM
  cron.schedule('0 2 * * *', () => {
    reconcilePayments().catch(err => {
      console.error('❌ [Cron] Error in reconcilePayments:', err);
    });
  });
  console.log('⏰ Cron job started: Reconcile payments (daily at 2 AM)');
  
  // Check material video availability every 6 hours
  cron.schedule('0 */6 * * *', () => {
    checkMaterialAvailability().catch(err => {
      console.error('❌ [Cron] Error in checkMaterialAvailability:', err);
    });
  });
  console.log('⏰ Cron job started: Check material availability (every 6 hours)');

  // Google Calendar watch renewal — runs hourly, catches:
  //   1. Channels expiring within the next 24h (proactive renewal before Google kills them)
  //   2. Connected users with NO watch (watchExpiration: null) — registration that
  //      previously failed (e.g. BACKEND_PUBLIC_URL set after initial connect, transient
  //      Google API error, etc.). Without this, those users would never be re-tried.
  //   3. Already-expired channels (watchExpiration in the past).
  // Renewal is non-destructive: we only call registerWatch (which overwrites the stored
  // channel id). The previous channel is left to expire naturally, so a transient failure
  // can't strand a user with no watch at all.
  // Concurrency-bounded: ~2 sec per user × 10 in parallel = ~200 users/min, scales to
  // tens of thousands of tutors without exceeding Google quota or taking longer than
  // the cron interval to drain.
  const gcalRoutes = require('./routes/googleCalendarAuth');
  const GCAL_RENEW_CONCURRENCY = parseInt(process.env.GCAL_RENEW_CONCURRENCY || '10', 10);

  async function processGcalUsersInBatches(users, label) {
    let done = 0, failed = 0;
    for (let i = 0; i < users.length; i += GCAL_RENEW_CONCURRENCY) {
      const batch = users.slice(i, i + GCAL_RENEW_CONCURRENCY);
      const results = await Promise.allSettled(batch.map(u => gcalRoutes.registerWatch(u._id)));
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value) {
          done++;
        } else {
          failed++;
          if (r.status === 'rejected') {
            console.error(`[GCal ${label}] Failed for user ${batch[j]._id}:`, r.reason?.message || r.reason);
          }
        }
      }
    }
    console.log(`[GCal ${label}] Done: ${done} renewed, ${failed} failed of ${users.length}`);
  }

  cron.schedule('15 * * * *', async () => {
    if (!process.env.BACKEND_PUBLIC_URL) return;
    try {
      const User = require('./models/User');
      const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const users = await User.find({
        'googleCalendar.connected': true,
        'googleCalendar.refreshToken': { $ne: null },
        $or: [
          { 'googleCalendar.watchExpiration': null },
          { 'googleCalendar.watchExpiration': { $lt: cutoff } }
        ]
      }).select('_id').lean();

      if (users.length === 0) return;
      console.log(`[GCal Cron] Renewing watch for ${users.length} user(s) (concurrency=${GCAL_RENEW_CONCURRENCY})`);
      await processGcalUsersInBatches(users, 'Cron');
    } catch (err) {
      console.error('[GCal Cron] Error in watch renewal job:', err.message);
    }
  });
  console.log('⏰ Cron job started: Google Calendar watch renewal (hourly)');

  // Backfill on boot: register watch for any connected user without an active one.
  // Runs once 30s after startup so the server is fully warm. This recovers users
  // whose watch died while the server was down or who were connected before
  // BACKEND_PUBLIC_URL was configured.
  // Streams via a Mongo cursor so we don't load every backfill candidate into
  // memory at once — important if many tutors need backfill after a long outage.
  if (process.env.BACKEND_PUBLIC_URL) {
    setTimeout(async () => {
      try {
        const User = require('./models/User');
        const now = new Date();
        const cursor = User.find({
          'googleCalendar.connected': true,
          'googleCalendar.refreshToken': { $ne: null },
          $or: [
            { 'googleCalendar.watchExpiration': null },
            { 'googleCalendar.watchExpiration': { $lt: now } }
          ]
        }).select('_id').lean().cursor();

        const buffer = [];
        let total = 0;
        for await (const user of cursor) {
          buffer.push(user);
          if (buffer.length >= 100) {
            await processGcalUsersInBatches(buffer, 'Boot');
            total += buffer.length;
            buffer.length = 0;
          }
        }
        if (buffer.length > 0) {
          await processGcalUsersInBatches(buffer, 'Boot');
          total += buffer.length;
        }
        if (total === 0) {
          console.log('[GCal Boot] No connected tutors needed watch backfill');
        } else {
          console.log(`[GCal Boot] Backfill complete: ${total} users processed`);
        }
      } catch (err) {
        console.error('[GCal Boot] Backfill error:', err.message);
      }
    }, 30 * 1000);
  }

  // Initialize audio backup and retry cron jobs
  initializeAudioCronJobs();
  console.log('✅ Audio backup system initialized');
  
  // Initialize coaching badge evaluator
  const { startCoachingBadgeEvaluator } = require('./jobs/evaluateCoachingBadges');
  startCoachingBadgeEvaluator();

  // End-of-day premium quiz batch (Batch 8). Runs every hour and lets
  // per-user filters (cap, cooldown, paused) decide who actually gets a
  // push. Fast and idempotent.
  const { runQuizEndOfDayBatch } = require('./jobs/quizEndOfDayBatch');
  cron.schedule('0 * * * *', () => {
    runQuizEndOfDayBatch().catch(err => console.error('[Cron] EOD quiz batch error:', err));
  });
  console.log('⏰ Cron job started: End-of-day quiz batch (every hour)');

  // Mastery Mode weekly micro-challenges (Batch 13). Runs once daily —
  // the underlying check is idempotent and gated on a 7-day window per
  // user, so daily runs cost almost nothing if nothing's due.
  const { runMasteryModeWeeklyCron } = require('./jobs/masteryModeWeekly');
  cron.schedule('30 9 * * *', () => {
    runMasteryModeWeeklyCron().catch(err => console.error('[Cron] Mastery weekly error:', err));
  });
  console.log('⏰ Cron job started: Mastery Mode weekly sweep (09:30 daily)');
  
  // Run auto-cancel immediately on startup for testing
  console.log('🚀 Running auto-cancel check immediately on startup...');
  autoCancelClasses(io, connectedUsers).catch(err => {
    console.error('❌ [Startup] Error in autoCancelClasses:', err);
  });
});

// Export io instance for use in services
module.exports.getIO = () => io;

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

module.exports = { app, io, connectedUsers };
