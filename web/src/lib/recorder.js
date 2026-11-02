// Real audio recording for the Talk screen (MediaRecorder). The words are
// worked out on the server (transcribe function), which hears far better
// than the iPhone's built-in recognition in a home-screen app.
// Tap to start, tap to stop: no stopping on silence. Hard stop at 10 min.

export const MAX_SECONDS = 600;

export const canRecord = () =>
  typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window.MediaRecorder !== "undefined";

// iPhone Safari records mp4 (AAC); Chrome/Firefox webm/ogg (Opus).
export function pickMime() {
  const MR = window.MediaRecorder;
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"]) {
    try { if (MR.isTypeSupported?.(t)) return t; } catch { /* keep looking */ }
  }
  return "";
}

// Starts recording. onTick(seconds) and onLevel(0..1) drive the timer and the
// level meter; onLimit fires when the 10-minute cap stops it.
// Returns { stop(): Promise<Blob>, cancel() }.
export async function startRecording({ onTick, onLevel, onLimit } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  // Level meter: RMS of the mic signal, ~20 times a second.
  let ctx = null, raf = 0;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let last = 0;
    const loop = (t) => {
      if (t - last > 50) {
        last = t;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 3));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  } catch { /* no meter, recording still works */ }

  const started = Date.now();
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    onTick?.(s);
    if (s >= MAX_SECONDS && rec.state === "recording") { onLimit?.(); try { rec.stop(); } catch { /* stopped */ } }
  }, 250);

  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  rec.onstop = () => done();

  const cleanup = () => {
    clearInterval(tick);
    cancelAnimationFrame(raf);
    try { ctx?.close(); } catch { /* closed */ }
    stream.getTracks().forEach((t) => t.stop());
  };

  rec.start(1000); // a chunk every second, so nothing is lost if iOS hiccups
  return {
    mime: rec.mimeType || mime || "audio/mp4",
    async stop() {
      if (rec.state !== "inactive") { try { rec.requestData?.(); } catch { /* ignore */ } rec.stop(); }
      await finished;
      cleanup();
      return new Blob(chunks, { type: (rec.mimeType || mime || "audio/mp4").split(";")[0] });
    },
    cancel() {
      try { if (rec.state !== "inactive") rec.stop(); } catch { /* stopped */ }
      cleanup();
      chunks.length = 0;
    },
  };
}

export const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
