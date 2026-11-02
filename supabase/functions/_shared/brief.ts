// deno-lint-ignore-file no-explicit-any
// Gather everything for the brief, render it (template, no AI), save it and
// push it. The tick calls runBrief once a day at 09:30 Stockholm.

import { sb, must, getSetting } from "./db.ts";
import { addDays, diffDays, localDateStr, startOfLocalDay } from "./time.ts";
import { stats } from "./items.ts";
import { thriftinFeed } from "./thriftin.ts";
import { buyList } from "./buylist.ts";
import { msStatus } from "./graph.ts";
import { push } from "./push.ts";
import { type BEvent, type BItem, type BriefData, isMonday, renderBrief } from "./brief-core.ts";

const COLS = "id, short_id, lane_id, kind, title, due_at, all_day, proof_type, proof_domains, location, travel_minutes";

export async function gatherBrief(now: Date, weeklyOverride?: boolean): Promise<BriefData> {
  const today = localDateStr(now);
  const dayStart = startOfLocalDay(today).toISOString();
  const dayEnd = startOfLocalDay(addDays(today, 1)).toISOString();
  const weekEnd = startOfLocalDay(addDays(today, 8)).toISOString();
  const weekly = weeklyOverride ?? isMonday(today);
  const travelDefault = Number(await getSetting<number>("travel_minutes", 30)) || 30;

  const lanes = new Map((must(await sb.from("lanes").select("id, name"), "lanes") ?? []).map((l: any) => [l.id, l.name]));
  const toB = (i: any): BItem => ({
    title: i.title, short_id: i.short_id, lane: lanes.get(i.lane_id) ?? "", due_at: i.due_at, all_day: i.all_day,
    proof_type: i.proof_type, proof_domains: i.proof_domains ?? [], kind: i.kind,
  });

  const open = must(await sb.from("items").select(COLS).eq("status", "open").lt("due_at", weekEnd).order("due_at"), "items") ?? [];
  const noDueProof = must(await sb.from("items").select(COLS).eq("status", "open").neq("proof_type", "none").is("due_at", null), "proof items") ?? [];

  // Compare times as numbers: the database writes "+00:00", JS writes "Z".
  const t = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  const S = t(dayStart), E = t(dayEnd);
  const isTask = (i: any) => !["buy", "event", "birthday"].includes(i.kind);
  const pinned = [...open.filter((i: any) => i.proof_type !== "none" && t(i.due_at) < E), ...noDueProof];
  const dueToday = open.filter((i: any) => i.proof_type === "none" && isTask(i) && t(i.due_at) >= S && t(i.due_at) < E);
  const overdue = open.filter((i: any) => i.proof_type === "none" && isTask(i) && t(i.due_at) < S);
  const birthdays = open.filter((i: any) => i.kind === "birthday")
    .map((i: any) => ({ title: i.title, date: localDateStr(new Date(i.due_at)), days: diffDays(localDateStr(new Date(i.due_at)), today) }))
    .filter((b: any) => b.days >= 0 && b.days <= 7);

  const cal = must(await sb.from("calendar_events").select("title, start_at, end_at, all_day, location, calendar").gte("start_at", dayStart).lt("start_at", weekEnd).order("start_at"), "calendar") ?? [];
  const leaveBy = (start: string, allDay: boolean, location: string | null, travel?: number | null) =>
    !allDay && location ? new Date(Date.parse(start) - (travel ?? travelDefault) * 60_000).toISOString() : null;
  const events: BEvent[] = [
    ...cal.map((e: any) => ({ ...e, leave_by: leaveBy(e.start_at, e.all_day, e.location) })),
    ...open.filter((i: any) => i.kind === "event").map((i: any) => ({
      title: i.title, start_at: i.due_at, end_at: null, all_day: i.all_day, location: i.location, calendar: "Jarvis",
      leave_by: leaveBy(i.due_at, i.all_day, i.location, i.travel_minutes),
    })),
  ].sort((a, b) => t(a.start_at) - t(b.start_at));
  const eventsToday = events.filter((e) => t(e.start_at) >= S && t(e.start_at) < E);

  const st = await stats(now);
  const feed = await thriftinFeed();

  const ms = await msStatus();
  const sinceYesterday = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { count: newCount } = await sb.from("emails").select("id", { count: "exact", head: true }).gte("received_at", sinceYesterday);
  const { count: unhandled } = await sb.from("emails").select("id", { count: "exact", head: true }).eq("status", "new");
  const { count: drafts } = await sb.from("emails").select("id", { count: "exact", head: true }).eq("status", "drafted");
  const flagged = must(await sb.from("emails").select("from_name, from_address, subject").eq("status", "new").eq("flagged", true).order("received_at", { ascending: false }).limit(6), "flagged") ?? [];
  const { count: unsorted } = await sb.from("captures").select("id", { count: "exact", head: true }).eq("status", "unsorted");

  return {
    today,
    weekly,
    events: eventsToday,
    pinned: pinned.map(toB),
    overdue: overdue.map(toB),
    dueToday: dueToday.map(toB),
    birthdays,
    stats: st,
    thriftin: feed ? {
      shiftsToday: feed.shifts.filter((s) => s.date === today),
      ordersToShip: feed.web_orders.filter((o) => o.ship_by <= addDays(today, 1)),
    } : null,
    buy: feed ? buyList(feed.categories) : null,
    emails: {
      connected: ms.connected, newCount: newCount ?? 0, unhandled: unhandled ?? 0, draftsWaiting: drafts ?? 0,
      flagged: flagged.map((f: any) => ({ from: f.from_name || f.from_address || "?", subject: f.subject || "(no subject)" })),
    },
    unsorted: unsorted ?? 0,
    weekAhead: weekly ? {
      events: events.filter((e) => t(e.start_at) >= E),
      deadlines: open.filter((i: any) => t(i.due_at) >= E && i.kind !== "buy" && i.kind !== "event").map(toB),
    } : null,
  };
}

// Build, save and (optionally) push the brief for today. Safe to call again:
// it overwrites today's row.
export async function runBrief(now: Date, opts: { push: boolean; weekly?: boolean }) {
  const data = await gatherBrief(now, opts.weekly);
  const r = renderBrief(data);
  const row = {
    brief_date: data.today, kind: data.weekly ? "weekly" : "daily", status: "ready",
    markdown: r.markdown, push_title: r.push_title, push_body: r.push_body,
    data: { stats: data.stats, counts: { pinned: data.pinned.length, overdue: data.overdue.length, today: data.dueToday.length } },
    error: null, updated_at: new Date().toISOString(),
  };
  must(await sb.from("briefs").upsert(row, { onConflict: "brief_date" }), "save brief");
  let pushed: unknown = null;
  if (opts.push) {
    pushed = await push({ title: r.push_title, body: r.push_body, url: "/?tab=brief", tag: "brief" });
    await sb.from("briefs").update({ pushed_at: new Date().toISOString() }).eq("brief_date", data.today);
  }
  return { date: data.today, weekly: data.weekly, pushed, markdown: r.markdown };
}
