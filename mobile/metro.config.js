const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const exts = config.resolver.assetExts ?? [];
config.resolver = {
  ...config.resolver,
  assetExts: exts.includes('lottie') ? exts : [...exts, 'lottie'],
};

module.exports = config;
