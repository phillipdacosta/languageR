const express = require('express');
const router = express.Router();
const ContentBundle = require('../models/ContentBundle');
const BundlePurchase = require('../models/BundlePurchase');
const TutorMaterial = require('../models/TutorMaterial');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { verifyToken, getUserFromRequest, uploadImage } = require('../middleware/videoUploadMiddleware');
const { Storage } = require('@google-cloud/storage');

// ── POST /api/bundles — Create bundle ───────────────────────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.userType !== 'tutor') return res.status(403).json({ success: false, message: 'Tutors only' });

    const { title, description, language, level, structuredTags, items, pricingType, price, status } = req.body;

    if (!title || !language) {
      return res.status(400).json({ success: false, message: 'Title and language are required' });
    }

    if (pricingType === 'paid' && (!price || price <= 0)) {
      return res.status(400).json({ success: false, message: 'Paid bundles require a price > 0' });
    }

    if (items && items.length > 0) {
      const materialIds = items.map(i => i.materialId);
      const owned = await TutorMaterial.countDocuments({
        _id: { $in: materialIds },
        tutorId: user._id,
        status: { $ne: 'deleted' }
      });
      if (owned !== materialIds.length) {
        return res.status(400).json({ success: false, message: 'All items must be your own published materials' });
      }
    }

    const bundle = await ContentBundle.create({
      tutorId: user._id,
      title,
      description,
      language,
      level: level || 'any',
      structuredTags: structuredTags || [],
      items: (items || []).map((item, i) => ({ materialId: item.materialId, sortOrder: item.sortOrder ?? i })),
      pricingType: pricingType || 'free',
      price: pricingType === 'paid' ? price : 0,
      status: status || 'draft'
    });

    res.status(201).json({ success: true, bundle });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create bundle' });
  }
});

// ── GET /api/bundles/my — Tutor's bundles ───────────────────────────
router.get('/my', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const bundles = await ContentBundle.find({ tutorId: user._id, status: { $ne: 'archived' } })
      .populate('items.materialId', 'title materialType thumbnailUrl status pricingType price')
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ success: true, bundles });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch bundles' });
  }
});

// ── GET /api/bundles/my-purchases — Student's purchased bundles ─────
router.get('/my-purchases', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const purchases = await BundlePurchase.find({ studentId: user._id, status: 'completed' })
      .populate({
        path: 'bundleId',
        populate: { path: 'items.materialId', select: 'title materialType thumbnailUrl' }
      })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, purchases });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch purchases' });
  }
});

// ── GET /api/bundles/browse — Browse/search bundles ─────────────────
router.get('/browse', async (req, res) => {
  try {
    const { language, level, tags, search, sort, page, limit: lim } = req.query;
    const filter = { status: 'published' };

    if (language) filter.language = language;
    if (level && level !== 'any') filter.level = level;
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : tags.split(',');
      filter.structuredTags = { $in: tagArray };
    }
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    let sortObj = { createdAt: -1 };
    if (sort === 'popular') sortObj = { 'stats.purchases': -1 };
    else if (sort === 'price-low') sortObj = { price: 1 };
    else if (sort === 'price-high') sortObj = { price: -1 };

    const pageNum = parseInt(page) || 1;
    const perPage = Math.min(parseInt(lim) || 20, 50);
    const skip = (pageNum - 1) * perPage;

    const [bundles, total] = await Promise.all([
      ContentBundle.find(filter)
        .populate('tutorId', 'name picture')
        .populate('items.materialId', 'title materialType thumbnailUrl')
        .sort(sortObj)
        .skip(skip)
        .limit(perPage)
        .lean(),
      ContentBundle.countDocuments(filter)
    ]);

    res.json({
      success: true,
      bundles,
      pagination: { page: pageNum, perPage, total, totalPages: Math.ceil(total / perPage) }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to browse bundles' });
  }
});

// ── GET /api/bundles/tutor/:tutorId — Public bundles for tutor ──────
router.get('/tutor/:tutorId', async (req, res) => {
  try {
    const bundles = await ContentBundle.find({
      tutorId: req.params.tutorId,
      status: 'published'
    })
      .populate('items.materialId', 'title materialType thumbnailUrl')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, bundles });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch bundles' });
  }
});

