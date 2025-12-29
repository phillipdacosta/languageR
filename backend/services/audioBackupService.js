const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Initialize Google Cloud Storage (matching pattern from cloudStorageService)
let storage;
function getStorage() {
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
    // Fallback to GOOGLE_APPLICATION_CREDENTIALS
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      storageConfig.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    // Last resort: default path
    else {
      storageConfig.keyFilename = path.join(__dirname, '../config/gcs-key.json');
    }

    storage = new Storage(storageConfig);
  }
  return storage;
}

// Lazy load bucket name to ensure env vars are loaded
function getBucketName() {
  return process.env.GCS_AUDIO_BACKUP_BUCKET || process.env.GOOGLE_CLOUD_BUCKET_NAME || 'languager-videos-2025';
}

const RETENTION_HOURS = 48; // Auto-delete after 48 hours

/**
 * Upload audio chunk to GCS for backup
 * @param {Buffer} audioBuffer - Audio data
 * @param {string} lessonId - Lesson ID
 * @param {number} chunkIndex - Chunk sequence number
 * @param {string} speaker - 'student' or 'tutor'
 * @param {string} mimeType - Audio MIME type
 * @returns {Promise<{gcsPath: string, sizeBytes: number, deleteAt: Date}>}
 */
async function uploadAudioChunk(audioBuffer, lessonId, chunkIndex, speaker, mimeType = 'audio/webm') {
  try {
    const timestamp = Date.now();
    const extension = mimeType.includes('webm') ? 'webm' : 
                     mimeType.includes('mp3') ? 'mp3' : 
                     mimeType.includes('wav') ? 'wav' : 'audio';
    
    const fileName = `lessons/${lessonId}/chunk-${chunkIndex}-${speaker}-${timestamp}.${extension}`;
    const bucket = getStorage().bucket(getBucketName());
    const file = bucket.file(fileName);
    
    // Calculate delete timestamp (48 hours from now)
    const deleteAt = new Date(Date.now() + (RETENTION_HOURS * 60 * 60 * 1000));
    
    // Upload with metadata
    await file.save(audioBuffer, {
      metadata: {
        contentType: mimeType,
        metadata: {
          lessonId,
          chunkIndex: chunkIndex.toString(),
          speaker,
          uploadedAt: new Date().toISOString(),
          deleteAt: deleteAt.toISOString(),
          purpose: 'transcription-backup'
        }
      }
    });
    
    console.log(`✅ Audio backup uploaded: ${fileName} (${audioBuffer.length} bytes)`);
    
    return {
      gcsPath: `gs://${getBucketName()}/${fileName}`,
      sizeBytes: audioBuffer.length,
      deleteAt
    };
  } catch (error) {
    console.error('❌ Error uploading audio backup to GCS:', error);
    // Don't throw - backup failure shouldn't break transcription
    return null;
  }
}

/**
 * Download audio chunk from GCS
 * @param {string} gcsPath - Full GCS path (gs://bucket/path)
 * @returns {Promise<Buffer>}
 */
async function downloadAudioChunk(gcsPath) {
  try {
    // Parse GCS path (gs://bucket/path)
    const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid GCS path format: ${gcsPath}`);
    }
    
    const [, bucketName, filePath] = match;
    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(filePath);
    
    const [buffer] = await file.download();
    console.log(`✅ Audio chunk downloaded: ${gcsPath} (${buffer.length} bytes)`);
    
    return buffer;
  } catch (error) {
    console.error(`❌ Error downloading audio from GCS (${gcsPath}):`, error);
    throw error;
  }
}

/**
 * Delete audio chunk from GCS
 * @param {string} gcsPath - Full GCS path
 * @returns {Promise<boolean>}
 */
async function deleteAudioChunk(gcsPath) {
  try {
    const match = gcsPath.match(/^gs:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid GCS path format: ${gcsPath}`);
    }
    
    const [, bucketName, filePath] = match;
    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(filePath);
    
    await file.delete();
    console.log(`✅ Audio chunk deleted: ${gcsPath}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Error deleting audio from GCS (${gcsPath}):`, error);
    return false;
  }
}

