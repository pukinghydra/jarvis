// Stockholm wall-clock helpers. Pure: no Deno, no network, so Node tests can
// run them. Everything in the database is UTC (timestamptz); "local" here
// always means Europe/Stockholm, including the DST switch.

export const TZ = "Europe/Stockholm";

export type LocalParts = { y: number; m: number; d: number; h: number; mi: number; weekday: number };
// weekday: 1 = Monday ... 7 = Sunday (ISO)

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
});
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(at: Date): LocalParts {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(at)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, weekday: WD[p.weekday] };
}

// Offset of Stockholm from UTC at that instant, in minutes (+60 or +120).
export function tzOffsetMinutes(at: Date): number {
  const p = localParts(at);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

// Local wall time -> UTC instant. A time that doesn't exist (spring forward
// 02:30) lands an hour later; an ambiguous one (autumn 02:30) takes the first.
export function zonedToUtc(y: number, m: number, d: number, h = 0, mi = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off1 = tzOffsetMinutes(new Date(guess));
  let t = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(t));
  if (off2 !== off1) t = guess - off2 * 60000;
  return new Date(t);
}

export const pad = (n: number) => String(n).padStart(2, "0");

export function localDateStr(at: Date): string {
  const p = localParts(at);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function localTimeStr(at: Date): string {
  const p = localParts(at);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function parseDateStr(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export function parseTimeStr(s: string | null | undefined): { h: number; mi: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Calendar arithmetic on a local date string (no time zone involved).
export function addDays(date: string, n: number): string {
  const p = parseDateStr(date)!;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isoWeekday(date: string): number {
  const p = parseDateStr(date)!;
  const wd = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function diffDays(a: string, b: string): number {
  const pa = parseDateStr(a)!, pb = parseDateStr(b)!;
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86400000);
}

// Local date + "HH:MM" -> UTC instant.
export function localToUtc(date: string, time: string | null | undefined): Date {
  const d = parseDateStr(date);
  if (!d) throw new Error(`bad date ${date}`);
  const t = parseTimeStr(time ?? "00:00") ?? { h: 0, mi: 0 };
  return zonedToUtc(d.y, d.m, d.d, t.h, t.mi);
}

// Is local time now within [hh:mm, hh:mm + minutes)?  Used by the
// minute-by-minute tick for "09:30 brief", "09:15 email scan" and so on.
export function inLocalWindow(now: Date, hhmm: string, minutes: number): boolean {
  const t = parseTimeStr(hhmm)!;
  const p = localParts(now);
  const cur = p.h * 60 + p.mi;
  const start = t.h * 60 + t.mi;
  return cur >= start && cur < start + minutes;
}

export function startOfLocalDay(date: string): Date {
  return localToUtc(date, "00:00");
}

const WEEKDAY_EN = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_SV = ["", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

// "Monday 2026-11-02 14:05 (måndag), Europe/Stockholm" for prompts.
export function nowForPrompt(now: Date): string {
  const p = localParts(now);
  return `${WEEKDAY_EN[p.weekday]} ${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)} (${WEEKDAY_SV[p.weekday]}), time zone Europe/Stockholm`;
}

export function weekdayName(date: string): string {
  return WEEKDAY_EN[isoWeekday(date)];
}

// "Tue 3 Nov 14:00" in Stockholm time.
export function shortWhen(at: Date, allDay = false): string {
  const opts: Intl.DateTimeFormatOptions = allDay
    ? { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }
    : { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  return new Intl.DateTimeFormat("en-GB", opts).format(at).replace(",", "");
}
