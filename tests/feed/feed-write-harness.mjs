// THRIFTIN's jarvis-feed schedule actions against an in-memory fake
// PostgREST (GET/POST/PATCH/DELETE with eq/gte/lte filters).
// Usage: node tests/feed/feed-write-harness.mjs <path to jarvis-feed/index.ts>
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const entry = process.argv[2];
const out = new URL("../../node_modules/.tests/feed-write.mjs", import.meta.url).pathname;
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });

const env = { SUPABASE_URL: "https://thr.example", SUPABASE_SERVICE_ROLE_KEY: "svc" };
let handler;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm" }).format(new Date());
const day = (n) => { const t = new Date(`${today}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const wdKey = (d) => ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${d}T12:00:00Z`).getUTCDay()];

const tplDay = day(5);
const db = {
  jarvis_feed_config: [{ key: "token_sha256", value: createHash("sha256").update("tok-xyz").digest("hex") }],
  users: [
    { id: "u-r", name: "Richie", tracks_hours: true, hours_template: { [wdKey(tplDay)]: 6 }, active: true },
    { id: "u-v", name: "Vic", tracks_hours: false, hours_template: null, active: true },
    { id: "u-o", name: "Olle", tracks_hours: true, hours_template: null, active: false },
  ],
  shifts: [{ id: "s1", user_id: "u-r", user_name: "Richie", date: day(1), hours: 5, status: "scheduled", created_at: "x" }],
  day_notes: [],
  web_orders: [], categories: [], sales: [], inventory: [],
};
const calls = [];
let nextId = 100;

const matches = (row, params) => {
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    const cell = row[k] == null ? null : String(row[k]);
    if (op === "eq" && cell !== val) return false;
    if (op === "gte" && !(cell >= val)) return false;
    if (op === "lte" && !(cell <= val)) return false;
    if (op === "gt" && !(cell > val)) return false;
    if (op === "is" && val === "null" && cell !== null) return false;
  }
  return true;
};

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const table = u.pathname.split("/").pop();
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, table, search: u.search, body });
  const rows = db[table] ?? (db[table] = []);
  const params = [...u.searchParams.entries()];
  if (method === "GET") {
    const offset = Number(u.searchParams.get("offset") ?? 0);
    return new Response(JSON.stringify(offset ? [] : rows.filter((r) => matches(r, params))), { status: 200 });
  }
  if (method === "POST") {
    const list = Array.isArray(body) ? body : [body];
    const made = list.map((r) => ({ id: `n${nextId++}`, created_at: "now", ...r }));
    for (const r of made) {
      if (table === "shifts" && rows.some((x) => x.user_id === r.user_id && x.date === r.date)) return new Response("duplicate", { status: 409 });
      if (table === "day_notes" && rows.some((x) => x.date === r.date)) return new Response("duplicate", { status: 409 });
    }
    rows.push(...made);
    return new Response(JSON.stringify(made), { status: 201 });
  }
  if (method === "PATCH") {
    const hit = rows.filter((r) => matches(r, params));
    for (const r of hit) Object.assign(r, body);
    return new Response(JSON.stringify(hit), { status: 200 });
  }
  if (method === "DELETE") {
    const hit = rows.filter((r) => matches(r, params));
    db[table] = rows.filter((r) => !hit.includes(r));
    return new Response(JSON.stringify(hit), { status: 200 });
  }
  return new Response("?", { status: 405 });
};

await import(pathToFileURL(out).href + `?t=${Date.now()}`);

const call = async (b, token = "tok-xyz") => {
  const res = await handler(new Request("https://f/jarvis-feed", { method: "POST", headers: { "x-jarvis-token": token, "Content-Type": "application/json" }, body: JSON.stringify(b) }));
  return { status: res.status, body: await res.json() };
};

// token
assert.equal((await call({ action: "schedule" }, "nope")).status, 401);
assert.equal((await call({ action: "shift_set", person: "Richie", date: day(3) }, "")).status, 401);

// feed without an action is unchanged
const f = await call({});
assert.equal(f.status, 200);
assert.deepEqual(Object.keys(f.body).sort(), ["categories", "generated_at", "shifts", "web_orders"]);
assert.equal(f.body.shifts.length, 1);

// schedule read
const s = await call({ action: "schedule" });
assert.equal(s.status, 200);
assert.equal(s.body.from, today);
assert.equal(s.body.to, day(13));
assert.deepEqual(s.body.staff.map((x) => x.name), ["Richie", "Vic"], "inactive staff left out");
assert.equal(s.body.shifts[0].hours, 5);
assert.equal((await call({ action: "schedule", from: day(0), to: day(70) })).status, 400, "max 62 days");
assert.equal((await call({ action: "schedule", from: "2026-02-30" })).status, 400, "not a real date");

