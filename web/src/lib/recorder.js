// Audio recording for the Talk screen. The words are worked out on the server
// (transcribe function → OpenAI).
//
// Why not MediaRecorder: in an iPhone home-screen app it hands back empty
// files ("audio/mp4; codecs=", 0 bytes). So the raw microphone signal is
// read with Web Audio and turned into a 16 kHz mono WAV file here. That
// works the same on iPhone, Android and desktop.
// Tap to start, tap the green button to stop: no stopping on silence. Hard
// stop at 10 min (10 min of 16 kHz WAV is about 19 MB, under the 25 MB limit).

export const MAX_SECONDS = 600;
const TARGET_RATE = 16000;

export const canRecord = () =>
  typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || window.webkitAudioContext);

// One microphone stream for as long as Jarvis is open: iPhone asks for mic
// access each time a page calls getUserMedia afresh, so recordings reuse the
// same stream. Released when the app goes to the background.
let shared = null;
async function micStream() {
  if (shared && shared.getAudioTracks().some((t) => t.readyState === "live")) return shared;
  shared = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return shared;
}
export function releaseMic() {
  if (shared) { shared.getTracks().forEach((t) => t.stop()); shared = null; }
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") releaseMic(); });
}

// Average down to 16 kHz (speech needs no more) and join the pieces.
export function downsample(chunks, fromRate, toRate = TARGET_RATE) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  if (fromRate <= toRate) return all;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += all[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

// 16-bit PCM WAV.
export function encodeWav(samples, rate = TARGET_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

// Starts recording. onTick(seconds) and onLevel(0..1) drive the timer and the
// level meter; onLimit fires when the 10-minute cap is reached.
// Returns { stop(): Promise<Blob>, cancel() }.
export async function startRecording({ onTick, onLevel, onLimit } = {}) {
  // Made before any await, while the tap still counts as a user gesture
  // (iPhone only lets audio start from one).
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let stream;
  try {
    stream = await micStream();
    if (ctx.state === "suspended") await ctx.resume();
  } catch (e) {
    try { ctx.close(); } catch { /* closed */ }
    throw e;
  }
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let lastLevel = 0, stopped = false;
  proc.onaudioprocess = (e) => {
    if (stopped) return;
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    const now = performance.now();
    if (now - lastLevel > 50) {
      lastLevel = now;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] * data[i];
      onLevel?.(Math.min(1, Math.sqrt(sum / (data.length / 4)) * 4));
    }
  };
  src.connect(proc);
  proc.connect(ctx.destination); // Safari only runs the processor when it is connected; it outputs silence

  const started = Date.now();
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    onTick?.(s);
    if (s >= MAX_SECONDS) onLimit?.();
  }, 250);

  const finish = () => {
    stopped = true;
    clearInterval(tick);
    try { src.disconnect(); proc.disconnect(); } catch { /* already */ }
    const rate = ctx.sampleRate;
    try { ctx.close(); } catch { /* closed */ }
    return rate;
  };

  return {
    mime: "audio/wav",
    async stop() {
      const rate = finish();
      const samples = downsample(chunks, rate);
      if (samples.length < TARGET_RATE / 4) {
        releaseMic();
        throw new Error("Nothing was recorded (the mic gave no sound). Tap the mic and try again.");
      }
      return encodeWav(samples);
    },
    cancel() {
      finish();
      chunks.length = 0;
    },
  };
}

export const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
