// Run THRIFTIN's jarvis-feed function in Node against a fake PostgREST.
// Usage: node tests/feed/feed-harness.mjs <path to jarvis-feed/index.ts>
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const entry = process.argv[2];
const out = new URL("../../node_modules/.tests/feed.mjs", import.meta.url).pathname;
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });

const env = { SUPABASE_URL: "https://thr.example", SUPABASE_SERVICE_ROLE_KEY: "svc", JARVIS_FEED_TOKEN: "tok-123" };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm" }).format(new Date());
const day = (n) => { const t = new Date(`${today}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const seen = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  seen.push(u.pathname + u.search);
  const table = u.pathname.split("/").pop();
  const status = u.searchParams.get("status");
  const data = {
    shifts: [{ date: today, user_name: "Richie", hours: "6", status: "booked" }],
    web_orders: [
      { order_name: "#1001", ordered_at: "x", ship_by: day(1), lines: [{ quantity: 2 }, { quantity: 1 }], total: "450", currency: "SEK", shipping_method: "PostNord", fulfillment_status: null, financial_status: "paid" },
      { order_name: "#1002", ordered_at: "x", ship_by: day(0), lines: [], total: "100", currency: "SEK", fulfillment_status: null, financial_status: "refunded" },
    ],
    categories: [{ id: "c1", name: "Knitwear", active: true }, { id: "c2", name: "Belts", active: true }],
    sales: [
      ...Array.from({ length: 9 }, () => ({ category_id: "c1", category_name: "Knitwear", sold_at: day(-3), price: 300 })),
      ...Array.from({ length: 4 }, () => ({ category_id: "c1", category_name: "Knitwear", sold_at: day(-40), price: 250 })),
      { category_id: "c2", category_name: "Belts", sold_at: day(-70), price: 100 },
      { category_id: null, category_name: null, sold_at: day(-1), price: 50 },
    ],
    inventory: status === "eq.in_stock" ? [{ category_id: "c2" }] : [],
  }[table] ?? [];
  // pagination: second page empty
  const offset = Number(u.searchParams.get("offset") ?? 0);
  return new Response(JSON.stringify(offset ? [] : data), { status: 200 });
};

await import(pathToFileURL(out).href);
const bad = await handler(new Request("https://f/jarvis-feed", { method: "POST", headers: { "x-jarvis-token": "nope" } }));
assert.equal(bad.status, 401, "wrong token refused");
const res = await handler(new Request("https://f/jarvis-feed", { method: "POST", headers: { "x-jarvis-token": "tok-123" } }));
assert.equal(res.status, 200);
const j = await res.json();
assert.equal(j.shifts[0].hours, 6);
assert.deepEqual(j.web_orders.map((o) => [o.order_name, o.items]), [["#1001", 3]], "refunded order dropped, items counted");
const knit = j.categories.find((c) => c.category === "Knitwear");
assert.deepEqual([knit.sold_30, knit.sold_prev_30, knit.sold_90, knit.revenue_30, knit.avg_price_90], [9, 4, 13, 2700, 285]);
assert.equal(knit.in_stock, null, "stock not tracked with < 20 tagged items");
assert.ok(j.categories.find((c) => c.category === "Other"), "uncategorised sale grouped as Other");
assert.ok(seen.some((s) => s.includes("refunded_at=is.null")), "refunds excluded in query");
assert.ok(!JSON.stringify(j).match(/email|address|phone|customer/i), "no customer fields");
console.log("feed harness: all checks passed");
