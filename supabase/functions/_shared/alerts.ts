// deno-lint-ignore-file no-explicit-any
// Phone alerts the minute tick sends: due reminders, "leave now" for events
// with a place, and birthdays (7 days before + on the day).

import { sb, must, getSetting, claimOnce } from "./db.ts";
import { push } from "./push.ts";
import { addDays, diffDays, inLocalWindow, localDateStr, localTimeStr, shortWhen } from "./time.ts";
import { reminderPush } from "./push-text.ts";

// A push no phone received is tried again next minute (for 15 minutes),
// instead of being marked as reminded and lost. Every result is logged.
const RETRY_MS = 15 * 60_000;

export async function sendReminders(now: Date) {
  const { data, error } = await sb.rpc("claim_due_reminders", { p_now: now.toISOString() });
  if (error) throw new Error(`reminders: ${error.message}`);
  const due = (data ?? []) as any[];
  const out: any[] = [];
  for (const i of due) {
    const r: any = await push(reminderPush(i, false));
    const retry = !r.sent && now.getTime() - Date.parse(i.remind_at) < RETRY_MS;
    if (retry) await sb.from("items").update({ reminded_at: null }).eq("id", i.id);
    out.push({ item: i.short_id ?? String(i.id).slice(0, 8), ...r, ...(retry ? { retry: true } : {}) });
  }
  if (out.length) console.log("reminder pushes", JSON.stringify(out));
  return out.length ? out : 0;
}

// Second push for items with remind_again_minutes that are still open that
// long after their reminder (e.g. TikTok at 20:30, again 21:30). Once per
// occurrence; claimed in one statement like the first reminder.
export async function sendFollowups(now: Date) {
  const { data, error } = await sb.rpc("claim_followups", { p_now: now.toISOString() });
  if (error) throw new Error(`follow-ups: ${error.message}`);
  const due = (data ?? []) as any[];
  const out: any[] = [];
  for (const i of due) {
    const r: any = await push(reminderPush(i, true));
    const retry = !r.sent && now.getTime() - (Date.parse(i.remind_at) + Number(i.remind_again_minutes) * 60_000) < RETRY_MS;
    if (retry) await sb.from("items").update({ reminded_again_at: null }).eq("id", i.id);
    out.push({ item: i.short_id ?? String(i.id).slice(0, 8), ...r, ...(retry ? { retry: true } : {}) });
  }
  if (out.length) console.log("follow-up pushes", JSON.stringify(out));
  return due.length;
}

// Leave-by = start - travel minutes (event's own, else the setting). Sent
// once, in the minutes between leave-by and the start.
export async function sendLeaveAlerts(now: Date) {
  const travelDefault = Number(await getSetting<number>("travel_minutes", 30)) || 30;
  const horizon = new Date(now.getTime() + 10 * 3600_000).toISOString();
  const cal = must(await sb.from("calendar_events").select("id, title, start_at, all_day, location").eq("all_day", false).not("location", "is", null)
    .gte("start_at", now.toISOString()).lt("start_at", horizon), "calendar") ?? [];
  const items = must(await sb.from("items").select("id, title, due_at, all_day, location, travel_minutes").eq("status", "open").eq("kind", "event")
    .eq("all_day", false).not("location", "is", null).gte("due_at", now.toISOString()).lt("due_at", horizon), "event items") ?? [];
  const events = [
    ...cal.map((e: any) => ({ key: `cal:${e.id}`, title: e.title, start: e.start_at, location: e.location, travel: travelDefault })),
    ...items.map((i: any) => ({ key: `item:${i.id}:${i.due_at}`, title: i.title, start: i.due_at, location: i.location, travel: i.travel_minutes ?? travelDefault })),
  ];
  let sent = 0;
  for (const e of events) {
    if (!String(e.location ?? "").trim()) continue;
    const start = Date.parse(e.start);
    const leaveBy = start - e.travel * 60_000;
    if (now.getTime() < leaveBy || now.getTime() >= start) continue;
    if (!(await claimOnce(`leave:${e.key}`))) continue;
    await push({ title: `Leave now: ${e.title}`, body: `${localTimeStr(new Date(e.start))} @ ${e.location} (${e.travel} min to get there)`, url: "/?tab=today", tag: `leave-${e.key}` });
    sent++;
  }
  return sent;
}

export async function sendBirthdayAlerts(now: Date) {
  if (!inLocalWindow(now, "09:00", 60)) return 0;
  const today = localDateStr(now);
  const until = new Date(Date.parse(`${addDays(today, 8)}T00:00:00Z`)).toISOString();
  const rows = must(await sb.from("items").select("id, title, due_at").eq("status", "open").eq("kind", "birthday").lt("due_at", until), "birthdays") ?? [];
  let sent = 0;
  for (const b of rows) {
    const date = localDateStr(new Date(b.due_at));
    const days = diffDays(date, today);
    if (days !== 0 && days !== 7) continue;
    if (!(await claimOnce(`bday:${b.id}:${date}:${days}`))) continue;
    await push({ title: days === 0 ? `Today: ${b.title}` : `In a week: ${b.title}`, body: days === 0 ? "Send a message or call." : `On ${shortWhen(new Date(b.due_at), true)}. Gift or plans?`, url: "/?tab=today", tag: `bday-${b.id}` });
    sent++;
  }
  return sent;
}
