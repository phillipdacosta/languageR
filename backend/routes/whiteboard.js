const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { verifyToken, getUserFromRequest } = require('../middleware/videoUploadMiddleware');
const { sdkToken, roomToken, TokenRole } = require('netless-token');
const Lesson = require('../models/Lesson');
const ClassModel = require('../models/Class');

// Agora Whiteboard credentials from environment
const WHITEBOARD_APP_ID = process.env.AGORA_WHITEBOARD_APP_ID;
const WHITEBOARD_AK = process.env.AGORA_WHITEBOARD_AK;
const WHITEBOARD_SK = process.env.AGORA_WHITEBOARD_SK;
const WHITEBOARD_REGION = process.env.AGORA_WHITEBOARD_REGION || 'us-sv';

// Room token TTL: covers a typical lesson (incl. office hours overrun) without
// forcing a mid-session refresh. The server is the only thing that mints
// these, so this can stay generous.
const ROOM_TOKEN_TTL_MS = 1000 * 60 * 60 * 4; // 4 hours
const ADMIN_SDK_TOKEN_TTL_MS = 1000 * 60 * 10; // 10 minutes (admin ops only)

function makeSdkToken(ttlMs = ADMIN_SDK_TOKEN_TTL_MS) {
  return sdkToken(WHITEBOARD_AK, WHITEBOARD_SK, ttlMs, { role: TokenRole.Admin });
}

function makeRoomToken(roomUUID, ttlMs = ROOM_TOKEN_TTL_MS) {
  return roomToken(WHITEBOARD_AK, WHITEBOARD_SK, ttlMs, {
    role: TokenRole.Writer,
    uuid: roomUUID,
  });
}

async function createNetlessRoom() {
  const response = await axios.post(
    'https://api.netless.link/v5/rooms',
    { isRecord: false, limit: 0 },
    {
      headers: {
        token: makeSdkToken(),
        'Content-Type': 'application/json',
        region: WHITEBOARD_REGION,
      },
    }
  );
  return response.data.uuid;
}

async function deleteNetlessRoom(roomUUID) {
  await axios.delete(`https://api.netless.link/v5/rooms/${roomUUID}`, {
    headers: { token: makeSdkToken(), region: WHITEBOARD_REGION },
  });
}

/**
 * Create a new whiteboard room
 * POST /api/whiteboard/create-room
 */
router.post('/create-room', verifyToken, async (req, res) => {
  try {
    if (!WHITEBOARD_APP_ID || !WHITEBOARD_AK || !WHITEBOARD_SK) {
      return res.status(500).json({
        success: false,
        message: 'Whiteboard credentials not configured'
      });
    }

    const { isRecord = false } = req.body;
    
    // Generate SDK Token using official netless-token library
    // Token expires in 1 hour (3600000 milliseconds)
    // Use 0 for no expiration, but 1 hour is safer
    const netlessSDKToken = sdkToken(
      WHITEBOARD_AK,
      WHITEBOARD_SK,
      1000 * 60 * 60, // 1 hour
      {
        role: TokenRole.Admin // Admin role to create rooms
      }
    );

    console.log('🎨 Creating whiteboard room...');
    console.log('🔑 Using official netless-token library');

    const response = await axios.post(
      'https://api.netless.link/v5/rooms',
      {
        isRecord: isRecord,
        limit: 0 // 0 = unlimited participants
      },
      {
        headers: {
          'token': netlessSDKToken,
          'Content-Type': 'application/json',
          'region': WHITEBOARD_REGION
        }
      }
    );

    const roomUUID = response.data.uuid;
    console.log('✅ Whiteboard room created:', roomUUID);

    // Generate a room token for the newly created room
    // Default role is 'writer' which allows drawing/editing
    const netlessRoomToken = roomToken(
      WHITEBOARD_AK,
      WHITEBOARD_SK,
      1000 * 60 * 60, // 1 hour
      {
        role: TokenRole.Writer, // Writer role for participants
        uuid: roomUUID
      }
    );

    console.log('✅ Room token generated for room:', roomUUID);

    res.json({
      success: true,
      roomUUID: roomUUID,
      roomToken: netlessRoomToken,
      appId: WHITEBOARD_APP_ID
    });
  } catch (error) {
    console.error('❌ Error creating whiteboard room:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
      config: {
        url: error.config?.url,
        headers: error.config?.headers
      }
    });
    res.status(500).json({
      success: false,
      message: 'Failed to create whiteboard room',
      error: error.response?.data || error.message,
      details: {
        status: error.response?.status,
        statusText: error.response?.statusText
      }
    });
  }
});

