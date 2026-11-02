import { useEffect, useState } from "react";
import { api, supabase, must } from "../lib/supabase.js";
import { speak, stopSpeaking } from "../lib/speech.js";
import Markdown from "../components/Markdown.jsx";

export default function Brief() {
  const [briefs, setBriefs] = useState([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try { setBriefs(must(await supabase.from("briefs").select("brief_date, kind, markdown, status").eq("status", "ready").order("brief_date", { ascending: false }).limit(14)) ?? []); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); return stopSpeaking; }, []);

  const rebuild = async () => {
    setBusy(true); setErr("");
    try { await api("brief_now"); await load(); setIdx(0); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const b = briefs[idx];
  const readAloud = () => speak((b?.markdown ?? "").replace(/^#+ /gm, "").replace(/^- /gm, "").replace(/\[[0-9a-f]{8}\]/g, ""), "en-GB");

  return (
    <div className="screen">
      <div className="row">
        <button className="primary" onClick={readAloud} disabled={!b}>🔊 Read aloud</button>
        <button className="ghost" onClick={stopSpeaking}>Stop</button>
        <button className="ghost" onClick={rebuild} disabled={busy}>{busy ? "Building…" : "↻ Now"}</button>
      </div>
      {err && <div className="err">{err}</div>}
      {b ? <Markdown text={b.markdown} /> : <p className="muted center">No brief yet. It arrives at 09:30, or tap ↻ Now.</p>}
      {briefs.length > 1 && (
        <div className="chips">
          {briefs.map((x, n) => <button key={x.brief_date} className={`chip${n === idx ? " on" : ""}`} onClick={() => setIdx(n)}>{x.brief_date.slice(5)}{x.kind === "weekly" ? " ★" : ""}</button>)}
        </div>
      )}
    </div>
  );
}
