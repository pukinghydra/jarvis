// Display helpers, always in Stockholm time.
const TZ = "Europe/Stockholm";
const f = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });
const dateKey = f({ year: "numeric", month: "2-digit", day: "2-digit" });

export const localDate = (d) => {
  const p = Object.fromEntries(dateKey.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
export const todayStr = () => localDate(new Date());
export const time = (d) => f({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
export const dayLabel = (d) => {
  const k = localDate(d), t = todayStr();
  const tomorrow = localDate(new Date(Date.now() + 86400000));
  if (k === t) return "Today";
  if (k === tomorrow) return "Tomorrow";
  return f({ weekday: "short", day: "numeric", month: "short" }).format(new Date(d));
};
export const when = (item) => {
  if (!item.due_at) return "";
  return item.all_day ? dayLabel(item.due_at) : `${dayLabel(item.due_at)} ${time(item.due_at)}`;
};

// Start of a Stockholm day as a Date (handles DST by checking the offset).
export function startOfDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(f({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t = Date.UTC(y, m - 1, d) - (asUtc - t);
  }
  return new Date(t);
}
export const addDaysStr = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
