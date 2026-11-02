import { useEffect, useRef, useState } from "react";
import { captureNote, supabase, must } from "../lib/supabase.js";
import { speechSupported, startListening, speak } from "../lib/speech.js";
import { prefs } from "../lib/prefs.js";
import { when, dayLabel, time } from "../lib/time.js";

// Opens on the mic. Tap, talk, tap again (or just stop talking): the note is
// saved. With no Claude API key it waits as an unsorted note for Claude (in
// the Claude app) to sort; with a key it becomes items straight away.
export default function Capture({ lanes, onSaved }) {
  const [lang, setLang] = useState(prefs.lang());
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [notes, setNotes] = useState([]);
  const stopRef = useRef(null);
  const liveRef = useRef("");
  const sentRef = useRef(false);
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const canSpeak = speechSupported();

  const loadNotes = async () => {
    try { setNotes(must(await supabase.from("captures").select("id, short_id, text, status, created_at").order("created_at", { ascending: false }).limit(8)) ?? []); } catch { /* list is optional */ }
  };
  useEffect(() => { loadNotes(); }, []);

  const send = async (t, source) => {
    const clean = (t ?? "").trim();
    if (!clean || sentRef.current) return;
    sentRef.current = true;
    setBusy(true); setErr(""); setResult(null);
    try {
      const r = await captureNote(clean, lang, source);
      setResult(r);
      setLive(""); setTyped("");
      if (prefs.readBack()) speak(r.reply, lang);
      loadNotes(); onSaved?.();
    } catch (e) {
      setErr(`Not saved: ${e.message}. Your words are still in the box below.`);
      setTyped(clean);
    } finally { setBusy(false); }
  };

  const toggleMic = () => {
    if (listening) { stopRef.current?.(); return; }
    setErr(""); setResult(null); setLive(""); liveRef.current = ""; sentRef.current = false;
    try {
      stopRef.current = startListening({
        lang,
        onText: (t) => { liveRef.current = t; setLive(t); },
        onEnd: (final) => { setListening(false); send(final || liveRef.current, "voice"); },
        onError: (m) => { setErr(m); setListening(false); },
      });
      setListening(true);
    } catch (e) { setErr(`Mic didn't start: ${e.message}`); }
  };

  const undo = async () => {
    if (!result) return;
    try {
      if (result.items?.length) must(await supabase.from("items").delete().in("id", result.items.map((i) => i.id)));
      must(await supabase.from("captures").delete().eq("id", result.capture_id));
      setResult(null); loadNotes(); onSaved?.();
    } catch (e) { setErr(e.message); }
  };

  const switchLang = (l) => { setLang(l); prefs.setLang(l); };

  return (
    <div className="screen capture">
      <div className="lang-toggle">
        {["sv-SE", "en-US"].map((l) => (
          <button key={l} className={lang === l ? "on" : ""} onClick={() => switchLang(l)}>{l === "sv-SE" ? "Svenska" : "English"}</button>
        ))}
      </div>

      {canSpeak ? (
        <button className={`mic${listening ? " live" : ""}`} onClick={toggleMic} disabled={busy} aria-label={listening ? "Stop" : "Talk"}>
          {busy ? "…" : listening ? "■" : "🎙"}
        </button>
      ) : (
        <p className="muted center">Voice isn't available in this browser. Type below (the keyboard's mic works too).</p>
      )}
      <p className="hint center">{busy ? "Saving…" : listening ? "Listening… tap to stop" : canSpeak ? "Tap and talk" : ""}</p>
      {live && <div className="live-text">{live}</div>}

      <div className="type-box">
        <textarea className="input" rows={2} placeholder="…or type a note" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="primary" disabled={busy || !typed.trim()} onClick={() => { sentRef.current = false; send(typed, "app"); }}>Save</button>
      </div>

      {err && <div className="err">{err}</div>}

      {result && (
        <div className="result">
          <div className="reply">{result.reply}</div>
          {result.items?.map((i) => {
            const l = laneById.get(i.lane_id);
            return (
              <div key={i.id} className="card mini" style={{ borderLeftColor: l?.color }}>
                <div className="title">{i.title}</div>
                <div className="meta">{i.due_at && <span>{when(i)}</span>}{l && <span style={{ color: l.color }}>{l.name}</span>}{i.proof_type !== "none" && <span className="proof">proof: {i.proof_type}</span>}</div>
              </div>
            );
          })}
          <button className="ghost small" onClick={undo}>Undo</button>
        </div>
      )}

      {notes.length > 0 && (
        <div className="notes-list">
          <h4>Recent notes</h4>
          {notes.map((n) => (
            <div key={n.id} className="note-row">
              <span className={`badge ${n.status}`}>{n.status}</span>
              <span className="note-text">{n.text}</span>
              <span className="muted small">{dayLabel(n.created_at)} {time(n.created_at)}</span>
            </div>
          ))}
          {notes.some((n) => n.status === "unsorted") && <p className="muted small">Unsorted notes: open Claude and say "sort my notes".</p>}
        </div>
      )}
    </div>
  );
}
