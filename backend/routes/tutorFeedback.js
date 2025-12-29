const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const TutorFeedback = require('../models/TutorFeedback');
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const Notification = require('../models/Notification');

/**
 * @route   GET /api/tutor-feedback/pending
 * @desc    Get all pending feedback requests for a tutor
 * @access  Private (Tutors only)
 */
router.get('/pending', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can access feedback requests' });
    }
    
    // Find pending feedback
    const pendingFeedback = await TutorFeedback.find({
      tutorId: user._id, // Use MongoDB ObjectId, not auth0Id
      status: 'pending'
    })
    .sort({ createdAt: -1 })
    .lean();
    
    // Populate with lesson and student details
    const feedbackWithDetails = await Promise.all(
      pendingFeedback.map(async (feedback) => {
        const lesson = await Lesson.findById(feedback.lessonId)
          .select('startTime endTime subject duration')
          .lean();
        const student = await User.findById(feedback.studentId) // Use _id, not auth0Id
          .select('name firstName lastName picture')
          .lean();
        
        // Format student name
        let studentName = 'Unknown Student';
        if (student) {
          if (student.firstName && student.lastName) {
            studentName = `${student.firstName} ${student.lastName.charAt(0)}.`;
          } else if (student.name) {
            const parts = student.name.split(' ');
            if (parts.length >= 2) {
              studentName = `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
            } else {
              studentName = student.name;
            }
          }
        }
        
        return {
          ...feedback,
          lesson,
          studentName,
          studentPicture: student?.picture
        };
      })
    );
    
    res.json({
      success: true,
      pendingFeedback: feedbackWithDetails,
      count: feedbackWithDetails.length
    });
  } catch (error) {
    console.error('❌ Error fetching pending feedback:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   POST /api/tutor-feedback/:feedbackId/submit
 * @desc    Submit tutor feedback for a lesson
 * @access  Private (Tutors only)
 */
router.post('/:feedbackId/submit', verifyToken, async (req, res) => {
  try {
    const { feedbackId } = req.params;
    const { strengths, areasForImprovement, homework, overallNotes } = req.body;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can submit feedback' });
    }
    
    // Find feedback
    const feedback = await TutorFeedback.findById(feedbackId);
    if (!feedback) {
      return res.status(404).json({ success: false, message: 'Feedback request not found' });
    }
    
    // Verify tutor owns this feedback
    if (feedback.tutorId !== user.auth0Id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    // Validate required fields
    if (!strengths || strengths.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one strength is required' });
    }
    
    if (!areasForImprovement || areasForImprovement.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one area for improvement is required' });
    }
    
    // Update feedback
    feedback.strengths = strengths;
    feedback.areasForImprovement = areasForImprovement;
    feedback.homework = homework || '';
    feedback.overallNotes = overallNotes || '';
    feedback.status = 'completed';
    feedback.providedAt = new Date();
    await feedback.save();
    
    // Update lesson
    await Lesson.findByIdAndUpdate(feedback.lessonId, {
      requiresTutorFeedback: false
    });
    
    // Notify student
    const student = await User.findOne({ auth0Id: feedback.studentId });
    if (student) {
      await Notification.create({
        userId: student._id,
        type: 'feedback_received',
        title: 'Feedback Available! 📝',
        message: `Your tutor has provided feedback on your recent lesson. Check it out!`,
        data: {
          lessonId: feedback.lessonId,
          tutorAuth0Id: user.auth0Id
        }
      });
      
      // Emit WebSocket event
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${feedback.studentId}`).emit('feedback_received', {
          lessonId: feedback.lessonId,
          tutorName: user.name
        });
      }
    }
    
    console.log(`✅ Tutor feedback submitted for lesson ${feedback.lessonId}`);
    
    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      feedback
    });
  } catch (error) {
    console.error('❌ Error submitting feedback:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @route   GET /api/tutor-feedback/lesson/:lessonId
 * @desc    Get feedback for a specific lesson
 * @access  Private
 */
router.get('/lesson/:lessonId', verifyToken, async (req, res) => {
  try {
    const { lessonId } = req.params;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Find feedback
    const feedback = await TutorFeedback.findOne({ lessonId }).lean();
    
    if (!feedback) {
      return res.status(404).json({ 
        success: false, 
        message: 'No feedback found for this lesson',
        hasFeedback: false
      });
    }
    
    // Verify user is student or tutor of this lesson
    if (feedback.studentId !== user.auth0Id && feedback.tutorId !== user.auth0Id) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    
    res.json({
      success: true,
      feedback,
      hasFeedback: true
    });
  } catch (error) {
    console.error('❌ Error fetching feedback:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

