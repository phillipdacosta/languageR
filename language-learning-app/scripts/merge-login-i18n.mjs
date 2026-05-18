/**
 * Inserts full LOGIN block into locale JSON files that lack it (before first "TABS").
 * Run from `language-learning-app`: `node scripts/merge-login-i18n.mjs`
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const i18nDir = path.join(root, 'src', 'assets', 'i18n');
const dataPath = path.join(__dirname, 'login-translations-extra.json');

function formatLoginBlock(loginObj) {
  const inner = JSON.stringify(loginObj, null, 2);
  const lines = inner.split('\n');
  lines[0] = '  "LOGIN": ' + lines[0];
  for (let i = 1; i < lines.length; i++) {
    lines[i] = '  ' + lines[i];
  }
  return lines.join('\n') + ',';
}

const translations = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const needle = /\n  "TABS": \{/;

for (const [code, block] of Object.entries(translations)) {
  const fp = path.join(i18nDir, `${code}.json`);
  if (!fs.existsSync(fp)) {
    console.error('missing file', fp);
    process.exit(1);
  }
  let text = fs.readFileSync(fp, 'utf8');
  if (/"LOGIN"\s*:\s*\{/.test(text) && text.includes('"CONTINUE_GOOGLE"')) {
    console.log('skip (already has full LOGIN)', code);
    continue;
  }
  if (!needle.test(text)) {
    console.error('no TABS anchor', code);
    process.exit(1);
  }
  const replacement = '\n' + formatLoginBlock(block) + '\n  "TABS": {';
  const newText = text.replace(needle, replacement);
  if (newText === text) {
    console.error('replace failed', code);
    process.exit(1);
  }
  fs.writeFileSync(fp, newText, 'utf8');
  console.log('merged LOGIN →', code);
}
