const mongoose = require('mongoose');

const BundleItemSchema = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, ref: 'TutorMaterial', required: true },
  sortOrder: { type: Number, default: 0 }
}, { _id: false });

const ContentBundleSchema = new mongoose.Schema({
  tutorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  coverImageUrl: { type: String },
  language: { type: String, required: true },
  level: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'any'],
    default: 'any'
  },
  structuredTags: [{ type: String, trim: true, lowercase: true }],
  items: [BundleItemSchema],
  pricingType: {
    type: String,
    enum: ['free', 'paid'],
    default: 'free'
  },
  price: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },
  stats: {
    views: { type: Number, default: 0 },
    purchases: { type: Number, default: 0 }
  }
}, { timestamps: true });

ContentBundleSchema.index({ tutorId: 1, status: 1 });
ContentBundleSchema.index({ language: 1, level: 1, status: 1 });
ContentBundleSchema.index({ structuredTags: 1, status: 1 });

module.exports = mongoose.model('ContentBundle', ContentBundleSchema);
