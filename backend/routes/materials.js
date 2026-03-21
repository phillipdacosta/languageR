const express = require('express');
const router = express.Router();
const TutorMaterial = require('../models/TutorMaterial');
const MaterialPurchase = require('../models/MaterialPurchase');
const MaterialProgress = require('../models/MaterialProgress');
const MaterialView = require('../models/MaterialView');
const MaterialReport = require('../models/MaterialReport');
const LessonAnalysis = require('../models/LessonAnalysis');
const User = require('../models/User');
const Payment = require('../models/Payment');
const { verifyToken, getUserFromRequest, uploadImage } = require('../middleware/videoUploadMiddleware');
const { Storage } = require('@google-cloud/storage');

// ── Helpers ──────────────────────────────────────────────────────

function extractVideoInfo(url) {
  if (!url) return null;

  const ytPatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  for (const pat of ytPatterns) {
    const m = url.match(pat);
    if (m) {
      return {
        provider: 'youtube',
        videoId: m[1],
        embedUrl: `https://www.youtube.com/embed/${m[1]}?modestbranding=1&rel=0&showinfo=0&enablejsapi=1`,
        thumbnailUrl: `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`
      };
    }
  }

  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return {
      provider: 'vimeo',
      videoId: vimeoMatch[1],
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?title=0&byline=0&portrait=0`,
      thumbnailUrl: null
    };
  }

  return null;
}

function extractAudioInfo(url) {
  if (!url) return null;

  // Reject YouTube and Vimeo — those belong in video_quiz
  if (/youtube\.com|youtu\.be/i.test(url) || /vimeo\.com/i.test(url)) {
    return null;
  }

  // SoundCloud
  if (url.includes('soundcloud.com/')) {
    return {
      provider: 'soundcloud',
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false`
    };
  }

  // Spotify
  const spotifyMatch = url.match(/open\.spotify\.com\/(episode|track)\/([a-zA-Z0-9]+)/);
  if (spotifyMatch) {
    return {
      provider: 'spotify',
      embedUrl: `https://open.spotify.com/embed/${spotifyMatch[1]}/${spotifyMatch[2]}`
    };
  }

  // Direct audio URL (.mp3, .wav, .ogg, .m4a)
  if (/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i.test(url)) {
    return {
      provider: 'direct',
      embedUrl: url
    };
  }

  return null;
}

function normalizeChannelUrl(url) {
  if (!url) return '';
  return url.replace(/\/+$/, '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
}

async function verifyVideoChannel(videoUrl, tutor) {
  const linkedChannels = tutor.linkedChannels || {};
  if (!linkedChannels.youtubeChannelUrl && !linkedChannels.vimeoChannelUrl) return false;

  try {
    // YouTube: use oEmbed to get the video's actual channel
    const ytMatch = videoUrl.match(/(?:youtube\.com|youtu\.be)/);
    if (ytMatch && linkedChannels.youtubeChannelUrl) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
      const resp = await fetch(oembedUrl);
      if (!resp.ok) return false;
      const data = await resp.json();
      const videoChannelUrl = normalizeChannelUrl(data.author_url);
      const linkedUrl = normalizeChannelUrl(linkedChannels.youtubeChannelUrl);
      return videoChannelUrl === linkedUrl || videoChannelUrl.includes(linkedUrl) || linkedUrl.includes(videoChannelUrl);
    }

    // Vimeo: use oEmbed to get the video's actual author
    const vimeoMatch = videoUrl.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch && linkedChannels.vimeoChannelUrl) {
      const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`;
      const resp = await fetch(oembedUrl);
      if (!resp.ok) return false;
      const data = await resp.json();
      const videoAuthorUrl = normalizeChannelUrl(data.author_url);
      const linkedUrl = normalizeChannelUrl(linkedChannels.vimeoChannelUrl);
      return videoAuthorUrl === linkedUrl || videoAuthorUrl.includes(linkedUrl) || linkedUrl.includes(videoAuthorUrl);
    }
  } catch (err) {
    console.error('Channel verification error:', err.message);
    return false;
  }

  return false;
}

async function verifyAudioChannel(audioUrl, tutor) {
  const linkedChannels = tutor.linkedChannels || {};
  if (!linkedChannels.soundcloudProfileUrl) return false;

  try {
    if (audioUrl.includes('soundcloud.com/')) {
      const oembedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(audioUrl)}&format=json`;
      const resp = await fetch(oembedUrl);
      if (!resp.ok) return false;
      const data = await resp.json();
      const trackAuthorUrl = normalizeChannelUrl(data.author_url);
      const linkedUrl = normalizeChannelUrl(linkedChannels.soundcloudProfileUrl);
      return trackAuthorUrl === linkedUrl || trackAuthorUrl.includes(linkedUrl) || linkedUrl.includes(trackAuthorUrl);
    }
  } catch (err) {
    console.error('Audio channel verification error:', err.message);
    return false;
  }

  return false;
}

