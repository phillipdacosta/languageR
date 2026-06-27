"""
Voiceprint audio sidecar (Phase 1).

A small, self-hosted FastAPI service that turns short audio clips into speaker
embeddings (SpeechBrain ECAPA-TDNN) and scores them. The Node backend uses it to
solve the "repeat-after-me" mic-bleed problem WITHOUT discarding genuine student
speech: instead of the blunt time-overlap filter (which drops every student
segment that coincides with tutor audio), we compare each overlapping segment to
the student's own voiceprint vs. the tutor's, and keep the ones that are really
the student.

No per-request API cost — this is local compute. The ECAPA model (~80 MB) is
downloaded once on first run and cached.

Endpoints
  GET  /health                      → liveness + model status
  POST /embed     (file)            → { embedding: float[192] }
  POST /verify    (file, file)      → { similarity, sameSpeaker }
  POST /classify  (file, JSON refs) → { label, studentScore, tutorScore, margin }

Run:
  pip install -r requirements.txt
  uvicorn app:app --host 0.0.0.0 --port 8077
"""
import io
import json
import subprocess
import tempfile
import os
from typing import List, Optional

import numpy as np
import torch
from fastapi import FastAPI, File, UploadFile, Form, HTTPException

app = FastAPI(title="voiceprint-sidecar", version="1.0")

# Decision thresholds. Tunable via env so we can calibrate against the offline
# fixtures without code changes.
SAME_SPEAKER_THRESHOLD = float(os.environ.get("VP_SAME_SPEAKER_THRESHOLD", "0.25"))
CLASSIFY_MARGIN = float(os.environ.get("VP_CLASSIFY_MARGIN", "0.05"))
TARGET_SR = 16000

_classifier = None


def _get_classifier():
    """Lazy-load ECAPA-TDNN so the process starts fast and only pays the model
    load + download cost on first real request."""
    global _classifier
    if _classifier is None:
        from speechbrain.inference.speaker import EncoderClassifier
        _classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=os.environ.get("VP_MODEL_DIR", "pretrained_models/spkrec-ecapa-voxceleb"),
            run_opts={"device": "cpu"},
        )
    return _classifier


def _decode_to_wave(raw: bytes) -> torch.Tensor:
    """Decode arbitrary audio bytes (webm/opus/mp3/wav) to a mono 16 kHz float
    tensor via ffmpeg. ffmpeg handles the container/codec zoo Whisper accepts."""
    with tempfile.NamedTemporaryFile(suffix=".in", delete=False) as fin:
        fin.write(raw)
        in_path = fin.name
    out_path = in_path + ".wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", in_path, "-ac", "1", "-ar", str(TARGET_SR),
             "-f", "wav", out_path],
            check=True, capture_output=True,
        )
        import soundfile as sf
        data, _sr = sf.read(out_path, dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        return torch.from_numpy(data).unsqueeze(0)
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=400, detail=f"audio decode failed: {e.stderr[:200]}")
    finally:
        for p in (in_path, out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


def _embed(raw: bytes) -> np.ndarray:
    signal = _decode_to_wave(raw)
    if signal.shape[-1] < TARGET_SR * 0.2:  # < 0.2s is too short to embed reliably
        raise HTTPException(status_code=422, detail="audio too short to embed (<0.2s)")
    emb = _get_classifier().encode_batch(signal).squeeze().detach().cpu().numpy()
    return emb.astype(np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    return float(np.dot(a, b) / denom) if denom else 0.0


@app.get("/health")
def health():
    return {"ok": True, "modelLoaded": _classifier is not None,
            "sameSpeakerThreshold": SAME_SPEAKER_THRESHOLD, "classifyMargin": CLASSIFY_MARGIN}


@app.post("/embed")
async def embed(file: UploadFile = File(...)):
    emb = _embed(await file.read())
    return {"embedding": emb.tolist()}


@app.post("/verify")
async def verify(file_a: UploadFile = File(...), file_b: UploadFile = File(...)):
    ea = _embed(await file_a.read())
    eb = _embed(await file_b.read())
    sim = _cosine(ea, eb)
    return {"similarity": sim, "sameSpeaker": sim >= SAME_SPEAKER_THRESHOLD}


@app.post("/classify")
async def classify(
    file: UploadFile = File(...),
    student_ref: str = Form(...),  # JSON float[] embedding
    tutor_ref: Optional[str] = Form(None),
):
    """Decide whether a segment is the student or the tutor (bleed). Compares the
    segment embedding to the enrolled student voiceprint vs. the tutor's. The
    Node side builds the refs once per lesson from clean (non-overlapping) audio."""
    seg = _embed(await file.read())
    s_ref = np.asarray(json.loads(student_ref), dtype=np.float32)
    student_score = _cosine(seg, s_ref)
    tutor_score = None
    if tutor_ref:
        t_ref = np.asarray(json.loads(tutor_ref), dtype=np.float32)
        tutor_score = _cosine(seg, t_ref)

    if tutor_score is None:
        label = "student" if student_score >= SAME_SPEAKER_THRESHOLD else "unknown"
        margin = student_score - SAME_SPEAKER_THRESHOLD
    else:
        margin = student_score - tutor_score
        if abs(margin) < CLASSIFY_MARGIN:
            label = "uncertain"
        else:
            label = "student" if margin > 0 else "tutor"

    return {"label": label, "studentScore": student_score,
            "tutorScore": tutor_score, "margin": margin}
