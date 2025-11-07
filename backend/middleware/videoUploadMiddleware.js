const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const videoCompressionService = require('../services/videoCompressionService');
const { pipeline } = require('stream');
const { promisify } = require('util');

const pipelineAsync = promisify(pipeline);

// Configure multer for streaming uploads (videos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1000 * 1024 * 1024, // 1GB limit for input
  },
  fileFilter: (req, file, cb) => {
    console.log('🔍 File details:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      encoding: file.encoding,
      size: file.size
    });
    
    // Accept video files
    if (file.mimetype.startsWith('video/') || 
        file.originalname.toLowerCase().match(/\.(mp4|mov|avi|mkv|webm|flv|wmv)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'), false);
    }
  },
});

// Configure multer for image uploads (profile pictures)
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for images
  },
  fileFilter: (req, file, cb) => {
    console.log('🖼️ Image file details:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      encoding: file.encoding,
      size: file.size
    });
    
    // Accept image files
    if (file.mimetype.startsWith('image/') || 
        file.originalname.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp|bmp)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

// Initialize Google Cloud Storage
let storage = null;
let bucket = null;

function initializeGCS() {
  if (storage && bucket) {
    return { storage, bucket };
  }

  if (!process.env.GOOGLE_CLOUD_PROJECT_ID || !process.env.GOOGLE_CLOUD_BUCKET_NAME) {
    console.warn('⚠️ Google Cloud Storage not configured');
    return { storage: null, bucket: null };
  }

  try {
    storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
    });

    bucket = storage.bucket(process.env.GOOGLE_CLOUD_BUCKET_NAME);
    console.log('✅ Google Cloud Storage initialized');
    return { storage, bucket };
  } catch (error) {
    console.warn('⚠️ Google Cloud Storage initialization failed:', error.message);
    return { storage: null, bucket: null };
  }
}

