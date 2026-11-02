// deno-lint-ignore-file no-explicit-any
// Parse an iCalendar (.ics) feed - e.g. an iCloud calendar's public share
// link - into events in a time window, with repeating events expanded and
// moved/cancelled occurrences respected. No network here: pure.

import ICAL from "npm:ical.js@2.2.1";
import { zonedToUtc } from "./time.ts";

export type IcsEvent = { uid: string; title: string; start: string; end: string | null; all_day: boolean; location: string | null };

function toDate(t: any): { at: Date; allDay: boolean } {
  if (t.isDate) return { at: zonedToUtc(t.year, t.month, t.day, 0, 0), allDay: true };
  const tzid = t.zone?.tzid;
  if (!tzid || tzid === "floating") return { at: zonedToUtc(t.year, t.month, t.day, t.hour, t.minute), allDay: false };
  return { at: t.toJSDate(), allDay: false };
}

// The calendar's own name (X-WR-CALNAME), e.g. "Hem" or "Arbete".
export function icsName(text: string): string | null {
  try {
    const comp = new ICAL.Component(ICAL.parse(text));
    const n = comp.getFirstPropertyValue("x-wr-calname");
    return n ? String(n).trim() || null : null;
  } catch {
    return null;
  }
}

export function parseIcs(text: string, from: Date, to: Date): IcsEvent[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      // a broken VTIMEZONE: its events fall back to Stockholm time
    }
  }
  const out: IcsEvent[] = [];
  const fromMs = from.getTime(), toMs = to.getTime();
  for (const ve of comp.getAllSubcomponents("vevent")) {
    let ev: any;
    try {
      ev = new ICAL.Event(ve);
    } catch {
      continue;
    }
    if (ev.isRecurrenceException()) continue; // folded into its master below
    if (String(ve.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") continue;
    const durMs = ev.endDate && ev.startDate ? toDate(ev.endDate).at.getTime() - toDate(ev.startDate).at.getTime() : 0;

    const push = (startT: any, endT: any, item: any) => {
      const s = toDate(startT);
      const e = endT ? toDate(endT).at : new Date(s.at.getTime() + Math.max(durMs, 0));
      if (e.getTime() < fromMs || s.at.getTime() >= toMs) return;
      out.push({
        uid: String(ev.uid ?? ""),
        title: String(item.summary ?? "(no title)"),
        start: s.at.toISOString(),
        end: e.toISOString(),
        all_day: s.allDay,
        location: item.location ? String(item.location) : null,
      });
    };

    if (!ev.isRecurring()) {
      if (ev.startDate) push(ev.startDate, ev.endDate, ev);
      continue;
    }
    const it = ev.iterator();
    let next: any;
    for (let i = 0; i < 20000 && (next = it.next()); i++) {
      const at = toDate(next).at.getTime();
      if (at >= toMs) break;
      if (at + Math.max(durMs, 0) < fromMs) continue;
      const occ = ev.getOccurrenceDetails(next);
      const status = String(occ.item?.component?.getFirstPropertyValue("status") ?? "").toUpperCase();
      if (status === "CANCELLED") continue;
      push(occ.startDate, occ.endDate, occ.item);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
