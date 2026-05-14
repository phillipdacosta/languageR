/**
 * Appends LOGIN.SIGNING_IN, LOGIN.ERROR_TITLE, LOGIN.REDIRECT_FAILED after
 * HERO_BUBBLE_CIAO in each locale JSON (before ERRORS or TABS). Run once:
 *   cd language-learning-app && node scripts/patch-login-overlay-i18n.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const i18nDir = path.join(__dirname, '..', 'src', 'assets', 'i18n');

/** @type {Record<string, { SIGNING_IN: string; ERROR_TITLE: string; REDIRECT_FAILED: string }>} */
const OVERLAY = {
  en: {
    SIGNING_IN: 'Signing you in…',
    ERROR_TITLE: 'Error',
    REDIRECT_FAILED: 'Login failed. Please try again.',
  },
  es: {
    SIGNING_IN: 'Iniciando sesión…',
    ERROR_TITLE: 'Error',
    REDIRECT_FAILED: 'No se pudo iniciar sesión. Inténtalo de nuevo.',
  },
  fr: {
    SIGNING_IN: 'Connexion en cours…',
    ERROR_TITLE: 'Erreur',
    REDIRECT_FAILED: 'Échec de la connexion. Veuillez réessayer.',
  },
  de: {
    SIGNING_IN: 'Anmeldung läuft…',
    ERROR_TITLE: 'Fehler',
    REDIRECT_FAILED: 'Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.',
  },
  pt: {
    SIGNING_IN: 'A iniciar sessão…',
    ERROR_TITLE: 'Erro',
    REDIRECT_FAILED: 'Falha ao iniciar sessão. Tente novamente.',
  },
  it: {
    SIGNING_IN: 'Accesso in corso…',
    ERROR_TITLE: 'Errore',
    REDIRECT_FAILED: 'Accesso non riuscito. Riprova.',
  },
  ru: {
    SIGNING_IN: 'Выполняется вход…',
    ERROR_TITLE: 'Ошибка',
    REDIRECT_FAILED: 'Не удалось войти. Попробуйте снова.',
  },
  zh: {
    SIGNING_IN: '正在登录…',
    ERROR_TITLE: '错误',
    REDIRECT_FAILED: '登录失败，请重试。',
  },
  ja: {
    SIGNING_IN: 'ログインしています…',
    ERROR_TITLE: 'エラー',
    REDIRECT_FAILED: 'ログインに失敗しました。もう一度お試しください。',
  },
  ko: {
    SIGNING_IN: '로그인 중…',
    ERROR_TITLE: '오류',
    REDIRECT_FAILED: '로그인에 실패했습니다. 다시 시도해 주세요.',
  },
  ar: {
    SIGNING_IN: 'جارٍ تسجيل الدخول…',
    ERROR_TITLE: 'خطأ',
    REDIRECT_FAILED: 'فشل تسجيل الدخول. يُرجى المحاولة مرة أخرى.',
  },
  hi: {
    SIGNING_IN: 'साइन इन हो रहा है…',
    ERROR_TITLE: 'त्रुटि',
    REDIRECT_FAILED: 'लॉग इन विफल। कृपया पुनः प्रयास करें।',
  },
  nl: {
    SIGNING_IN: 'Bezig met aanmelden…',
    ERROR_TITLE: 'Fout',
    REDIRECT_FAILED: 'Aanmelden mislukt. Probeer het opnieuw.',
  },
  pl: {
    SIGNING_IN: 'Logowanie…',
    ERROR_TITLE: 'Błąd',
    REDIRECT_FAILED: 'Logowanie nie powiodło się. Spróbuj ponownie.',
  },
  tr: {
    SIGNING_IN: 'Giriş yapılıyor…',
    ERROR_TITLE: 'Hata',
    REDIRECT_FAILED: 'Giriş başarısız. Lütfen tekrar deneyin.',
  },
  sv: {
    SIGNING_IN: 'Loggar in…',
    ERROR_TITLE: 'Fel',
    REDIRECT_FAILED: 'Inloggningen misslyckades. Försök igen.',
  },
  no: {
    SIGNING_IN: 'Logger deg inn…',
    ERROR_TITLE: 'Feil',
    REDIRECT_FAILED: 'Innlogging mislyktes. Prøv igjen.',
  },
  da: {
    SIGNING_IN: 'Logger dig ind…',
    ERROR_TITLE: 'Fejl',
    REDIRECT_FAILED: 'Login mislykkedes. Prøv igen.',
  },
  fi: {
    SIGNING_IN: 'Kirjaudutaan…',
    ERROR_TITLE: 'Virhe',
    REDIRECT_FAILED: 'Kirjautuminen epäonnistui. Yritä uudelleen.',
  },
  el: {
    SIGNING_IN: 'Σύνδεση σε εξέλιξη…',
    ERROR_TITLE: 'Σφάλμα',
    REDIRECT_FAILED: 'Η σύνδεση απέτυχε. Δοκιμάστε ξανά.',
  },
  cs: {
    SIGNING_IN: 'Přihlašování…',
    ERROR_TITLE: 'Chyba',
    REDIRECT_FAILED: 'Přihlášení se nezdařilo. Zkuste to znovu.',
  },
  ro: {
    SIGNING_IN: 'Se conectează…',
    ERROR_TITLE: 'Eroare',
    REDIRECT_FAILED: 'Conectarea a eșuat. Încearcă din nou.',
  },
  uk: {
    SIGNING_IN: 'Виконується вхід…',
    ERROR_TITLE: 'Помилка',
    REDIRECT_FAILED: 'Не вдалося увійти. Спробуйте ще раз.',
  },
  vi: {
    SIGNING_IN: 'Đang đăng nhập…',
    ERROR_TITLE: 'Lỗi',
    REDIRECT_FAILED: 'Đăng nhập thất bại. Vui lòng thử lại.',
  },
  th: {
    SIGNING_IN: 'กำลังเข้าสู่ระบบ…',
    ERROR_TITLE: 'ข้อผิดพลาด',
    REDIRECT_FAILED: 'เข้าสู่ระบบไม่สำเร็จ โปรดลองอีกครั้ง',
  },
  id: {
    SIGNING_IN: 'Sedang masuk…',
    ERROR_TITLE: 'Kesalahan',
    REDIRECT_FAILED: 'Gagal masuk. Silakan coba lagi.',
  },
  ms: {
    SIGNING_IN: 'Sedang log masuk…',
    ERROR_TITLE: 'Ralat',
    REDIRECT_FAILED: 'Log masuk gagal. Sila cuba lagi.',
  },
  he: {
    SIGNING_IN: 'מתחבר…',
    ERROR_TITLE: 'שגיאה',
    REDIRECT_FAILED: 'ההתחברות נכשלה. נסה שוב.',
  },
  fa: {
    SIGNING_IN: 'در حال ورود…',
    ERROR_TITLE: 'خطا',
    REDIRECT_FAILED: 'ورود ناموفق بود. دوباره تلاش کنید.',
  },
};

const re = /\n    "HERO_BUBBLE_CIAO": ("(?:[^"\\]|\\.)*")\n  \},\n  "(ERRORS|TABS)":/;

for (const file of fs.readdirSync(i18nDir)) {
  if (!file.endsWith('.json')) continue;
  const code = file.replace(/\.json$/, '');
  const pack = OVERLAY[code];
  if (!pack) continue;

  const fp = path.join(i18nDir, file);
  let text = fs.readFileSync(fp, 'utf8');
  if (text.includes('"SIGNING_IN"')) {
    console.log('skip', code);
    continue;
  }
  const ins = `,\n    "SIGNING_IN": ${JSON.stringify(pack.SIGNING_IN)},\n    "ERROR_TITLE": ${JSON.stringify(pack.ERROR_TITLE)},\n    "REDIRECT_FAILED": ${JSON.stringify(pack.REDIRECT_FAILED)}`;
  const next = text.replace(re, `\n    "HERO_BUBBLE_CIAO": $1${ins}\n  },\n  "$2":`);
  if (next === text) {
    console.error('pattern not found', code);
    process.exit(1);
  }
  fs.writeFileSync(fp, next, 'utf8');
  console.log('patched', code);
}
