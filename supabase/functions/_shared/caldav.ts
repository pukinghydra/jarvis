// deno-lint-ignore-file no-explicit-any
// VIC's iPhone (iCloud) calendars over CalDAV: read all of them, and add,
// change or delete events. Needs two secrets (any capitalisation):
//   ICLOUD_APPLE_ID      his Apple ID email
//   ICLOUD_APP_PASSWORD  an app-specific password from account.apple.com
// Without them Jarvis keeps reading the public share link (ICS_URL) and
// can't write. Never invites anyone (see caldav-core.ts).

import { config } from "./config.ts";
import { sb, must, getSetting } from "./db.ts";
import { parseIcs } from "./ics.ts";
import {
  BODY_CALENDARS, BODY_HOME, BODY_PRINCIPAL, ICLOUD_CALDAV, basicAuth, buildEventIcs, eventGuard, eventWhen,
  homeHref, modifyEventIcs, newUid, parseCalendarData, parseCalendars, pickCalendar, principalHref, reportBody,
  resolveHref, type DavCalendar, type EventPatch,
} from "./caldav-core.ts";
import { addDays, localDateStr, startOfLocalDay } from "./time.ts";

export type CaldavCache = { home: string; calendars: DavCalendar[]; at: string };
export const DEFAULT_CALENDAR = "Arbete";

export async function caldavAuth(): Promise<string | null> {
  const [user, pass] = await Promise.all([config("ICLOUD_APPLE_ID"), config("ICLOUD_APP_PASSWORD")]);
  return user && pass ? basicAuth(user.trim(), pass.replace(/\s+/g, "")) : null;
}

const NOT_SET_UP = "Jarvis can't write to the iPhone calendar yet: add the secrets ICLOUD_APPLE_ID (Apple ID email) and ICLOUD_APP_PASSWORD (an app-specific password from account.apple.com) in Supabase > Edge Functions > Secrets.";

async function needAuth(): Promise<string> {
  const a = await caldavAuth();
  if (!a) throw new Error(NOT_SET_UP);
  return a;
}

const isIcloud = (u: string) => {
  const h = new URL(u).hostname.toLowerCase();
  return new URL(u).protocol === "https:" && (h === "icloud.com" || h.endsWith(".icloud.com"));
};

// One CalDAV request. Redirects (iCloud sends you to your pXX- host) are
// followed by hand so the password goes with them, and only to icloud.com.
export async function dav(auth: string, method: string, url: string, opts: { depth?: string; body?: string; headers?: Record<string, string> } = {}) {
  let target = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!isIcloud(target)) throw new Error(`CalDAV: refusing to send the password to ${new URL(target).hostname}`);
    const headers: Record<string, string> = { Authorization: auth, ...(opts.headers ?? {}) };
    if (opts.depth != null) headers.Depth = opts.depth;
    if (opts.body != null) headers["Content-Type"] = method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8";
    const res = await fetch(target, { method, headers, body: opts.body, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if ([301, 302, 307, 308].includes(res.status) && res.headers.get("location")) {
      await res.body?.cancel();
      target = new URL(res.headers.get("location")!, target).toString();
      continue;
    }
    return { status: res.status, text: await res.text(), etag: res.headers.get("etag"), url: target };
  }
  throw new Error("CalDAV: too many redirects");
}

const fail = (what: string, status: number) =>
  new Error(status === 401 || status === 403
    ? "iCloud refused the Apple ID / app-specific password (make a new app-specific password and update ICLOUD_APP_PASSWORD)"
    : `iCloud ${what} answered ${status}`);

async function setStatus(v: Record<string, unknown>) {
  await sb.from("settings").upsert({ key: "caldav_status", value: { ...v, checked_at: new Date().toISOString() }, updated_at: new Date().toISOString() });
}

// Principal -> calendar home -> calendars. Kept for a day.
export async function discover(auth: string, force = false): Promise<CaldavCache> {
  const cached = await getSetting<CaldavCache | null>("caldav_cache", null);
  if (!force && cached?.at && Date.now() - Date.parse(cached.at) < 86400_000 && cached.calendars?.length) return cached;
  let r = await dav(auth, "PROPFIND", ICLOUD_CALDAV, { depth: "0", body: BODY_PRINCIPAL });
  if (r.status !== 207) throw fail("sign-in", r.status);
  const principal = principalHref(r.text);
  if (!principal) throw new Error("iCloud didn't say where the calendars are (no principal)");
  r = await dav(auth, "PROPFIND", resolveHref(r.url, principal), { depth: "0", body: BODY_HOME });
  if (r.status !== 207) throw fail("principal", r.status);
  const home = homeHref(r.text);
  if (!home) throw new Error("iCloud didn't say where the calendars are (no calendar home)");
  const homeUrl = resolveHref(r.url, home);
  r = await dav(auth, "PROPFIND", homeUrl, { depth: "1", body: BODY_CALENDARS });
  if (r.status !== 207) throw fail("calendar list", r.status);
  const calendars = parseCalendars(r.text, r.url);
  if (!calendars.length) throw new Error("iCloud has no event calendars on this Apple ID");
  const out: CaldavCache = { home: homeUrl, calendars, at: new Date().toISOString() };
  await sb.from("settings").upsert({ key: "caldav_cache", value: out, updated_at: out.at });
  return out;
}

