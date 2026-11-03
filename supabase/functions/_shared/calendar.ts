// deno-lint-ignore-file no-explicit-any
// Keep public.calendar_events in step with VIC's calendars.
//  - Best source: iCloud over CalDAV (secrets ICLOUD_APPLE_ID +
//    ICLOUD_APP_PASSWORD): every event calendar (Hem, Arbete...), and rows
//    keep href/etag so Jarvis can change them (caldav.ts).
//  - Fallback: the calendars' public share links. Secret ICS_URL =
//    comma-separated list of links (webcal:// or https://). Read only.
//  - No Outlook/Graph calendar: VIC doesn't use it, and Jarvis doesn't ask
//    Microsoft for calendar access.
// Window: yesterday to +8 days. Called by the tick every 10 minutes and by
// the app's refresh button.

import { config } from "./config.ts";
import { sb } from "./db.ts";
import { icsName, parseIcs } from "./ics.ts";
import { addDays, localDateStr, startOfLocalDay } from "./time.ts";
import { caldavAuth, recordCaldav, syncCaldav } from "./caldav.ts";

export function icsUrls(raw: string): string[] {
  return raw.split(/[,\s]+/).map((u) => u.trim()).filter(Boolean)
    .map((u) => u.replace(/^webcal:\/\//i, "https://"))
    .filter((u) => /^https:\/\//i.test(u));
}

export async function syncCalendar(now: Date) {
  const today = localDateStr(now);
  const from = startOfLocalDay(addDays(today, -1));
  const to = startOfLocalDay(addDays(today, 9));
  const rows: any[] = [];
  const out: Record<string, unknown> = {};
  const answered: [string, string][] = [];
  const syncedAt = new Date().toISOString();

  // iCloud over CalDAV when set up; the share links only if that fails.
  const auth = await caldavAuth();
  if (auth) {
    try {
      const r = await syncCaldav(auth, from, to);
      await saveAndPrune(dedupeEvents(r.rows), r.answered, from, to, today, r.syncedAt);
      // Rows the share links made earlier (no href) are replaced now.
      if (r.answered.length) await sb.from("calendar_events").delete().eq("source", "icloud").is("href", null);
      await recordCaldav({ ok: true, calendars: r.answered });
      return { via: "caldav", ...r.counts, saved: dedupeEvents(r.rows).length };
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      await recordCaldav({ ok: false, error: msg });
      out["caldav error"] = msg;
    }
  }

  const urls = icsUrls(await config("ICS_URL"));
  for (let i = 0; i < urls.length; i++) {
    const fallbackName = `Calendar ${i + 1}`;
    try {
      const res = await fetch(urls[i], { signal: AbortSignal.timeout(20_000), headers: { Accept: "text/calendar" } });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const text = await res.text();
      const name = icsName(text) ?? fallbackName;
      const events = parseIcs(text, from, to);
      for (const e of events) {
        rows.push({
          id: `icloud:${name}:${e.uid}:${e.start}`, source: "icloud", calendar: name, title: e.title,
          start_at: e.start, end_at: e.end, all_day: e.all_day, location: e.location, synced_at: syncedAt,
        });
      }
      answered.push(["icloud", name]);
      out[name] = events.length;
    } catch (e) {
      out[`${fallbackName} error`] = String((e as Error).message ?? e);
    }
  }

  const unique = dedupeEvents(rows);
  await saveAndPrune(unique, answered.map(([, c]) => c), from, to, today, syncedAt);
  return { ...out, saved: unique.length };
}

// Save, then remove events a calendar no longer has (moved/deleted) - only
// for calendars that answered this time, so a network blip deletes nothing.
async function saveAndPrune(unique: any[], answered: string[], from: Date, to: Date, today: string, syncedAt: string) {
  if (unique.length) {
    const { error } = await sb.from("calendar_events").upsert(unique, { onConflict: "id" });
    if (error) throw new Error(`calendar save: ${error.message}`);
  }
  for (const calendar of answered) {
    await sb.from("calendar_events").delete().eq("source", "icloud").eq("calendar", calendar)
      .gte("start_at", from.toISOString()).lt("start_at", to.toISOString()).lt("synced_at", syncedAt);
  }
  await sb.from("calendar_events").delete().lt("start_at", startOfLocalDay(addDays(today, -7)).toISOString());
}

// Same event in two calendars (same title + start): keep the first. Sorted.
export function dedupeEvents<T extends { title: string; start_at: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const k = `${r.title.toLowerCase().trim()}|${new Date(r.start_at).toISOString()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}
