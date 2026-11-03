import { suite, eq, ok } from "./t.ts";
import { inLocalWindow, localDateStr, localTimeStr, localToUtc, zonedToUtc, addDays, isoWeekday, nowForPrompt } from "../supabase/functions/_shared/time.ts";
import { nextOccurrence, rollForward } from "../supabase/functions/_shared/recur.ts";
import { checkProof, checkSkip } from "../supabase/functions/_shared/proof.ts";
import { buyList, type CategoryStat } from "../supabase/functions/_shared/buylist.ts";
import { streak, weekScore, weekStart } from "../supabase/functions/_shared/score.ts";
import { normalizeItem, parseWhen } from "../supabase/functions/_shared/items-input.ts";
import { flagEmail, vipMatch, cleanBody } from "../supabase/functions/_shared/email-rules.ts";
import { signState, verifyState, timingSafeEqual } from "../supabase/functions/_shared/crypto.ts";
import { toRows } from "../supabase/functions/_shared/capture-core.ts";

const { test, run } = suite();
export { run };

// ── time / DST ──
test("winter: 09:30 Stockholm = 08:30 UTC", () => eq(zonedToUtc(2026, 11, 2, 9, 30).toISOString(), "2026-11-02T08:30:00.000Z"));
test("summer: 09:30 Stockholm = 07:30 UTC", () => eq(zonedToUtc(2026, 7, 1, 9, 30).toISOString(), "2026-07-01T07:30:00.000Z"));
test("spring-forward gap 02:30 lands at 03:30 local", () => eq(localTimeStr(zonedToUtc(2027, 3, 28, 2, 30)), "03:30"));
test("autumn ambiguous 02:30 maps back to 02:30 local", () => eq(localTimeStr(zonedToUtc(2026, 10, 25, 2, 30)), "02:30"));
test("local date across midnight UTC", () => eq(localDateStr(new Date("2026-11-02T23:30:00Z")), "2026-11-03"));
test("brief window 09:30 local in winter", () => {
  ok(inLocalWindow(new Date("2026-11-02T08:30:00Z"), "09:30", 150), "08:30Z should be in window");
  ok(!inLocalWindow(new Date("2026-11-02T08:29:00Z"), "09:30", 150), "08:29Z should be before window");
  ok(!inLocalWindow(new Date("2026-11-02T11:00:00Z"), "09:30", 150), "12:00 local should be after window");
});
test("brief window 09:30 local in summer", () => ok(inLocalWindow(new Date("2026-06-15T07:31:00Z"), "09:30", 150)));
test("email slot 15:00 local winter = 14:00Z", () => ok(inLocalWindow(new Date("2026-12-01T14:05:00Z"), "15:00", 30)));
test("addDays over month end", () => eq(addDays("2026-01-31", 1), "2026-02-01"));
test("isoWeekday Monday 2026-11-02", () => eq(isoWeekday("2026-11-02"), 1));
test("nowForPrompt has weekday in both languages", () => ok(/Monday 2026-11-02 .*måndag/.test(nowForPrompt(new Date("2026-11-02T13:00:00Z")))));

// ── recurrence ──
test("daily 17:00 keeps 17:00 across DST end", () => {
  const n = nextOccurrence(zonedToUtc(2026, 10, 24, 17, 0), "daily");
  eq(localDateStr(n), "2026-10-25"); eq(localTimeStr(n), "17:00");
});
test("daily 17:00 keeps 17:00 across DST start", () => eq(localTimeStr(nextOccurrence(zonedToUtc(2027, 3, 27, 17, 0), "daily")), "17:00"));
test("weekdays: Friday -> Monday", () => eq(localDateStr(nextOccurrence(zonedToUtc(2026, 11, 6, 9, 0), "weekdays")), "2026-11-09"));
test("weekly +7", () => eq(localDateStr(nextOccurrence(zonedToUtc(2026, 11, 2, 9, 0), "weekly")), "2026-11-09"));
test("monthly Jan 31 -> Feb 28", () => eq(localDateStr(nextOccurrence(zonedToUtc(2027, 1, 31, 9, 0), "monthly")), "2027-02-28"));
test("monthly Dec -> Jan next year", () => eq(localDateStr(nextOccurrence(zonedToUtc(2026, 12, 15, 9, 0), "monthly")), "2027-01-15"));
test("yearly Feb 29 -> Feb 28", () => eq(localDateStr(nextOccurrence(zonedToUtc(2028, 2, 29, 0, 0), "yearly")), "2029-02-28"));
test("rollForward keeps same-day reminder wall time", () => {
  const r = rollForward({ due_at: zonedToUtc(2026, 10, 24, 17, 0).toISOString(), remind_at: zonedToUtc(2026, 10, 24, 16, 0).toISOString(), recur: "daily" });
  eq(localTimeStr(new Date(r.remind_at!)), "16:00"); eq(localDateStr(new Date(r.due_at!)), "2026-10-25");
});
test("rollForward keeps day-before reminder gap", () => {
  const r = rollForward({ due_at: zonedToUtc(2026, 11, 10, 9, 0).toISOString(), remind_at: zonedToUtc(2026, 11, 9, 9, 0).toISOString(), recur: "weekly" });
  eq(localDateStr(new Date(r.remind_at!)), "2026-11-16");
});

