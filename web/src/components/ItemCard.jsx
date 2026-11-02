import { useState } from "react";
import { api, supabase, must } from "../lib/supabase.js";
import { when } from "../lib/time.js";
import ProofSheet from "./ProofSheet.jsx";

// One item: lane colour stripe, title, when, proof badge, and the actions.
// Done on a proof item opens the proof sheet; Skip asks for a reason.
export default function ItemCard({ item, lane, onChange, pinned, checklist }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [proofOpen, setProofOpen] = useState(false);
  const [more, setMore] = useState(false);
  const color = lane?.color ?? "#64748B";
  const overdue = item.due_at && Date.parse(item.due_at) < Date.now() && !item.all_day;

  const run = async (fn) => {
    setBusy(true); setErr("");
    try { await fn(); onChange?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const done = () => item.proof_type !== "none" ? setProofOpen(true) : run(() => api("complete", { id: item.id }));
  const skip = () => {
    const reason = window.prompt("Why skip? (counts against this week's score)");
    if (reason == null) return;
    run(() => api("skip", { id: item.id, reason }));
  };
  const tomorrow = () => run(async () => {
    const shift = (iso) => (iso ? new Date(Date.parse(iso) + 86400000).toISOString() : null);
    const base = item.due_at ?? new Date().toISOString();
    must(await supabase.from("items").update({ due_at: shift(base), remind_at: shift(item.remind_at), reminded_at: null }).eq("id", item.id));
  });
  const del = () => window.confirm(`Delete "${item.title}"?`) && run(async () => must(await supabase.from("items").delete().eq("id", item.id)));

  if (checklist) {
    return (
      <div className="card check" style={{ borderLeftColor: color }}>
        <button className="tick" disabled={busy} onClick={done} aria-label="Bought">○</button>
        <div className="body">
          <div className="title">{item.title}</div>
          {item.notes && <div className="notes">{item.notes}</div>}
          {err && <div className="err">{err}</div>}
        </div>
        <button className="ghost small" onClick={del} disabled={busy}>✕</button>
      </div>
    );
  }

  return (
    <div className={`card${pinned ? " pinned" : ""}`} style={{ borderLeftColor: pinned ? "#EF4444" : color }}>
      <div className="body">
        <div className="title">{item.title}</div>
        <div className="meta">
          {item.due_at && <span className={overdue ? "late" : ""}>{when(item)}</span>}
          {lane && <span className="lane-tag" style={{ color }}>{lane.name}</span>}
          {item.recur && <span>↻ {item.recur}</span>}
          {item.location && <span>@ {item.location}</span>}
          {item.proof_type !== "none" && <span className="proof">proof: {item.proof_type}{item.proof_domains?.length ? ` (${item.proof_domains.join("/")})` : ""}</span>}
        </div>
        {item.notes && <div className="notes">{item.notes}</div>}
        {err && <div className="err">{err}</div>}
        {more && (
          <div className="row">
            <button className="ghost small" onClick={tomorrow} disabled={busy}>→ Tomorrow</button>
            <button className="ghost small danger" onClick={del} disabled={busy}>Delete</button>
          </div>
        )}
      </div>
      <div className="actions">
        <button className="done" onClick={done} disabled={busy}>Done</button>
        <button className="ghost small" onClick={skip} disabled={busy}>Skip</button>
        <button className="ghost small" onClick={() => setMore(!more)} aria-label="More">⋯</button>
      </div>
      {proofOpen && <ProofSheet item={item} onClose={() => setProofOpen(false)} onDone={() => { setProofOpen(false); onChange?.(); }} />}
    </div>
  );
}
