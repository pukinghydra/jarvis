import { suite, eq, ok } from "./t.ts";
import {
  buildEventIcs, eventGuard, eventWhen, escapeText, foldLine, modifyEventIcs, parseCalendarData, parseCalendars,
  parseMultistatus, pickCalendar, principalHref, homeHref, resolveHref, reportBody, newUid,
} from "../supabase/functions/_shared/caldav-core.ts";
import { parseIcs } from "../supabase/functions/_shared/ics.ts";

const { test, run } = suite();
export { run };

const NOW = new Date("2026-11-03T10:00:00Z");
const throws = (fn: () => unknown, re: RegExp, msg: string) => {
  try { fn(); } catch (e) { ok(re.test(String((e as Error).message)), `${msg}: wrong error "${(e as Error).message}"`); return; }
  throw new Error(`${msg}: expected an error`);
};

test("caldav: new timed event has TZID, VTIMEZONE, escaping, alert, and never invitees", () => {
  const when = eventWhen("2026-11-06T14:00:00+01:00", null, null, NOW);
  const ics = buildEventIcs({ uid: "abc@jarvis", title: "Tandläkare; Dr, Berg", when, location: "Götgatan 1\nStockholm", alertMinutes: 30 }, NOW);
  ok(ics.includes("DTSTART;TZID=Europe/Stockholm:20261106T140000"), "start in Stockholm time");
  ok(ics.includes("DTEND;TZID=Europe/Stockholm:20261106T150000"), "default 1 h");
  ok(ics.includes("BEGIN:VTIMEZONE") && ics.includes("TZID:Europe/Stockholm"), "time zone block");
  ok(ics.includes("SUMMARY:Tandläkare\\; Dr\\, Berg"), "escaped summary");
  ok(ics.includes("LOCATION:Götgatan 1\\nStockholm"), "escaped newline");
  ok(ics.includes("TRIGGER:-PT30M"), "alert");
  ok(!/^(ATTENDEE|ORGANIZER)/m.test(ics), "no invitees");
  ok(ics.includes("\r\n") && ics.endsWith("\r\n"), "CRLF");
  const back = parseIcs(ics, new Date("2026-11-05T00:00:00Z"), new Date("2026-11-08T00:00:00Z"));
  eq(back.length, 1); eq(back[0].title, "Tandläkare; Dr, Berg"); eq(back[0].start, "2026-11-06T13:00:00.000Z");
});

test("caldav: all-day event uses VALUE=DATE with an exclusive end", () => {
  const when = eventWhen("2026-12-24", "2026-12-26", null, NOW);
  ok(when.allDay);
  const ics = buildEventIcs({ uid: "x@jarvis", title: "Jul", when }, NOW);
  ok(ics.includes("DTSTART;VALUE=DATE:20261224") && ics.includes("DTEND;VALUE=DATE:20261227"), ics);
  ok(!ics.includes("BEGIN:VTIMEZONE"), "no time zone needed");
});

test("caldav: summer time offset and wall-time input", () => {
  const w = eventWhen("2027-06-10T09:30", null, false, NOW);
  eq(w.start.toISOString(), "2027-06-10T07:30:00.000Z", "CEST is +02:00");
  throws(() => eventWhen("2026-11-06T14:00:00+01:00", "2026-11-06T13:00:00+01:00", null, NOW), /after start/, "end before start");
  throws(() => eventWhen("2036-01-01", null, null, NOW), /too far/, "wrong year");
  throws(() => eventWhen("fredag", null, null, NOW), /not a date/, "not a date");
});

test("caldav: escaping and line folding", () => {
  eq(escapeText("a\\b;c,d\ne"), "a\\\\b\\;c\\,d\\ne");
  const long = "SUMMARY:" + "å".repeat(60);
  const folded = foldLine(long);
  for (const part of folded.split("\r\n")) ok(new TextEncoder().encode(part).length <= 75, "line within 75 octets");
  eq(folded.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join(""), long, "unfolds back");
});

