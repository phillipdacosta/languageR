/**
 * Ensures every locale (except en) has:
 * - Top-level LEARNING_PLAN.GOAL_LABEL_* (onboarding + set-goal goal cards)
 * - ONBOARDING.STUDENT.GOAL_DESC_* (card subtitles)
 *
 * Run from repo root:
 *   node language-learning-app/scripts/patch-learning-plan-goal-i18n.mjs
 * Or from language-learning-app/:
 *   node scripts/patch-learning-plan-goal-i18n.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, '../src/assets/i18n');

const EN_PLAN = {
  GOAL_LABEL_CONVERSATIONAL: 'Become conversational',
  GOAL_LABEL_EXAM_PREP: 'Prepare for an exam',
  GOAL_LABEL_PROFESSIONAL: 'Use it for work',
  GOAL_LABEL_TRAVEL: 'Travel and get by',
  GOAL_LABEL_RELOCATION: 'Moving to a new country',
  GOAL_LABEL_OTHER: 'Custom goal',
};

/** @type {Record<string, { plan: typeof EN_PLAN; desc: Record<string, string> }>} */
const T = {
  ar: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'أن أتحدث بطلاقة',
      GOAL_LABEL_EXAM_PREP: 'التحضير لامتحان',
      GOAL_LABEL_PROFESSIONAL: 'استخدامها في العمل',
      GOAL_LABEL_TRAVEL: 'السفر والتأقلم',
      GOAL_LABEL_RELOCATION: 'الانتقال لبلد جديد',
      GOAL_LABEL_OTHER: 'هدف مخصص',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'إجراء محادثات طبيعية مع الناطقين الأصليين',
      GOAL_DESC_EXAM_PREP: 'DELF أو DELE أو JLPT أو شهادة أخرى',
      GOAL_DESC_PROFESSIONAL: 'الاجتماعات والبريد والتواصل المهني',
      GOAL_DESC_TRAVEL: 'التنقل بثقة أثناء السفر',
      GOAL_DESC_RELOCATION: 'الاستقرار وتدبير الحياة اليومية في مكان جديد',
      GOAL_DESC_OTHER: 'صف ما تريد تحقيقه بكلماتك',
    },
  },
  cs: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Mluvit plynule',
      GOAL_LABEL_EXAM_PREP: 'Příprava na zkoušku',
      GOAL_LABEL_PROFESSIONAL: 'Používat to v práci',
      GOAL_LABEL_TRAVEL: 'Cestovat a domluvit se',
      GOAL_LABEL_RELOCATION: 'Stěhování do nové země',
      GOAL_LABEL_OTHER: 'Vlastní cíl',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Vést přirozené konverzace s rodilými mluvčími',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT nebo jiná certifikace',
      GOAL_DESC_PROFESSIONAL: 'Schůzky, e-maily a pracovní komunikace',
      GOAL_DESC_TRAVEL: 'Orientovat se při cestování v zahraničí',
      GOAL_DESC_RELOCATION: 'Zabydlet se a zvládnout každodenní život na novém místě',
      GOAL_DESC_OTHER: 'Popište vlastními slovy, čeho chcete dosáhnout',
    },
  },
  da: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Blive samtaleklar',
      GOAL_LABEL_EXAM_PREP: 'Forberede mig til en eksamen',
      GOAL_LABEL_PROFESSIONAL: 'Bruge det på jobbet',
      GOAL_LABEL_TRAVEL: 'Rejse og klare mig',
      GOAL_LABEL_RELOCATION: 'Flytte til et nyt land',
      GOAL_LABEL_OTHER: 'Eget mål',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Føre naturlige samtaler med modersmålstalende',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT eller anden certificering',
      GOAL_DESC_PROFESSIONAL: 'Møder, e-mails og erhvervskommunikation',
      GOAL_DESC_TRAVEL: 'Trygt navigere, når du rejser i udlandet',
      GOAL_DESC_RELOCATION: 'Slå dig til ro og klare hverdagen på et nyt sted',
      GOAL_DESC_OTHER: 'Beskriv med egne ord, hvad du vil opnå',
    },
  },
  de: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Gespräche führen können',
      GOAL_LABEL_EXAM_PREP: 'Auf eine Prüfung vorbereiten',
      GOAL_LABEL_PROFESSIONAL: 'Für die Arbeit nutzen',
      GOAL_LABEL_TRAVEL: 'Reisen und zurechtkommen',
      GOAL_LABEL_RELOCATION: 'Umzug ins Ausland',
      GOAL_LABEL_OTHER: 'Eigenes Ziel',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Natürliche Gespräche mit Muttersprachler:innen führen',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT oder eine andere Zertifizierung',
      GOAL_DESC_PROFESSIONAL: 'Meetings, E-Mails und geschäftliche Kommunikation',
      GOAL_DESC_TRAVEL: 'Selbstbewusst unterwegs sein auf Reisen im Ausland',
      GOAL_DESC_RELOCATION: 'Ankommen und den Alltag an einem neuen Ort meistern',
      GOAL_DESC_OTHER: 'Beschreibe in eigenen Worten, was du erreichen möchtest',
    },
  },
  el: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Να μιλάω φυσικά',
      GOAL_LABEL_EXAM_PREP: 'Προετοιμασία για εξέταση',
      GOAL_LABEL_PROFESSIONAL: 'Για τη δουλειά',
      GOAL_LABEL_TRAVEL: 'Ταξίδι και επικοινωνία',
      GOAL_LABEL_RELOCATION: 'Μετακόμιση σε νέα χώρα',
      GOAL_LABEL_OTHER: 'Προσαρμοσμένος στόχος',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Φυσικές συνομιλίες με φυσικούς ομιλητές',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT ή άλλη πιστοποίηση',
      GOAL_DESC_PROFESSIONAL: 'Συναντήσεις, email και επαγγελματική επικοινωνία',
      GOAL_DESC_TRAVEL: 'Να κινείσαι με σιγουριά όταν ταξιδεύεις στο εξωτερικό',
      GOAL_DESC_RELOCATION: 'Εγκατάσταση και καθημερινή ζωή σε νέο μέρος',
      GOAL_DESC_OTHER: 'Περιγράψτε με δικά σας λόγια τι θέλετε να πετύχετε',
    },
  },
  es: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Hablar con fluidez',
      GOAL_LABEL_EXAM_PREP: 'Preparar un examen',
      GOAL_LABEL_PROFESSIONAL: 'Usarlo en el trabajo',
      GOAL_LABEL_TRAVEL: 'Viajar y desenvolverme',
      GOAL_LABEL_RELOCATION: 'Mudarme a otro país',
      GOAL_LABEL_OTHER: 'Objetivo personalizado',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Mantener conversaciones naturales con hablantes nativos',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT u otra certificación oficial',
      GOAL_DESC_PROFESSIONAL: 'Reuniones, correos y comunicación profesional',
      GOAL_DESC_TRAVEL: 'Moverte con seguridad cuando viajas al extranjero',
      GOAL_DESC_RELOCATION: 'Asentarte y gestionar el día a día en un lugar nuevo',
      GOAL_DESC_OTHER: 'Describe en tus propias palabras lo que quieres lograr',
    },
  },
  fa: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'مکالمه روان',
      GOAL_LABEL_EXAM_PREP: 'آماده شدن برای آزمون',
      GOAL_LABEL_PROFESSIONAL: 'استفاده در کار',
      GOAL_LABEL_TRAVEL: 'سفر و رفع نیازها',
      GOAL_LABEL_RELOCATION: 'مهاجرت به کشور جدید',
      GOAL_LABEL_OTHER: 'هدف سفارشی',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'گفتگوی طبیعی با زبان‌مادری‌ها',
      GOAL_DESC_EXAM_PREP: 'DELF، DELE، JLPT یا گواهی دیگر',
      GOAL_DESC_PROFESSIONAL: 'جلسات، ایمیل و ارتباطات کاری',
      GOAL_DESC_TRAVEL: 'اعتماد به نفس در سفر به خارج',
      GOAL_DESC_RELOCATION: 'ساکن شدن و مدیریت زندگی روزمره در جای جدید',
      GOAL_DESC_OTHER: 'با کلمات خودتان بگویید چه می‌خواهید به دست آورید',
    },
  },
  fi: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Puhua sujuvasti',
      GOAL_LABEL_EXAM_PREP: 'Valmistautua kokeeseen',
      GOAL_LABEL_PROFESSIONAL: 'Käyttää työssä',
      GOAL_LABEL_TRAVEL: 'Matkustaa ja pärjätä',
      GOAL_LABEL_RELOCATION: 'Muutto uuteen maahan',
      GOAL_LABEL_OTHER: 'Oma tavoite',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Luontevia keskusteluja äidinkielen puhujien kanssa',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT tai muu sertifiointi',
      GOAL_DESC_PROFESSIONAL: 'Kokoukset, sähköpostit ja työviestintä',
      GOAL_DESC_TRAVEL: 'Liikkua luottavaisesti ulkomailla matkustaessa',
      GOAL_DESC_RELOCATION: 'Juurtua ja hoitaa arkea uudessa paikassa',
      GOAL_DESC_OTHER: 'Kuvaile omin sanoin, mitä haluat saavuttaa',
    },
  },
  fr: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Tenir des conversations',
      GOAL_LABEL_EXAM_PREP: "Préparer un examen",
      GOAL_LABEL_PROFESSIONAL: 'Pour le travail',
      GOAL_LABEL_TRAVEL: 'Voyager et se débrouiller',
      GOAL_LABEL_RELOCATION: 'Déménager dans un autre pays',
      GOAL_LABEL_OTHER: 'Objectif personnalisé',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Avoir des conversations naturelles avec des locuteurs natifs',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT ou autre certification',
      GOAL_DESC_PROFESSIONAL: 'Réunions, e-mails et communication professionnelle',
      GOAL_DESC_TRAVEL: 'Voyager à l’étranger en toute confiance',
      GOAL_DESC_RELOCATION: "S'installer et gérer le quotidien dans un nouveau lieu",
      GOAL_DESC_OTHER: 'Décrivez avec vos mots ce que vous voulez accomplir',
    },
  },
  he: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'לדבר שוטף',
      GOAL_LABEL_EXAM_PREP: 'להתכונן לבחינה',
      GOAL_LABEL_PROFESSIONAL: 'לשימוש בעבודה',
      GOAL_LABEL_TRAVEL: 'לנסוע ולהסתדר',
      GOAL_LABEL_RELOCATION: 'לעבור למדינה חדשה',
      GOAL_LABEL_OTHER: 'מטרה מותאמת אישית',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'לנהל שיחות טבעיות עם דוברי שפת אם',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT או הסמכה אחרת',
      GOAL_DESC_PROFESSIONAL: 'פגישות, אימיילים ותקשורת עסקית',
      GOAL_DESC_TRAVEL: 'לנווט בביטחון בזמן טיסות לחו"ל',
      GOAL_DESC_RELOCATION: 'להשתלב ולנהל את היום-יום במקום חדש',
      GOAL_DESC_OTHER: 'תארו במילים שלכם מה תרצו להשיג',
    },
  },
  hi: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'बातचीत में सहज होना',
      GOAL_LABEL_EXAM_PREP: 'परीक्षा की तैयारी',
      GOAL_LABEL_PROFESSIONAL: 'काम के लिए उपयोग',
      GOAL_LABEL_TRAVEL: 'यात्रा और चलना-फिरना',
      GOAL_LABEL_RELOCATION: 'नए देश में जाना',
      GOAL_LABEL_OTHER: 'अपना लक्ष्य',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'मातृभाषी वक्ताओं के साथ स्वाभाविक बातचीत',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT या अन्य प्रमाणन',
      GOAL_DESC_PROFESSIONAL: 'मीटिंग, ईमेल और व्यावसायिक संवाद',
      GOAL_DESC_TRAVEL: 'विदेश यात्रा में आत्मविश्वास से पेश आना',
      GOAL_DESC_RELOCATION: 'नए स्थान पर बसना और दिनचर्या संभालना',
      GOAL_DESC_OTHER: 'अपने शब्दों में बताएँ क्या हासिल करना चाहते हैं',
    },
  },
  id: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Bicara lancar',
      GOAL_LABEL_EXAM_PREP: 'Persiapan ujian',
      GOAL_LABEL_PROFESSIONAL: 'Untuk pekerjaan',
      GOAL_LABEL_TRAVEL: 'Bepergian dan cukup mandiri',
      GOAL_LABEL_RELOCATION: 'Pindah ke negara baru',
      GOAL_LABEL_OTHER: 'Tujuan khusus',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Percakapan alami dengan penutur asli',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT, atau sertifikasi lain',
      GOAL_DESC_PROFESSIONAL: 'Rapat, email, dan komunikasi bisnis',
      GOAL_DESC_TRAVEL: 'Percaya diri saat bepergian ke luar negeri',
      GOAL_DESC_RELOCATION: 'Menetap dan mengurus kehidupan sehari-hari di tempat baru',
      GOAL_DESC_OTHER: 'Jelaskan dengan kata-kata Anda sendiri apa yang ingin dicapai',
    },
  },
  it: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Parlare in modo naturale',
      GOAL_LABEL_EXAM_PREP: 'Preparare un esame',
      GOAL_LABEL_PROFESSIONAL: 'Usarlo per lavoro',
      GOAL_LABEL_TRAVEL: 'Viaggiare e destreggiarsi',
      GOAL_LABEL_RELOCATION: 'Trasferirsi in un altro Paese',
      GOAL_LABEL_OTHER: 'Obiettivo personalizzato',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Conversazioni naturali con madrelingua',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT o altra certificazione',
      GOAL_DESC_PROFESSIONAL: 'Riunioni, email e comunicazione professionale',
      GOAL_DESC_TRAVEL: 'Orientarsi con sicurezza viaggiando all’estero',
      GOAL_DESC_RELOCATION: 'Ambientarsi e gestire la vita quotidiana in un nuovo luogo',
      GOAL_DESC_OTHER: 'Descrivi con parole tue cosa vuoi raggiungere',
    },
  },
  ja: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: '会話できるようになる',
      GOAL_LABEL_EXAM_PREP: '試験の準備',
      GOAL_LABEL_PROFESSIONAL: '仕事で使う',
      GOAL_LABEL_TRAVEL: '旅行で困らない',
      GOAL_LABEL_RELOCATION: '新しい国へ移住',
      GOAL_LABEL_OTHER: 'カスタム目標',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'ネイティブと自然な会話ができる',
      GOAL_DESC_EXAM_PREP: 'DELF、DELE、JLPTなどの資格対策',
      GOAL_DESC_PROFESSIONAL: '会議・メール・ビジネスコミュニケーション',
      GOAL_DESC_TRAVEL: '海外旅行でも自信を持って動ける',
      GOAL_DESC_RELOCATION: '新しい土地に定住し日常生活に対応する',
      GOAL_DESC_OTHER: '達成したいことを自分の言葉で書いてください',
    },
  },
  ko: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: '회화가 자연스럽게',
      GOAL_LABEL_EXAM_PREP: '시험 준비',
      GOAL_LABEL_PROFESSIONAL: '업무에 활용',
      GOAL_LABEL_TRAVEL: '여행하며 소통',
      GOAL_LABEL_RELOCATION: '새 나라로 이주',
      GOAL_LABEL_OTHER: '맞춤 목표',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: '원어민과 자연스러운 대화하기',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT 등 자격 준비',
      GOAL_DESC_PROFESSIONAL: '회의, 이메일, 비즈니스 커뮤니케이션',
      GOAL_DESC_TRAVEL: '해외 여행에서 자신 있게 지내기',
      GOAL_DESC_RELOCATION: '새로운 곳에 정착해 일상을 꾸리기',
      GOAL_DESC_OTHER: '직접 문장으로 이루고 싶은 것을 적어 주세요',
    },
  },
  ms: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Bercakap lancar',
      GOAL_LABEL_EXAM_PREP: 'Persediaan peperiksaan',
      GOAL_LABEL_PROFESSIONAL: 'Untuk kerja',
      GOAL_LABEL_TRAVEL: 'Merentas desa dan survive',
      GOAL_LABEL_RELOCATION: 'Pindah ke negara baharu',
      GOAL_LABEL_OTHER: 'Matlamat tersuai',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Perbualan semula jadi dengan penutur jati',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT atau pensijilan lain',
      GOAL_DESC_PROFESSIONAL: 'Mesyuarat, e-mel dan komunikasi perniagaan',
      GOAL_DESC_TRAVEL: 'Yakin ketika melancong ke luar negara',
      GOAL_DESC_RELOCATION: 'Menetap dan mengurus kehidupan harian di tempat baharu',
      GOAL_DESC_OTHER: 'Terangkan dengan perkataan anda sendiri apa yang ingin dicapai',
    },
  },
  nl: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Vloeiend converseren',
      GOAL_LABEL_EXAM_PREP: 'Voorbereiden op een examen',
      GOAL_LABEL_PROFESSIONAL: 'Voor het werk',
      GOAL_LABEL_TRAVEL: 'Reizen en redden',
      GOAL_LABEL_RELOCATION: 'Verhuizen naar een ander land',
      GOAL_LABEL_OTHER: 'Eigen doel',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Natuurlijke gesprekken met moedertaalsprekers',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT of een andere certificering',
      GOAL_DESC_PROFESSIONAL: 'Vergaderingen, e-mails en zakelijke communicatie',
      GOAL_DESC_TRAVEL: 'Zelfverzekerd op reis in het buitenland',
      GOAL_DESC_RELOCATION: 'Inburgeren en het dagelijks leven op een nieuwe plek regelen',
      GOAL_DESC_OTHER: 'Beschrijf in je eigen woorden wat je wilt bereiken',
    },
  },
  no: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Snakke flytende',
      GOAL_LABEL_EXAM_PREP: 'Forberede meg til eksamen',
      GOAL_LABEL_PROFESSIONAL: 'Bruke det på jobben',
      GOAL_LABEL_TRAVEL: 'Reise og klare meg',
      GOAL_LABEL_RELOCATION: 'Flytte til et nytt land',
      GOAL_LABEL_OTHER: 'Eget mål',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Føre naturlige samtaler med morsmålsbrukere',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT eller annen sertifisering',
      GOAL_DESC_PROFESSIONAL: 'Møter, e-post og forretningskommunikasjon',
      GOAL_DESC_TRAVEL: 'Trygt å navigere når du reiser i utlandet',
      GOAL_DESC_RELOCATION: 'Slå rot og håndtere hverdagen på et nytt sted',
      GOAL_DESC_OTHER: 'Beskriv med egne ord hva du vil oppnå',
    },
  },
  pl: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Mówić swobodnie',
      GOAL_LABEL_EXAM_PREP: 'Przygotowanie do egzaminu',
      GOAL_LABEL_PROFESSIONAL: 'Do pracy',
      GOAL_LABEL_TRAVEL: 'Podróże i radzenie sobie',
      GOAL_LABEL_RELOCATION: 'Przeprowadzka do innego kraju',
      GOAL_LABEL_OTHER: 'Własny cel',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Naturalne rozmowy z native speakerami',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT lub inna certyfikacja',
      GOAL_DESC_PROFESSIONAL: 'Spotkania, e-maile i komunikacja biznesowa',
      GOAL_DESC_TRAVEL: 'Pewnie się odnajdywać podczas podróży za granicą',
      GOAL_DESC_RELOCATION: 'Zadomowienie się i codzienne życie w nowym miejscu',
      GOAL_DESC_OTHER: 'Opisz własnymi słowami, co chcesz osiągnąć',
    },
  },
  pt: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Falar com naturalidade',
      GOAL_LABEL_EXAM_PREP: 'Preparar um exame',
      GOAL_LABEL_PROFESSIONAL: 'Usar no trabalho',
      GOAL_LABEL_TRAVEL: 'Viajar e virar-se',
      GOAL_LABEL_RELOCATION: 'Mudar para outro país',
      GOAL_LABEL_OTHER: 'Objetivo personalizado',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Ter conversas naturais com falantes nativos',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT ou outra certificação',
      GOAL_DESC_PROFESSIONAL: 'Reuniões, e-mails e comunicação profissional',
      GOAL_DESC_TRAVEL: 'Orientar-se com confiança ao viajar no estrangeiro',
      GOAL_DESC_RELOCATION: 'Instalar-se e gerir o dia a dia num novo sítio',
      GOAL_DESC_OTHER: 'Descreva com as suas palavras o que quer alcançar',
    },
  },
  ro: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Să vorbesc fluent',
      GOAL_LABEL_EXAM_PREP: 'Pregătire pentru examen',
      GOAL_LABEL_PROFESSIONAL: 'Pentru muncă',
      GOAL_LABEL_TRAVEL: 'Călătorii și descurcare',
      GOAL_LABEL_RELOCATION: 'Mutare într-o țară nouă',
      GOAL_LABEL_OTHER: 'Obiectiv personalizat',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Conversații naturale cu vorbitori nativi',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT sau altă certificare',
      GOAL_DESC_PROFESSIONAL: 'Întâlniri, e-mailuri și comunicare profesională',
      GOAL_DESC_TRAVEL: 'Te descurci cu încredere călătorind în străinătate',
      GOAL_DESC_RELOCATION: 'Te stabilești și gestionezi viața de zi cu zi într-un loc nou',
      GOAL_DESC_OTHER: 'Descrie cu propriile cuvinte ce vrei să realizezi',
    },
  },
  ru: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Свободно говорить',
      GOAL_LABEL_EXAM_PREP: 'Подготовка к экзамену',
      GOAL_LABEL_PROFESSIONAL: 'Для работы',
      GOAL_LABEL_TRAVEL: 'Путешествия и быт',
      GOAL_LABEL_RELOCATION: 'Переезд в другую страну',
      GOAL_LABEL_OTHER: 'Своя цель',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Естественные беседы с носителями языка',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT или другая сертификация',
      GOAL_DESC_PROFESSIONAL: 'Встречи, письма и деловое общение',
      GOAL_DESC_TRAVEL: 'Уверенно ориентироваться в поездках за границу',
      GOAL_DESC_RELOCATION: 'Освоиться и вести быт в новом месте',
      GOAL_DESC_OTHER: 'Опишите своими словами, чего хотите достичь',
    },
  },
  sv: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Prata flytande',
      GOAL_LABEL_EXAM_PREP: 'Förbereda för prov',
      GOAL_LABEL_PROFESSIONAL: 'Använda på jobbet',
      GOAL_LABEL_TRAVEL: 'Resa och klara sig',
      GOAL_LABEL_RELOCATION: 'Flytta till nytt land',
      GOAL_LABEL_OTHER: 'Eget mål',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Naturliga samtal med modersmålstalande',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT eller annan certifiering',
      GOAL_DESC_PROFESSIONAL: 'Möten, mejl och affärskommunikation',
      GOAL_DESC_TRAVEL: 'Känna dig trygg när du reser utomlands',
      GOAL_DESC_RELOCATION: 'Rotna och sköta vardagen på en ny plats',
      GOAL_DESC_OTHER: 'Beskriv med egna ord vad du vill uppnå',
    },
  },
  th: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'สนทนาได้คล่อง',
      GOAL_LABEL_EXAM_PREP: 'เตรียมสอบ',
      GOAL_LABEL_PROFESSIONAL: 'ใช้ในที่ทำงาน',
      GOAL_LABEL_TRAVEL: 'เดินทางและเอาตัวรอด',
      GOAL_LABEL_RELOCATION: 'ย้ายไปต่างประเทศ',
      GOAL_LABEL_OTHER: 'เป้าหมายเฉพาะ',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'สนทนาเป็นธรรมชาติกับเจ้าของภาษา',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT หรือใบรับรองอื่น',
      GOAL_DESC_PROFESSIONAL: 'ประชุม อีเมล และการสื่อสารในธุรกิจ',
      GOAL_DESC_TRAVEL: 'มั่นใจเวลาเดินทางต่างประเทศ',
      GOAL_DESC_RELOCATION: 'ตั้งรกรากและจัดการชีวิตประจำวันในที่ใหม่',
      GOAL_DESC_OTHER: 'อธิบายด้วยคำของคุณว่าอยากบรรลุอะไร',
    },
  },
  tr: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Akıcı konuşmak',
      GOAL_LABEL_EXAM_PREP: 'Sınava hazırlanmak',
      GOAL_LABEL_PROFESSIONAL: 'İşte kullanmak',
      GOAL_LABEL_TRAVEL: 'Seyahat ve idare etmek',
      GOAL_LABEL_RELOCATION: 'Yeni ülkeye taşınmak',
      GOAL_LABEL_OTHER: 'Özel hedef',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Anadili konuşanlarla doğal sohbetler',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT veya başka bir sertifika',
      GOAL_DESC_PROFESSIONAL: 'Toplantılar, e-postalar ve iş iletişimi',
      GOAL_DESC_TRAVEL: 'Yurt dışında güvenle gezinmek',
      GOAL_DESC_RELOCATION: 'Yerleşmek ve yeni yerde günlük hayatı yönetmek',
      GOAL_DESC_OTHER: 'Kendi kelimelerinizle neyi başarmak istediğinizi yazın',
    },
  },
  uk: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Вільно говорити',
      GOAL_LABEL_EXAM_PREP: 'Підготовка до іспиту',
      GOAL_LABEL_PROFESSIONAL: 'Для роботи',
      GOAL_LABEL_TRAVEL: 'Подорожі та побут',
      GOAL_LABEL_RELOCATION: 'Переїзд до іншої країни',
      GOAL_LABEL_OTHER: 'Власна ціль',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Природні розмови з носіями мови',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT або інша сертифікація',
      GOAL_DESC_PROFESSIONAL: 'Зустрічі, листи та ділове спілкування',
      GOAL_DESC_TRAVEL: 'Впевнено орієнтуватися в подорожах за кордон',
      GOAL_DESC_RELOCATION: 'Освоїтися та вести побут у новому місці',
      GOAL_DESC_OTHER: 'Опишіть своїми словами, чого хочете досягти',
    },
  },
  vi: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: 'Giao tiếp trôi chảy',
      GOAL_LABEL_EXAM_PREP: 'Ôn thi',
      GOAL_LABEL_PROFESSIONAL: 'Dùng trong công việc',
      GOAL_LABEL_TRAVEL: 'Du lịch và tự xoay xở',
      GOAL_LABEL_RELOCATION: 'Chuyển đến nước mới',
      GOAL_LABEL_OTHER: 'Mục tiêu tùy chỉnh',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: 'Trò chuyện tự nhiên với người bản ngữ',
      GOAL_DESC_EXAM_PREP: 'DELF, DELE, JLPT hoặc chứng chỉ khác',
      GOAL_DESC_PROFESSIONAL: 'Họp, email và giao tiếp công việc',
      GOAL_DESC_TRAVEL: 'Tự tin khi đi du lịch nước ngoài',
      GOAL_DESC_RELOCATION: 'Ổn định và lo sinh hoạt thường nhật ở nơi mới',
      GOAL_DESC_OTHER: 'Hãy mô tả bằng lời của bạn điều bạn muốn đạt được',
    },
  },
  zh: {
    plan: {
      GOAL_LABEL_CONVERSATIONAL: '流利会话',
      GOAL_LABEL_EXAM_PREP: '备考',
      GOAL_LABEL_PROFESSIONAL: '用于工作',
      GOAL_LABEL_TRAVEL: '旅行与日常沟通',
      GOAL_LABEL_RELOCATION: '移居新国家',
      GOAL_LABEL_OTHER: '自定义目标',
    },
    desc: {
      GOAL_DESC_CONVERSATIONAL: '与母语者自然交谈',
      GOAL_DESC_EXAM_PREP: 'DELF、DELE、JLPT 等考试认证',
      GOAL_DESC_PROFESSIONAL: '会议、邮件与职场沟通',
      GOAL_DESC_TRAVEL: '出国旅行时自信应对',
      GOAL_DESC_RELOCATION: '在新城市安顿并处理日常生活',
      GOAL_DESC_OTHER: '请用自己的话描述想达成的目标',
    },
  },
};

