/**
 * Localizes student onboarding copy that still reads "Set up your profile" in English:
 * - ONBOARDING.STUDENT.WIZARD_FLOW_TITLE (wizard toolbar)
 * - ONBOARDING.WELCOME_SCREEN.HOW_STEP1 ("How it works" step on welcome)
 * - ONBOARDING.STUDENT.HOW_STEP1 only if present and still English (legacy)
 *
 * Run: node scripts/patch-student-wizard-flow-title-i18n.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, '../src/assets/i18n');

const EN = 'Set up your profile';

/** @type {Record<string, string>} */
const T = {
  ar: 'إعداد ملفك الشخصي',
  cs: 'Nastavte si profil',
  da: 'Opsæt din profil',
  de: 'Profil einrichten',
  el: 'Ρυθμίστε το προφίλ σας',
  es: 'Configura tu perfil',
  fa: 'پروفایل خود را تنظیم کنید',
  fi: 'Aseta profiilisi',
  fr: 'Configurez votre profil',
  he: 'הגדר את הפרופיל שלך',
  hi: 'अपनी प्रोफ़ाइल सेट करें',
  id: 'Siapkan profil Anda',
  it: 'Configura il tuo profilo',
  ja: 'プロフィールを設定',
  ko: '프로필 설정하기',
  ms: 'Sediakan profil anda',
  nl: 'Stel je profiel in',
  no: 'Sett opp profilen din',
  pl: 'Skonfiguruj swój profil',
  pt: 'Configure o seu perfil',
  ro: 'Configurează-ți profilul',
  ru: 'Настройте профиль',
  sv: 'Ställ in din profil',
  th: 'ตั้งค่าโปรไฟล์ของคุณ',
  tr: 'Profilini oluştur',
  uk: 'Налаштуйте профіль',
  vi: 'Thiết lập hồ sơ của bạn',
  zh: '设置个人资料',
};

let files = 0;
for (const file of fs.readdirSync(i18nDir)) {
  if (!file.endsWith('.json') || file === 'en.json') continue;
  const code = file.replace(/\.json$/, '');
  const text = T[code];
  if (!text) {
    console.warn('No title translation for', code);
    continue;
  }
  const p = path.join(i18nDir, file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const st = j.ONBOARDING?.STUDENT;
  const ws = j.ONBOARDING?.WELCOME_SCREEN;
  if (st) {
    st.WIZARD_FLOW_TITLE = text;
    if (st.HOW_STEP1 === EN) {
      st.HOW_STEP1 = text;
    }
  }
  if (ws && ws.HOW_STEP1 === EN) {
    ws.HOW_STEP1 = text;
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
  files++;
}
console.log('Updated STUDENT.WIZARD_FLOW_TITLE (+ STUDENT/WELCOME_SCREEN HOW_STEP1 when English) in', files, 'locale files');
