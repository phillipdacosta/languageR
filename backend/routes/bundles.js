const express = require('express');
const router = express.Router();
const ContentBundle = require('../models/ContentBundle');
const BundlePurchase = require('../models/BundlePurchase');
const BundleView = require('../models/BundleView');
const TutorMaterial = require('../models/TutorMaterial');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { verifyToken, getUserFromRequest, uploadImage } = require('../middleware/videoUploadMiddleware');
const { initializeGCS } = require('../config/gcs');

// ── POST /api/bundles — Create bundle ───────────────────────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.userType !== 'tutor') return res.status(403).json({ success: false, message: 'Tutors only' });

    const { title, description, coverImageUrl, language, level, structuredTags, items, pricingType, price, status } = req.body;

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
      coverImageUrl: coverImageUrl || undefined,
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

// ── POST /api/bundles/upload-cover — Upload cover image ─────────────
router.post('/upload-cover', verifyToken, uploadImage.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const { bucket } = initializeGCS();
    if (!bucket) {
      return res.status(503).json({ success: false, message: 'Storage not configured' });
    }

    const user = await getUserFromRequest(req);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    const ext = req.file.originalname.split('.').pop();
    const fileName = `bundle-covers/${user._id}/${timestamp}-${rand}.${ext}`;

    const file = bucket.file(fileName);
    const stream = file.createWriteStream({
      metadata: { contentType: req.file.mimetype, cacheControl: 'public, max-age=31536000' }
    });

    stream.on('error', (err) => {
      console.error('Cover upload error:', err?.message);
      res.status(500).json({ success: false, message: 'Upload failed' });
    });
    stream.on('finish', async () => {
      await file.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      res.json({ success: true, url: publicUrl });
    });

    stream.end(req.file.buffer);
  } catch (error) {
    console.error('Cover upload error:', error);
    res.status(500).json({ success: false, message: 'Upload failed' });
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
        .populate('tutorId', 'name firstName lastName picture bio')
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
        .populate('tutorId', 'name firstName lastName picture bio')
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
      .populate('tutorId', 'name firstName lastName picture bio')
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
      .populate('tutorId', 'name firstName lastName picture bio country residenceCountry nativeLanguage onboardingData stats')
      .populate('items.materialId', 'title description materialType thumbnailUrl pricingType price language level stats')
      .lean();

    if (!bundle || bundle.status === 'archived') {
      return res.status(404).json({ success: false, message: 'Bundle not found' });
    }

    let user = null;
    try {
      const token = req.headers.authorization?.split(' ')[1];
      if (token) user = await getUserFromRequest(req);
    } catch (e) {}

    const isOwner = user && bundle.tutorId._id.toString() === user._id.toString();

    if (bundle.status === 'draft' && !isOwner) {
      return res.status(404).json({ success: false, message: 'Bundle not found' });
    }

    let purchased = false;
    if (user && !isOwner) {
      const purchase = await BundlePurchase.findOne({ studentId: user._id, bundleId: bundle._id, status: 'completed' });
      purchased = !!purchase;

      try {
        await BundleView.create({ bundleId: bundle._id, userId: user._id });
        await ContentBundle.findByIdAndUpdate(bundle._id, { $inc: { 'stats.views': 1 } });
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }

    bundle.purchased = purchased;
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
    // Charge in the buyer's local currency; ledger stays USD (bundle.price)
    const paymentService = require('../services/paymentService');
    const bundleCharge = await paymentService.resolveCharge(user, bundle.price);
    const amount = Math.round(bundleCharge.chargeAmount * 100); // charge currency cents

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
      currency: bundleCharge.chargeCurrency,
      customer: customerId,
      payment_method: stripePaymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        type: 'bundle_purchase',
        bundleId: bundle._id.toString(),
        studentId: user._id.toString(),
        tutorId: bundle.tutorId._id.toString(),
        usdAmount: bundle.price.toString(),
        chargeCurrency: bundleCharge.chargeCurrency,
        fxRate: String(bundleCharge.fxRate)
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

      // Ledger amounts in USD (anchor); the Stripe application fee above is in
      // the charge currency, but our records track USD.
      const platformFeeUsd = Math.round(bundle.price * 0.20 * 100) / 100;
      const tutorPayout = Math.round((bundle.price - platformFeeUsd) * 100) / 100;

      await Payment.create({
        userId: user._id,
        studentId: user._id,
        tutorId: bundle.tutorId._id,
        amount: bundle.price,
        currency: 'USD',
        chargeCurrency: bundleCharge.chargeCurrency,
        chargeAmount: bundleCharge.chargeAmount,
        fxRate: bundleCharge.fxRate,
        fxBuffer: bundleCharge.fxBuffer,
        paymentMethod: 'card',
        status: 'succeeded',
        stripePaymentIntentId: paymentIntent.id,
        platformFee: platformFeeUsd,
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

module.exports = router;
