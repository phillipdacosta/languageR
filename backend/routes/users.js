const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const { upload, uploadImage, uploadVideoWithCompression, uploadImageToGCS, verifyToken } = require('../middleware/videoUploadMiddleware');
const rateLimit = require('express-rate-limit');

// Rate limiters for public endpoints
const publicProfileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per IP (increased for development - adjust lower for production)
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const emailCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Very high limit for development - guards cache aggressively
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn('⚠️ Rate limit hit for email check endpoint:', req.ip);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please wait a moment before trying again',
      retryAfter: Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
    });
  }
});

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
    
    // Always update auth0Picture if we have a new Auth0 picture (even if user has custom picture)
    const hasCustomPicture = user.picture && user.picture.includes('storage.googleapis.com') && user.picture.includes('profile-pictures');
    
    if (auth0Picture && auth0Picture !== user.auth0Picture) {
      console.log('🖼️ Auth0 picture changed, updating auth0Picture:', {
        old: user.auth0Picture,
        new: auth0Picture
      });
      user.auth0Picture = auth0Picture;
      
      // If user doesn't have a custom picture, also update main picture
      if (!hasCustomPicture) {
        console.log('🖼️ User has no custom picture, also updating main picture');
        user.picture = auth0Picture;
      } else {
        console.log('🖼️ User has custom picture, keeping it but updating auth0Picture for future restore');
      }
      
      await user.save();
      console.log('✅ Pictures updated in database');
    } else if (auth0Picture && !user.picture) {
      // If Auth0 has a picture but database doesn't, sync it
      console.log('🖼️ Auth0 has picture but database doesn\'t, syncing...');
      user.picture = auth0Picture;
      user.auth0Picture = auth0Picture;
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
    
    // Ensure interfaceLanguage and nativeLanguage have default values if not set
    let needsSave = false;
    if (!user.interfaceLanguage) {
      console.log('🌐 User has no interfaceLanguage, setting default to "en"');
      user.interfaceLanguage = 'en';
      needsSave = true;
    }
    if (!user.nativeLanguage) {
      console.log('🌐 User has no nativeLanguage, setting default to "en"');
      user.nativeLanguage = 'en';
      needsSave = true;
    }
    
    // Ensure profile exists and has default values for new fields
    if (!user.profile) {
      user.profile = {};
      needsSave = true;
    }
    if (user.profile.showWalletBalance === undefined) {
      console.log('💰 User has no showWalletBalance, setting default to false');
      user.profile.showWalletBalance = false;
      needsSave = true;
    }
    if (user.profile.remindersEnabled === undefined) {
      console.log('🔔 User has no remindersEnabled, setting default to true');
      user.profile.remindersEnabled = true;
      needsSave = true;
    }
    
    if (needsSave) {
      await user.save();
      console.log('✅ Saved default language and profile preferences');
    }
    
    console.log('🌐 Returning user with languages:', {
      interfaceLanguage: user.interfaceLanguage,
      nativeLanguage: user.nativeLanguage,
      stripeCustomerId: user.stripeCustomerId // Add logging for debugging
    });
    
    res.json({
      success: true,
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        country: user.country,
        residenceCountry: user.residenceCountry, // ADD THIS
        picture: user.picture,
        emailVerified: user.emailVerified,
        userType: user.userType,
        isAdmin: user.isAdmin, // ADD THIS - Required for admin access
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        tutorOnboarding: user.tutorOnboarding,
        tutorApproved: user.tutorApproved,
        stripeConnectOnboarded: user.stripeConnectOnboarded,
        stripeCustomerId: user.stripeCustomerId, // ADD THIS - Critical for saved card payments!
        payoutProvider: user.payoutProvider, // ADD THIS
        payoutDetails: user.payoutDetails, // ADD THIS
        profile: user.profile,
        nativeLanguage: user.nativeLanguage,
        interfaceLanguage: user.interfaceLanguage,
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
        console.log('🖼️ Picture sources:', {
          'req.user.picture': req.user.picture,
          'req.user.picture_url': req.user.picture_url,
          'body.picture': picture
        });
        const auth0Picture = req.user.picture || req.user.picture_url || picture || null;
        console.log('🖼️ Selected auth0Picture:', auth0Picture);
        
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
    
    // Ensure language defaults are set for new users
    let needsSave = false;
    if (!user.interfaceLanguage) {
      console.log('🌐 POST: User has no interfaceLanguage, setting default to "en"');
      user.interfaceLanguage = 'en';
      needsSave = true;
    }
    if (!user.nativeLanguage) {
      console.log('🌐 POST: User has no nativeLanguage, setting default to "en"');
      user.nativeLanguage = 'en';
      needsSave = true;
    }
    if (needsSave) {
      await user.save();
      console.log('✅ POST: Saved default language preferences');
    }
    
    res.json({
      success: true,
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        country: user.country,
        picture: user.picture,
        emailVerified: user.emailVerified,
        userType: user.userType,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        nativeLanguage: user.nativeLanguage,
        interfaceLanguage: user.interfaceLanguage,
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

// PUT /api/users/onboarding - Complete onboarding (creates user if doesn't exist)
router.put('/onboarding', verifyToken, async (req, res) => {
  try {
    console.log('🔍 PUT /api/users/onboarding called');
    console.log('🔍 Request body:', req.body);
    console.log('🔍 Request user:', req.user);
    
    let user = await User.findOne({ auth0Id: req.user.sub });
    
    // If not found by auth0Id, try to find by email (in case auth0Id changed)
    if (!user && req.user.email) {
      console.log('🔍 User not found by auth0Id, trying email:', req.user.email);
      user = await User.findOne({ email: req.user.email });
      
      // If found by email, update the auth0Id to match current token
      if (user) {
        console.log('🔍 Found user by email, updating auth0Id from', user.auth0Id, 'to', req.user.sub);
        user.auth0Id = req.user.sub;
      }
    }
    
    // If user doesn't exist, create them now
    if (!user) {
      console.log('🔍 User not found in database - creating new user during onboarding');
      console.log('🔍 Request user data:', JSON.stringify(req.user, null, 2));
      console.log('🔍 Request body:', JSON.stringify(req.body, null, 2));
      
      // Get picture from request body (sent from frontend) or Auth0 token
      const auth0Picture = req.body.picture || req.user.picture || req.user.picture_url || null;
      console.log('🖼️ Picture source - body:', req.body.picture, 'token:', req.user.picture, 'final:', auth0Picture);
      
      // Determine userType from request body or default to 'student'
      const userType = req.body.userType || 'student';
      
      // Get firstName, lastName, and country from request body or Auth0
      const firstName = req.body.firstName || req.user.given_name || '';
      const lastName = req.body.lastName || req.user.family_name || '';
      const country = req.body.country || '';
      
      // Ensure we have email and name (required fields)
      const email = req.user.email || req.body.email;
      const name = req.user.name || req.user.given_name || email?.split('@')[0] || 'User';
      
      if (!email) {
        console.error('❌ Cannot create user: email is required');
        return res.status(400).json({ 
          error: 'Email is required',
          details: 'User email not found in authentication token. Please log in again.' 
        });
      }
      
      user = new User({
        auth0Id: req.user.sub,
        email: email,
        name: name,
        firstName: firstName,
        lastName: lastName,
        country: country,
        picture: auth0Picture,
        emailVerified: req.user.email_verified || false,
        userType: userType,
        onboardingCompleted: false
      });
      
      console.log('🔍 New user created during onboarding:', {
        email: user.email,
        name: user.name,
        picture: user.picture,
        userType: user.userType,
        firstName: user.firstName,
        lastName: user.lastName
      });
    } else {
      console.log('🔍 User found:', user.email, 'userType:', user.userType);
      console.log('🔍 Current user picture:', user.picture);
      
      // Sync picture from Auth0 if available and user doesn't have one
      const auth0Picture = req.user.picture || req.user.picture_url || null;
      if (auth0Picture && !user.picture) {
        console.log('🖼️ User has no picture, syncing from Auth0:', auth0Picture);
        user.picture = auth0Picture;
      } else if (auth0Picture && auth0Picture !== user.picture) {
        console.log('🖼️ Updating user picture from Auth0:', { old: user.picture, new: auth0Picture });
        user.picture = auth0Picture;
      }
      
      // Update firstName, lastName, country, and nativeLanguage if provided
      if (req.body.firstName !== undefined) {
        user.firstName = req.body.firstName;
      }
      if (req.body.lastName !== undefined) {
        user.lastName = req.body.lastName;
      }
      if (req.body.country !== undefined) {
        user.country = req.body.country;
      }
      if (req.body.nativeLanguage !== undefined) {
        user.nativeLanguage = req.body.nativeLanguage;
      }
    }
    
    // Update onboarding data based on user type
    user.onboardingCompleted = true;
    
    if (user.userType === 'tutor') {
      // Handle tutor onboarding data
      const { languages, experience, schedule, bio, hourlyRate, introductionVideo, videoThumbnail, videoType, nativeLanguage, firstName, lastName, country, residenceCountry } = req.body;
      user.onboardingData = {
        firstName: firstName || user.firstName || '',
        lastName: lastName || user.lastName || '',
        country: country || user.country || '',
        nativeLanguage: nativeLanguage || user.nativeLanguage || 'en',
        languages: languages || [],
        experience: experience || '',
        schedule: schedule || '',
        bio: bio || '',
        hourlyRate: hourlyRate || 25,
        introductionVideo: introductionVideo || '',
        videoThumbnail: videoThumbnail || '',
        videoType: videoType || 'upload',
        completedAt: new Date()
      };
      
      // Update user-level fields
      if (nativeLanguage) {
        user.nativeLanguage = nativeLanguage;
      }
      if (country) {
        user.country = country; // Nationality
      }
      if (residenceCountry) {
        user.residenceCountry = residenceCountry; // Where they currently live (for payouts)
      }
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
    
    try {
      await user.save();
      console.log('✅ Onboarding completed successfully for:', user.email);
      console.log('✅ Saved onboardingData:', JSON.stringify(user.onboardingData, null, 2));
    } catch (saveError) {
      console.error('❌ Error saving user during onboarding:', saveError);
      console.error('❌ Save error details:', {
        message: saveError.message,
        name: saveError.name,
        errors: saveError.errors
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to save onboarding data',
        message: saveError.message,
        details: saveError.errors
      });
    }
    
    res.json({
      success: true,
      message: 'Onboarding completed successfully',
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        country: user.country,
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
    console.error('❌ Error completing onboarding:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// PUT /api/users/profile - Update user profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { bio, timezone, preferredLanguage, userType, picture, officeHoursEnabled, interfaceLanguage, showWalletBalance, remindersEnabled, aiAnalysisEnabled } = req.body;
    console.log('📝 Updating profile for user:', req.user.sub, 'officeHoursEnabled:', officeHoursEnabled, 'aiAnalysisEnabled:', aiAnalysisEnabled);
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('📝 Before update - officeHoursEnabled:', user.profile?.officeHoursEnabled, 'showWalletBalance:', user.profile?.showWalletBalance, 'remindersEnabled:', user.profile?.remindersEnabled, 'aiAnalysisEnabled:', user.profile?.aiAnalysisEnabled);
    
    // Update profile data - preserve existing values if not provided, use defaults if field doesn't exist
    user.profile = {
      bio: bio !== undefined ? bio : (user.profile?.bio ?? ''),
      timezone: timezone !== undefined ? timezone : (user.profile?.timezone ?? 'UTC'),
      preferredLanguage: preferredLanguage !== undefined ? preferredLanguage : (user.profile?.preferredLanguage ?? 'en'),
      officeHoursEnabled: officeHoursEnabled !== undefined ? officeHoursEnabled : (user.profile?.officeHoursEnabled ?? false),
      officeHoursLastActive: user.profile?.officeHoursLastActive ?? null,
      showWalletBalance: showWalletBalance !== undefined ? showWalletBalance : (user.profile?.showWalletBalance ?? false),
      remindersEnabled: remindersEnabled !== undefined ? remindersEnabled : (user.profile?.remindersEnabled ?? true),
      aiAnalysisEnabled: aiAnalysisEnabled !== undefined ? aiAnalysisEnabled : (user.profile?.aiAnalysisEnabled ?? true)
    };
    
    console.log('📝 After update - showWalletBalance:', user.profile.showWalletBalance, 'remindersEnabled:', user.profile.remindersEnabled);
    
    // Update interface language if provided
    if (interfaceLanguage !== undefined && ['en', 'es', 'fr', 'pt', 'de'].includes(interfaceLanguage)) {
      user.interfaceLanguage = interfaceLanguage;
      console.log('🌐 Interface language updated to:', interfaceLanguage);
    }
    
    console.log('📝 After update - officeHoursEnabled:', user.profile.officeHoursEnabled, 'aiAnalysisEnabled:', user.profile.aiAnalysisEnabled);
    
    // Update userType if provided
    if (userType) {
      user.userType = userType;
    }
    
    // Update picture if provided (for in-app uploads)
    if (picture !== undefined) {
      user.picture = picture;
    }
    
    console.log('💾 About to save user with interfaceLanguage:', user.interfaceLanguage);
    await user.save();
    console.log('✅ User saved. Verifying interfaceLanguage:', user.interfaceLanguage);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        auth0Id: user.auth0Id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        country: user.country,
        picture: user.picture,
        emailVerified: user.emailVerified,
        userType: user.userType,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        nativeLanguage: user.nativeLanguage,
        interfaceLanguage: user.interfaceLanguage,
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

// POST /api/users/office-hours-heartbeat - Update last active timestamp for office hours
router.post('/office-hours-heartbeat', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check for schedule conflicts before allowing heartbeat
    const now = new Date();
    const BUFFER_MINUTES = 5; // Minimum time before next event
    const bufferTime = new Date(now.getTime() + BUFFER_MINUTES * 60 * 1000);

    const conflictingLessons = await Lesson.find({
      tutorId: user._id,
      status: { $in: ['scheduled', 'in_progress', 'pending_reschedule'] },
      isOfficeHours: { $ne: true }, // Exclude office hours lessons from conflict check
      $or: [
        // Currently in progress
        { startTime: { $lte: now }, endTime: { $gte: now } },
        // Starting within buffer period
        { startTime: { $gt: now, $lte: bufferTime } }
      ]
    }).limit(1);

    if (conflictingLessons.length > 0) {
      const conflict = conflictingLessons[0];
      const isCurrently = new Date(conflict.startTime) <= now && new Date(conflict.endTime) >= now;
      const minutesUntil = isCurrently ? 0 : Math.round((new Date(conflict.startTime) - now) / (60 * 1000));
      
      console.log('⚠️ Office hours heartbeat blocked due to schedule conflict:', {
        userId: user._id,
        email: user.email,
        conflictingLesson: conflict._id,
        isCurrently,
        minutesUntil
      });

      // Auto-disable office hours if there's a conflict
      user.profile.officeHoursEnabled = false;
      user.profile.officeHoursLastActive = null;
      await user.save();

      return res.status(409).json({ 
        error: 'Schedule conflict',
        message: isCurrently 
          ? 'You are currently in a lesson/class' 
          : `You have a lesson/class starting in ${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}`,
        autoDisabled: true
      });
    }

    // Update last active timestamp
    user.profile.officeHoursLastActive = new Date();
    await user.save();

    res.json({ success: true, lastActive: user.profile.officeHoursLastActive });
  } catch (error) {
    console.error('Error updating office hours heartbeat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/check-email - Check if user exists by email (rate limited to prevent enumeration)
router.post('/check-email', emailCheckLimiter, async (req, res) => {
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

// POST /api/users/by-email - Get user by email (rate limited - used by onboarding guard)
router.post('/by-email', emailCheckLimiter, async (req, res) => {
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
    // Only show tutors who can receive payments (Stripe, PayPal, or Manual)
    const filterQuery = {
      userType: 'tutor',
      onboardingCompleted: true,
      tutorApproved: true, // Only show approved tutors
      $or: [
        { stripeConnectOnboarded: true },
        { payoutProvider: 'paypal' },
        { payoutProvider: 'manual' }
      ]
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

    // Country filter - match either country or residenceCountry (case-insensitive)
    if (country && country !== 'any') {
      const countryRegex = new RegExp(country, 'i');
      filterQuery.$and = filterQuery.$and || [];
      filterQuery.$and.push({
        $or: [
          { country: countryRegex },
          { residenceCountry: countryRegex }
        ]
      });
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
    let useRandomSort = false;
    
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
      case 'random':
        useRandomSort = true;
        break;
      default:
        sortQuery = { createdAt: -1 };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let tutors;
    
    // For random sorting, use MongoDB aggregation with $sample
    // This gives true randomization while respecting filters
    if (useRandomSort && page == 1) {
      // For first page, use $sample for true randomization
      tutors = await User.aggregate([
        { $match: filterQuery },
        { $sample: { size: parseInt(limit) } },
        {
          $project: {
            name: 1,
            firstName: 1,
            lastName: 1,
            email: 1,
            picture: 1,
            auth0Id: 1,
            onboardingData: 1,
            profile: 1,
            stats: 1,
            createdAt: 1,
            country: 1,
            residenceCountry: 1
          }
        }
      ]);
    } else if (useRandomSort) {
      // For pagination with random, we need a consistent but random-looking order
      // Use daily seed + tutor ID hash for consistent pagination within a day
      const dailySeed = Math.floor(Date.now() / (1000 * 60 * 60 * 24)); // Changes daily
      
      tutors = await User.aggregate([
        { $match: filterQuery },
        {
          $addFields: {
            randomSort: {
              $mod: [
                { $add: [{ $toLong: '$_id' }, dailySeed] },
                10000
              ]
            }
          }
        },
        { $sort: { randomSort: 1 } },
        { $skip: skip },
        { $limit: parseInt(limit) },
        {
          $project: {
            name: 1,
            firstName: 1,
            lastName: 1,
            email: 1,
            picture: 1,
            auth0Id: 1,
            onboardingData: 1,
            profile: 1,
            stats: 1,
            createdAt: 1,
            country: 1,
            residenceCountry: 1
          }
        }
      ]);
    } else {
      // Standard sort query
      tutors = await User.find(filterQuery)
        .sort(sortQuery)
        .skip(skip)
        .limit(parseInt(limit))
        .select('name firstName lastName email picture auth0Id onboardingData profile stats createdAt country residenceCountry');
    }

    // Get total count for pagination
    const totalCount = await User.countDocuments(filterQuery);

    // Format response
    const now = new Date();
    const activeThreshold = 60 * 1000; // 60 seconds for heartbeat validity
    
    const formattedTutors = tutors.map(tutor => {
      const lastActive = tutor.profile?.officeHoursLastActive;
      const officeHoursEnabled = tutor.profile?.officeHoursEnabled;
      const timeSinceActive = lastActive ? (now - new Date(lastActive)) : null;
      const isActivelyAvailable = officeHoursEnabled && 
        lastActive && 
        timeSinceActive < activeThreshold;
      
      // Debug log for office hours - ALWAYS log, not just when enabled
      console.log(`🔍 Tutor ${tutor.email}:`, {
        officeHoursEnabled,
        lastActive,
        timeSinceActive: timeSinceActive ? `${Math.round(timeSinceActive / 1000)}s` : 'N/A',
        isActivelyAvailable
      });
      
      return {
        id: tutor._id,
        auth0Id: tutor.auth0Id,
        name: tutor.name,
        firstName: tutor.firstName || tutor.onboardingData?.firstName || '',
        lastName: tutor.lastName || tutor.onboardingData?.lastName || '',
        email: tutor.email,
        picture: tutor.picture,
        languages: tutor.onboardingData?.languages || [],
        hourlyRate: tutor.onboardingData?.hourlyRate || 25,
        experience: tutor.onboardingData?.experience || 'Beginner',
        schedule: tutor.onboardingData?.schedule || 'Flexible',
        bio: tutor.onboardingData?.bio || '',
        introductionVideo: tutor.onboardingData?.introductionVideo || '',
        videoThumbnail: tutor.onboardingData?.videoThumbnail || '',
        videoType: tutor.onboardingData?.videoType || 'upload',
        country: tutor.country || tutor.residenceCountry || 'Unknown',
        gender: tutor.profile?.gender || 'Not specified',
        nativeSpeaker: tutor.profile?.nativeSpeaker || false,
        rating: tutor.stats?.rating || 0,
        totalLessons: tutor.stats?.totalLessons || 0,
        totalHours: tutor.stats?.totalHours || 0,
        joinedDate: tutor.createdAt,
        profile: tutor.profile, // Include full profile object for officeHoursEnabled and other features
        isActivelyAvailable // Only true if tutor has recent heartbeat
      };
    });

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

// PUT /api/users/tutor-video - Update tutor introduction video with thumbnail and type
router.put('/tutor-video', verifyToken, async (req, res) => {
  try {
    const { introductionVideo, videoThumbnail, videoType } = req.body;
    
    console.log('📹 Received video update request:', {
      introductionVideo,
      videoThumbnail,
      videoType,
      hasVideo: !!introductionVideo,
      hasThumbnail: !!videoThumbnail
    });
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is a tutor
    if (user.userType !== 'tutor') {
      return res.status(403).json({ error: 'Only tutors can update introduction videos' });
    }
    
    console.log('📹 Current onboardingData before update:', user.onboardingData);
    
    // Check if this tutor was previously approved (existing tutor vs new tutor)
    const wasApproved = user.tutorOnboarding?.videoApproved === true;
    console.log(`🔍 Was previously approved: ${wasApproved}`);
    
    // Store the new video as "pending" until admin approves
    // Keep the old video active for students to see
    if (user.onboardingData) {
      // Store new video in pendingVideo fields
      user.onboardingData.pendingVideo = introductionVideo || '';
      user.onboardingData.pendingVideoThumbnail = videoThumbnail || '';
      user.onboardingData.pendingVideoType = videoType || 'upload';
      
      console.log('📹 New video stored as pending (old video remains active)');
    } else {
      // If no onboardingData, create it with the new video as pending
      user.onboardingData = {
        introductionVideo: '', // No old video
        videoThumbnail: '',
        videoType: 'upload',
        pendingVideo: introductionVideo || '',
        pendingVideoThumbnail: videoThumbnail || '',
        pendingVideoType: videoType || 'upload'
      };
    }
    
    // Reset approval status when video is changed (requires re-review)
    console.log('🔍 Current tutorOnboarding before reset:', user.tutorOnboarding);
    
    if (user.tutorOnboarding) {
      user.tutorOnboarding.videoApproved = false; // Mark for re-review
      user.tutorOnboarding.videoRejected = false; // Clear rejection
      user.tutorOnboarding.videoRejectionReason = null;
      user.tutorOnboarding.videoUploaded = true; // Mark as uploaded for admin queue
      user.tutorOnboarding.videoUploadedAt = new Date(); // ✅ Set upload timestamp
      
      console.log('📹 Video marked for admin review');
      
      // CRITICAL: If tutor was previously approved, keep profile visible during re-review
      if (wasApproved) {
        console.log('✅ EXISTING tutor: Profile remains visible (tutorApproved stays true)');
        // tutorApproved remains true - don't change it
      } else {
        console.log('🆕 NEW tutor: Profile will be hidden until first approval');
        user.tutorApproved = false; // Hide profile for brand new tutors
      }
      
      console.log('🔍 tutorOnboarding after reset:', user.tutorOnboarding);
    } else {
      // Initialize tutorOnboarding if it doesn't exist (new tutor)
      user.tutorOnboarding = {
        photoUploaded: !!user.picture,
        videoUploaded: true,
        videoUploadedAt: new Date(), // ✅ Set upload timestamp for new tutors
        videoApproved: false,
        videoRejected: false,
        videoRejectionReason: null,
        stripeConnected: user.stripeConnectOnboarded || false,
        completedAt: null,
        approvedBy: null,
        approvedAt: null
      };
      user.tutorApproved = false; // Hide profile for new tutors
      console.log('🆕 NEW tutor: Profile hidden until first approval');
    }
    
    await user.save();
    
    // Re-fetch to confirm save
    const updatedUser = await User.findOne({ auth0Id: req.user.sub });
    
    console.log('✅ Tutor video updated and saved:', {
      oldVideo: user.onboardingData.introductionVideo,
      pendingVideo: user.onboardingData.pendingVideo,
      pendingThumbnail: user.onboardingData.pendingVideoThumbnail,
      pendingType: user.onboardingData.pendingVideoType
    });
    
    console.log('✅ Confirmed in DB:', {
      oldVideo: updatedUser.onboardingData.introductionVideo,
      pendingVideo: updatedUser.onboardingData.pendingVideo,
      pendingThumbnail: updatedUser.onboardingData.pendingVideoThumbnail,
      pendingType: updatedUser.onboardingData.pendingVideoType
    });
    
    res.json({
      success: true,
      message: 'Introduction video updated successfully. Pending admin approval.',
      introductionVideo: user.onboardingData.introductionVideo, // Old video (still active)
      pendingVideo: user.onboardingData.pendingVideo, // New video (pending)
      videoThumbnail: user.onboardingData.videoThumbnail,
      videoType: user.onboardingData.videoType
    });

    // Notify admins via WebSocket that a new video is pending review
    try {
      if (req.io) {
        req.io.emit('tutor_video_uploaded', {
          tutorId: user._id,
          tutorName: user.name || user.email,
          tutorEmail: user.email,
          videoUrl: user.onboardingData.pendingVideo,
          thumbnailUrl: user.onboardingData.pendingVideoThumbnail,
          timestamp: new Date()
        });
        console.log('📬 Notified admins of new video upload from:', user.email);
      }
    } catch (socketError) {
      console.warn('⚠️ Could not send WebSocket notification to admins:', socketError.message);
    }

  } catch (error) {
    console.error('Error updating tutor video:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/tutor-video-upload - Upload video file with compression
router.post('/tutor-video-upload', verifyToken, upload.single('video'), uploadVideoWithCompression);

// POST /api/users/profile-picture-upload - Upload profile picture
router.post('/profile-picture-upload', verifyToken, uploadImage.single('image'), uploadImageToGCS);

// PUT /api/users/profile-picture - Update user's profile picture URL in database
router.put('/profile-picture', verifyToken, async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'Image URL is required' });
    }

    // Find and update user
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Save current picture as auth0Picture if it's not a custom GCS picture
    // This preserves the original Auth0/Google picture for restoration later
    if (user.picture && !user.picture.includes('storage.googleapis.com') && !user.auth0Picture) {
      user.auth0Picture = user.picture;
      console.log('💾 Saving original Auth0 picture:', user.auth0Picture);
    }

    // Update picture
    user.picture = imageUrl;
    
    // For tutors: Check if all approval steps are now complete
    if (user.userType === 'tutor' && !user.tutorApproved) {
      user.tutorOnboarding = user.tutorOnboarding || {};
      const photoComplete = !!imageUrl;
      const videoApproved = user.tutorOnboarding.videoApproved === true;
      
      // Check for ANY payout method (Stripe, PayPal, or Manual)
      const hasStripe = user.stripeConnectOnboarded === true;
      const hasPayPal = user.payoutProvider === 'paypal' && !!user.payoutDetails?.paypalEmail;
      const hasManual = user.payoutProvider === 'manual';
      const payoutComplete = hasStripe || hasPayPal || hasManual;
      
      if (photoComplete && videoApproved && payoutComplete) {
        user.tutorApproved = true;
        user.tutorOnboarding.photoUploaded = true;
        user.tutorOnboarding.completedAt = new Date();
        console.log(`🎉 Tutor ${user.email} is now FULLY APPROVED (all steps complete after photo upload)`);
      }
    }
    
    await user.save();

    console.log('✅ Profile picture updated for user:', user.email);

    res.json({
      success: true,
      message: 'Profile picture updated successfully',
      picture: imageUrl
    });
  } catch (error) {
    console.error('❌ Error updating profile picture:', error);
    res.status(500).json({ error: 'Failed to update profile picture' });
  }
});

// DELETE /api/users/profile-picture - Remove profile picture and restore Auth0 picture
router.delete('/profile-picture', verifyToken, async (req, res) => {
  try {
    const { Storage } = require('@google-cloud/storage');
    const axios = require('axios');
    
    // Find user
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const oldPictureUrl = user.picture;
    let restoredPicture = null;

    // Try to restore from saved auth0Picture
    if (user.auth0Picture) {
      restoredPicture = user.auth0Picture;
      console.log('🔄 Restoring from saved Auth0 picture:', restoredPicture);
    } else if (req.user && req.user.picture) {
      // Fallback: try to get from token
      restoredPicture = req.user.picture;
      console.log('🔄 Restoring Auth0 picture from token:', restoredPicture);
    } else {
      console.warn('⚠️ No Auth0 picture to restore - user will see initials');
    }

    // Update picture in database (restore to Auth0 picture or null)
    user.picture = restoredPicture;
    await user.save();

    console.log('✅ Profile picture removed for user:', user.email);
    if (restoredPicture) {
      console.log('✅ Restored to Auth0 picture');
    }

    // Try to delete custom picture from GCS if it's a GCS URL
    if (oldPictureUrl && oldPictureUrl.includes('storage.googleapis.com') && oldPictureUrl.includes('profile-pictures')) {
      try {
        // Extract bucket name and file path from URL
        // Format: https://storage.googleapis.com/bucket-name/path/to/file
        const urlParts = oldPictureUrl.replace('https://storage.googleapis.com/', '').split('/');
        const bucketName = urlParts[0];
        const filePath = urlParts.slice(1).join('/');

        // Initialize storage client
        const storageConfig = {
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
        };

        if (process.env.GOOGLE_CLOUD_KEY_FILE) {
          storageConfig.keyFilename = process.env.GOOGLE_CLOUD_KEY_FILE;
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          storageConfig.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        }

        const storage = new Storage(storageConfig);
        const bucket = storage.bucket(bucketName);
        const file = bucket.file(filePath);

        // Delete file from GCS
        await file.delete();
        console.log('✅ Deleted custom profile picture from GCS:', filePath);
      } catch (gcsError) {
        // Don't fail if GCS deletion fails - picture is already restored in DB
        console.warn('⚠️ Could not delete old picture from GCS:', gcsError.message);
      }
    }

    res.json({
      success: true,
      message: restoredPicture ? 'Custom picture removed, restored to account picture' : 'Profile picture removed successfully',
      picture: restoredPicture
    });
  } catch (error) {
    console.error('❌ Error removing profile picture:', error);
    res.status(500).json({ error: 'Failed to remove profile picture' });
  }
});

// PUT /api/users/availability - Update tutor availability
router.put('/availability', verifyToken, async (req, res) => {
  try {
    const { availabilityBlocks } = req.body;
    
    console.log('🔧 PUT /api/users/availability called');
    console.log('🔧 User auth0Id:', req.user.sub);
    console.log('🔧 Received blocks:', JSON.stringify(availabilityBlocks, null, 2));
    
    if (!availabilityBlocks || !Array.isArray(availabilityBlocks)) {
      console.log('❌ Invalid availability blocks');
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

    // Merge new availability blocks with existing ones
    // Strategy: Remove existing blocks that overlap with new blocks (same date), then add new blocks
    
    const existingAvailability = user.availability || [];
    
    // Get unique dates from new blocks
    const newBlockDates = new Set();
    availabilityBlocks.forEach(block => {
      if (block.absoluteStart) {
        // Normalize to date only (YYYY-MM-DD)
        const date = new Date(block.absoluteStart);
        date.setHours(0, 0, 0, 0);
        newBlockDates.add(date.toISOString().split('T')[0]);
      }
    });
    
    console.log('New block dates:', Array.from(newBlockDates));
    
    // Keep existing blocks that DON'T overlap with new block dates
    const blocksToKeep = existingAvailability.filter(existing => {
      // If existing block has no absolute date, keep it (recurring pattern)
      if (!existing.absoluteStart) {
        return true;
      }
      
      // Check if existing block is for a date we're updating
      const existingDate = new Date(existing.absoluteStart);
      existingDate.setHours(0, 0, 0, 0);
      const existingDateKey = existingDate.toISOString().split('T')[0];
      
      // Keep if NOT in the new dates we're updating
      return !newBlockDates.has(existingDateKey);
    });
    
    console.log('Blocks to keep:', blocksToKeep.length);
    console.log('New blocks to add:', availabilityBlocks.length);
    
    // Merge: kept blocks + new blocks
    user.availability = [...blocksToKeep, ...availabilityBlocks];
    await user.save();

    console.log('Final availability count:', user.availability.length);

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

// GET /api/users/:userId/availability - Get tutor availability by tutor ID (public with rate limiting)
// NOTE: This route MUST come before /availability to avoid route conflicts
router.get('/:userId/availability', publicProfileLimiter, async (req, res) => {
  try {
    const startTime = Date.now();
    const { userId } = req.params;
    console.log(`⏱️ [Availability] Request started for userId: ${userId}`);
    console.log('📅 Fetching availability for tutor ID:', userId);
    
    // Validate MongoDB ObjectId format
    if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
      console.log('📅 Invalid tutor ID format:', userId);
      return res.status(400).json({ message: 'Invalid tutor ID format' });
    }
    
    const dbStartTime = Date.now();
    const tutor = await User.findOne({ _id: userId, userType: 'tutor' });
    const dbDuration = Date.now() - dbStartTime;
    console.log(`⏱️ [Availability] DB query took: ${dbDuration}ms`);
    
    if (!tutor) {
      console.log('📅 Tutor not found:', userId);
      return res.status(404).json({ message: 'Tutor not found' });
    }

    console.log('📅 Tutor found:', tutor.name, 'Availability blocks (raw):', tutor.availability?.length || 0);
    
    // Filter OUT class blocks - classes should come from Classes API only
    // This prevents fetching thousands of old/ghost class blocks
    const withoutClasses = (tutor.availability || []).filter(block => block.type !== 'class');
    
    // Also filter out old blocks (older than 7 days ago) to prevent performance issues
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    
    const actualAvailability = withoutClasses.filter(block => {
      // Keep blocks without date (recurring patterns)
      if (!block.absoluteStart && !block.absoluteEnd) {
        return true;
      }
      
      // Keep blocks that end after 7 days ago
      if (block.absoluteEnd) {
        const blockEnd = new Date(block.absoluteEnd);
        return blockEnd >= sevenDaysAgo;
      }
      
      // Keep blocks that start after 7 days ago
      if (block.absoluteStart) {
        const blockStart = new Date(block.absoluteStart);
        return blockStart >= sevenDaysAgo;
      }
      
      return true;
    });
    
    console.log('📅 Availability blocks (filtered, excluding classes and old blocks):', actualAvailability.length);
    console.log('📅 Filtered from', withoutClasses.length, 'to', actualAvailability.length, 'blocks');

    const totalDuration = Date.now() - startTime;
    console.log(`⏱️ [Availability] Total request time: ${totalDuration}ms`);

    res.json({ 
      success: true, 
      availability: actualAvailability,
      timezone: tutor.profile?.timezone || 'America/New_York'
    });

  } catch (error) {
    console.error('Error fetching tutor availability:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:userId/public - Public user profile summary (rate limited for scraping protection)
router.get('/:userId/public', publicProfileLimiter, async (req, res) => {
  try {
    const startTime = Date.now();
    const { userId } = req.params;
    console.log(`⏱️ [Public Profile] Request started for userId: ${userId}`);
    
    // Support both MongoDB ObjectId and auth0Id
    let user;
    const dbStartTime = Date.now();
    if (/^[0-9a-fA-F]{24}$/.test(userId)) {
      // MongoDB ObjectId
      user = await User.findById(userId);
    } else {
      // Try auth0Id
      user = await User.findOne({ auth0Id: userId });
    }
    const dbDuration = Date.now() - dbStartTime;
    console.log(`⏱️ [Public Profile] DB query took: ${dbDuration}ms`);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const totalDuration = Date.now() - startTime;
    console.log(`⏱️ [Public Profile] Total request time: ${totalDuration}ms`);

    if (user.userType === 'tutor') {
      // Check if tutor has any valid payout method configured
      const hasStripe = user.stripeConnectOnboarded === true;
      const hasPayPal = user.payoutProvider === 'paypal' && !!user.payoutDetails?.paypalEmail;
      const hasManual = user.payoutProvider === 'manual';
      const hasPayoutSetup = hasStripe || hasPayPal || hasManual;
      
      res.json({
        success: true,
        tutor: {
          id: user._id,
          auth0Id: user.auth0Id,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          picture: user.picture,
          languages: user.onboardingData?.languages || [],
          hourlyRate: user.onboardingData?.hourlyRate || 25,
          experience: user.onboardingData?.experience || '',
          schedule: user.onboardingData?.schedule || '',
          bio: user.onboardingData?.bio || '',
          introductionVideo: user.onboardingData?.introductionVideo || '',
          videoThumbnail: user.onboardingData?.videoThumbnail || '',
          videoType: user.onboardingData?.videoType || 'upload',
          stats: user.stats || {},
          profile: user.profile || {},
          // Payout and approval info for booking validation
          tutorApproved: user.tutorApproved,
          stripeConnectOnboarded: hasPayoutSetup, // True if ANY payout method is set up
          payoutProvider: user.payoutProvider // Include actual provider for transparency
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
          firstName: user.firstName,
          lastName: user.lastName,
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

    console.log('🔧 GET /api/users/availability (current user)');
    console.log('🔧 User:', user.email, user.name);
    console.log('🔧 Availability blocks count (raw):', user.availability?.length || 0);
    
    // Filter OUT class blocks - classes should come from Classes API only
    // This prevents fetching thousands of old/ghost class blocks
    const actualAvailability = (user.availability || []).filter(block => block.type !== 'class');
    
    console.log('🔧 Availability blocks count (filtered, excluding classes):', actualAvailability.length);
    if (actualAvailability.length > 0) {
      console.log('🔧 First 3 blocks:', JSON.stringify(actualAvailability.slice(0, 3), null, 2));
    }

    res.json({ 
      success: true, 
      availability: actualAvailability
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
        firstName: user.firstName,
        lastName: user.lastName,
        country: user.country,
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

// POST /api/users/tutor/submit-for-review - Submit tutor profile for review
router.post('/tutor/submit-for-review', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(400).json({ success: false, message: 'Only tutors can submit for review' });
    }
    
    // Initialize tutorOnboarding if it doesn't exist
    if (!user.tutorOnboarding) {
      user.tutorOnboarding = {};
    }
    
    // Mark photo as uploaded if picture exists
    if (user.picture) {
      user.tutorOnboarding.photoUploaded = true;
    }
    
    // Mark video as uploaded if video exists
    if (user.onboardingData?.introductionVideo) {
      user.tutorOnboarding.videoUploaded = true;
    }
    
    // Mark Stripe as connected if onboarded
    if (user.stripeConnectOnboarded) {
      user.tutorOnboarding.stripeConnected = true;
    }
    
    await user.save();
    
    res.json({
      success: true,
      message: 'Profile submitted for review. You will be notified once approved.',
      tutorOnboarding: user.tutorOnboarding
    });
  } catch (error) {
    console.error('❌ Error submitting tutor for review:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;