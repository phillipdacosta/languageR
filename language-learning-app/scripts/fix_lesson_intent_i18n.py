#!/usr/bin/env python3
"""Fix PRE_CALL and VIDEO_CALL lesson-intent strings with natural, context-aware translations."""
from __future__ import annotations

import json
from pathlib import Path

I18N = Path(__file__).resolve().parent.parent / "src" / "assets" / "i18n"

# Student chip labels (PRE_CALL) vs tutor banner (VIDEO_CALL) use different phrasing.
FIXES: dict[str, dict[str, dict[str, str]]] = {
    "de": {
        "PRE_CALL": {
            "INTENT_EASY": "Locker & entspannt",
            "INTENT_CONVERSATIONAL": "Gesprächig",
            "INTENT_FOCUSED": "Fokussiert",
            "INTENT_CHALLENGE": "Fordere mich heraus",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Schüler wünscht sich:",
            "INTENT_EASY_LABEL": "einen lockeren, entspannten Unterricht",
            "INTENT_EASY_HINT": "Lockeres Tempo, wenig Korrekturen",
            "INTENT_CONVERSATIONAL_LABEL": "lockeres Gespräch",
            "INTENT_CONVERSATIONAL_HINT": "Freies Gespräch, Schüler bestimmt das Tempo",
            "INTENT_FOCUSED_LABEL": "fokussiertes Üben",
            "INTENT_FOCUSED_HINT": "Beim Thema bleiben, aktiv korrigieren",
            "INTENT_CHALLENGE_LABEL": "eine Herausforderung",
            "INTENT_CHALLENGE_HINT": "Mehr fordern, neues Material einbringen",
        },
    },
    "fr": {
        "PRE_CALL": {
            "INTENT_EASY": "Détendu et léger",
            "INTENT_CONVERSATIONAL": "Conversationnel",
            "INTENT_FOCUSED": "Concentré",
            "INTENT_CHALLENGE": "Mets-moi au défi",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "L'élève souhaite :",
            "INTENT_EASY_LABEL": "un cours détendu et facile",
            "INTENT_EASY_HINT": "Rythme léger, peu de corrections",
            "INTENT_CONVERSATIONAL_LABEL": "une conversation libre",
            "INTENT_CONVERSATIONAL_HINT": "Discussion libre, laissez l'élève guider",
            "INTENT_FOCUSED_LABEL": "une pratique ciblée",
            "INTENT_FOCUSED_HINT": "Rester sur le sujet, corriger activement",
            "INTENT_CHALLENGE_LABEL": "un défi",
            "INTENT_CHALLENGE_HINT": "Exiger plus, introduire du nouveau contenu",
        },
    },
    "es": {
        "PRE_CALL": {
            "INTENT_EASY": "Relajado y ligero",
            "INTENT_CONVERSATIONAL": "Conversacional",
            "INTENT_FOCUSED": "Enfocado",
            "INTENT_CHALLENGE": "Desafíame",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "El estudiante prefiere:",
            "INTENT_EASY_LABEL": "una clase relajada y fácil",
            "INTENT_EASY_HINT": "Ritmo fácil, pocas correcciones",
            "INTENT_CONVERSATIONAL_LABEL": "conversación libre",
            "INTENT_CONVERSATIONAL_HINT": "Charla libre, deja que el estudiante guíe",
            "INTENT_FOCUSED_LABEL": "práctica enfocada",
            "INTENT_FOCUSED_HINT": "Mantente en el tema, corrige con frecuencia",
            "INTENT_CHALLENGE_LABEL": "un reto",
            "INTENT_CHALLENGE_HINT": "Exige más, introduce material nuevo",
        },
    },
    "pt": {
        "PRE_CALL": {
            "INTENT_EASY": "Descontraído e leve",
            "INTENT_CONVERSATIONAL": "Conversacional",
            "INTENT_FOCUSED": "Focado",
            "INTENT_CHALLENGE": "Desafie-me",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "O aluno prefere:",
            "INTENT_EASY_LABEL": "uma aula descontraída e fácil",
            "INTENT_EASY_HINT": "Ritmo leve, poucas correções",
            "INTENT_CONVERSATIONAL_LABEL": "conversa livre",
            "INTENT_CONVERSATIONAL_HINT": "Conversa solta, deixe o aluno liderar",
            "INTENT_FOCUSED_LABEL": "prática focada",
            "INTENT_FOCUSED_HINT": "Mantenha o tema, corrija com frequência",
            "INTENT_CHALLENGE_LABEL": "um desafio",
            "INTENT_CHALLENGE_HINT": "Exija mais, introduza material novo",
        },
    },
    "it": {
        "PRE_CALL": {
            "INTENT_EASY": "Rilassato e leggero",
            "INTENT_CONVERSATIONAL": "Conversazionale",
            "INTENT_FOCUSED": "Concentrato",
            "INTENT_CHALLENGE": "Sfidami",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Lo studente preferisce:",
            "INTENT_EASY_LABEL": "una lezione rilassata e facile",
            "INTENT_EASY_HINT": "Ritmo leggero, poche correzioni",
            "INTENT_CONVERSATIONAL_LABEL": "conversazione libera",
            "INTENT_CONVERSATIONAL_HINT": "Dialogo libero, lascia guidare lo studente",
            "INTENT_FOCUSED_LABEL": "pratica mirata",
            "INTENT_FOCUSED_HINT": "Resta in tema, correggi spesso",
            "INTENT_CHALLENGE_LABEL": "una sfida",
            "INTENT_CHALLENGE_HINT": "Spingi di più, introduci materiale nuovo",
        },
    },
    "nl": {
        "PRE_CALL": {
            "INTENT_EASY": "Ontspannen & makkelijk",
            "INTENT_CONVERSATIONAL": "Gesprek",
            "INTENT_FOCUSED": "Gefocust",
            "INTENT_CHALLENGE": "Daag me uit",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "De student wil:",
            "INTENT_EASY_LABEL": "een ontspannen, makkelijke les",
            "INTENT_EASY_HINT": "Rustig tempo, weinig correcties",
            "INTENT_CONVERSATIONAL_LABEL": "vrij gesprek",
            "INTENT_CONVERSATIONAL_HINT": "Vrij praten, laat de student leiden",
            "INTENT_FOCUSED_LABEL": "gerichte oefening",
            "INTENT_FOCUSED_HINT": "Blijf bij het onderwerp, corrigeer actief",
            "INTENT_CHALLENGE_LABEL": "een uitdaging",
            "INTENT_CHALLENGE_HINT": "Meer vragen, nieuw materiaal introduceren",
        },
    },
    "sv": {
        "PRE_CALL": {
            "INTENT_EASY": "Avslappnat & lätt",
            "INTENT_CONVERSATIONAL": "Samtal",
            "INTENT_FOCUSED": "Fokuserat",
            "INTENT_CHALLENGE": "Utmana mig",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Eleven vill ha:",
            "INTENT_EASY_LABEL": "en avslappnad, lätt lektion",
            "INTENT_EASY_HINT": "Lugnt tempo, få rättningar",
            "INTENT_CONVERSATIONAL_LABEL": "fritt samtal",
            "INTENT_CONVERSATIONAL_HINT": "Fri prat, låt eleven styra",
            "INTENT_FOCUSED_LABEL": "fokuserad övning",
            "INTENT_FOCUSED_HINT": "Håll dig till ämnet, rätta ofta",
            "INTENT_CHALLENGE_LABEL": "en utmaning",
            "INTENT_CHALLENGE_HINT": "Kräv mer, introducera nytt material",
        },
    },
    "da": {
        "PRE_CALL": {
            "INTENT_EASY": "Afslappet & let",
            "INTENT_CONVERSATIONAL": "Samtale",
            "INTENT_FOCUSED": "Fokuseret",
            "INTENT_CHALLENGE": "Udfordr mig",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Eleven ønsker:",
            "INTENT_EASY_LABEL": "en afslappet, let lektion",
            "INTENT_EASY_HINT": "Roligt tempo, få rettelser",
            "INTENT_CONVERSATIONAL_LABEL": "fri samtale",
            "INTENT_CONVERSATIONAL_HINT": "Fri snak, lad eleven styre",
            "INTENT_FOCUSED_LABEL": "fokuseret øvelse",
            "INTENT_FOCUSED_HINT": "Hold dig til emnet, ret aktivt",
            "INTENT_CHALLENGE_LABEL": "en udfordring",
            "INTENT_CHALLENGE_HINT": "Kræv mere, introducer nyt materiale",
        },
    },
    "no": {
        "PRE_CALL": {
            "INTENT_EASY": "Avslappet & lett",
            "INTENT_CONVERSATIONAL": "Samtale",
            "INTENT_FOCUSED": "Fokusert",
            "INTENT_CHALLENGE": "Utfordre meg",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Studenten ønsker:",
            "INTENT_EASY_LABEL": "en avslappet, lett leksjon",
            "INTENT_EASY_HINT": "Rolig tempo, få rettelser",
            "INTENT_CONVERSATIONAL_LABEL": "fri samtale",
            "INTENT_CONVERSATIONAL_HINT": "Fri prat, la studenten lede",
            "INTENT_FOCUSED_LABEL": "fokusert øving",
            "INTENT_FOCUSED_HINT": "Hold deg til temaet, rett ofte",
            "INTENT_CHALLENGE_LABEL": "en utfordring",
            "INTENT_CHALLENGE_HINT": "Krev mer, introduser nytt materiale",
        },
    },
    "fi": {
        "PRE_CALL": {
            "INTENT_EASY": "Rento & kepeä",
            "INTENT_CONVERSATIONAL": "Keskustelu",
            "INTENT_FOCUSED": "Keskittynyt",
            "INTENT_CHALLENGE": "Haasta minut",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Opiskelija toivoo:",
            "INTENT_EASY_LABEL": "rentoa ja kepeää opetusta",
            "INTENT_EASY_HINT": "Rauhallinen tahti, vähän korjauksia",
            "INTENT_CONVERSATIONAL_LABEL": "vapaata keskustelua",
            "INTENT_CONVERSATIONAL_HINT": "Vapaa puhe, anna opiskelijan johtaa",
            "INTENT_FOCUSED_LABEL": "tavoitteellista harjoittelua",
            "INTENT_FOCUSED_HINT": "Pysy aiheessa, korjaa aktiivisesti",
            "INTENT_CHALLENGE_LABEL": "haastetta",
            "INTENT_CHALLENGE_HINT": "Vaadi enemmän, tuo uutta materiaalia",
        },
    },
    "pl": {
        "PRE_CALL": {
            "INTENT_EASY": "Luźno i spokojnie",
            "INTENT_CONVERSATIONAL": "Swobodnie",
            "INTENT_FOCUSED": "Skupiony",
            "INTENT_CHALLENGE": "Rzuć mi wyzwanie",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Uczeń woli:",
            "INTENT_EASY_LABEL": "luźną, spokojną lekcję",
            "INTENT_EASY_HINT": "Spokojne tempo, mało poprawek",
            "INTENT_CONVERSATIONAL_LABEL": "swobodną rozmowę",
            "INTENT_CONVERSATIONAL_HINT": "Wolna rozmowa, pozwól uczniowi prowadzić",
            "INTENT_FOCUSED_LABEL": "skupioną praktykę",
            "INTENT_FOCUSED_HINT": "Trzymaj się tematu, poprawiaj często",
            "INTENT_CHALLENGE_LABEL": "wyzwanie",
            "INTENT_CHALLENGE_HINT": "Wymagaj więcej, wprowadzaj nowy materiał",
        },
    },
    "cs": {
        "PRE_CALL": {
            "INTENT_EASY": "Pohodově a lehce",
            "INTENT_CONVERSATIONAL": "Povídání",
            "INTENT_FOCUSED": "Soustředěně",
            "INTENT_CHALLENGE": "Vyzvi mě",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Student preferuje:",
            "INTENT_EASY_LABEL": "pohodovou a lehkou lekci",
            "INTENT_EASY_HINT": "Klidné tempo, minimum oprav",
            "INTENT_CONVERSATIONAL_LABEL": "volný rozhovor",
            "INTENT_CONVERSATIONAL_HINT": "Volná konverzace, nech studenta vést",
            "INTENT_FOCUSED_LABEL": "cílené cvičení",
            "INTENT_FOCUSED_HINT": "Drž se tématu, opravuj často",
            "INTENT_CHALLENGE_LABEL": "výzvu",
            "INTENT_CHALLENGE_HINT": "Vyžaduj víc, přidej nový materiál",
        },
    },
    "ru": {
        "PRE_CALL": {
            "INTENT_EASY": "Спокойно и легко",
            "INTENT_CONVERSATIONAL": "Свободно",
            "INTENT_FOCUSED": "Сосредоточенно",
            "INTENT_CHALLENGE": "Брось мне вызов",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Ученик предпочитает:",
            "INTENT_EASY_LABEL": "спокойный, лёгкий урок",
            "INTENT_EASY_HINT": "Неспешный темп, минимум исправлений",
            "INTENT_CONVERSATIONAL_LABEL": "свободный разговор",
            "INTENT_CONVERSATIONAL_HINT": "Свободная беседа, пусть ученик ведёт",
            "INTENT_FOCUSED_LABEL": "сфокусированную практику",
            "INTENT_FOCUSED_HINT": "Держитесь темы, активно исправляйте",
            "INTENT_CHALLENGE_LABEL": "вызов",
            "INTENT_CHALLENGE_HINT": "Требуйте больше, вводите новый материал",
        },
    },
    "uk": {
        "PRE_CALL": {
            "INTENT_EASY": "Спокійно і легко",
            "INTENT_CONVERSATIONAL": "Вільно",
            "INTENT_FOCUSED": "Зосереджено",
            "INTENT_CHALLENGE": "Кинь мені виклик",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Учень бажає:",
            "INTENT_EASY_LABEL": "спокійний, легкий урок",
            "INTENT_EASY_HINT": "Неспішний темп, мінімум виправлень",
            "INTENT_CONVERSATIONAL_LABEL": "вільну розмову",
            "INTENT_CONVERSATIONAL_HINT": "Вільна бесіда, нехай учень веде",
            "INTENT_FOCUSED_LABEL": "сфокусовану практику",
            "INTENT_FOCUSED_HINT": "Тримайтеся теми, активно виправляйте",
            "INTENT_CHALLENGE_LABEL": "виклик",
            "INTENT_CHALLENGE_HINT": "Вимагайте більше, додавайте новий матеріал",
        },
    },
    "ro": {
        "PRE_CALL": {
            "INTENT_EASY": "Relaxat și ușor",
            "INTENT_CONVERSATIONAL": "Conversațional",
            "INTENT_FOCUSED": "Concentrat",
            "INTENT_CHALLENGE": "Provocă-mă",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Studentul preferă:",
            "INTENT_EASY_LABEL": "o lecție relaxată și ușoară",
            "INTENT_EASY_HINT": "Ritm ușor, puține corecții",
            "INTENT_CONVERSATIONAL_LABEL": "conversație liberă",
            "INTENT_CONVERSATIONAL_HINT": "Discuție liberă, lasă studentul să conducă",
            "INTENT_FOCUSED_LABEL": "practică concentrată",
            "INTENT_FOCUSED_HINT": "Rămâi pe subiect, corectează activ",
            "INTENT_CHALLENGE_LABEL": "o provocare",
            "INTENT_CHALLENGE_HINT": "Cere mai mult, introdu material nou",
        },
    },
    "el": {
        "PRE_CALL": {
            "INTENT_EASY": "Χαλαρά & εύκολα",
            "INTENT_CONVERSATIONAL": "Συζητητικό",
            "INTENT_FOCUSED": "Συγκεντρωμένο",
            "INTENT_CHALLENGE": "Πρόκαλέσέ με",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Ο μαθητής προτιμά:",
            "INTENT_EASY_LABEL": "ένα χαλαρό, εύκολο μάθημα",
            "INTENT_EASY_HINT": "Ήπιος ρυθμός, λίγες διορθώσεις",
            "INTENT_CONVERSATIONAL_LABEL": "ελεύθερη συζήτηση",
            "INTENT_CONVERSATIONAL_HINT": "Ελεύθερη κουβέντα, άσε τον μαθητή να καθοδηγεί",
            "INTENT_FOCUSED_LABEL": "εστιασμένη εξάσκηση",
            "INTENT_FOCUSED_HINT": "Μείνε στο θέμα, διόρθωσε ενεργά",
            "INTENT_CHALLENGE_LABEL": "μια πρόκληση",
            "INTENT_CHALLENGE_HINT": "Απαίτησε περισσότερα, φέρε νέο υλικό",
        },
    },
    "tr": {
        "PRE_CALL": {
            "INTENT_EASY": "Rahat & hafif",
            "INTENT_CONVERSATIONAL": "Sohbet",
            "INTENT_FOCUSED": "Odaklı",
            "INTENT_CHALLENGE": "Beni zorla",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Öğrenci tercihi:",
            "INTENT_EASY_LABEL": "rahat ve kolay bir ders",
            "INTENT_EASY_HINT": "Yavaş tempo, az düzeltme",
            "INTENT_CONVERSATIONAL_LABEL": "serbest sohbet",
            "INTENT_CONVERSATIONAL_HINT": "Serbest konuşma, öğrencinin yönlendirmesine izin ver",
            "INTENT_FOCUSED_LABEL": "odaklı pratik",
            "INTENT_FOCUSED_HINT": "Konuya odaklan, sık düzelt",
            "INTENT_CHALLENGE_LABEL": "bir meydan okuma",
            "INTENT_CHALLENGE_HINT": "Daha çok zorla, yeni materyal ekle",
        },
    },
    "zh": {
        "PRE_CALL": {
            "INTENT_EASY": "轻松自在",
            "INTENT_CONVERSATIONAL": "自由聊天",
            "INTENT_FOCUSED": "专注练习",
            "INTENT_CHALLENGE": "挑战我",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "学生偏好：",
            "INTENT_EASY_LABEL": "轻松、节奏舒缓",
            "INTENT_EASY_HINT": "节奏轻松，少纠正",
            "INTENT_CONVERSATIONAL_LABEL": "自由对话",
            "INTENT_CONVERSATIONAL_HINT": "自由交谈，让学生主导",
            "INTENT_FOCUSED_LABEL": "专注练习",
            "INTENT_FOCUSED_HINT": "紧扣主题，积极纠正",
            "INTENT_CHALLENGE_LABEL": "有挑战性的课程",
            "INTENT_CHALLENGE_HINT": "提高难度，引入新内容",
        },
    },
    "ja": {
        "PRE_CALL": {
            "INTENT_EASY": "気楽に",
            "INTENT_CONVERSATIONAL": "会話中心",
            "INTENT_FOCUSED": "集中して",
            "INTENT_CHALLENGE": "挑戦して",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "生徒の希望：",
            "INTENT_EASY_LABEL": "気楽でゆったりしたレッスン",
            "INTENT_EASY_HINT": "ゆったりしたペース、訂正は最小限",
            "INTENT_CONVERSATIONAL_LABEL": "自由な会話",
            "INTENT_CONVERSATIONAL_HINT": "自由に話す、生徒のペースに合わせる",
            "INTENT_FOCUSED_LABEL": "集中した練習",
            "INTENT_FOCUSED_HINT": "テーマを守り、積極的に訂正",
            "INTENT_CHALLENGE_LABEL": "チャレンジングなレッスン",
            "INTENT_CHALLENGE_HINT": "もっと難しく、新しい内容を取り入れる",
        },
    },
    "ko": {
        "PRE_CALL": {
            "INTENT_EASY": "편안하게",
            "INTENT_CONVERSATIONAL": "대화 위주",
            "INTENT_FOCUSED": "집중해서",
            "INTENT_CHALLENGE": "도전해 주세요",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "학생 선호:",
            "INTENT_EASY_LABEL": "편안하고 가벼운 수업",
            "INTENT_EASY_HINT": "느긋한 속도, 최소한의 교정",
            "INTENT_CONVERSATIONAL_LABEL": "자유로운 대화",
            "INTENT_CONVERSATIONAL_HINT": "자유롭게 대화, 학생이 이끌도록",
            "INTENT_FOCUSED_LABEL": "집중 연습",
            "INTENT_FOCUSED_HINT": "주제에 충실, 적극적으로 교정",
            "INTENT_CHALLENGE_LABEL": "도전적인 수업",
            "INTENT_CHALLENGE_HINT": "더 어렵게, 새로운 내용 도입",
        },
    },
    "vi": {
        "PRE_CALL": {
            "INTENT_EASY": "Thoải mái & nhẹ nhàng",
            "INTENT_CONVERSATIONAL": "Trò chuyện",
            "INTENT_FOCUSED": "Tập trung",
            "INTENT_CHALLENGE": "Thử thách tôi",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Học viên muốn:",
            "INTENT_EASY_LABEL": "một buổi học thoải mái, nhẹ nhàng",
            "INTENT_EASY_HINT": "Nhịp chậm, ít sửa lỗi",
            "INTENT_CONVERSATIONAL_LABEL": "trò chuyện tự do",
            "INTENT_CONVERSATIONAL_HINT": "Nói chuyện tự do, để học viên dẫn dắt",
            "INTENT_FOCUSED_LABEL": "luyện tập tập trung",
            "INTENT_FOCUSED_HINT": "Bám sát chủ đề, sửa lỗi thường xuyên",
            "INTENT_CHALLENGE_LABEL": "một thử thách",
            "INTENT_CHALLENGE_HINT": "Đòi hỏi nhiều hơn, thêm nội dung mới",
        },
    },
    "hi": {
        "PRE_CALL": {
            "INTENT_EASY": "आराम से और हल्का",
            "INTENT_CONVERSATIONAL": "बातचीत",
            "INTENT_FOCUSED": "ध्यान केंद्रित",
            "INTENT_CHALLENGE": "मुझे चुनौती दो",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "छात्र की पसंद:",
            "INTENT_EASY_LABEL": "आरामदायक, हल्का पाठ",
            "INTENT_EASY_HINT": "धीमी गति, कम सुधार",
            "INTENT_CONVERSATIONAL_LABEL": "मुक्त बातचीत",
            "INTENT_CONVERSATIONAL_HINT": "खुलकर बात करें, छात्र को अगुवाई करने दें",
            "INTENT_FOCUSED_LABEL": "केंद्रित अभ्यास",
            "INTENT_FOCUSED_HINT": "विषय पर बने रहें, सक्रिय रूप से सुधारें",
            "INTENT_CHALLENGE_LABEL": "एक चुनौती",
            "INTENT_CHALLENGE_HINT": "और माँगें, नई सामग्री लाएँ",
        },
    },
    "id": {
        "PRE_CALL": {
            "INTENT_EASY": "Santai & ringan",
            "INTENT_CONVERSATIONAL": "Ngobrol",
            "INTENT_FOCUSED": "Fokus",
            "INTENT_CHALLENGE": "Tantang saya",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Preferensi siswa:",
            "INTENT_EASY_LABEL": "pelajaran santai dan ringan",
            "INTENT_EASY_HINT": "Tempo santai, sedikit koreksi",
            "INTENT_CONVERSATIONAL_LABEL": "obrolan bebas",
            "INTENT_CONVERSATIONAL_HINT": "Bicara bebas, biarkan siswa memimpin",
            "INTENT_FOCUSED_LABEL": "latihan fokus",
            "INTENT_FOCUSED_HINT": "Tetap pada topik, koreksi aktif",
            "INTENT_CHALLENGE_LABEL": "tantangan",
            "INTENT_CHALLENGE_HINT": "Tuntut lebih, perkenalkan materi baru",
        },
    },
    "ms": {
        "PRE_CALL": {
            "INTENT_EASY": "Santai & ringan",
            "INTENT_CONVERSATIONAL": "Perbualan",
            "INTENT_FOCUSED": "Fokus",
            "INTENT_CHALLENGE": "Cabar saya",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "Pilihan pelajar:",
            "INTENT_EASY_LABEL": "pelajaran santai dan ringan",
            "INTENT_EASY_HINT": "Rentak santai, pembetulan minimum",
            "INTENT_CONVERSATIONAL_LABEL": "perbualan bebas",
            "INTENT_CONVERSATIONAL_HINT": "Bercakap bebas, biarkan pelajar memimpin",
            "INTENT_FOCUSED_LABEL": "latihan fokus",
            "INTENT_FOCUSED_HINT": "Kekal pada topik, betulkan dengan kerap",
            "INTENT_CHALLENGE_LABEL": "cabaran",
            "INTENT_CHALLENGE_HINT": "Tuntut lebih, perkenalkan bahan baharu",
        },
    },
    "ar": {
        "PRE_CALL": {
            "INTENT_EASY": "مريح وخفيف",
            "INTENT_CONVERSATIONAL": "محادثة",
            "INTENT_FOCUSED": "مركّز",
            "INTENT_CHALLENGE": "تحدّني",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "تفضيل الطالب:",
            "INTENT_EASY_LABEL": "درس مريح وخفيف",
            "INTENT_EASY_HINT": "وتيرة هادئة، تصحيحات قليلة",
            "INTENT_CONVERSATIONAL_LABEL": "محادثة حرة",
            "INTENT_CONVERSATIONAL_HINT": "حديث حر، دع الطالب يقود",
            "INTENT_FOCUSED_LABEL": "ممارسة مركّزة",
            "INTENT_FOCUSED_HINT": "التزم بالموضوع، صحّح بنشاط",
            "INTENT_CHALLENGE_LABEL": "تحدٍّ",
            "INTENT_CHALLENGE_HINT": "اطلب أكثر، قدّم مادة جديدة",
        },
    },
    "he": {
        "PRE_CALL": {
            "INTENT_EASY": "רגוע וקליל",
            "INTENT_CONVERSATIONAL": "שיחה",
            "INTENT_FOCUSED": "ממוקד",
            "INTENT_CHALLENGE": "אתגר אותי",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "העדפת התלמיד:",
            "INTENT_EASY_LABEL": "שיעור רגוע וקליל",
            "INTENT_EASY_HINT": "קצב נינוח, מעט תיקונים",
            "INTENT_CONVERSATIONAL_LABEL": "שיחה חופשית",
            "INTENT_CONVERSATIONAL_HINT": "דיבור חופשי, תן לתלמיד להוביל",
            "INTENT_FOCUSED_LABEL": "תרגול ממוקד",
            "INTENT_FOCUSED_HINT": "הישאר בנושא, תקן באופן פעיל",
            "INTENT_CHALLENGE_LABEL": "אתגר",
            "INTENT_CHALLENGE_HINT": "דרוש יותר, הכנס חומר חדש",
        },
    },
    "fa": {
        "PRE_CALL": {
            "INTENT_EASY": "آرام و راحت",
            "INTENT_CONVERSATIONAL": "گفت‌وگو",
            "INTENT_FOCUSED": "متمرکز",
            "INTENT_CHALLENGE": "به من چالش بده",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "ترجیح دانش‌آموز:",
            "INTENT_EASY_LABEL": "درس آرام و راحت",
            "INTENT_EASY_HINT": "سرعت آهسته، اصلاحات کم",
            "INTENT_CONVERSATIONAL_LABEL": "گفت‌وگوی آزاد",
            "INTENT_CONVERSATIONAL_HINT": "صحبت آزاد، بگذار دانش‌آموز هدایت کند",
            "INTENT_FOCUSED_LABEL": "تمرین متمرکز",
            "INTENT_FOCUSED_HINT": "روی موضوع بمان، فعالانه اصلاح کن",
            "INTENT_CHALLENGE_LABEL": "چالش",
            "INTENT_CHALLENGE_HINT": "بیشتر بخواه، مطلب جدید معرفی کن",
        },
    },
    "th": {
        "PRE_CALL": {
            "INTENT_EASY": "สบายๆ ไม่หนัก",
            "INTENT_CONVERSATIONAL": "คุยสบายๆ",
            "INTENT_FOCUSED": "โฟกัส",
            "INTENT_CHALLENGE": "ท้าฉันหน่อย",
        },
        "VIDEO_CALL": {
            "STUDENT_WANTS": "นักเรียนต้องการ:",
            "INTENT_EASY_LABEL": "บทเรียนที่สบายและเบา",
            "INTENT_EASY_HINT": "จังหวะชิลๆ แก้ไขน้อย",
            "INTENT_CONVERSATIONAL_LABEL": "คุยอิสระ",
            "INTENT_CONVERSATIONAL_HINT": "คุยอิสระ ให้นักเรียนเป็นคนนำ",
            "INTENT_FOCUSED_LABEL": "ฝึกแบบโฟกัส",
            "INTENT_FOCUSED_HINT": "อยู่ในหัวข้อ แก้ไขอย่างสม่ำเสมอ",
            "INTENT_CHALLENGE_LABEL": "ความท้าทาย",
            "INTENT_CHALLENGE_HINT": "เร่งให้มากขึ้น นำเนื้อหาใหม่เข้ามา",
        },
    },
}