// ── proof ──
const tiktok = { proof_type: "link" as const, proof_domains: ["tiktok.com"] };
test("proof: link required", () => ok(!checkProof(tiktok, {}).ok));
test("proof: tiktok link ok (vm subdomain)", () => ok(checkProof(tiktok, { proof_url: "https://vm.tiktok.com/ZMabc/" }).ok));
test("proof: wrong site refused", () => ok(!checkProof(tiktok, { proof_url: "https://instagram.com/p/x" }).ok));
test("proof: look-alike domain refused", () => ok(!checkProof(tiktok, { proof_url: "https://tiktok.com.evil.io/x" }).ok));
test("proof: not a url refused", () => ok(!checkProof(tiktok, { proof_url: "posted it" }).ok));
test("proof: photo needs path", () => {
  ok(!checkProof({ proof_type: "photo" }, {}).ok);
  ok(checkProof({ proof_type: "photo" }, { proof_path: "abc/1.jpg" }).ok);
});
test("proof: none closes freely", () => ok(checkProof({ proof_type: "none" }, {}).ok));
test("skip needs a reason", () => { ok(!checkSkip("").ok); ok(checkSkip("sick today").ok); });

// ── score / streak ──
const L = (d: string, o: "done" | "skipped" | "missed", p = "link") => ({ occurred_on: d, outcome: o, proof_type: p });
test("week score counts proof items only", () => {
  const rows = [L("2026-11-02", "done"), L("2026-11-02", "missed"), L("2026-11-03", "done"), L("2026-11-03", "done", "none")];
  eq(weekScore(rows, "2026-11-02", "2026-11-08").pct, 67);
});
test("streak counts back from yesterday", () => {
  const rows = [L("2026-11-01", "done"), L("2026-11-01", "done"), L("2026-11-02", "done"), L("2026-10-31", "missed")];
  eq(streak(rows, "2026-11-03", 2), 2);
});
test("streak includes today once all done", () => eq(streak([L("2026-11-02", "done"), L("2026-11-03", "done")], "2026-11-03", 0), 2));
test("streak 0 after a skip yesterday", () => eq(streak([L("2026-11-02", "skipped")], "2026-11-03", 1), 0));
test("weekStart is Monday", () => eq(weekStart("2026-11-08"), "2026-11-02"));

// ── buy list ──
const cat = (category: string, s30: number, prev: number, inStock: number | null, days: number | null, price = 200): CategoryStat =>
  ({ category, sold_30: s30, sold_prev_30: prev, sold_90: s30 + prev, revenue_30: s30 * price, avg_price_90: price, in_stock: inStock, median_days_to_sell: days });
test("buy list ranks fast, rising, low-stock first", () => {
  const b = buyList([cat("Knitwear", 10, 5, 2, 6), cat("Belts", 2, 3, 15, 40), cat("Shearling", 6, 1, 1, 8, 900), cat("Caps", 0, 0, 9, null)]);
  // Knitwear: most sold and rising; Shearling: fewer but pricey and fast.
  eq(b.buy.map((r) => r.category), ["Knitwear", "Shearling", "Belts"]);
  eq(b.skip[0].category, "Caps");
});
test("buy list works without stock data", () => {
  const b = buyList([cat("A", 5, 5, null, null), cat("B", 9, 3, null, null)]);
  eq(b.buy[0].category, "B");
});

