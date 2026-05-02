const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const { initializeGCS } = require('../config/gcs');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const MessagingPreference = require('../models/MessagingPreference');
const User = require('../models/User');
const ClassModel = require('../models/Class');
const { formatNameWithInitial } = require('../utils/nameFormatter');
const {
  syncClassConversation
} = require('../services/classConversation');

// Use shared name formatter
const formatDisplayName = formatNameWithInitial;

// Helper to normalize user IDs (remove 'dev-user-' prefix for comparison)
const normalizeUserId = (id) => {
  if (!id) return '';
  return id.replace('dev-user-', '');
};

// Helper to check if two user IDs match (handles prefix differences)
const userIdsMatch = (id1, id2) => {
  return normalizeUserId(id1) === normalizeUserId(id2);
};

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// In-memory storage for real-time messages (in production, use Redis or similar)
const channelMessages = new Map();

// Send a message to a channel (lesson)
router.post('/channels/:channelName/messages', verifyToken, async (req, res) => {
  try {
    const { channelName } = req.params;
    const { type, payload } = req.body;
    const userId = req.user.sub;

    const message = {
      id: Date.now().toString(),
      channelName,
      type, // 'whiteboard' or 'chat'
      payload,
      userId,
      timestamp: new Date().toISOString()
    };

    // Store message in channel
    if (!channelMessages.has(channelName)) {
      channelMessages.set(channelName, []);
    }
    
    const messages = channelMessages.get(channelName);
    messages.push(message);
    
    // Keep only last 100 messages per channel
    if (messages.length > 100) {
      messages.splice(0, messages.length - 100);
    }

    console.log(`📨 Message sent to channel ${channelName}:`, { type, userId });

    res.json({
      success: true,
      message: 'Message sent successfully',
      messageId: message.id
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message'
    });
  }
});

// Get messages from a channel since a timestamp
router.get('/channels/:channelName/messages', verifyToken, async (req, res) => {
  try {
    const { channelName } = req.params;
    const { since } = req.query; // ISO timestamp
    const userId = req.user.sub;

    const messages = channelMessages.get(channelName) || [];
    
    // Filter messages since the given timestamp and exclude own messages
    const sinceDate = since ? new Date(since) : new Date(0);
    const filteredMessages = messages.filter(msg => 
      new Date(msg.timestamp) > sinceDate && msg.userId !== userId
    );

    res.json({
      success: true,
      messages: filteredMessages,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      messages: []
    });
  }
});

// Clear messages for a channel (for whiteboard clear)
router.delete('/channels/:channelName/messages', verifyToken, async (req, res) => {
  try {
    const { channelName } = req.params;
    
    if (channelMessages.has(channelName)) {
      channelMessages.set(channelName, []);
    }

    res.json({
      success: true,
      message: 'Messages cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear messages'
    });
  }
});

// User-to-user messaging endpoints

