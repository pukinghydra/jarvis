// deno-lint-ignore-file no-explicit-any
// Closing, skipping and rolling items. Shared by the app's api function, the
// Claude app (mcp) and the minute tick.

import { sb, must, HttpError } from "./db.ts";
import { checkProof, checkSkip } from "./proof.ts";
import { rollForward, type Recur } from "./recur.ts";
import { addDays, localDateStr, startOfLocalDay } from "./time.ts";
import { streak, weekScore, weekStart, type LogRow } from "./score.ts";

const ITEM_COLS = "id, short_id, lane_id, kind, title, notes, status, due_at, all_day, remind_at, reminded_at, recur, proof_type, proof_domains, proof_url, proof_path, skip_reason, location, travel_minutes, email_id, done_at, created_at";

// Accepts the full id or the first 8 characters (what the Claude app sees).
export async function resolveItem(ref: string): Promise<any> {
  const r = (ref ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{8,36}$/.test(r)) throw new HttpError(400, "Give the item id (8 characters is enough)");
  const q = r.length === 36 ? sb.from("items").select(ITEM_COLS).eq("id", r) : sb.from("items").select(ITEM_COLS).eq("short_id", r.slice(0, 8));
  const rows = must(await q.limit(2), "find item") ?? [];
  if (!rows.length) throw new HttpError(404, `No item ${ref}`);
  if (rows.length > 1) throw new HttpError(409, `More than one item starts with ${ref}; use the full id`);
  return rows[0];
}

async function logOutcome(item: any, occurredOn: string, outcome: "done" | "skipped" | "missed", extra: Record<string, unknown> = {}) {
  must(
    await sb.from("item_log").upsert({
      item_id: item.id, title: item.title, lane_id: item.lane_id, occurred_on: occurredOn, outcome,
      proof_type: item.proof_type, ...extra,
    }, { onConflict: "item_id,occurred_on" }),
    "log outcome",
  );
}

function occurrenceDay(item: any, now: Date): string {
  return item.due_at ? localDateStr(new Date(item.due_at)) : localDateStr(now);
}

async function advance(item: any) {
  const next = rollForward({ due_at: item.due_at, remind_at: item.remind_at, recur: item.recur as Recur });
  // Conditional on the old due time, so a double tap can't skip two days.
  const q = sb.from("items").update({
    ...next, reminded_at: null, proof_url: null, proof_path: null, skip_reason: null, status: "open",
  }).eq("id", item.id);
  const res = must(await (item.due_at ? q.eq("due_at", item.due_at) : q).select(ITEM_COLS), "roll item") ?? [];
  return res[0] ?? null;
}

export async function completeItem(ref: string, proof: { proof_url?: string | null; proof_path?: string | null }) {
  const item = await resolveItem(ref);
  if (item.status !== "open") throw new HttpError(409, `"${item.title}" is already ${item.status}`);
  const check = checkProof(item, proof);
  if (!check.ok) throw new HttpError(422, check.error);
  const now = new Date();
  await logOutcome(item, occurrenceDay(item, now), "done", { proof_url: check.proof_url, proof_path: check.proof_path });
  if (item.recur) {
    const next = await advance(item);
    return { item: next ?? item, rolled: true, message: `Done: ${item.title}. Next: ${next?.due_at ?? "?"}` };
  }
  const done = must(
    await sb.from("items").update({ status: "done", proof_url: check.proof_url, proof_path: check.proof_path, done_at: now.toISOString() })
      .eq("id", item.id).eq("status", "open").select(ITEM_COLS),
    "close item",
  ) ?? [];
  return { item: done[0] ?? item, rolled: false, message: `Done: ${item.title}` };
}

