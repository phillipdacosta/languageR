const { Storage } = require('@google-cloud/storage');

/**
 * Google Cloud Storage Service for Audio Files
 * 
 * Handles audio storage to avoid MongoDB 16MB document limit.
 * Cost-effective approach: Store audio in GCS, keep metadata in MongoDB.
 * 
 * Pricing (us-central1 Standard Storage):
 * - Storage: $0.020/GB/month
 * - Upload (Class A): $0.05 per 10,000 operations
 * - Download (Class B): $0.004 per 10,000 operations
 * 
 * Example: 1000 lessons/month × 500KB audio = 500MB
 * Cost: ~$0.01/month storage + ~$0.01 operations = $0.02/month total
 */

// Initialize GCS client using existing config
let storage = null;
function getStorageClient() {
  if (!storage) {
    const storageConfig = {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    };

    // For local development, use key file
    if (process.env.GOOGLE_CLOUD_KEY_FILE) {
      storageConfig.keyFilename = process.env.GOOGLE_CLOUD_KEY_FILE;
    }
    // For cloud deployment (Render), use JSON credentials
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      storageConfig.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    }

    storage = new Storage(storageConfig);
  }
  return storage;
}

// Use existing bucket for consistency
const BUCKET_NAME = process.env.GOOGLE_CLOUD_BUCKET_NAME || 'languager-videos-2025';

/**
 * Upload audio to Google Cloud Storage
 * @param {Buffer} audioBuffer - Audio data as buffer
 * @param {string} lessonId - Lesson ID
 * @param {number} segmentIndex - Segment index
 * @param {string} mimeType - Audio MIME type (e.g., 'audio/webm', 'audio/wav')
 * @returns {Promise<string>} - GCS public URL
 */
async function uploadAudio(audioBuffer, lessonId, segmentIndex, mimeType) {
  try {
    const bucket = getStorageClient().bucket(BUCKET_NAME);
    
    // Generate filename: audio/{lessonId}/segment-{index}.{ext}
    const extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') ? 'mp3' : 'webm';
    const filename = `audio/${lessonId}/segment-${segmentIndex}.${extension}`;
    
    const file = bucket.file(filename);
    
    // Upload with metadata
    await file.save(audioBuffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          lessonId,
          segmentIndex: segmentIndex.toString(),
          uploadedAt: new Date().toISOString(),
        },
      },
      // Make file publicly readable (optional - remove if you want signed URLs)
      public: false, // Set to true for public access, false for private (requires signed URLs)
    });
    
    console.log(`✅ Uploaded audio to GCS: ${filename} (${Math.round(audioBuffer.length / 1024)}KB)`);
    
    // Return GCS path (not public URL yet - we'll use signed URLs for playback)
    return `gs://${BUCKET_NAME}/${filename}`;
  } catch (error) {
    console.error('❌ Error uploading to GCS:', error);
    throw error;
  }
}

/**
 * Generate signed URL for audio playback
 * @param {string} gcsPath - GCS path (gs://bucket/path/to/file)
 * @param {number} expiresInMinutes - URL expiration time (default 60 minutes)
 * @returns {Promise<string>} - Signed URL for playback
 */
async function getSignedUrl(gcsPath, expiresInMinutes = 60) {
  try {
    // Extract bucket and filename from gs:// path
    const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid GCS path: ${gcsPath}`);
    }
    
    const [, bucketName, filename] = match;
    const bucket = getStorageClient().bucket(bucketName);
    const file = bucket.file(filename);
    
    // Generate signed URL
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });
    
    return url;
  } catch (error) {
    console.error('❌ Error generating signed URL:', error);
    throw error;
  }
}

/**
 * Delete audio file from GCS
 * @param {string} gcsPath - GCS path (gs://bucket/path/to/file)
 */
async function deleteAudio(gcsPath) {
  try {
    const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid GCS path: ${gcsPath}`);
    }
    
    const [, bucketName, filename] = match;
    const bucket = getStorageClient().bucket(bucketName);
    const file = bucket.file(filename);
    
    await file.delete();
    console.log(`🗑️  Deleted audio from GCS: ${filename}`);
  } catch (error) {
    if (error.code === 404) {
      console.log(`ℹ️  Audio file not found (already deleted): ${gcsPath}`);
    } else {
      console.error('❌ Error deleting from GCS:', error);
      throw error;
    }
  }
}

/**
 * Delete all audio for a lesson
 * @param {string} lessonId - Lesson ID
 */
async function deleteLessonAudio(lessonId) {
  try {
    const bucket = getStorageClient().bucket(BUCKET_NAME);
    const prefix = `audio/${lessonId}/`;
    
    // Delete all files with this prefix
    await bucket.deleteFiles({ prefix });
    console.log(`🗑️  Deleted all audio for lesson ${lessonId}`);
  } catch (error) {
    console.error('❌ Error deleting lesson audio:', error);
    throw error;
  }
}

module.exports = {
  uploadAudio,
  getSignedUrl,
  deleteAudio,
  deleteLessonAudio,
};




