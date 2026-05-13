const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Lesson = require('../models/Lesson');
const TutorFeedback = require('../models/TutorFeedback');
const { upload, uploadImage, uploadDocument, uploadVideoWithCompression, uploadImageToGCS, verifyToken } = require('../middleware/videoUploadMiddleware');
const TutorMaterial = require('../models/TutorMaterial');
const { initializeGCS } = require('../config/gcs');
const rateLimit = require('express-rate-limit');
const { applyApprovalIfReady } = require('../utils/tutorApproval');

/**
 * Capitalizes a name properly (title case)
 * "JASON DERULA" -> "Jason Derula"
 * "jason derula" -> "Jason Derula"
 * "jAsOn DeRuLa" -> "Jason Derula"
 */
function formatName(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .trim();
}

/**
 * Formats text to ensure proper capitalization on a per-word basis:
 * - Normalizes each word that has abnormal capitalization
 * - Preserves legitimate acronyms (CERF, TEFL, CELTA, TESOL, etc.)
 * - Preserves normal words (all lowercase or proper title case)
 * - Ensures first letter of the entire text is uppercase
 * 
 * Examples:
 * "THE BEST language tutor in the WOrLD!" -> "The best language tutor in the world!"
 * "i have a cerf certificate" -> "I have a CERF certificate"
 * "MY BIO IS IN CAPS" -> "My bio is in caps"
 * "MMfsjkg kfjdgn" -> "Mmfsjkg kfjdgn"
 */
function formatText(text) {
  if (!text || typeof text !== 'string') return '';
  
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Map of legitimate acronyms: lookup key (uppercase) -> display form
  const acronymMap = {
    'CERF': 'CERF', 'TEFL': 'TEFL', 'CELTA': 'CELTA', 'TESOL': 'TESOL',
    'TOEFL': 'TOEFL', 'IELTS': 'IELTS', 'ESL': 'ESL', 'EFL': 'EFL',
    'BA': 'BA', 'BS': 'BS', 'MA': 'MA', 'MS': 'MS', 'PHD': 'PhD',
    'MBA': 'MBA', 'USA': 'USA', 'UK': 'UK', 'EU': 'EU', 'UN': 'UN',
    'NATO': 'NATO', 'NASA': 'NASA', 'DELF': 'DELF', 'DALF': 'DALF',
    'HSK': 'HSK', 'JLPT': 'JLPT', 'DELE': 'DELE', 'CILS': 'CILS',
    'TEF': 'TEF', 'TCF': 'TCF', 'CPE': 'CPE', 'CAE': 'CAE', 'FCE': 'FCE'
  };

  // Process each alphabetical word, preserving all non-alpha characters in place
  const result = trimmed.replace(/[a-zA-Z]+/g, (word) => {
    // Check if word is a known acronym (case-insensitive)
    const upperWord = word.toUpperCase();
    if (acronymMap[upperWord]) {
      return acronymMap[upperWord];
    }

    // Single letter: keep as-is (handles "I", "a", etc.)
    if (word.length === 1) {
      return word;
    }

    // Check if word already has "normal" capitalization
    const isAllLower = word === word.toLowerCase();
    const isTitleCase = word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase();

    if (isAllLower || isTitleCase) {
      return word; // Normal casing — leave it alone
    }

    // Abnormal casing detected (ALL CAPS, rAnDoM caps, MMfsjkg, WOrLD, etc.)
    // Normalize to lowercase — first-letter capitalization handled below
    return word.toLowerCase();
  });

  // Ensure first letter of the entire text is uppercase
  return result.charAt(0).toUpperCase() + result.slice(1);
}

/**
 * Calendar date key (YYYY-MM-DD) for tutor availability merge/clear.
 * Prefer id prefix "YYYY-MM-DD-..." from the app — it matches the tutor's
 * wall date and slot keys. Deriving from absoluteStart + setHours + toISOString
 * breaks for evening slots (e.g. May 2 8:30pm EDT → May 3 UTC) on UTC servers.
 */
function availabilityBlockCalendarDateKey(block) {
  if (!block) return null;
  if (typeof block.id === 'string') {
    const m = block.id.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (block.absoluteStart) {
    const d = new Date(block.absoluteStart);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0];
  }
  return null;
}

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
        auth0Picture: user.auth0Picture, // Original Auth0/Google picture (to check if custom photo uploaded)
        emailVerified: user.emailVerified,
        userType: user.userType,
        isAdmin: user.isAdmin, // ADD THIS - Required for admin access
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        tutorOnboarding: user.tutorOnboarding,
        tutorCredentials: user.tutorCredentials,
        tutorApproved: user.tutorApproved,
        // Tutor approval status drivers — required so the home/calendar
        // banner can mark each step done/pending without a refresh.
        tosAcceptedAt: user.tosAcceptedAt,
        tosVersion: user.tosVersion,
        stripeIdentityVerified: user.stripeIdentityVerified,
        stripeAccountDisabled: user.stripeAccountDisabled,
        isUSPersonForTax: user.isUSPersonForTax,
        hasUSBankAccount: user.hasUSBankAccount,
        stripeConnectOnboarded: user.stripeConnectOnboarded,
        stripePayoutsEnabled: user.stripePayoutsEnabled,
        stripeCustomerId: user.stripeCustomerId, // ADD THIS - Critical for saved card payments!
        payoutProvider: user.payoutProvider, // ADD THIS
        payoutDetails: user.payoutDetails, // ADD THIS
        profile: user.profile,
        nativeLanguage: user.nativeLanguage,
        spokenLanguages: user.spokenLanguages || [],
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

