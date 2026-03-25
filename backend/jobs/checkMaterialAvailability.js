const TutorMaterial = require('../models/TutorMaterial');
const MaterialPurchase = require('../models/MaterialPurchase');
const MaterialReport = require('../models/MaterialReport');
const User = require('../models/User');

const REFUND_WINDOW_DAYS = 90;

/**
 * Check if a YouTube video is available via oEmbed (no API key needed).
 * Returns true if the video is accessible, false otherwise.
 */
async function isYouTubeVideoAvailable(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if a Vimeo video is available via oEmbed (no API key needed).
 */
async function isVimeoVideoAvailable(vimeoId) {
  try {
    const url = `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoId}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Extract video ID from the stored videoUrl.
 */
function parseVideoId(videoUrl, provider) {
  if (!videoUrl) return null;

  if (provider === 'youtube') {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
    ];
    for (const pat of patterns) {
      const m = videoUrl.match(pat);
      if (m) return m[1];
    }
  }

  if (provider === 'vimeo') {
    const m = videoUrl.match(/vimeo\.com\/(\d+)/);
    if (m) return m[1];
  }

  return null;
}

/**
 * Main job: scan published/archived video_quiz materials and check availability.
 *
 * When a video is detected as unavailable:
 *  1. Flag the material with `mediaUnavailable: true` and `mediaUnavailableSince`
 *  2. Auto-create MaterialReports for students who purchased but haven't completed the quiz
 *     and whose purchase is within the refund window
 *  3. Auto-refund those eligible purchases using reverse_transfer
 *
 * When a previously-unavailable video comes back online:
 *  - Clear the unavailability flag so the material resumes normal operation
 */
async function checkMaterialAvailability() {
  console.log('🔍 [MaterialCheck] Starting video availability scan...');

  const materials = await TutorMaterial.find({
    materialType: 'video_quiz',
    pricingType: 'paid',
    status: { $in: ['published', 'archived'] },
    videoUrl: { $exists: true, $ne: null }
  }).lean();

  if (materials.length === 0) {
    console.log('🔍 [MaterialCheck] No video materials to check.');
    return;
  }

  console.log(`🔍 [MaterialCheck] Checking ${materials.length} video materials...`);

  let unavailableCount = 0;
  let recoveredCount = 0;
  let autoRefundCount = 0;

  for (const material of materials) {
    const videoId = parseVideoId(material.videoUrl, material.videoProvider);
    if (!videoId) continue;

    let isAvailable;
    if (material.videoProvider === 'youtube') {
      isAvailable = await isYouTubeVideoAvailable(videoId);
    } else if (material.videoProvider === 'vimeo') {
      isAvailable = await isVimeoVideoAvailable(videoId);
    } else {
      continue;
    }

    const wasUnavailable = material.mediaUnavailable === true;

    if (!isAvailable && !wasUnavailable) {
      unavailableCount++;
      console.log(`⚠️ [MaterialCheck] Video unavailable: "${material.title}" (${material._id})`);

      await TutorMaterial.findByIdAndUpdate(material._id, {
        $set: {
          mediaUnavailable: true,
          mediaUnavailableSince: new Date()
        }
      });

      const refundCutoff = new Date();
      refundCutoff.setDate(refundCutoff.getDate() - REFUND_WINDOW_DAYS);

      const eligiblePurchases = await MaterialPurchase.find({
        materialId: material._id,
        status: 'completed',
        createdAt: { $gte: refundCutoff }
      });

      for (const purchase of eligiblePurchases) {
        const existingReport = await MaterialReport.findOne({
          materialId: material._id,
          studentId: purchase.studentId,
          status: { $in: ['open', 'under_review'] }
        });

        if (!existingReport) {
          await MaterialReport.create({
            materialId: material._id,
            studentId: purchase.studentId,
            tutorId: material.tutorId,
            reason: 'video_unavailable',
            details: 'Auto-detected: video removed from hosting platform.',
            purchaseId: purchase._id,
            hasPurchased: true,
            hasCompletedQuiz: false
          });
        }

        try {
          const stripeService = require('../services/stripeService');
          await stripeService.createRefund({
            paymentIntentId: purchase.stripePaymentIntentId,
            reason: 'requested_by_customer',
            reverseTransfer: true
          });

          purchase.status = 'refunded';
          purchase.refundedAt = new Date();
          purchase.refundReason = 'Auto-refund: video removed by tutor';
          await purchase.save();

          const Payment = require('../models/Payment');
          await Payment.findOneAndUpdate(
            { materialId: material._id, studentId: purchase.studentId, paymentType: 'material_purchase' },
            { status: 'refunded' }
          );

          autoRefundCount++;
          console.log(`💸 [MaterialCheck] Auto-refunded purchase ${purchase._id} for student ${purchase.studentId}`);
        } catch (refundErr) {
          console.error(`❌ [MaterialCheck] Refund failed for purchase ${purchase._id}:`, refundErr.message);
        }
      }
    } else if (isAvailable && wasUnavailable) {
      recoveredCount++;
      console.log(`✅ [MaterialCheck] Video recovered: "${material.title}" (${material._id})`);

      await TutorMaterial.findByIdAndUpdate(material._id, {
        $unset: { mediaUnavailable: 1, mediaUnavailableSince: 1 }
      });
    }
  }

  console.log(`🔍 [MaterialCheck] Scan complete. Unavailable: ${unavailableCount}, Recovered: ${recoveredCount}, Auto-refunds: ${autoRefundCount}`);
}

module.exports = { checkMaterialAvailability, isYouTubeVideoAvailable, isVimeoVideoAvailable, parseVideoId, REFUND_WINDOW_DAYS };
