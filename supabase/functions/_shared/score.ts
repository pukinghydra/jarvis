// Streak and weekly score for the proof habits (posting etc.). Pure.
//
// Score = done / (done + skipped + missed) over proof items in a date range.
// Streak = days in a row where every proof item that day was done. Today
// counts once all of today's proof items are done; until then the streak is
// what it was up to yesterday.

import { addDays, isoWeekday } from "./time.ts";

export type LogRow = { occurred_on: string; outcome: "done" | "skipped" | "missed"; proof_type: string };

const isProof = (r: LogRow) => r.proof_type && r.proof_type !== "none";

export function weekScore(rows: LogRow[], from: string, to: string): { pct: number | null; done: number; skipped: number; missed: number } {
  const inRange = rows.filter((r) => isProof(r) && r.occurred_on >= from && r.occurred_on <= to);
  const done = inRange.filter((r) => r.outcome === "done").length;
  const skipped = inRange.filter((r) => r.outcome === "skipped").length;
  const missed = inRange.filter((r) => r.outcome === "missed").length;
  const total = done + skipped + missed;
  return { pct: total ? Math.round((done / total) * 100) : null, done, skipped, missed };
}

export function streak(rows: LogRow[], today: string, openProofDueToday: number): number {
  const byDay = new Map<string, LogRow[]>();
  for (const r of rows) {
    if (!isProof(r)) continue;
    const list = byDay.get(r.occurred_on) ?? [];
    list.push(r);
    byDay.set(r.occurred_on, list);
  }
  const allDone = (day: string) => {
    const list = byDay.get(day);
    return !!list && list.length > 0 && list.every((r) => r.outcome === "done");
  };
  let n = 0;
  if (openProofDueToday === 0 && allDone(today)) n = 1;
  let day = addDays(today, -1);
  for (let i = 0; i < 3650 && allDone(day); i++) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

// Monday of the ISO week that contains `date`.
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}
