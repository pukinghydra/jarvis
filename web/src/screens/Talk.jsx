import { useEffect, useRef, useState } from "react";
import { chat, transcribe } from "../lib/supabase.js";
import { canRecord, clock, startRecording, MAX_SECONDS } from "../lib/recorder.js";
import { prefs } from "../lib/prefs.js";

// The default screen. Tap the mic to record, tap again to stop. The
// recording is turned into text on the server; VIC checks/edits it, then
// "Skicka" sends it to Jarvis (or "Börja om" throws it away). Answers are
// text only. Without a speech-to-text key the mic opens the keyboard so the
// keyboard's own 🎤 dictation can be used. Typing always works.
export default function Talk({ onSaved }) {
  const [lang, setLang] = useState(prefs.lang());
  const [messages, setMessages] = useState([]);
  const [claude, setClaude] = useState(true);
  const [stt, setStt] = useState(undefined);         // undefined = checking, null = none
  const [mode, setMode] = useState("idle");          // idle | recording | transcribing | review
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [draft, setDraft] = useState("");            // the transcript being checked
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hint, setHint] = useState("");
  const recRef = useRef(null);
  const blobRef = useRef(null);
  const typeRef = useRef(null);
  const endRef = useRef(null);
  const sv = lang.startsWith("sv");
  const t = (_sv, en) => en; // UI is English; what VIC says and Jarvis answers keep their own language
  const recordable = canRecord() && !!stt;

  useEffect(() => {
    chat("history").then((h) => { setClaude(h.claude !== false); setMessages(h.messages ?? []); }).catch(() => { /* empty conversation is fine */ });
    transcribe({ check: true }).then((r) => setStt(r.provider ?? null)).catch(() => setStt(null));
    return () => recRef.current?.cancel();
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy, mode]);

  const send = async (text, source) => {
    const clean = (text ?? "").trim();
    if (!clean || busy) return;
    setBusy(true); setErr("");
    setMessages((m) => [...m, { role: "user", text: clean, actions: [] }]);
    try {
      const r = await chat("say", { text: clean, lang, source });
      setMessages((m) => [...m, { role: "assistant", text: r.reply_text, actions: r.actions ?? [] }]);
      if (r.mode === "note") setClaude(false);
      if (source === "voice") { setDraft(""); setMode("idle"); blobRef.current = null; } else setTyped("");
      onSaved?.();
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: e.message, actions: [], error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const runTranscribe = async (blob) => {
    setMode("transcribing"); setErr("");
    try {
      const r = await transcribe(blob);
      const text = (r.text ?? "").trim();
      if (!text) { setErr(t("Hörde inget. Försök igen, närmare mikrofonen.", "Heard nothing. Try again, closer to the mic.")); setMode("idle"); return; }
      blobRef.current = null;
      setDraft(text); setMode("review");
    } catch (e) {
      setErr(e.message); setMode("idle");
    }
  };

  const startRec = async () => {
    setErr(""); setHint(""); setSecs(0); setLevel(0); blobRef.current = null;
    try {
      recRef.current = await startRecording({
        onTick: setSecs,
        onLevel: setLevel,
        onLimit: () => setHint(t("Max 10 minuter: stoppat.", "10 minute limit: stopped.")),
      });
      setMode("recording");
    } catch (e) {
      const blocked = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      setErr(blocked
        ? t("Mikrofonen är blockerad: tillåt den i Inställningar > Safari > Mikrofon (eller för appen).", "Microphone blocked: allow it in Settings > Safari > Microphone.")
        : t(`Mikrofonen startade inte: ${e.message}`, `Mic didn't start: ${e.message}`));
      recRef.current = null;
    }
  };

  const stopRec = async () => {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    setMode("transcribing");
    let blob;
    try { blob = await rec.stop(); } catch (e) { setErr(e.message); setMode("idle"); return; }
    blobRef.current = blob;
    runTranscribe(blob);
  };

  const cancelRec = () => { recRef.current?.cancel(); recRef.current = null; blobRef.current = null; setMode("idle"); setSecs(0); setLevel(0); };
  const restart = () => { setDraft(""); setErr(""); blobRef.current = null; setMode("idle"); };

  const micTap = () => {
    if (busy) return;
    if (mode === "recording") { stopRec(); return; }
    if (mode !== "idle") return;
    if (!recordable) {
      typeRef.current?.focus();
      setHint(t("Tryck på tangentbordets 🎤 för att diktera.", "Tap the keyboard's 🎤 to dictate."));
      return;
    }
    startRec();
  };

  // Stop when the recording hits the cap.
  useEffect(() => { if (mode === "recording" && secs >= MAX_SECONDS) stopRec(); }, [secs, mode]);

  const newTopic = async () => {
    try { await chat("new_topic"); setMessages([]); } catch (e) { setErr(e.message); }
  };
  const switchLang = (l) => { setLang(l); prefs.setLang(l); };

  const micLabel = busy ? "…" : mode === "recording" ? "■" : mode === "transcribing" ? "…" : "🎙";
  const status =
    busy ? t("Jarvis tänker…", "Jarvis is thinking…")
    : mode === "recording" ? `${clock(secs)} · ${t("tryck för att stoppa", "tap to stop")}`
    : mode === "transcribing" ? t("Skriver ut…", "Transcribing…")
    : mode === "review" ? t("Kolla texten, ändra om du vill", "Check the text, edit if needed")
    : stt === undefined ? ""
    : recordable ? t("Tryck och prata, tryck igen när du är klar", "Tap and talk, tap again when done")
    : t("Tryck: tangentbordet öppnas, använd dess 🎤", "Tap: the keyboard opens, use its 🎤");

  return (
    <div className="screen talk">
      <div className="talk-top">
        <span />
        {messages.length > 0 && <button className="ghost small" onClick={newTopic}>{t("Nytt ämne", "New topic")}</button>}
      </div>

      <div className="chat-log">
        {messages.length === 0 && mode === "idle" && (
          <p className="muted center">
            {claude
              ? t("Tryck på mikrofonen och prata. Jarvis svarar och gör det åt dig: lägger till, kollar mejlen, skriver utkast, söker på nätet.", "Tap the mic and talk. Jarvis answers and does it for you: adds things, checks mail, drafts replies, searches the web.")
              : t("Det du säger sparas som en anteckning (ingen Claude API-nyckel).", "What you say is saved as a note (no Claude API key).")}
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
        {busy && <div className="bubble assistant thinking">{t("Tänker…", "Thinking…")}</div>}
        <div ref={endRef} />
      </div>

      {err && (
        <div className="err">
          {err}
          {blobRef.current && mode === "idle" && <button className="ghost small retry" onClick={() => runTranscribe(blobRef.current)}>{t("Försök igen", "Try again")}</button>}
        </div>
      )}

      <div className="talk-bottom">
        {mode === "review" ? (
          <div className="review">
            <textarea className="input review-text" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="review-buttons">
              <button className="ghost big" onClick={restart} disabled={busy}>{t("Börja om", "Start over")}</button>
              <button className="primary big" onClick={() => send(draft, "voice")} disabled={busy || !draft.trim()}>{busy ? "…" : t("Skicka", "Send")}</button>
            </div>
          </div>
        ) : (
          <>
            <button className={`mic${mode === "recording" ? " live" : ""}${messages.length ? " small-mic" : ""}`} onClick={micTap}
              disabled={busy || mode === "transcribing"} aria-label={mode === "recording" ? "Stop" : "Talk"}>
              {micLabel}
            </button>
            {mode === "recording" && (
              <div className="rec-row">
                <div className="meter" aria-hidden="true"><div className={`meter-fill${level ? "" : " pulse"}`} style={level ? { width: `${Math.round(level * 100)}%` } : undefined} /></div>
                <button className="ghost small" onClick={cancelRec}>{t("Avbryt", "Cancel")}</button>
              </div>
            )}
            <p className="hint center">{status}</p>
            {hint && <p className="muted small center">{hint}</p>}
          </>
        )}
        {mode !== "review" && (
          <div className="type-box">
            <textarea ref={typeRef} className="input" rows={1} placeholder={t("…eller skriv", "…or type")} value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (typed.trim() && !busy) send(typed, "app"); } }} />
            <button className="primary" disabled={busy || !typed.trim()} onClick={() => send(typed, "app")}>{t("Skicka", "Send")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
