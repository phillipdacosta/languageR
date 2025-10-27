const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { upload, uploadVideoWithCompression, verifyToken } = require('../middleware/videoUploadMiddleware');


// GET /api/users/me - Get current user
router.get('/me', verifyToken, async (req, res) => {
  console.log('🔍 Getting current user:', req.user);
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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
    
    // Check if user already exists
    let user = await User.findOne({ auth0Id: req.user.sub });
    
    if (user) {
      // Update existing user
      console.log('🔍 Updating existing user. Current userType:', user.userType, 'New userType:', userType);
      user.email = email || user.email;
      user.name = name || user.name;
      user.picture = picture || user.picture;
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
        user = new User({
          auth0Id: req.user.sub,
          email: email || req.user.email,
          name: name || req.user.name,
          picture: picture || null,
          emailVerified: emailVerified || false,
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
    const { bio, timezone, preferredLanguage } = req.body;
    
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

    // Price range filter - temporarily disabled
    // if (priceMin && priceMax && priceMin !== 'any' && priceMax !== 'any') {
    //   filterQuery['hourlyRate'] = {
    //     $gte: parseInt(priceMin),
    //     $lte: parseInt(priceMax),
    //     $ne: null
    //   };
    // }

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
      .select('name email picture onboardingData profile stats createdAt');

    // Get total count for pagination
    const totalCount = await User.countDocuments(filterQuery);

    // Format response
    const formattedTutors = tutors.map(tutor => ({
      id: tutor._id,
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

module.exports = router;