function validateQuiz(quiz) {
  if (!quiz || quiz.length === 0) return null;
  for (let i = 0; i < quiz.length; i++) {
    const q = quiz[i];
    const num = i + 1;
    if (!q.question) return `Question ${num} must have question text`;

    const qType = q.type || 'multiple_choice';

    switch (qType) {
      case 'multiple_choice':
        if (!q.options || q.options.length < 2)
          return `Question ${num} must have at least 2 options`;
        if (!q.options.some(o => o.isCorrect))
          return `Question ${num} must have at least one correct answer`;
        break;

      case 'fill_blank':
        if (!q.acceptedAnswers || q.acceptedAnswers.length === 0)
          return `Question ${num} must have at least one accepted answer`;
        if (!q.acceptedAnswers.some(a => a && a.trim()))
          return `Question ${num} has empty accepted answers`;
        break;

      case 'true_false':
        if (typeof q.correctAnswer !== 'boolean')
          return `Question ${num} must specify the correct answer (true or false)`;
        break;

      case 'ordering':
        if (!q.correctOrder || q.correctOrder.length < 2)
          return `Question ${num} must have at least 2 items to order`;
        if (q.correctOrder.some(item => !item || !item.trim()))
          return `Question ${num} has empty ordering items`;
        break;

      default:
        return `Question ${num} has an invalid type: ${qType}`;
    }
  }
  return null;
}

async function hasPurchased(studentId, materialId) {
  const purchase = await MaterialPurchase.findOne({
    studentId,
    materialId,
    status: 'completed'
  }).lean();
  return !!purchase;
}

// ── POST /api/materials — Create a new material ──────────────────