/**
 * Generate room token for an existing room
 * POST /api/whiteboard/room-token
 */
router.post('/room-token', verifyToken, async (req, res) => {
  try {
    if (!WHITEBOARD_AK || !WHITEBOARD_SK) {
      return res.status(500).json({
        success: false,
        message: 'Whiteboard credentials not configured'
      });
    }

    const { roomUUID, role = 'writer' } = req.body;

    if (!roomUUID) {
      return res.status(400).json({
        success: false,
        message: 'roomUUID is required'
      });
    }

    // Map role string to TokenRole enum
    let tokenRole = TokenRole.Writer;
    if (role === 'admin') tokenRole = TokenRole.Admin;
    else if (role === 'reader') tokenRole = TokenRole.Reader;

    // Generate room token using official netless-token library
    const netlessRoomToken = roomToken(
      WHITEBOARD_AK,
      WHITEBOARD_SK,
      1000 * 60 * 60, // 1 hour
      {
        role: tokenRole,
        uuid: roomUUID
      }
    );

    console.log(`🎨 Generated room token for room: ${roomUUID}, role: ${role}`);

    res.json({
      success: true,
      roomToken: netlessRoomToken,
      appId: WHITEBOARD_APP_ID
    });
  } catch (error) {
    console.error('❌ Error generating room token:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate room token',
      error: error.message
    });
  }
});

/**
 * Delete a whiteboard room (cleanup)
 * DELETE /api/whiteboard/room/:roomUUID
 */
router.delete('/room/:roomUUID', verifyToken, async (req, res) => {
  try {
    const { roomUUID } = req.params;

    if (!roomUUID) {
      return res.status(400).json({
        success: false,
        message: 'roomUUID is required'
      });
    }

    // Generate SDK Token using official netless-token library
    const netlessSDKToken = sdkToken(
      WHITEBOARD_AK,
      WHITEBOARD_SK,
      1000 * 60 * 10, // 10 minutes for delete operation
      {
        role: TokenRole.Admin
      }
    );

    console.log(`🗑️ Deleting whiteboard room: ${roomUUID}`);

    await axios.delete(
      `https://api.netless.link/v5/rooms/${roomUUID}`,
      {
        headers: {
          'token': netlessSDKToken,
          'region': WHITEBOARD_REGION
        }
      }
    );

    console.log('✅ Whiteboard room deleted');

    res.json({
      success: true,
      message: 'Room deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting room:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete room',
      error: error.response?.data?.message || error.message
    });
  }
});

/**
 * Atomic get-or-create endpoint for a lesson/class whiteboard.
 *
 * This is the **only** endpoint the in-call client should use. It prevents
 * the race that broke prod: previously the client (a) fetched the
 * lesson/class to see if a room was already saved, (b) fell back to creating
 * a fresh room, (c) PATCHed the lesson/class with the new UUID. Two clients
 * (tutor + student) running that sequence concurrently — or running it while
 * the PATCH was still in flight, or while the PATCH had silently failed —
 * could land in two different rooms, so the student saw an empty whiteboard
 * while the tutor was drawing.
 *
 * Behavior here:
 *  - Caller must be a participant of the lesson/class (tutor or confirmed
 *    student). The previous `room-token` endpoint had no such check.
 *  - If the lesson/class already has `whiteboardRoomUUID`, we just mint a
 *    room token. No external call to Netless.
 *  - If it does not, only the tutor may create. Students get 409
 *    `WHITEBOARD_NOT_STARTED` so the client can retry until the tutor
 *    opens the board.
 *  - Creation is guarded by `findOneAndUpdate({ whiteboardRoomUUID: null })`
 *    so a second concurrent tutor request cannot overwrite a UUID that was
 *    already persisted. The losing request's Netless room is deleted
 *    best-effort.
 *
 * POST /api/whiteboard/session
 * Body: { scope: 'lesson' | 'class', id: string }
 * Returns: { success, roomUUID, roomToken, appId, region, role }
 */
