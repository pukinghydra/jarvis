// deno-lint-ignore-file no-explicit-any
// iCloud calendar over CalDAV, the pure part: request bodies, reading the
// servers' XML answers, building and changing .ics events, and checking what
// VIC (through Claude) asked for. No Deno, no network: Node tests run it.
//
// Safety rules that live here, so every caller gets them:
//  - Jarvis never writes ATTENDEE or ORGANIZER, so no invitation is ever
//    sent by iCloud on its behalf.
//  - Events that have invitees, or repeat, are not changed or deleted by
//    Jarvis (a change could notify other people or hit every occurrence);
//    VIC does those on his iPhone.

import ICAL from "npm:ical.js@2.2.1";
import { TZ, addDays, localDateStr, localParts, pad, parseDateStr, zonedToUtc } from "./time.ts";

export const ICLOUD_CALDAV = "https://caldav.icloud.com/";

// ── XML (DAV multistatus) ────────────────────────────────────────────────
// Servers use any namespace prefix (d:, D:, none, cal:, C:...), so tags are
// matched by local name. A multistatus is flat enough for this.

export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const P = "(?:[A-Za-z_][\\w.-]*:)?";
// Every element with this local name: its inner XML ("" when self-closing).
export function tags(xml: string, name: string): string[] {
  const re = new RegExp(`<${P}${name}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</${P}${name}\\s*>)`, "g");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(m[1] ?? "");
  return out;
}
export const tag = (xml: string, name: string): string | null => tags(xml, name)[0] ?? null;
export const hasTag = (xml: string, name: string): boolean => new RegExp(`<${P}${name}(?=[\\s/>])`).test(xml);
const text = (xml: string | null) => (xml == null ? null : decodeXml(xml.replace(/<[^>]+>/g, "")).trim());

export type DavResponse = { href: string; status: string; props: string };

// One entry per <response>: its href and the inner XML of its 200 propstats.
export function parseMultistatus(xml: string): DavResponse[] {
  return tags(xml, "response").map((r) => {
    const stats = tags(r, "propstat");
    const okProps = stats.filter((s) => /\s2\d\d\s/.test(` ${text(tag(s, "status")) ?? ""} `)).map((s) => tag(s, "prop") ?? "").join("");
    const href = text(tag(r, "href")) ?? "";
    return { href, status: text(tag(r, "status")) ?? "", props: stats.length ? okProps : r };
  });
}

// "/123/principal/" against "https://p12-caldav.icloud.com:443/x" -> absolute.
export function resolveHref(base: string, href: string): string {
  return new URL(href.trim(), base).toString();
}

export const BODY_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
export const BODY_HOME = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
export const BODY_CALENDARS = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>`;

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export function reportBody(from: Date, to: Date): string {
  return `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${utcStamp(from)}" end="${utcStamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}

export const principalHref = (xml: string): string | null => text(tag(tag(xml, "current-user-principal") ?? "", "href"));
export const homeHref = (xml: string): string | null => text(tag(tag(xml, "calendar-home-set") ?? "", "href"));

export type DavCalendar = { href: string; name: string; color: string | null; writable: boolean };

