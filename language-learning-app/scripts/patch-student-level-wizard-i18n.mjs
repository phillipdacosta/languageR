/**
 * Localizes student onboarding level step (step 5):
 * - ONBOARDING.STUDENT.LEVEL_WIZARD_TITLE / LEVEL_WIZARD_SUBTITLE
 * - ONBOARDING.STUDENT.LEVEL_OPTION_* (card titles; LEVEL_DESC_* patched separately)
 *
 * Run: node scripts/patch-student-level-wizard-i18n.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, '../src/assets/i18n');

/** @type {Record<string, Record<string, string>>} */
const T = {
  ar: {
    LEVEL_WIZARD_TITLE: 'أين أنت الآن؟',
    LEVEL_WIZARD_SUBTITLE: 'لا ضغط — هذا يساعدنا فقط على البدء من المكان المناسب لك.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'مبتدئ تماماً',
    LEVEL_OPTION_SOME_BASICS: 'أعرف بعض الأساسيات',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'أستطيع إجراء محادثات بسيطة',
    LEVEL_OPTION_INTERMEDIATE: 'مستوى متوسط',
    LEVEL_OPTION_ADVANCED: 'مستوى متقدم',
  },
  cs: {
    LEVEL_WIZARD_TITLE: 'Kde teď jste?',
    LEVEL_WIZARD_SUBTITLE: 'Žádný stres — jen nám to pomůže začít na správném místě.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Úplný začátečník',
    LEVEL_OPTION_SOME_BASICS: 'Znám základy',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Zvládnu jednoduché konverzace',
    LEVEL_OPTION_INTERMEDIATE: 'Středně pokročilý',
    LEVEL_OPTION_ADVANCED: 'Pokročilý',
  },
  da: {
    LEVEL_WIZARD_TITLE: 'Hvor er du nu?',
    LEVEL_WIZARD_SUBTITLE: 'Ingen pres — det hjælper os bare med at starte dig det rigtige sted.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Helt nybegynder',
    LEVEL_OPTION_SOME_BASICS: 'Jeg kan lidt grundlæggende',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Jeg kan føre enkle samtaler',
    LEVEL_OPTION_INTERMEDIATE: 'Mellemniveau',
    LEVEL_OPTION_ADVANCED: 'Avanceret',
  },
  de: {
    LEVEL_WIZARD_TITLE: 'Wo stehst du jetzt?',
    LEVEL_WIZARD_SUBTITLE: 'Kein Druck — das hilft uns nur, richtig für dich einzusteigen.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Kompletter Anfänger',
    LEVEL_OPTION_SOME_BASICS: 'Ich kenne die Grundlagen',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Ich kann einfache Gespräche führen',
    LEVEL_OPTION_INTERMEDIATE: 'Mittlere Stufe',
    LEVEL_OPTION_ADVANCED: 'Fortgeschritten',
  },
  el: {
    LEVEL_WIZARD_TITLE: 'Πού βρίσκεσαι τώρα;',
    LEVEL_WIZARD_SUBTITLE: 'Χωρίς πίεση — μας βοηθάει απλώς να ξεκινήσουμε από το σωστό σημείο.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Απόλυτος αρχάριος',
    LEVEL_OPTION_SOME_BASICS: 'Ξέρω τα βασικά',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Μπορώ να κάνω απλές συνομιλίες',
    LEVEL_OPTION_INTERMEDIATE: 'Ενδιάμεσο επίπεδο',
    LEVEL_OPTION_ADVANCED: 'Προχωρημένο επίπεδο',
  },
  es: {
    LEVEL_WIZARD_TITLE: '¿En qué punto estás?',
    LEVEL_WIZARD_SUBTITLE: 'Sin presión — solo nos ayuda a empezar en el lugar adecuado.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Principiante absoluto',
    LEVEL_OPTION_SOME_BASICS: 'Conozco lo básico',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Puedo mantener conversaciones sencillas',
    LEVEL_OPTION_INTERMEDIATE: 'Nivel intermedio',
    LEVEL_OPTION_ADVANCED: 'Nivel avanzado',
  },
  fa: {
    LEVEL_WIZARD_TITLE: 'الان کجایید؟',
    LEVEL_WIZARD_SUBTITLE: 'بدون فشار — فقط به ما کمک می‌کند از نقطهٔ درست شروع کنیم.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'کاملاً مبتدی',
    LEVEL_OPTION_SOME_BASICS: 'مقدمات را می‌دانم',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'می‌توانم مکالمه‌های ساده داشته باشم',
    LEVEL_OPTION_INTERMEDIATE: 'سطح متوسط',
    LEVEL_OPTION_ADVANCED: 'سطح پیشرفته',
  },
  fi: {
    LEVEL_WIZARD_TITLE: 'Missä tasolla olet nyt?',
    LEVEL_WIZARD_SUBTITLE: 'Ei paineita — tämä auttaa meitä vain aloittamaan oikeasta kohdasta.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Täysin aloittelija',
    LEVEL_OPTION_SOME_BASICS: 'Tiedän perusasiat',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Pystyn yksinkertaisiin keskusteluihin',
    LEVEL_OPTION_INTERMEDIATE: 'Keskitaso',
    LEVEL_OPTION_ADVANCED: 'Edistynyt',
  },
  fr: {
    LEVEL_WIZARD_TITLE: 'Où en êtes-vous ?',
    LEVEL_WIZARD_SUBTITLE: 'Aucune pression — cela nous aide simplement à commencer au bon niveau.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Débutant complet',
    LEVEL_OPTION_SOME_BASICS: 'Je connais quelques bases',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Je peux tenir des conversations simples',
    LEVEL_OPTION_INTERMEDIATE: 'Niveau intermédiaire',
    LEVEL_OPTION_ADVANCED: 'Niveau avancé',
  },
  he: {
    LEVEL_WIZARD_TITLE: 'איפה אתם עכשיו?',
    LEVEL_WIZARD_SUBTITLE: 'בלי לחץ — זה רק עוזר לנו להתחיל אותך מהמקום הנכון.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'מתחילים לגמרי',
    LEVEL_OPTION_SOME_BASICS: 'אני מכיר/ה את הבסיס',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'אני יכול/ה לשמור על שיחות פשוטות',
    LEVEL_OPTION_INTERMEDIATE: 'רמת ביניים',
    LEVEL_OPTION_ADVANCED: 'רמה מתקדמת',
  },
  hi: {
    LEVEL_WIZARD_TITLE: 'अभी आप कहाँ हैं?',
    LEVEL_WIZARD_SUBTITLE: 'कोई दबाव नहीं — यह हमें बस सही जगह से शुरू करने में मदद करता है।',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'पूर्ण शुरुआती',
    LEVEL_OPTION_SOME_BASICS: 'मुझे कुछ बुनियादी आता है',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'मैं सरल बातचीत कर सकता/सकती हूँ',
    LEVEL_OPTION_INTERMEDIATE: 'मध्यम स्तर',
    LEVEL_OPTION_ADVANCED: 'उन्नत स्तर',
  },
  id: {
    LEVEL_WIZARD_TITLE: 'Di mana posisimu sekarang?',
    LEVEL_WIZARD_SUBTITLE: 'Tanpa tekanan — ini hanya membantu kami memulai dari titik yang tepat.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Benar-benar pemula',
    LEVEL_OPTION_SOME_BASICS: 'Saya tahu dasar-dasarnya',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Saya bisa percakapan sederhana',
    LEVEL_OPTION_INTERMEDIATE: 'Menengah',
    LEVEL_OPTION_ADVANCED: 'Lanjutan',
  },
  it: {
    LEVEL_WIZARD_TITLE: 'A che punto sei?',
    LEVEL_WIZARD_SUBTITLE: 'Nessuna pressione — ci aiuta solo a iniziare dal livello giusto.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Principiante assoluto',
    LEVEL_OPTION_SOME_BASICS: 'Conosco le basi',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'So sostenere conversazioni semplici',
    LEVEL_OPTION_INTERMEDIATE: 'Livello intermedio',
    LEVEL_OPTION_ADVANCED: 'Livello avanzato',
  },
  ja: {
    LEVEL_WIZARD_TITLE: '今のレベルは？',
    LEVEL_WIZARD_SUBTITLE: 'プレッシャーは不要です。適切なスタート地点を知るための質問です。',
    LEVEL_OPTION_COMPLETE_BEGINNER: '完全な初心者',
    LEVEL_OPTION_SOME_BASICS: '基礎は少しわかる',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: '簡単な会話はできる',
    LEVEL_OPTION_INTERMEDIATE: '中級レベル',
    LEVEL_OPTION_ADVANCED: '上級レベル',
  },
  ko: {
    LEVEL_WIZARD_TITLE: '지금 어느 정도인가요?',
    LEVEL_WIZARD_SUBTITLE: '부담 없이 답해 주세요. 시작 수준을 맞추는 데만 쓰입니다.',
    LEVEL_OPTION_COMPLETE_BEGINNER: '완전 초보',
    LEVEL_OPTION_SOME_BASICS: '기초는 알고 있어요',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: '간단한 대화는 할 수 있어요',
    LEVEL_OPTION_INTERMEDIATE: '중급',
    LEVEL_OPTION_ADVANCED: '고급',
  },
  ms: {
    LEVEL_WIZARD_TITLE: 'Di manakah anda sekarang?',
    LEVEL_WIZARD_SUBTITLE: 'Tiada tekanan — ini hanya membantu kami mulakan anda di tempat yang betul.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Pemula sepenuhnya',
    LEVEL_OPTION_SOME_BASICS: 'Saya tahu asas',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Saya boleh berbual ringkas',
    LEVEL_OPTION_INTERMEDIATE: 'Pertengahan',
    LEVEL_OPTION_ADVANCED: 'Lanjutan',
  },
  nl: {
    LEVEL_WIZARD_TITLE: 'Waar sta je nu?',
    LEVEL_WIZARD_SUBTITLE: 'Geen druk — dit helpt ons alleen om je op de juiste plek te laten starten.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Volledige beginner',
    LEVEL_OPTION_SOME_BASICS: 'Ik ken de basis',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Ik kan eenvoudige gesprekken voeren',
    LEVEL_OPTION_INTERMEDIATE: 'Gemiddeld niveau',
    LEVEL_OPTION_ADVANCED: 'Gevorderd',
  },
  no: {
    LEVEL_WIZARD_TITLE: 'Hvor er du nå?',
    LEVEL_WIZARD_SUBTITLE: 'Ingen press — dette hjelper oss bare å starte deg på riktig sted.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Helt nybegynner',
    LEVEL_OPTION_SOME_BASICS: 'Jeg kan litt grunnleggende',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Jeg kan føre enkle samtaler',
    LEVEL_OPTION_INTERMEDIATE: 'Mellomnivå',
    LEVEL_OPTION_ADVANCED: 'Avansert',
  },
  pl: {
    LEVEL_WIZARD_TITLE: 'Na jakim jesteś etapie?',
    LEVEL_WIZARD_SUBTITLE: 'Bez presji — to tylko pomaga nam zacząć we właściwym miejscu.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Kompletny początkujący',
    LEVEL_OPTION_SOME_BASICS: 'Znam podstawy',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Potrafię prowadzić proste rozmowy',
    LEVEL_OPTION_INTERMEDIATE: 'Poziom średni',
    LEVEL_OPTION_ADVANCED: 'Poziom zaawansowany',
  },
  pt: {
    LEVEL_WIZARD_TITLE: 'Em que ponto está?',
    LEVEL_WIZARD_SUBTITLE: 'Sem pressão — isto só nos ajuda a começar no sítio certo.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Principiante absoluto',
    LEVEL_OPTION_SOME_BASICS: 'Sei o básico',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Consigo manter conversas simples',
    LEVEL_OPTION_INTERMEDIATE: 'Nível intermédio',
    LEVEL_OPTION_ADVANCED: 'Nível avançado',
  },
  ro: {
    LEVEL_WIZARD_TITLE: 'Unde ești acum?',
    LEVEL_WIZARD_SUBTITLE: 'Fără presiune — ne ajută doar să începem de la nivelul potrivit.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Începător complet',
    LEVEL_OPTION_SOME_BASICS: 'Știu câteva elemente de bază',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Pot purta conversații simple',
    LEVEL_OPTION_INTERMEDIATE: 'Nivel intermediar',
    LEVEL_OPTION_ADVANCED: 'Nivel avansat',
  },
  ru: {
    LEVEL_WIZARD_TITLE: 'На каком вы сейчас уровне?',
    LEVEL_WIZARD_SUBTITLE: 'Без спешки — это просто помогает нам начать с нужной точки.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Полный новичок',
    LEVEL_OPTION_SOME_BASICS: 'Знаю немного основ',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Могу вести простые беседы',
    LEVEL_OPTION_INTERMEDIATE: 'Средний уровень',
    LEVEL_OPTION_ADVANCED: 'Продвинутый уровень',
  },
  sv: {
    LEVEL_WIZARD_TITLE: 'Var är du nu?',
    LEVEL_WIZARD_SUBTITLE: 'Ingen press — det hjälper oss bara att starta dig på rätt nivå.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Hel nybörjare',
    LEVEL_OPTION_SOME_BASICS: 'Jag kan grunderna',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Jag kan föra enkla samtal',
    LEVEL_OPTION_INTERMEDIATE: 'Mellannivå',
    LEVEL_OPTION_ADVANCED: 'Avancerad',
  },
  th: {
    LEVEL_WIZARD_TITLE: 'ตอนนี้คุณอยู่ระดับไหน?',
    LEVEL_WIZARD_SUBTITLE: 'ไม่มีแรงกดดัน — แค่ช่วยให้เราเริ่มต้นจุดที่เหมาะกับคุณ',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'เริ่มต้นใหม่ทั้งหมด',
    LEVEL_OPTION_SOME_BASICS: 'รู้พื้นฐานบ้าง',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'สนทนาง่ายๆ ได้',
    LEVEL_OPTION_INTERMEDIATE: 'ระดับกลาง',
    LEVEL_OPTION_ADVANCED: 'ระดับสูง',
  },
  tr: {
    LEVEL_WIZARD_TITLE: 'Şu an neredesin?',
    LEVEL_WIZARD_SUBTITLE: 'Baskı yok — bu sadece doğru yerden başlamana yardım eder.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Tamamen yeni başlayan',
    LEVEL_OPTION_SOME_BASICS: 'Temelleri biliyorum',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Basit sohbetler edebiliyorum',
    LEVEL_OPTION_INTERMEDIATE: 'Orta seviye',
    LEVEL_OPTION_ADVANCED: 'İleri seviye',
  },
  uk: {
    LEVEL_WIZARD_TITLE: 'Де ви зараз?',
    LEVEL_WIZARD_SUBTITLE: 'Без тиску — це лише допомагає нам почати з правильного рівня.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Повний початківець',
    LEVEL_OPTION_SOME_BASICS: 'Знаю основи',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Можу вести прості розмови',
    LEVEL_OPTION_INTERMEDIATE: 'Середній рівень',
    LEVEL_OPTION_ADVANCED: 'Просунутий рівень',
  },
  vi: {
    LEVEL_WIZARD_TITLE: 'Bạn đang ở mức nào?',
    LEVEL_WIZARD_SUBTITLE: 'Không áp lực — chỉ giúp chúng tôi bắt đầu đúng chỗ cho bạn.',
    LEVEL_OPTION_COMPLETE_BEGINNER: 'Hoàn toàn mới bắt đầu',
    LEVEL_OPTION_SOME_BASICS: 'Tôi biết một chút căn bản',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: 'Tôi có thể trò chuyện đơn giản',
    LEVEL_OPTION_INTERMEDIATE: 'Trung cấp',
    LEVEL_OPTION_ADVANCED: 'Nâng cao',
  },
  zh: {
    LEVEL_WIZARD_TITLE: '你目前的水平？',
    LEVEL_WIZARD_SUBTITLE: '没有压力——只是帮助我们为你选择合适的起点。',
    LEVEL_OPTION_COMPLETE_BEGINNER: '零基础',
    LEVEL_OPTION_SOME_BASICS: '懂一些基础',
    LEVEL_OPTION_SIMPLE_CONVERSATIONS: '能进行简单对话',
    LEVEL_OPTION_INTERMEDIATE: '中级水平',
    LEVEL_OPTION_ADVANCED: '高级水平',
  },
};

let files = 0;
for (const file of fs.readdirSync(i18nDir)) {
  if (!file.endsWith('.json') || file === 'en.json') continue;
  const code = file.replace(/\.json$/, '');
  const pack = T[code];
  if (!pack) {
    console.warn('No level wizard strings for', code);
    continue;
  }
  const p = path.join(i18nDir, file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const st = j.ONBOARDING?.STUDENT;
  if (!st) continue;
  Object.assign(st, pack);
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
  files++;
}
console.log('Patched level wizard strings in', files, 'locale files');
