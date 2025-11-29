const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const { sdkToken, roomToken, TokenRole } = require('netless-token');

// Agora Whiteboard credentials from environment
const WHITEBOARD_APP_ID = process.env.AGORA_WHITEBOARD_APP_ID;
const WHITEBOARD_AK = process.env.AGORA_WHITEBOARD_AK;
const WHITEBOARD_SK = process.env.AGORA_WHITEBOARD_SK;
const WHITEBOARD_REGION = process.env.AGORA_WHITEBOARD_REGION || 'us-sv';

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

module.exports = router;