EN_VIDEO_CALL_INTENT = {
    "STUDENT_WANTS": "Student preference:",
    "INTENT_EASY_LABEL": "Relaxed & easy",
    "INTENT_EASY_HINT": "Easy pace, minimal corrections",
    "INTENT_CONVERSATIONAL_LABEL": "Conversational",
    "INTENT_CONVERSATIONAL_HINT": "Free talk, follow their lead",
    "INTENT_FOCUSED_LABEL": "Focused practice",
    "INTENT_FOCUSED_HINT": "Stay on topic, correct actively",
    "INTENT_CHALLENGE_LABEL": "Wants a challenge",
    "INTENT_CHALLENGE_HINT": "Push harder, introduce new material",
}


def main() -> None:
    en_path = I18N / "en.json"
    en_data = json.loads(en_path.read_text(encoding="utf-8"))
    en_data.setdefault("VIDEO_CALL", {}).update(EN_VIDEO_CALL_INTENT)
    en_path.write_text(json.dumps(en_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Updated en.json VIDEO_CALL intent strings")

    for locale, sections in FIXES.items():
        path = I18N / f"{locale}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        for section, keys in sections.items():
            data.setdefault(section, {}).update(keys)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Updated {locale}.json")

    print("Done.")


if __name__ == "__main__":
    main()
