// Web Speech API dictation (Safari/Chrome). Continuous with live text.
// iOS stops listening after a pause; onEnd fires and the caller sends.
export const speechSupported = () => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

export function startListening({ lang, onText, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += `${r[0].transcript} `;
      else interim += r[0].transcript;
    }
    onText((finalText + interim).replace(/\s+/g, " ").trim());
  };
  rec.onerror = (e) => onError?.(e.error === "not-allowed" ? "Microphone blocked: allow it in Settings > Safari (or the browser) > Microphone." : `Speech error: ${e.error}`);
  rec.onend = () => onEnd?.(finalText.replace(/\s+/g, " ").trim());
  rec.start();
  return () => { try { rec.stop(); } catch { /* already stopped */ } };
}

export function speak(text, lang) {
  try {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    window.speechSynthesis.speak(u);
  } catch { /* no speech */ }
}
export const stopSpeaking = () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };
