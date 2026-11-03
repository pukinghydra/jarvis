// deno-lint-ignore-file no-explicit-any
// Pure formatting for THRIFTIN schedule answers (no Deno, no database).

const fmtShift = (s: any) => s ? `${s.date} ${s.user_name}: ${s.status}${s.hours != null ? ` ${s.hours} h` : ""}` : "none";

export function formatSchedule(r: any): string {
  const lines = [`THRIFTIN schedule ${r.from} → ${r.to}`];
  const byDay = new Map<string, string[]>();
  for (const s of r.shifts ?? []) {
    const list = byDay.get(s.date) ?? [];
    list.push(`${s.user_name} ${s.status}${s.hours != null ? ` ${s.hours} h` : ""}`);
    byDay.set(s.date, list);
  }
  const notes = new Map<string, any>((r.day_notes ?? []).map((n: any) => [n.date, n]));
  const days = [...new Set([...byDay.keys(), ...notes.keys()])].sort();
  if (!days.length) lines.push("No shifts or notes in this range.");
  for (const d of days) {
    const n = notes.get(d);
    const extra = n ? ` · note: ${n.note || "-"}${n.split_day ? " (split day)" : ""}` : "";
    lines.push(`${d}: ${(byDay.get(d) ?? ["no shifts"]).join(", ")}${extra}`);
  }
  const staff = (r.staff ?? []).map((u: any) => u.name).join(", ");
  if (staff) lines.push(`Active staff: ${staff}`);
  return lines.join("\n");
}

export function formatShiftChange(r: any): string {
  if (r.removed !== undefined) return r.removed ? `Removed ${r.person}'s shift on ${r.date}.` : `${r.person} had no shift on ${r.date}; nothing removed.`;
  return `${r.change === "created" ? "Added" : "Changed"}: ${fmtShift(r.shift)}${r.before ? ` (was ${fmtShift(r.before)})` : ""}.`;
}
