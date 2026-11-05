import { addDaysStr, startOfDay, todayStr } from "./time.js";

// "Not now" choices. Times are Stockholm. A repeating item keeps its usual
// time: only its reminder moves (so tomorrow's TikTok is still 20:30).
const at = (dateStr, hh, mm = 0) => new Date(startOfDay(dateStr).getTime() + (hh * 60 + mm) * 60000);

export function snoozeOptions(now = new Date()) {
  const today = todayStr();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", hourCycle: "h23" }).format(now));
  const opts = [{ key: "1h", label: "In 1 hour", at: new Date(now.getTime() + 3600_000) }];
  if (hour < 18) opts.push({ key: "tonight", label: "Tonight", at: at(today, 19) });
  opts.push({ key: "tomorrow", label: "Tomorrow morning", at: at(addDaysStr(today, 1), 9) });
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const toMonday = ((8 - dow) % 7) || 7;
  opts.push({ key: "week", label: "Next week", at: at(addDaysStr(today, toMonday), 9) });
  return opts;
}

export function snoozePatch(item, when) {
  const iso = when.toISOString();
  const base = { remind_at: iso, reminded_at: null, reminded_again_at: null };
  if (item.recur) return base;
  return { ...base, due_at: iso, all_day: false };
}