const eventRow = (cal: string, e: { uid: string; title: string; start: string; end: string | null; all_day: boolean; location: string | null }, href: string, etag: string | null, syncedAt: string) => ({
  id: `icloud:${cal}:${e.uid}:${e.start}`, source: "icloud", calendar: cal, title: e.title,
  start_at: e.start, end_at: e.end, all_day: e.all_day, location: e.location, synced_at: syncedAt,
  href, etag, uid: e.uid,
});

// Read every event calendar for [from, to). Rows keep the same ids the share
// link used, plus href/etag so Jarvis can change them.
export async function syncCaldav(auth: string, from: Date, to: Date): Promise<{ rows: any[]; answered: string[]; counts: Record<string, number>; syncedAt: string }> {
  let cache = await discover(auth);
  const syncedAt = new Date().toISOString();
  const rows: any[] = [];
  const answered: string[] = [];
  const counts: Record<string, number> = {};
  let rediscover = false;
  for (const cal of cache.calendars) {
    const r = await dav(auth, "REPORT", cal.href, { depth: "1", body: reportBody(from, to) });
    if (r.status === 404) { rediscover = true; continue; }
    if (r.status !== 207) throw fail(`calendar ${cal.name}`, r.status);
    let n = 0;
    for (const obj of parseCalendarData(r.text, r.url)) {
      for (const e of parseIcs(obj.data, from, to)) { rows.push(eventRow(cal.name, e, obj.href, obj.etag, syncedAt)); n++; }
    }
    answered.push(cal.name);
    counts[cal.name] = n;
  }
  if (rediscover) cache = await discover(auth, true);
  return { rows, answered, counts, syncedAt };
}

export async function caldavStatus() {
  const configured = !!(await caldavAuth());
  const [st, cache, def] = await Promise.all([
    getSetting<any>("caldav_status", null), getSetting<CaldavCache | null>("caldav_cache", null), getSetting<string>("default_calendar", DEFAULT_CALENDAR),
  ]);
  return {
    configured,
    ok: configured && !!st?.ok,
    error: configured && st && !st.ok ? String(st.error ?? "") : null,
    calendars: configured ? (cache?.calendars ?? []).map((c) => c.name) : [],
    default_calendar: typeof def === "string" ? def : DEFAULT_CALENDAR,
    checked_at: st?.checked_at ?? null,
  };
}
export const recordCaldav = setStatus;

// ── Writing ──────────────────────────────────────────────────────────────
export type NewEventInput = { title: string; start: string; end?: string | null; all_day?: boolean | null; calendar?: string | null; location?: string | null; notes?: string | null; alert_minutes?: number | null };

const windowFor = (at: Date) => ({ from: startOfLocalDay(addDays(localDateStr(at), -1)), to: startOfLocalDay(addDays(localDateStr(at), 40)) });

async function saveRows(ics: string, cal: string, href: string, etag: string | null, at: Date) {
  const { from, to } = windowFor(at);
  const now = new Date().toISOString();
  const rows = parseIcs(ics, from, to).map((e) => eventRow(cal, e, href, etag, now));
  must(await sb.from("calendar_events").delete().eq("href", href), "calendar clear");
  if (rows.length) must(await sb.from("calendar_events").upsert(rows, { onConflict: "id" }), "calendar save");
  const saved = must(await sb.from("calendar_events").select("short_id, title, start_at, end_at, all_day, calendar, location").eq("href", href).order("start_at").limit(1), "calendar read") ?? [];
  return saved[0] ?? null;
}

export async function addEvent(input: NewEventInput, now = new Date()) {
  const auth = await needAuth();
  const cache = await discover(auth);
  const cal = pickCalendar(cache.calendars, input.calendar, await getSetting<string>("default_calendar", DEFAULT_CALENDAR));
  const when = eventWhen(String(input.start ?? ""), input.end ?? null, input.all_day ?? null, now);
  const { uid, file } = newUid(crypto.randomUUID());
  const alert = input.alert_minutes == null ? null : Math.max(0, Math.min(10080, Math.round(Number(input.alert_minutes))));
  const ics = buildEventIcs({ uid, title: String(input.title ?? ""), when, location: input.location ?? null, notes: input.notes ?? null, alertMinutes: Number.isFinite(alert as number) ? alert : null }, now);
  const href = cal.href.replace(/\/?$/, "/") + file;
  const r = await dav(auth, "PUT", href, { body: ics, headers: { "If-None-Match": "*" } });
  if (![200, 201, 204].includes(r.status)) throw fail("save", r.status);
  const row = await saveRows(ics, cal.name, href, r.etag, when.start);
  return { calendar: cal.name, when, row };
}

