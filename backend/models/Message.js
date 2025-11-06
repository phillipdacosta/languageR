const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: String,
    required: true,
    index: true
  },
  senderId: {
    type: String,
    required: true,
    index: true
  },
  receiverId: {
    type: String,
    required: true,
    index: true
  },
  content: {
    type: String,
    required: false,  // Not required for file/image/voice messages
    trim: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'voice'],
    default: 'text'
  },
  // File attachment fields
  fileUrl: {
    type: String,
    required: false
  },
  fileName: {
    type: String,
    required: false
  },
  fileType: {
    type: String,  // MIME type (e.g., 'image/jpeg', 'application/pdf', 'audio/webm')
    required: false
  },
  fileSize: {
    type: Number,  // Size in bytes
    required: false
  },
  thumbnailUrl: {
    type: String,  // For images/videos
    required: false
  },
  duration: {
    type: Number,  // For voice notes/audio (in seconds)
    required: false
  },
  // Reply-to message field
  replyTo: {
    messageId: {
      type: String,
      required: false
    },
    content: {
      type: String,
      required: false
    },
    senderId: {
      type: String,
      required: false
    },
    senderName: {
      type: String,
      required: false
    },
    type: {
      type: String,
      enum: ['text', 'image', 'file', 'voice'],
      required: false
    },
    fileUrl: {
      type: String,
      required: false
    },
    fileName: {
      type: String,
      required: false
    }
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Create indexes for better query performance
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, receiverId: 1 });

// Generate conversationId from two user IDs (always sorted)
messageSchema.statics.getConversationId = function(userId1, userId2) {
  const ids = [userId1, userId2].sort();
  return `${ids[0]}_${ids[1]}`;
};

module.exports = mongoose.model('Message', messageSchema);

