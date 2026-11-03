import { useEffect, useState } from "react";
import { api, supabase, must } from "../lib/supabase.js";
import { addDaysStr, dayLabel, startOfDay, time, todayStr } from "../lib/time.js";
import ItemCard from "../components/ItemCard.jsx";
import EmailSheet from "../components/EmailSheet.jsx";

// Jarvis's own email sorting (only when a Claude API key is set): counts like
// the brief's "N important (M urgent) · K drafts ready · X noise".
const RANK = { urgent: 0, important: 1, normal: 2, noise: 3 };
function mailSummary(rows) {
  const on = rows.some((r) => r.triaged_at);
  const fresh = rows.filter((r) => r.status === "new");
  const important = fresh.filter((r) => r.triaged_at && (r.importance === "urgent" || r.importance === "important"));
  return {
    on,
    urgent: important.filter((r) => r.importance === "urgent").length,
    important: important.length,
    drafts: rows.filter((r) => r.status === "drafted").length,
    noise: fresh.filter((r) => r.triaged_at && r.importance === "noise").length,
    unsorted: fresh.filter((r) => !r.triaged_at).length,
    list: [...important].sort((a, b) => RANK[a.importance] - RANK[b.importance]).slice(0, 6),
  };
}

export default function Today({ lanes, refreshKey, onChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [openEmail, setOpenEmail] = useState(null);
  const laneById = new Map(lanes.map((l) => [l.id, l]));

  const load = async () => {
    setErr("");
    try {
      const today = todayStr();
      const S = startOfDay(today).getTime(), E = startOfDay(addDaysStr(today, 1)).getTime(), W = startOfDay(addDaysStr(today, 8)).getTime();
      const [items, cal, emails, notes, stats] = await Promise.all([
        supabase.from("items").select("*").eq("status", "open").order("due_at", { nullsFirst: false }).limit(500).then(must),
        supabase.from("calendar_events").select("*").gte("start_at", new Date(S).toISOString()).lt("start_at", new Date(W).toISOString()).order("start_at").then(must),
        supabase.from("emails").select("id, flagged, status, importance, summary, from_name, from_address, triaged_at, received_at").in("status", ["new", "drafted"]).order("received_at", { ascending: false }).limit(500).then(must),
        supabase.from("captures").select("id").eq("status", "unsorted").then(must),
        api("stats").catch(() => null),
      ]);
      const t = (x) => (x ? Date.parse(x) : NaN);
      const inbox = lanes.find((l) => l.slug === "inbox")?.id;
      const isTask = (i) => !["buy", "birthday", "event"].includes(i.kind);
      setData({
        stats,
        today: items.filter((i) => i.lane_id !== inbox && t(i.due_at) >= S && t(i.due_at) < E),
        overdue: items.filter((i) => i.lane_id !== inbox && isTask(i) && t(i.due_at) < S),
        replies: items.filter((i) => i.lane_id === inbox),
        week: items.filter((i) => i.lane_id !== inbox && t(i.due_at) >= E && t(i.due_at) < W),
        calToday: cal.filter((e) => t(e.start_at) < E),
        calWeek: cal.filter((e) => t(e.start_at) >= E),
        emails: emails.filter((e) => e.status === "new").length,
        flagged: emails.filter((e) => e.status === "new" && e.flagged).length,
        mail: mailSummary(emails),
        unsorted: notes.length,
      });
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [refreshKey, lanes]);

  const changed = () => { load(); onChange?.(); };
  if (err) return <div className="screen"><div className="err">{err}</div><button className="ghost" onClick={load}>Retry</button></div>;
  if (!data) return <div className="screen muted center">Loading…</div>;
  const s = data.stats;
  const card = (i, extra = {}) => <ItemCard key={i.id} item={i} lane={laneById.get(i.lane_id)} onChange={changed} {...extra} />;
  const ev = (e) => (
    <div key={e.id} className="event">
      <span className="ev-time">{e.all_day ? "All day" : time(e.start_at)}</span>
      <span className="ev-title">{e.title}{e.location ? ` @ ${e.location}` : ""}</span>
      <span className="muted small">{e.calendar}</span>
    </div>
  );

  return (
    <div className="screen">
      <div className="stats">
        <div><b>🔥 {s?.streak ?? "–"}</b><span>day streak</span></div>
        <div><b>{s?.this_week?.pct ?? "–"}{s?.this_week?.pct != null ? "%" : ""}</b><span>this week</span></div>
        <div><b>{s?.done_this_week ?? "–"}</b><span>done</span></div>
      </div>

      {(data.emails > 0 || data.unsorted > 0 || data.mail.drafts > 0) && (
        <div className="banner">
          {data.mail.on ? (
            <div>
              <div>✉ {data.mail.important} important{data.mail.urgent ? ` (${data.mail.urgent} urgent)` : ""} · {data.mail.drafts} draft{data.mail.drafts === 1 ? "" : "s"} ready · {data.mail.noise} noise{data.mail.unsorted ? ` · ${data.mail.unsorted} still to sort` : ""}</div>
              {data.mail.list.map((m) => (
                <button key={m.id} className="mail-row small" onClick={() => setOpenEmail(m.id)}>
                  {m.importance === "urgent" ? "🔴" : "🟠"} <b>{m.from_name || m.from_address || "?"}</b>: {m.summary} <span className="muted">›</span>
                </button>
              ))}
              {data.mail.drafts > 0 && <div className="muted small" style={{ marginTop: 4 }}>Drafts are in Outlook → Drafts. Check and send them yourself.</div>}
            </div>
          ) : (
            data.emails > 0 && <div>✉ {data.emails} emails waiting{data.flagged ? ` (${data.flagged} flagged)` : ""}. Say "check my mail" in Talk.</div>
          )}
          {data.unsorted > 0 && <div>📝 {data.unsorted} unsorted notes. Say "sort my notes" in Talk.</div>}
        </div>
      )}

      <section>
        <h3>Today</h3>
        {data.calToday.map(ev)}
        {data.today.map((i) => card(i))}
        {!data.calToday.length && !data.today.length && <p className="muted">Nothing else today. 🌱</p>}
      </section>

      {data.overdue.length > 0 && <section><h3 className="amber">Overdue ({data.overdue.length})</h3>{data.overdue.map((i) => card(i))}</section>}
      {data.replies.length > 0 && <section><h3>Replies to send</h3>{data.replies.map((i) => card(i))}</section>}

      {(data.week.length > 0 || data.calWeek.length > 0) && (
        <section>
          <h3>Next 7 days</h3>
          {[...data.calWeek.map((e) => ({ at: Date.parse(e.start_at), el: <div key={e.id} className="event"><span className="ev-time">{dayLabel(e.start_at)}{e.all_day ? "" : ` ${time(e.start_at)}`}</span><span className="ev-title">{e.title}</span><span className="muted small">{e.calendar}</span></div> })),
            ...data.week.map((i) => ({ at: Date.parse(i.due_at), el: card(i) }))].sort((a, b) => a.at - b.at).map((x) => x.el)}
        </section>
      )}
      <button className="ghost center-block" onClick={() => api("calendar_sync").then(load).catch((e) => setErr(e.message))}>↻ Refresh calendar</button>
      {openEmail && <EmailSheet id={openEmail} onClose={() => setOpenEmail(null)} onChange={changed} />}
    </div>
  );
}
