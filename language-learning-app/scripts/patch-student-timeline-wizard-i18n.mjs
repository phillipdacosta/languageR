/**
 * Student onboarding timeline step (step 6) + custom goal field labels:
 * - TIMELINE_WIZARD_TITLE / TIMELINE_WIZARD_SUBTITLE
 * - TIMELINE_OPTION_SPECIFIC_DATE / FEW_MONTHS / NO_RUSH
 * - CUSTOM_GOAL_LABEL / CUSTOM_GOAL_PLACEHOLDER
 *
 * Run: node scripts/patch-student-timeline-wizard-i18n.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, '../src/assets/i18n');

/** @type {Record<string, Record<string, string>>} */
const T = {
  ar: {
    TIMELINE_WIZARD_TITLE: 'هل لديك تاريخ مستهدف؟',
    TIMELINE_WIZARD_SUBTITLE: 'يساعدنا على ضبط وتيرة خطتك. يمكنك تغييره لاحقاً في أي وقت.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'بحلول تاريخ محدد',
    TIMELINE_OPTION_FEW_MONTHS: 'خلال بضعة أشهر',
    TIMELINE_OPTION_NO_RUSH: 'بلا عجلة — تقدم ثابت',
    CUSTOM_GOAL_LABEL: 'صف هدفك',
    CUSTOM_GOAL_PLACEHOLDER: 'مثال: التحدث مع عائلة شريكي، التحضير لسفر…',
  },
  cs: {
    TIMELINE_WIZARD_TITLE: 'Máte cílové datum?',
    TIMELINE_WIZARD_SUBTITLE: 'Pomůže nám nastavit tempo plánu. Kdykoli to později změníte.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Do konkrétního data',
    TIMELINE_OPTION_FEW_MONTHS: 'Během několika měsíců',
    TIMELINE_OPTION_NO_RUSH: 'Bez spěchu — klidný pokrok',
    CUSTOM_GOAL_LABEL: 'Popište svůj cíl',
    CUSTOM_GOAL_PLACEHOLDER: 'např. mluvit s rodinou partnera, připravit se na cestu…',
  },
  da: {
    TIMELINE_WIZARD_TITLE: 'Har du en måldato?',
    TIMELINE_WIZARD_SUBTITLE: 'Det hjælper os med at sætte tempoet i din plan. Du kan altid ændre det senere.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Til en bestemt dato',
    TIMELINE_OPTION_FEW_MONTHS: 'Inden for et par måneder',
    TIMELINE_OPTION_NO_RUSH: 'Ingen hast — bare rolig fremgang',
    CUSTOM_GOAL_LABEL: 'Beskriv dit mål',
    CUSTOM_GOAL_PLACEHOLDER: 'f.eks. tale med min partners familie, forberede en rejse…',
  },
  de: {
    TIMELINE_WIZARD_TITLE: 'Hast du ein Zieldatum?',
    TIMELINE_WIZARD_SUBTITLE: 'So können wir deinen Lernplan passend einteilen. Du kannst es später jederzeit ändern.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Bis zu einem bestimmten Datum',
    TIMELINE_OPTION_FEW_MONTHS: 'Innerhalb weniger Monate',
    TIMELINE_OPTION_NO_RUSH: 'Keine Eile — nur stetiger Fortschritt',
    CUSTOM_GOAL_LABEL: 'Beschreibe dein Ziel',
    CUSTOM_GOAL_PLACEHOLDER: 'z. B. mit der Familie meines Partners sprechen, Reise vorbereiten…',
  },
  el: {
    TIMELINE_WIZARD_TITLE: 'Έχεις ημερομηνία-στόχο;',
    TIMELINE_WIZARD_SUBTITLE: 'Μας βοηθά να ρυθμίσουμε το πλάνο σου. Μπορείς πάντα να το αλλάξεις αργότερα.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Μέχρι συγκεκριμένη ημερομηνία',
    TIMELINE_OPTION_FEW_MONTHS: 'Μέσα σε λίγους μήνες',
    TIMELINE_OPTION_NO_RUSH: 'Χωρίς βιασύνη — σταθερή πρόοδος',
    CUSTOM_GOAL_LABEL: 'Περιέγραψε τον στόχο σου',
    CUSTOM_GOAL_PLACEHOLDER: 'π.χ. να μιλάω με την οικογένεια του/της συντρόφου μου, προετοιμασία για ταξίδι…',
  },
  es: {
    TIMELINE_WIZARD_TITLE: '¿Tienes una fecha objetivo?',
    TIMELINE_WIZARD_SUBTITLE: 'Nos ayuda a marcar el ritmo de tu plan. Siempre podrás cambiarlo.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Para una fecha concreta',
    TIMELINE_OPTION_FEW_MONTHS: 'En unos meses',
    TIMELINE_OPTION_NO_RUSH: 'Sin prisa, avance constante',
    CUSTOM_GOAL_LABEL: 'Describe tu objetivo',
    CUSTOM_GOAL_PLACEHOLDER: 'p. ej., hablar con la familia de mi pareja, preparar un viaje al extranjero…',
  },
  fa: {
    TIMELINE_WIZARD_TITLE: 'تاریخ هدف دارید؟',
    TIMELINE_WIZARD_SUBTITLE: 'به ما کمک می‌کند برنامه را با سرعت مناسب تنظیم کنیم. بعداً هم می‌توانید تغییر دهید.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'تا تاریخ مشخص',
    TIMELINE_OPTION_FEW_MONTHS: 'در چند ماه آینده',
    TIMELINE_OPTION_NO_RUSH: 'بدون عجله — پیشرفت مداوم',
    CUSTOM_GOAL_LABEL: 'هدف خود را توضیح دهید',
    CUSTOM_GOAL_PLACEHOLDER: 'مثلاً صحبت با خانوادهٔ همسر، آماده‌شدن برای سفر…',
  },
  fi: {
    TIMELINE_WIZARD_TITLE: 'Onko sinulla tavoitepäivä?',
    TIMELINE_WIZARD_SUBTITLE: 'Auttaa meitä tahdittamaan suunnitelmaa. Voit muuttaa myöhemmin milloin tahansa.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Tiettyyn päivämäärään mennessä',
    TIMELINE_OPTION_FEW_MONTHS: 'Muutaman kuukauden sisällä',
    TIMELINE_OPTION_NO_RUSH: 'Ei kiirettä — tasainen edistyminen',
    CUSTOM_GOAL_LABEL: 'Kuvaile tavoitteesi',
    CUSTOM_GOAL_PLACEHOLDER: 'esim. keskustella puolison perheen kanssa, valmistautua matkaan…',
  },
  fr: {
    TIMELINE_WIZARD_TITLE: 'Avez-vous une date cible ?',
    TIMELINE_WIZARD_SUBTITLE: 'Cela nous aide à cadencer votre plan. Vous pourrez toujours le modifier plus tard.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Pour une date précise',
    TIMELINE_OPTION_FEW_MONTHS: 'Dans quelques mois',
    TIMELINE_OPTION_NO_RUSH: 'Sans précipitation — des progrès réguliers',
    CUSTOM_GOAL_LABEL: 'Décrivez votre objectif',
    CUSTOM_GOAL_PLACEHOLDER: 'ex. parler avec la famille de mon partenaire, préparer un voyage…',
  },
  he: {
    TIMELINE_WIZARD_TITLE: 'יש לך תאריך יעד?',
    TIMELINE_WIZARD_SUBTITLE: 'זה עוזר לנו לקבוע קצב בתוכנית הלמידה. תמיד אפשר לשנות אחר כך.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'עד תאריך מסוים',
    TIMELINE_OPTION_FEW_MONTHS: 'תוך כמה חודשים',
    TIMELINE_OPTION_NO_RUSH: 'בלי לחץ — התקדמות יציבה',
    CUSTOM_GOAL_LABEL: 'תאר/י את המטרה שלך',
    CUSTOM_GOAL_PLACEHOLDER: 'למשל לדבר עם משפחת בן/בת הזוג, להתכונן לנסיעה…',
  },
  hi: {
    TIMELINE_WIZARD_TITLE: 'क्या आपके पास लक्ष्य तिथि है?',
    TIMELINE_WIZARD_SUBTITLE: 'इससे हम आपकी योजना की गति तय कर सकते हैं। बाद में कभी भी बदल सकते हैं।',
    TIMELINE_OPTION_SPECIFIC_DATE: 'एक निश्चित तिथि तक',
    TIMELINE_OPTION_FEW_MONTHS: 'कुछ महीनों में',
    TIMELINE_OPTION_NO_RUSH: 'बिना जल्दबाजी — स्थिर प्रगति',
    CUSTOM_GOAL_LABEL: 'अपना लक्ष्य लिखें',
    CUSTOM_GOAL_PLACEHOLDER: 'जैसे, साथी के परिवार से बात करना, यात्रा की तैयारी…',
  },
  id: {
    TIMELINE_WIZARD_TITLE: 'Apakah Anda punya tanggal target?',
    TIMELINE_WIZARD_SUBTITLE: 'Membantu kami mengatur ritme rencana belajar. Bisa diubah kapan saja nanti.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Pada tanggal tertentu',
    TIMELINE_OPTION_FEW_MONTHS: 'Dalam beberapa bulan',
    TIMELINE_OPTION_NO_RUSH: 'Tanpa terburu — progres stabil',
    CUSTOM_GOAL_LABEL: 'Jelaskan tujuan Anda',
    CUSTOM_GOAL_PLACEHOLDER: 'mis. ngobrol dengan keluarga pasangan, persiapan traveling…',
  },
  it: {
    TIMELINE_WIZARD_TITLE: 'Hai una data obiettivo?',
    TIMELINE_WIZARD_SUBTITLE: 'Ci aiuta a impostare il ritmo del piano. Potrai sempre modificarlo in seguito.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Entro una data precisa',
    TIMELINE_OPTION_FEW_MONTHS: 'Entro alcuni mesi',
    TIMELINE_OPTION_NO_RUSH: 'Senza fretta — progressi costanti',
    CUSTOM_GOAL_LABEL: 'Descrivi il tuo obiettivo',
    CUSTOM_GOAL_PLACEHOLDER: 'es. parlare con la famiglia del partner, preparare un viaggio…',
  },
  ja: {
    TIMELINE_WIZARD_TITLE: '目標の日はありますか？',
    TIMELINE_WIZARD_SUBTITLE: '学習プランのペース決めに役立ちます。あとからいつでも変更できます。',
    TIMELINE_OPTION_SPECIFIC_DATE: '具体的な日までに',
    TIMELINE_OPTION_FEW_MONTHS: '数か月以内',
    TIMELINE_OPTION_NO_RUSH: '急がず — 着実に進める',
    CUSTOM_GOAL_LABEL: '目標を書いてください',
    CUSTOM_GOAL_PLACEHOLDER: '例：パートナーの家族と話したい、旅行の準備…',
  },
  ko: {
    TIMELINE_WIZARD_TITLE: '목표 날짜가 있나요?',
    TIMELINE_WIZARD_SUBTITLE: '학습 계획의 속도를 맞추는 데 도움이 됩니다. 나중에 언제든 바꿀 수 있어요.',
    TIMELINE_OPTION_SPECIFIC_DATE: '특정 날짜까지',
    TIMELINE_OPTION_FEW_MONTHS: '몇 달 안에',
    TIMELINE_OPTION_NO_RUSH: '천천히 — 꾸준히',
    CUSTOM_GOAL_LABEL: '목표를 적어 주세요',
    CUSTOM_GOAL_PLACEHOLDER: '예: 배우자 가족과 이야기하기, 여행 준비…',
  },
  ms: {
    TIMELINE_WIZARD_TITLE: 'Adakah anda ada tarikh sasaran?',
    TIMELINE_WIZARD_SUBTITLE: 'Ia membantu kami mengatur rentak pelan pembelajaran. Boleh ditukar kemudian.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Menjelang tarikh tertentu',
    TIMELINE_OPTION_FEW_MONTHS: 'Dalam beberapa bulan',
    TIMELINE_OPTION_NO_RUSH: 'Tanpa tergesa — kemajuan stabil',
    CUSTOM_GOAL_LABEL: 'Terangkan matlamat anda',
    CUSTOM_GOAL_PLACEHOLDER: 'cth. berbual dengan keluarga pasangan, bersedia untuk perjalanan…',
  },
  nl: {
    TIMELINE_WIZARD_TITLE: 'Heb je een streefdatum?',
    TIMELINE_WIZARD_SUBTITLE: 'Zo kunnen we je plan goed doseren. Je kunt het later altijd aanpassen.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Tegen een bepaalde datum',
    TIMELINE_OPTION_FEW_MONTHS: 'Binnen een paar maanden',
    TIMELINE_OPTION_NO_RUSH: 'Geen haast — stabiele vooruitgang',
    CUSTOM_GOAL_LABEL: 'Beschrijf je doel',
    CUSTOM_GOAL_PLACEHOLDER: 'bijv. praten met de familie van mijn partner, reis voorbereiden…',
  },
  no: {
    TIMELINE_WIZARD_TITLE: 'Har du en måldato?',
    TIMELINE_WIZARD_SUBTITLE: 'Det hjelper oss å tilpasse tempoet i planen. Du kan alltid endre det senere.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Innen en bestemt dato',
    TIMELINE_OPTION_FEW_MONTHS: 'I løpet av noen måneder',
    TIMELINE_OPTION_NO_RUSH: 'Ingen hast — jevn fremgang',
    CUSTOM_GOAL_LABEL: 'Beskriv målet ditt',
    CUSTOM_GOAL_PLACEHOLDER: 'f.eks. snakke med partnerens familie, forberede en reise…',
  },
  pl: {
    TIMELINE_WIZARD_TITLE: 'Masz datę docelową?',
    TIMELINE_WIZARD_SUBTITLE: 'Pomaga nam ustawić tempo planu. Zawsze możesz to później zmienić.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Do konkretnej daty',
    TIMELINE_OPTION_FEW_MONTHS: 'W ciągu kilku miesięcy',
    TIMELINE_OPTION_NO_RUSH: 'Bez pośpiechu — stały postęp',
    CUSTOM_GOAL_LABEL: 'Opisz swój cel',
    CUSTOM_GOAL_PLACEHOLDER: 'np. rozmawiać z rodziną partnera, przygotować się do podróży…',
  },
  pt: {
    TIMELINE_WIZARD_TITLE: 'Tem uma data alvo?',
    TIMELINE_WIZARD_SUBTITLE: 'Ajuda-nos a marcar o ritmo do plano. Pode mudar mais tarde.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Até uma data específica',
    TIMELINE_OPTION_FEW_MONTHS: 'Dentro de alguns meses',
    TIMELINE_OPTION_NO_RUSH: 'Sem pressa — progresso constante',
    CUSTOM_GOAL_LABEL: 'Descreva o seu objetivo',
    CUSTOM_GOAL_PLACEHOLDER: 'ex.: falar com a família do parceiro, preparar uma viagem…',
  },
  ro: {
    TIMELINE_WIZARD_TITLE: 'Ai o dată țintă?',
    TIMELINE_WIZARD_SUBTITLE: 'Ne ajută să stabilim ritmul planului. O poți schimba oricând mai târziu.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Până la o anumită dată',
    TIMELINE_OPTION_FEW_MONTHS: 'În câteva luni',
    TIMELINE_OPTION_NO_RUSH: 'Fără grabă — progres constant',
    CUSTOM_GOAL_LABEL: 'Descrie obiectivul tău',
    CUSTOM_GOAL_PLACEHOLDER: 'ex.: să vorbesc cu familia partenerului, să mă pregătesc pentru o călătorie…',
  },
  ru: {
    TIMELINE_WIZARD_TITLE: 'Есть ли у вас целевая дата?',
    TIMELINE_WIZARD_SUBTITLE: 'Это помогает задать темп плана. Позже вы всегда сможете изменить.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'К конкретной дате',
    TIMELINE_OPTION_FEW_MONTHS: 'В течение нескольких месяцев',
    TIMELINE_OPTION_NO_RUSH: 'Без спешки — ровный прогресс',
    CUSTOM_GOAL_LABEL: 'Опишите вашу цель',
    CUSTOM_GOAL_PLACEHOLDER: 'напр. говорить с семьёй партнёра, подготовиться к поездке…',
  },
  sv: {
    TIMELINE_WIZARD_TITLE: 'Har du ett måldatum?',
    TIMELINE_WIZARD_SUBTITLE: 'Det hjälper oss att sätta tempot i din plan. Du kan alltid ändra senare.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Till ett visst datum',
    TIMELINE_OPTION_FEW_MONTHS: 'Inom några månader',
    TIMELINE_OPTION_NO_RUSH: 'Ingen brådska — stadig framsteg',
    CUSTOM_GOAL_LABEL: 'Beskriv ditt mål',
    CUSTOM_GOAL_PLACEHOLDER: 't.ex. prata med partnerns familj, förbereda en resa…',
  },
  th: {
    TIMELINE_WIZARD_TITLE: 'มีวันที่เป้าหมายไหม?',
    TIMELINE_WIZARD_SUBTITLE: 'ช่วยให้เรากำหนดจังหวะแผนการเรียน เปลี่ยนทีหลังได้เสมอ',
    TIMELINE_OPTION_SPECIFIC_DATE: 'ภายในวันที่กำหนด',
    TIMELINE_OPTION_FEW_MONTHS: 'ภายในไม่กี่เดือน',
    TIMELINE_OPTION_NO_RUSH: 'ไม่รีบ — ค่อยเป็นค่อยไป',
    CUSTOM_GOAL_LABEL: 'อธิบายเป้าหมายของคุณ',
    CUSTOM_GOAL_PLACEHOLDER: 'เช่น พูดคุยกับครอบครัวคู่รัก เตรียมตัวไปเที่ยว…',
  },
  tr: {
    TIMELINE_WIZARD_TITLE: 'Hedef tarihin var mı?',
    TIMELINE_WIZARD_SUBTITLE: 'Öğrenme planının temposunu ayarlamamıza yardımcı olur. Sonradan değiştirebilirsin.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Belirli bir tarihe kadar',
    TIMELINE_OPTION_FEW_MONTHS: 'Birkaç ay içinde',
    TIMELINE_OPTION_NO_RUSH: 'Acele yok — düzenli ilerleme',
    CUSTOM_GOAL_LABEL: 'Hedefini açıkla',
    CUSTOM_GOAL_PLACEHOLDER: 'ör. partnerimin ailesiyle konuşmak, seyahate hazırlanmak…',
  },
  uk: {
    TIMELINE_WIZARD_TITLE: 'Чи є у вас цільова дата?',
    TIMELINE_WIZARD_SUBTITLE: 'Це допомагає задати темп плану. Пізніше ви завжди зможете змінити.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'До конкретної дати',
    TIMELINE_OPTION_FEW_MONTHS: 'За кілька місяців',
    TIMELINE_OPTION_NO_RUSH: 'Без поспіху — рівномірний прогрес',
    CUSTOM_GOAL_LABEL: 'Опишіть вашу ціль',
    CUSTOM_GOAL_PLACEHOLDER: 'наприклад, говорити з родиною партнера, підготуватися до подорожі…',
  },
  vi: {
    TIMELINE_WIZARD_TITLE: 'Bạn có ngày mục tiêu không?',
    TIMELINE_WIZARD_SUBTITLE: 'Giúp chúng tôi điều chỉnh nhịp độ kế hoạch. Bạn có thể đổi sau.',
    TIMELINE_OPTION_SPECIFIC_DATE: 'Trước một ngày cụ thể',
    TIMELINE_OPTION_FEW_MONTHS: 'Trong vài tháng',
    TIMELINE_OPTION_NO_RUSH: 'Không vội — tiến bộ đều đặn',
    CUSTOM_GOAL_LABEL: 'Mô tả mục tiêu của bạn',
    CUSTOM_GOAL_PLACEHOLDER: 'vd. nói chuyện với gia đình đối tác, chuẩn bị đi du lịch…',
  },
  zh: {
    TIMELINE_WIZARD_TITLE: '你有目标日期吗？',
    TIMELINE_WIZARD_SUBTITLE: '帮助我们安排学习节奏。之后随时可以修改。',
    TIMELINE_OPTION_SPECIFIC_DATE: '在特定日期前',
    TIMELINE_OPTION_FEW_MONTHS: '几个月内',
    TIMELINE_OPTION_NO_RUSH: '不着急 — 稳步前进',
    CUSTOM_GOAL_LABEL: '描述你的目标',
    CUSTOM_GOAL_PLACEHOLDER: '例如：和伴侣的家人交流、为出国旅行做准备…',
  },
};

let files = 0;
for (const file of fs.readdirSync(i18nDir)) {
  if (!file.endsWith('.json') || file === 'en.json') continue;
  const code = file.replace(/\.json$/, '');
  const pack = T[code];
  if (!pack) {
    console.warn('No timeline strings for', code);
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
console.log('Patched timeline + custom goal strings in', files, 'locale files');
