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
    storage = new Storage({
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE, // Path to service account key
    });

    bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
    bucket = storage.bucket(bucketName);
    
    console.log('✅ Google Cloud Storage initialized successfully');
    return { storage, bucket, bucketName };
  } catch (error) {
    console.warn('⚠️  Google Cloud Storage initialization failed:', error.message);
    console.warn('⚠️  Video uploads will not work until GCS is properly configured');
    return { storage: null, bucket: null, bucketName: null };
  }
}

module.exports = { initializeGCS };
