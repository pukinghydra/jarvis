// Recurrence: move an occurrence to the next one, in Stockholm wall time, so
// "every day 17:00" stays 17:00 across the DST switch. Pure.

import { addDays, daysInMonth, isoWeekday, localParts, pad, zonedToUtc } from "./time.ts";

export type Recur = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
export const RECURS: Recur[] = ["daily", "weekdays", "weekly", "monthly", "yearly"];

export function nextOccurrence(at: Date, recur: Recur): Date {
  const p = localParts(at);
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  let next: string;
  switch (recur) {
    case "daily":
      next = addDays(date, 1);
      break;
    case "weekdays": {
      next = addDays(date, 1);
      while (isoWeekday(next) > 5) next = addDays(next, 1);
      break;
    }
    case "weekly":
      next = addDays(date, 7);
      break;
    case "monthly": {
      // Jan 31 -> Feb 28/29 -> Mar 28: clamped to the month's last day.
      const y = p.m === 12 ? p.y + 1 : p.y;
      const m = p.m === 12 ? 1 : p.m + 1;
      next = `${y}-${pad(m)}-${pad(Math.min(p.d, daysInMonth(y, m)))}`;
      break;
    }
    case "yearly": {
      const y = p.y + 1;
      next = `${y}-${pad(p.m)}-${pad(Math.min(p.d, daysInMonth(y, p.m)))}`;
      break;
    }
    default:
      throw new Error(`unknown recur ${recur}`);
  }
  const [y, m, d] = next.split("-").map(Number);
  return zonedToUtc(y, m, d, p.h, p.mi);
}

// Move an item's due and remind times forward together. The reminder keeps
// its distance to the due time (e.g. "remind 1 hour before" stays 1 hour).
export function rollForward(
  item: { due_at: string | null; remind_at: string | null; recur: Recur },
): { due_at: string | null; remind_at: string | null } {
  if (!item.due_at) {
    return { due_at: null, remind_at: item.remind_at ? nextOccurrence(new Date(item.remind_at), item.recur).toISOString() : null };
  }
  const due = new Date(item.due_at);
  const nextDue = nextOccurrence(due, item.recur);
  let nextRemind: string | null = null;
  if (item.remind_at) {
    const remind = new Date(item.remind_at);
    // Same-day reminders keep their wall-clock time; others keep the gap.
    const sameDay = localParts(remind).d === localParts(due).d && Math.abs(due.getTime() - remind.getTime()) < 86400000;
    nextRemind = sameDay
      ? nextOccurrence(remind, item.recur).toISOString()
      : new Date(nextDue.getTime() - (due.getTime() - remind.getTime())).toISOString();
  }
  return { due_at: nextDue.toISOString(), remind_at: nextRemind };
}