// The event calendars in a calendar home (not reminders lists, inbox/outbox
// or the home itself).
export function parseCalendars(xml: string, base: string): DavCalendar[] {
  const out: DavCalendar[] = [];
  for (const r of parseMultistatus(xml)) {
    const rt = tag(r.props, "resourcetype") ?? "";
    if (!hasTag(rt, "calendar")) continue;
    const comps = tag(r.props, "supported-calendar-component-set");
    if (comps != null && comps.trim() && !/name\s*=\s*["']VEVENT["']/i.test(comps)) continue;
    const priv = tag(r.props, "current-user-privilege-set");
    const writable = priv == null || hasTag(priv, "write") || hasTag(priv, "write-content") || hasTag(priv, "all");
    const color = text(tag(r.props, "calendar-color"));
    out.push({
      href: resolveHref(base, r.href),
      name: text(tag(r.props, "displayname")) || r.href.split("/").filter(Boolean).pop() || "Calendar",
      color: color ? color.slice(0, 7) : null,
      writable,
    });
  }
  return out;
}

export type DavObject = { href: string; etag: string | null; data: string };
export function parseCalendarData(xml: string, base: string): DavObject[] {
  return parseMultistatus(xml)
    .map((r) => ({ href: resolveHref(base, r.href), etag: text(tag(r.props, "getetag")), data: decodeXml(tag(r.props, "calendar-data") ?? "").trim() }))
    .filter((o) => o.data.includes("BEGIN:VCALENDAR"));
}

// ── Choosing the calendar ────────────────────────────────────────────────
export function pickCalendar(cals: DavCalendar[], wanted: string | null | undefined, fallback: string | null | undefined): DavCalendar {
  const writable = cals.filter((c) => c.writable);
  if (!writable.length) throw new Error("No writable calendar found on the iPhone account.");
  const find = (n: string | null | undefined) => {
    const k = String(n ?? "").trim().toLowerCase();
    return k ? writable.find((c) => c.name.toLowerCase() === k) : undefined;
  };
  if (wanted && String(wanted).trim()) {
    const hit = find(wanted);
    if (!hit) throw new Error(`No calendar called "${wanted}". Calendars: ${writable.map((c) => c.name).join(", ")}`);
    return hit;
  }
  return find(fallback) ?? writable[0];
}

// ── What Claude asked for → start/end ────────────────────────────────────
export type When = { start: Date; end: Date; allDay: boolean };

// "YYYY-MM-DD" (all day), "YYYY-MM-DDTHH:MM[:SS]" (Stockholm wall time) or
// ISO with an offset/Z.
export function parseInstant(s: string): { at: Date; dateOnly: string | null } {
  const v = String(s ?? "").trim();
  const d = parseDateStr(v);
  if (d) return { at: zonedToUtc(d.y, d.m, d.d, 0, 0), dateOnly: v };
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (!m) throw new Error(`"${v}" is not a date (YYYY-MM-DD) or time (YYYY-MM-DDTHH:MM with +01:00/+02:00)`);
  const day = parseDateStr(m[1]);
  if (!day || +m[2] > 23 || +m[3] > 59) throw new Error(`"${v}" is not a real date/time`);
  if (!m[5]) return { at: zonedToUtc(day.y, day.m, day.d, +m[2], +m[3]), dateOnly: null };
  const at = new Date(v.replace(" ", "T"));
  if (isNaN(at.getTime())) throw new Error(`"${v}" is not a real date/time`);
  return { at, dateOnly: null };
}

export function eventWhen(start: string, end: string | null | undefined, allDay: boolean | null | undefined, now: Date): When {
  const s = parseInstant(start);
  const isAllDay = allDay === true || (allDay !== false && s.dateOnly != null);
  let st = s.at, en: Date;
  if (isAllDay) {
    const first = s.dateOnly ?? localDateStr(s.at);
    st = parseInstant(first).at;
    const last = end ? (parseInstant(end).dateOnly ?? localDateStr(parseInstant(end).at)) : first;
    if (last < first) throw new Error("end is before start");
    const after = addDays(last, 1); // DTEND is exclusive for all-day events
    en = parseInstant(after).at;
  } else {
    en = end ? parseInstant(end).at : new Date(st.getTime() + 3600_000);
    if (end && parseInstant(end).dateOnly) throw new Error("end needs a time when start has one");
  }
  if (en.getTime() <= st.getTime()) throw new Error("end must be after start");
  if (en.getTime() - st.getTime() > 31 * 86400_000) throw new Error("events longer than 31 days are not supported");
  const yearsAway = (st.getTime() - now.getTime()) / (365 * 86400_000);
  if (yearsAway > 5 || yearsAway < -2) throw new Error("that date is too far away; check the year");
  return { start: st, end: en, allDay: isAllDay };
}

// ── Writing .ics ─────────────────────────────────────────────────────────
export function escapeText(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// RFC 5545: lines over 75 octets continue on the next line after a space.
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { parts.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export const VTIMEZONE_STOCKHOLM = [
  "BEGIN:VTIMEZONE", `TZID:${TZ}`,
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

const localStamp = (d: Date) => { const p = localParts(d); return `${p.y}${pad(p.m)}${pad(p.d)}T${pad(p.h)}${pad(p.mi)}00`; };
const dateStamp = (d: Date) => localDateStr(d).replace(/-/g, "");

export function dtLines(w: When): string[] {
  return w.allDay
    ? [`DTSTART;VALUE=DATE:${dateStamp(w.start)}`, `DTEND;VALUE=DATE:${dateStamp(w.end)}`]
    : [`DTSTART;TZID=${TZ}:${localStamp(w.start)}`, `DTEND;TZID=${TZ}:${localStamp(w.end)}`];
}

export type NewEvent = { uid: string; title: string; when: When; location?: string | null; notes?: string | null; alertMinutes?: number | null };

export function buildEventIcs(ev: NewEvent, now: Date): string {
  const title = String(ev.title ?? "").trim();
  if (!title) throw new Error("title is empty");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jarvis//VIC//EN", "CALSCALE:GREGORIAN",
    ...(ev.when.allDay ? [] : VTIMEZONE_STOCKHOLM),
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `CREATED:${utcStamp(now)}`,
    `LAST-MODIFIED:${utcStamp(now)}`,
    "SEQUENCE:0",
    ...dtLines(ev.when),
    `SUMMARY:${escapeText(title)}`,
    ...(ev.location?.trim() ? [`LOCATION:${escapeText(ev.location.trim())}`] : []),
    ...(ev.notes?.trim() ? [`DESCRIPTION:${escapeText(ev.notes.trim())}`] : []),
    ...(ev.alertMinutes != null && ev.alertMinutes >= 0
      ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(title)}`, `TRIGGER:-PT${Math.round(ev.alertMinutes)}M`, "END:VALARM"]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ── Changing an existing event ───────────────────────────────────────────
const unfold = (ics: string) => ics.replace(/\r?\n[ \t]/g, "");
export function eventGuard(ics: string): string | null {
  const u = unfold(ics);
  if (/^(ATTENDEE|ORGANIZER)[;:]/mi.test(u)) return "it has invitees, so changing it could notify other people - change it on the iPhone";
  if (/^(RRULE|RDATE|RECURRENCE-ID)[;:]/mi.test(u) || (u.match(/^BEGIN:VEVENT/gmi) ?? []).length > 1) return "it repeats - change repeating events on the iPhone";
  return null;
}

export type EventPatch = { title?: string; when?: When; location?: string | null; notes?: string | null };

export function modifyEventIcs(ics: string, patch: EventPatch, now: Date): string {
  const blocked = eventGuard(ics);
  if (blocked) throw new Error(`Can't change this event: ${blocked}.`);
  const cal = new ICAL.Component(ICAL.parse(ics));
  const ve = cal.getFirstSubcomponent("vevent");
  if (!ve) throw new Error("no event in that calendar object");
  const setText = (name: string, v: string | null | undefined) => {
    if (v === undefined) return;
    ve.removeAllProperties(name);
    if (v != null && String(v).trim()) ve.addPropertyWithValue(name, String(v).trim());
  };
  if (patch.title !== undefined) {
    if (!String(patch.title ?? "").trim()) throw new Error("title is empty");
    setText("summary", patch.title);
  }
  setText("location", patch.location);
  setText("description", patch.notes);
  if (patch.when) {
    for (const p of ["dtstart", "dtend", "duration"]) ve.removeAllProperties(p);
    for (const l of dtLines(patch.when)) ve.addProperty(ICAL.Property.fromString(l));
    if (!patch.when.allDay && !cal.getAllSubcomponents("vtimezone").some((tz: any) => tz.getFirstPropertyValue("tzid") === TZ)) {
      const tz = new ICAL.Component(ICAL.parse(["BEGIN:VCALENDAR", ...VTIMEZONE_STOCKHOLM, "END:VCALENDAR"].join("\r\n"))).getFirstSubcomponent("vtimezone");
      if (tz) {
        cal.addSubcomponent(tz);
        const subs = cal.jCal[2];
        subs.unshift(subs.pop()); // the time zone goes before the event
      }
    }
  }
  const seq = Number(ve.getFirstPropertyValue("sequence") ?? 0) || 0;
  ve.updatePropertyWithValue("sequence", seq + 1);
  for (const p of ["dtstamp", "last-modified"]) {
    ve.removeAllProperties(p);
    ve.addProperty(ICAL.Property.fromString(`${p.toUpperCase()}:${utcStamp(now)}`));
  }
  const out = cal.toString();
  if (/^(ATTENDEE|ORGANIZER)[;:]/mi.test(unfold(out))) throw new Error("refusing to write invitees");
  return out.replace(/\r?\n/g, "\r\n") + (out.endsWith("\n") ? "" : "\r\n");
}

// A new event's file name and UID.
export function newUid(rand: string): { uid: string; file: string } {
  const id = rand.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return { uid: `${id}@jarvis`, file: `${id}.ics` };
}

export const basicAuth = (user: string, pass: string) => {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
};