// Get all conversations for the current user
//
// Query params:
//   • filter=all       (default) — Active inbox: excludes user-archived and
//                                  user-hidden threads.
//   • filter=archived            — Archive folder: only user-archived threads
//                                  (still excludes user-hidden ones, those are
//                                  permanently soft-deleted).
//
// Per-user state lives in two places depending on thread type:
//   • Group threads — `Conversation.members[].archivedAt / .hiddenAt`.
//   • 1:1 threads   — `MessagingPreference` keyed by (ownerAuth0Id, peerAuth0Id).
router.get('/conversations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const filterParam = String(req.query.filter || 'all').toLowerCase();
    const filter = filterParam === 'archived' ? 'archived' : 'all';

    // Get all unique conversations where user is sender or receiver
    // Also include conversations with system messages that are visible to tutor only (if user is tutor)
    const user = await User.findOne({ auth0Id: userId });
    const isTutor = user && user.userType === 'tutor';

    // Pull user-level prefs for 1:1 threads in one shot so the per-row
    // filter check is O(1). Keyed by peer auth0Id.
    const prefDocs = await MessagingPreference.find({ ownerAuth0Id: userId }).lean();
    const prefByPeer = new Map(prefDocs.map((p) => [p.peerAuth0Id, p]));
    
    let messageQuery = {
      $or: [{ senderId: userId }, { receiverId: userId }]
    };
    
    // If user is a tutor, also include system messages where they are the receiver
    // (potential student conversations)
    if (isTutor) {
      messageQuery = {
        $or: [
          { senderId: userId },
          { receiverId: userId },
          // Include system messages where tutor is receiver (potential student conversations)
          { receiverId: userId, isSystemMessage: true, visibleToTutorOnly: true }
        ]
      };
    }
    
    const messages = await Message.find(messageQuery).sort({ createdAt: -1 });

    // Group by conversation and get latest message
    const conversationMap = new Map();
    
    for (const message of messages) {
      // Skip system messages with senderId 'system' when determining otherUserId
      // For system messages, the otherUserId is the student (if tutor is viewing)
      // System messages have receiverId = tutorId, so the student is the other user in the conversation
      let otherUserId;
      if (message.isSystemMessage && message.senderId === 'system') {
        // For system messages, receiverId is always the tutor
        // The conversationId format is: sorted(studentId, tutorId) joined by '_'
        // Since we know receiverId (tutorId), we can extract the studentId
        // by removing the receiverId from the conversationId
        const receiverId = message.receiverId;
        const conversationId = message.conversationId;
        
        // Remove receiverId from conversationId to get studentId
        // Handle both cases: receiverId at start or end
        if (conversationId.startsWith(receiverId + '_')) {
          otherUserId = conversationId.substring(receiverId.length + 1);
        } else if (conversationId.endsWith('_' + receiverId)) {
          otherUserId = conversationId.substring(0, conversationId.length - receiverId.length - 1);
        } else {
          // Fallback: if receiverId is not at start or end, try splitting
          // This should not happen with our current ID format, but handle it anyway
          const parts = conversationId.split('_');
          const receiverIndex = parts.indexOf(receiverId);
          if (receiverIndex !== -1) {
            parts.splice(receiverIndex, 1);
            otherUserId = parts.join('_');
          } else {
            // Last resort: skip this message if we can't determine the student
            console.warn('Could not extract studentId from system message conversationId:', conversationId, 'receiverId:', receiverId);
            continue;
          }
        }
      } else {
        otherUserId = message.senderId === userId ? message.receiverId : message.senderId;
      }
      
      // Skip messages where otherUserId is 'system' or empty
      if (otherUserId === 'system' || !otherUserId) {
        continue;
      }
      
      const ids = [userId, otherUserId].sort();
      const conversationId = `${ids[0]}_${ids[1]}`;
      
      if (!conversationMap.has(conversationId)) {
        conversationMap.set(conversationId, {
          conversationId,
          otherUserId,
          lastMessage: message,
          unreadCount: 0
        });
      }
      
      // Count unread messages (include system messages for unread count)
      if (message.receiverId === userId && !message.read) {
        conversationMap.get(conversationId).unreadCount++;
      }
    }

    // Apply per-user inbox state to 1:1 threads:
    //   • hidden  → never show, in any filter (permanent soft-delete).
    //   • archived → show only when filter=archived; hide otherwise.
    //   • neither → show only when filter=all; hide when filter=archived.
    const visibleOneOnOne = Array.from(conversationMap.values()).filter((conv) => {
      const pref = prefByPeer.get(conv.otherUserId);
      if (pref && pref.hiddenAt) return false;
      const isArchived = !!(pref && pref.archivedAt);
      return filter === 'archived' ? isArchived : !isArchived;
    });

    // Get user details for each conversation
    const conversations = await Promise.all(
      visibleOneOnOne.map(async (conv) => {
        const pref = prefByPeer.get(conv.otherUserId);
        const archivedAt = pref && pref.archivedAt ? pref.archivedAt : null;
        // Try to find user by auth0Id
        let otherUser = await User.findOne({ auth0Id: conv.otherUserId });
        
        // If not found and otherUserId doesn't start with 'dev-user-', try with prefix
        if (!otherUser && !conv.otherUserId.startsWith('dev-user-')) {
          otherUser = await User.findOne({ auth0Id: `dev-user-${conv.otherUserId}` });
        }
        
        // Try by MongoDB _id (conversations may reference _id instead of auth0Id)
        if (!otherUser && mongoose.Types.ObjectId.isValid(conv.otherUserId)) {
          otherUser = await User.findById(conv.otherUserId);
        }

        // Try by email
        if (!otherUser && conv.otherUserId.includes('@')) {
          otherUser = await User.findOne({ email: conv.otherUserId });
        }
        
        if (!otherUser) {
          console.error(`❌ User not found for: ${conv.otherUserId}`);
        }
        
        return {
          conversationId: conv.conversationId,
          otherUser: otherUser ? {
            id: otherUser._id.toString(),
            auth0Id: otherUser.auth0Id,
            name: formatDisplayName(otherUser),
            picture: otherUser.picture,
            userType: otherUser.userType,
            timezone: otherUser.profile?.timezone || otherUser.timezone || 'UTC'
          } : {
            id: conv.otherUserId,
            auth0Id: conv.otherUserId,
            name: 'Unknown User',
            picture: null,
            userType: 'user',
            timezone: 'UTC'
          },
          // Per-user inbox state. `userArchived` indicates the current user
          // has moved this thread to their Archive folder (independent of
          // the legacy `archived` flag, which on group threads means "you
          // left the class").
          userArchived: !!archivedAt,
          userArchivedAt: archivedAt,
          lastMessage: {
            content: conv.lastMessage.content,
            senderId: conv.lastMessage.senderId,
            createdAt: conv.lastMessage.createdAt,
            type: conv.lastMessage.type || (conv.lastMessage.isSystemMessage ? 'system' : 'text'),
            isSystemMessage: conv.lastMessage.isSystemMessage || false,
            reactions: conv.lastMessage.reactions || [] // Include reactions array
          },
          unreadCount: conv.unreadCount,
          updatedAt: conv.lastMessage.createdAt
        };
      })
    );

    // Deduplicate conversations by conversationId (keep the most recent one)
    // Use conversationId instead of otherUser.auth0Id to handle cases where otherUser might not be found
    const deduplicatedMap = new Map();
    for (const conv of conversations) {
      // Use conversationId as the key to ensure all conversations are included
      const existingConv = deduplicatedMap.get(conv.conversationId);
      if (!existingConv || new Date(conv.updatedAt) > new Date(existingConv.updatedAt)) {
        deduplicatedMap.set(conv.conversationId, conv);
      }
    }
    
    const deduplicatedConversations = Array.from(deduplicatedMap.values());
    
    // Log system message conversations for debugging
    const systemMessageConvs = deduplicatedConversations.filter(conv => {
      return conv.lastMessage && (conv.lastMessage.type === 'system' || conv.lastMessage.senderId === 'system');
    });
    if (systemMessageConvs.length > 0) {
      console.log('📋 Found system message conversations:', systemMessageConvs.length, systemMessageConvs.map(c => ({
        conversationId: c.conversationId,
        otherUser: c.otherUser?.name || 'Unknown',
        lastMessage: c.lastMessage?.content?.substring(0, 50)
      })));
    }
    
    // ===== Group conversations (membership-driven) =====
    // We key group threads off the `Conversation` collection, which is the
    // source of truth for roster + per-member visibility windows. A user
    // sees a thread iff they have a `members` row (active OR historical).
    //
    // Lazy migration: any pre-Conversation group threads that still live
    // only in the `Message` collection are materialized on first list-load
    // so the user can see them in /messages without first opening them
    // directly. We discover them by scanning distinct `groupId`s where the
    // user appears in a message's `groupParticipants` snapshot.
    const legacyGroupIds = await Message.distinct('groupId', {
      isGroup: true,
      groupParticipants: userId
    });
    if (legacyGroupIds.length > 0) {
      const existingConvIds = new Set(
        (await Conversation.find({ groupId: { $in: legacyGroupIds } }).select('groupId').lean())
          .map((c) => c.groupId)
      );
      const missing = legacyGroupIds.filter((gid) => gid && !existingConvIds.has(gid));
      // Materialize sequentially — `ensureConversationForGroupId` walks the
      // full message history per group; running them in parallel risks
      // hammering the DB on accounts with many legacy threads.
      for (const gid of missing) {
        try {
          await ensureConversationForGroupId(gid);
        } catch (err) {
          console.error('Failed to materialize legacy group conversation:', gid, err);
        }
      }
    }

    const memberConversations = await Conversation.find({ 'members.auth0Id': userId })
      .sort({ lastMessageAt: -1, updatedAt: -1 });

    // Pre-fetch class status so we can surface `cancelled` on class-broadcast
    // rows (drives the small "Cancelled" pill on the conversation row UI).
    const classIds = memberConversations
      .map((c) => c.classId)
      .filter(Boolean);
    const classDocs = classIds.length
      ? await ClassModel.find({ _id: { $in: classIds } }).select('_id status').lean()
      : [];
    const classStatusById = new Map(classDocs.map((c) => [c._id.toString(), c.status]));

    const groupConversations = await Promise.all(
      memberConversations.map(async (conv) => {
        const me = conv.getMember(userId);
        const isActive = !!(me && !me.leftAt);

        // Apply per-user inbox state:
        //   • hidden  → never show, in any filter (soft-deleted for me).
        //   • archived → only show under filter=archived.
        //   • neither → only show under filter=all (default inbox).
        if (me && me.hiddenAt) return null;
        const userArchived = !!(me && me.archivedAt);
        if (filter === 'archived' && !userArchived) return null;
        if (filter !== 'archived' && userArchived) return null;

        // Visibility window: strictly within my [joinedAt, leftAt] interval.
        const windowQuery = { isGroup: true, groupId: conv.groupId };
        windowQuery.createdAt = { $gte: me.joinedAt };
        if (me.leftAt) windowQuery.createdAt.$lte = me.leftAt;

        const lastMessage = await Message.findOne(windowQuery).sort({ createdAt: -1 }).lean();
        // If there's nothing in my window yet (eg. just joined), skip the
        // thread from the list to avoid empty conversation rows polluting UI.
        if (!lastMessage) return null;

        const unreadCount = await Message.countDocuments({
          ...windowQuery,
          senderId: { $ne: userId },
          readBy: { $ne: userId }
        });

        // Hydrate participant summaries (all historical members so left
        // students are still identified on old messages).
        const memberIds = conv.members.map((m) => m.auth0Id);
        const userDocs = await User.find({ auth0Id: { $in: memberIds } }).lean();
        const userMap = new Map(userDocs.map((u) => [u.auth0Id, u]));
        const participantUsers = memberIds.map((id) => {
          const u = userMap.get(id);
          return u ? {
            id: u._id.toString(),
            auth0Id: u.auth0Id,
            name: formatDisplayName(u),
            picture: u.picture || null,
            userType: u.userType || 'user'
          } : { id, auth0Id: id, name: 'Unknown', picture: null, userType: 'user' };
        });

        // Active-only list drives the avatar cluster (left students shown
        // only in-thread for historical messages, not in conversation list).
        const activeMembers = conv.members.filter((m) => !m.leftAt).map((m) => m.auth0Id);
        const activeParticipants = participantUsers.filter((p) => activeMembers.includes(p.auth0Id));
        const others = activeParticipants.filter((p) => !userIdsMatch(p.auth0Id, userId));
        const othersNames = others.map((p) => p.name).filter(Boolean);
        let displayName = conv.name && conv.name.trim() ? conv.name.trim() : '';
        if (!displayName) {
          if (othersNames.length <= 2) displayName = othersNames.join(' & ');
          else displayName = `${othersNames.slice(0, 2).join(', ')} & ${othersNames.length - 2} more`;
        }

        const classStatus = conv.classId ? classStatusById.get(conv.classId.toString()) : null;
        const classCancelled = classStatus === 'cancelled';

        return {
          conversationId: conv.groupId,
          isGroup: true,
          groupId: conv.groupId,
          groupName: conv.name || '',
          type: conv.type,
          classId: conv.classId ? conv.classId.toString() : null,
          // True when the current user owns this class chat as the tutor.
          // Used by the kebab menu to hide "Delete" on a tutor's own class
          // broadcast (tutor must remain reachable while they own the class).
          isTutor: !!(me && me.role === 'tutor'),
          // Class-broadcast threads where the underlying class is cancelled.
          // Drives a "Cancelled" pill on the conversation row.
          classCancelled,
          classStatus: classStatus || null,
          participants: activeParticipants,
          allParticipants: participantUsers,
          // Legacy: true when the user has left the group roster. Drives
          // the read-only banner inside the chat. Stays per-roster (not
          // per-user-archive — that's `userArchived`).
          archived: !isActive,
          leftAt: me.leftAt || null,
          joinedAt: me.joinedAt || null,
          // Per-user inbox state — separate from roster-level `archived`.
          userArchived,
          userArchivedAt: me.archivedAt || null,
          otherUser: {
            id: conv.groupId,
            auth0Id: conv.groupId,
            name: displayName || conv.name || 'Group chat',
            picture: conv.picture || others[0]?.picture || null,
            userType: 'group',
            timezone: 'UTC'
          },
          lastMessage: {
            content: lastMessage.content,
            senderId: lastMessage.senderId,
            createdAt: lastMessage.createdAt,
            type: lastMessage.type || (lastMessage.isSystemMessage ? 'system' : 'text'),
            isSystemMessage: !!lastMessage.isSystemMessage,
            reactions: lastMessage.reactions || []
          },
          unreadCount,
          updatedAt: lastMessage.createdAt
        };
      })
    );

    const combined = [...deduplicatedConversations, ...groupConversations.filter(Boolean)];

    // Sort by most recent
    combined.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json({
      success: true,
      conversations: combined
    });
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get conversations',
      conversations: []
    });
  }
});

