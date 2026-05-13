#!/usr/bin/env python3
"""Merge missing HOME.GROWTH and TUTOR_APPROVAL strings used by the profile checklist banner and tutor approval wizard."""
from __future__ import annotations

import json
from pathlib import Path

I18N_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

# Keys must match en.json; values are human translations per locale code (file stem).
TRANSLATIONS: dict[str, dict[str, dict[str, str]]] = {
    "ar": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "أكمل هذه الخطوات لتصبح ملفك الشخصي مرئيًا للطلاب",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "لا يمكنك ضبط أوقات توفرك حتى تكتمل هذه الخطوات",
            "CHECKLIST_IDENTITY": "التحقق من الهوية",
            "CHECKLIST_IDENTITY_PENDING": "التحقق من الهوية (قيد المراجعة)",
            "CHECKLIST_QUALIFICATIONS": "مؤهلات التدريس",
            "CHECKLIST_QUALIFICATIONS_PENDING": "مؤهلات التدريس (قيد المراجعة)",
            "CHECKLIST_TOS": "الشروط والاتفاقية",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "تحقق من هويتك",
            "STEP_IDENTITY_DESC": "حمّل هوية رسمية صادرة عن الحكومة حتى نتمكن من التأكد من شخصك",
            "STEP_IDENTITY_STRIPE_SKIPPED": "ستتحقق Stripe من هويتك أثناء إعداد الدفع — لا حاجة لرفع إضافي.",
            "STEP_QUALIFICATIONS_TITLE": "مؤهلات التدريس",
            "STEP_QUALIFICATIONS_DESC": "حمّل شهادات التدريس وأي مستندات داعمة",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect متاح في {{country}} — ستتلقى مدفوعات سريعة وتلقائية.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect غير متاح في {{country}} بعد، لذا سنوجّه مدفوعاتك عبر PayPal.",
            "CRED_ADDITIONAL_ADD": "إضافة",
        },
    },
    "cs": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Dokončete tyto kroky, aby byl váš profil viditelný pro studenty",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Dostupnost můžete nastavit až po dokončení těchto kroků",
            "CHECKLIST_IDENTITY": "Ověření identity",
            "CHECKLIST_IDENTITY_PENDING": "Ověření identity (čeká na kontrolu)",
            "CHECKLIST_QUALIFICATIONS": "Pedagogické kvalifikace",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Pedagogické kvalifikace (čekají na kontrolu)",
            "CHECKLIST_TOS": "Podmínky a smlouva",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Ověřte svou identitu",
            "STEP_IDENTITY_DESC": "Nahrajte průkaz totožnosti vydaný státem, abychom mohli potvrdit vaši totožnost",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe ověří vaši identitu při nastavení výplat — není potřeba další nahrání.",
            "STEP_QUALIFICATIONS_TITLE": "Pedagogické kvalifikace",
            "STEP_QUALIFICATIONS_DESC": "Nahrajte certifikáty a další podklady",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect je k dispozici v zemi {{country}} — získáte rychlé automatické výplaty.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect v zemi {{country}} zatím není k dispozici, výplaty proto pošleme přes PayPal.",
            "CRED_ADDITIONAL_ADD": "Přidat",
        },
    },
    "da": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Fuldfør disse trin for at blive synlig for elever",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Du kan ikke angive din tilgængelighed, før disse trin er fuldført",
            "CHECKLIST_IDENTITY": "Identitetsbekræftelse",
            "CHECKLIST_IDENTITY_PENDING": "Identitetsbekræftelse (afventer gennemgang)",
            "CHECKLIST_QUALIFICATIONS": "Undervisningskvalifikationer",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Undervisningskvalifikationer (afventer gennemgang)",
            "CHECKLIST_TOS": "Vilkår og aftale",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Bekræft din identitet",
            "STEP_IDENTITY_DESC": "Upload et offentligt udstedt ID, så vi kan bekræfte, hvem du er",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe bekræfter din identitet under opsætning af udbetalinger — ingen ekstra upload nødvendig.",
            "STEP_QUALIFICATIONS_TITLE": "Undervisningskvalifikationer",
            "STEP_QUALIFICATIONS_DESC": "Upload undervisningscertifikater og eventuelle bilag",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect er tilgængelig i {{country}} — du får hurtige, automatiske udbetalinger.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect er endnu ikke tilgængelig i {{country}}, så vi sender dine udbetalinger via PayPal.",
            "CRED_ADDITIONAL_ADD": "Tilføj",
        },
    },
    "de": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Schließe diese Schritte ab, damit Schüler:innen dein Profil sehen können",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Du kannst deine Verfügbarkeit erst festlegen, wenn diese Schritte abgeschlossen sind",
            "CHECKLIST_IDENTITY": "Identitätsprüfung",
            "CHECKLIST_IDENTITY_PENDING": "Identitätsprüfung (Prüfung ausstehend)",
            "CHECKLIST_QUALIFICATIONS": "Lehrqualifikationen",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Lehrqualifikationen (Prüfung ausstehend)",
            "CHECKLIST_TOS": "Bedingungen & Vereinbarung",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Identität bestätigen",
            "STEP_IDENTITY_DESC": "Lade einen amtlichen Ausweis hoch, damit wir deine Identität bestätigen können",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe prüft deine Identität bei der Auszahlungseinrichtung — kein zusätzlicher Upload nötig.",
            "STEP_QUALIFICATIONS_TITLE": "Lehrqualifikationen",
            "STEP_QUALIFICATIONS_DESC": "Lade Lehrzertifikate und unterstützende Dokumente hoch",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect ist in {{country}} verfügbar — du erhältst schnelle, automatische Auszahlungen.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect ist in {{country}} noch nicht verfügbar; Auszahlungen laufen über PayPal.",
            "CRED_ADDITIONAL_ADD": "Hinzufügen",
        },
    },
    "el": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Ολοκληρώστε αυτά τα βήματα για να γίνει ορατό το προφίλ σας στους μαθητές",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Δεν μπορείτε να ορίσετε διαθεσιμότητα μέχρι να ολοκληρωθούν αυτά τα βήματα",
            "CHECKLIST_IDENTITY": "Επαλήθευση ταυτότητας",
            "CHECKLIST_IDENTITY_PENDING": "Επαλήθευση ταυτότητας (σε αναμονή έγκρισης)",
            "CHECKLIST_QUALIFICATIONS": "Διδακτικά προσόντα",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Διδακτικά προσόντα (σε αναμονή έγκρισης)",
            "CHECKLIST_TOS": "Όροι & συμφωνία",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Επαληθεύστε την ταυτότητά σας",
            "STEP_IDENTITY_DESC": "Ανεβάστε επίσημο έγγραφο ταυτότητας για να επιβεβαιώσουμε ποιοι είστε",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Η Stripe θα επαληθεύσει την ταυτότητά σας κατά τη ρύθμιση πληρωμών — δεν απαιτείται επιπλέον μεταφόρτωση.",
            "STEP_QUALIFICATIONS_TITLE": "Διδακτικά προσόντα",
            "STEP_QUALIFICATIONS_DESC": "Ανεβάστε πιστοποιητικά διδασκαλίας και τυχόν συνοδευτικά έγγραφα",
            "METHOD_REASON_STRIPE_COUNTRY": "Το Stripe Connect είναι διαθέσιμο στη χώρα {{country}} — θα λαμβάνετε γρήγορες, αυτόματες πληρωμές.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Το Stripe Connect δεν είναι ακόμη διαθέσιμο στη χώρα {{country}}, οπότε οι πληρωμές σας θα γίνονται μέσω PayPal.",
            "CRED_ADDITIONAL_ADD": "Προσθήκη",
        },
    },
    "es": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Completa estos pasos para que los estudiantes puedan ver tu perfil",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "No puedes configurar tu disponibilidad hasta completar estos pasos",
            "CHECKLIST_IDENTITY": "Verificación de identidad",
            "CHECKLIST_IDENTITY_PENDING": "Verificación de identidad (pendiente de revisión)",
            "CHECKLIST_QUALIFICATIONS": "Cualificaciones docentes",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Cualificaciones docentes (pendiente de revisión)",
            "CHECKLIST_TOS": "Términos y acuerdo",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Verifica tu identidad",
            "STEP_IDENTITY_DESC": "Sube un documento de identidad oficial para que podamos confirmar quién eres",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe verificará tu identidad al configurar los pagos; no hace falta subir nada más.",
            "STEP_QUALIFICATIONS_TITLE": "Cualificaciones docentes",
            "STEP_QUALIFICATIONS_DESC": "Sube certificados de enseñanza y documentos de respaldo",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect está disponible en {{country}}: recibirás pagos rápidos y automáticos.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect aún no está disponible en {{country}}; tus pagos se gestionarán por PayPal.",
            "CRED_ADDITIONAL_ADD": "Añadir",
        },
    },
    "fa": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "این مراحل را تکمیل کنید تا پروفایل‌تان برای زبان‌آموزان دیده شود",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "تا تکمیل این مراحل نمی‌توانید دسترسی‌پذیری را تنظیم کنید",
            "CHECKLIST_IDENTITY": "تأیید هویت",
            "CHECKLIST_IDENTITY_PENDING": "تأیید هویت (در انتظار بررسی)",
            "CHECKLIST_QUALIFICATIONS": "صلاحیت‌های تدریس",
            "CHECKLIST_QUALIFICATIONS_PENDING": "صلاحیت‌های تدریس (در انتظار بررسی)",
            "CHECKLIST_TOS": "شرایط و توافق",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "هویت خود را تأیید کنید",
            "STEP_IDENTITY_DESC": "یک مدرک هویتی دولتی بارگذاری کنید تا بتوانیم هویت شما را تأیید کنیم",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe هنگام راه‌اندازی پرداخت هویت شما را تأیید می‌کند — نیازی به بارگذاری اضافی نیست.",
            "STEP_QUALIFICATIONS_TITLE": "صلاحیت‌های تدریس",
            "STEP_QUALIFICATIONS_DESC": "گواهینامه‌های تدریس و هر سند پشتیبان را بارگذاری کنید",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect در {{country}} در دسترس است — پرداخت‌های سریع و خودکار دریافت می‌کنید.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect هنوز در {{country}} در دسترس نیست؛ پرداخت‌ها از طریق PayPal انجام می‌شود.",
            "CRED_ADDITIONAL_ADD": "افزودن",
        },
    },
    "fi": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Täytä nämä vaiheet, jotta profiilisi näkyy opiskelijoille",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Et voi asettaa saatavuutta ennen kuin nämä vaiheet on suoritettu",
            "CHECKLIST_IDENTITY": "Henkilöllisyyden vahvistus",
            "CHECKLIST_IDENTITY_PENDING": "Henkilöllisyyden vahvistus (odottaa tarkistusta)",
            "CHECKLIST_QUALIFICATIONS": "Opetuspätevyydet",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Opetuspätevyydet (odottavat tarkistusta)",
            "CHECKLIST_TOS": "Ehdot ja sopimus",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Vahvista henkilöllisyytesi",
            "STEP_IDENTITY_DESC": "Lataa viranomaisen myöntämä henkilötodistus, jotta voimme varmistaa henkilöllisyytesi",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe vahvistaa henkilöllisyytesi maksuasetuksissa — erillistä latausta ei tarvita.",
            "STEP_QUALIFICATIONS_TITLE": "Opetuspätevyydet",
            "STEP_QUALIFICATIONS_DESC": "Lataa opetussertifikaatit ja mahdolliset liitteet",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect on käytettävissä maassa {{country}} — saat nopeat automaattiset maksut.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect ei ole vielä saatavilla maassa {{country}}; maksut reititetään PayPalin kautta.",
            "CRED_ADDITIONAL_ADD": "Lisää",
        },
    },
    "fr": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Terminez ces étapes pour que votre profil soit visible des élèves",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Vous ne pouvez pas définir vos disponibilités tant que ces étapes ne sont pas terminées",
            "CHECKLIST_IDENTITY": "Vérification d’identité",
            "CHECKLIST_IDENTITY_PENDING": "Vérification d’identité (en attente de validation)",
            "CHECKLIST_QUALIFICATIONS": "Qualifications d’enseignement",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Qualifications d’enseignement (en attente de validation)",
            "CHECKLIST_TOS": "Conditions et accord",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Vérifiez votre identité",
            "STEP_IDENTITY_DESC": "Téléversez une pièce d’identité officielle afin que nous puissions confirmer votre identité",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe vérifiera votre identité lors de la configuration des paiements — aucun envoi supplémentaire requis.",
            "STEP_QUALIFICATIONS_TITLE": "Qualifications d’enseignement",
            "STEP_QUALIFICATIONS_DESC": "Téléversez vos certifications d’enseignement et tout document justificatif",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect est disponible dans {{country}} — vous recevrez des paiements rapides et automatiques.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect n’est pas encore disponible dans {{country}} ; vos paiements passeront par PayPal.",
            "CRED_ADDITIONAL_ADD": "Ajouter",
        },
    },
    "he": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "השלימו את השלבים האלה כדי שהפרופיל שלכם יהיה גלוי לתלמידים",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "לא ניתן להגדיר זמינות עד להשלמת השלבים האלה",
            "CHECKLIST_IDENTITY": "אימות זהות",
            "CHECKLIST_IDENTITY_PENDING": "אימות זהות (ממתין לבדיקה)",
            "CHECKLIST_QUALIFICATIONS": "הסמכות הוראה",
            "CHECKLIST_QUALIFICATIONS_PENDING": "הסמכות הוראה (ממתינות לבדיקה)",
            "CHECKLIST_TOS": "תנאים והסכם",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "אמתו את הזהות שלכם",
            "STEP_IDENTITY_DESC": "העלו תעודה מזהה רשמית כדי שנוכל לאשר מי אתם",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe יאמת את הזהות שלכם בהגדרת התשלומים — אין צורך בהעלאה נוספת.",
            "STEP_QUALIFICATIONS_TITLE": "הסמכות הוראה",
            "STEP_QUALIFICATIONS_DESC": "העלו תעודות הוראה ומסמכים תומכים",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect זמין ב-{{country}} — תקבלו תשלומים מהירים ואוטומטיים.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect עדיין לא זמין ב-{{country}}; ננתב את התשלומים דרך PayPal.",
            "CRED_ADDITIONAL_ADD": "הוספה",
        },
    },
    "hi": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "छात्रों को दिखने के लिए ये चरण पूरे करें",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "इन चरणों के पूरा होने तक आप अपनी उपलब्धता नहीं सेट कर सकते",
            "CHECKLIST_IDENTITY": "पहचान सत्यापन",
            "CHECKLIST_IDENTITY_PENDING": "पहचान सत्यापन (समीक्षा लंबित)",
            "CHECKLIST_QUALIFICATIONS": "शिक्षण योग्यताएँ",
            "CHECKLIST_QUALIFICATIONS_PENDING": "शिक्षण योग्यताएँ (समीक्षा लंबित)",
            "CHECKLIST_TOS": "नियम और समझौता",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "अपनी पहचान सत्यापित करें",
            "STEP_IDENTITY_DESC": "सरकार द्वारा जारी आईडी अपलोड करें ताकि हम पुष्टि कर सकें कि आप कौन हैं",
            "STEP_IDENTITY_STRIPE_SKIPPED": "भुगतान सेटअप के दौरान Stripe आपकी पहचान सत्यापित करेगा — अतिरिक्त अपलोड की आवश्यकता नहीं।",
            "STEP_QUALIFICATIONS_TITLE": "शिक्षण योग्यताएँ",
            "STEP_QUALIFICATIONS_DESC": "शिक्षण प्रमाणपत्र और सहायक दस्तावेज़ अपलोड करें",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect {{country}} में उपलब्ध है — आपको तेज़, स्वचालित भुगतान मिलेंगे।",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect अभी {{country}} में उपलब्ध नहीं है; हम आपके भुगतान PayPal के माध्यम से करेंगे।",
            "CRED_ADDITIONAL_ADD": "जोड़ें",
        },
    },
    "id": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Selesaikan langkah ini agar profil Anda terlihat oleh siswa",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Anda tidak dapat mengatur ketersediaan sampai langkah-langkah ini selesai",
            "CHECKLIST_IDENTITY": "Verifikasi identitas",
            "CHECKLIST_IDENTITY_PENDING": "Verifikasi identitas (menunggu tinjauan)",
            "CHECKLIST_QUALIFICATIONS": "Kualifikasi mengajar",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Kualifikasi mengajar (menunggu tinjauan)",
            "CHECKLIST_TOS": "Syarat & perjanjian",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Verifikasi identitas Anda",
            "STEP_IDENTITY_DESC": "Unggah ID resmi pemerintah agar kami dapat memastikan identitas Anda",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe akan memverifikasi identitas Anda saat pengaturan pembayaran — tidak perlu unggahan tambahan.",
            "STEP_QUALIFICATIONS_TITLE": "Kualifikasi mengajar",
            "STEP_QUALIFICATIONS_DESC": "Unggah sertifikat mengajar dan dokumen pendukung",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect tersedia di {{country}} — Anda akan menerima pembayaran cepat dan otomatis.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect belum tersedia di {{country}}; pembayaran Anda akan dialihkan melalui PayPal.",
            "CRED_ADDITIONAL_ADD": "Tambah",
        },
    },
    "it": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Completa questi passaggi per rendere il tuo profilo visibile agli studenti",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Non puoi impostare la disponibilità finché questi passaggi non sono completati",
            "CHECKLIST_IDENTITY": "Verifica dell’identità",
            "CHECKLIST_IDENTITY_PENDING": "Verifica dell’identità (in revisione)",
            "CHECKLIST_QUALIFICATIONS": "Qualifiche di insegnamento",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Qualifiche di insegnamento (in revisione)",
            "CHECKLIST_TOS": "Termini e accordo",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Verifica la tua identità",
            "STEP_IDENTITY_DESC": "Carica un documento d’identità rilasciato dalle autorità per consentirci di confermare chi sei",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe verificherà la tua identità durante la configurazione dei pagamenti — nessun caricamento aggiuntivo necessario.",
            "STEP_QUALIFICATIONS_TITLE": "Qualifiche di insegnamento",
            "STEP_QUALIFICATIONS_DESC": "Carica certificazioni di insegnamento ed eventuali documenti di supporto",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect è disponibile in {{country}} — riceverai pagamenti rapidi e automatici.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect non è ancora disponibile in {{country}}; instraderemo i pagamenti tramite PayPal.",
            "CRED_ADDITIONAL_ADD": "Aggiungi",
        },
    },
    "ja": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "これらの手順を完了すると、受講生にプロフィールが表示されます",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "これらの手順が完了するまで、空き時間は設定できません",
            "CHECKLIST_IDENTITY": "本人確認",
            "CHECKLIST_IDENTITY_PENDING": "本人確認（審査待ち）",
            "CHECKLIST_QUALIFICATIONS": "教育資格",
            "CHECKLIST_QUALIFICATIONS_PENDING": "教育資格（審査待ち）",
            "CHECKLIST_TOS": "利用規約と同意",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "本人確認を行う",
            "STEP_IDENTITY_DESC": "公的な身分証明書をアップロードして、本人であることを確認してください",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe が支払い設定の際に本人確認を行うため、追加のアップロードは不要です。",
            "STEP_QUALIFICATIONS_TITLE": "教育資格",
            "STEP_QUALIFICATIONS_DESC": "教員資格証明書や関連書類をアップロードしてください",
            "METHOD_REASON_STRIPE_COUNTRY": "{{country}} では Stripe Connect をご利用いただけます。迅速な自動送金が可能です。",
            "METHOD_REASON_PAYPAL_COUNTRY": "{{country}} では Stripe Connect がまだ利用できないため、送金は PayPal を経由します。",
            "CRED_ADDITIONAL_ADD": "追加",
        },
    },
    "ko": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "이 단계를 완료하면 학생에게 프로필이 표시됩니다",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "이 단계가 완료되기 전에는 가능 시간을 설정할 수 없습니다",
            "CHECKLIST_IDENTITY": "본인 확인",
            "CHECKLIST_IDENTITY_PENDING": "본인 확인(검토 대기)",
            "CHECKLIST_QUALIFICATIONS": "교육 자격",
            "CHECKLIST_QUALIFICATIONS_PENDING": "교육 자격(검토 대기)",
            "CHECKLIST_TOS": "약관 및 동의",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "본인을 확인하세요",
            "STEP_IDENTITY_DESC": "정부 발급 신분증을 업로드하여 본인 여부를 확인할 수 있게 해 주세요",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe가 지급 설정 중에 본인을 확인합니다. 별도 업로드는 필요 없습니다.",
            "STEP_QUALIFICATIONS_TITLE": "교육 자격",
            "STEP_QUALIFICATIONS_DESC": "교원 자격증 및 관련 서류를 업로드하세요",
            "METHOD_REASON_STRIPE_COUNTRY": "{{country}}에서는 Stripe Connect를 사용할 수 있습니다. 빠르고 자동으로 지급됩니다.",
            "METHOD_REASON_PAYPAL_COUNTRY": "{{country}}에서는 아직 Stripe Connect를 사용할 수 없어 지급은 PayPal로 진행됩니다.",
            "CRED_ADDITIONAL_ADD": "추가",
        },
    },
    "ms": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Lengkapkan langkah ini supaya profil anda kelihatan kepada pelajar",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Anda tidak boleh menetapkan ketersediaan sehingga langkah ini selesai",
            "CHECKLIST_IDENTITY": "Pengesahan identiti",
            "CHECKLIST_IDENTITY_PENDING": "Pengesahan identiti (menunggu semakan)",
            "CHECKLIST_QUALIFICATIONS": "Kelayakan mengajar",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Kelayakan mengajar (menunggu semakan)",
            "CHECKLIST_TOS": "Terma & perjanjian",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Sahkan identiti anda",
            "STEP_IDENTITY_DESC": "Muat naik ID kerajaan supaya kami boleh mengesahkan siapa anda",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe akan mengesahkan identiti anda semasa penyediaan pembayaran — tiada muat naik tambahan diperlukan.",
            "STEP_QUALIFICATIONS_TITLE": "Kelayakan mengajar",
            "STEP_QUALIFICATIONS_DESC": "Muat naik sijil mengajar dan dokumen sokongan",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect tersedia di {{country}} — anda akan menerima pembayaran pantas dan automatik.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect belum tersedia di {{country}}; pembayaran anda akan dihantar melalui PayPal.",
            "CRED_ADDITIONAL_ADD": "Tambah",
        },
    },
    "nl": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Voltooi deze stappen om zichtbaar te worden voor studenten",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Je kunt je beschikbaarheid pas instellen als deze stappen zijn voltooid",
            "CHECKLIST_IDENTITY": "Identiteitsverificatie",
            "CHECKLIST_IDENTITY_PENDING": "Identiteitsverificatie (in behandeling)",
            "CHECKLIST_QUALIFICATIONS": "Leskwalificaties",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Leskwalificaties (in behandeling)",
            "CHECKLIST_TOS": "Voorwaarden en overeenkomst",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Verifieer je identiteit",
            "STEP_IDENTITY_DESC": "Upload een door de overheid uitgegeven ID zodat we kunnen bevestigen wie je bent",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe verifieert je identiteit tijdens de uitbetalingsinstelling — geen extra upload nodig.",
            "STEP_QUALIFICATIONS_TITLE": "Leskwalificaties",
            "STEP_QUALIFICATIONS_DESC": "Upload onderwijscertificaten en ondersteunende documenten",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect is beschikbaar in {{country}} — je ontvangt snelle, automatische uitbetalingen.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect is in {{country}} nog niet beschikbaar; uitbetalingen verlopen via PayPal.",
            "CRED_ADDITIONAL_ADD": "Toevoegen",
        },
    },
    "no": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Fullfør disse trinnene for å bli synlig for elever",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Du kan ikke angi tilgjengelighet før disse trinnene er fullført",
            "CHECKLIST_IDENTITY": "Identitetsbekreftelse",
            "CHECKLIST_IDENTITY_PENDING": "Identitetsbekreftelse (venter på gjennomgang)",
            "CHECKLIST_QUALIFICATIONS": "Undervisningskvalifikasjoner",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Undervisningskvalifikasjoner (venter på gjennomgang)",
            "CHECKLIST_TOS": "Vilkår og avtale",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Bekreft identiteten din",
            "STEP_IDENTITY_DESC": "Last opp et offisielt ID-kort slik at vi kan bekrefte hvem du er",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe bekrefter identiteten din under utbetalingsoppsett — ingen ekstra opplasting nødvendig.",
            "STEP_QUALIFICATIONS_TITLE": "Undervisningskvalifikasjoner",
            "STEP_QUALIFICATIONS_DESC": "Last opp undervisningssertifikater og eventuelle vedlegg",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect er tilgjengelig i {{country}} — du får raske, automatiske utbetalinger.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect er ikke tilgjengelig i {{country}} ennå; utbetalinger sendes via PayPal.",
            "CRED_ADDITIONAL_ADD": "Legg til",
        },
    },
    "pl": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Ukończ te kroki, aby Twój profil był widoczny dla uczniów",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Nie możesz ustawić dostępności, dopóki te kroki nie zostaną ukończone",
            "CHECKLIST_IDENTITY": "Weryfikacja tożsamości",
            "CHECKLIST_IDENTITY_PENDING": "Weryfikacja tożsamości (oczekuje na przegląd)",
            "CHECKLIST_QUALIFICATIONS": "Kwalifikacje pedagogiczne",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Kwalifikacje pedagogiczne (oczekują na przegląd)",
            "CHECKLIST_TOS": "Regulamin i umowa",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Zweryfikuj swoją tożsamość",
            "STEP_IDENTITY_DESC": "Prześlij dokument tożsamości wydany przez organ państwowy, abyśmy mogli potwierdzić Twoją tożsamość",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe zweryfikuje Twoją tożsamość podczas konfiguracji wypłat — bez dodatkowego przesyłania plików.",
            "STEP_QUALIFICATIONS_TITLE": "Kwalifikacje pedagogiczne",
            "STEP_QUALIFICATIONS_DESC": "Prześlij certyfikaty nauczania i dokumenty potwierdzające",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect jest dostępny w kraju {{country}} — otrzymasz szybkie, automatyczne wypłaty.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect nie jest jeszcze dostępny w kraju {{country}}; wypłaty poprowadzimy przez PayPal.",
            "CRED_ADDITIONAL_ADD": "Dodaj",
        },
    },
    "pt": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Conclua estes passos para o seu perfil ficar visível aos alunos",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Não pode definir a sua disponibilidade até estes passos estarem concluídos",
            "CHECKLIST_IDENTITY": "Verificação de identidade",
            "CHECKLIST_IDENTITY_PENDING": "Verificação de identidade (pendente de revisão)",
            "CHECKLIST_QUALIFICATIONS": "Qualificações de ensino",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Qualificações de ensino (pendente de revisão)",
            "CHECKLIST_TOS": "Termos e acordo",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Verifique a sua identidade",
            "STEP_IDENTITY_DESC": "Carregue um documento de identificação oficial para podermos confirmar quem é",
            "STEP_IDENTITY_STRIPE_SKIPPED": "A Stripe verificará a sua identidade durante a configuração de pagamentos — não é necessário carregar mais nada.",
            "STEP_QUALIFICATIONS_TITLE": "Qualificações de ensino",
            "STEP_QUALIFICATIONS_DESC": "Carregue certificações de ensino e documentos de apoio",
            "METHOD_REASON_STRIPE_COUNTRY": "O Stripe Connect está disponível em {{country}} — receberá pagamentos rápidos e automáticos.",
            "METHOD_REASON_PAYPAL_COUNTRY": "O Stripe Connect ainda não está disponível em {{country}}; os pagamentos serão feitos via PayPal.",
            "CRED_ADDITIONAL_ADD": "Adicionar",
        },
    },
    "ro": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Finalizați acești pași pentru ca profilul dvs. să fie vizibil pentru elevi",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Nu puteți seta disponibilitatea până când acești pași nu sunt finalizați",
            "CHECKLIST_IDENTITY": "Verificare identitate",
            "CHECKLIST_IDENTITY_PENDING": "Verificare identitate (în așteptarea verificării)",
            "CHECKLIST_QUALIFICATIONS": "Calificări didactice",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Calificări didactice (în așteptarea verificării)",
            "CHECKLIST_TOS": "Termeni și acord",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Verificați-vă identitatea",
            "STEP_IDENTITY_DESC": "Încărcați un act de identitate emis de stat pentru a confirma cine sunteți",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe vă va verifica identitatea la configurarea plăților — nu este necesară o încărcare suplimentară.",
            "STEP_QUALIFICATIONS_TITLE": "Calificări didactice",
            "STEP_QUALIFICATIONS_DESC": "Încărcați certificate de predare și documente justificative",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect este disponibil în {{country}} — veți primi plăți rapide și automate.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect nu este încă disponibil în {{country}}; plățile vor fi rutate prin PayPal.",
            "CRED_ADDITIONAL_ADD": "Adăugați",
        },
    },
    "ru": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Выполните эти шаги, чтобы ваш профиль был виден ученикам",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Нельзя настроить доступность, пока эти шаги не завершены",
            "CHECKLIST_IDENTITY": "Подтверждение личности",
            "CHECKLIST_IDENTITY_PENDING": "Подтверждение личности (на проверке)",
            "CHECKLIST_QUALIFICATIONS": "Педагогическая квалификация",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Педагогическая квалификация (на проверке)",
            "CHECKLIST_TOS": "Условия и соглашение",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Подтвердите личность",
            "STEP_IDENTITY_DESC": "Загрузите удостоверение личности, выданное государством, чтобы мы могли вас идентифицировать",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe подтвердит личность при настройке выплат — дополнительная загрузка не нужна.",
            "STEP_QUALIFICATIONS_TITLE": "Педагогическая квалификация",
            "STEP_QUALIFICATIONS_DESC": "Загрузите сертификаты преподавателя и подтверждающие документы",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect доступен в стране {{country}} — вы получите быстрые автоматические выплаты.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect пока недоступен в {{country}}; выплаты будут через PayPal.",
            "CRED_ADDITIONAL_ADD": "Добавить",
        },
    },
    "sv": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Slutför dessa steg så att din profil syns för elever",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Du kan inte ställa in tillgänglighet förrän dessa steg är klara",
            "CHECKLIST_IDENTITY": "Identitetsverifiering",
            "CHECKLIST_IDENTITY_PENDING": "Identitetsverifiering (väntar på granskning)",
            "CHECKLIST_QUALIFICATIONS": "Undervisningskvalifikationer",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Undervisningskvalifikationer (väntar på granskning)",
            "CHECKLIST_TOS": "Villkor och avtal",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Verifiera din identitet",
            "STEP_IDENTITY_DESC": "Ladda upp en statligt utfärdad legitimation så att vi kan bekräfta vem du är",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe verifierar din identitet vid utbetalningsinställning — ingen extra uppladdning behövs.",
            "STEP_QUALIFICATIONS_TITLE": "Undervisningskvalifikationer",
            "STEP_QUALIFICATIONS_DESC": "Ladda upp undervisningscertifikat och stödjande dokument",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect finns i {{country}} — du får snabba, automatiska utbetalningar.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect är ännu inte tillgängligt i {{country}}; utbetalningar sker via PayPal.",
            "CRED_ADDITIONAL_ADD": "Lägg till",
        },
    },
    "th": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "ทำขั้นตอนเหล่านี้ให้ครบเพื่อให้โปรไฟล์ของคุณปรากฏต่อนักเรียน",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "คุณตั้งค่าความพร้อมไม่ได้จนกว่าจะทำขั้นตอนเหล่านี้ครบ",
            "CHECKLIST_IDENTITY": "ยืนยันตัวตน",
            "CHECKLIST_IDENTITY_PENDING": "ยืนยันตัวตน (รอตรวจสอบ)",
            "CHECKLIST_QUALIFICATIONS": "คุณวุฒิการสอน",
            "CHECKLIST_QUALIFICATIONS_PENDING": "คุณวุฒิการสอน (รอตรวจสอบ)",
            "CHECKLIST_TOS": "ข้อกำหนดและข้อตกลง",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "ยืนยันตัวตนของคุณ",
            "STEP_IDENTITY_DESC": "อัปโหลดบัตรประชาชนหรือเอกสารทางราชการเพื่อให้เรายืนยันตัวตนได้",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe จะยืนยันตัวตนระหว่างตั้งค่าการจ่ายเงิน — ไม่ต้องอัปโหลดเพิ่ม",
            "STEP_QUALIFICATIONS_TITLE": "คุณวุฒิการสอน",
            "STEP_QUALIFICATIONS_DESC": "อัปโหลดใบรับรองการสอนและเอกสารประกอบ",
            "METHOD_REASON_STRIPE_COUNTRY": "มี Stripe Connect ใน {{country}} — คุณจะได้รับเงินเร็วและอัตโนมัติ",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect ยังไม่พร้อมใน {{country}} — เราจะส่งเงินผ่าน PayPal",
            "CRED_ADDITIONAL_ADD": "เพิ่ม",
        },
    },
    "tr": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Öğrencilere görünür olmak için bu adımları tamamlayın",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Bu adımlar tamamlanana kadar müsaitliğinizi ayarlayamazsınız",
            "CHECKLIST_IDENTITY": "Kimlik doğrulama",
            "CHECKLIST_IDENTITY_PENDING": "Kimlik doğrulama (inceleme bekliyor)",
            "CHECKLIST_QUALIFICATIONS": "Öğretmenlik yeterlilikleri",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Öğretmenlik yeterlilikleri (inceleme bekliyor)",
            "CHECKLIST_TOS": "Şartlar ve sözleşme",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Kimliğinizi doğrulayın",
            "STEP_IDENTITY_DESC": "Kim olduğunuzu teyit edebilmemiz için resmi kimlik belgesi yükleyin",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe, ödeme kurulumu sırasında kimliğinizi doğrular — ek yükleme gerekmez.",
            "STEP_QUALIFICATIONS_TITLE": "Öğretmenlik yeterlilikleri",
            "STEP_QUALIFICATIONS_DESC": "Öğretmenlik sertifikalarınızı ve destekleyici belgeleri yükleyin",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect {{country}} bölgesinde kullanılabilir — hızlı ve otomatik ödemeler alırsınız.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect henüz {{country}} bölgesinde yok; ödemeleriniz PayPal üzerinden yönlendirilecek.",
            "CRED_ADDITIONAL_ADD": "Ekle",
        },
    },
    "uk": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Завершіть ці кроки, щоб ваш профіль був видимий учням",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Неможливо налаштувати доступність, доки ці кроки не виконано",
            "CHECKLIST_IDENTITY": "Перевірка особи",
            "CHECKLIST_IDENTITY_PENDING": "Перевірка особи (очікує на перевірку)",
            "CHECKLIST_QUALIFICATIONS": "Педагогічна кваліфікація",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Педагогічна кваліфікація (очікує на перевірку)",
            "CHECKLIST_TOS": "Умови та угода",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Підтвердіть особу",
            "STEP_IDENTITY_DESC": "Завантажте документ, виданий державою, щоб ми могли підтвердити вашу особу",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe підтвердить особу під час налаштування виплат — додаткове завантаження не потрібне.",
            "STEP_QUALIFICATIONS_TITLE": "Педагогічна кваліфікація",
            "STEP_QUALIFICATIONS_DESC": "Завантажте сертифікати викладання та супровідні документи",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect доступний у {{country}} — ви отримуватимете швидкі автоматичні виплати.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect ще недоступний у {{country}}; виплати будуть через PayPal.",
            "CRED_ADDITIONAL_ADD": "Додати",
        },
    },
    "vi": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "Hoàn thành các bước này để hồ sơ của bạn hiển thị với học viên",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "Bạn không thể đặt lịch rảnh cho đến khi hoàn tất các bước này",
            "CHECKLIST_IDENTITY": "Xác minh danh tính",
            "CHECKLIST_IDENTITY_PENDING": "Xác minh danh tính (đang chờ duyệt)",
            "CHECKLIST_QUALIFICATIONS": "Bằng cấp sư phạm",
            "CHECKLIST_QUALIFICATIONS_PENDING": "Bằng cấp sư phạm (đang chờ duyệt)",
            "CHECKLIST_TOS": "Điều khoản và thỏa thuận",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "Xác minh danh tính của bạn",
            "STEP_IDENTITY_DESC": "Tải lên giấy tờ tùy thân do nhà nước cấp để chúng tôi xác nhận bạn là ai",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe sẽ xác minh danh tính khi thiết lập thanh toán — không cần tải thêm.",
            "STEP_QUALIFICATIONS_TITLE": "Bằng cấp sư phạm",
            "STEP_QUALIFICATIONS_DESC": "Tải lên chứng chỉ giảng dạy và tài liệu minh chứng",
            "METHOD_REASON_STRIPE_COUNTRY": "Stripe Connect có tại {{country}} — bạn nhận thanh toán nhanh và tự động.",
            "METHOD_REASON_PAYPAL_COUNTRY": "Stripe Connect chưa có tại {{country}}; thanh toán sẽ qua PayPal.",
            "CRED_ADDITIONAL_ADD": "Thêm",
        },
    },
    "zh": {
        "HOME.GROWTH": {
            "PROFILE_CHECKLIST_SUBTITLE": "完成这些步骤后，学员才能看到您的个人资料",
            "PROFILE_CHECKLIST_AVAILABILITY_NOTE": "在完成这些步骤之前，您无法设置可授课时间",
            "CHECKLIST_IDENTITY": "身份验证",
            "CHECKLIST_IDENTITY_PENDING": "身份验证（待审核）",
            "CHECKLIST_QUALIFICATIONS": "教学资质",
            "CHECKLIST_QUALIFICATIONS_PENDING": "教学资质（待审核）",
            "CHECKLIST_TOS": "条款与协议",
        },
        "TUTOR_APPROVAL": {
            "STEP_IDENTITY_TITLE": "验证您的身份",
            "STEP_IDENTITY_DESC": "请上传政府签发的身份证件，以便我们确认您的身份",
            "STEP_IDENTITY_STRIPE_SKIPPED": "Stripe 会在设置收款时验证您的身份，无需额外上传。",
            "STEP_QUALIFICATIONS_TITLE": "教学资质",
            "STEP_QUALIFICATIONS_DESC": "请上传教学证书及相关证明文件",
            "METHOD_REASON_STRIPE_COUNTRY": "{{country}} 支持 Stripe Connect，您将获得快速、自动的打款。",
            "METHOD_REASON_PAYPAL_COUNTRY": "{{country}} 暂不支持 Stripe Connect，您的款项将通过 PayPal 处理。",
            "CRED_ADDITIONAL_ADD": "添加",
        },
    },
}


def apply_patch(data: dict, lang: str) -> bool:
    patch = TRANSLATIONS.get(lang)
    if not patch:
        return False
    changed = False
    g = data.setdefault("HOME", {}).setdefault("GROWTH", {})
    for k, v in patch.get("HOME.GROWTH", {}).items():
        if g.get(k) != v:
            g[k] = v
            changed = True
    ta = data.setdefault("TUTOR_APPROVAL", {})
    for k, v in patch.get("TUTOR_APPROVAL", {}).items():
        if ta.get(k) != v:
            ta[k] = v
            changed = True
    return changed


def main() -> None:
    missing = []
    for path in sorted(I18N_DIR.glob("*.json")):
        if path.name == "en.json":
            continue
        lang = path.stem
        if lang not in TRANSLATIONS:
            missing.append(lang)
    if missing:
        raise SystemExit(f"Missing TRANSLATIONS for: {', '.join(missing)}")

    for path in sorted(I18N_DIR.glob("*.json")):
        if path.name == "en.json":
            continue
        lang = path.stem
        text = path.read_text(encoding="utf-8")
        data = json.loads(text)
        if apply_patch(data, lang):
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print("updated", path.name)


if __name__ == "__main__":
    main()
