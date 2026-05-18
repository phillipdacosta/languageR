/**
 * Merges onboarding welcome (partial), language-picker copy, student goal/preview
 * strings, and wizard footer a11y label into every non-en locale.
 *
 * Source packs: scripts/onboarding-welcome-lang-student-packs.json
 * (Generate with: python3 scripts/build_onboarding_welcome_packs.py)
 *
 * Run: node scripts/patch-onboarding-welcome-lang-student-i18n.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, '../src/assets/i18n');
const packsPath = path.join(__dirname, 'onboarding-welcome-lang-student-packs.json');

function expandLangSelect(ls) {
  const out = { CHOOSE_SUBTITLE: ls.sub };
  const rot = ls.rot;
  for (let i = 1; i <= 29; i++) {
    const key = `HEADING_ROTATE_${String(i).padStart(2, '0')}`;
    out[key] = rot[(i - 1) % rot.length];
  }
  return out;
}

const PACKS = JSON.parse(fs.readFileSync(packsPath, 'utf8'));

let n = 0;
for (const file of fs.readdirSync(i18nDir)) {
  if (!file.endsWith('.json') || file === 'en.json') continue;
  const code = file.replace(/\.json$/, '');
  const pack = PACKS[code];
  if (!pack) {
    console.warn('No pack for', code);
    continue;
  }
  const p = path.join(i18nDir, file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.ONBOARDING = j.ONBOARDING || {};
  const ob = j.ONBOARDING;
  ob.WELCOME_SCREEN = ob.WELCOME_SCREEN || {};
  ob.STUDENT = ob.STUDENT || {};
  ob.LANG_SELECT = ob.LANG_SELECT || {};
  if (pack.w) Object.assign(ob.WELCOME_SCREEN, pack.w);
  if (pack.s) Object.assign(ob.STUDENT, pack.s);
  if (pack.ls) Object.assign(ob.LANG_SELECT, expandLangSelect(pack.ls));
  if (pack.a11y) ob.WIZARD_FOOTER_NAV_A11Y = pack.a11y;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
  n++;
}
console.log('Merged onboarding welcome/lang/student patches into', n, 'locale files');