// Get messages for a specific conversation
router.get('/conversations/:otherUserId/messages', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { otherUserId } = req.params;
    const { limit = 50, before } = req.query;
    
    console.log('📥 GET /conversations/:otherUserId/messages', { userId, otherUserId, limit, before });
    
    // Try to find messages with the exact conversationId first
    const ids = [userId, otherUserId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;
    
    console.log('🔍 Looking for messages with conversationId:', conversationId);
    
    // Get user info to check if they're a tutor or student
    const currentUser = await User.findOne({ auth0Id: userId });
    const isTutor = currentUser && currentUser.userType === 'tutor';
    const isStudent = currentUser && currentUser.userType === 'student';
    
    let query = { conversationId };
    
    // If user is a student, exclude system messages that are tutor-only
    if (isStudent) {
      query.$or = [
        { visibleToTutorOnly: { $ne: true } }, // Not tutor-only
        { visibleToTutorOnly: { $exists: false } } // Or doesn't have this field (old messages)
      ];
    }
    
    // If user is a tutor, show all messages including system messages
    // (tutors can see system messages in potential student conversations)
    
    // Handle 'before' parameter (message ID, not date)
    if (before) {
      // Find the message with this ID to get its createdAt timestamp
      const beforeMessage = await Message.findById(before).lean();
      
      if (beforeMessage) {
        console.log(`📅 Loading messages before message: ${before} (timestamp: ${beforeMessage.createdAt})`);
        
        if (query.$or) {
          query.$and = [
            { $or: query.$or },
            { createdAt: { $lt: beforeMessage.createdAt } }
          ];
          delete query.$or;
        } else {
          query.createdAt = { $lt: beforeMessage.createdAt };
        }
      } else {
        console.warn(`⚠️ Before message not found: ${before}, loading from beginning`);
      }
    }

    let messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    console.log(`✅ Found ${messages.length} messages for conversationId: ${conversationId}`);
    
    // If no messages found, try alternative conversationId formats
    // This handles cases where messages might have been stored with different ID formats
    if (messages.length === 0) {
      console.log('⚠️ No messages found with primary conversationId, trying alternative formats...');
      
      // Try reverse order (in case IDs were stored in different order)
      const reverseIds = [otherUserId, userId].sort();
      const reverseConversationId = `${reverseIds[0]}_${reverseIds[1]}`;
      
      if (reverseConversationId !== conversationId) {
        console.log('🔍 Trying reverse conversationId:', reverseConversationId);
        let altQuery = { conversationId: reverseConversationId };
        if (before) {
          const beforeMessage = await Message.findById(before).lean();
          if (beforeMessage) {
            altQuery.createdAt = { $lt: beforeMessage.createdAt };
          }
        }
        messages = await Message.find(altQuery)
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .lean();
        console.log(`✅ Found ${messages.length} messages with reverse conversationId`);
      }
      
      // If still no messages, try finding by senderId/receiverId directly
      if (messages.length === 0) {
        console.log('🔍 Trying to find messages by senderId/receiverId directly...');
        let directQuery = {
          $or: [
            { senderId: userId, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: userId }
          ]
        };
        if (before) {
          const beforeMessage = await Message.findById(before).lean();
          if (beforeMessage) {
            directQuery.createdAt = { $lt: beforeMessage.createdAt };
          }
        }
        messages = await Message.find(directQuery)
          .sort({ createdAt: -1 })
          .limit(parseInt(limit))
          .lean();
        console.log(`✅ Found ${messages.length} messages by direct senderId/receiverId match`);
        
        if (messages.length > 0) {
          console.log('📋 Sample messages found:', messages.slice(0, 2).map(m => ({
            conversationId: m.conversationId,
            senderId: m.senderId,
            receiverId: m.receiverId
          })));
        }
      }
    }
    
    if (messages.length > 0) {
      console.log('📋 Sample messages:', messages.slice(0, 3).map(m => ({
        id: m._id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        receiverId: m.receiverId,
        content: m.content?.substring(0, 50),
        createdAt: m.createdAt
      })));
    }

    // Mark messages as read - use the conversationId from found messages if available
    // Otherwise use the calculated conversationId
    const actualConversationId = messages.length > 0 ? messages[0].conversationId : conversationId;
    
    const updateResult = await Message.updateMany(
      { 
        $or: [
          { conversationId: actualConversationId, receiverId: userId, read: false },
          { senderId: userId, receiverId: otherUserId, read: false },
          { senderId: otherUserId, receiverId: userId, read: false }
        ]
      },
      { read: true, readAt: new Date() }
    );
    
    if (updateResult.modifiedCount > 0) {
      console.log(`📖 Marked ${updateResult.modifiedCount} messages as read`);
    }

    // Map _id to id for frontend compatibility and filter invalid replyTo
    const formattedMessages = messages.map(msg => {
      const formatted = {
        ...msg,
        id: msg._id.toString(),
        _id: undefined // Remove _id to avoid confusion
      };
      
      // Only include replyTo if it's valid (has messageId)
      if (formatted.replyTo && (typeof formatted.replyTo !== 'object' || !formatted.replyTo.messageId)) {
        delete formatted.replyTo;
      }
      
      return formatted;
    });

    res.json({
      success: true,
      messages: formattedMessages.reverse() // Return in chronological order
    });
  } catch (error) {
    console.error('❌ Error getting messages:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      messages: []
    });
  }
});