// ── GET /api/bundles/recommended/:language — Tag-matched recs ───────
router.get('/recommended/:language', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const LessonAnalysis = require('../models/LessonAnalysis');
    const language = req.params.language;

    const recentAnalyses = await LessonAnalysis.find({
      studentId: user._id,
      language,
      status: 'completed'
    }).sort({ createdAt: -1 }).limit(5).lean();

    const ContentTag = require('../models/ContentTag');
    const allTags = await ContentTag.find({ active: true }).lean();
    const tagLabelMap = {};
    allTags.forEach(tag => {
      const labels = [];
      if (tag.labels) {
        const labelsObj = tag.labels instanceof Map ? Object.fromEntries(tag.labels) : tag.labels;
        for (const label of Object.values(labelsObj)) {
          labels.push(label.toLowerCase());
        }
      }
      tagLabelMap[tag.tagId] = labels;
    });

    const studentTags = new Set();
    const struggleKeywords = new Set();
    for (const a of recentAnalyses) {
      if (a.structuredTags) a.structuredTags.forEach(t => studentTags.add(t));
      if (a.topics) a.topics.forEach(t => studentTags.add(t.toLowerCase()));
      (a.topErrors || []).forEach(e => { if (e.issue) struggleKeywords.add(e.issue.toLowerCase().trim()); });
      (a.errorPatterns || []).forEach(p => { if (p.pattern) struggleKeywords.add(p.pattern.toLowerCase().trim()); });
    }

    for (const keyword of struggleKeywords) {
      const words = keyword.split(/\s+/);
      for (const [tagId, labels] of Object.entries(tagLabelMap)) {
        if (labels.some(label => words.some(w => label.includes(w) || w.includes(label)))) {
          studentTags.add(tagId);
        }
      }
    }

    if (studentTags.size === 0) {
      const bundles = await ContentBundle.find({ language, status: 'published' })
        .populate('tutorId', 'name picture')
        .populate('items.materialId', 'title materialType thumbnailUrl')
        .sort({ 'stats.purchases': -1 })
        .limit(10)
        .lean();
      return res.json({ success: true, bundles, matchType: 'popular' });
    }

    const tagArray = Array.from(studentTags);
    const bundles = await ContentBundle.find({
      language,
      status: 'published',
      structuredTags: { $in: tagArray }
    })
      .populate('tutorId', 'name picture')
      .populate('items.materialId', 'title materialType thumbnailUrl')
      .lean();

    const purchased = await BundlePurchase.find({ studentId: user._id }).select('bundleId').lean();
    const purchasedIds = new Set(purchased.map(p => p.bundleId.toString()));

    const scored = bundles
      .filter(b => !purchasedIds.has(b._id.toString()))
      .map(b => {
        const matchCount = (b.structuredTags || []).filter(t => studentTags.has(t)).length;
        return { ...b, _score: matchCount };
      })
      .sort((a, b) => b._score - a._score)
      .slice(0, 10);

    res.json({ success: true, bundles: scored, matchType: 'tags' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get recommendations' });
  }
});

// ── GET /api/bundles/:id — Single bundle ────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const bundle = await ContentBundle.findById(req.params.id)
      .populate('tutorId', 'name picture')
      .populate('items.materialId', 'title description materialType thumbnailUrl pricingType price language level stats')
      .lean();

    if (!bundle || bundle.status === 'archived') {
      return res.status(404).json({ success: false, message: 'Bundle not found' });
    }

    let purchased = false;
    try {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        const user = await getUserFromRequest(req);
        if (user) {
          const purchase = await BundlePurchase.findOne({ studentId: user._id, bundleId: bundle._id, status: 'completed' });
          purchased = !!purchase;
        }
      }
    } catch (e) {
      // Unauthenticated access is allowed
    }

    bundle.purchased = purchased;

    if (bundle.status === 'draft') {
      try {
        const user = await getUserFromRequest(req);
        if (!user || user._id.toString() !== bundle.tutorId._id.toString()) {
          return res.status(404).json({ success: false, message: 'Bundle not found' });
        }
      } catch (e) {
        return res.status(404).json({ success: false, message: 'Bundle not found' });
      }
    }

    await ContentBundle.findByIdAndUpdate(bundle._id, { $inc: { 'stats.views': 1 } });

    res.json({ success: true, bundle });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch bundle' });
  }
});

// ── PUT /api/bundles/:id — Update bundle ────────────────────────────
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const bundle = await ContentBundle.findById(req.params.id);
    if (!bundle) return res.status(404).json({ success: false, message: 'Bundle not found' });
    if (bundle.tutorId.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not your bundle' });
    }

    const allowedFields = ['title', 'description', 'coverImageUrl', 'language', 'level', 'structuredTags', 'items', 'pricingType', 'price', 'status'];
    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }

    if (update.items) {
      const materialIds = update.items.map(i => i.materialId);
      const owned = await TutorMaterial.countDocuments({
        _id: { $in: materialIds },
        tutorId: user._id,
        status: { $ne: 'deleted' }
      });
      if (owned !== materialIds.length) {
        return res.status(400).json({ success: false, message: 'All items must be your own materials' });
      }
    }

    if (update.pricingType === 'paid' && update.price !== undefined && update.price <= 0) {
      return res.status(400).json({ success: false, message: 'Paid bundles require price > 0' });
    }

    const updated = await ContentBundle.findByIdAndUpdate(bundle._id, { $set: update }, { new: true })
      .populate('items.materialId', 'title materialType thumbnailUrl status pricingType price');

    res.json({ success: true, bundle: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update bundle' });
  }
});

