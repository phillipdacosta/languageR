# Voiceprint Audio Sidecar (Phase 1)

Self-hosted speaker-embedding service that replaces the blunt time-overlap
mic-bleed filter. Instead of dropping every student segment that overlaps tutor
speech, the Node backend asks this service "is this clip the student or the
tutor?" and keeps genuine repeat-after-me speech.

**Cost:** local compute only — no per-request API charge. Model (~80 MB) is
downloaded once and cached.

## Setup

```bash
cd backend/audio-sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt        # ffmpeg must be on PATH (brew install ffmpeg)
uvicorn app:app --host 0.0.0.0 --port 8077
```

First real request downloads the ECAPA-TDNN model. Verify:

```bash
curl localhost:8077/health
```

## Endpoints

| Method | Path        | Body                                   | Returns |
|--------|-------------|----------------------------------------|---------|
| GET    | `/health`   | —                                      | liveness + thresholds |
| POST   | `/embed`    | `file` (audio)                         | `{ embedding: float[192] }` |
| POST   | `/verify`   | `file_a`, `file_b`                     | `{ similarity, sameSpeaker }` |
| POST   | `/classify` | `file` + `student_ref` (+ `tutor_ref`) | `{ label, studentScore, tutorScore, margin }` |

`label` ∈ `student | tutor | uncertain`.

## How Node uses it (per lesson)

1. Build a **student voiceprint** by `/embed`-ing the student's clean
   (non-overlapping) audio, and a **tutor voiceprint** from the tutor reference
   track.
2. For each student segment the time-overlap filter *would* have dropped,
   `/classify` its audio against both refs.
   - `student` → keep (genuine repeat-after-me)
   - `tutor`   → drop (real bleed)
   - `uncertain` → fall back to current heuristics (text-dedup)

Tunable via env: `VP_SAME_SPEAKER_THRESHOLD`, `VP_CLASSIFY_MARGIN`.

## Tuning offline

Point the Node client at this service (`VOICEPRINT_SIDECAR_URL=http://localhost:8077`)
and run the eval harness against preserved fixtures — no live lessons required.