function insertLearningPlanAfterCommon(j, plan) {
  if (j.LEARNING_PLAN && typeof j.LEARNING_PLAN === 'object') {
    Object.assign(j.LEARNING_PLAN, plan);
    return;
  }
  const out = {};
  for (const [k, v] of Object.entries(j)) {
    out[k] = v;
    if (k === 'COMMON') {
      out.LEARNING_PLAN = { ...plan };
    }
  }
  for (const k of Object.keys(j)) {
    delete j[k];
  }
  Object.assign(j, out);
}

let files = 0;
let updatedPlan = 0;
let updatedDesc = 0;

for (const file of fs.readdirSync(i18nDir)) {
  if (!file.endsWith('.json') || file === 'en.json') continue;
  const code = file.replace(/\.json$/, '');
  const pack = T[code];
  if (!pack) {
    console.warn('No translations for locale:', code);
    continue;
  }
  const p = path.join(i18nDir, file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const hadPlan = !!j.LEARNING_PLAN;
  insertLearningPlanAfterCommon(j, pack.plan);
  if (!hadPlan) updatedPlan++;

  const st = j.ONBOARDING?.STUDENT;
  if (!st) {
    console.warn('Missing ONBOARDING.STUDENT:', file);
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
    files++;
    continue;
  }
  for (const [k, v] of Object.entries(pack.desc)) {
    st[k] = v;
    updatedDesc++;
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8');
  files++;
}

console.log('Locales written:', files, '| LEARNING_PLAN inserts:', updatedPlan, '| GOAL_DESC keys set:', updatedDesc);
