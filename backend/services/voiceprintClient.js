/**
 * Client for the Phase 1 voiceprint audio sidecar (backend/audio-sidecar).
 *
 * Turns audio clips into speaker embeddings and classifies a clip as the
 * student vs. the tutor, so the analysis pipeline can keep genuine
 * repeat-after-me speech instead of bluntly dropping every student segment that
 * overlaps tutor audio.
 *
 * Fail-soft by design: if the sidecar is unset or unreachable, every call
 * resolves to a null/uncertain result so callers transparently fall back to the
 * existing time-overlap + text-dedup heuristics. The pipeline must never break
 * because the sidecar is down.
 *
 * Enabled only when VOICEPRINT_SIDECAR_URL is set (e.g. http://localhost:8077).
 */
const SIDECAR_URL = (process.env.VOICEPRINT_SIDECAR_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = parseInt(process.env.VOICEPRINT_TIMEOUT_MS || '8000', 10);

function isEnabled() {
  return !!SIDECAR_URL;
}

async function _fetch(path, formData) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SIDECAR_URL}${path}`, {
      method: 'POST',
      body: formData,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`sidecar ${path} ${res.status}: ${detail.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function _blob(buffer, mime = 'audio/webm') {
  return new Blob([buffer], { type: mime });
}

/** Liveness check. Returns the parsed /health body or null if unreachable. */
async function health() {
  if (!isEnabled()) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${SIDECAR_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Embed one audio clip → Float[] embedding, or null on any failure. */
async function embed(buffer, mime = 'audio/webm') {
  if (!isEnabled() || !buffer) return null;
  try {
    const fd = new FormData();
    fd.append('file', _blob(buffer, mime), 'clip.webm');
    const json = await _fetch('/embed', fd);
    return Array.isArray(json.embedding) ? json.embedding : null;
  } catch (err) {
    console.warn(`⚠️ voiceprint embed failed (falling back): ${err.message}`);
    return null;
  }
}

/**
 * Classify a segment clip against the student voiceprint (and optionally the
 * tutor's). Returns { label, studentScore, tutorScore, margin } or null.
 * label ∈ 'student' | 'tutor' | 'uncertain' | 'unknown'.
 */
async function classify(buffer, studentRef, tutorRef = null, mime = 'audio/webm') {
  if (!isEnabled() || !buffer || !Array.isArray(studentRef)) return null;
  try {
    const fd = new FormData();
    fd.append('file', _blob(buffer, mime), 'seg.webm');
    fd.append('student_ref', JSON.stringify(studentRef));
    if (Array.isArray(tutorRef)) fd.append('tutor_ref', JSON.stringify(tutorRef));
    return await _fetch('/classify', fd);
  } catch (err) {
    console.warn(`⚠️ voiceprint classify failed (falling back): ${err.message}`);
    return null;
  }
}

/**
 * Average a list of embeddings into one enrollment vector (mean-pool). Used to
 * build a stable student/tutor voiceprint from several clean clips.
 */
function poolEmbeddings(embeddings) {
  const valid = (embeddings || []).filter(e => Array.isArray(e) && e.length);
  if (valid.length === 0) return null;
  const dim = valid[0].length;
  const acc = new Array(dim).fill(0);
  for (const e of valid) {
    for (let i = 0; i < dim; i++) acc[i] += e[i];
  }
  return acc.map(v => v / valid.length);
}

module.exports = { isEnabled, health, embed, classify, poolEmbeddings };