router.post('/', verifyToken, async (req, res) => {
  try {
    const tutor = await getUserFromRequest(req);
    if (!tutor) return res.status(404).json({ success: false, message: 'User not found' });
    if (tutor.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can create materials' });
    }

    const {
      title, description, whyTakeThis, language, level, topics, materialType,
      videoUrl, passage, audioUrl, thumbnailUrl: customThumbnail,
      pricingType, price, quiz, status, contentAttested
    } = req.body;

    if (!title || !language) {
      return res.status(400).json({ success: false, message: 'Title and language are required' });
    }

    const type = materialType || 'video_quiz';
    if (!['video_quiz', 'reading', 'listening'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid material type' });
    }

    if (pricingType === 'paid' && (!price || price <= 0)) {
      return res.status(400).json({ success: false, message: 'Paid materials must have a price greater than 0' });
    }

    const quizError = validateQuiz(quiz);
    if (quizError) {
      return res.status(400).json({ success: false, message: quizError });
    }

    const doc = {
      tutorId: tutor._id,
      title,
      description: description || '',
      whyTakeThis: whyTakeThis || '',
      language,
      level: level || 'any',
      topics: Array.isArray(topics) ? topics.map(t => t.trim().toLowerCase()).filter(Boolean) : [],
      materialType: type,
      pricingType: pricingType || 'free',
      price: pricingType === 'paid' ? price : 0,
      quiz: quiz || [],
      status: status || 'published'
    };

    // Type-specific validation & fields
    if (type === 'video_quiz') {
      if (!videoUrl) {
        return res.status(400).json({ success: false, message: 'Video URL is required for video quiz materials' });
      }
      const videoInfo = extractVideoInfo(videoUrl);
      if (!videoInfo) {
        return res.status(400).json({ success: false, message: 'Invalid YouTube or Vimeo URL' });
      }
      doc.videoUrl = videoUrl;
      doc.videoProvider = videoInfo.provider;
      doc.videoEmbedUrl = videoInfo.embedUrl;
      doc.thumbnailUrl = videoInfo.thumbnailUrl;
    }

    if (type === 'reading') {
      const strippedPassage = (passage || '').replace(/<[^>]*>/g, '').trim();
      if (!strippedPassage) {
        return res.status(400).json({ success: false, message: 'A reading passage is required' });
      }
      doc.passage = passage;
    }

    if (type === 'listening') {
      if (!audioUrl) {
        return res.status(400).json({ success: false, message: 'An audio URL is required for listening exercises' });
      }
      const audioInfo = extractAudioInfo(audioUrl);
      if (!audioInfo) {
        return res.status(400).json({ success: false, message: 'Invalid audio URL. Supported: SoundCloud, Spotify, or direct audio files (.mp3, .wav, etc.). For YouTube/Vimeo, use Video Quiz instead.' });
      }
      doc.audioUrl = audioUrl;
      doc.audioProvider = audioInfo.provider;
      doc.audioEmbedUrl = audioInfo.embedUrl;
    }

    if (customThumbnail) {
      doc.thumbnailUrl = customThumbnail;
    }

    // Content ownership attestation
    if (status === 'published' && !contentAttested) {
      return res.status(400).json({ success: false, message: 'You must confirm that you own or have rights to this content before publishing' });
    }
    if (contentAttested) {
      doc.contentAttested = true;
      doc.contentAttestedAt = new Date();
    }

    // Auto-verify channel ownership for paid materials
    let channelVerified = false;
    if (pricingType === 'paid') {
      if (type === 'video_quiz' && videoUrl) {
        channelVerified = await verifyVideoChannel(videoUrl, tutor);
      } else if (type === 'listening' && audioUrl) {
        channelVerified = await verifyAudioChannel(audioUrl, tutor);
      }
      doc.channelVerified = channelVerified;
      if (!channelVerified && (type === 'video_quiz' || type === 'listening')) {
        doc.reviewStatus = 'pending_review';
      } else {
        doc.reviewStatus = 'auto_approved';
      }
    }

    const material = await TutorMaterial.create(doc);
    res.status(201).json({ success: true, material });
  } catch (error) {
    console.error('Error creating material:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── POST /api/materials/upload-thumbnail — Upload material thumbnail ──

router.post('/upload-thumbnail', verifyToken, uploadImage.single('thumbnail'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
    if (!projectId || !bucketName) {
      return res.status(503).json({ success: false, message: 'Storage not configured' });
    }

    const storage = new Storage({ projectId, keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE });
    const bucket = storage.bucket(bucketName);

    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    const ext = req.file.originalname.split('.').pop();
    const fileName = `material-thumbnails/${req.user.sub}/${timestamp}-${rand}.${ext}`;

    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: { contentType: req.file.mimetype, cacheControl: 'public, max-age=31536000' }
    });

    stream.on('error', () => res.status(500).json({ success: false, message: 'Upload failed' }));
    stream.on('finish', async () => {
      await file.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${fileName}`;
      res.json({ success: true, imageUrl: publicUrl });
    });

    stream.end(req.file.buffer);
  } catch (err) {
    console.error('Material thumbnail upload error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── Channel resolution helpers ──────────────────────────────────

async function resolveYouTubeChannel(channelUrl) {
  if (!channelUrl) return null;
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  try {
    // Extract handle or channel ID from URL
    const handleMatch = channelUrl.match(/@([\w.-]+)/);
    const channelIdMatch = channelUrl.match(/channel\/(UC[\w-]+)/);

    let channelData;

    if (handleMatch) {
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/channels?forHandle=${handleMatch[1]}&part=snippet,statistics&key=${apiKey}`);
      if (!resp.ok) return null;
      channelData = await resp.json();
    } else if (channelIdMatch) {
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/channels?id=${channelIdMatch[1]}&part=snippet,statistics&key=${apiKey}`);
      if (!resp.ok) return null;
      channelData = await resp.json();
    } else {
      return null;
    }

    if (!channelData.items || channelData.items.length === 0) return null;

    const item = channelData.items[0];
    const subCount = parseInt(item.statistics?.subscriberCount || '0');
    let subLabel = '';
    if (subCount >= 1000000) subLabel = (subCount / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    else if (subCount >= 1000) subLabel = (subCount / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    else subLabel = subCount.toString();

    return {
      name: item.snippet?.title || null,
      avatar: item.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.medium?.url || null,
      subscriberCount: subLabel + ' subscribers'
    };
  } catch (err) {
    console.error('YouTube channel resolve error:', err.message);
    return null;
  }
}

async function resolveVimeoChannel(channelUrl) {
  if (!channelUrl) return null;
  try {
    // Extract username from URL like https://vimeo.com/username
    const match = channelUrl.match(/vimeo\.com\/([^/?#]+)/);
    if (!match) return null;
    const username = match[1];

    // Vimeo's public user endpoint returns profile data as HTML; use oEmbed on a
    // known video from the user as a fallback. First try fetching their profile page
    // and scraping the JSON-LD or og:title.
    const profileResp = await fetch(channelUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
      redirect: 'follow'
    });
    if (!profileResp.ok) return { name: username, avatar: null };

    const html = await profileResp.text();

    // Try to extract name from og:title
    const ogMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    const name = ogMatch ? ogMatch[1] : username;

    // Try to extract avatar from og:image or portrait
    const imgMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    const avatar = imgMatch ? imgMatch[1] : null;

    return { name, avatar };
  } catch {
    return null;
  }
}

async function resolveSoundCloudProfile(profileUrl) {
  if (!profileUrl) return null;
  try {
    const resp = await fetch(`https://soundcloud.com/oembed?url=${encodeURIComponent(profileUrl)}&format=json`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      name: data.author_name || null,
      avatar: data.thumbnail_url || null
    };
  } catch {
    return null;
  }
}

// ── PUT /api/materials/linked-channels — Update tutor's linked channels ──

router.put('/linked-channels', verifyToken, async (req, res) => {
  try {
    const tutor = await getUserFromRequest(req);
    if (!tutor) return res.status(404).json({ success: false, message: 'User not found' });
    if (tutor.userType !== 'tutor') {
      return res.status(403).json({ success: false, message: 'Only tutors can link channels' });
    }

    const { youtubeChannelUrl, vimeoChannelUrl, soundcloudProfileUrl } = req.body;

    const updates = {};

    // YouTube
    if (youtubeChannelUrl !== undefined) {
      updates['linkedChannels.youtubeChannelUrl'] = youtubeChannelUrl || null;
      if (youtubeChannelUrl) {
        const ytInfo = await resolveYouTubeChannel(youtubeChannelUrl);
        if (ytInfo) {
          updates['linkedChannels.youtubeChannelName'] = ytInfo.name;
          updates['linkedChannels.youtubeChannelAvatar'] = ytInfo.avatar;
          updates['linkedChannels.youtubeSubscriberCount'] = ytInfo.subscriberCount;
        } else {
          updates['linkedChannels.youtubeChannelName'] = null;
          updates['linkedChannels.youtubeChannelAvatar'] = null;
          updates['linkedChannels.youtubeSubscriberCount'] = null;
        }
      } else {
        updates['linkedChannels.youtubeChannelName'] = null;
        updates['linkedChannels.youtubeChannelAvatar'] = null;
        updates['linkedChannels.youtubeSubscriberCount'] = null;
      }
    }

    // Vimeo
    if (vimeoChannelUrl !== undefined) {
      updates['linkedChannels.vimeoChannelUrl'] = vimeoChannelUrl || null;
      if (vimeoChannelUrl) {
        const vimeoInfo = await resolveVimeoChannel(vimeoChannelUrl);
        if (vimeoInfo) {
          updates['linkedChannels.vimeoChannelName'] = vimeoInfo.name;
          updates['linkedChannels.vimeoChannelAvatar'] = vimeoInfo.avatar;
        }
      } else {
        updates['linkedChannels.vimeoChannelName'] = null;
        updates['linkedChannels.vimeoChannelAvatar'] = null;
      }
    }

    // SoundCloud
    if (soundcloudProfileUrl !== undefined) {
      updates['linkedChannels.soundcloudProfileUrl'] = soundcloudProfileUrl || null;
      if (soundcloudProfileUrl) {
        const scInfo = await resolveSoundCloudProfile(soundcloudProfileUrl);
        if (scInfo) {
          updates['linkedChannels.soundcloudProfileName'] = scInfo.name;
          updates['linkedChannels.soundcloudProfileAvatar'] = scInfo.avatar;
        }
      } else {
        updates['linkedChannels.soundcloudProfileName'] = null;
        updates['linkedChannels.soundcloudProfileAvatar'] = null;
      }
    }

    await User.findByIdAndUpdate(tutor._id, { $set: updates });

    const updated = await User.findById(tutor._id).select('linkedChannels').lean();
    res.json({ success: true, linkedChannels: updated.linkedChannels || {} });
  } catch (error) {
    console.error('Error updating linked channels:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── GET /api/materials/linked-channels — Get tutor's linked channels ──

router.get('/linked-channels', verifyToken, async (req, res) => {
  try {
    const tutor = await getUserFromRequest(req);
    if (!tutor) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, linkedChannels: tutor.linkedChannels || {} });
  } catch (error) {
    console.error('Error fetching linked channels:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── GET /api/materials/my — Get current tutor's materials ────────

router.get('/my', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const materials = await TutorMaterial.find({
      tutorId: user._id,
      status: { $ne: 'deleted' }
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, materials });
  } catch (error) {
    console.error('Error fetching my materials:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── GET /api/materials/my-purchases — Student's purchased materials ──

router.get('/my-purchases', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const purchases = await MaterialPurchase.find({
      studentId: user._id
    })
      .populate({
        path: 'materialId',
        select: 'title description language level materialType videoUrl videoProvider videoEmbedUrl thumbnailUrl passage audioUrl audioProvider audioEmbedUrl pricingType price status stats mediaUnavailable',
        populate: { path: 'tutorId', select: 'name firstName lastName picture' }
      })
      .sort({ createdAt: -1 })
      .lean();

    const materials = purchases
      .filter(p => p.materialId)
      .map(p => ({
        ...p.materialId,
        purchasedAt: p.createdAt,
        purchaseAmount: p.amount,
        purchaseStatus: p.status,
        refundedAt: p.refundedAt || null,
        refundReason: p.refundReason || null
      }));

    res.json({ success: true, materials });
  } catch (error) {
    console.error('Error fetching purchased materials:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── GET /api/materials/tutor/:tutorId — Get published materials for a tutor (public) ──

router.get('/tutor/:tutorId', async (req, res) => {
  try {
    const materials = await TutorMaterial.find({
      tutorId: req.params.tutorId,
      status: 'published'
    })
      .select('-quiz.options.isCorrect')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, materials });
  } catch (error) {
    console.error('Error fetching tutor materials:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── GET /api/materials/my-progress — Get student's material progress ────

router.get('/my-progress', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const progress = await MaterialProgress.find({ studentId: user._id })
      .populate('materialId', 'title language level topics materialType thumbnailUrl')
      .sort({ lastAttemptAt: -1 });

    res.json({ success: true, progress });
  } catch (error) {
    console.error('Error fetching material progress:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── GET /api/materials/recommended/:language — Struggle-matched recommendations ────

function cefrToMaterialLevel(cefr) {
  if (['A1', 'A2'].includes(cefr)) return 'beginner';
  if (['B1', 'B2'].includes(cefr)) return 'intermediate';
  return 'advanced';
}

router.get('/recommended/:language', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const language = req.params.language;

    const latestAnalysis = await LessonAnalysis.findOne({
      studentId: user._id,
      language,
      status: 'completed'
    }).sort({ lessonDate: -1 }).lean();

    const studentCefr = latestAnalysis?.overallAssessment?.proficiencyLevel || 'A1';
    const studentLevel = cefrToMaterialLevel(studentCefr);

    const recentAnalyses = await LessonAnalysis.find({
      studentId: user._id,
      language,
      status: 'completed'
    })
      .sort({ lessonDate: -1 })
      .limit(5)
      .select('topErrors errorPatterns progressionMetrics')
      .lean();

    const struggleKeywords = new Set();
    recentAnalyses.forEach(a => {
      (a.topErrors || []).forEach(e => {
        if (e.issue) struggleKeywords.add(e.issue.toLowerCase().trim());
      });
      (a.errorPatterns || []).forEach(p => {
        if (p.pattern) struggleKeywords.add(p.pattern.toLowerCase().trim());
      });
      (a.progressionMetrics?.persistentChallenges || []).forEach(c => {
        struggleKeywords.add(c.toLowerCase().trim());
      });
    });

    const completedMats = await MaterialProgress.find({
      studentId: user._id,
      completed: true
    }).select('materialId').lean();
    const completedIds = completedMats.map(c => c.materialId);

    const materials = await TutorMaterial.find({
      language: { $regex: new RegExp(`^${language}$`, 'i') },
      level: { $in: [studentLevel, 'any'] },
      status: 'published',
      _id: { $nin: completedIds },
      tutorId: { $ne: user._id }
    })
      .populate('tutorId', 'name firstName lastName picture')
      .sort({ 'stats.averageScore': -1 })
      .limit(30)
      .lean();

    const struggled = Array.from(struggleKeywords);
    const scored = materials.map(m => {
      const topics = (m.topics || []).map(t => t.toLowerCase());
      let topicScore = 0;
      const matchedStruggles = [];

      struggled.forEach(s => {
        const sWords = s.split(/\s+/);
        topics.forEach(t => {
          const tWords = t.split(/\s+/);
          const overlap = sWords.some(sw => tWords.some(tw =>
            tw.includes(sw) || sw.includes(tw)
          ));
          if (overlap) {
            topicScore += 10;
            matchedStruggles.push(s);
          }
        });
      });

      return { ...m, _topicScore: topicScore, _matchedStruggles: [...new Set(matchedStruggles)] };
    });

    scored.sort((a, b) => b._topicScore - a._topicScore);
    const topMaterials = scored.slice(0, 10);

    res.json({
      success: true,
      materials: topMaterials,
      studentLevel: studentCefr,
      struggles: struggled
    });
  } catch (error) {
    console.error('Error getting recommended materials:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── GET /api/materials/:id — Get single material ─────────────────

router.get('/:id', async (req, res) => {
  try {
    // Optional auth — try to resolve user but allow unauthenticated access
    let user = null;
    if (req.headers.authorization) {
      try {
        let authResolved = false;
        await new Promise((resolve) => {
          const noopRes = { status: () => ({ json: () => { authResolved = false; resolve(); } }) };
          verifyToken(req, noopRes, () => { authResolved = true; resolve(); });
        });
        if (authResolved && req.user) {
          user = await getUserFromRequest(req);
        }
      } catch (_) { /* unauthenticated — continue */ }
    }

    const material = await TutorMaterial.findById(req.params.id)
      .populate('tutorId', 'name firstName lastName picture email linkedChannels')
      .lean();

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const isOwner = user ? material.tutorId._id.toString() === user._id.toString() : false;
    const purchased = (user && !isOwner) ? await hasPurchased(user._id, material._id) : false;

    if ((material.status === 'deleted' || material.status === 'archived') && !isOwner && !purchased) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    // Track unique views only for authenticated non-owners
    if (user && !isOwner) {
      let isNewView = false;
      try {
        await MaterialView.create({ materialId: material._id, userId: user._id });
        isNewView = true;
      } catch (err) {
        if (err.code !== 11000) throw err;
      }

      if (isNewView) {
        const inc = { 'stats.views': 1 };
        if (req.query.ref) {
          inc['stats.referralViews'] = 1;
          await User.findByIdAndUpdate(material.tutorId._id, {
            $inc: { materialReferralViews: 1 }
          });
          const tutor = await User.findById(material.tutorId._id).select('materialReferralViews isAmbassador');
          if (tutor && !tutor.isAmbassador && (tutor.materialReferralViews || 0) >= 50) {
            tutor.isAmbassador = true;
            await tutor.save();
          }
        }
        await TutorMaterial.findByIdAndUpdate(req.params.id, { $inc: inc });
      }
    }

    // For paid materials: lock quiz for non-owners who haven't purchased (or unauthenticated)
    if (!isOwner && material.pricingType === 'paid' && !purchased) {
      material.quiz = material.quiz.map(q => ({
        ...q,
        options: q.options.map(o => ({ text: o.text, _id: o._id }))
      }));
      material.quizLocked = true;
    } else {
      material.quizLocked = false;
    }

    material.purchased = purchased;

    if (user && !isOwner && purchased) {
      const purchaseRecord = await MaterialPurchase.findOne({
        studentId: user._id,
        materialId: material._id
      }).select('status refundedAt refundReason').lean();
      if (purchaseRecord) {
        material.purchaseStatus = purchaseRecord.status;
        material.refundedAt = purchaseRecord.refundedAt || null;
        material.refundReason = purchaseRecord.refundReason || null;
      }
    }

    res.json({ success: true, material });
  } catch (error) {
    console.error('Error fetching material:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── PUT /api/materials/:id — Update a material ───────────────────

router.put('/:id', verifyToken, async (req, res) => {
  try {
    const tutor = await getUserFromRequest(req);
    if (!tutor) return res.status(404).json({ success: false, message: 'User not found' });

    const material = await TutorMaterial.findById(req.params.id);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }
    if (material.tutorId.toString() !== tutor._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const { title, description, whyTakeThis, language, level, topics, videoUrl, passage, audioUrl, thumbnailUrl: customThumbnail, pricingType, price, quiz, status, contentAttested } = req.body;

    // Video quiz URL update
    if (material.materialType === 'video_quiz' && videoUrl && videoUrl !== material.videoUrl) {
      const videoInfo = extractVideoInfo(videoUrl);
      if (!videoInfo) {
        return res.status(400).json({ success: false, message: 'Invalid YouTube or Vimeo URL' });
      }
      material.videoUrl = videoUrl;
      material.videoProvider = videoInfo.provider;
      material.videoEmbedUrl = videoInfo.embedUrl;
      material.thumbnailUrl = videoInfo.thumbnailUrl;
    }

    // Reading passage update
    if (material.materialType === 'reading' && passage !== undefined) {
      material.passage = passage;
    }

    // Listening audio URL update
    if (material.materialType === 'listening' && audioUrl && audioUrl !== material.audioUrl) {
      const audioInfo = extractAudioInfo(audioUrl);
      if (!audioInfo) {
        return res.status(400).json({ success: false, message: 'Invalid audio URL. Supported: SoundCloud, Spotify, or direct audio files.' });
      }
      material.audioUrl = audioUrl;
      material.audioProvider = audioInfo.provider;
      material.audioEmbedUrl = audioInfo.embedUrl;
    }

    if (title !== undefined) material.title = title;
    if (description !== undefined) material.description = description;
    if (whyTakeThis !== undefined) material.whyTakeThis = whyTakeThis;
    if (customThumbnail) material.thumbnailUrl = customThumbnail;
    if (language !== undefined) material.language = language;
    if (level !== undefined) material.level = level;
    if (pricingType !== undefined) material.pricingType = pricingType;
    if (price !== undefined) material.price = pricingType === 'paid' ? price : 0;
    if (quiz !== undefined) material.quiz = quiz;
    if (status !== undefined) material.status = status;

    if (topics !== undefined) {
      material.topics = Array.isArray(topics) ? topics.map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    }

    // Content attestation on update
    if (contentAttested && !material.contentAttested) {
      material.contentAttested = true;
      material.contentAttestedAt = new Date();
    }

    // Re-verify channel ownership if URL changed and material is paid
    if (material.pricingType === 'paid') {
      const currentVideoUrl = material.videoUrl;
      const currentAudioUrl = material.audioUrl;
      if (material.materialType === 'video_quiz' && currentVideoUrl) {
        material.channelVerified = await verifyVideoChannel(currentVideoUrl, tutor);
      } else if (material.materialType === 'listening' && currentAudioUrl) {
        material.channelVerified = await verifyAudioChannel(currentAudioUrl, tutor);
      }
      if (!material.channelVerified && (material.materialType === 'video_quiz' || material.materialType === 'listening')) {
        material.reviewStatus = 'pending_review';
      }
    }

    await material.save();
    res.json({ success: true, material });
  } catch (error) {
    console.error('Error updating material:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── DELETE /api/materials/:id — Delete a material ────────────────
// Soft-deletes if any student has purchased; hard-deletes otherwise.

router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const tutor = await getUserFromRequest(req);
    if (!tutor) return res.status(404).json({ success: false, message: 'User not found' });

    const material = await TutorMaterial.findById(req.params.id);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }
    if (material.tutorId.toString() !== tutor._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const purchaseCount = await MaterialPurchase.countDocuments({
      materialId: material._id,
      status: 'completed'
    });

    if (purchaseCount > 0) {
      material.status = 'deleted';
      await material.save();
      res.json({
        success: true,
        message: `Material hidden. ${purchaseCount} student${purchaseCount !== 1 ? 's' : ''} who purchased it will retain access.`,
        softDeleted: true
      });
    } else {
      await TutorMaterial.findByIdAndDelete(req.params.id);
      res.json({ success: true, message: 'Material deleted', softDeleted: false });
    }
  } catch (error) {
    console.error('Error deleting material:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── POST /api/materials/:id/purchase — Purchase quiz access ───────

router.post('/:id/purchase', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const material = await TutorMaterial.findById(req.params.id).populate('tutorId', 'stripeConnectAccountId stripeConnectOnboarded');
    if (!material) return res.status(404).json({ success: false, message: 'Material not found' });

    if (material.pricingType !== 'paid') {
      return res.status(400).json({ success: false, message: 'This material is free' });
    }

    if (material.tutorId._id.toString() === user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You own this material' });
    }

    const alreadyPurchased = await hasPurchased(user._id, material._id);
    if (alreadyPurchased) {
      return res.status(400).json({ success: false, message: 'Already purchased' });
    }

    const { stripePaymentMethodId } = req.body;
    if (!stripePaymentMethodId) {
      return res.status(400).json({ success: false, message: 'Payment method required' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const amount = Math.round(material.price * 100);

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user._id.toString() }
      });
      customerId = customer.id;
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    const paymentIntentParams = {
      amount,
      currency: 'usd',
      customer: customerId,
      payment_method: stripePaymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      },
      metadata: {
        type: 'material_purchase',
        materialId: material._id.toString(),
        studentId: user._id.toString(),
        tutorId: material.tutorId._id.toString()
      }
    };

    const tutor = material.tutorId;
    if (tutor.stripeConnectAccountId && tutor.stripeConnectOnboarded) {
      const platformFee = Math.round(amount * 0.20);
      paymentIntentParams.application_fee_amount = platformFee;
      paymentIntentParams.transfer_data = {
        destination: tutor.stripeConnectAccountId
      };
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    if (paymentIntent.status === 'succeeded') {
      await MaterialPurchase.create({
        studentId: user._id,
        materialId: material._id,
        tutorId: material.tutorId._id,
        amount: material.price,
        currency: 'usd',
        stripePaymentIntentId: paymentIntent.id,
        status: 'completed'
      });

      const platformFee = Math.round(amount * 0.20);
      const tutorPayout = (amount - platformFee) / 100;

      await Payment.create({
        userId: user._id,
        studentId: user._id,
        tutorId: material.tutorId._id,
        materialId: material._id,
        amount: material.price,
        currency: 'USD',
        paymentMethod: 'card',
        status: 'succeeded',
        stripePaymentIntentId: paymentIntent.id,
        platformFee: platformFee / 100,
        platformFeePercentage: 20,
        tutorPayout,
        paymentType: 'material_purchase',
        revenueRecognized: true,
        revenueRecognizedAt: new Date(),
        transferStatus: 'available',
        earningsReleaseDate: new Date(),
        metadata: {
          materialTitle: material.title,
          materialType: material.materialType
        }
      });

      await TutorMaterial.findByIdAndUpdate(material._id, { $inc: { 'stats.purchases': 1 } });

      return res.json({ success: true, message: 'Purchase successful' });
    }

    res.status(400).json({ success: false, message: 'Payment not completed', status: paymentIntent.status });
  } catch (error) {
    console.error('Error purchasing material:', error);
    if (error.type === 'StripeCardError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Payment failed' });
  }
});

// ── GET /api/materials/:id/check-media — Real-time video availability check ──

router.get('/:id/check-media', async (req, res) => {
  try {
    const material = await TutorMaterial.findById(req.params.id)
      .select('materialType videoUrl videoProvider audioUrl audioProvider mediaUnavailable')
      .lean();

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    if (material.materialType === 'reading') {
      return res.json({ success: true, available: true });
    }

    if (material.materialType === 'video_quiz' && material.videoUrl) {
      const { isYouTubeVideoAvailable, isVimeoVideoAvailable, parseVideoId } = require('../jobs/checkMaterialAvailability');
      const videoId = parseVideoId(material.videoUrl, material.videoProvider);

      if (!videoId) {
        return res.json({ success: true, available: false, reason: 'Invalid video URL' });
      }

      let available;
      if (material.videoProvider === 'youtube') {
        available = await isYouTubeVideoAvailable(videoId);
      } else if (material.videoProvider === 'vimeo') {
        available = await isVimeoVideoAvailable(videoId);
      } else {
        available = true;
      }

      if (!available && !material.mediaUnavailable) {
        await TutorMaterial.findByIdAndUpdate(req.params.id, {
          $set: { mediaUnavailable: true, mediaUnavailableSince: new Date() }
        });
      } else if (available && material.mediaUnavailable) {
        await TutorMaterial.findByIdAndUpdate(req.params.id, {
          $unset: { mediaUnavailable: 1, mediaUnavailableSince: 1 }
        });
      }

      return res.json({ success: true, available });
    }

    return res.json({ success: true, available: true });
  } catch (error) {
    console.error('Error checking media availability:', error);
    return res.json({ success: true, available: true });
  }
});

// ── POST /api/materials/:id/quiz/submit — Submit quiz answers ────

router.post('/:id/quiz/submit', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const material = await TutorMaterial.findById(req.params.id);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    const isOwner = material.tutorId.toString() === user._id.toString();

    if (material.pricingType === 'paid' && !isOwner) {
      const purchased = await hasPurchased(user._id, material._id);
      if (!purchased) {
        return res.status(403).json({ success: false, message: 'Purchase required to take this quiz' });
      }
    }

    const { answers } = req.body;
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: 'Answers array is required' });
    }

    let correct = 0;
    const results = material.quiz.map((q, i) => {
      const userAnswer = answers[i];
      const qType = q.type || 'multiple_choice';
      let isCorrect = false;
      let correctAnswerText = '';
      let correctAnswerValue = null;

      switch (qType) {
        case 'multiple_choice': {
          const correctOption = q.options.find(o => o.isCorrect);
          isCorrect = !!(correctOption && correctOption._id.toString() === userAnswer);
          correctAnswerText = correctOption?.text || '';
          correctAnswerValue = correctOption?._id;
          break;
        }
        case 'fill_blank': {
          const trimmed = (userAnswer || '').toString().trim().toLowerCase();
          isCorrect = (q.acceptedAnswers || []).some(
            a => a.trim().toLowerCase() === trimmed
          );
          correctAnswerText = (q.acceptedAnswers || [])[0] || '';
          correctAnswerValue = q.acceptedAnswers || [];
          break;
        }
        case 'true_false': {
          isCorrect = userAnswer === q.correctAnswer;
          correctAnswerText = q.correctAnswer ? 'True' : 'False';
          correctAnswerValue = q.correctAnswer;
          break;
        }
        case 'ordering': {
          const userOrder = Array.isArray(userAnswer) ? userAnswer : [];
          const expected = q.correctOrder || [];
          isCorrect = userOrder.length === expected.length &&
            userOrder.every((item, idx) => item === expected[idx]);
          correctAnswerText = expected.join(' → ');
          correctAnswerValue = expected;
          break;
        }
      }

      if (isCorrect) correct++;

      return {
        questionId: q._id,
        question: q.question,
        type: qType,
        userAnswer,
        correctAnswer: correctAnswerValue,
        correctAnswerText,
        isCorrect,
        explanation: q.explanation || null
      };
    });

    const score = material.quiz.length > 0 ? Math.round((correct / material.quiz.length) * 100) : 0;

    const currentAttempts = material.stats.quizAttempts || 0;
    const currentAvg = material.stats.averageScore || 0;
    const newAvg = currentAttempts > 0
      ? ((currentAvg * currentAttempts) + score) / (currentAttempts + 1)
      : score;

    await TutorMaterial.findByIdAndUpdate(req.params.id, {
      $inc: { 'stats.quizAttempts': 1 },
      $set: { 'stats.averageScore': Math.round(newAvg) }
    });

    // Persist per-student progress (MaterialProgress)
    try {
      const questionResults = results.map(r => ({
        questionId: r.questionId,
        correct: r.isCorrect,
        attempts: 1
      }));
      const isCompleted = score >= 70;
      let xpForAttempt = 10;
      if (score === 100) xpForAttempt += 5;

      await MaterialProgress.findOneAndUpdate(
        { studentId: user._id, materialId: material._id },
        {
          $set: {
            language: material.language,
            lastAttemptAt: new Date(),
            questionResults,
            ...(isCompleted ? { completed: true, completedAt: new Date() } : {})
          },
          $inc: { attempts: 1, xpEarned: xpForAttempt },
          $max: { bestScore: score }
        },
        { upsert: true, new: true }
      );
    } catch (progressErr) {
      console.error('⚠️ Error saving material progress:', progressErr);
    }

    res.json({
      success: true,
      score,
      totalQuestions: material.quiz.length,
      correctCount: correct,
      results
    });
  } catch (error) {
    console.error('Error submitting quiz:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ── POST /api/materials/:id/report — Report a problem with a material ────

router.post('/:id/report', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const material = await TutorMaterial.findById(req.params.id);
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    if (material.tutorId.toString() === user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot report your own material' });
    }

    const existing = await MaterialReport.findOne({
      materialId: material._id,
      studentId: user._id,
      status: { $in: ['open', 'under_review'] }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have an open report for this material' });
    }

    const { reason, details, copyrightDetails } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Reason is required' });
    }

    const purchase = await MaterialPurchase.findOne({
      studentId: user._id,
      materialId: material._id,
      status: 'completed'
    });

    const hasCompletedQuiz = material.stats?.quizAttempts > 0;

    const reportDoc = {
      materialId: material._id,
      studentId: user._id,
      tutorId: material.tutorId,
      reason,
      details: details || '',
      purchaseId: purchase?._id || null,
      hasPurchased: !!purchase,
      hasCompletedQuiz
    };

    if (reason === 'copyright_infringement' && copyrightDetails) {
      reportDoc.copyrightDetails = {
        originalContentUrl: copyrightDetails.originalContentUrl || '',
        ownerName: copyrightDetails.ownerName || '',
        ownerContact: copyrightDetails.ownerContact || ''
      };
    }

    const report = await MaterialReport.create(reportDoc);

    res.json({ success: true, report });
  } catch (error) {
    console.error('Error creating material report:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