// ── DELETE /api/bundles/:id — Archive bundle ────────────────────────
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const bundle = await ContentBundle.findById(req.params.id);
    if (!bundle) return res.status(404).json({ success: false, message: 'Bundle not found' });
    if (bundle.tutorId.toString() !== user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not your bundle' });
    }

    bundle.status = 'archived';
    await bundle.save();

    res.json({ success: true, message: 'Bundle archived' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to delete bundle' });
  }
});

// ── POST /api/bundles/:id/purchase — Purchase bundle ────────────────
router.post('/:id/purchase', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const bundle = await ContentBundle.findById(req.params.id).populate('tutorId', 'stripeConnectAccountId stripeConnectOnboarded');
    if (!bundle || bundle.status !== 'published') {
      return res.status(404).json({ success: false, message: 'Bundle not found' });
    }

    if (bundle.pricingType !== 'paid') {
      return res.status(400).json({ success: false, message: 'This bundle is free' });
    }

    if (bundle.tutorId._id.toString() === user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You own this bundle' });
    }

    const alreadyPurchased = await BundlePurchase.findOne({
      studentId: user._id, bundleId: bundle._id, status: 'completed'
    });
    if (alreadyPurchased) {
      return res.status(400).json({ success: false, message: 'Already purchased' });
    }

    const { stripePaymentMethodId } = req.body;
    if (!stripePaymentMethodId) {
      return res.status(400).json({ success: false, message: 'Payment method required' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const amount = Math.round(bundle.price * 100);

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
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        type: 'bundle_purchase',
        bundleId: bundle._id.toString(),
        studentId: user._id.toString(),
        tutorId: bundle.tutorId._id.toString()
      }
    };

    const tutor = bundle.tutorId;
    if (tutor.stripeConnectAccountId && tutor.stripeConnectOnboarded) {
      const platformFee = Math.round(amount * 0.20);
      paymentIntentParams.application_fee_amount = platformFee;
      paymentIntentParams.transfer_data = { destination: tutor.stripeConnectAccountId };
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    if (paymentIntent.status === 'succeeded') {
      await BundlePurchase.create({
        studentId: user._id,
        bundleId: bundle._id,
        tutorId: bundle.tutorId._id,
        amount: bundle.price,
        currency: 'usd',
        stripePaymentIntentId: paymentIntent.id,
        status: 'completed'
      });

      const platformFee = Math.round(amount * 0.20);
      const tutorPayout = (amount - platformFee) / 100;

      await Payment.create({
        userId: user._id,
        studentId: user._id,
        tutorId: bundle.tutorId._id,
        amount: bundle.price,
        currency: 'USD',
        paymentMethod: 'card',
        status: 'succeeded',
        stripePaymentIntentId: paymentIntent.id,
        platformFee: platformFee / 100,
        platformFeePercentage: 20,
        tutorPayout,
        paymentType: 'bundle_purchase',
        revenueRecognized: true,
        revenueRecognizedAt: new Date(),
        transferStatus: 'available',
        earningsReleaseDate: new Date(),
        metadata: {
          bundleTitle: bundle.title,
          bundleItemCount: bundle.items.length
        }
      });

      await ContentBundle.findByIdAndUpdate(bundle._id, { $inc: { 'stats.purchases': 1 } });

      return res.json({ success: true, message: 'Purchase successful' });
    }

    res.status(400).json({ success: false, message: 'Payment not completed', status: paymentIntent.status });
  } catch (error) {
    if (error.type === 'StripeCardError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Purchase failed' });
  }
});

// ── POST /api/bundles/upload-cover — Upload cover image ─────────────
const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT_KEY || '{}')
});
const bucket = storage.bucket(process.env.GCP_BUCKET_NAME || 'barnabi-uploads');

router.post('/upload-cover', verifyToken, uploadImage.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const fileName = `bundle-covers/${user._id}-${Date.now()}-${req.file.originalname}`;
    const blob = bucket.file(fileName);
    const blobStream = blob.createWriteStream({
      resumable: false,
      metadata: { contentType: req.file.mimetype }
    });

    await new Promise((resolve, reject) => {
      blobStream.on('error', reject);
      blobStream.on('finish', resolve);
      blobStream.end(req.file.buffer);
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    res.json({ success: true, url: publicUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
});

module.exports = router;
