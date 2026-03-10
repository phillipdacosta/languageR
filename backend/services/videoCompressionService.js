const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { pipeline } = require('stream');

const pipelineAsync = promisify(pipeline);

class VideoCompressionService {
  constructor() {
    this.tempDir = path.join(__dirname, '../temp');
    this.ensureTempDir();
  }

  ensureTempDir() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async compressVideo(inputBuffer, options = {}) {
    const {
      maxSizeMB = 100,
      maxWidth = 1920,
      maxHeight = 1080,
      quality = 23,
      format = 'mp4'
    } = options;

    const inputPath = path.join(this.tempDir, `input_${Date.now()}.tmp`);
    const outputPath = path.join(this.tempDir, `output_${Date.now()}.${format}`);

    try {
      // Write input buffer to temporary file
      await fs.promises.writeFile(inputPath, inputBuffer);

      // Get video metadata first
      const metadata = await this.getVideoMetadata(inputPath);
      console.log('📊 Video metadata:', {
        duration: metadata.duration,
        size: metadata.size,
        width: metadata.width,
        height: metadata.height,
        bitrate: metadata.bitrate
      });

      // Calculate optimal compression settings
      const compressionSettings = this.calculateCompressionSettings(metadata, {
        maxSizeMB,
        maxWidth,
        maxHeight,
        quality
      });

      console.log('🎬 Compression settings:', compressionSettings);

      // Compress video
      await this.performCompression(inputPath, outputPath, compressionSettings);

      // Read compressed file
      const compressedBuffer = await fs.promises.readFile(outputPath);
      const compressedSizeMB = compressedBuffer.length / (1024 * 1024);

      console.log(`✅ Compression complete: ${compressedSizeMB.toFixed(2)}MB`);

      // Clean up temporary files
      await this.cleanup([inputPath, outputPath]);

      return {
        buffer: compressedBuffer,
        size: compressedBuffer.length,
        sizeMB: compressedSizeMB,
        compressionRatio: (inputBuffer.length / compressedBuffer.length).toFixed(2)
      };

    } catch (error) {
      console.error('❌ Video compression failed:', error);
      await this.cleanup([inputPath, outputPath]);
      throw new Error(`Video compression failed: ${error.message}`);
    }
  }

  async getVideoMetadata(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');

        resolve({
          duration: parseFloat(metadata.format.duration),
          size: parseInt(metadata.format.size),
          width: videoStream ? videoStream.width : 0,
          height: videoStream ? videoStream.height : 0,
          bitrate: parseInt(metadata.format.bit_rate),
          videoCodec: videoStream ? videoStream.codec_name : 'unknown',
          audioCodec: audioStream ? audioStream.codec_name : 'unknown',
          fps: videoStream ? eval(videoStream.r_frame_rate) : 0
        });
      });
    });
  }

  calculateCompressionSettings(metadata, options) {
    const { maxSizeMB, maxWidth, maxHeight, quality } = options;
    
    const targetBitrate = Math.floor((maxSizeMB * 8 * 1024) / metadata.duration); // kbps
    
    let scaleWidth = metadata.width;
    let scaleHeight = metadata.height;
    
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      const ratio = Math.min(maxWidth / metadata.width, maxHeight / metadata.height);
      scaleWidth = Math.floor(metadata.width * ratio);
      scaleHeight = Math.floor(metadata.height * ratio);
      
      scaleWidth = scaleWidth % 2 === 0 ? scaleWidth : scaleWidth - 1;
      scaleHeight = scaleHeight % 2 === 0 ? scaleHeight : scaleHeight - 1;
    }

    let crf = quality;
    if (metadata.size > maxSizeMB * 1024 * 1024) {
      crf = Math.min(quality + 3, 28);
    }

    return {
      scale: `${scaleWidth}x${scaleHeight}`,
      crf: crf,
      videoBitrate: Math.min(targetBitrate * 0.85, 5000),
      audioBitrate: Math.min(targetBitrate * 0.15, 192),
      preset: metadata.size > maxSizeMB * 1024 * 1024 ? 'slow' : 'medium'
    };
  }

  async performCompression(inputPath, outputPath, settings) {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .size(settings.scale)
        .videoBitrate(settings.videoBitrate)
        .audioBitrate(settings.audioBitrate)
        .addOption('-preset', settings.preset)
        .addOption('-crf', settings.crf)
        .addOption('-movflags', '+faststart') // Optimize for streaming
        .addOption('-profile:v', 'high')
        .addOption('-level', '4.0')
        .addOption('-pix_fmt', 'yuv420p') // Ensure compatibility
        .on('start', (commandLine) => {
          console.log('🎬 FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`📊 Compression progress: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Compression completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg error:', err);
          reject(err);
        });

      command.save(outputPath);
    });
  }

  async cleanup(filePaths) {
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to delete temp file ${filePath}:`, error.message);
      }
    }
  }

  // Stream-based compression for very large files
  async compressVideoStream(inputStream, options = {}) {
    const {
      maxSizeMB = 100,
      maxWidth = 1920,
      maxHeight = 1080,
      quality = 23
    } = options;

    const inputPath = path.join(this.tempDir, `stream_input_${Date.now()}.tmp`);
    const outputPath = path.join(this.tempDir, `stream_output_${Date.now()}.mp4`);

    try {
      // Write stream to temporary file
      await pipelineAsync(inputStream, fs.createWriteStream(inputPath));

      // Compress the file
      const result = await this.compressVideo(
        await fs.promises.readFile(inputPath),
        { maxSizeMB, maxWidth, maxHeight, quality }
      );

      // Clean up
      await this.cleanup([inputPath, outputPath]);

      return result;

    } catch (error) {
      await this.cleanup([inputPath, outputPath]);
      throw error;
    }
  }

  // Get compression progress (for real-time updates)
  getCompressionProgress() {
    return this.currentProgress || 0;
  }
}

module.exports = new VideoCompressionService();