// shift_set: create with template hours, update, prefix match
calls.length = 0;
let r = await call({ action: "shift_set", person: "richie", date: tplDay });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.change, "created");
assert.deepEqual(r.body.shift, { date: tplDay, user_name: "Richie", status: "scheduled", hours: 6 });
assert.deepEqual(calls.filter((c) => c.method !== "GET").map((c) => [c.method, c.table, c.body]),
  [["POST", "shifts", { user_id: "u-r", user_name: "Richie", date: tplDay, status: "scheduled", hours: 6 }]]);
calls.length = 0;
r = await call({ action: "shift_set", person: "Rich", date: tplDay, hours: 7.5 });
assert.equal(r.body.change, "updated");
assert.equal(r.body.before.hours, 6);
assert.equal(r.body.shift.hours, 7.5);
assert.deepEqual(calls.filter((c) => c.method !== "GET").map((c) => [c.method, c.table, c.search, c.body]),
  [["PATCH", "shifts", `?id=eq.${db.shifts.find((x) => x.date === tplDay).id}`, { status: "scheduled", hours: 7.5 }]]);
assert.equal(db.shifts.filter((x) => x.user_id === "u-r" && x.date === tplDay).length, 1, "one shift per person per day");

// off clears hours; non-hourly staff get none; worked needs hours
r = await call({ action: "shift_set", person: "Richie", date: tplDay, status: "off", hours: 4 });
assert.equal(r.body.shift.hours, null);
r = await call({ action: "shift_set", person: "Vic", date: day(2), hours: 8 });
assert.equal(r.body.shift.hours, null, "Vic doesn't track hours");
assert.equal((await call({ action: "shift_set", person: "Richie", date: day(4), status: "worked" })).status, 400, "worked without hours");

// validation
const bad = async (b, part) => { const x = await call(b); assert.equal(x.status, 400, JSON.stringify(b)); assert.ok(String(x.body.error).includes(part), `${x.body.error} should mention ${part}`); };
await bad({ action: "shift_set", person: "Bob", date: day(3) }, "Staff: Richie, Vic");
await bad({ action: "shift_set", person: "Olle", date: day(3) }, "No active staff");
await bad({ action: "shift_set", person: "Richie", date: "imorgon" }, "YYYY-MM-DD");
await bad({ action: "shift_set", person: "Richie", date: day(400) }, "too far");
await bad({ action: "shift_set", person: "Richie", date: day(3), hours: 25 }, "0 to 24");
await bad({ action: "shift_set", person: "Richie", date: day(3), status: "party" }, "scheduled, worked, off");
await bad({ action: "nope" }, "unknown action");

// shift_remove
calls.length = 0;
r = await call({ action: "shift_remove", person: "Richie", date: day(1) });
assert.equal(r.body.removed, 1);
assert.deepEqual(calls.filter((c) => c.method === "DELETE").map((c) => c.search), [`?user_id=eq.u-r&date=eq.${day(1)}`]);
assert.equal((await call({ action: "shift_remove", person: "Richie", date: day(1) })).body.removed, 0);

// day notes: create, update split keeping the note, clear
r = await call({ action: "day_note_set", date: day(6), note: "  Leverans 10:00  " });
assert.equal(r.body.change, "created");
assert.deepEqual(db.day_notes.map((n) => [n.date, n.note, n.split_day, n.updated_by]), [[day(6), "Leverans 10:00", false, "Jarvis (Vic)"]]);
r = await call({ action: "day_note_set", date: day(6), split_day: true });
assert.equal(r.body.change, "updated");
assert.equal(db.day_notes[0].note, "Leverans 10:00");
assert.equal(db.day_notes[0].split_day, true);
r = await call({ action: "day_note_set", date: day(6), note: "", split_day: false });
assert.equal(r.body.change, "cleared");
assert.equal(db.day_notes.length, 0);
assert.equal((await call({ action: "day_note_set", date: day(7) })).status, 400, "nothing to set");
assert.equal((await call({ action: "day_note_set", date: day(7), note: "" })).body.change, "nothing");

// only shifts and day_notes were ever written
const tables = new Set(calls.concat().filter((c) => c.method !== "GET").map((c) => c.table));
for (const t of tables) assert.ok(["shifts", "day_notes"].includes(t), `wrote ${t}`);

console.log("feed write harness: all checks passed");
