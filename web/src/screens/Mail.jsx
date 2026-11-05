import { useEffect, useState } from "react";
import { supabase, must } from "../lib/supabase.js";
import { dayLabel, time } from "../lib/time.js";
import { mailtoForEmail, openInMailHref } from "../lib/mailto.js";
import EmailSheet from "../components/EmailSheet.jsx";

// Only the email that needs VIC, one card at a time. Everything else was
// sorted quietly. Content stays in its own language.
const RANK = { urgent: 0, important: 1 };
const avatar = (e) => {
  const s = `${e.from_name ?? ""} ${e.from_address ?? ""} ${e.subject ?? ""}`.toLowerCase();
  if (/faktura|invoice|betal|räkning|kivra/.test(s)) return "🧾";
  if (/bank|seb|amex|american express|swedbank|handelsbanken|klarna/.test(s)) return "🏦";
  if (/vinted|retur|return|paket|parcel|postnord|dhl/.test(s)) return "📦";
  if (/skatt|moms|verket/.test(s)) return "🏛️";
  return (e.from_name || e.from_address || "?").trim().charAt(0).toUpperCase();
};

export function needsYou(rows) {
  const triaged = rows.some((r) => r.triaged_at);
  const need = rows.filter((r) => r.status === "drafted" || (triaged ? RANK[r.importance] !== undefined : r.flagged));
  return need.sort((a, b) => (RANK[a.importance] ?? 2) - (RANK[b.importance] ?? 2) || Date.parse(b.received_at) - Date.parse(a.received_at));
}

export default function Mail({ refreshKey, onChange }) {
  const [rows, setRows] = useState(null);
  const [quiet, setQuiet] = useState(0);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState("");
  const [reading, setReading] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setErr("");
    try {
      const all = must(await supabase.from("emails")
        .select("id, from_name, from_address, subject, received_at, preview, importance, summary, status, flagged, triaged_at, draft_text, draft_language, internet_message_id")
        .in("status", ["new", "drafted"]).order("received_at", { ascending: false }).limit(400)) ?? [];
      const need = needsYou(all).slice(0, 30);
      // Bodies only for the cards (the reply link quotes the email).
      if (need.length) {
        const bodies = must(await supabase.from("emails").select("id, body").in("id", need.map((r) => r.id))) ?? [];
        const map = new Map(bodies.map((b) => [b.id, b.body]));
        for (const r of need) r.body = map.get(r.id) ?? r.preview;
      }
      setRows(need);
      setQuiet(all.length - needsYou(all).length);
      setIdx((i) => Math.min(i, Math.max(0, need.length - 1)));
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [refreshKey]);

  const handled = async (e) => {
    setBusy(true); setErr("");
    try {
      must(await supabase.from("emails").update({ status: "handled", handled_at: new Date().toISOString() }).eq("id", e.id));
      await load(); onChange?.();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (!rows) return <div className="screen muted center">{err || "…"}</div>;
  const n = rows.length;
  const e = rows[idx];
  const mins = rows.reduce((s, r) => s + (r.draft_text ? 3 : 2), 0);

  return (
    <div className="screen">
      <div className="date">Mail</div>
      <div className="mh">{n ? `${n} need${n === 1 ? "s" : ""} you` : "All clear ✨"}</div>
      <div className="ms">{n ? `About ${mins} min. The rest is handled.` : "Nothing in your mail needs you right now."}</div>
      {err && <div className="err">{err}</div>}

      {e && (
        <div className={`mc${e.importance === "urgent" ? " urgent" : ""}`}>
          <div className="who"><span className="av">{avatar(e)}</span><div><b>{e.from_name || e.from_address}</b><span>{dayLabel(e.received_at)} {time(e.received_at)}{e.importance === "urgent" ? " · urgent" : ""}</span></div></div>
          <h3>{e.subject || "(no subject)"}</h3>
          <p>{e.summary || e.preview}</p>
          {openInMailHref(e) && <a className="button-link go" href={openInMailHref(e)}>📬 Open in Mail</a>}
          {mailtoForEmail(e) && <a className="button-link soft" href={mailtoForEmail(e)}>✉️ Reply in Mail (written for you)</a>}
          <button className="b soft" onClick={() => handled(e)} disabled={busy}>✓ Done with it</button>
          <div className="row" style={{ justifyContent: "space-between", margin: "4px 0 0" }}>
            <button className="link" style={{ width: "auto" }} onClick={() => setReading(e.id)}>Read it here</button>
            {n > 1 && <button className="link" style={{ width: "auto" }} onClick={() => setIdx((idx + 1) % n)}>Next ›</button>}
          </div>
        </div>
      )}
      {n > 1 && <div className="dots">{rows.slice(0, 8).map((r, i) => <i key={r.id} className={i === idx ? "on" : ""} />)}</div>}
      {quiet > 0 && <div className="quiet" style={{ marginTop: n ? 0 : 8 }}><span style={{ fontSize: 20 }}>🤫</span><div><b>{quiet} sorted quietly</b><br />Newsletters, notifications, things that don't need you</div></div>}
      {reading && <EmailSheet id={reading} onClose={() => setReading(null)} onChange={() => { load(); onChange?.(); }} />}
    </div>
  );
}
