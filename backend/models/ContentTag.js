const mongoose = require('mongoose');

const ContentTagSchema = new mongoose.Schema({
  tagId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  category: {
    type: String,
    enum: ['grammar', 'vocabulary', 'skills', 'topics'],
    required: true
  },
  parent: {
    type: String,
    default: null,
    trim: true,
    lowercase: true
  },
  labels: {
    type: Map,
    of: String,
    required: true
  },
  depth: {
    type: String,
    enum: ['category', 'subcategory', 'leaf'],
    required: true
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  active: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

ContentTagSchema.index({ category: 1, sortOrder: 1 });
ContentTagSchema.index({ parent: 1, sortOrder: 1 });
ContentTagSchema.index({ active: 1 });

module.exports = mongoose.model('ContentTag', ContentTagSchema);
