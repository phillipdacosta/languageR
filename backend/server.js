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
require('dotenv').config({ path: './config.env' });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:8100',
    methods: ['GET', 'POST'],
    credentials: true
  }
});
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
app.use(cookieParser()); // Add cookie parser middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:8100',
  credentials: true
}));

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
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/lessons', lessonRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/messaging', messagingRoutes);
app.use('/api/classes', classesRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/whiteboard', whiteboardRoutes);
app.use('/api/transcription', require('./routes/transcription'));
app.use('/api/analysis', require('./routes/analysis'));
app.use('/api/review-deck', require('./routes/review-deck'));

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
    } else {
      // For production, verify JWT token here
      // For now, we'll use the token as userId (simplified)
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
  
  // Store user connection by Auth0 ID
  connectedUsers.set(userId, socket.id);
  socket.join(`user:${userId}`);
  
  // Also store by MongoDB user ID for easier lookup in routes
  try {
    const User = require('./models/User');
    const user = await User.findOne({ auth0Id: userId });
    if (user) {
      global.userSockets[user._id.toString()] = socket.id;
      socket.mongoUserId = user._id.toString(); // Store for later cleanup
      console.log(`📝 Mapped MongoDB user ID ${user._id} to socket ${socket.id}`);
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

      // Emit to sender (confirmation)
      socket.emit('message_sent', messagePayload);

      // Emit to receiver if online
      const receiverSocketId = connectedUsers.get(receiverId);
      if (receiverSocketId) {
        console.log('📤 Sending message to receiver:', receiverId);
        io.to(receiverSocketId).emit('new_message', messagePayload);
      } else {
        console.log('⚠️ Receiver not online:', receiverId);
      }
    } catch (error) {
      console.error('❌ Error sending message via socket:', error);
      console.error('❌ Error stack:', error.stack);
      socket.emit('message_error', { message: 'Failed to send message', error: error.message });
    }
  });

  // Handle typing indicator
  socket.on('typing', (data) => {
    const { receiverId, isTyping } = data;
    const receiverSocketId = connectedUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_typing', {
        userId,
        isTyping
      });
    }
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
});

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
