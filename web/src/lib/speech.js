// Web Speech API: dictation in (Safari/Chrome) and reading answers out.
export const speechSupported = () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// Listen until VIC taps again or stops talking for `silenceMs`. Live text
// goes to onText; onEnd gets the final text once. If nothing is heard at
// all it stops after 8 s so the mic never hangs open.
export function startListening({ lang, onText, onEnd, onError, silenceMs = 1500 }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = "";
  let latest = "";
  let timer = null;
  let ended = false;
  const stop = () => { try { rec.stop(); } catch { /* already stopped */ } };
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(stop, ms); };
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += `${r[0].transcript} `;
      else interim += r[0].transcript;
    }
    latest = (finalText + interim).replace(/\s+/g, " ").trim();
    onText?.(latest);
    arm(silenceMs);
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    onError?.(e.error === "not-allowed" ? "Microphone blocked: allow it in Settings > Safari (or the browser) > Microphone." : `Speech error: ${e.error}`);
  };
  rec.onend = () => {
    clearTimeout(timer);
    if (ended) return;
    ended = true;
    onEnd?.(finalText.replace(/\s+/g, " ").trim() || latest);
  };
  rec.start();
  arm(8000);
  return stop;
}

function pickVoice(lang) {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  const want = String(lang || "").toLowerCase();
  const base = want.slice(0, 2);
  return voices.find((v) => v.lang?.toLowerCase() === want && v.localService)
    ?? voices.find((v) => v.lang?.toLowerCase() === want)
    ?? voices.find((v) => v.lang?.toLowerCase().startsWith(base))
    ?? null;
}

// iOS only lets a page speak after a tap: call this inside the tap handler
// (the mic button) so the answer that arrives later can be read out.
export function unlockSpeech() {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch { /* no speech */ }
}

// Plain words only: no links or markdown read out loud.
const speakable = (text) => String(text ?? "")
  .replace(/\bhttps?:\/\/\S+/g, "")
  .replace(/[*_#`>]+/g, "")
  .replace(/\s+/g, " ")
  .trim();

export function speak(text, lang, { onEnd } = {}) {
  try {
    const t = speakable(text);
    if (!("speechSynthesis" in window) || !t) { onEnd?.(); return false; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang;
    const v = pickVoice(lang);
    if (v) u.voice = v;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    window.speechSynthesis.speak(u);
    return true;
  } catch { onEnd?.(); return false; }
}
export const stopSpeaking = () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };
