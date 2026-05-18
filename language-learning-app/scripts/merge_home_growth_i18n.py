#!/usr/bin/env python3
"""Merge HOME.GROWTH (+ HOME.PER_STUDENT) from en.json into all other locale JSON files."""
import json
import os

BASE = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "i18n")
EN_PATH = os.path.join(BASE, "en.json")

with open(EN_PATH, encoding="utf-8") as f:
    en = json.load(f)

growth = en["HOME"].get("GROWTH")
per_student = en["HOME"].get("PER_STUDENT")
if not growth:
    raise SystemExit("en.json missing HOME.GROWTH")

# Spanish (es) — full translations for tutor home growth UI
ES_GROWTH = {
    "VIEW_ALL": "Ver todo",
    "DISMISS": "Cerrar",
    "MODAL_TITLE": "Sugerencias para ti",
    "MODAL_SHOW_AGAIN": "Mostrar de nuevo",
    "PROFILE_PROGRESS": "{{done}} / {{total}} completado",
    "PROFILE_HIDDEN": "Oculto para estudiantes",
    "CHECKLIST_PHOTO": "Foto de perfil",
    "CHECKLIST_VIDEO": "Vídeo de presentación",
    "CHECKLIST_VIDEO_PENDING": "Vídeo de presentación (pendiente de revisión)",
    "CHECKLIST_CREDENTIALS": "Credenciales",
    "CHECKLIST_CREDENTIALS_PENDING": "Credenciales (pendiente de revisión)",
    "CHECKLIST_PAYOUT": "Método de pago",
    "INSIGHT_PROFILE_PHOTO": "Sube una foto de perfil: tu perfil está oculto hasta que lo hagas",
    "INSIGHT_PROFILE_VIDEO": "Sube un vídeo de presentación para aparecer en el listado",
    "INSIGHT_VIDEO_PENDING": "Tu vídeo de presentación está pendiente de revisión",
    "INSIGHT_UPLOAD_CREDENTIALS": "Sube tus credenciales para verificarte",
    "INSIGHT_CREDENTIALS_PENDING": "Tus credenciales están pendientes de revisión",
    "INSIGHT_CONNECT_PAYOUT": "Conecta un método de cobro para recibir pagos",
    "INSIGHT_SET_AVAILABILITY": "Configura tu disponibilidad para empezar a recibir reservas",
    "INSIGHT_PENDING_FEEDBACK_ONE": "1 feedback pendiente: completarlo mejora tu posicionamiento",
    "INSIGHT_PENDING_FEEDBACK_MANY": "{{count}} feedbacks pendientes: completarlos mejora tu posicionamiento",
    "INSIGHT_UNREAD_ONE": "1 mensaje sin leer: responder rápido genera confianza",
    "INSIGHT_UNREAD_MANY": "{{count}} mensajes sin leer: responder rápido genera confianza",
    "INSIGHT_FORUM_ONE": "1 hilo activo en tu idioma: participa para darte a conocer",
    "INSIGHT_FORUM_MANY": "{{count}} hilos activos en tu idioma: participa para darte a conocer",
    "MAT_STATS_V": "Tus materiales: {{v}} visualizaciones nuevas",
    "MAT_STATS_Q": "Tus materiales: {{q}} intentos de cuestionario nuevos",
    "MAT_STATS_P": "Tus materiales: {{p}} compras nuevas",
    "MAT_STATS_VQ": "Tus materiales: {{v}} visualizaciones nuevas, {{q}} intentos de cuestionario nuevos",
    "MAT_STATS_VP": "Tus materiales: {{v}} visualizaciones nuevas, {{p}} compras nuevas",
    "MAT_STATS_QP": "Tus materiales: {{q}} intentos de cuestionario nuevos, {{p}} compras nuevas",
    "MAT_STATS_VQP": "Tus materiales: {{v}} visualizaciones nuevas, {{q}} intentos de cuestionario nuevos, {{p}} compras nuevas",
    "INSIGHT_CREATE_MATERIAL": "Han pasado {{days}} días desde tu último material: el contenido nuevo impulsa visitas al perfil",
    "INSIGHT_CREATE_MATERIAL_STALE": "{{days}} días sin contenido nuevo: el material fresco mantiene el interés",
    "INSIGHT_FIRST_MATERIAL": "Crea tu primer material: los estudiantes miran contenido antes de reservar",
    "INSIGHT_FIRST_MATERIAL_NUDGE": "Los estudiantes buscan contenido al elegir tutor: incluso un cuestionario ayuda",
    "INSIGHT_OFFICE_GAP": "{{hours}} h entre tus próximas clases: las horas de consulta podrían llenar ese hueco",
    "INSIGHT_OFFICE_FREE": "{{hours}} horas libres esta semana: activa horas de consulta para estudiantes espontáneos",
    "INSIGHT_GROUP_CLASS": "Sin clase grupal en {{days}} días: tus {{students}} estudiantes podrían beneficiarse",
    "INSIGHT_FIRST_GROUP_CLASS": "Tienes {{students}} estudiantes: una clase grupal es una buena forma de involucrarlos",
    "INSIGHT_MORNING_PREP_ONE": "1 clase hoy: repasa tus notas antes de que empiece",
    "INSIGHT_MORNING_PREP_MANY": "{{count}} clases hoy: repasa tus notas antes de que empiecen",
    "INSIGHT_EVENING_RECAP_ONE": "1 clase hecha hoy: buena sesión, {{name}}",
    "INSIGHT_EVENING_RECAP_MANY": "{{count}} clases hechas hoy: buenas sesiones, {{name}}",
    "INSIGHT_SHARE_PROFILE": "Tu perfil está publicado: comparte el enlace para conseguir tu primera reserva",
}

ES_PER = "por estudiante"

for fn in sorted(os.listdir(BASE)):
    if not fn.endswith(".json") or fn == "en.json":
        continue
    path = os.path.join(BASE, fn)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if "HOME" not in data:
        continue
    code = fn.replace(".json", "")
    if code == "es":
        data["HOME"]["GROWTH"] = ES_GROWTH
        data["HOME"]["PER_STUDENT"] = ES_PER
    else:
        data["HOME"]["GROWTH"] = json.loads(json.dumps(growth))
        if per_student is not None:
            data["HOME"]["PER_STUDENT"] = per_student
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("merged", fn)

print("done")