// ── structured items (Claude app -> add) ──
const lanes = [{ id: "l-buy", slug: "buy", name: "BUY IN" }, { id: "l-thr", slug: "thriftin", name: "THRIFTIN" }, { id: "l-life", slug: "life", name: "LIFE" }, { id: "l-ppl", slug: "people", name: "PEOPLE" }];
test("add: date-only = all day at Stockholm midnight", () => {
  const r = normalizeItem({ title: "Betala hyran", lane: "life", due_at: "2026-11-25" }, lanes);
  ok(r.ok); if (r.ok) { eq(r.row.all_day, true); eq(r.row.due_at, "2026-11-24T23:00:00.000Z"); }
});
test("add: ISO with offset kept", () => {
  const r = normalizeItem({ title: "Tandläkare", kind: "event", due_at: "2026-11-06T14:00:00+01:00", location: "Södermalm" }, lanes);
  ok(r.ok); if (r.ok) eq(r.row.due_at, "2026-11-06T13:00:00.000Z");
});
test("add: local time without offset = Stockholm", () => {
  const r = normalizeItem({ title: "x", due_at: "2026-07-01T09:00" }, lanes);
  ok(r.ok); if (r.ok) eq(r.row.due_at, "2026-07-01T07:00:00.000Z");
});
test("add: buy kind forced into buy lane", () => {
  const r = normalizeItem({ title: "Ullrockar", kind: "buy", lane: "life" }, lanes);
  ok(r.ok); if (r.ok) eq(r.row.lane_id, "l-buy");
});
test("add: reminder without remind_at reminds at due time", () => {
  const r = normalizeItem({ title: "Ring mamma", kind: "reminder", due_at: "2026-11-03T18:00:00+01:00" }, lanes);
  ok(r.ok); if (r.ok) eq(r.row.remind_at, "2026-11-03T17:00:00.000Z");
});
test("add: proof-to-close is off; remind_again_minutes is kept with a reminder", () => {
  const r = normalizeItem({ title: "Post on TikTok", lane: "thriftin", proof_type: "link", remind_at: "2026-11-03T20:30:00+01:00", remind_again_minutes: 60 }, lanes);
  ok(r.ok); if (r.ok) { eq(r.row.proof_type, "none"); eq(r.row.proof_domains, []); eq(r.row.remind_again_minutes, 60); }
  const n = normalizeItem({ title: "x", remind_again_minutes: 60 }, lanes);
  ok(n.ok); if (n.ok) eq(n.row.remind_again_minutes, null, "no reminder, no second push");
});
test("add: birthday is yearly in people", () => {
  const r = normalizeItem({ title: "Mammas födelsedag", kind: "birthday", due_at: "2027-03-12" }, lanes);
  ok(r.ok); if (r.ok) { eq(r.row.recur, "yearly"); eq(r.row.lane_id, "l-ppl"); }
});
test("add: unknown lane is an error", () => ok(!normalizeItem({ title: "x", lane: "work" }, lanes).ok));
test("add: bad date is an error", () => ok(!normalizeItem({ title: "x", due_at: "next friday" }, lanes).ok));
test("add: repeating needs due_at", () => ok(!normalizeItem({ title: "x", recurrence: "daily" }, lanes).ok));
test("parseWhen accepts DB format with +00:00", () => { const w = parseWhen("2026-11-02T16:00:00.123+00:00"); ok(w && w !== "bad"); });

// ── email rules ──
test("flag: Swedish invoice word inside a longer word", () => ok(flagEmail({ from_address: "x@y.se", subject: "Din fakturan från Telia", body: "" }).includes("faktura")));
test("flag: 'order' not on 'border'", () => eq(flagEmail({ from_address: "a@b.c", subject: "Border collie news", body: "" }), []));
test("flag: Skatteverket + påminnelse", () => {
  const r = flagEmail({ from_address: "noreply@skatteverket.se", subject: "Påminnelse: deklaration", body: "" });
  ok(r.includes("påminnelse") && r.includes("skatteverket"));
});
test("VIP by domain and by address", () => {
  eq(vipMatch("richie@thriftin.se", ["@thriftin.se"]), "@thriftin.se");
  eq(vipMatch("Mamma@Hotmail.com", ["mamma@hotmail.com"]), "mamma@hotmail.com");
  eq(vipMatch("x@nothriftin.se", ["@thriftin.se"]), null);
});
test("cleanBody trims and caps", () => eq(cleanBody("a\r\n\r\n\r\n\r\nb   \n", 10), "a\n\nb"));

// ── crypto ──
test("state round-trips and expires", async () => {
  const s = await signState("k", 1000, 60_000);
  ok(await verifyState("k", s, 2000), "valid");
  ok(!(await verifyState("k", s, 70_000)), "expired");
  ok(!(await verifyState("other", s, 2000)), "wrong key");
  ok(!(await verifyState("k", s.replace(/.$/, s.endsWith("A") ? "B" : "A"), 2000)), "tampered");
});
test("timingSafeEqual", () => { ok(timingSafeEqual("abc", "abc")); ok(!timingSafeEqual("abc", "abd")); ok(!timingSafeEqual("abc", "abcd")); });

// ── optional API path: Claude's parsed output -> rows ──
test("capture toRows fixes lane and reminder", () => {
  const rows = toRows({
    reply: "Sparat",
    items: [{ kind: "buy", title: "Ullrockar", notes: null, lane: "life", due_date: null, due_time: null, remind_date: null, remind_time: null, recur: null, proof: "none", proof_domains: [], location: null, travel_minutes: null },
            { kind: "reminder", title: "Ring Johan", notes: null, lane: "people", due_date: "2026-11-04", due_time: "10:00", remind_date: null, remind_time: null, recur: null, proof: "none", proof_domains: [], location: null, travel_minutes: null }],
  }, lanes.map((l) => ({ ...l, description: "" })), new Date("2026-11-02T12:00:00Z"));
  eq(rows[0].lane_id, "l-buy");
  eq(rows[1].remind_at, "2026-11-04T09:00:00.000Z");
});