async function findEvent(ref: string) {
  const k = String(ref ?? "").trim().toLowerCase().replace(/^ev[\s:-]*/, "");
  if (!k) throw new Error("id is empty");
  const q = sb.from("calendar_events").select("id, short_id, href, title, start_at, end_at, all_day, calendar");
  const rows = must(await (k.length > 8 ? q.eq("id", ref) : q.eq("short_id", k.slice(0, 8))).limit(2), "find event") ?? [];
  if (rows.length !== 1) throw new Error(`No single calendar event ${ref} (use the id from calendar_events)`);
  const ev = rows[0] as any;
  if (!ev.href) throw new Error("Jarvis can only change events it can reach over iCloud (set up ICLOUD_APPLE_ID / ICLOUD_APP_PASSWORD).");
  return ev;
}

async function fetchObject(auth: string, href: string) {
  const r = await dav(auth, "GET", href);
  if (r.status === 404) throw new Error("That event no longer exists in iCloud.");
  if (r.status !== 200) throw fail("read", r.status);
  return r;
}

export type EventChange = { title?: string; start?: string; end?: string; all_day?: boolean; location?: string | null; notes?: string | null };

export async function updateEvent(ref: string, change: EventChange, now = new Date()) {
  const auth = await needAuth();
  const ev = await findEvent(ref);
  const cur = await fetchObject(auth, ev.href);
  const blocked = eventGuard(cur.text);
  if (blocked) throw new Error(`Can't change "${ev.title}": ${blocked}.`);
  const patch: EventPatch = {};
  if (change.title !== undefined) patch.title = change.title;
  if (change.location !== undefined) patch.location = change.location;
  if (change.notes !== undefined) patch.notes = change.notes;
  if (change.start !== undefined || change.end !== undefined || change.all_day !== undefined) {
    const allDay = change.all_day ?? (change.start ? undefined : ev.all_day);
    const start = change.start ?? (ev.all_day ? localDateStr(new Date(ev.start_at)) : ev.start_at);
    let end = change.end ?? null;
    if (!end && change.start && ev.end_at) {
      // Moving keeps the length.
      const dur = Date.parse(ev.end_at) - Date.parse(ev.start_at);
      if (ev.all_day) {
        const days = Math.max(1, Math.round(dur / 86400_000));
        end = days > 1 ? addDays(String(change.start).slice(0, 10), days - 1) : null;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(change.start).trim())) {
        end = new Date(Date.parse(new Date(eventWhen(String(change.start), null, false, now).start).toISOString()) + dur).toISOString();
      }
    }
    patch.when = eventWhen(String(start), end, allDay ?? null, now);
  }
  const ics = modifyEventIcs(cur.text, patch, now);
  const r = await dav(auth, "PUT", ev.href, { body: ics, headers: cur.etag ? { "If-Match": cur.etag } : {} });
  if (r.status === 412) throw new Error("The event changed on the iPhone meanwhile; ask again and I'll retry.");
  if (![200, 201, 204].includes(r.status)) throw fail("save", r.status);
  const row = await saveRows(ics, ev.calendar, ev.href, r.etag, patch.when?.start ?? new Date(ev.start_at));
  return { before: ev, row };
}

export async function deleteEvent(ref: string) {
  const auth = await needAuth();
  const ev = await findEvent(ref);
  const cur = await fetchObject(auth, ev.href);
  const blocked = eventGuard(cur.text);
  if (blocked) throw new Error(`Can't delete "${ev.title}": ${blocked}.`);
  const r = await dav(auth, "DELETE", ev.href, { headers: cur.etag ? { "If-Match": cur.etag } : {} });
  if (r.status === 412) throw new Error("The event changed on the iPhone meanwhile; ask again and I'll retry.");
  if (![200, 204, 404].includes(r.status)) throw fail("delete", r.status);
  must(await sb.from("calendar_events").delete().eq("href", ev.href), "calendar clear");
  return ev;
}

export async function listCalendars() {
  const auth = await caldavAuth();
  const def = await getSetting<string>("default_calendar", DEFAULT_CALENDAR);
  if (!auth) return { write: false, calendars: [] as DavCalendar[], default_calendar: def, note: NOT_SET_UP };
  const cache = await discover(auth);
  return { write: true, calendars: cache.calendars, default_calendar: def, note: null };
}