// Upload file and send as message
router.post('/conversations/:receiverId/upload', verifyToken, upload.single('file'), async (req, res) => {
  try {
    const senderId = req.user.sub;
    const { receiverId } = req.params;
    const { messageType, caption } = req.body; // messageType: 'image', 'file', or 'voice'

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    console.log('📤 File upload request:', {
      senderId,
      receiverId,
      messageType,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    // Initialize GCS
    const { bucket } = initializeGCS();
    if (!bucket) {
      return res.status(500).json({
        success: false,
        message: 'File storage not configured'
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const gcsFilename = `messages/${messageType}s/${senderId}/${timestamp}_${sanitizedFilename}`;

    console.log('☁️ Uploading to GCS:', gcsFilename);

    // Upload to GCS
    const file = bucket.file(gcsFilename);
    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
      },
      public: true
    });

    // Get public URL
    const fileUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFilename}`;
    console.log('✅ File uploaded successfully:', fileUrl);

    // Create message with file
    const ids = [senderId, receiverId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;

    const message = new Message({
      conversationId,
      senderId,
      receiverId,
      content: caption || '', // Optional caption
      type: messageType,
      fileUrl,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size
    });

    const savedMessage = await message.save();
    console.log('💾 Message with file saved:', savedMessage._id.toString());

    // Populate sender info
    const sender = await User.findOne({ auth0Id: senderId });

    const messageResponse = {
      id: savedMessage._id.toString(),
      conversationId: savedMessage.conversationId,
      senderId: savedMessage.senderId,
      receiverId: savedMessage.receiverId,
      content: savedMessage.content,
      type: savedMessage.type,
      fileUrl: savedMessage.fileUrl,
      fileName: savedMessage.fileName,
      fileType: savedMessage.fileType,
      fileSize: savedMessage.fileSize,
      read: savedMessage.read,
      createdAt: savedMessage.createdAt,
      sender: sender ? {
        id: sender._id.toString(),
        name: formatDisplayName(sender),
        picture: sender.picture
      } : null
    };

    // Emit via WebSocket to sender (confirmation)
    const senderSocketId = req.connectedUsers?.get(senderId);
    if (senderSocketId && req.io) {
      console.log('📤 Sending file upload confirmation to sender:', senderId);
      req.io.to(senderSocketId).emit('message_sent', messageResponse);
    }

    // Emit via WebSocket to receiver (real-time notification)
    const receiverSocketId = req.connectedUsers?.get(receiverId);
    if (receiverSocketId && req.io) {
      console.log('📤 Sending file message to receiver:', receiverId);
      req.io.to(receiverSocketId).emit('new_message', messageResponse);
    } else {
      console.log('📭 Receiver not online:', receiverId);
    }

    res.json({
      success: true,
      message: messageResponse
    });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file'
    });
  }
});

// Send a message
router.post('/conversations/:receiverId/messages', verifyToken, async (req, res) => {
  try {
    const senderId = req.user.sub;
    const { receiverId } = req.params;
    const { content, type = 'text', replyTo } = req.body;

    console.log('📨 HTTP POST /conversations/:receiverId/messages', { senderId, receiverId, content, type, replyTo });

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    if (!receiverId) {
      console.error('❌ No receiverId in params');
      return res.status(400).json({
        success: false,
        message: 'Receiver ID is required'
      });
    }

    const ids = [senderId, receiverId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;

    console.log('📝 Creating message with conversationId:', conversationId);

    const messageData = {
      conversationId,
      senderId,
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
    
    // Populate sender info for real-time response
    const sender = await User.findOne({ auth0Id: senderId });
    
    // If this is a tutor responding to a potential student conversation,
    // make the conversation visible to the student by removing visibleToTutorOnly flag
    // from all system messages in this conversation
    if (sender && sender.userType === 'tutor') {
      // Check if there are any system messages with visibleToTutorOnly in this conversation
      const systemMessages = await Message.find({
        conversationId,
        isSystemMessage: true,
        visibleToTutorOnly: true
      });
      
      if (systemMessages.length > 0) {
        // Make system messages visible to student (remove tutor-only restriction)
        await Message.updateMany(
          { conversationId, isSystemMessage: true, visibleToTutorOnly: true },
          { visibleToTutorOnly: false }
        );
        console.log('✅ Made potential student conversation visible to student');
      }
    }

    const messageResponse = {
      id: savedMessage._id.toString(),
      conversationId: savedMessage.conversationId,
      senderId: savedMessage.senderId,
      receiverId: savedMessage.receiverId,
      content: savedMessage.content,
      type: savedMessage.type,
      read: savedMessage.read,
      createdAt: savedMessage.createdAt,
      sender: sender ? {
        id: sender._id.toString(),
        name: formatDisplayName(sender),
        picture: sender.picture
      } : null
    };

    // Include replyTo in response only if it's valid (has messageId)
    if (savedMessage.replyTo && typeof savedMessage.replyTo === 'object' && savedMessage.replyTo.messageId) {
      messageResponse.replyTo = savedMessage.replyTo;
    }

    // Get receiver user to create notification
    const receiver = await User.findOne({ auth0Id: receiverId });
    
    // Message notifications removed - users should not get notifications for messages
    // Messages are handled via the Messages tab and WebSocket events only

    // Emit WebSocket message to receiver using ROOM (reaches ALL of receiver's tabs)
    const receiverRoom = `user:${receiverId}`;
    const receiverSockets = req.io?.sockets?.adapter?.rooms?.get(receiverRoom);
    const receiverSocketCount = receiverSockets ? receiverSockets.size : 0;
    
    console.log('📤 Checking WebSocket room for message:', {
      receiverId,
      receiverRoom,
      receiverSocketCount,
      hasIo: !!req.io
    });
    
    if (receiverSocketCount > 0 && req.io) {
      console.log(`✅ Emitting new_message to ${receiverSocketCount} socket(s) in room: ${receiverRoom}`);
      req.io.to(receiverRoom).emit('new_message', messageResponse);
    } else {
      console.log('⚠️ Receiver not online or WebSocket not available:', {
        receiverId,
        receiverRoom,
        receiverSocketCount,
        hasIo: !!req.io
      });
    }

    // Emit confirmation to sender using ROOM (reaches ALL sender's tabs)
    const senderRoom = `user:${senderId}`;
    const senderSockets = req.io?.sockets?.adapter?.rooms?.get(senderRoom);
    const senderSocketCount = senderSockets ? senderSockets.size : 0;
    
    if (senderSocketCount > 0 && req.io) {
      console.log(`✅ Emitting message_sent to ${senderSocketCount} socket(s) in room: ${senderRoom}`);
      req.io.to(senderRoom).emit('message_sent', messageResponse);
    }

    // Emit WebSocket notification to receiver (for notification dropdown - but user said messages shouldn't appear there)
    // Commenting this out since user said messages should not appear in notification dropdown
    // if (receiverSocketId && req.io) {
    //   req.io.to(receiverSocketId).emit('new_notification', {
    //     type: 'message',
    //     message: sender ? `${sender.name} sent you a message` : 'You have a new message'
    //   });
    // }

    res.json({
      success: true,
      message: messageResponse
    });
  } catch (error) {
    console.error('❌ Error sending message:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
});

// Mark messages as read
router.put('/conversations/:otherUserId/read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { otherUserId } = req.params;
    const ids = [userId, otherUserId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;

    await Message.updateMany(
      { conversationId, receiverId: userId, read: false },
      { read: true, readAt: new Date() }
    );

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read'
    });
  }
});

// Add reaction to a message
router.post('/messages/:messageId/reactions', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { messageId } = req.params;
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({
        success: false,
        message: 'Emoji is required'
      });
    }

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Get user info
    const user = await User.findOne({ auth0Id: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Initialize reactions array if it doesn't exist
    if (!message.reactions) {
      message.reactions = [];
    }

    console.log(`🎯 [REACTION] User ${userId} reacting with ${emoji} to message ${messageId}`);
    console.log(`🎯 [REACTION] Existing reactions:`, message.reactions.map(r => ({ userId: r.userId, emoji: r.emoji })));

    // Check if user already reacted with this exact emoji (use normalized comparison)
    const existingReaction = message.reactions.find(
      r => userIdsMatch(r.userId, userId) && r.emoji === emoji
    );

    let reactionAdded = false; // Track if reaction was added or removed
    
    if (existingReaction) {
      // Remove the reaction if clicking the same emoji (toggle off)
      console.log(`🎯 [REACTION] Same emoji found - toggling OFF`);
      message.reactions = message.reactions.filter(
        r => !userIdsMatch(r.userId, userId)
      );
      reactionAdded = false;
    } else {
      // Remove any existing reaction from this user first (only one reaction allowed)
      const hadPreviousReaction = message.reactions.some(r => userIdsMatch(r.userId, userId));
      console.log(`🎯 [REACTION] Had previous reaction: ${hadPreviousReaction}`);
      
      message.reactions = message.reactions.filter(
        r => !userIdsMatch(r.userId, userId)
      );
      // Add the new reaction
      message.reactions.push({
        emoji,
        userId,
        userName: formatDisplayName(user)
      });
      reactionAdded = true;
      console.log(`🎯 [REACTION] Added new reaction, total reactions now: ${message.reactions.length}`);
      
      // Create notification for the message author (if not reacting to own message)
      if (!userIdsMatch(message.senderId, userId)) {
        try {
          const Notification = require('../models/Notification');
          await Notification.create({
            userId: message.senderId,
            type: 'message',
            title: 'Message Reaction',
            message: `<strong>${formatDisplayName(user)}</strong> reacted ${emoji} to your message`,
            relatedUserPicture: user.picture || null,
            relatedUserId: userId,
            read: false
          });
          
          // Emit notification via WebSocket
          if (req.io && req.connectedUsers) {
            // Try multiple ID formats to find the socket
            let authorSocketId = req.connectedUsers.get(message.senderId);
            if (!authorSocketId) {
              authorSocketId = req.connectedUsers.get(`dev-user-${message.senderId}`);
            }
            if (!authorSocketId) {
              authorSocketId = req.connectedUsers.get(normalizeUserId(message.senderId));
            }
            
            if (authorSocketId) {
              req.io.to(authorSocketId).emit('new_notification', {
                type: 'message',
                title: 'Message Reaction',
                message: `${formatDisplayName(user)} reacted ${emoji} to your message`,
                userId: message.senderId
              });
              console.log('📤 Emitted new_notification to message author');
            } else {
              console.log('⚠️ Could not find socket for message author:', message.senderId);
            }
          }
        } catch (notifError) {
          console.error('Error creating reaction notification:', notifError);
          // Don't fail the reaction if notification fails
        }
      }
    }

    await message.save();

    // Populate sender info for response
    const updatedMessage = await Message.findById(messageId).lean();
    const sender = await User.findOne({ auth0Id: updatedMessage.senderId });
    if (sender) {
      updatedMessage.sender = {
        id: sender.auth0Id,
        name: formatDisplayName(sender),
        picture: sender.picture
      };
    }

    // Emit WebSocket event for real-time update
    console.log('📡 Emitting reaction update, req.io exists:', !!req.io, 'req.connectedUsers exists:', !!req.connectedUsers);
    if (req.io && req.connectedUsers) {
      // Helper to find socket ID with ID normalization
      const findSocketId = (userId) => {
        // Try direct lookup first
        let socketId = req.connectedUsers.get(userId);
        if (socketId) return socketId;
        
        // Try with dev-user- prefix
        socketId = req.connectedUsers.get(`dev-user-${userId}`);
        if (socketId) return socketId;
        
        // Try without dev-user- prefix
        const normalizedId = normalizeUserId(userId);
        socketId = req.connectedUsers.get(normalizedId);
        return socketId;
      };
      
      const senderSocketId = findSocketId(updatedMessage.senderId);
      const receiverSocketId = findSocketId(updatedMessage.receiverId);
      console.log('🔍 Sender socket:', senderSocketId, 'Receiver socket:', receiverSocketId);
      console.log('🔍 Looking up senderId:', updatedMessage.senderId, 'receiverId:', updatedMessage.receiverId);
      
      const reactionUpdate = {
        messageId: updatedMessage._id,
        message: updatedMessage,
        conversationId: updatedMessage.conversationId,
        // Add metadata for conversation preview
        isReaction: reactionAdded, // Only true if reaction was added, false if removed
        reactorName: formatDisplayName(user),
        reactorId: userId,
        emoji: reactionAdded ? emoji : null, // Only send emoji if reaction was added
        messageAuthorId: updatedMessage.senderId
      };
      
      // Notify sender
      if (senderSocketId) {
        req.io.to(senderSocketId).emit('reaction_updated', reactionUpdate);
        console.log('📤 Emitted reaction_updated to sender:', updatedMessage.senderId);
      }
      
      // Notify receiver
      if (receiverSocketId) {
        req.io.to(receiverSocketId).emit('reaction_updated', reactionUpdate);
        console.log('📤 Emitted reaction_updated to receiver:', updatedMessage.receiverId);
      }
    }

    res.json({
      success: true,
      message: updatedMessage
    });
  } catch (error) {
    console.error('Error adding reaction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reaction'
    });
  }
});

// Delete a message
router.delete('/messages/:messageId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { messageId } = req.params;

    // Find the message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Verify that the user is the sender of the message (only sender can delete)
    if (message.senderId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own messages'
      });
    }

    // Store conversation info before deletion for WebSocket notification
    const conversationId = message.conversationId;
    const senderId = message.senderId;
    const receiverId = message.receiverId;

    // Delete associated files from GCS if they exist
    if (message.fileUrl && (message.type === 'image' || message.type === 'file' || message.type === 'voice')) {
      try {
        const { bucket } = initializeGCS();
        if (bucket) {
          // Extract the GCS filename from the URL
          // URL format: https://storage.googleapis.com/bucket-name/path/to/file
          const urlParts = message.fileUrl.split(`${bucket.name}/`);
          if (urlParts.length > 1) {
            const gcsFilename = urlParts[1];
            console.log('🗑️ Deleting file from GCS:', gcsFilename);
            
            const file = bucket.file(gcsFilename);
            await file.delete();
            console.log('✅ File deleted from GCS successfully');
          }

          // Also delete thumbnail if it exists
          if (message.thumbnailUrl) {
            const thumbnailParts = message.thumbnailUrl.split(`${bucket.name}/`);
            if (thumbnailParts.length > 1) {
              const thumbnailFilename = thumbnailParts[1];
              console.log('🗑️ Deleting thumbnail from GCS:', thumbnailFilename);
              
              const thumbnailFile = bucket.file(thumbnailFilename);
              await thumbnailFile.delete();
              console.log('✅ Thumbnail deleted from GCS successfully');
            }
          }
        }
      } catch (gcsError) {
        // Log error but don't fail the message deletion
        console.error('⚠️ Error deleting file from GCS:', gcsError);
        // Continue with message deletion even if GCS deletion fails
      }
    }

    // Delete the message from database
    await Message.findByIdAndDelete(messageId);

    // Emit WebSocket event for real-time deletion
    console.log('📡 Emitting message deletion, req.io exists:', !!req.io, 'req.connectedUsers exists:', !!req.connectedUsers);
    if (req.io && req.connectedUsers) {
      const senderSocketId = req.connectedUsers.get(senderId);
      const receiverSocketId = req.connectedUsers.get(receiverId);
      console.log('🔍 Sender socket:', senderSocketId, 'Receiver socket:', receiverSocketId);
      
      const deleteEvent = {
        messageId: messageId,
        conversationId: conversationId
      };
      
      // Notify sender
      if (senderSocketId) {
        req.io.to(senderSocketId).emit('message_deleted', deleteEvent);
        console.log('📤 Emitted message_deleted to sender:', senderId);
      }
      
      // Notify receiver
      if (receiverSocketId) {
        req.io.to(receiverSocketId).emit('message_deleted', deleteEvent);
        console.log('📤 Emitted message_deleted to receiver:', receiverId);
      }
    }

    res.json({
      success: true,
      message: 'Message deleted successfully',
      messageId: messageId
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message'
    });
  }
});

// Create potential student conversation
router.post('/potential-student', verifyToken, async (req, res) => {
  try {
    const studentId = req.user.sub; // Current user (student)
    const { tutorId, triggerType } = req.body; // 'favorite' or 'book_lesson'

    console.log('📝 Creating potential student conversation:', { 
      studentId, 
      tutorId, 
      triggerType,
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent']?.substring(0, 50)
    });

    if (!tutorId || !triggerType) {
      return res.status(400).json({
        success: false,
        message: 'Tutor ID and trigger type are required'
      });
    }

    if (!['favorite', 'book_lesson'].includes(triggerType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trigger type. Must be "favorite" or "book_lesson"'
      });
    }

    // Get student and tutor info
    const student = await User.findOne({ auth0Id: studentId });
    const tutor = await User.findOne({ auth0Id: tutorId });

    console.log('🔍 Looking for users:', { 
      studentId, 
      tutorId,
      studentFound: !!student,
      tutorFound: !!tutor 
    });

    if (!student) {
      console.error('❌ Student not found with auth0Id:', studentId);
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    if (!tutor) {
      console.error('❌ Tutor not found with auth0Id:', tutorId);
      // Try to find by _id as fallback
      const tutorById = await User.findById(tutorId);
      console.log('🔍 Trying to find tutor by _id:', { tutorId, found: !!tutorById });
      
      if (tutorById) {
        console.log('✅ Found tutor by _id, using auth0Id:', tutorById.auth0Id);
        // Re-call with correct auth0Id
        return res.status(400).json({
          success: false,
          message: 'Tutor not found by auth0Id. Please use auth0Id instead of _id.',
          correctId: tutorById.auth0Id
        });
      }
      
      return res.status(404).json({
        success: false,
        message: 'Tutor not found'
      });
    }

    // Check if user is a student
    if (student.userType !== 'student') {
      return res.status(400).json({
        success: false,
        message: 'Only students can create potential student conversations'
      });
    }

    // Check if tutor is actually a tutor
    if (tutor.userType !== 'tutor') {
      return res.status(400).json({
        success: false,
        message: 'Target user must be a tutor'
      });
    }

    // Create conversation ID
    const ids = [studentId, tutorId].sort();
    const conversationId = `${ids[0]}_${ids[1]}`;

    console.log('🔍 Checking for existing conversation:', {
      studentId,
      tutorId,
      conversationId,
      studentAuth0Id: student.auth0Id,
      tutorAuth0Id: tutor.auth0Id
    });

    // Check if ANY conversation already exists (system message or regular messages)
    // We don't want to spam the tutor with notifications every time the student clicks
    const existingMessage = await Message.findOne({ conversationId });
    
    console.log('🔍 Existing message found:', existingMessage ? {
      id: existingMessage._id,
      type: existingMessage.type,
      isSystemMessage: existingMessage.isSystemMessage,
      senderId: existingMessage.senderId,
      receiverId: existingMessage.receiverId
    } : 'None');
    
    if (existingMessage) {
      // Conversation already exists (either with system message or real messages)
      console.log('ℹ️ Conversation already exists, not creating duplicate potential student notification:', conversationId);
      return res.json({
        success: true,
        message: 'Conversation already exists',
        conversationId,
        alreadyExists: true
      });
    }

    // Create system message content
    // Get tutor's languages (from onboardingData or profile)
    const tutorLanguages = tutor.onboardingData?.languages || tutor.profile?.languages || [];
    const primaryLanguage = tutorLanguages.length > 0 ? tutorLanguages[0] : 'language';
    
    // Format language text (e.g., "Spanish" or "Spanish and French")
    let languageText = primaryLanguage;
    if (tutorLanguages.length > 1) {
      languageText = tutorLanguages.slice(0, -1).join(', ') + ' and ' + tutorLanguages[tutorLanguages.length - 1];
    }
    
    // Get student name formatted as "FirstName LastInitial."
    const studentName = formatDisplayName(student);
    
    // Randomly select from different message templates for variation
    const messageTemplates = [
      `Student ${studentName} has shown interest in your ${languageText} lessons but hasn't finalized their booking yet.\n\nYou can start a conversation to answer any questions they may have about your methodology, class structure, or learning goals.`,
      
      `It looks like ${studentName} started booking a ${languageText} lesson with you but hasn't completed it yet.\n\nYou can reach out to see if they need any help or would like to know more about your classes, teaching style, or what to expect.`,
      
      `${studentName} has expressed interest in your ${languageText} lessons but hasn't finished the booking process.\n\nConsider sending a message to answer any questions they might have about your approach, availability, or course content.`,
      
      `${studentName} showed interest in your ${languageText} classes but didn't complete the booking.\n\nA quick message could make the difference — offer assistance or share a bit more about what makes your lessons unique.`
    ];
    
    // Randomly select a message template
    const randomIndex = Math.floor(Math.random() * messageTemplates.length);
    const systemMessageContent = `👋 ${messageTemplates[randomIndex]}`;

    // Create system message (senderId is 'system', but we'll use a special identifier)
    // For system messages, we'll use the tutorId as senderId but mark it as system
    const systemMessage = new Message({
      conversationId,
      senderId: 'system', // Special system sender
      receiverId: tutorId, // Only visible to tutor
      content: systemMessageContent,
      type: 'system',
      isSystemMessage: true,
      visibleToTutorOnly: true,
      triggerType,
      read: false
    });

    await systemMessage.save();
    console.log('✅ System message created:', {
      messageId: systemMessage._id.toString(),
      conversationId,
      studentName: student.name,
      tutorName: tutor.name,
      content: systemMessageContent.substring(0, 100) + '...'
    });

    // Create notification for tutor
    const Notification = require('../models/Notification');
    const notification = await Notification.create({
      userId: tutor._id,
      type: 'potential_student',
      title: 'Potential Student Interest',
      message: triggerType === 'favorite' 
        ? `<strong>${studentName}</strong> saved your profile`
        : `<strong>${studentName}</strong> clicked "Book lesson" on your profile`,
      relatedUserPicture: student.picture || null,
      data: {
        studentId: student._id.toString(),
        studentName: studentName,
        studentPicture: student.picture,
        conversationId,
        triggerType,
        messageId: systemMessage._id.toString()
      }
    });

    console.log('✅ Notification created for tutor:', {
      notificationId: notification._id.toString(),
      tutorId: tutor._id.toString(),
      tutorName: tutor.name,
      studentName: student.name,
      triggerType
    });

    // Emit WebSocket notification to tutor if online
    const tutorSocketId = req.connectedUsers?.get(tutorId);
    if (tutorSocketId && req.io) {
      console.log('📤 Emitting potential_student notification to tutor:', tutorId);
      
      // Emit notification event
      req.io.to(tutorSocketId).emit('new_notification', {
        type: 'potential_student',
        title: 'Potential Student Interest',
        message: triggerType === 'favorite' 
          ? `${studentName} saved your profile`
          : `${studentName} clicked "Book lesson" on your profile`,
        data: {
          studentId: student._id.toString(),
          studentName: studentName,
          studentPicture: student.picture,
          conversationId,
          triggerType
        }
      });
      
      // Also emit new_message event to update Messages tab unread count
      req.io.to(tutorSocketId).emit('new_message', {
        id: systemMessage._id.toString(),
        conversationId,
        senderId: 'system',
        receiverId: tutorId,
        content: systemMessageContent.substring(0, 100) + '...',
        type: 'system',
        isSystemMessage: true,
        read: false,
        createdAt: systemMessage.createdAt
      });
    }

    res.json({
      success: true,
      message: 'Potential student conversation created',
      conversationId,
      systemMessage: {
        id: systemMessage._id.toString(),
        conversationId: systemMessage.conversationId,
        content: systemMessage.content,
        type: systemMessage.type,
        isSystemMessage: systemMessage.isSystemMessage,
        triggerType: systemMessage.triggerType,
        createdAt: systemMessage.createdAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating potential student conversation:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create potential student conversation',
      error: error.message
    });
  }
});

// ========== Group conversations (multi-participant threads) ==========
//
// Membership lives in the `Conversation` collection. Each group thread has
// one row there keyed by `groupId`. There are two variants:
//   - class-broadcast: groupId = `grp_class_<classId>`, synced from Class roster.
//   - ad-hoc-group:    groupId = sha1 hash of sorted auth0Ids (immutable roster).
//
// The routes below look up membership from Conversation, enforce per-user
// visibility windows (joinedAt/leftAt) on reads/writes, and snapshot the
// active roster onto every outgoing `Message.groupParticipants` for legacy
// compatibility with consumers that still read that field.

/**
 * Lazy migration for pre-Conversation ad-hoc threads: if a groupId exists in
 * the Messages collection but has no Conversation row yet, materialize one
 * using the union of historical participants (joinedAt = first appearance
 * in the thread, so existing users retain full visibility).
 */
async function ensureConversationForGroupId(groupId) {
  if (!groupId) return null;
  let conv = await Conversation.findOne({ groupId });
  if (conv) return conv;

  const firstMsg = await Message.findOne({ isGroup: true, groupId }).sort({ createdAt: 1 });
  if (!firstMsg) return null;

  // Walk the history once to compute each user's first-appearance timestamp.
  // For legacy threads we treat joinedAt = first-message-createdAt so nobody
  // retroactively loses access.
  const firstSeen = new Map();
  const cursor = Message.find({ isGroup: true, groupId })
    .sort({ createdAt: 1 })
    .select('groupParticipants createdAt')
    .lean()
    .cursor();
  for await (const m of cursor) {
    for (const pid of m.groupParticipants || []) {
      if (!firstSeen.has(pid)) firstSeen.set(pid, m.createdAt);
    }
  }

  conv = await Conversation.create({
    groupId,
    type: 'ad-hoc-group',
    classId: null,
    name: firstMsg.groupName || '',
    picture: null,
    members: Array.from(firstSeen.entries()).map(([auth0Id, joinedAt]) => ({
      auth0Id,
      role: 'member',
      joinedAt,
      leftAt: null
    })),
    lastMessageAt: firstMsg.createdAt
  });
  return conv;
}

/**
 * Resolve an arbitrary set of user identifiers (auth0Id, Mongo _id, or dev-user-*)
 * into canonical auth0Ids. Returns `{ ids, users }` where ids are unique+sorted
 * auth0Ids and `users` is a matching list of resolved User docs (nulls omitted).
 */
async function resolveParticipantAuth0Ids(rawIds) {
  const inputs = Array.from(new Set((rawIds || []).map((x) => (x || '').trim()).filter(Boolean)));
  const resolved = [];
  for (const raw of inputs) {
    let u = await User.findOne({ auth0Id: raw });
    if (!u && !raw.startsWith('dev-user-')) {
      u = await User.findOne({ auth0Id: `dev-user-${raw}` });
    }
    if (!u && mongoose.Types.ObjectId.isValid(raw)) {
      u = await User.findById(raw);
    }
    if (u && u.auth0Id) {
      resolved.push(u);
    }
  }
  const seen = new Set();
  const unique = [];
  for (const u of resolved) {
    if (!seen.has(u.auth0Id)) {
      seen.add(u.auth0Id);
      unique.push(u);
    }
  }
  const ids = unique.map((u) => u.auth0Id).sort();
  return { ids, users: unique };
}

function userToSummary(u) {
  if (!u) return null;
  return {
    id: u._id.toString(),
    auth0Id: u.auth0Id,
    name: formatDisplayName(u),
    picture: u.picture || null,
    userType: u.userType || 'user',
    timezone: u.profile?.timezone || u.timezone || 'UTC'
  };
}

/**
 * POST /api/messaging/groups
 * Create-or-get a group conversation.
 *
 * Two modes:
 *   1. `classId` provided → class-broadcast. Idempotent find-or-create on the
 *      class, then syncs roster from `Class.tutorId + confirmedStudents`.
 *      `participantIds` is ignored; the class is authoritative.
 *   2. No `classId` → ad-hoc. `participantIds` is required; the group is keyed
 *      by the hash of the (sorted) participant set and the member list is
 *      immutable for the lifetime of the thread.
 *
 * Body: { participantIds?: string[], name?: string, classId?: string }
 * Returns: { success, groupId, participants, participantIds, name, alreadyExists, type, classId, archived }
 */
router.post('/groups', verifyToken, async (req, res) => {
  try {
    const senderId = req.user.sub;
    const { participantIds, name, classId } = req.body || {};

    if (classId) {
      if (!mongoose.Types.ObjectId.isValid(classId)) {
        return res.status(400).json({ success: false, message: 'Invalid classId' });
      }
      const classDoc = await ClassModel.findById(classId).populate('tutorId confirmedStudents');
      if (!classDoc) {
        return res.status(404).json({ success: false, message: 'Class not found' });
      }

      // Sync first so the caller's state reflects current roster.
      const { conversation: conv } = await syncClassConversation(classDoc, { suppressSystemMessage: true });
      if (!conv) {
        return res.status(500).json({ success: false, message: 'Could not materialize class conversation' });
      }

      // Verify caller is a member (active or historical). Non-members cannot
      // open the thread — this blocks, e.g., a random student hitting the URL.
      const member = conv.getMember(senderId);
      if (!member) {
        return res.status(403).json({ success: false, message: 'Not a member of this class thread.' });
      }

      // Populate active-member user summaries for the client.
      const activeIds = conv.members.filter((m) => !m.leftAt).map((m) => m.auth0Id);
      const activeUsers = await User.find({ auth0Id: { $in: activeIds } }).lean();
      const summaries = activeUsers.map((u) => ({
        id: u._id.toString(),
        auth0Id: u.auth0Id,
        name: formatDisplayName(u),
        picture: u.picture || null,
        userType: u.userType || 'user',
        timezone: u.profile?.timezone || u.timezone || 'UTC'
      }));

      // Update name if the caller provided one and the conv has none yet
      // (first-ever open). Don't overwrite a previously-set name silently.
      if (name && !conv.name) {
        conv.name = name;
        await conv.save();
      }

      return res.json({
        success: true,
        groupId: conv.groupId,
        type: conv.type,
        classId: conv.classId ? conv.classId.toString() : null,
        participants: summaries,
        participantIds: activeIds,
        name: conv.name || name || classDoc.name || '',
        alreadyExists: true,
        archived: !!member.leftAt,
        joinedAt: member.joinedAt,
        leftAt: member.leftAt
      });
    }

    // -------- Ad-hoc branch --------
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ success: false, message: 'participantIds or classId required' });
    }

    const { ids: resolvedIds, users: resolvedUsers } = await resolveParticipantAuth0Ids([
      senderId,
      ...participantIds
    ]);
    if (resolvedIds.length < 2) {
      return res.status(400).json({ success: false, message: 'A group needs at least 2 distinct participants.' });
    }

    const groupId = Message.getGroupId(resolvedIds);
    if (!groupId) {
      return res.status(500).json({ success: false, message: 'Could not compute groupId' });
    }

    // Find-or-create the Conversation row with everyone active from day one.
    let conv = await Conversation.findOne({ groupId });
    const alreadyExists = !!conv;
    if (!conv) {
      conv = await Conversation.create({
        groupId,
        type: 'ad-hoc-group',
        classId: null,
        name: (name || '').trim(),
        members: resolvedIds.map((auth0Id) => ({
          auth0Id,
          role: 'member',
          joinedAt: new Date(),
          leftAt: null
        }))
      });
    } else if (name && !conv.name) {
      conv.name = name;
      await conv.save();
    }

    const member = conv.getMember(senderId);
    if (!member) {
      return res.status(403).json({ success: false, message: 'Not a member of this group.' });
    }

    const participantsSummary = resolvedUsers
      .map(userToSummary)
      .filter(Boolean)
      .sort((a, b) => resolvedIds.indexOf(a.auth0Id) - resolvedIds.indexOf(b.auth0Id));

    return res.json({
      success: true,
      groupId: conv.groupId,
      type: conv.type,
      classId: null,
      participants: participantsSummary,
      participantIds: resolvedIds,
      name: conv.name || name || '',
      alreadyExists,
      archived: !!member.leftAt,
      joinedAt: member.joinedAt,
      leftAt: member.leftAt
    });
  } catch (error) {
    console.error('Error creating/getting group:', error);
    return res.status(500).json({ success: false, message: 'Failed to create group conversation' });
  }
});