test("caldav: discovery XML with prefixes, partition host and calendars", () => {
  const principal = `<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/</href><propstat><prop><current-user-principal><href>/123456/principal/</href></current-user-principal></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;
  eq(principalHref(principal), "/123456/principal/");
  const home = `<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123456/principal/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>https://p42-caldav.icloud.com:443/123456/calendars/</d:href></cal:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  eq(homeHref(home), "https://p42-caldav.icloud.com:443/123456/calendars/");
  eq(resolveHref("https://p42-caldav.icloud.com:443/123456/calendars/", "/123456/calendars/home/"), "https://p42-caldav.icloud.com/123456/calendars/home/");
  const list = `<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
    <response><href>/123456/calendars/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
    <response><href>/123456/calendars/home/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Hem</displayname><A:calendar-color>#34AADCFF</A:calendar-color><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set><current-user-privilege-set><privilege><all/></privilege></current-user-privilege-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
    <response><href>/123456/calendars/work/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Arbete &amp; jobb</displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set><current-user-privilege-set><privilege><read/></privilege><privilege><write/></privilege></current-user-privilege-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
    <response><href>/123456/calendars/tasks/</href><propstat><prop><resourcetype><collection/><C:calendar/></resourcetype><displayname>Påminnelser</displayname><C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set></prop><status>HTTP/1.1 200 OK</status></propstat></response>
    <response><href>/123456/calendars/inbox/</href><propstat><prop><resourcetype><collection/><C:schedule-inbox/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>
  </multistatus>`;
  const cals = parseCalendars(list, "https://p42-caldav.icloud.com/123456/calendars/");
  eq(cals.map((c) => c.name), ["Hem", "Arbete & jobb"], "event calendars only, entities decoded");
  eq(cals[0].href, "https://p42-caldav.icloud.com/123456/calendars/home/");
  eq(cals[0].color, "#34AADC");
  ok(cals.every((c) => c.writable));
});

test("caldav: picking a calendar", () => {
  const cals = [{ href: "h", name: "Hem", color: null, writable: true }, { href: "a", name: "Arbete", color: null, writable: true }, { href: "r", name: "Helgdagar", color: null, writable: false }];
  eq(pickCalendar(cals, "hem", "Arbete").name, "Hem");
  eq(pickCalendar(cals, null, "Arbete").name, "Arbete");
  eq(pickCalendar(cals, "", "Saknas").name, "Hem", "fallback to the first writable");
  throws(() => pickCalendar(cals, "Helgdagar", "Arbete"), /No calendar called/, "read-only calendar can't be picked");
});

test("caldav: report answer with CDATA and a failed propstat", () => {
  const ics = buildEventIcs({ uid: "u1@jarvis", title: "Möte <viktigt>", when: eventWhen("2026-11-04T09:00:00+01:00", null, null, NOW) }, NOW);
  const xml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/1/calendars/work/u1.ics</d:href>
    <d:propstat><d:prop><d:getetag>"abc"</d:getetag><c:calendar-data><![CDATA[${ics}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    <d:propstat><d:prop><d:owner/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>`;
  const objs = parseCalendarData(xml, "https://p42-caldav.icloud.com/1/calendars/work/");
  eq(objs.length, 1);
  eq(objs[0].href, "https://p42-caldav.icloud.com/1/calendars/work/u1.ics");
  eq(objs[0].etag, '"abc"');
  ok(objs[0].data.includes("SUMMARY:Möte <viktigt>"), "CDATA kept intact");
  eq(parseMultistatus(xml)[0].href, "/1/calendars/work/u1.ics");
  ok(reportBody(new Date("2026-11-03T00:00:00Z"), new Date("2026-11-04T00:00:00Z")).includes('start="20261103T000000Z" end="20261104T000000Z"'));
});

test("caldav: guard refuses invitees and repeats; modify keeps uid and bumps sequence", () => {
  const base = buildEventIcs({ uid: "u2@jarvis", title: "Lunch", when: eventWhen("2026-11-05T12:00:00+01:00", null, null, NOW) }, NOW);
  eq(eventGuard(base), null);
  ok(eventGuard(base.replace("SUMMARY:", "ATTENDEE;CN=Anna:mailto:anna@example.com\r\nSUMMARY:")), "invitees blocked");
  ok(eventGuard(base.replace("SUMMARY:", "RRULE:FREQ=WEEKLY\r\nSUMMARY:")), "repeats blocked");
  const moved = modifyEventIcs(base, { title: "Lunch med Johan", when: eventWhen("2026-11-05T13:00:00+01:00", "2026-11-05T14:30:00+01:00", null, NOW) }, new Date("2026-11-03T11:00:00Z"));
  ok(moved.includes("UID:u2@jarvis"), "same uid");
  ok(/SEQUENCE:1/.test(moved), "sequence bumped");
  ok(moved.includes("SUMMARY:Lunch med Johan"));
  const ev = parseIcs(moved, new Date("2026-11-05T00:00:00Z"), new Date("2026-11-06T00:00:00Z"))[0];
  eq([ev.start, ev.end], ["2026-11-05T12:00:00.000Z", "2026-11-05T13:30:00.000Z"]);
  ok(!/^(ATTENDEE|ORGANIZER)/m.test(moved), "still no invitees");
  throws(() => modifyEventIcs(base.replace("SUMMARY:", "RRULE:FREQ=DAILY\r\nSUMMARY:"), { title: "x" }, NOW), /repeats/, "won't modify a repeat");
});

test("caldav: new uid/file are safe names", () => {
  const r = newUid("3F2A-..//<b>9");
  eq(r, { uid: "3f2a-b9@jarvis", file: "3f2a-b9.ics" });
});
