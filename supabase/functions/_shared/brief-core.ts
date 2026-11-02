// The 09:30 brief as text: built from data with a template, no AI. Monday's
// brief is the weekly review. Pure.

import type { BuyRow } from "./buylist.ts";
import { mailLine } from "./email-triage-core.ts";
import { localDateStr, localTimeStr, shortWhen, weekdayName } from "./time.ts";

export type BItem = {
  title: string; short_id: string; lane: string; due_at: string | null; all_day: boolean;
  proof_type: string; proof_domains: string[]; kind: string;
};
export type BEvent = { title: string; start_at: string; end_at: string | null; all_day: boolean; location: string | null; calendar: string; leave_by: string | null };

export type BriefData = {
  today: string;
  weekly: boolean;
  events: BEvent[];
  pinned: BItem[];
  overdue: BItem[];
  dueToday: BItem[];
  birthdays: { title: string; date: string; days: number }[];
  stats: {
    streak: number;
    this_week: { pct: number | null; done: number; skipped: number; missed: number };
    last_week: { pct: number | null; done: number; skipped: number; missed: number };
    slipped_last_week: { day: string; title: string; outcome: string; reason: string | null }[];
  };
  thriftin: null | {
    shiftsToday: { user_name: string | null; hours: number | null; status: string }[];
    ordersToShip: { order_name: string | null; ship_by: string; items: number }[];
  };
  buy: null | { buy: BuyRow[]; skip: BuyRow[]; all: BuyRow[] };
  emails: {
    newCount: number; unhandled: number; flagged: { from: string; subject: string }[]; draftsWaiting: number; connected: boolean;
    // Only when AI triage is on (Claude API key set).
    triage?: null | {
      counts: { urgent: number; important: number; drafts: number; noise: number; unsorted: number };
      important: { from: string; summary: string; urgent: boolean }[];
      week?: { important: { from: string; summary: string; urgent: boolean }[]; unsent: { from: string; subject: string }[] } | null;
    };
  };
  unsorted: number;
  weekAhead: null | { events: BEvent[]; deadlines: BItem[] };
};

const time = (iso: string) => localTimeStr(new Date(iso));

function itemLine(i: BItem, showDate = false): string {
  const when = i.due_at ? (showDate ? shortWhen(new Date(i.due_at), i.all_day) : i.all_day ? "" : time(i.due_at)) : "";
  const proof = i.proof_type === "link" ? ` · needs link${i.proof_domains.length ? ` (${i.proof_domains.join("/")})` : ""}` : i.proof_type === "photo" ? " · needs photo" : "";
  return `- ${when ? `${when} ` : ""}${i.title} · ${i.lane}${proof} [${i.short_id}]`;
}

function eventLine(e: BEvent, showDate = false): string {
  const when = e.all_day ? (showDate ? shortWhen(new Date(e.start_at), true) : "All day") : showDate ? shortWhen(new Date(e.start_at)) : `${time(e.start_at)}${e.end_at ? `–${time(e.end_at)}` : ""}`;
  const where = e.location ? ` @ ${e.location}` : "";
  const leave = e.leave_by ? ` — leave by ${time(e.leave_by)}` : "";
  return `- ${when} ${e.title}${where}${leave} (${e.calendar})`;
}

const pct = (p: number | null) => (p == null ? "–" : `${p}%`);

