#!/usr/bin/env node

/**
 * Script to check which country flags are missing
 * Compares FlagService country mappings with existing flag files
 */

const fs = require('fs');
const path = require('path');

const FLAGS_DIR = path.join(__dirname, '../src/assets/flags');
const FLAG_SERVICE_FILE = path.join(__dirname, '../src/app/services/flag.service.ts');

// Read the flag service file to extract country mappings
const flagServiceContent = fs.readFileSync(FLAG_SERVICE_FILE, 'utf8');

// Extract country name to code mappings from the service file
const countryMappings = [];
const mappingRegex = /\[['"]([^'"]+)['"],\s*['"]([a-z]{2})['"]\]/g;
let match;

while ((match = mappingRegex.exec(flagServiceContent)) !== null) {
  countryMappings.push({
    name: match[1],
    code: match[2]
  });
}

// Get list of existing flag files
const existingFlags = new Set();
if (fs.existsSync(FLAGS_DIR)) {
  const files = fs.readdirSync(FLAGS_DIR);
  files.forEach(file => {
    if (file.endsWith('.svg')) {
      existingFlags.add(file.replace('.svg', ''));
    }
  });
}

// Find missing flags
const missingFlags = countryMappings.filter(mapping => !existingFlags.has(mapping.code));

console.log(`\n📊 Flag Status Report\n`);
console.log(`Total countries in FlagService: ${countryMappings.length}`);
console.log(`Existing flag files: ${existingFlags.size}`);
console.log(`Missing flags: ${missingFlags.length}\n`);

if (missingFlags.length > 0) {
  console.log('🚨 Missing Flags:\n');
  missingFlags.forEach(({ name, code }) => {
    console.log(`  - ${name} (${code.toUpperCase()})`);
  });
  
  console.log(`\n📥 To download missing flags, run:\n`);
  console.log(`cd language-learning-app`);
  console.log(`./scripts/download-missing-flags.sh\n`);
  
  // Generate download URLs
  console.log('Or download manually from:');
  missingFlags.forEach(({ name, code }) => {
    console.log(`  curl -o src/assets/flags/${code}.svg https://flagcdn.com/${code}.svg  # ${name}`);
  });
} else {
  console.log('✅ All flags are present!\n');
}