/**
 * Delete all audio chunks for a lesson
 * @param {string} lessonId - Lesson ID
 * @returns {Promise<number>} - Number of files deleted
 */
async function deleteAllAudioForLesson(lessonId) {
  try {
    const bucket = getStorage().bucket(getBucketName());
    const prefix = `lessons/${lessonId}/`;
    
    const [files] = await bucket.getFiles({ prefix });
    
    if (files.length === 0) {
      console.log(`No audio files found for lesson ${lessonId}`);
      return 0;
    }
    
    console.log(`Deleting ${files.length} audio files for lesson ${lessonId}...`);
    
    await Promise.all(files.map(file => file.delete()));
    
    console.log(`✅ Deleted ${files.length} audio files for lesson ${lessonId}`);
    return files.length;
  } catch (error) {
    console.error(`❌ Error deleting audio for lesson ${lessonId}:`, error);
    return 0;
  }
}

/**
 * Delete expired audio chunks (older than retention period)
 * Called by cron job
 * @returns {Promise<{deleted: number, errors: number}>}
 */
async function cleanupExpiredAudio() {
  try {
    console.log('🧹 Starting cleanup of expired audio backups...');
    
    const bucket = getStorage().bucket(getBucketName());
    const [files] = await bucket.getFiles({ prefix: 'lessons/' });
    
    const now = new Date();
    let deleted = 0;
    let errors = 0;
    
    for (const file of files) {
      try {
        const [metadata] = await file.getMetadata();
        const deleteAtStr = metadata.metadata?.deleteAt;
        
        if (deleteAtStr) {
          const deleteAt = new Date(deleteAtStr);
          
          if (deleteAt < now) {
            await file.delete();
            deleted++;
            console.log(`✅ Deleted expired audio: ${file.name}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error processing file ${file.name}:`, error);
        errors++;
      }
    }
    
    console.log(`🧹 Cleanup complete: ${deleted} deleted, ${errors} errors`);
    return { deleted, errors };
  } catch (error) {
    console.error('❌ Error in cleanup job:', error);
    return { deleted: 0, errors: 1 };
  }
}

/**
 * Get storage statistics
 * @returns {Promise<{totalFiles: number, totalSizeBytes: number, oldestFile: Date, newestFile: Date}>}
 */
async function getStorageStats() {
  try {
    const bucket = getStorage().bucket(getBucketName());
    const [files] = await bucket.getFiles({ prefix: 'lessons/' });
    
    let totalSizeBytes = 0;
    let oldestFile = null;
    let newestFile = null;
    
    for (const file of files) {
      const [metadata] = await file.getMetadata();
      totalSizeBytes += parseInt(metadata.size || 0);
      
      const uploadedAt = new Date(metadata.metadata?.uploadedAt || metadata.timeCreated);
      if (!oldestFile || uploadedAt < oldestFile) oldestFile = uploadedAt;
      if (!newestFile || uploadedAt > newestFile) newestFile = uploadedAt;
    }
    
    return {
      totalFiles: files.length,
      totalSizeBytes,
      totalSizeMB: (totalSizeBytes / 1024 / 1024).toFixed(2),
      oldestFile,
      newestFile
    };
  } catch (error) {
    console.error('❌ Error getting storage stats:', error);
    return {
      totalFiles: 0,
      totalSizeBytes: 0,
      totalSizeMB: '0.00',
      oldestFile: null,
      newestFile: null
    };
  }
}

module.exports = {
  uploadAudioChunk,
  downloadAudioChunk,
  deleteAudioChunk,
  deleteAllAudioForLesson,
  cleanupExpiredAudio,
  getStorageStats,
  RETENTION_HOURS
};