export function renderBrief(d: BriefData): { markdown: string; push_title: string; push_body: string } {
  const L: string[] = [];
  const dateLabel = `${weekdayName(d.today)} ${shortWhen(new Date(`${d.today}T12:00:00Z`), true).replace(/^\w+ /, "")}`;
  L.push(`# ${d.weekly ? "Weekly review" : "Brief"} · ${dateLabel}`);
  L.push(`🔥 ${d.stats.streak}-day streak · ${pct(d.stats.this_week.pct)} this week`);

  if (d.weekly) {
    const lw = d.stats.last_week;
    L.push("", "## Last week");
    L.push(`- Score: ${pct(lw.pct)} (${lw.done} done, ${lw.skipped} skipped, ${lw.missed} missed)`);
    for (const s of d.stats.slipped_last_week.slice(0, 10)) {
      L.push(`- ${s.outcome === "missed" ? "Missed" : "Skipped"} ${weekdayName(s.day).slice(0, 3)}: ${s.title}${s.reason ? ` — "${s.reason}"` : ""}`);
    }
  }

  if (d.pinned.length) {
    L.push("", "## Must do (proof to close)");
    for (const i of d.pinned) L.push(itemLine(i));
  }

  L.push("", "## Today");
  if (d.events.length) for (const e of d.events) L.push(eventLine(e));
  else L.push("- Nothing in the calendar");
  for (const i of d.dueToday) L.push(itemLine(i));

  if (d.overdue.length) {
    L.push("", `## Overdue (${d.overdue.length})`);
    for (const i of d.overdue.slice(0, 8)) L.push(itemLine(i, true));
    if (d.overdue.length > 8) L.push(`- …and ${d.overdue.length - 8} more`);
  }

  if (d.birthdays.length) {
    L.push("", "## Birthdays");
    for (const b of d.birthdays) L.push(`- ${b.days === 0 ? "TODAY" : `in ${b.days} days`}: ${b.title}`);
  }

  if (d.thriftin) {
    L.push("", "## THRIFTIN");
    const on = d.thriftin.shiftsToday.filter((s) => s.status !== "off");
    L.push(`- Working today: ${on.length ? on.map((s) => `${s.user_name ?? "?"}${s.hours != null ? ` ${s.hours}h` : ""}`).join(", ") : "nobody booked"}`);
    if (d.thriftin.ordersToShip.length) {
      for (const o of d.thriftin.ordersToShip.slice(0, 6)) {
        const late = o.ship_by < d.today ? " — LATE" : o.ship_by === d.today ? " — ship TODAY" : "";
        L.push(`- Ship ${o.order_name ?? "order"} (${o.items} item${o.items === 1 ? "" : "s"}) by ${weekdayName(o.ship_by).slice(0, 3)} ${o.ship_by.slice(5)}${late}`);
      }
    } else L.push("- No web orders to ship");
  }

  if (d.buy && d.buy.buy.length) {
    L.push("", "## Buy more (THRIFTIN sales)");
    const full = d.buy.all.filter((r) => r.sold_30 > 0).slice(0, 12);
    const rows = d.weekly && full.length ? full : d.buy.buy;
    rows.forEach((r, n) => L.push(`${n + 1}. ${r.category} — ${r.why}`));
    if (d.buy.skip.length) L.push(`- Skip for now: ${d.buy.skip.map((r) => `${r.category} (${r.sold_30} sold/30d${r.in_stock != null ? `, ${r.in_stock} in stock` : ""})`).join("; ")}`);
  }

  if (d.weekAhead) {
    L.push("", "## Next 7 days");
    for (const e of d.weekAhead.events.slice(0, 15)) L.push(eventLine(e, true));
    for (const i of d.weekAhead.deadlines.slice(0, 15)) L.push(itemLine(i, true));
    if (!d.weekAhead.events.length && !d.weekAhead.deadlines.length) L.push("- Nothing booked");
  }

  const tri = d.emails.triage;
  if (d.weekly && tri?.week) {
    L.push("", "## Mail this week");
    if (tri.week.important.length) for (const m of tri.week.important.slice(0, 12)) L.push(`- ${m.urgent ? "🔴" : "🟠"} ${m.from}: ${m.summary}`);
    else L.push("- Nothing important came in");
    if (tri.week.unsent.length) {
      L.push(`- Drafts still not sent (${tri.week.unsent.length}):`);
      for (const u of tri.week.unsent.slice(0, 8)) L.push(`  - ${u.from}: ${u.subject}`);
    }
  }

  L.push("", "## Email");
  if (!d.emails.connected) L.push("- Hotmail not connected (Settings → Connect Hotmail)");
  else if (tri) {
    L.push(`- ${mailLine(tri.counts)}`);
    for (const m of tri.important.slice(0, 8)) L.push(`- ${m.urgent ? "🔴" : "🟠"} ${m.from}: ${m.summary}`);
    if (tri.counts.drafts) L.push(`- ✍ ${tri.counts.drafts} reply draft${tri.counts.drafts > 1 ? "s" : ""} in Outlook > Drafts, waiting for you to check and send`);
  } else {
    L.push(`- ${d.emails.newCount} new since yesterday, ${d.emails.unhandled} not handled${d.emails.draftsWaiting ? `, ${d.emails.draftsWaiting} drafts waiting to be sent` : ""}`);
    for (const f of d.emails.flagged.slice(0, 6)) L.push(`- ⚑ ${f.from}: ${f.subject}`);
  }
  if (d.unsorted) L.push("", `📝 ${d.unsorted} unsorted note${d.unsorted > 1 ? "s" : ""} — say "sort my notes" in Claude`);

  L.push("", tri ? "Ask Claude about any of it: \"what's important in my mail?\"" : "Open Claude and say: check my mail");

  const bits: string[] = [];
  const dueCount = d.dueToday.length + d.pinned.length;
  bits.push(`${dueCount} to do today`);
  if (d.events.length) bits.push(`${d.events.length} in calendar`);
  if (d.pinned.length) bits.push(`${d.pinned.map((p) => p.title.replace(/\s*\(Thriftin\)\s*/i, "")).slice(0, 2).join(" + ")} not done`);
  if (d.overdue.length) bits.push(`${d.overdue.length} overdue`);
  if (tri) {
    if (tri.counts.important) bits.push(`${tri.counts.important} important email${tri.counts.important > 1 ? "s" : ""}${tri.counts.urgent ? ` (${tri.counts.urgent} urgent)` : ""}`);
    if (tri.counts.drafts) bits.push(`${tri.counts.drafts} drafts ready`);
  } else if (d.emails.flagged.length) bits.push(`${d.emails.flagged.length} flagged emails`);
  if (d.thriftin?.ordersToShip.length) bits.push(`${d.thriftin.ordersToShip.length} orders to ship`);
  return {
    markdown: L.join("\n"),
    push_title: d.weekly ? `Weekly review · last week ${pct(d.stats.last_week.pct)}` : `Brief · 🔥 ${d.stats.streak} · ${pct(d.stats.this_week.pct)} this week`,
    push_body: bits.join(" · "),
  };
}

export const isMonday = (date: string) => weekdayName(date) === "Monday";
export { localDateStr };
