import { suite, eq, ok } from "./t.ts";
import { answerText, givenKey, keyOk, readText, MAX_TEXT } from "../supabase/functions/_shared/shortcut-core.ts";

const { test, run } = suite();
export { run };

const KEY = "a".repeat(64);
const req = (body: BodyInit | null, headers: Record<string, string> = {}, url = "https://x/functions/v1/shortcut") =>
  new Request(url, { method: "POST", headers, body });

test("shortcut: key from header, bearer or ?key=", () => {
  eq(givenKey(req(null, { "x-jarvis-key": ` ${KEY} ` })), KEY);
  eq(givenKey(req(null, { authorization: `Bearer ${KEY}` })), KEY);
  eq(givenKey(req(null, {}, `https://x/functions/v1/shortcut?key=${KEY}`)), KEY);
  eq(givenKey(req(null, {})), "");
});

test("shortcut: key check is strict", () => {
  ok(keyOk(KEY, KEY));
  ok(!keyOk("", KEY), "empty");
  ok(!keyOk(KEY.slice(1), KEY), "one char short");
  ok(!keyOk("b".repeat(64), KEY), "wrong");
  ok(!keyOk("", ""), "no stored key means nobody gets in");
  ok(!keyOk("short", "short"), "a too-short stored key never matches");
});

test("shortcut: text from JSON, form or plain body", async () => {
  eq(await readText(req(JSON.stringify({ text: "  Lägg in tandläkare\n på torsdag  " }), { "content-type": "application/json" })), "Lägg in tandläkare på torsdag");
  const f = new FormData(); f.set("text", "Kolla mejlen");
  eq(await readText(req(f)), "Kolla mejlen");
  eq(await readText(req("Vad har jag idag?", { "content-type": "text/plain" })), "Vad har jag idag?");
  eq(await readText(req("{bad json", { "content-type": "application/json" })), "");
  eq((await readText(req("x".repeat(MAX_TEXT + 50), { "content-type": "text/plain" }))).length, MAX_TEXT);
});

test("shortcut: answer lists what was done", () => {
  eq(answerText("Klart.", [{ summary: "Added to Arbete: Tandläkare tor 14:00" }, { summary: "Web search failed", ok: false }, {}]),
    "Klart.\n\n✓ Added to Arbete: Tandläkare tor 14:00\n✗ Web search failed");
  eq(answerText("", []), "Done.");
});