router.post('/session', verifyToken, async (req, res) => {
  try {
    if (!WHITEBOARD_APP_ID || !WHITEBOARD_AK || !WHITEBOARD_SK) {
      return res.status(500).json({
        success: false,
        message: 'Whiteboard credentials not configured',
      });
    }

    const { scope, id } = req.body || {};
    if (!scope || !id) {
      return res.status(400).json({ success: false, message: 'scope and id are required' });
    }
    if (scope !== 'lesson' && scope !== 'class') {
      return res.status(400).json({ success: false, message: 'scope must be "lesson" or "class"' });
    }

    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const Model = scope === 'lesson' ? Lesson : ClassModel;
    const doc = await Model.findById(id).select(
      scope === 'lesson'
        ? 'tutorId studentId whiteboardRoomUUID whiteboardCreatedAt'
        : 'tutorId confirmedStudents whiteboardRoomUUID whiteboardCreatedAt'
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: `${scope} not found` });
    }

    const userIdStr = user._id.toString();
    const isTutor = doc.tutorId && doc.tutorId.toString() === userIdStr;
    const isStudent = scope === 'lesson'
      ? doc.studentId && doc.studentId.toString() === userIdStr
      : (doc.confirmedStudents || []).some((s) => s && s.toString() === userIdStr);

    if (!isTutor && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Not a participant of this session',
      });
    }

    let roomUUID = doc.whiteboardRoomUUID || null;

    if (!roomUUID) {
      if (!isTutor) {
        // Students must wait for the tutor to open the board. The client
        // should poll/retry on this 409 so the student auto-joins the
        // moment the tutor creates the room.
        return res.status(409).json({
          success: false,
          code: 'WHITEBOARD_NOT_STARTED',
          message: 'Whiteboard has not been opened by the tutor yet',
        });
      }

      let createdUUID;
      try {
        createdUUID = await createNetlessRoom();
      } catch (err) {
        console.error('❌ Netless room creation failed:', {
          status: err.response?.status,
          data: err.response?.data,
          message: err.message,
        });
        return res.status(502).json({
          success: false,
          message: 'Failed to create whiteboard room with Agora',
          error: err.response?.data?.message || err.message,
        });
      }

      // Atomically save — only if nothing was persisted in the meantime.
      // If two tutor sessions race, the winner's UUID is kept and the
      // loser's room is reaped so we don't leak it on Agora's side.
      const winner = await Model.findOneAndUpdate(
        {
          _id: id,
          $or: [{ whiteboardRoomUUID: null }, { whiteboardRoomUUID: { $exists: false } }],
        },
        { $set: { whiteboardRoomUUID: createdUUID, whiteboardCreatedAt: new Date() } },
        { new: true, projection: { whiteboardRoomUUID: 1 } }
      );

      if (winner && winner.whiteboardRoomUUID === createdUUID) {
        roomUUID = createdUUID;
        console.log(`🎨 Whiteboard room ${createdUUID} created for ${scope} ${id} by ${user.email}`);
      } else {
        const fresh = await Model.findById(id).select('whiteboardRoomUUID');
        roomUUID = fresh?.whiteboardRoomUUID || null;
        console.warn(
          `⚠️ Lost whiteboard create race for ${scope} ${id}; using existing ${roomUUID}, deleting orphan ${createdUUID}`
        );
        deleteNetlessRoom(createdUUID).catch((cleanupErr) =>
          console.warn('⚠️ Failed to delete orphan whiteboard room', createdUUID, cleanupErr?.message)
        );
        if (!roomUUID) {
          return res.status(500).json({
            success: false,
            message: 'Whiteboard room not available after race',
          });
        }
      }
    }

    const tokenStr = makeRoomToken(roomUUID);

    return res.json({
      success: true,
      roomUUID,
      roomToken: tokenStr,
      appId: WHITEBOARD_APP_ID,
      region: WHITEBOARD_REGION,
      role: isTutor ? 'tutor' : 'student',
    });
  } catch (error) {
    console.error('❌ Whiteboard session error:', {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to start whiteboard session',
      error: error.message,
    });
  }
});

module.exports = router;

