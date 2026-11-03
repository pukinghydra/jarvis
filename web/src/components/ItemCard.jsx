import { useState } from "react";
import { api, supabase, must } from "../lib/supabase.js";
import { when } from "../lib/time.js";
import EmailSheet from "./EmailSheet.jsx";

const RECUR = { daily: "every day", weekdays: "weekdays", weekly: "every week", monthly: "every month", yearly: "every year" };

// One item: lane colour stripe, title, when, and the actions. Done closes it
// straight away (with a short celebration); Skip asks why (no score guilt);
// ⋯ has Tomorrow and Delete. Titles/notes stay in whatever language they are.
export default function ItemCard({ item, lane, onChange, checklist }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [more, setMore] = useState(false);
  const [cheer, setCheer] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const color = lane?.color ?? "#64748B";
  const overdue = item.due_at && Date.parse(item.due_at) < Date.now() && !item.all_day;

  const run = async (fn, celebrate = false) => {
    setBusy(true); setErr("");
    try {
      await fn();
      if (celebrate) { setCheer(true); setTimeout(() => { setCheer(false); onChange?.(); }, 900); } else onChange?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const done = () => run(() => api("complete", { id: item.id }), true);
  const skip = () => {
    const reason = window.prompt("Skip this one? Say why in a few words (just for you).");
    if (reason == null) return;
    run(() => api("skip", { id: item.id, reason: reason.trim() || "skipped" }));
  };
  const tomorrow = () => run(async () => {
    const shift = (iso) => (iso ? new Date(Date.parse(iso) + 86400000).toISOString() : null);
    const base = item.due_at ?? new Date().toISOString();
    must(await supabase.from("items").update({ due_at: shift(base), remind_at: shift(item.remind_at), reminded_at: null }).eq("id", item.id));
  });
  const del = () => window.confirm(`Delete "${item.title}"?`) && run(async () => must(await supabase.from("items").delete().eq("id", item.id)));

  if (cheer) {
    return <div className="card cheer" style={{ borderLeftColor: color }}><div className="body"><div className="title">🎉 Done! {item.title}</div></div></div>;
  }

  if (checklist) {
    return (
      <div className="card check" style={{ borderLeftColor: color }}>
        <button className="tick" disabled={busy} onClick={done} aria-label="Bought">○</button>
        <div className="body">
          <div className="title">{item.title}</div>
          {item.notes && <div className="notes">{item.notes}</div>}
          {err && <div className="err">{err}</div>}
        </div>
        <button className="ghost small" onClick={del} disabled={busy} aria-label="Delete">✕</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderLeftColor: color }}>
      <div className="body">
        <div className="title">{item.title}</div>
        <div className="meta">
          {item.due_at && <span className={overdue ? "late" : ""}>{when(item)}</span>}
          {lane && <span className="lane-tag" style={{ color }}>{lane.name}</span>}
          {item.recur && <span>↻ {RECUR[item.recur] ?? item.recur}</span>}
          {item.remind_again_minutes && <span>🔔 again after {item.remind_again_minutes} min</span>}
          {item.location && <span>@ {item.location}</span>}
        </div>
        {item.notes && <div className="notes">{item.notes}</div>}
        {item.email_id && <button className="ghost small" onClick={() => setMailOpen(true)}>📧 Read the email</button>}
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
      {mailOpen && <EmailSheet id={item.email_id} onClose={() => setMailOpen(false)} onChange={onChange} />}
    </div>
  );
}