// GET /api/users/coaching-metrics - Get coaching badge metrics for current tutor
router.get('/coaching-metrics', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.userType !== 'tutor') {
      return res.status(403).json({ error: 'Only tutors can view coaching metrics' });
    }
    
    const metrics = user.stats?.feedbackMetrics || {};
    
    res.json({
      success: true,
      data: {
        feedbackRate: metrics.feedbackRate || 0,
        averageFeedbackQuality: metrics.averageFeedbackQuality || 0,
        totalLessonsCompleted: metrics.totalLessonsCompleted || 0,
        totalFeedbackProvided: metrics.totalFeedbackProvided || 0,
        coachingBadge: {
          active: metrics.coachingBadge?.active || false,
          qualifyingStreak: metrics.coachingBadge?.qualifyingStreak || 0,
          earnedAt: metrics.coachingBadge?.earnedAt || null,
          lastEvaluated: metrics.coachingBadge?.lastEvaluated || null
        }
      }
    });
  } catch (error) {
    console.error('Error fetching coaching metrics:', error);
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
      
      // Sync picture: never overwrite a custom GCS-uploaded photo with Auth0/Google avatar
      const auth0Picture = req.user.picture || req.user.picture_url || null;
      const hasCustomPicture = user.picture && user.picture.includes('storage.googleapis.com') && user.picture.includes('profile-pictures');
      if (hasCustomPicture) {
        // Keep custom upload; only refresh the auth0Picture reference
        if (auth0Picture) user.auth0Picture = auth0Picture;
      } else {
        user.picture = picture || auth0Picture || user.picture;
      }
      
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
        tutorOnboarding: user.tutorOnboarding,
        tutorCredentials: user.tutorCredentials,
        tutorApproved: user.tutorApproved,
        stripeConnectOnboarded: user.stripeConnectOnboarded,
        payoutProvider: user.payoutProvider,
        payoutDetails: user.payoutDetails,
        profile: user.profile,
        nativeLanguage: user.nativeLanguage,
        spokenLanguages: user.spokenLanguages || [],
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
      // Always format names properly (title case)
      const firstName = formatName(req.body.firstName || req.user.given_name || '');
      const lastName = formatName(req.body.lastName || req.user.family_name || '');
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
      
      // Sync picture from Auth0 only if user has no custom GCS upload
      const auth0Picture = req.user.picture || req.user.picture_url || null;
      const hasCustomPicture = user.picture && user.picture.includes('storage.googleapis.com') && user.picture.includes('profile-pictures');
      if (auth0Picture && !user.picture) {
        console.log('🖼️ User has no picture, syncing from Auth0:', auth0Picture);
        user.picture = auth0Picture;
        user.auth0Picture = auth0Picture;
      } else if (auth0Picture && !hasCustomPicture && auth0Picture !== user.picture) {
        console.log('🖼️ Updating user picture from Auth0 (no custom upload):', { old: user.picture, new: auth0Picture });
        user.picture = auth0Picture;
      }
      // Always keep auth0Picture reference fresh
      if (auth0Picture && auth0Picture !== user.auth0Picture) {
        user.auth0Picture = auth0Picture;
      }
      
      // Update firstName, lastName, country, and nativeLanguage if provided
      // Always format names properly (title case)
      if (req.body.firstName !== undefined) {
        user.firstName = formatName(req.body.firstName);
      }
      if (req.body.lastName !== undefined) {
        user.lastName = formatName(req.body.lastName);
      }
      if (req.body.country !== undefined) {
        user.country = req.body.country;
      }
      if (req.body.nativeLanguage !== undefined) {
        user.nativeLanguage = req.body.nativeLanguage;
      }
    }
    
    // Save interface language if provided during onboarding
    if (req.body.interfaceLanguage && ['en', 'es', 'fr', 'pt', 'de'].includes(req.body.interfaceLanguage)) {
      user.interfaceLanguage = req.body.interfaceLanguage;
      console.log('🌐 Interface language set during onboarding:', req.body.interfaceLanguage);
    }

    // Update onboarding data based on user type
    user.onboardingCompleted = true;
    
    if (user.userType === 'tutor') {
      // Handle tutor onboarding data
      const { languages, experience, schedule, summary, bio, hourlyRate, introductionVideo, videoThumbnail, videoType, nativeLanguage, firstName, lastName, country, residenceCountry, spokenLanguages } = req.body;
      user.onboardingData = {
        firstName: formatName(firstName || user.firstName || ''),
        lastName: formatName(lastName || user.lastName || ''),
        country: country || user.country || '',
        nativeLanguage: nativeLanguage || user.nativeLanguage || 'en',
        languages: languages || [],
        experience: experience || '',
        schedule: schedule || '',
        summary: formatText(summary || ''),
        bio: formatText(bio || ''),
        hourlyRate: Math.max(10, hourlyRate || 25),
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
      if (Array.isArray(spokenLanguages)) {
        // Validate each entry has a valid code and CEFR level before saving
        const validLevels = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
        user.spokenLanguages = spokenLanguages
          .filter(s => s && typeof s.code === 'string' && s.code.trim() && validLevels.has(s.level))
          .map(s => ({ code: s.code.trim(), level: s.level }));
      }
    } else {
      // Handle student onboarding data
      const { languages, goals, experienceLevel, preferredSchedule, learningGoal, spokenLanguages: studentSpokenLanguages } = req.body;

      // Capture the *previous* goal so we can detect a goal change after
      // save and trigger plan regeneration (preserving demonstrated state).
      // Without this hook the user.onboardingData.learningGoal updates but
      // the LearningPlan stays stale.
      const previousLearningGoal = user.onboardingData?.learningGoal
        ? {
            type: user.onboardingData.learningGoal.type,
            description: user.onboardingData.learningGoal.description || '',
            targetLevel: user.onboardingData.learningGoal.targetLevel || '',
            timeline: user.onboardingData.learningGoal.timeline || 'no_rush'
          }
        : null;
      // Stash on req for the post-save regen hook below (set after save).
      req._previousLearningGoal = previousLearningGoal;
      req._newLearningGoal = (learningGoal && learningGoal.type) ? learningGoal : null;
      req._studentLanguages = Array.isArray(languages) ? languages : [];

      user.onboardingData = {
        languages: languages || [],
        goals: goals || [],
        experienceLevel: experienceLevel || 'Beginner',
        preferredSchedule: preferredSchedule || '',
        completedAt: new Date()
      };
      if (learningGoal && learningGoal.type) {
        user.onboardingData.learningGoal = {
          type: learningGoal.type,
          description: learningGoal.description || '',
          targetLevel: learningGoal.targetLevel || '',
          selfAssessedLevel: learningGoal.selfAssessedLevel || null,
          timeline: learningGoal.timeline || 'no_rush',
          targetDate: learningGoal.targetDate || null
        };
      }
      if (Array.isArray(studentSpokenLanguages)) {
        const validLevels = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
        user.spokenLanguages = studentSpokenLanguages
          .filter(s => s && typeof s.code === 'string' && s.code.trim() && validLevels.has(s.level))
          .map(s => ({ code: s.code.trim(), level: s.level }));
      }
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

    // "Learn at my own pace" path: student skipped goal setup. Create a thin
    // unframed plan per selected language so the post-lesson pipeline still
    // has something to write into (CEFR estimate, recommended materials,
    // tutor briefings). They can promote any time from the profile.
    if (user.userType === 'student' && req.body?.skipGoalSetup === true) {
      const learningPlanService = require('../services/learningPlanService');
      for (const lang of (req._studentLanguages || [])) {
        try {
          await learningPlanService.createUnframedPlan(user._id, lang);
          console.log(`✅ [Onboarding] Unframed plan created for ${user.email} (${lang})`);
        } catch (unframedErr) {
          console.error(`❌ [Onboarding] Unframed plan creation failed for ${lang}:`, unframedErr.message);
        }
      }
    }

    // Goal-change side-effect: if a returning student's onboarding submit
    // includes a different learningGoal than they had before, regenerate
    // their LearningPlan(s) so the roadmap reflects the new intent.
    // Preserves their demonstrated chapter level — see learningPlanService.
    if (user.userType === 'student' && req._newLearningGoal && req._previousLearningGoal) {
      const prev = req._previousLearningGoal;
      const next = req._newLearningGoal;
      const goalChanged =
        prev.type !== next.type ||
        (prev.description || '') !== (next.description || '') ||
        (prev.targetLevel || '') !== (next.targetLevel || '') ||
        (prev.timeline || 'no_rush') !== (next.timeline || 'no_rush');

      if (goalChanged) {
        const learningPlanService = require('../services/learningPlanService');
        for (const lang of (req._studentLanguages || [])) {
          try {
            await learningPlanService.regeneratePlan(user._id, lang, next);
            console.log(`✅ [Onboarding] Plan regenerated for goal change (${lang}) — chapter preserved`);
          } catch (regenErr) {
            if (regenErr.statusCode === 429) {
              // Cooldown active — user.onboardingData was updated but the
              // plan was not. The frontend cooldown banner already warns
              // the student about this.
              console.log(`⏳ [Onboarding] Goal-change cooldown active for ${user.email} (${lang}); plan kept as-is`);
            } else {
              console.error(`❌ [Onboarding] Plan regen failed for ${lang}:`, regenErr.message);
              // Don't fail the onboarding — goal is saved, regen is best-effort.
            }
          }
        }
      }
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
        nativeLanguage: user.nativeLanguage,
        spokenLanguages: user.spokenLanguages || [],
        interfaceLanguage: user.interfaceLanguage,
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
    const { bio, timezone, preferredLanguage, userType, picture, officeHoursEnabled, interfaceLanguage, showWalletBalance, remindersEnabled, aiAnalysisEnabled, calendarTimeFormat, calendarDefaultView, weeklyEarningsGoal } = req.body;
    console.log('📝 Updating profile for user:', req.user.sub, 'officeHoursEnabled:', officeHoursEnabled, 'aiAnalysisEnabled:', aiAnalysisEnabled);
    
    const user = await User.findOne({ auth0Id: req.user.sub });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('📝 Before update - officeHoursEnabled:', user.profile?.officeHoursEnabled, 'showWalletBalance:', user.profile?.showWalletBalance, 'remindersEnabled:', user.profile?.remindersEnabled, 'aiAnalysisEnabled:', user.profile?.aiAnalysisEnabled);
    
    // If timezone is changing and tutor has availability, convert blocks to maintain real-world times
    const oldTimezone = user.profile?.timezone || 'UTC';
    const newTimezone = timezone !== undefined ? timezone : oldTimezone;
    if (timezone !== undefined && oldTimezone !== newTimezone && user.userType === 'tutor' && user.availability?.length > 0) {
      console.log(`🌍 Timezone changing from ${oldTimezone} to ${newTimezone} — converting ${user.availability.length} availability blocks`);
      const { fromZonedTime, toZonedTime } = require('date-fns-tz');

      for (const block of user.availability) {
        if (!block.startTime || !block.endTime) continue;

        const refDate = block.absoluteStart ? new Date(block.absoluteStart) : new Date();
        const year = refDate.getFullYear();
        const month = refDate.getMonth();
        const day = refDate.getDate();

        const [sh, sm] = block.startTime.split(':').map(Number);
        const [eh, em] = block.endTime.split(':').map(Number);

        const oldStart = new Date(year, month, day, sh, sm, 0, 0);
        const oldEnd = new Date(year, month, day, eh, em, 0, 0);

        const startUtc = fromZonedTime(oldStart, oldTimezone);
        const endUtc = fromZonedTime(oldEnd, oldTimezone);

        const newStart = toZonedTime(startUtc, newTimezone);
        const newEnd = toZonedTime(endUtc, newTimezone);

        block.startTime = `${String(newStart.getHours()).padStart(2, '0')}:${String(newStart.getMinutes()).padStart(2, '0')}`;
        block.endTime = `${String(newEnd.getHours()).padStart(2, '0')}:${String(newEnd.getMinutes()).padStart(2, '0')}`;

        if (block.day !== undefined) {
          block.day = newStart.getDay();
        }
      }

      console.log(`✅ Converted availability blocks to ${newTimezone}`);
    }

    // Update profile data - preserve existing values if not provided, use defaults if field doesn't exist
    user.profile = {
      bio: bio !== undefined ? bio : (user.profile?.bio ?? ''),
      timezone: timezone !== undefined ? timezone : (user.profile?.timezone ?? 'UTC'),
      preferredLanguage: preferredLanguage !== undefined ? preferredLanguage : (user.profile?.preferredLanguage ?? 'en'),
      officeHoursEnabled: officeHoursEnabled !== undefined ? officeHoursEnabled : (user.profile?.officeHoursEnabled ?? false),
      officeHoursLastActive: user.profile?.officeHoursLastActive ?? null,
      showWalletBalance: showWalletBalance !== undefined ? showWalletBalance : (user.profile?.showWalletBalance ?? false),
      remindersEnabled: remindersEnabled !== undefined ? remindersEnabled : (user.profile?.remindersEnabled ?? true),
      aiAnalysisEnabled: aiAnalysisEnabled !== undefined ? aiAnalysisEnabled : (user.profile?.aiAnalysisEnabled ?? true),
      calendarTimeFormat: calendarTimeFormat !== undefined ? calendarTimeFormat : (user.profile?.calendarTimeFormat ?? '12h'),
      calendarDefaultView: calendarDefaultView !== undefined ? calendarDefaultView : (user.profile?.calendarDefaultView ?? 'week'),
      weeklyEarningsGoal: (weeklyEarningsGoal !== undefined && Number.isFinite(Number(weeklyEarningsGoal)) && Number(weeklyEarningsGoal) > 0)
        ? Math.round(Number(weeklyEarningsGoal))
        : (user.profile?.weeklyEarningsGoal ?? 500)
    };
    
    console.log('📝 After update - showWalletBalance:', user.profile.showWalletBalance, 'remindersEnabled:', user.profile.remindersEnabled);
    
    // Update interface language if provided. Keep in sync with frontend SupportedLanguage list
    // (language-learning-app/src/app/services/language.service.ts).
    const SUPPORTED_INTERFACE_LANGUAGES = [
      'en', 'es', 'fr', 'pt', 'de',
      'it', 'ru', 'zh', 'ja', 'ko',
      'ar', 'hi', 'nl', 'pl', 'tr',
      'sv', 'no', 'da', 'fi', 'el',
      'cs', 'ro', 'uk', 'vi', 'th',
      'id', 'ms', 'he', 'fa'
    ];
    if (interfaceLanguage !== undefined && SUPPORTED_INTERFACE_LANGUAGES.includes(interfaceLanguage)) {
      user.interfaceLanguage = interfaceLanguage;
      console.log('🌐 Interface language updated to:', interfaceLanguage);
    } else if (interfaceLanguage !== undefined) {
      console.warn('⚠️ Rejected unsupported interfaceLanguage:', interfaceLanguage);
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
        auth0Picture: user.auth0Picture, // Original Auth0/Google picture
        emailVerified: user.emailVerified,
        userType: user.userType,
        onboardingCompleted: user.onboardingCompleted,
        onboardingData: user.onboardingData,
        profile: user.profile,
        nativeLanguage: user.nativeLanguage,
        spokenLanguages: user.spokenLanguages || [],
        interfaceLanguage: user.interfaceLanguage,
        stats: user.stats,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        // Include tutor-specific fields to prevent banner flashing
        tutorApproved: user.tutorApproved,
        tutorOnboarding: user.tutorOnboarding,
        tutorCredentials: user.tutorCredentials,
        stripeConnectOnboarded: user.stripeConnectOnboarded,
        payoutProvider: user.payoutProvider,
        payoutDetails: user.payoutDetails
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
    // Only show tutors who have completed all required setup:
    // approved, has video, has custom profile photo, and can receive payments
    const filterQuery = {
      userType: 'tutor',
      onboardingCompleted: true,
      tutorApproved: true,
      'onboardingData.introductionVideo': { $exists: true, $ne: '' },
      picture: { $regex: /storage\.googleapis\.com.*profile-pictures/ },
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

    // Country filter - match only country (country of birth/origin), not residenceCountry
    // Handle both single country (string) and multiple countries (array)
    if (country && country !== 'any') {
      const countriesArray = Array.isArray(country) ? country : [country];
      
      console.log('🌍 [COUNTRY-FILTER] Filtering by countries:', countriesArray);
      
      // Use exact case-insensitive matching instead of regex to avoid partial matches
      // This ensures "United States" doesn't match "United States of America" or vice versa incorrectly
      const countryConditions = countriesArray.map(c => ({
        country: { $regex: new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      }));
      
      console.log('🌍 [COUNTRY-FILTER] Country conditions:', JSON.stringify(countryConditions, null, 2));
      
      // Match only the country field (country of birth/origin), not residenceCountry
      filterQuery.$and = filterQuery.$and || [];
      filterQuery.$and.push({
        $or: countryConditions
      });
      
      console.log('🌍 [COUNTRY-FILTER] Filter query country condition:', JSON.stringify(filterQuery.$and[filterQuery.$and.length - 1], null, 2));
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

    // Get all matching tutor IDs (for accurate totalCount after filtering hidden tutors)
    // We need to filter out tutors with pending feedback before counting
    const allMatchingTutorIds = await User.find(filterQuery).select('_id auth0Id').lean();
    
    // Get tutors with pending feedback (hidden from search)
    // TutorFeedback.tutorId can be either MongoDB _id or auth0Id, so check both
    // GRACE PERIOD: Only count feedback older than 2 hours — gives tutors time to submit
    // after a lesson ends without immediately hiding their profile from search.
    const FEEDBACK_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours
    const graceDeadline = new Date(Date.now() - FEEDBACK_GRACE_MS);
    const allTutorMongoIds = allMatchingTutorIds.map(t => t._id);
    const allTutorAuth0Ids = allMatchingTutorIds.map(t => t.auth0Id).filter(Boolean);
    const feedbackBlocked = await TutorFeedback.distinct('tutorId', {
      $or: [
        { tutorId: { $in: allTutorMongoIds } },
        { tutorId: { $in: allTutorAuth0Ids } }
      ],
      status: 'pending',
      createdAt: { $lt: graceDeadline }
    });
    const blockedIdSet = new Set(feedbackBlocked.map(id => id.toString()));

    // ── Record grace-period violations (lazy, at-query-time) ──
    // Find expired feedback items that haven't been flagged yet and mark them.
    // This avoids needing a cron job — violations are detected whenever search runs.
    if (blockedIdSet.size > 0) {
      try {
        const newlyExpired = await TutorFeedback.find({
          $or: [
            { tutorId: { $in: allTutorMongoIds } },
            { tutorId: { $in: allTutorAuth0Ids } }
          ],
          status: 'pending',
          createdAt: { $lt: graceDeadline },
          gracePeriodExpired: { $ne: true }  // Not yet flagged
        }).select('_id tutorId').lean();

        if (newlyExpired.length > 0) {
          // Flag these feedback items so we don't double-count
          const expiredIds = newlyExpired.map(f => f._id);
          await TutorFeedback.updateMany(
            { _id: { $in: expiredIds } },
            { $set: { gracePeriodExpired: true } }
          );

          // Group violations by tutorId and increment each tutor's counter
          const violationsByTutor = {};
          for (const fb of newlyExpired) {
            const tid = fb.tutorId.toString();
            violationsByTutor[tid] = (violationsByTutor[tid] || 0) + 1;
          }

          // Build a map from tutorId (auth0Id or _id string) → User _id
          const tutorIdToMongoId = {};
          for (const t of allMatchingTutorIds) {
            tutorIdToMongoId[t._id.toString()] = t._id;
            if (t.auth0Id) tutorIdToMongoId[t.auth0Id] = t._id;
          }

          const bulkOps = [];
          for (const [tid, count] of Object.entries(violationsByTutor)) {
            const mongoId = tutorIdToMongoId[tid];
            if (mongoId) {
              bulkOps.push({
                updateOne: {
                  filter: { _id: mongoId },
                  update: { $inc: { 'stats.feedbackMetrics.feedbackGraceViolations': count } }
                }
              });
            }
          }
          if (bulkOps.length > 0) {
            await User.bulkWrite(bulkOps);
            console.log(`⚠️ Recorded ${newlyExpired.length} new grace-period violation(s) for ${bulkOps.length} tutor(s)`);
          }
        }
      } catch (violationErr) {
        // Non-critical — log and continue serving search results
        console.error('⚠️ Error recording grace-period violations:', violationErr);
      }
    }
    
    // Calculate accurate totalCount by excluding blocked tutors
    const totalCount = allMatchingTutorIds.filter(t => 
      !blockedIdSet.has(t._id.toString()) && !blockedIdSet.has(t.auth0Id)
    ).length;

    // Format response
    const now = new Date();
    const activeThreshold = 60 * 1000; // 60 seconds for heartbeat validity
    
    // Log country information for returned tutors when country filter is active
    if (country && country !== 'any') {
      console.log('🌍 [COUNTRY-FILTER] Returned tutors with their country values:');
      tutors.forEach(tutor => {
        console.log(`  - ${tutor.name || tutor.email}: country="${tutor.country}", residenceCountry="${tutor.residenceCountry}"`);
      });
    }
    
    // Filter out tutors with pending feedback from the paginated results
    // Use the same blockedIdSet we calculated above
    if (blockedIdSet.size > 0) {
      const beforeCount = tutors.length;
      tutors = tutors.filter(t => 
        !blockedIdSet.has(t._id.toString()) && !blockedIdSet.has(t.auth0Id)
      );
      console.log(`🚫 Hiding ${beforeCount - tutors.length} tutor(s) with pending feedback from search results`);
    }

    // ── Deprioritize tutors with grace-period violations ──
    // Tutors who repeatedly let feedback expire get pushed to the end of results.
    // This is a stable sort: tutors with 0 violations keep their original order,
    // while violators sink proportionally to their violation count.
    tutors.sort((a, b) => {
      const aViolations = a.stats?.feedbackMetrics?.feedbackGraceViolations || 0;
      const bViolations = b.stats?.feedbackMetrics?.feedbackGraceViolations || 0;
      return aViolations - bViolations; // Lower violations = higher priority
    });
    
    // Batch fetch material counts and real lesson stats for all tutors
    const tutorIds = tutors.map(t => t._id);
    const [materialCounts, lessonCounts, studentCounts] = await Promise.all([
      TutorMaterial.aggregate([
        { $match: { tutorId: { $in: tutorIds }, status: 'published' } },
        { $group: { _id: '$tutorId', count: { $sum: 1 } } }
      ]),
      Lesson.aggregate([
        { $match: { tutorId: { $in: tutorIds }, status: { $in: ['completed', 'ended_early'] } } },
        { $group: { _id: '$tutorId', count: { $sum: 1 } } }
      ]),
      Lesson.aggregate([
        { $match: { tutorId: { $in: tutorIds }, status: { $in: ['completed', 'ended_early'] } } },
        { $group: { _id: '$tutorId', students: { $addToSet: '$studentId' } } },
        { $project: { _id: 1, count: { $size: '$students' } } }
      ])
    ]);
    const materialCountMap = {};
    for (const mc of materialCounts) {
      materialCountMap[mc._id.toString()] = mc.count;
    }
    const lessonCountMap = {};
    for (const lc of lessonCounts) {
      lessonCountMap[lc._id.toString()] = lc.count;
    }
    const studentCountMap = {};
    for (const sc of studentCounts) {
      studentCountMap[sc._id.toString()] = sc.count;
    }

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
        summary: tutor.onboardingData?.summary || '',
        bio: tutor.onboardingData?.bio || '',
        introductionVideo: tutor.onboardingData?.introductionVideo || '',
        videoThumbnail: tutor.onboardingData?.videoThumbnail || '',
        videoType: tutor.onboardingData?.videoType || 'upload',
        country: tutor.country || tutor.residenceCountry || 'Unknown',
        gender: tutor.profile?.gender || 'Not specified',
        nativeSpeaker: tutor.profile?.nativeSpeaker || false,
        rating: tutor.stats?.rating || 0,
        totalLessons: lessonCountMap[tutor._id.toString()] || 0,
        students: studentCountMap[tutor._id.toString()] || 0,
        totalHours: tutor.stats?.totalHours || 0,
        joinedDate: tutor.createdAt,
        profile: tutor.profile, // Include full profile object for officeHoursEnabled and other features
        isActivelyAvailable, // Only true if tutor has recent heartbeat
        // Coaching badge data
        coachingBadge: {
          active: tutor.stats?.feedbackMetrics?.coachingBadge?.active || false,
          feedbackRate: tutor.stats?.feedbackMetrics?.feedbackRate || 0,
          avgQuality: tutor.stats?.feedbackMetrics?.averageFeedbackQuality || 0
        },
        materialCount: materialCountMap[tutor._id.toString()] || 0
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
    // A tutor is considered "previously approved" if they have an approved intro video OR tutorApproved is true
    const hasApprovedVideo = user.onboardingData?.introductionVideo && user.onboardingData.introductionVideo !== '';
    const wasApproved = (user.tutorOnboarding?.videoApproved === true) || (hasApprovedVideo) || (user.tutorApproved === true);
    console.log(`🔍 Was previously approved: ${wasApproved} (hasApprovedVideo: ${hasApprovedVideo}, videoApproved: ${user.tutorOnboarding?.videoApproved}, tutorApproved: ${user.tutorApproved})`);
    
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
    
    const isVideoRemoval = !introductionVideo || introductionVideo === '';

    if (user.tutorOnboarding) {
      user.tutorOnboarding.videoApproved = false; // Mark for re-review
      user.tutorOnboarding.videoRejected = false; // Clear rejection
      user.tutorOnboarding.videoRejectionReason = null;
      user.tutorOnboarding.videoUploaded = !isVideoRemoval; // Only mark as uploaded if there's actually a video
      user.tutorOnboarding.videoUploadedAt = isVideoRemoval ? null : new Date();
      
      console.log('📹 Video marked for admin review');
      
      if (isVideoRemoval) {
        // Video was removed entirely — hide profile immediately
        user.tutorApproved = false;
        // Clear the active video as well so students can't see it
        if (user.onboardingData) {
          user.onboardingData.introductionVideo = '';
          user.onboardingData.videoThumbnail = '';
          user.onboardingData.videoType = 'upload';
          user.onboardingData.pendingVideo = '';
          user.onboardingData.pendingVideoThumbnail = '';
          user.onboardingData.pendingVideoType = 'upload';
        }
        console.log('🚫 Video REMOVED: Profile hidden until new video is uploaded and approved');
      } else if (wasApproved) {
        console.log('✅ EXISTING tutor: Profile remains visible (tutorApproved stays true)');
        // tutorApproved remains true — tutor is replacing their video, keep them visible during review
      } else {
        console.log('🆕 NEW tutor: Profile will be hidden until first approval');
        user.tutorApproved = false;
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

    // For tutors: re-evaluate approval after photo change. Promote to
    // fully-approved only when every gate passes (photo, video-approved,
    // payout, identity, qualifications, TOS).
    if (user.userType === 'tutor' && !user.tutorApproved) {
      user.tutorOnboarding = user.tutorOnboarding || {};
      user.tutorOnboarding.photoUploaded = true;
      applyApprovalIfReady(user);
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

// GET /api/users/profile-picture-proxy - Proxy the user's profile picture to bypass CORS
router.get('/profile-picture-proxy', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user || !user.picture) {
      return res.status(404).json({ error: 'No profile picture found' });
    }

    const axios = require('axios');
    const response = await axios.get(user.picture, { responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'] || 'image/png';

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-cache');
    res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('Error proxying profile picture:', error.message);
    res.status(500).json({ error: 'Failed to load profile picture' });
  }
});

// PUT /api/users/availability - Update tutor availability
router.put('/availability', verifyToken, async (req, res) => {
  try {
    const { availabilityBlocks, editedDates } = req.body;
    
    console.log('🔧 PUT /api/users/availability called');
    console.log('🔧 User auth0Id:', req.user.sub);
    console.log('🔧 Received blocks:', JSON.stringify(availabilityBlocks, null, 2));
    console.log('🔧 Edited dates:', editedDates);
    
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
    // Strategy: Remove existing blocks that overlap with edited dates, then add new blocks
    
    const existingAvailability = user.availability || [];
    
    // Use editedDates if provided, otherwise extract dates from new blocks
    const datesToClear = new Set();
    
    // First, add explicitly edited dates (this allows clearing availability)
    if (editedDates && Array.isArray(editedDates)) {
      editedDates.forEach(dateStr => {
        datesToClear.add(dateStr);
      });
    }
    
    // Also add dates from new blocks (for backward compatibility)
    availabilityBlocks.forEach(block => {
      const key = availabilityBlockCalendarDateKey(block);
      if (key) datesToClear.add(key);
    });
    
    console.log('Dates to clear:', Array.from(datesToClear));
    
    // Keep existing blocks that DON'T overlap with dates to clear
    const blocksToKeep = existingAvailability.filter(existing => {
      // Always keep class blocks (type === 'class')
      if (existing.type === 'class') {
        return true;
      }
      
      // If existing block has no absolute date, keep it (recurring pattern)
      if (!existing.absoluteStart) {
        return true;
      }
      
      const existingDateKey = availabilityBlockCalendarDateKey(existing);
      if (!existingDateKey) return true;
      return !datesToClear.has(existingDateKey);
    });
    
    console.log('Blocks to keep:', blocksToKeep.length);
    console.log('New blocks to add:', availabilityBlocks.length);
    
    // Merge: kept blocks + new blocks
    const mergedAvailability = [...blocksToKeep, ...availabilityBlocks];
    
    // Use findOneAndUpdate with $set to only update availability fields
    // This avoids triggering validation on unrelated fields (e.g. bio length)
    await User.findOneAndUpdate(
      { _id: user._id },
      { 
        $set: { 
          availability: mergedAvailability,
          lastAvailabilityUpdate: new Date()
        }
      },
      { runValidators: false }
    );
    
    // Update the local user object for the response
    user.availability = mergedAvailability;
    user.lastAvailabilityUpdate = new Date();

    console.log('Final availability count:', user.availability.length);
    
    // Notify students who have worked with this tutor via WebSocket
    // This enables real-time dynamic card updates without polling
    if (req.io && availabilityBlocks.length > 0) {
      try {
        // Find students who have completed lessons with this tutor
        const pastLessons = await Lesson.find({
          tutorId: user._id,
          status: { $in: ['completed', 'finalized'] }
        }).select('studentId').lean();
        
        const studentIds = [...new Set(pastLessons.map(l => l.studentId?.toString()).filter(Boolean))];
        
        if (studentIds.length > 0) {
          console.log(`📡 Notifying ${studentIds.length} students about tutor availability update`);
          
          // Emit to each student's room (they should join their userId room on connect)
          studentIds.forEach(studentId => {
            req.io.to(studentId).emit('tutor_availability_updated', {
              tutorId: user._id.toString(),
              tutorName: user.firstName || user.name || 'Tutor',
              tutorPicture: user.picture,
              timestamp: new Date().toISOString()
            });
          });
          
          // Also emit a general event for any connected clients
          req.io.emit('tutor_availability_changed', {
            tutorId: user._id.toString()
          });
        }
      } catch (socketError) {
        console.error('⚠️ Error sending availability socket notification:', socketError.message);
        // Don't fail the request if socket notification fails
      }
    }

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

// GET /api/users/tutors-with-new-availability - Get tutors student has worked with who added availability recently
// NOTE: This route MUST come BEFORE /:userId/availability to avoid route conflicts
router.get('/tutors-with-new-availability', verifyToken, async (req, res) => {
  try {
    const student = await User.findOne({ auth0Id: req.user.sub });
    
    if (!student) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Only students can see this
    if (student.userType !== 'student') {
      return res.status(400).json({ success: false, message: 'Only students can access this' });
    }
    
    // Get past lessons to find tutors the student has worked with
    const pastLessons = await Lesson.find({
      studentId: student._id,
      status: { $in: ['completed', 'finalized'] }
    }).populate('tutorId', '_id firstName lastName picture availability lastAvailabilityUpdate');
    
    // Extract unique tutor IDs
    const tutorIds = [...new Set(pastLessons.map(lesson => lesson.tutorId?._id?.toString()).filter(Boolean))];
    
    if (tutorIds.length === 0) {
      return res.json({
        success: true,
        tutors: []
      });
    }
    
    // Find tutors who updated availability in the last 4 hours
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const now = new Date();
    
    const tutorsWithNewAvailability = await User.find({
      _id: { $in: tutorIds },
      userType: 'tutor',
      lastAvailabilityUpdate: { $gte: fourHoursAgo },
      // Make sure they have actual availability blocks
      'availability.0': { $exists: true }
    }).select('_id firstName lastName picture lastAvailabilityUpdate availability');
    
    // Filter out tutors with pending feedback (not accepting bookings)
    const TutorFeedback = require('../models/TutorFeedback');
    const blockedTutorIds = [];
    for (const tutor of tutorsWithNewAvailability) {
      const pendingCount = await TutorFeedback.countDocuments({ tutorId: tutor._id, status: 'pending', required: { $ne: false } });
      if (pendingCount > 0) {
        blockedTutorIds.push(tutor._id.toString());
        console.log(`⚠️ Tutor ${tutor.firstName} has ${pendingCount} pending feedback - excluding from availability`);
      }
    }
    const availableTutors = tutorsWithNewAvailability.filter(t => !blockedTutorIds.includes(t._id.toString()));

    // Filter to only include tutors with FUTURE availability that has UNBOOKED slots
    const tutorData = [];
    
    for (const tutor of availableTutors) {
      if (!tutor.availability || tutor.availability.length === 0) continue;
      
      // Check if any availability block is in the future
      const hasFutureAvailability = tutor.availability.some(block => {
        if (block.type === 'class') return false;
        if (block.absoluteEnd) return new Date(block.absoluteEnd) > now;
        if (block.absoluteStart) return new Date(block.absoluteStart) > now;
        return true; // Recurring patterns
      });
      
      if (!hasFutureAvailability) continue;
      
      // Get the tutor's booked lessons (scheduled, in_progress) to check for conflicts
      const bookedLessons = await Lesson.find({
        tutorId: tutor._id,
        status: { $in: ['scheduled', 'in_progress'] },
        startTime: { $gte: now }
      }).select('startTime endTime');
      
      // Check if there's at least one available time slot (not booked) that is in the FUTURE
      let hasUnbookedSlot = false;
      const nowMs = now.getTime();
      
      console.log(`🔍 Checking tutor ${tutor.firstName} availability blocks:`, tutor.availability?.length || 0);
      
      for (const block of tutor.availability) {
        if (block.type === 'class') continue;
        
        // Get the time range for this availability block
        let blockStart, blockEnd;
        if (block.absoluteStart && block.absoluteEnd) {
          blockStart = new Date(block.absoluteStart);
          blockEnd = new Date(block.absoluteEnd);
          
          console.log(`   📅 Block: ${blockStart.toISOString()} - ${blockEnd.toISOString()}`);
          console.log(`   📅 Now:   ${now.toISOString()}`);
          
          // Skip if block has completely passed
          if (blockEnd <= now) {
            console.log(`   ⏭️  Block is in the past, skipping`);
            continue;
          }
          
          // Adjust start to now if it's in the past (but end is still in future)
          if (blockStart < now) {
            console.log(`   ⏩ Block start is in past, adjusting to now`);
            blockStart = now;
          }
        } else {
          // Recurring pattern - assume it has available slots
          console.log(`   🔄 Recurring pattern detected, assuming available`);
          hasUnbookedSlot = true;
          break;
        }
        
        // Check if this block has any unbooked 25-minute slots IN THE FUTURE
        const slotDuration = 25 * 60 * 1000; // 25 minutes in ms
        let slotStart = Math.max(blockStart.getTime(), nowMs); // Ensure slot starts from now or later
        const blockEndTime = blockEnd.getTime();
        
        // Check if there's enough time left for at least one slot
        if (slotStart + slotDuration > blockEndTime) {
          console.log(`   ⏱️  Not enough time left in block for a 25-min slot`);
          continue;
        }
        
        let foundUnbooked = false;
        while (slotStart + slotDuration <= blockEndTime) {
          const slotEnd = slotStart + slotDuration;
          
          // Check if this slot conflicts with any booked lesson
          const isBooked = bookedLessons.some(lesson => {
            const lessonStart = new Date(lesson.startTime).getTime();
            const lessonEnd = new Date(lesson.endTime).getTime();
            // Conflict if slots overlap
            return slotStart < lessonEnd && slotEnd > lessonStart;
          });
          
          if (!isBooked) {
            console.log(`   ✅ Found unbooked slot at ${new Date(slotStart).toISOString()}`);
            foundUnbooked = true;
            hasUnbookedSlot = true;
            break;
          }
          
          // Move to next slot (with 5 min gap)
          slotStart += slotDuration + (5 * 60 * 1000);
        }
        
        if (!foundUnbooked) {
          console.log(`   ❌ No unbooked slots found in this block`);
        }
        
        if (hasUnbookedSlot) break;
      }
      
      if (hasUnbookedSlot) {
        tutorData.push({
          id: tutor._id.toString(),
          name: tutor.firstName && tutor.lastName 
            ? `${tutor.firstName} ${tutor.lastName}` 
            : tutor.firstName || 'Tutor',
          firstName: tutor.firstName,
          picture: tutor.picture,
          lastAvailabilityUpdate: tutor.lastAvailabilityUpdate
        });
        console.log(`✅ Tutor ${tutor.firstName} has unbooked availability slots`);
      } else {
        console.log(`❌ Tutor ${tutor.firstName} has NO unbooked/future slots - excluding from results`);
      }
    }
    
    console.log(`📅 Found ${tutorData.length} tutors with actual available slots for student ${student._id}`);
    
    res.json({
      success: true,
      tutors: tutorData
    });
  } catch (error) {
    console.error('❌ Error getting tutors with new availability:', error);
    res.status(500).json({ success: false, message: error.message });
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

    // Check if tutor has pending feedback (blocks new bookings)
    // GRACE PERIOD: Only count feedback older than 2 hours — gives tutors time to submit
    // after a lesson ends without immediately blocking their availability calendar.
    const FEEDBACK_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours
    const graceDeadline = new Date(Date.now() - FEEDBACK_GRACE_MS);
    const TutorFeedback = require('../models/TutorFeedback');
    const pendingFeedbackCount = await TutorFeedback.countDocuments({
      tutorId: tutor._id,
      status: 'pending',
      required: { $ne: false },
      createdAt: { $lt: graceDeadline }
    });
    const acceptingBookings = pendingFeedbackCount === 0;

    if (!acceptingBookings) {
      console.log(`⚠️ Tutor ${tutor._id} has ${pendingFeedbackCount} pending feedback (older than 2h) - not accepting bookings`);

      // ── Record grace-period violations (lazy detection) ──
      try {
        const newlyExpired = await TutorFeedback.updateMany(
          {
            tutorId: tutor._id,
            status: 'pending',
            required: { $ne: false },
            createdAt: { $lt: graceDeadline },
            gracePeriodExpired: { $ne: true }
          },
          { $set: { gracePeriodExpired: true } }
        );
        if (newlyExpired.modifiedCount > 0) {
          await User.updateOne(
            { _id: tutor._id },
            { $inc: { 'stats.feedbackMetrics.feedbackGraceViolations': newlyExpired.modifiedCount } }
          );
          console.log(`⚠️ Recorded ${newlyExpired.modifiedCount} new grace-period violation(s) for tutor ${tutor._id}`);
        }
      } catch (violationErr) {
        console.error('⚠️ Error recording grace-period violations:', violationErr);
      }
    }

    const totalDuration = Date.now() - startTime;
    console.log(`⏱️ [Availability] Total request time: ${totalDuration}ms`);

    res.json({ 
      success: true, 
      availability: actualAvailability,
      timezone: tutor.profile?.timezone || 'America/New_York',
      acceptingBookings
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

      // Compute real lesson/student counts from the Lesson collection
      const completedFilter = { tutorId: user._id, status: { $in: ['completed', 'ended_early'] } };
      const [lessonCount, uniqueStudents] = await Promise.all([
        Lesson.countDocuments(completedFilter),
        Lesson.distinct('studentId', completedFilter).then(ids => ids.length)
      ]);

      const tutorStats = {
        ...(user.stats?.toObject ? user.stats.toObject() : (user.stats || {})),
        totalLessons: lessonCount,
        students: uniqueStudents
      };
      
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
          country: user.country || user.residenceCountry || '',
          stats: tutorStats,
          profile: user.profile || {},
          tutorApproved: user.tutorApproved,
          stripeConnectOnboarded: hasPayoutSetup,
          payoutProvider: user.payoutProvider,
          linkedChannels: user.linkedChannels || {}
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

// ============================================================
// TUTOR CREDENTIAL UPLOAD / DELETE ROUTES
// ============================================================

/**
 * POST /api/users/tutor/upload-credential
 * Upload a credential document (government ID, teaching cert, additional doc)
 * Body (multipart): document file + credentialType + optional metadata
 */
router.post('/tutor/upload-credential', verifyToken, uploadDocument.single('document'), async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user || user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can upload credentials' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No document file provided' });
    }

    const { credentialType, certificationName, documentType, label } = req.body;

    if (!credentialType || !['governmentId', 'teachingCertification', 'additionalDocument'].includes(credentialType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid credentialType. Must be: governmentId, teachingCertification, or additionalDocument' 
      });
    }

    // Initialize GCS
    const { bucket } = initializeGCS();
    if (!bucket) {
      return res.status(500).json({ success: false, message: 'File storage not configured' });
    }

    // Generate unique filename - credentials are PRIVATE (not public)
    const timestamp = Date.now();
    const sanitizedFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const subFolder = credentialType === 'governmentId' ? 'government-id' 
      : credentialType === 'teachingCertification' ? 'certifications' 
      : 'additional';
    const gcsFilename = `credentials/${req.user.sub}/${subFolder}/${timestamp}_${sanitizedFilename}`;

    console.log('📄 Uploading credential to GCS:', gcsFilename);

    // Upload to GCS (private - not public)
    const file = bucket.file(gcsFilename);
    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          uploadedBy: req.user.sub,
          credentialType,
          uploadedAt: new Date().toISOString()
        }
      },
      public: false // Credentials are private — use signed URLs to view
    });

    // Generate a signed URL for immediate preview (valid 1 hour)
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000
    });

    // Store the GCS path (gs://) for permanent reference, signed URL for temp access
    const gcsPath = `gs://${bucket.name}/${gcsFilename}`;
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${gcsFilename}`;

    console.log('✅ Credential uploaded:', gcsPath);

    // Initialize tutorCredentials if not exists
    if (!user.tutorCredentials) {
      user.tutorCredentials = {
        governmentId: { status: 'not_uploaded' },
        teachingCertifications: [],
        additionalDocuments: []
      };
    }

    let savedCredential;

    if (credentialType === 'governmentId') {
      user.tutorCredentials.governmentId = {
        url: publicUrl,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        uploadedAt: new Date(),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null
      };
      savedCredential = user.tutorCredentials.governmentId;
    } else if (credentialType === 'teachingCertification') {
      const newCert = {
        url: publicUrl,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        certificationName: certificationName || '',
        uploadedAt: new Date(),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null
      };
      user.tutorCredentials.teachingCertifications.push(newCert);
      savedCredential = user.tutorCredentials.teachingCertifications[
        user.tutorCredentials.teachingCertifications.length - 1
      ];
    } else if (credentialType === 'additionalDocument') {
      const newDoc = {
        url: publicUrl,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        documentType: documentType || 'other',
        label: label || '',
        uploadedAt: new Date(),
        status: 'pending',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null
      };
      user.tutorCredentials.additionalDocuments.push(newDoc);
      savedCredential = user.tutorCredentials.additionalDocuments[
        user.tutorCredentials.additionalDocuments.length - 1
      ];
    }

    await user.save();

    console.log(`✅ Credential saved for tutor ${user.email}:`, {
      type: credentialType,
      fileName: req.file.originalname,
      status: 'pending'
    });

    res.json({
      success: true,
      message: 'Credential uploaded successfully',
      credential: savedCredential,
      signedUrl
    });

    // Notify admins via WebSocket that a new credential is pending review
    try {
      if (req.io) {
        req.io.emit('tutor_credential_uploaded', {
          tutorId: user._id,
          tutorName: user.name || user.email,
          tutorEmail: user.email,
          credentialType,
          fileName: req.file.originalname,
          timestamp: new Date()
        });
        console.log('📬 Notified admins of new credential upload from:', user.email);
      }
    } catch (socketError) {
      console.warn('⚠️ Could not send WebSocket notification to admins:', socketError.message);
    }

  } catch (error) {
    console.error('❌ Error uploading credential:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to upload credential' });
  }
});

/**
 * DELETE /api/users/tutor/credential/:credentialType/:credentialId
 * DELETE /api/users/tutor/credential/:credentialType
 * Remove a credential. For governmentId, credentialId is not needed.
 * For teachingCertification/additionalDocument, credentialId is the array element _id.
 */
const handleDeleteCredential = async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user || user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can manage credentials' });
    }

    const { credentialType, credentialId } = req.params;

    if (!user.tutorCredentials) {
      return res.status(404).json({ success: false, message: 'No credentials found' });
    }

    let removedUrl = null;

    if (credentialType === 'governmentId') {
      // Only allow deletion if pending (not approved)
      if (user.tutorCredentials.governmentId?.status === 'approved') {
        return res.status(400).json({ success: false, message: 'Cannot delete an approved credential' });
      }
      removedUrl = user.tutorCredentials.governmentId?.url;
      user.tutorCredentials.governmentId = {
        url: null,
        fileName: null,
        fileType: null,
        uploadedAt: null,
        status: 'not_uploaded',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null
      };
    } else if (credentialType === 'teachingCertification') {
      if (!credentialId) {
        return res.status(400).json({ success: false, message: 'credentialId required for certifications' });
      }
      const certIndex = user.tutorCredentials.teachingCertifications.findIndex(
        c => c._id.toString() === credentialId
      );
      if (certIndex === -1) {
        return res.status(404).json({ success: false, message: 'Certification not found' });
      }
      const cert = user.tutorCredentials.teachingCertifications[certIndex];
      if (cert.status === 'approved') {
        return res.status(400).json({ success: false, message: 'Cannot delete an approved certification' });
      }
      removedUrl = cert.url;
      user.tutorCredentials.teachingCertifications.splice(certIndex, 1);
    } else if (credentialType === 'additionalDocument') {
      if (!credentialId) {
        return res.status(400).json({ success: false, message: 'credentialId required for additional documents' });
      }
      const docIndex = user.tutorCredentials.additionalDocuments.findIndex(
        d => d._id.toString() === credentialId
      );
      if (docIndex === -1) {
        return res.status(404).json({ success: false, message: 'Document not found' });
      }
      const doc = user.tutorCredentials.additionalDocuments[docIndex];
      if (doc.status === 'approved') {
        return res.status(400).json({ success: false, message: 'Cannot delete an approved document' });
      }
      removedUrl = doc.url;
      user.tutorCredentials.additionalDocuments.splice(docIndex, 1);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid credential type' });
    }

    // Try to delete from GCS (best-effort)
    if (removedUrl && removedUrl.includes('storage.googleapis.com')) {
      try {
        const { bucket } = initializeGCS();
        if (bucket) {
          const gcsPath = removedUrl.replace(`https://storage.googleapis.com/${bucket.name}/`, '');
          await bucket.file(gcsPath).delete();
          console.log('🗑️ Deleted credential file from GCS:', gcsPath);
        }
      } catch (gcsError) {
        console.warn('⚠️ Failed to delete credential from GCS:', gcsError.message);
      }
    }

    await user.save();

    res.json({
      success: true,
      message: 'Credential removed',
      tutorCredentials: user.tutorCredentials
    });

  } catch (error) {
    console.error('❌ Error deleting credential:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete credential' });
  }
};
router.delete('/tutor/credential/:credentialType/:credentialId', verifyToken, handleDeleteCredential);
router.delete('/tutor/credential/:credentialType', verifyToken, handleDeleteCredential);

/**
 * GET /api/users/tutor/credential-url/:credentialType/:credentialId
 * GET /api/users/tutor/credential-url/:credentialType
 * Get a signed URL for viewing a private credential document
 */
const handleGetCredentialUrl = async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user || user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const { credentialType, credentialId } = req.params;
    let credentialUrl = null;

    if (credentialType === 'governmentId') {
      credentialUrl = user.tutorCredentials?.governmentId?.url;
    } else if (credentialType === 'teachingCertification' && credentialId) {
      const cert = user.tutorCredentials?.teachingCertifications?.find(
        c => c._id.toString() === credentialId
      );
      credentialUrl = cert?.url;
    } else if (credentialType === 'additionalDocument' && credentialId) {
      const doc = user.tutorCredentials?.additionalDocuments?.find(
        d => d._id.toString() === credentialId
      );
      credentialUrl = doc?.url;
    }

    if (!credentialUrl) {
      return res.status(404).json({ success: false, message: 'Credential not found' });
    }

    // Generate signed URL
    const { bucket } = initializeGCS();
    if (!bucket) {
      return res.status(500).json({ success: false, message: 'Storage not configured' });
    }

    const gcsPath = credentialUrl.replace(`https://storage.googleapis.com/${bucket.name}/`, '');
    const [signedUrl] = await bucket.file(gcsPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000 // 1 hour
    });

    res.json({ success: true, signedUrl });

  } catch (error) {
    console.error('❌ Error getting credential URL:', error);
    res.status(500).json({ success: false, message: 'Failed to get credential URL' });
  }
};
router.get('/tutor/credential-url/:credentialType/:credentialId', verifyToken, handleGetCredentialUrl);
router.get('/tutor/credential-url/:credentialType', verifyToken, handleGetCredentialUrl);

// POST /api/users/tutor/accept-tos - Accept Terms of Service & Independent Contractor Agreement
router.post('/tutor/accept-tos', verifyToken, async (req, res) => {
  try {
    const user = await User.findOne({ auth0Id: req.user.sub });
    if (!user || user.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can accept TOS' });
    }

    const { tosVersion } = req.body;
    user.tosAcceptedAt = new Date();
    user.tosVersion = tosVersion || '1.0';

    // Re-evaluate full approval — when TOS is the last missing gate, this
    // flips `tutorApproved` to true so the tutor becomes searchable.
    applyApprovalIfReady(user);

    await user.save();

    console.log(`✅ [TOS] Tutor ${user.email} accepted TOS v${user.tosVersion}`);

    res.json({
      success: true,
      tosAcceptedAt: user.tosAcceptedAt,
      tosVersion: user.tosVersion,
      tutorApproved: user.tutorApproved === true
    });
  } catch (error) {
    console.error('❌ Error accepting TOS:', error);
    res.status(500).json({ success: false, message: 'Failed to accept TOS' });
  }
});

module.exports = router;