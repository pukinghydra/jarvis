import { useState } from "react";
import { api, supabase, must } from "../lib/supabase.js";
import { when } from "../lib/time.js";
import { emojiFor } from "../lib/emoji.js";

const RECUR = { daily: "every day", weekdays: "weekdays", weekly: "every week", monthly: "every month", yearly: "every year" };

// One item in a list: a soft block in its lane's colour. Tap = open it in
// Focus; the round button = done. Buy items are a plain checklist.
export default function ItemCard({ item, lane, onChange, checklist, openFocus, celebrate }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ticked, setTicked] = useState(false);

  const done = async () => {
    if (busy || ticked) return; // one tap = one done (a repeating item must not skip a day)
    setBusy(true); setErr("");
    try {
      setTicked(true);
      await api("complete", { id: item.id });
      if (!checklist) celebrate?.();
      setTimeout(() => onChange?.(), checklist ? 350 : 0);
    } catch (e) { setTicked(false); setErr(e.message); } finally { setBusy(false); }
  };
  const del = () => window.confirm(`Delete "${item.title}"?`) && supabase.from("items").delete().eq("id", item.id).then(must).then(() => onChange?.()).catch((e) => setErr(e.message));

  const sub = [
    item.due_at ? when(item) : null,
    item.minutes ? `${item.minutes} min` : null,
    item.recur ? `↻ ${RECUR[item.recur] ?? item.recur}` : null,
    item.location ? `@ ${item.location}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="card lane-bg" style={{ "--lane": lane?.color }}>
      {!checklist && <span className="emo">{emojiFor(item, lane?.slug)}</span>}
      <button className="body" onClick={() => (checklist ? null : openFocus?.(item, false))}>
        <div className="t">{item.title}</div>
        {(sub || (checklist && item.notes)) && <div className="s">{checklist ? item.notes : sub}</div>}
        {err && <div className="err">{err}</div>}
      </button>
      {checklist && <button className="ghost small" onClick={del} aria-label="Delete">✕</button>}
      <button className={`tick${ticked ? " on" : ""}`} onClick={done} disabled={busy || ticked} aria-label={checklist ? "Bought" : "Done"}>✓</button>
    </div>
  );
}
