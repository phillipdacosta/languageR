const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/videoUploadMiddleware');
const ReviewDeckItem = require('../models/ReviewDeckItem');
const User = require('../models/User');

/**
 * @route   POST /api/review-deck
 * @desc    Save a correction to the review deck
 * @access  Private
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    // Get user from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const { original, corrected, explanation, context, language, errorType, lessonId, analysisId } = req.body;
    
    // Check if this exact correction already exists for this user
    const existingItem = await ReviewDeckItem.findOne({
      userId: user._id,
      original: original.trim(),
      corrected: corrected.trim()
    });
    
    if (existingItem) {
      return res.status(200).json({
        message: 'Item already in review deck',
        item: existingItem
      });
    }
    
    // Create new review deck item
    const reviewItem = new ReviewDeckItem({
      userId: user._id,
      original: original.trim(),
      corrected: corrected.trim(),
      explanation: explanation || '',
      context: context || '',
      language: language || 'Spanish',
      errorType: errorType || 'other',
      lessonId,
      analysisId
    });
    
    await reviewItem.save();
    
    res.status(201).json({
      message: 'Added to review deck',
      item: reviewItem
    });
    
  } catch (error) {
    console.error('Error saving to review deck:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/review-deck
 * @desc    Get all review deck items for the user
 * @access  Private
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    // Get user from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const { mastered, language, errorType, limit, skip } = req.query;
    
    // Build query
    const query = { userId: user._id };
    
    if (mastered !== undefined) {
      query.mastered = mastered === 'true';
    }
    
    if (language) {
      query.language = language;
    }
    
    if (errorType) {
      query.errorType = errorType;
    }
    
    // Get items with pagination
    const items = await ReviewDeckItem.find(query)
      .sort({ savedAt: -1 })
      .limit(parseInt(limit) || 100)
      .skip(parseInt(skip) || 0);
    
    const total = await ReviewDeckItem.countDocuments(query);
    
    res.json({
      items,
      total,
      hasMore: (parseInt(skip) || 0) + items.length < total
    });
    
  } catch (error) {
    console.error('Error fetching review deck:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/review-deck/needs-review
 * @desc    Get items that need review (spaced repetition)
 * @access  Private
 */
router.get('/needs-review', verifyToken, async (req, res) => {
  try {
    // Get user from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const { limit } = req.query;
    
    const items = await ReviewDeckItem.getItemsNeedingReview(
      user._id,
      parseInt(limit) || 10
    );
    
    res.json({ items });
    
  } catch (error) {
    console.error('Error fetching items needing review:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   GET /api/review-deck/stats
 * @desc    Get review deck statistics
 * @access  Private
 */
router.get('/stats', verifyToken, async (req, res) => {
  try {
    // Get user from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userId = user._id;
    
    const [total, mastered, needsReview, byErrorType] = await Promise.all([
      ReviewDeckItem.countDocuments({ userId }),
      ReviewDeckItem.countDocuments({ userId, mastered: true }),
      ReviewDeckItem.countDocuments({
        userId,
        mastered: false,
        $or: [
          { lastReviewedAt: { $exists: false } },
          { 
            lastReviewedAt: { 
              $lt: new Date(Date.now() - 24 * 60 * 60 * 1000)
            }
          }
        ]
      }),
      ReviewDeckItem.aggregate([
        { $match: { userId } },
        { $group: { _id: '$errorType', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ])
    ]);
    
    res.json({
      total,
      mastered,
      notMastered: total - mastered,
      needsReview,
      byErrorType: byErrorType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    });
    
  } catch (error) {
    console.error('Error fetching review deck stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/review-deck/:id/review
 * @desc    Mark an item as reviewed
 * @access  Private
 */
router.put('/:id/review', verifyToken, async (req, res) => {
  try {
    // Get user from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const item = await ReviewDeckItem.findOne({
      _id: req.params.id,
      userId: user._id
    });
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    
    await item.markReviewed();
    
    res.json({
      message: 'Marked as reviewed',
      item
    });
    
  } catch (error) {
    console.error('Error marking item as reviewed:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   PUT /api/review-deck/:id/mastered
 * @desc    Toggle mastered status
 * @access  Private
 */
router.put('/:id/mastered', verifyToken, async (req, res) => {
  try {
    // Get user from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const item = await ReviewDeckItem.findOne({
      _id: req.params.id,
      userId: user._id
    });
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    
    await item.toggleMastered();
    
    res.json({
      message: item.mastered ? 'Marked as mastered' : 'Marked as not mastered',
      item
    });
    
  } catch (error) {
    console.error('Error toggling mastered status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   DELETE /api/review-deck/:id
 * @desc    Delete an item from review deck
 * @access  Private
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    // Get user from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const item = await ReviewDeckItem.findOneAndDelete({
      _id: req.params.id,
      userId: user._id
    });
    
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }
    
    res.json({ message: 'Item removed from review deck' });
    
  } catch (error) {
    console.error('Error deleting review deck item:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * @route   POST /api/review-deck/batch
 * @desc    Save multiple corrections at once
 * @access  Private
 */
router.post('/batch', verifyToken, async (req, res) => {
  try {
    // Get user from auth token
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const { items } = req.body;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items array is required' });
    }
    
    // Prepare items for insertion
    const reviewItems = items.map(item => ({
      userId: user._id,
      original: item.original.trim(),
      corrected: item.corrected.trim(),
      explanation: item.explanation || '',
      context: item.context || '',
      language: item.language || 'Spanish',
      errorType: item.errorType || 'other',
      lessonId: item.lessonId,
      analysisId: item.analysisId
    }));
    
    // Insert, ignoring duplicates
    const result = await ReviewDeckItem.insertMany(reviewItems, { ordered: false })
      .catch(error => {
        // Ignore duplicate key errors
        if (error.code === 11000) {
          return { insertedCount: error.result.nInserted };
        }
        throw error;
      });
    
    res.status(201).json({
      message: `Added ${result.insertedCount || result.length} items to review deck`,
      count: result.insertedCount || result.length
    });
    
  } catch (error) {
    console.error('Error batch saving to review deck:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;



