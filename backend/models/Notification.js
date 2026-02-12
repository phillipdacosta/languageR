const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      'lesson_created', 
      'message', 
      'lesson_reminder', 
      'lesson_cancelled', 
      'potential_student', 
      'class_invitation', 
      'class_accepted',
      'class_removed',
      'invitation_cancelled',
      'lesson_rescheduled',
      'reschedule_proposed',
      'reschedule_accepted',
      'reschedule_rejected',
      'office_hours_booking',
      'office_hours_starting',
      'lesson_analysis_ready',
      'class_auto_cancelled',
      'class_invitation_cancelled',
      'tutor_video_approved',
      'tutor_video_rejected',
      'payment_received',
      'lesson_refunded',
      'lesson_partial_refund',
      'payment_cancelled',
      'payment_reduced',
      'investigation_resolved',
      'dispute_submitted',
      'feedback_required',
      'tip_sent',
      'tip_received',
      'withdrawal_initiated',
      'lesson_completed',
      'feedback_reminder',
      'feedback_received',
      'progress_milestone',
      'credential_approved',
      'credential_rejected',
      'tutor_note_saved'
    ],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  relatedUserPicture: {
    type: String,
    default: null
  },
  relatedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient queries
NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);

