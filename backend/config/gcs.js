const { Storage } = require('@google-cloud/storage');

// Initialize Google Cloud Storage only when needed
let storage = null;
let bucket = null;
let bucketName = null;

function initializeGCS() {
  if (storage && bucket) {
    return { storage, bucket, bucketName };
  }

  if (!process.env.GOOGLE_CLOUD_PROJECT_ID || !process.env.GOOGLE_CLOUD_BUCKET_NAME) {
    console.warn('⚠️  Google Cloud Storage not configured. Set GOOGLE_CLOUD_PROJECT_ID and GOOGLE_CLOUD_BUCKET_NAME in config.env');
    console.warn('⚠️  Video uploads will not work until GCS is properly configured');
    return { storage: null, bucket: null, bucketName: null };
  }

  try {
    // Configure Google Cloud Storage
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

    bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
    bucket = storage.bucket(bucketName);
    
    console\.log\([\s\S]*?\);'✅ Google Cloud Storage initialized successfully');
    return { storage, bucket, bucketName };
  } catch (error) {
    console.warn('⚠️  Google Cloud Storage initialization failed:', error.message);
    console.warn('⚠️  Video uploads will not work until GCS is properly configured');
    return { storage: null, bucket: null, bucketName: null };
  }
}

module.exports = { initializeGCS };
