import { suite, eq, ok } from "./t.ts";
import { parseIcs, icsName } from "../supabase/functions/_shared/ics.ts";
import { handleBody, handleRpc, type ToolDef } from "../supabase/functions/_shared/mcp-core.ts";
import { renderBrief, type BriefData } from "../supabase/functions/_shared/brief-core.ts";
import { localTimeStr, localDateStr } from "../supabase/functions/_shared/time.ts";
import { formatSchedule, formatShiftChange } from "../supabase/functions/_shared/thriftin-core.ts";
import { TOOL_DEFS } from "../supabase/functions/_shared/tool-defs.ts";

const { test, run } = suite();
export { run };

// An iCloud-style feed: VTIMEZONE, a weekly repeat with one moved and one
// cancelled occurrence, an all-day event, a floating-time event.
const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iCloud//EN
X-WR-CALNAME:Hem
BEGIN:VTIMEZONE
TZID:Europe/Stockholm
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
DTSTART:19810329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZNAME:CEST
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
DTSTART:19961027T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZNAME:CET
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:gym-1
SUMMARY:Gym
DTSTART;TZID=Europe/Stockholm:20261019T070000
DTEND;TZID=Europe/Stockholm:20261019T080000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Europe/Stockholm:20261109T070000
LOCATION:SATS Odenplan
END:VEVENT
BEGIN:VEVENT
UID:gym-1
RECURRENCE-ID;TZID=Europe/Stockholm:20261102T070000
SUMMARY:Gym (moved)
DTSTART;TZID=Europe/Stockholm:20261102T180000
DTEND;TZID=Europe/Stockholm:20261102T190000
END:VEVENT
BEGIN:VEVENT
UID:trip-1
SUMMARY:Göteborg
DTSTART;VALUE=DATE:20261105
DTEND;VALUE=DATE:20261107
END:VEVENT
BEGIN:VEVENT
UID:float-1
SUMMARY:Tandläkare
DTSTART:20261104T143000
DTEND:20261104T150000
LOCATION:Södermalm
END:VEVENT
END:VCALENDAR`;

test("ics: calendar name", () => eq(icsName(ICS), "Hem"));
test("ics: expands weekly, applies moved and cancelled occurrences", () => {
  const ev = parseIcs(ICS, new Date("2026-11-01T00:00:00Z"), new Date("2026-11-17T00:00:00Z"));
  const gym = ev.filter((e) => e.uid === "gym-1");
  eq(gym.map((e) => `${localDateStr(new Date(e.start))} ${localTimeStr(new Date(e.start))} ${e.title}`),
    ["2026-11-02 18:00 Gym (moved)", "2026-11-16 07:00 Gym"]);
  eq(gym[1].location, "SATS Odenplan");
});
test("ics: winter time zone correct (07:00 CET = 06:00Z)", () => {
  const ev = parseIcs(ICS, new Date("2026-11-15T00:00:00Z"), new Date("2026-11-17T00:00:00Z"));
  eq(ev[0].start, "2026-11-16T06:00:00.000Z");
});
test("ics: summer occurrence uses CEST (07:00 = 05:00Z)", () => {
  const ev = parseIcs(ICS, new Date("2026-10-18T00:00:00Z"), new Date("2026-10-20T00:00:00Z"));
  eq(ev.find((e) => e.uid === "gym-1")?.start, "2026-10-19T05:00:00.000Z");
});
test("ics: all-day event", () => {
  const ev = parseIcs(ICS, new Date("2026-11-01T00:00:00Z"), new Date("2026-11-10T00:00:00Z"));
  const trip = ev.find((e) => e.uid === "trip-1")!;
  ok(trip.all_day); eq(localDateStr(new Date(trip.start)), "2026-11-05");
});
test("ics: floating time read as Stockholm", () => {
  const ev = parseIcs(ICS, new Date("2026-11-01T00:00:00Z"), new Date("2026-11-10T00:00:00Z"));
  eq(ev.find((e) => e.uid === "float-1")?.start, "2026-11-04T13:30:00.000Z");
});

// ── MCP routing ──
const tools: ToolDef[] = [
  { name: "echo", description: "d", inputSchema: { type: "object" }, handler: async (a) => `hi ${a.x}` },
  { name: "boom", description: "d", inputSchema: { type: "object" }, handler: async () => { throw new Error("nope"); } },
];
test("mcp: initialize echoes a supported version", async () => {
  const r: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, tools, "inst");
  eq(r.result.protocolVersion, "2025-06-18"); eq(r.result.serverInfo.name, "jarvis"); eq(r.result.instructions, "inst");
});
test("mcp: initialize with unknown version -> latest", async () => {
  const r: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }, tools);
  eq(r.result.protocolVersion, "2025-06-18");
});
test("mcp: initialized notification -> 202 no body", async () => {
  const r = await handleBody({ jsonrpc: "2.0", method: "notifications/initialized" }, tools);
  eq(r.status, 202);
});
test("mcp: tools/list", async () => {
  const r: any = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tools);
  eq(r.result.tools.map((t: any) => t.name), ["echo", "boom"]); ok(!("handler" in r.result.tools[0]));
});
test("mcp: tools/call ok", async () => {
  const r: any = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { x: "vic" } } }, tools);
  eq(r.result.content[0].text, "hi vic");
});
test("mcp: tool error is a result with isError", async () => {
  const r: any = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom", arguments: {} } }, tools);
  eq(r.result.isError, true); ok(r.result.content[0].text.includes("nope"));
});
test("mcp: unknown tool / method / bad request", async () => {
  eq(((await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "x" } }, tools)) as any).error.code, -32602);
  eq(((await handleRpc({ jsonrpc: "2.0", id: 6, method: "resources/list" }, tools)) as any).error.code, -32601);
  eq(((await handleRpc({ id: 7, method: "ping" } as any, tools)) as any).error.code, -32600);
});
test("mcp: ping and batch", async () => {
  const r = await handleBody([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }], tools);
  eq(r.status, 200); eq((r.json as any[]).length, 1);
});

// ── brief template ──
const base: BriefData = {
  today: "2026-11-02", weekly: true,
  events: [{ title: "Tandläkare", start_at: "2026-11-02T13:30:00.000Z", end_at: "2026-11-02T14:00:00.000Z", all_day: false, location: "Södermalm", calendar: "Hem", leave_by: "2026-11-02T13:00:00.000Z" }],
  pinned: [{ title: "Post on TikTok (Thriftin)", short_id: "abcd1234", lane: "THRIFTIN", due_at: "2026-11-02T16:00:00.000Z", all_day: false, proof_type: "link", proof_domains: ["tiktok.com"], kind: "task" }],
  overdue: [], dueToday: [{ title: "Betala hyran", short_id: "efgh5678", lane: "MONEY", due_at: "2026-11-01T23:00:00.000Z", all_day: true, proof_type: "none", proof_domains: [], kind: "task" }],
  birthdays: [{ title: "Mamma", date: "2026-11-09", days: 7 }],
  stats: { streak: 3, this_week: { pct: 100, done: 1, skipped: 0, missed: 0 }, last_week: { pct: 71, done: 10, skipped: 2, missed: 2 }, slipped_last_week: [{ day: "2026-10-28", title: "Post on Instagram (Thriftin)", outcome: "skipped", reason: "sjuk" }] },
  thriftin: { shiftsToday: [{ user_name: "Richie", hours: 6, status: "booked" }, { user_name: "Vic", hours: null, status: "off" }], ordersToShip: [{ order_name: "#1004", ship_by: "2026-11-02", items: 2 }] },
  buy: { buy: [{ category: "Knitwear", sold_30: 10, sold_prev_30: 5, sold_90: 20, revenue_30: 3000, avg_price_90: 300, in_stock: null, median_days_to_sell: null, score: 1, why: "10 sold in 30 days (5 the 30 before)" }], skip: [], all: [] },
  emails: { connected: true, newCount: 5, unhandled: 3, draftsWaiting: 1, flagged: [{ from: "Skatteverket", subject: "Påminnelse" }] },
  unsorted: 2,
  weekAhead: { events: [], deadlines: [] },
};
test("brief: weekly review has the parts and the Claude line", () => {
  const r = renderBrief(base);
  for (const s of ["# Weekly review · Monday 2 Nov", "3-day streak", "## Last week", "Skipped Wed: Post on Instagram (Thriftin) — \"sjuk\"", "## Must do", "leave by 14:00", "Working today: Richie 6h", "Ship #1004 (2 items) by Mon 11-02 — ship TODAY", "1. Knitwear", "⚑ Skatteverket: Påminnelse", "2 unsorted notes", "Open Claude and say: check my mail"]) {
    ok(r.markdown.includes(s), `missing: ${s}\n---\n${r.markdown}`);
  }
  ok(r.push_title.startsWith("Weekly review"));
  ok(r.push_body.includes("Post on TikTok not done"), r.push_body);
});
test("brief: daily without THRIFTIN or Hotmail still renders", () => {
  const r = renderBrief({ ...base, weekly: false, thriftin: null, buy: null, emails: { connected: false, newCount: 0, unhandled: 0, draftsWaiting: 0, flagged: [] }, weekAhead: null });
  ok(r.markdown.startsWith("# Brief · Monday 2 Nov")); ok(r.markdown.includes("Hotmail not connected")); ok(!r.markdown.includes("THRIFTIN\n"));
});

// THRIFTIN schedule tools: formatting and the confirm-first rule in the descriptions.
test("thriftin: schedule groups shifts per day with notes", () => {
  const out = formatSchedule({
    from: "2026-11-03", to: "2026-11-09",
    shifts: [{ date: "2026-11-04", user_name: "Richie", status: "scheduled", hours: 6 }, { date: "2026-11-04", user_name: "Vic", status: "off", hours: null }],
    day_notes: [{ date: "2026-11-05", note: "Leverans 10:00", split_day: true }],
    staff: [{ name: "Richie" }, { name: "Vic" }],
  });
  ok(out.includes("2026-11-04: Richie scheduled 6 h, Vic off"), out);
  ok(out.includes("2026-11-05: no shifts · note: Leverans 10:00 (split day)"), out);
  ok(out.includes("Active staff: Richie, Vic"), out);
  ok(formatSchedule({ from: "a", to: "b", shifts: [], day_notes: [], staff: [] }).includes("No shifts or notes"));
});
test("thriftin: shift change wording", () => {
  eq(formatShiftChange({ change: "created", before: null, shift: { date: "2026-11-08", user_name: "Richie", status: "scheduled", hours: 6 } }), "Added: 2026-11-08 Richie: scheduled 6 h.");
  eq(formatShiftChange({ change: "updated", before: { date: "2026-11-08", user_name: "Richie", status: "scheduled", hours: 6 }, shift: { date: "2026-11-08", user_name: "Richie", status: "off", hours: null } }), "Changed: 2026-11-08 Richie: off (was 2026-11-08 Richie: scheduled 6 h).");
  eq(formatShiftChange({ removed: 0, person: "Vic", date: "2026-11-08" }), "Vic had no shift on 2026-11-08; nothing removed.");
});
test("thriftin: write tools tell Claude to confirm first and never message staff", () => {
  for (const n of ["thriftin_set_shift", "thriftin_remove_shift", "thriftin_day_note"]) {
    const d = TOOL_DEFS.find((x) => x.name === n);
    ok(d && /confirm|wait for his yes/i.test(d.description), `${n} confirm`);
  }
  for (const n of ["thriftin_set_shift", "thriftin_remove_shift"]) ok(/never message/i.test(TOOL_DEFS.find((x) => x.name === n)!.description), `${n} no messaging`);
});