export async function skipItem(ref: string, reason: string) {
  const item = await resolveItem(ref);
  if (item.status !== "open") throw new HttpError(409, `"${item.title}" is already ${item.status}`);
  const check = checkSkip(reason);
  if (!check.ok) throw new HttpError(422, check.error);
  const now = new Date();
  await logOutcome(item, occurrenceDay(item, now), "skipped", { reason: check.reason });
  if (item.recur) {
    const next = await advance(item);
    return { item: next ?? item, rolled: true, message: `Skipped: ${item.title} (${check.reason})` };
  }
  const res = must(
    await sb.from("items").update({ status: "skipped", skip_reason: check.reason }).eq("id", item.id).eq("status", "open").select(ITEM_COLS),
    "skip item",
  ) ?? [];
  return { item: res[0] ?? item, rolled: false, message: `Skipped: ${item.title} (${check.reason})` };
}

// Every tick: a repeating item whose day has passed without being done is
// logged as missed and moved to its next day. Birthdays and repeating events
// just move on. One-off events close themselves 2 hours after they start.
export async function rollPast(now: Date) {
  const today = localDateStr(now);
  const dayStart = startOfLocalDay(today).toISOString();
  const dayStartMs = Date.parse(dayStart);
  const out = { missed: 0, rolled: 0, eventsClosed: 0 };

  const late = must(
    await sb.from("items").select(ITEM_COLS).eq("status", "open").not("recur", "is", null).lt("due_at", dayStart).limit(200),
    "late items",
  ) ?? [];
  for (const item of late) {
    let cur = { ...item };
    let guard = 0;
    while (cur.due_at && Date.parse(cur.due_at) < dayStartMs && guard++ < 400) {
      if (cur.kind !== "birthday" && cur.kind !== "event") {
        await sb.from("item_log").upsert({
          item_id: cur.id, title: cur.title, lane_id: cur.lane_id, occurred_on: localDateStr(new Date(cur.due_at)),
          outcome: "missed", proof_type: cur.proof_type,
        }, { onConflict: "item_id,occurred_on", ignoreDuplicates: true });
        out.missed++;
      }
      cur = { ...cur, ...rollForward({ due_at: cur.due_at, remind_at: cur.remind_at, recur: cur.recur }) };
    }
    const res = must(
      await sb.from("items").update({ due_at: cur.due_at, remind_at: cur.remind_at, reminded_at: null, alerted_on: null })
        .eq("id", item.id).eq("due_at", item.due_at).select("id"),
      "roll late item",
    ) ?? [];
    if (res.length) out.rolled++;
  }

  const ended = must(
    await sb.from("items").update({ status: "done" }).eq("status", "open").eq("kind", "event").is("recur", null)
      .lt("due_at", new Date(now.getTime() - 2 * 3600_000).toISOString()).select("id"),
    "close past events",
  ) ?? [];
  out.eventsClosed = ended.length;
  return out;
}

export async function stats(now: Date) {
  const today = localDateStr(now);
  const since = addDays(today, -70);
  const logs = (must(
    await sb.from("item_log").select("occurred_on, outcome, proof_type, title, reason").gte("occurred_on", since).order("occurred_on"),
    "item log",
  ) ?? []) as (LogRow & { title: string; reason: string | null })[];
  const dayEnd = startOfLocalDay(addDays(today, 1)).toISOString();
  const openProof = must(
    await sb.from("items").select("id", { count: "exact", head: false }).eq("status", "open").neq("proof_type", "none").lt("due_at", dayEnd),
    "open proof",
  ) ?? [];
  const thisWeekStart = weekStart(today);
  const lastWeekStart = addDays(thisWeekStart, -7);
  return {
    today,
    streak: streak(logs, today, openProof.length),
    this_week: weekScore(logs, thisWeekStart, today),
    last_week: weekScore(logs, lastWeekStart, addDays(thisWeekStart, -1)),
    done_this_week: logs.filter((l) => l.outcome === "done" && l.occurred_on >= thisWeekStart).length,
    slipped_last_week: logs.filter((l) => l.outcome !== "done" && l.occurred_on >= lastWeekStart && l.occurred_on < thisWeekStart)
      .map((l) => ({ day: l.occurred_on, title: l.title, outcome: l.outcome, reason: l.reason })),
  };
}

export { ITEM_COLS };