// Enhanced video upload with compression
async function uploadVideoWithCompression(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const { bucket } = initializeGCS();
    if (!bucket) {
      return res.status(503).json({ 
        error: 'Video upload service not configured',
        details: 'Google Cloud Storage is not properly configured'
      });
    }

    // Get user info
    const user = await getUserFromRequest(req);
    if (!user || user.userType !== 'tutor') {
      return res.status(403).json({ error: 'Only tutors can upload videos' });
    }

    const originalSizeMB = req.file.size / (1024 * 1024);
    console.log(`📊 Original file size: ${originalSizeMB.toFixed(2)}MB`);

    let finalBuffer = req.file.buffer;
    let compressionInfo = null;

    // Compress if file is larger than 50MB
    if (req.file.size > 50 * 1024 * 1024) {
      console.log('🎬 Starting video compression...');
      
      const compressionOptions = {
        maxSizeMB: 50,
        maxWidth: 1280,
        maxHeight: 720,
        quality: originalSizeMB > 200 ? 32 : 28, // More aggressive for very large files
        format: 'mp4'
      };

      const compressionResult = await videoCompressionService.compressVideo(
        req.file.buffer, 
        compressionOptions
      );

      finalBuffer = compressionResult.buffer;
      compressionInfo = {
        originalSizeMB: originalSizeMB,
        compressedSizeMB: compressionResult.sizeMB,
        compressionRatio: compressionResult.compressionRatio,
        timeSaved: `${((originalSizeMB - compressionResult.sizeMB) / originalSizeMB * 100).toFixed(1)}%`
      };

      console.log('✅ Compression completed:', compressionInfo);
    } else {
      console.log('📝 File is small enough, skipping compression');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = req.file.originalname.split('.').pop() || 'mp4';
    const fileName = `tutor-videos/${user._id}/${timestamp}-compressed.${fileExtension}`;
    
    console.log('📤 Starting upload to Google Cloud Storage...');
    
    // Upload to Google Cloud Storage
    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: {
        contentType: 'video/mp4',
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
      },
      resumable: true, // Enable resumable uploads for large files
      validation: 'crc32c', // Enable checksum validation
    });

    // Track upload progress
    let uploadedBytes = 0;
    const totalBytes = finalBuffer.length;

    stream.on('error', (err) => {
      console.error('❌ Upload error:', err);
      res.status(500).json({ 
        error: 'Upload failed', 
        details: err.message,
        compressionInfo 
      });
    });

    stream.on('progress', (progress) => {
      uploadedBytes = progress.bytesWritten;
      const progressPercent = ((uploadedBytes / totalBytes) * 100).toFixed(1);
      console.log(`📤 Upload progress: ${progressPercent}% (${(uploadedBytes / 1024 / 1024).toFixed(2)}MB / ${(totalBytes / 1024 / 1024).toFixed(2)}MB)`);
    });

    stream.on('finish', async () => {
      try {
        // Make file publicly accessible
        await file.makePublic();
        
        // Get public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        
        // Update user's introduction video URL
        if (user.onboardingData) {
          user.onboardingData.introductionVideo = publicUrl;
        } else {
          user.onboardingData = { introductionVideo: publicUrl };
        }
        
        await user.save();
        
        console.log('✅ Video upload completed successfully');
        console.log(`🔗 Public URL: ${publicUrl}`);
        
        res.json({
          success: true,
          message: 'Video uploaded and compressed successfully',
          videoUrl: publicUrl,
          compressionInfo,
          uploadStats: {
            originalSizeMB: originalSizeMB,
            finalSizeMB: (finalBuffer.length / 1024 / 1024).toFixed(2),
            compressionRatio: compressionInfo ? compressionInfo.compressionRatio : 'N/A',
            timeSaved: compressionInfo ? compressionInfo.timeSaved : 'N/A'
          }
        });
      } catch (error) {
        console.error('❌ Error updating user record:', error);
        res.status(500).json({ 
          error: 'Failed to update user record',
          details: error.message,
          compressionInfo 
        });
      }
    });

    // Write buffer to stream
    stream.end(finalBuffer);

  } catch (error) {
    console.error('❌ Video upload error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}

// Helper function to get user from request
async function getUserFromRequest(req) {
  const User = require('../models/User');
  
  let user = await User.findOne({ auth0Id: req.user.sub });
  
  if (!user) {
    user = await User.findOne({ email: req.user.email });
  }
  
  return user;
}

// Middleware to verify Auth0 token
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    console.log('🔍 Backend: Received token:', token.substring(0, 20) + '...');
    
    let userInfo;
    
    // Handle dev tokens (for development)
    if (token.startsWith('dev-token-')) {
      console.log('🔍 Backend: Processing dev token');
      const emailPart = token.replace('dev-token-', '');
      // Convert hyphens back to dots, but preserve the @ symbol
      // The emailPart should be like "phillip-dacosta-gmail-com"
      // We need to convert it back to "phillip.dacosta@gmail.com"
      const parts = emailPart.split('-');
      if (parts.length >= 2) {
        // Find the domain part (usually the last 2 parts: "gmail" and "com")
        const domainParts = parts.slice(-2);
        const usernameParts = parts.slice(0, -2);
        
        const username = usernameParts.join('.');
        const domain = domainParts.join('.');
        const email = `${username}@${domain}`;
        
        userInfo = {
          sub: `dev-user-${email}`,
          email: email,
          name: username
        };
      } else {
        // Fallback: convert all hyphens to dots
        const email = emailPart.replace(/-/g, '.');
        userInfo = {
          sub: `dev-user-${email}`,
          email: email,
          name: email.split('@')[0]
        };
      }
      console.log('🔍 Backend: Dev token processed, user:', userInfo.email);
    } 
    // Handle Auth0 JWT tokens
    else if (token.includes('.')) {
      console.log('🔍 Backend: Processing Auth0 JWT token');
      try {
        // For development, we'll decode the JWT without verification
        // In production, you should verify the JWT signature
        const parts = token.split('.');
        if (parts.length !== 3) {
          throw new Error('Invalid JWT format');
        }
        
        // Add padding if needed for base64 decoding
        let payload = parts[1];
        while (payload.length % 4) {
          payload += '=';
        }
        
        const decodedPayload = JSON.parse(Buffer.from(payload, 'base64').toString());
        console.log('🔍 Backend: JWT payload:', decodedPayload);
        
        userInfo = {
          sub: decodedPayload.sub,
          email: decodedPayload.email,
          name: decodedPayload.name || decodedPayload.nickname || decodedPayload.email?.split('@')[0],
          email_verified: decodedPayload.email_verified,
          picture: decodedPayload.picture || decodedPayload.picture_url || null
        };
        console.log('🔍 Backend: Auth0 token processed, user:', userInfo.email);
      } catch (jwtError) {
        console.error('🔍 Backend: Error decoding JWT:', jwtError);
        console.error('🔍 Backend: Token parts:', token.split('.').length);
        console.error('🔍 Backend: First 50 chars of token:', token.substring(0, 50));
        
        // Fallback: if JWT decoding fails, treat as unknown user
        console.log('🔍 Backend: JWT decoding failed, using fallback user');
        userInfo = {
          sub: 'jwt-decode-failed',
          email: 'unknown@jwt-failed.com',
          name: 'JWT Decode Failed'
        };
      }
    }
    // Fallback for unknown token format
    else {
      console.log('🔍 Backend: Unknown token format, using default user');
      userInfo = {
        sub: 'dev-user-123',
        email: 'dev@example.com',
        name: 'Development User'
      };
    }
    
    req.user = userInfo;
    console.log('🔍 Backend: Final user info:', { sub: userInfo.sub, email: userInfo.email, name: userInfo.name });
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Image upload handler
async function uploadImageToGCS(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { storage, bucket } = initializeGCS();
    if (!storage || !bucket) {
      return res.status(500).json({ error: 'Google Cloud Storage not configured' });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExtension = req.file.originalname.split('.').pop();
    const fileName = `profile-pictures/${req.user.sub}/${timestamp}-${randomString}.${fileExtension}`;

    // Create file in bucket
    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: {
        contentType: req.file.mimetype,
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
      },
    });

    // Upload file
    stream.on('error', (error) => {
      console.error('❌ Error uploading image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    });

    stream.on('finish', async () => {
      try {
        // Make file publicly accessible
        await file.makePublic();
        
        // Get public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        
        console.log('✅ Image uploaded successfully:', publicUrl);
        
        res.json({
          success: true,
          imageUrl: publicUrl,
          fileName: fileName
        });
      } catch (error) {
        console.error('❌ Error making file public:', error);
        res.status(500).json({ error: 'Failed to make image public' });
      }
    });

    stream.end(req.file.buffer);
  } catch (error) {
    console.error('❌ Error in uploadImageToGCS:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  upload,
  uploadImage,
  uploadVideoWithCompression,
  uploadImageToGCS,
  verifyToken,
  getUserFromRequest
};
