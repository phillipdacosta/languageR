const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { upload, uploadImage, uploadVideoWithCompression, uploadImageToGCS, verifyToken } = require('../middleware/videoUploadMiddleware');


// GET /api/users/debug - Debug what we're receiving
router.get('/debug', verifyToken, async (req, res) => {
  console.log('🔍 DEBUG: Full request user:', JSON.stringify(req.user, null, 2));
  console.log('🔍 DEBUG: User sub:', req.user.sub);
  console.log('🔍 DEBUG: User email:', req.user.email);
  
  res.json({
    success: true,
    receivedUser: req.user,
    message: 'Debug info'
  });
});

// GET /api/users/me - Get current user
router.get('/me', verifyToken, async (req, res) => {
  console.log('🔍 Getting current user:', req.user);
  try {
    // Try to find user by auth0Id first, then by email as fallback
    let user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user && req.user.email) {
      console.log('🔍 User not found by auth0Id, trying email:', req.user.email);
      user = await User.findOne({ email: req.user.email });
      
      // If found by email, update the auth0Id to match the current token
      if (user) {
        console.log('🔍 Found user by email, updating auth0Id from', user.auth0Id, 'to', req.user.sub);
        user.auth0Id = req.user.sub;
        await user.save();
      }
    }
    
    if (!user) {
      console.log('🔍 User not found by auth0Id or email');
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Sync picture from Auth0 if it's different (handles Google profile picture updates)
    const auth0Picture = req.user.picture || req.user.picture_url || null;
    console.log('🖼️ Checking picture sync:', {
      auth0Picture,
      dbPicture: user.picture,
      hasAuth0Picture: !!auth0Picture,
      hasDbPicture: !!user.picture,
      areDifferent: auth0Picture !== user.picture
    });
    
    if (auth0Picture && auth0Picture !== user.picture) {
      console.log('🖼️ Picture changed in Auth0, updating database:', {
        old: user.picture,
        new: auth0Picture
      });
      user.picture = auth0Picture;
      await user.save();
      console.log('✅ Picture updated in database');
    } else if (auth0Picture && !user.picture) {
      // If Auth0 has a picture but database doesn't, sync it
      console.log('🖼️ Auth0 has picture but database doesn\'t, syncing...');
      user.picture = auth0Picture;
      await user.save();
      console.log('✅ Picture synced to database');
    }
    
    // Also sync name and emailVerified if they changed
    if (req.user.name && req.user.name !== user.name) {
      console.log('📝 Name changed in Auth0, updating database');
      user.name = req.user.name;
      await user.save();
    }
    
    if (req.user.email_verified !== undefined && req.user.email_verified !== user.emailVerified) {
      console.log('✅ Email verification status changed in Auth0, updating database');
      user.emailVerified = req.user.email_verified;
      await user.save();
    }
    
    res.json({
      success: true,
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        emailVerified: user.emailVerified,
        userType: user.userType,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        stats: user.stats,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users - Create or update user
router.post('/', verifyToken, async (req, res) => {
  try {
    const { email, name, picture, emailVerified, userType } = req.body;
    
    console.log('🔍 Creating/updating user with data:', { email, name, userType });
    console.log('🔍 Full request body:', req.body);
    
    // Check if user already exists by auth0Id first, then by email
    let user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user && req.user.email) {
      console.log('🔍 User not found by auth0Id, trying email for update:', req.user.email);
      user = await User.findOne({ email: req.user.email });
      
      // If found by email, update the auth0Id to match the current token
      if (user) {
        console.log('🔍 Found existing user by email, updating auth0Id from', user.auth0Id, 'to', req.user.sub);
        user.auth0Id = req.user.sub;
      }
    }
    
    if (user) {
      // Update existing user
      console.log('🔍 Updating existing user. Current userType:', user.userType, 'New userType:', userType);
      user.email = email || user.email;
      user.name = name || user.name;
      
      // Sync picture from Auth0 if available, otherwise use provided picture, otherwise keep existing
      const auth0Picture = req.user.picture || req.user.picture_url || null;
      user.picture = picture || auth0Picture || user.picture;
      
      user.emailVerified = emailVerified !== undefined ? emailVerified : user.emailVerified;
      user.userType = userType || user.userType; // Update user type
      user.updatedAt = new Date();
      
      console.log('🔍 User after update. userType:', user.userType);
      await user.save();
    } else {
      // Create new user
      console.log('🔍 Creating new user with userType:', userType);
      console.log('🔍 Request user data:', req.user);
      console.log('🔍 Request body data:', req.body);
      
      try {
        // Get picture from Auth0 if available
        const auth0Picture = req.user.picture || req.user.picture_url || picture || null;
        
        user = new User({
          auth0Id: req.user.sub,
          email: email || req.user.email,
          name: name || req.user.name,
          picture: auth0Picture,
          emailVerified: emailVerified !== undefined ? emailVerified : (req.user.email_verified || false),
          userType: userType || 'student', // Default to student
          onboardingCompleted: false
        });
        
        console.log('🔍 New user object created:', user);
        console.log('🔍 New user userType:', user.userType);
        
        await user.save();
        console.log('🔍 User saved successfully');
      } catch (saveError) {
        console.error('🔍 Error saving user:', saveError);
        throw saveError;
      }
    }
    
    res.json({
      success: true,
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        emailVerified: user.emailVerified,
        userType: user.userType,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        stats: user.stats,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('🔍 Error in POST /api/users:', error);
    console.error('🔍 Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/onboarding - Complete onboarding
router.put('/onboarding', verifyToken, async (req, res) => {
  try {
    console.log('🔍 PUT /api/users/onboarding called');
    console.log('🔍 Request body:', req.body);
    console.log('🔍 Request user:', req.user);
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      console.log('🔍 User not found in database');
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('🔍 User found:', user.email, 'userType:', user.userType);
    
    // Update onboarding data based on user type
    user.onboardingCompleted = true;
    
    if (user.userType === 'tutor') {
      // Handle tutor onboarding data
      const { languages, experience, schedule, bio, hourlyRate } = req.body;
      user.onboardingData = {
        languages: languages || [],
        experience: experience || '',
        schedule: schedule || '',
        bio: bio || '',
        hourlyRate: hourlyRate || 25,
        completedAt: new Date()
      };
    } else {
      // Handle student onboarding data
      const { languages, goals, experienceLevel, preferredSchedule } = req.body;
      user.onboardingData = {
        languages: languages || [],
        goals: goals || [],
        experienceLevel: experienceLevel || 'Beginner',
        preferredSchedule: preferredSchedule || '',
        completedAt: new Date()
      };
    }
    
    await user.save();
    
    res.json({
      success: true,
      message: 'Onboarding completed successfully',
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        emailVerified: user.emailVerified,
        userType: user.userType,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        stats: user.stats,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/profile - Update user profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { bio, timezone, preferredLanguage, userType, picture } = req.body;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update profile data
    user.profile = {
      bio: bio || user.profile.bio,
      timezone: timezone || user.profile.timezone,
      preferredLanguage: preferredLanguage || user.profile.preferredLanguage
    };
    
    // Update userType if provided
    if (userType) {
      user.userType = userType;
    }
    
    // Update picture if provided (for in-app uploads)
    if (picture !== undefined) {
      user.picture = picture;
    }
    
    await user.save();
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        emailVerified: user.emailVerified,
        userType: user.userType,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        stats: user.stats,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/check-email - Check if user exists by email (no auth required)
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    console.log('Checking if user exists with email:', email);
    
    const user = await User.findOne({ email });
    const exists = !!user;
    
    console.log('User exists:', exists);
    
    res.json({
      success: true,
      exists: exists,
      email: email
    });
  } catch (error) {
    console.error('Error checking user by email:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/by-email - Get user by email (no auth required)
router.post('/by-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    console.log('Getting user by email:', email);
    
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('User found:', user.email);
    
    res.json({
      success: true,
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        emailVerified: user.emailVerified,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        stats: user.stats,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Error getting user by email:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/tutors - Search tutors with filters
router.get('/tutors', verifyToken, async (req, res) => {
  try {
    console.log('🔍 Searching tutors with filters:', req.query);
    
    const {
      language,
      priceMin,
      priceMax,
      country,
      availability,
      specialties,
      gender,
      nativeSpeaker,
      sortBy = 'rating',
      page = 1,
      limit = 20
    } = req.query;

    // Build filter query
    const filterQuery = {
      userType: 'tutor',
      onboardingCompleted: true
    };

    // Language filter
    if (language && language !== 'any') {
      filterQuery['onboardingData.languages'] = { $in: [language] };
    }

    // Price range filter
    if (priceMin !== undefined && priceMax !== undefined && priceMin !== 'any' && priceMax !== 'any') {
      filterQuery['onboardingData.hourlyRate'] = {
        $gte: parseInt(priceMin),
        $lte: parseInt(priceMax),
        $ne: null
      };
    }

    // Country filter (if you have country data)
    if (country && country !== 'any') {
      // Assuming you have a country field in the user profile
      filterQuery['profile.country'] = country;
    }

    // Availability filter
    if (availability && availability !== 'anytime') {
      filterQuery['onboardingData.schedule'] = { $regex: availability, $options: 'i' };
    }

    // Specialties filter
    if (specialties && specialties.length > 0) {
      const specialtiesArray = Array.isArray(specialties) ? specialties : [specialties];
      filterQuery['onboardingData.experience'] = { $in: specialtiesArray };
    }

    // Gender filter (if you have gender data)
    if (gender && gender !== 'any') {
      filterQuery['profile.gender'] = gender;
    }

    // Native speaker filter
    if (nativeSpeaker === 'true') {
      // Assuming you have a nativeSpeaker field
      filterQuery['profile.nativeSpeaker'] = true;
    }

    console.log('🔍 Filter query:', JSON.stringify(filterQuery, null, 2));

    // Build sort query
    let sortQuery = {};
    switch (sortBy) {
      case 'price':
        sortQuery = { 'onboardingData.hourlyRate': 1 };
        break;
      case 'price-desc':
        sortQuery = { 'onboardingData.hourlyRate': -1 };
        break;
      case 'rating':
        sortQuery = { 'stats.rating': -1 };
        break;
      case 'experience':
        sortQuery = { 'onboardingData.experience': -1 };
        break;
      default:
        sortQuery = { createdAt: -1 };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const tutors = await User.find(filterQuery)
      .sort(sortQuery)
      .skip(skip)
      .limit(parseInt(limit))
      .select('name email picture auth0Id onboardingData profile stats createdAt');

    // Get total count for pagination
    const totalCount = await User.countDocuments(filterQuery);

    // Format response
    const formattedTutors = tutors.map(tutor => ({
      id: tutor._id,
      auth0Id: tutor.auth0Id,
      name: tutor.name,
      email: tutor.email,
      picture: tutor.picture,
      languages: tutor.onboardingData?.languages || [],
      hourlyRate: tutor.onboardingData?.hourlyRate || 25,
      experience: tutor.onboardingData?.experience || 'Beginner',
      schedule: tutor.onboardingData?.schedule || 'Flexible',
      bio: tutor.onboardingData?.bio || '',
      introductionVideo: tutor.onboardingData?.introductionVideo || '',
      country: tutor.profile?.country || 'Unknown',
      gender: tutor.profile?.gender || 'Not specified',
      nativeSpeaker: tutor.profile?.nativeSpeaker || false,
      rating: tutor.stats?.rating || 0,
      totalLessons: tutor.stats?.totalLessons || 0,
      totalHours: tutor.stats?.totalHours || 0,
      joinedDate: tutor.createdAt
    }));

    res.json({
      success: true,
      tutors: formattedTutors,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount: totalCount,
        hasNext: skip + tutors.length < totalCount,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error('Error searching tutors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/tutor-video - Update tutor introduction video
router.put('/tutor-video', verifyToken, async (req, res) => {
  try {
    const { introductionVideo } = req.body;
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is a tutor
    if (user.userType !== 'tutor') {
      return res.status(403).json({ error: 'Only tutors can update introduction videos' });
    }
    
    // Update introduction video
    if (user.onboardingData) {
      user.onboardingData.introductionVideo = introductionVideo || '';
    } else {
      user.onboardingData = {
        introductionVideo: introductionVideo || ''
      };
    }
    
    await user.save();
    
    res.json({
      success: true,
      message: 'Introduction video updated successfully',
      introductionVideo: user.onboardingData.introductionVideo
    });

  } catch (error) {
    console.error('Error updating tutor video:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/tutor-video-upload - Upload video file with compression
router.post('/tutor-video-upload', verifyToken, upload.single('video'), uploadVideoWithCompression);

// POST /api/users/profile-picture-upload - Upload profile picture
router.post('/profile-picture-upload', verifyToken, uploadImage.single('image'), uploadImageToGCS);

// PUT /api/users/availability - Update tutor availability
router.put('/availability', verifyToken, async (req, res) => {
  try {
    const { availabilityBlocks } = req.body;
    
    if (!availabilityBlocks || !Array.isArray(availabilityBlocks)) {
      return res.status(400).json({ error: 'Availability blocks are required' });
    }

    // Find user by auth0Id
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ message: 'Only tutors can set availability' });
    }

    // Update availability in user document
    user.availability = availabilityBlocks;
    await user.save();

    res.json({ 
      success: true, 
      message: 'Availability updated successfully',
      availability: user.availability 
    });

  } catch (error) {
    console.error('Error updating availability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:userId/availability - Get tutor availability by tutor ID (public)
// NOTE: This route MUST come before /availability to avoid route conflicts
router.get('/:userId/availability', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('📅 Fetching availability for tutor ID:', userId);
    
    // Validate MongoDB ObjectId format
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      console.log('📅 Invalid tutor ID format:', userId);
      return res.status(400).json({ message: 'Invalid tutor ID format' });
    }
    
    const tutor = await User.findOne({ _id: userId, userType: 'tutor' });
    
    if (!tutor) {
      console.log('📅 Tutor not found:', userId);
      return res.status(404).json({ message: 'Tutor not found' });
    }

    console.log('📅 Tutor found:', tutor.name, 'Availability blocks:', tutor.availability?.length || 0);
    console.log('📅 Availability data:', JSON.stringify(tutor.availability, null, 2));

    res.json({ 
      success: true, 
      availability: tutor.availability || [],
      timezone: tutor.profile?.timezone || 'America/New_York'
    });

  } catch (error) {
    console.error('Error fetching tutor availability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:userId/public - Public user profile summary (tutor or student)
router.get('/:userId/public', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Support both MongoDB ObjectId and auth0Id
    let user;
    if (/^[0-9a-fA-F]{24}$/.test(userId)) {
      // MongoDB ObjectId
      user = await User.findById(userId);
    } else {
      // Try auth0Id
      user = await User.findOne({ auth0Id: userId });
    }
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.userType === 'tutor') {
      res.json({
        success: true,
        tutor: {
          id: user._id,
          auth0Id: user.auth0Id,
          name: user.name,
          email: user.email,
          picture: user.picture,
          languages: user.onboardingData?.languages || [],
          hourlyRate: user.onboardingData?.hourlyRate || 25,
          experience: user.onboardingData?.experience || '',
          schedule: user.onboardingData?.schedule || '',
          bio: user.onboardingData?.bio || '',
          introductionVideo: user.onboardingData?.introductionVideo || '',
          stats: user.stats || {},
          profile: user.profile || {}
        }
      });
    } else {
      // Student profile
      res.json({
        success: true,
        student: {
          id: user._id,
          auth0Id: user.auth0Id,
          name: user.name,
          email: user.email,
          picture: user.picture,
          languagesLearning: user.onboardingData?.languages || [],
          bio: user.onboardingData?.bio || user.profile?.bio || '',
          experienceLevel: user.onboardingData?.experienceLevel || 'Beginner',
          stats: user.stats || {},
          profile: user.profile || {}
        }
      });
    }
  } catch (error) {
    console.error('Error fetching user public profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/availability - Get tutor availability (current user)
router.get('/availability', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.userType !== 'tutor') {
      return res.status(403).json({ message: 'Only tutors can view availability' });
    }

    res.json({ 
      success: true, 
      availability: user.availability || [] 
    });

  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/picture - Update user profile picture
router.put('/picture', verifyToken, async (req, res) => {
  try {
    const { picture } = req.body;
    
    if (!picture) {
      return res.status(400).json({ error: 'Picture URL is required' });
    }
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update picture
    console.log('🖼️ Updating user profile picture:', {
      userId: user._id,
      oldPicture: user.picture,
      newPicture: picture
    });
    user.picture = picture;
    await user.save();
    
    console.log('✅ Profile picture updated successfully');
    
    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        emailVerified: user.emailVerified,
        userType: user.userType,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        stats: user.stats,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating profile picture:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;