/**
 * POST /api/messaging/groups/:groupId/messages
 * Send a message to a group. Sender must be an ACTIVE member of the
 * `Conversation` (i.e. `leftAt` is null). The message is delivered only to
 * active members at send time — leavers keep read access to their history
 * but do not receive new writes.
 *
 * Body: { content, type?, replyTo? }
 *   (`participantIds` / `name` are accepted but ignored — roster comes from
 *   the Conversation, not the client.)
 */
router.post('/groups/:groupId/messages', verifyToken, async (req, res) => {
  try {
    const senderId = req.user.sub;
    const { groupId } = req.params;
    const { content, type = 'text', replyTo } = req.body || {};

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }

    const conv = await ensureConversationForGroupId(groupId);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Group conversation not found.' });
    }

    if (!conv.isActiveMember(senderId)) {
      return res.status(403).json({
        success: false,
        message: 'You are no longer an active member of this group.'
      });
    }

    // Snapshot the active roster so downstream consumers that inspect
    // `groupParticipants` on the Message doc (eg. old badge calculators)
    // see a coherent list.
    const activeParticipants = conv.members.filter((m) => !m.leftAt).map((m) => m.auth0Id);

    const messageData = {
      conversationId: groupId,
      senderId,
      isGroup: true,
      groupId,
      groupParticipants: activeParticipants,
      groupName: conv.name || '',
      content: content.trim(),
      type,
      readBy: [senderId]
    };

    if (replyTo && typeof replyTo === 'object' && replyTo.messageId) {
      messageData.replyTo = replyTo;
    }

    const savedMessage = await new Message(messageData).save();

    // Denormalize latest activity onto the conversation so list queries sort correctly.
    conv.lastMessageAt = savedMessage.createdAt;
    const senderMember = conv.getMember(senderId);
    if (senderMember) senderMember.lastReadAt = savedMessage.createdAt;
    await conv.save();

    const sender = await User.findOne({ auth0Id: senderId });

    const messageResponse = {
      id: savedMessage._id.toString(),
      conversationId: savedMessage.conversationId,
      senderId: savedMessage.senderId,
      isGroup: true,
      groupId: savedMessage.groupId,
      groupParticipants: savedMessage.groupParticipants,
      groupName: savedMessage.groupName,
      content: savedMessage.content,
      type: savedMessage.type,
      read: false,
      readBy: savedMessage.readBy,
      createdAt: savedMessage.createdAt,
      sender: sender ? {
        id: sender._id.toString(),
        name: formatDisplayName(sender),
        picture: sender.picture
      } : null
    };
    if (savedMessage.replyTo && savedMessage.replyTo.messageId) {
      messageResponse.replyTo = savedMessage.replyTo;
    }

    // Broadcast only to active members; left members do NOT get the socket
    // event, matching the "option 2" semantic on the delivery layer too.
    if (req.io) {
      for (const pid of activeParticipants) {
        req.io.to(`user:${pid}`).emit(pid === senderId ? 'message_sent' : 'new_message', messageResponse);
      }
    }

    return res.json({ success: true, message: messageResponse });
  } catch (error) {
    console.error('❌ Error sending group message:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send group message',
      error: error.message
    });
  }
});

