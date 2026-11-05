import { useEffect, useState } from "react";
import { api, supabase, must } from "../lib/supabase.js";
import { addDaysStr, startOfDay, time, todayStr } from "../lib/time.js";
import { emojiFor } from "../lib/emoji.js";
import { snoozePatch } from "../lib/snooze.js";
import SnoozeSheet from "../components/SnoozeSheet.jsx";

// Today as a soft timeline: what's done fades, a red "now" line, and the
// next thing opens big with Start / Done / Not now. Things from earlier
// days wait folded at the bottom: no red, no "overdue".
const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 5 ? "Hi" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const longDate = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", weekday: "long", day: "numeric", month: "long" }).format(new Date());
const t = (x) => (x ? Date.parse(x) : NaN);
const shortDay = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", weekday: "short" }).format(new Date(d));

export default function Today({ lanes, refreshKey, onChange, openFocus, celebrate, go, mailCount, stats }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showEarlier, setShowEarlier] = useState(false);
  const [snoozing, setSnoozing] = useState(null);
  const [busy, setBusy] = useState("");
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const inbox = lanes.find((l) => l.slug === "inbox")?.id;

  const load = async () => {
    setErr("");
    try {
      const today = todayStr();
      const S = startOfDay(today).getTime(), E = startOfDay(addDaysStr(today, 1)).getTime();
      const [items, cal, log] = await Promise.all([
        supabase.from("items").select("*").eq("status", "open").neq("kind", "buy").order("due_at", { nullsFirst: false }).limit(500).then(must),
        supabase.from("calendar_events").select("*").gte("start_at", new Date(S).toISOString()).lt("start_at", new Date(E).toISOString()).order("start_at").then(must),
        supabase.from("item_log").select("item_id, title, lane_id, outcome, created_at").eq("outcome", "done").gte("created_at", new Date(S).toISOString()).then(must),
      ]);
      const mine = items.filter((i) => i.lane_id !== inbox);
      setData({
        today: mine.filter((i) => t(i.due_at) >= S && t(i.due_at) < E),
        earlier: mine.filter((i) => t(i.due_at) < S && i.kind !== "birthday" && i.kind !== "event"),
        cal, done: log,
      });
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [refreshKey, lanes]);
  const changed = () => { load(); onChange?.(); };

  if (err) return <div className="screen"><div className="err">{err}</div><button className="ghost" onClick={load}>Try again</button></div>;
  if (!data) return <div className="screen muted center">…</div>;

  const now = Date.now();
  const allDay = data.today.filter((i) => i.all_day);
  const timed = data.today.filter((i) => !i.all_day);
  const next = timed.find((i) => t(i.due_at) <= now) ?? allDay[0] ?? timed[0] ?? data.earlier[0] ?? null;
  const fromEarlier = next && data.earlier[0]?.id === next.id;

  // Everything on one line of time; things for "any time today" sit just after now.
  const rows = [
    ...data.done.map((d) => ({ key: `d${d.item_id}${d.created_at}`, at: t(d.created_at), kind: "done", d })),
    ...data.cal.map((e) => ({ key: `e${e.id}`, at: e.all_day ? t(e.start_at) : t(e.start_at), kind: "event", e })),
    ...timed.map((i) => ({ key: i.id, at: t(i.due_at), kind: "item", i })),
    ...allDay.map((i, n) => ({ key: i.id, at: now + 1 + n, kind: "item", i })),
    ...(fromEarlier ? [{ key: next.id, at: now + 0.5, kind: "item", i: next }] : []),
  ].sort((a, b) => a.at - b.at);
  const nowIdx = rows.findIndex((r) => r.at > now);

  const todayOpen = data.today.length;
  const doneN = data.done.length;
  const minsLeft = data.today.reduce((s, i) => s + (i.minutes || 0), 0);
  const pct = todayOpen + doneN ? Math.round((doneN / (todayOpen + doneN)) * 100) : 0;

  const quickDone = async (i) => {
    setBusy(i.id);
    try { await api("complete", { id: i.id }); celebrate?.(); changed(); } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };
  const pickSnooze = async (at) => {
    try { must(await supabase.from("items").update(snoozePatch(snoozing, at)).eq("id", snoozing.id)); setSnoozing(null); changed(); } catch (e) { setErr(e.message); }
  };

  const block = (r) => {
    if (r.kind === "done") {
      const lane = laneById.get(r.d.lane_id);
      return (
        <div key={r.key} className="blk done lane-bg" style={{ "--lane": lane?.color }}>
          <span className="tm">{time(r.d.created_at)}</span>
          <span className="emo">{emojiFor({ title: r.d.title }, lane?.slug)}</span>
          <div><div className="t">{r.d.title}</div></div>
          <span className="chk">✓</span>
        </div>
      );
    }
    if (r.kind === "event") {
      const e = r.e, past = t(e.end_at || e.start_at) < now;
      return (
        <div key={r.key} className={`blk lane-bg${past ? " done" : ""}`} style={{ "--lane": "#3B82F6" }}>
          <span className="tm">{e.all_day ? "day" : time(e.start_at)}</span>
          <span className="emo">{emojiFor({ title: e.title, kind: "event" })}</span>
          <div><div className="t" style={past ? { textDecoration: "none" } : null}>{e.title}</div><div className="s">{e.all_day ? "All day" : `${time(e.start_at)}${e.end_at ? `–${time(e.end_at)}` : ""}`}{e.location ? ` · @ ${e.location}` : ""}</div></div>
        </div>
      );
    }
    const i = r.i, lane = laneById.get(i.lane_id);
    const before = t(i.due_at) < startOfDay(todayStr()).getTime();
    const label = before ? shortDay(i.due_at) : i.all_day ? "today" : time(i.due_at);
    const sub = [i.minutes ? `${i.minutes} min` : null, lane?.name ? lane.name.charAt(0) + lane.name.slice(1).toLowerCase() : null].filter(Boolean).join(" · ");
    if (next && i.id === next.id) {
      return (
        <div key={r.key} className="blk cur lane-bg" style={{ "--lane": lane?.color }}>
          <span className="tm">{label}</span>
          <button className="head" style={{ background: "none", padding: 0, minHeight: 0, width: "100%", textAlign: "left", whiteSpace: "normal", color: "inherit" }} onClick={() => openFocus(i, false)}>
            <span className="emo">{emojiFor(i, lane?.slug)}</span>
            <div><div className="t">{i.title}</div><div className="s">{sub || "Tap to open"}</div></div>
          </button>
          {i.first_step && <div className="first"><span>First step: </span>{i.first_step}</div>}
          <div className="btns">
            <button className="b go" onClick={() => openFocus(i, true)}>▶ Start</button>
            <button className="b soft" onClick={() => quickDone(i)} disabled={busy === i.id}>✓ Done</button>
            <button className="b soft" onClick={() => setSnoozing(i)} aria-label="Not now">⏰</button>
          </div>
        </div>
      );
    }
    return (
      <div key={r.key} className="blk lane-bg" style={{ "--lane": lane?.color }}>
        <span className="tm">{label}</span>
        <button style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0, background: "none", padding: 0, minHeight: 0, textAlign: "left", whiteSpace: "normal", color: "inherit", borderRadius: 0 }} onClick={() => openFocus(i, false)}>
          <span className="emo">{emojiFor(i, lane?.slug)}</span>
          <div style={{ minWidth: 0 }}><div className="t">{i.title}</div>{sub && <div className="s">{sub}</div>}</div>
        </button>
        <button className="tick" onClick={() => quickDone(i)} disabled={busy === i.id} aria-label="Done">✓</button>
      </div>
    );
  };

  const nowLine = <div key="now" className="now-line"><b>{time(new Date())}</b><i /></div>;
  const restEarlier = data.earlier.filter((i) => !(fromEarlier && i.id === next.id));

  return (
    <div className="screen">
      <div className="top">
        <div><div className="date">{longDate()}</div><div className="hello">{greeting()}, Vic</div></div>
        <button className="icon-btn" onClick={() => go("settings")} aria-label="Settings">⚙︎</button>
      </div>
      <div className="pills">
        <span className="pill">🔥 {stats?.streak ?? 0} day{stats?.streak === 1 ? "" : "s"}</span>
        <span className="pill"><i className="ring-mini" style={{ "--p": `${pct}%` }} />{doneN} of {todayOpen + doneN} done</span>
        {todayOpen > 0 && <span className="pill">⏱ {minsLeft ? `${minsLeft} min left` : `${todayOpen} left`}</span>}
        {mailCount > 0 && <button className="pill" onClick={() => go("mail")}>✉️ {mailCount} need{mailCount === 1 ? "s" : ""} you</button>}
      </div>

      {rows.length === 0 ? (
        <div className="calm"><b>🌱</b>Nothing planned today.<br />Add something in Lists, or ask Claude.</div>
      ) : (
        <div className="tl">
          {rows.map((r, n) => (n === nowIdx ? [nowLine, block(r)] : block(r)))}
          {nowIdx === -1 && nowLine}
        </div>
      )}

      {restEarlier.length > 0 && (
        <div className="earlier">
          <button className="pill" onClick={() => setShowEarlier(!showEarlier)}>🕰 From earlier · {restEarlier.length} {showEarlier ? "▴" : "▾"}</button>
          {showEarlier && (
            <div className="tl" style={{ marginTop: 12 }}>
              {restEarlier.map((i) => block({ key: i.id, kind: "item", i }))}
            </div>
          )}
        </div>
      )}
      {snoozing && <SnoozeSheet onPick={pickSnooze} onClose={() => setSnoozing(null)} />}
    </div>
  );
}
