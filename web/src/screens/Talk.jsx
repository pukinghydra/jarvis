import { useEffect, useRef, useState } from "react";
import { chat } from "../lib/supabase.js";
import { speechSupported, startListening, speak, stopSpeaking, unlockSpeech } from "../lib/speech.js";
import { prefs } from "../lib/prefs.js";

// The default screen. Tap the mic and talk (Swedish or English): Jarvis
// answers in text and out loud, and acts (adds items, checks mail, drafts
// replies, searches the web...). Typing works too. Without a Claude API key
// the words are saved as a note instead, like before.
export default function Talk({ onSaved }) {
  const [lang, setLang] = useState(prefs.lang());
  const [readAloud, setReadAloud] = useState(prefs.readAloud());
  const [messages, setMessages] = useState([]);
  const [claude, setClaude] = useState(true);
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [err, setErr] = useState("");
  const stopRef = useRef(null);
  const liveRef = useRef("");
  const sentRef = useRef(false);
  const endRef = useRef(null);
  const canListen = speechSupported();
  const svUi = lang.startsWith("sv");
  const t = (s, e) => (svUi ? s : e);

  useEffect(() => {
    chat("history").then((h) => { setClaude(h.claude !== false); setMessages(h.messages ?? []); }).catch(() => { /* empty conversation is fine */ });
    return () => { stopRef.current?.(); stopSpeaking(); };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, live, busy]);

  const shh = () => { stopSpeaking(); setSpeaking(false); };
  const say = (text, l) => {
    if (!readAloud || !text) return;
    setSpeaking(true);
    speak(text, l, { onEnd: () => setSpeaking(false) });
  };

  const send = async (text, source) => {
    const clean = (text ?? "").trim();
    if (!clean || sentRef.current) return;
    sentRef.current = true;
    setBusy(true); setErr(""); setLive(""); setTyped("");
    setMessages((m) => [...m, { role: "user", text: clean, actions: [] }]);
    try {
      const r = await chat("say", { text: clean, lang, source });
      setMessages((m) => [...m, { role: "assistant", text: r.reply_text, actions: r.actions ?? [] }]);
      if (r.mode === "note") setClaude(false);
      say(r.reply_text, r.lang || lang);
      onSaved?.();
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: e.message, actions: [], error: true }]);
      setTyped(clean);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (speaking) shh();
    if (listening) { stopRef.current?.(); return; }
    unlockSpeech(); // inside the tap: lets iOS read the answer out later
    setErr(""); setLive(""); liveRef.current = ""; sentRef.current = false;
    try {
      stopRef.current = startListening({
        lang,
        onText: (txt) => { liveRef.current = txt; setLive(txt); },
        onEnd: (final) => { setListening(false); send(final || liveRef.current, "voice"); },
        onError: (m) => { setErr(m); setListening(false); },
      });
      setListening(true);
    } catch (e) { setErr(`Mic didn't start: ${e.message}`); }
  };

  const sendTyped = () => { unlockSpeech(); sentRef.current = false; send(typed, "app"); };
  const newTopic = async () => {
    shh();
    try { await chat("new_topic"); setMessages([]); } catch (e) { setErr(e.message); }
  };
  const switchLang = (l) => { setLang(l); prefs.setLang(l); };
  const toggleAloud = () => { const v = !readAloud; setReadAloud(v); prefs.setReadAloud(v); if (!v) shh(); };

  return (
    <div className="screen talk">
      <div className="talk-top">
        <div className="lang-toggle">
          {["sv-SE", "en-US"].map((l) => (
            <button key={l} className={lang === l ? "on" : ""} onClick={() => switchLang(l)}>{l === "sv-SE" ? "Svenska" : "English"}</button>
          ))}
        </div>
        <button className="ghost small" onClick={toggleAloud} aria-label="Read answers aloud">{readAloud ? "🔊" : "🔇"}</button>
        {messages.length > 0 && <button className="ghost small" onClick={newTopic}>{t("Nytt ämne", "New topic")}</button>}
      </div>

      <div className="chat-log">
        {messages.length === 0 && !live && (
          <p className="muted center">
            {claude
              ? t("Tryck på mikrofonen och prata. Jarvis svarar och gör det åt dig: lägger till, kollar mejlen, skriver utkast, söker på nätet.", "Tap the mic and talk. Jarvis answers and does it for you: adds things, checks mail, drafts replies, searches the web.")
              : t("Tryck och prata: det sparas som en anteckning (ingen Claude API-nyckel).", "Tap and talk: it's saved as a note (no Claude API key).")}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}${m.error ? " error" : ""}`}>
            <div className="bubble-text">{m.text}</div>
            {m.actions?.length > 0 && (
              <div className="chips">
                {m.actions.map((a, j) => <span key={j} className={`chip${a.ok === false ? " bad" : ""}`}>{a.summary}</span>)}
              </div>
            )}
          </div>
        ))}
        {live && <div className="bubble user live">{live}</div>}
        {busy && <div className="bubble assistant thinking">{t("Tänker…", "Thinking…")}</div>}
        <div ref={endRef} />
      </div>

      {err && <div className="err">{err}</div>}

      <div className="talk-bottom">
        {canListen ? (
          <button className={`mic${listening ? " live" : ""}${messages.length ? " small-mic" : ""}`} onClick={toggleMic} disabled={busy} aria-label={listening ? "Stop" : "Talk"}>
            {busy ? "…" : listening ? "■" : "🎙"}
          </button>
        ) : (
          <p className="muted small center">{t("Röst funkar inte här. Skriv nedan (tangentbordets mikrofon funkar också).", "Voice isn't available here. Type below (the keyboard's mic works too).")}</p>
        )}
        <p className="hint center">
          {busy ? t("Jarvis tänker…", "Jarvis is thinking…") : listening ? t("Lyssnar… tryck för att stoppa", "Listening… tap to stop") : speaking ? t("Pratar…", "Talking…") : canListen ? t("Tryck och prata", "Tap and talk") : ""}
          {speaking && <button className="ghost small stop-talk" onClick={shh}>{t("Tyst", "Stop talking")}</button>}
        </p>
        <div className="type-box">
          <textarea className="input" rows={1} placeholder={t("…eller skriv", "…or type")} value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (typed.trim() && !busy) sendTyped(); } }} />
          <button className="primary" disabled={busy || !typed.trim()} onClick={sendTyped}>{t("Skicka", "Send")}</button>
        </div>
      </div>
    </div>
  );
}