/**
 * GET /api/messaging/groups/:groupId/messages
 * Fetch messages for a group. Caller must be a member (active OR historical)
 * and only sees messages within their `[joinedAt, leftAt]` visibility window.
 *
 * This is what enforces "option 2" on the read side: a left student can
 * still open the archived thread and browse history up to their `leftAt`,
 * and a late joiner can't see what was posted before they enrolled.
 */
router.get('/groups/:groupId/messages', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;
    const { limit = 50, before } = req.query;

    const conv = await ensureConversationForGroupId(groupId);
    if (!conv) {
      return res.status(404).json({ success: false, message: 'Group not found.' });
    }

    const me = conv.getMember(userId);
    if (!me) {
      return res.status(403).json({ success: false, message: 'Not a member of this group.' });
    }

    const query = { isGroup: true, groupId };
    // Visibility window — strict slice of history.
    query.createdAt = { $gte: me.joinedAt };
    if (me.leftAt) query.createdAt.$lte = me.leftAt;

    if (before) {
      const beforeMessage = await Message.findById(before).lean();
      if (beforeMessage && beforeMessage.createdAt) {
        // Tighten the upper bound to `before`'s createdAt, respecting leftAt cap.
        const upper = me.leftAt && me.leftAt < beforeMessage.createdAt ? me.leftAt : beforeMessage.createdAt;
        query.createdAt = { ...query.createdAt, $lt: upper };
        delete query.createdAt.$lte;
      }
    }

    const messagesDesc = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 50, 200));

    // Hydrate sender info including members who have since left, so quoted
    // names still render correctly in archived history.
    const senderIds = Array.from(new Set(messagesDesc.map((m) => m.senderId).filter((id) => id && id !== 'system')));
    const senderUsers = await User.find({ auth0Id: { $in: senderIds } });
    const senderMap = new Map();
    senderUsers.forEach((u) => {
      senderMap.set(u.auth0Id, { id: u._id.toString(), name: formatDisplayName(u), picture: u.picture });
    });

    const messages = messagesDesc.reverse().map((m) => ({
      id: m._id.toString(),
      conversationId: m.conversationId,
      senderId: m.senderId,
      isGroup: true,
      isSystemMessage: !!m.isSystemMessage,
      groupId: m.groupId,
      groupParticipants: m.groupParticipants,
      groupName: m.groupName,
      content: m.content,
      type: m.type,
      read: Array.isArray(m.readBy) && m.readBy.includes(userId),
      readBy: m.readBy || [],
      createdAt: m.createdAt,
      reactions: m.reactions || [],
      sender: senderMap.get(m.senderId) || null,
      replyTo: m.replyTo && m.replyTo.messageId ? m.replyTo : undefined
    }));

    // Snapshot of the ACTIVE roster at query time — surfaces to the client
    // which members can still send messages, enabling the "X left the class"
    // UI treatment for members who have left.
    const activeParticipants = conv.members.filter((m) => !m.leftAt).map((m) => m.auth0Id);

    return res.json({
      success: true,
      messages,
      participants: activeParticipants,
      archived: !!me.leftAt,
      leftAt: me.leftAt || null,
      joinedAt: me.joinedAt || null,
      type: conv.type,
      classId: conv.classId ? conv.classId.toString() : null
    });
  } catch (error) {
    console.error('Error getting group messages:', error);
    return res.status(500).json({ success: false, message: 'Failed to get group messages' });
  }
});

/**
 * PUT /api/messaging/groups/:groupId/read
 * Mark all group messages in the caller's visibility window as read.
 * Leavers can still mark their archived history read (e.g. to clear the
 * unread badge after being removed) but we don't touch messages outside
 * their window.
 */
router.put('/groups/:groupId/read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { groupId } = req.params;

    const conv = await ensureConversationForGroupId(groupId);
    if (!conv) return res.json({ success: true, message: 'No conversation.' });

    const me = conv.getMember(userId);
    if (!me) return res.status(403).json({ success: false, message: 'Not a member.' });

    const windowFilter = {
      isGroup: true,
      groupId,
      readBy: { $ne: userId },
      createdAt: { $gte: me.joinedAt }
    };
    if (me.leftAt) windowFilter.createdAt.$lte = me.leftAt;

    await Message.updateMany(windowFilter, { $addToSet: { readBy: userId } });

    me.lastReadAt = new Date();
    await conv.save();

    return res.json({ success: true, message: 'Marked as read.' });
  } catch (error) {
    console.error('Error marking group as read:', error);
    return res.status(500).json({ success: false, message: 'Failed to mark group as read' });
  }
});

// ===========================================================================
// Archive / Unarchive / Delete (per-user inbox state)
//
// `:conversationId` accepts either:
//   • a group `groupId` (e.g. `grp_class_<classId>` or sha1 hash) — handled
//     by the `Conversation.members[]` flag on the caller's row.
//   • a 1:1 `conversationId` of the form `<authIdA>_<authIdB>` (sorted) —
//     handled by upserting a `MessagingPreference` row keyed by
//     (ownerAuth0Id = caller, peerAuth0Id = the other user).
//
// Routing for both shapes is centralised here so the frontend doesn't have
// to care which kind of thread it's acting on.
// ===========================================================================

/**
 * Resolve the "other" auth0Id from a 1:1 conversationId of the form
 * `<authA>_<authB>` (sorted) given the caller's auth0Id. Returns null if the
 * id doesn't look like a 1:1 conversationId or doesn't include the caller.
 *
 * Auth0 ids contain `|` (e.g. `auth0|abc123`) and never end with `_X` where
 * X is purely the suffix, so we can split safely on the FIRST `_` after a
 * known half. We try both halves and pick the one that matches the caller.
 */
function resolveOneOnOnePeer(conversationId, callerId) {
  if (!conversationId || !conversationId.includes('_')) return null;
  // Auth0 ids may contain underscores in pathological cases, but the
  // canonical sorted-pair format we generate uses `_` only as the separator.
  // Try splitting at every underscore and pick the split that yields the
  // caller in one half — this handles ids that contain auth0 connection
  // names, dev-user prefixes, etc.
  let pos = conversationId.indexOf('_');
  while (pos !== -1) {
    const a = conversationId.slice(0, pos);
    const b = conversationId.slice(pos + 1);
    if (a === callerId && b) return b;
    if (b === callerId && a) return a;
    pos = conversationId.indexOf('_', pos + 1);
  }
  return null;
}

/**
 * Apply an inbox-state mutation to a conversation. Encapsulates the
 * group-vs-1:1 dispatch so each endpoint stays small.
 *
 * `mutation` receives:
 *   • for a group: { kind: 'group', conv, member, isTutorClassBroadcast }
 *   • for a 1:1:   { kind: 'oneOnOne', pref }   ← pref is upserted by caller
 *
 * The mutation should set/clear the relevant fields and return nothing.
 * The caller persists the change.
 */
async function applyInboxStateChange(req, res, mutation, socketEventName = null) {
  const userId = req.user.sub;
  const { conversationId } = req.params;
  if (!conversationId) {
    return res.status(400).json({ success: false, message: 'conversationId required.' });
  }

  const emitToUser = () => {
    if (socketEventName && req.io) {
      const room = `user:${userId}`;
      const sockets = req.io.sockets.adapter.rooms.get(room);
      const socketCount = sockets ? sockets.size : 0;
      console.log(`[archive-sync] route=${socketEventName} sub=${userId} room=${room} socketsInRoom=${socketCount}`);
      if (socketCount === 0) {
        const allRooms = Array.from(req.io.sockets.adapter.rooms.keys()).filter(r => r.startsWith('user:'));
        console.log(`[archive-sync] no listener — known user: rooms:`, allRooms);
      }
      req.io.to(room).emit(socketEventName, { conversationId });
    }
  };

  // Group thread? Find the Conversation row.
  const conv = await Conversation.findOne({ groupId: conversationId });
  if (conv) {
    const member = conv.getMember(userId);
    if (!member) {
      return res.status(403).json({ success: false, message: 'Not a member of this conversation.' });
    }
    // A tutor on their own class broadcast cannot fully sever themselves
    // (we never set leftAt for them). Surface the flag so the caller can
    // enforce policy (e.g. delete-not-allowed).
    const isTutorClassBroadcast = conv.type === 'class-broadcast' && member.role === 'tutor';
    try {
      await mutation({ kind: 'group', conv, member, isTutorClassBroadcast });
      await conv.save();
      emitToUser();
      return res.json({ success: true });
    } catch (err) {
      if (err && err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      throw err;
    }
  }

  // 1:1 thread — derive peer + upsert MessagingPreference.
  const peerAuth0Id = resolveOneOnOnePeer(conversationId, userId);
  if (!peerAuth0Id) {
    return res.status(404).json({ success: false, message: 'Conversation not found.' });
  }
  const pref = await MessagingPreference.findOneAndUpdate(
    { ownerAuth0Id: userId, peerAuth0Id },
    { $setOnInsert: { ownerAuth0Id: userId, peerAuth0Id } },
    { upsert: true, new: true }
  );
  await mutation({ kind: 'oneOnOne', pref });
  await pref.save();
  emitToUser();
  return res.json({ success: true });
}

/**
 * POST /api/messaging/conversations/:conversationId/archive
 * Move the thread to the caller's Archive folder. Reversible via unarchive.
 * Other party is unaffected; new messages still arrive.
 */
router.post('/conversations/:conversationId/archive', verifyToken, async (req, res) => {
  try {
    await applyInboxStateChange(req, res, async ({ kind, member, pref }) => {
      const now = new Date();
      if (kind === 'group') {
        member.archivedAt = now;
      } else {
        pref.archivedAt = now;
      }
    }, 'conversation_archived');
  } catch (error) {
    console.error('Error archiving conversation:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to archive conversation.' });
    }
  }
});

/**
 * POST /api/messaging/conversations/:conversationId/unarchive
 * Move the thread back to the caller's main inbox.
 */
router.post('/conversations/:conversationId/unarchive', verifyToken, async (req, res) => {
  try {
    await applyInboxStateChange(req, res, async ({ kind, member, pref }) => {
      if (kind === 'group') {
        member.archivedAt = null;
      } else {
        pref.archivedAt = null;
      }
    }, 'conversation_unarchived');
  } catch (error) {
    console.error('Error unarchiving conversation:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to unarchive conversation.' });
    }
  }
});

/**
 * POST /api/messaging/conversations/:conversationId/delete
 *
 * Per-user permanent removal. Sets `hiddenAt = now` and (for group threads)
 * `leftAt = now` so the user no longer receives new messages. The thread is
 * NOT destroyed for the other participants.
 *
 * Tutor-on-class-broadcast guard:
 *   The class tutor cannot sever themselves from their own class chat (rule:
 *   "tutors are always reachable while they own the class"). For that case
 *   we hide the thread from their UI but keep them as an active member of
 *   the roster, so messages keep flowing. They can re-surface the thread by
 *   the back-end's roster sync (eg. sending a message into the class via
 *   another entry-point) but will not see student replies in their inbox
 *   until they unhide. Practically this is the kebab menu hiding Delete on
 *   class-broadcast for tutors — but the API still tolerates it for safety.
 */
router.post('/conversations/:conversationId/delete', verifyToken, async (req, res) => {
  try {
    await applyInboxStateChange(req, res, async ({ kind, member, pref, isTutorClassBroadcast }) => {
      const now = new Date();
      if (kind === 'group') {
        member.hiddenAt = now;
        member.archivedAt = null;
        if (!isTutorClassBroadcast) {
          member.leftAt = now;
        }
      } else {
        pref.hiddenAt = now;
        pref.archivedAt = null;
      }
    });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to delete conversation.' });
    }
  }
});

module.exports = router;
