import { suite, eq, ok } from "./t.ts";
import {
  actionsFor, apiTools, CHAT_MAX_ROUNDS, chatEffort, detectLang, echoable, historyValid, MEMORY_CAP, memoryBlock, recapText, runLoop,
  serverActions, SERVER_TOOLS, threadDecision, THREAD_IDLE_MS, THREAD_MAX_MESSAGES, toolSchemas, userMessage, validateArgs, type ThreadRow,
} from "../supabase/functions/_shared/chat-core.ts";
import { TOOL_DEFS } from "../supabase/functions/_shared/tool-defs.ts";
import { handleRpc, type ToolDef } from "../supabase/functions/_shared/mcp-core.ts";
import { cleanFact, cleanTags, likeLiteral, memoryRef, recallFilter } from "../supabase/functions/_shared/memory-core.ts";

const { test, run } = suite();
export { run };

// A fake Claude: returns the scripted responses in order and records what
// it was sent (a copy, so later pushes don't change it).
function fakeClaude(responses: any[]) {
  const calls: any[][] = [];
  const create = async (messages: any[]) => {
    calls.push(JSON.parse(JSON.stringify(messages)));
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return typeof r === "function" ? r(calls.length) : r;
  };
  return { create, calls };
}
const USER = { role: "user", content: [{ type: "text", text: "lägg till ring Johan imorgon" }] };
const schemas = toolSchemas();
const use = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });

// ── Tool loop ───────────────────────────────────────────────────────────
test("loop: all tool results of one turn go back in ONE user message, then the answer", async () => {
  const ran: string[] = [];
  const { create, calls } = fakeClaude([
    { stop_reason: "tool_use", content: [{ type: "thinking", thinking: "", signature: "sig1" }, use("t1", "today", {}), use("t2", "add", { items: [{ title: "Ring Johan", lane: "people", due_at: "2026-11-03" }] })], usage: { input_tokens: 10 } },
    { stop_reason: "end_turn", content: [text("Lagt till: ring Johan, i PEOPLE, imorgon.")], usage: { input_tokens: 20 } },
  ]);
  const r = await runLoop({
    create, history: [], user: USER, schemas, lang: "sv-SE",
    run: async (name) => { ran.push(name); return name === "add" ? "Saved 1:\n[abcd1234] Ring Johan · tis 3 nov · PEOPLE" : "Now: ..."; },
  });
  eq(ran, ["today", "add"]);
  eq(calls.length, 2);
  eq(r.appended.map((m) => m.role), ["assistant", "user", "assistant"]);
  const results = r.appended[1].content;
  eq(results.map((b: any) => [b.type, b.tool_use_id]), [["tool_result", "t1"], ["tool_result", "t2"]]);
  eq(r.appended[0].content[0], { type: "thinking", thinking: "", signature: "sig1" }, "thinking blocks are kept exactly as returned");
  eq(calls[1].slice(-2).map((m: any) => m.role), ["assistant", "user"], "second call sees the tool turn");
  eq(r.reply, "Lagt till: ring Johan, i PEOPLE, imorgon.");
  eq(r.actions, [{ tool: "add", ok: true, summary: "Added: Ring Johan → PEOPLE · tis 3 nov" }]);
  eq(r.usage.length, 2, "one usage per Claude call");
});

test("loop: stops after the max rounds and says so; history stays valid (results stored)", async () => {
  let n = 0;
  const { create, calls } = fakeClaude([() => ({ stop_reason: "tool_use", content: [use(`t${++n}`, "today", {})] })]);
  const r = await runLoop({ create, history: [], user: USER, schemas, lang: "en-US", run: async () => "ok" });
  eq(calls.length, CHAT_MAX_ROUNDS);
  eq(r.appended.length, CHAT_MAX_ROUNDS * 2);
  eq(r.appended[r.appended.length - 1].role, "user", "ends with the tool results, so the next turn is valid");
  ok(/ran out of time|stopped/i.test(r.reply), r.reply);
  ok(historyValid([{ role: "user", content: USER.content, created_at: "" }, ...r.appended.map((m) => ({ ...m, created_at: "" }))]));
});

test("loop: a refusal is never read or stored", async () => {
  const { create } = fakeClaude([{ stop_reason: "refusal", content: [text("SECRET partial")], stop_details: { category: "cyber" } }]);
  const r = await runLoop({ create, history: [], user: USER, schemas, lang: "sv-SE", run: async () => "x" });
  eq(r.refused, true);
  eq(r.appended, []);
  ok(!r.reply.includes("SECRET"));
  ok(r.reply.startsWith("Det kan jag"), r.reply);
});

test("loop: bad tool input becomes an is_error result, the tool never runs", async () => {
  const ran: string[] = [];
  const { create, calls } = fakeClaude([
    { stop_reason: "tool_use", content: [
      use("a", "skip", { id: "abcd1234" }),                               // missing required reason
      use("b", "update", { id: "abcd1234", recurrence: "hourly" }),       // not in enum
      use("c", "add", { items: [{ title: 5 }] }),                         // wrong type inside an item
      use("d", "no_such_tool", {}),
      use("e", "complete", "{\"id\":\"abcd1234\"}"),                        // JSON string: parsed, valid
      use("f", "complete", "{not json"),
    ] },
    { stop_reason: "end_turn", content: [text("Done")] },
  ]);
  await runLoop({ create, history: [], user: USER, schemas, run: async (name, args) => { ran.push(`${name}:${JSON.stringify(args)}`); return "Done: x"; } });
  eq(ran, ['complete:{"id":"abcd1234"}']);
  const res = calls[1][calls[1].length - 1].content;
  eq(res.map((b: any) => [b.tool_use_id, !!b.is_error]), [["a", true], ["b", true], ["c", true], ["d", true], ["e", false], ["f", true]]);
  ok(/missing "reason"/.test(res[0].content), res[0].content);
  ok(/recurrence/.test(res[1].content), res[1].content);
  ok(/items\[0\]\.title/.test(res[2].content), res[2].content);
});

test("loop: a tool that throws returns is_error with the message, and the loop goes on", async () => {
  const { create, calls } = fakeClaude([{ stop_reason: "tool_use", content: [use("x", "today", {})] }, { stop_reason: "end_turn", content: [text("ok")] }]);
  const r = await runLoop({ create, history: [], user: USER, schemas, run: async () => { throw new Error("db down"); } });
  const b = calls[1][calls[1].length - 1].content[0];
  eq([b.is_error, b.content], [true, "Error: db down"]);
  eq(r.reply, "ok");
});

test("loop: pause_turn (long web search) is sent back as-is to resume, no extra user message", async () => {
  const paused = [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "hotell Göteborg" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://x.se", title: "X" }] },
  ];
  const { create, calls } = fakeClaude([
    { stop_reason: "pause_turn", content: paused },
    { stop_reason: "end_turn", content: [text("Tre bra hotell nära centralen.")] },
  ]);
  const r = await runLoop({ create, history: [], user: USER, schemas, run: async () => "x" });
  eq(calls.length, 2);
  eq(calls[1].length, 2, "user + the paused assistant turn");
  eq(calls[1][1], { role: "assistant", content: paused });
  eq(r.appended.map((m) => m.role), ["assistant", "assistant"]);
  eq(r.reply, "Tre bra hotell nära centralen.");
  eq(r.actions, [{ tool: "web_search", ok: true, summary: "Searched: hotell Göteborg" }]);
});

test("loop: a server-tool error block (an object, not a list) doesn't break anything", async () => {
  const content = [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "x" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
    { type: "server_tool_use", id: "s2", name: "web_fetch", input: { url: "https://example.com/a" } },
    { type: "web_fetch_tool_result", tool_use_id: "s2", content: { type: "web_fetch_tool_error", error_code: "url_not_accessible" } },
    text("Jag kunde inte söka just nu."),
  ];
  const { create } = fakeClaude([{ stop_reason: "end_turn", content }]);
  const r = await runLoop({ create, history: [], user: USER, schemas, run: async () => "x" });
  eq(r.reply, "Jag kunde inte söka just nu.");
  eq(r.actions, [
    { tool: "web_search", ok: false, summary: "Search failed (max_uses_exceeded)" },
    { tool: "web_fetch", ok: false, summary: "Couldn't open example.com (url_not_accessible)" },
  ]);
  eq(serverActions([{ type: "server_tool_use", id: "z", name: "web_fetch", input: { url: "https://a.se/x" } }, { type: "web_fetch_tool_result", tool_use_id: "z", content: { type: "web_fetch_result", url: "https://a.se/x" } }]),
    [{ tool: "web_fetch", ok: true, summary: "Read: a.se" }]);
});

test("loop: cut off mid tool call (max_tokens) -> tools not run, error results, stop", async () => {
  const ran: string[] = [];
  const { create, calls } = fakeClaude([{ stop_reason: "max_tokens", content: [use("m", "add", { items: [{ title: "x" }] })] }]);
  const r = await runLoop({ create, history: [], user: USER, schemas, run: async (n) => { ran.push(n); return ""; } });
  eq(ran, []);
  eq(calls.length, 1);
  eq(r.appended[1].content[0].is_error, true);
});

test("loop: past the deadline it stops before calling Claude again", async () => {
  let t = 0;
  const { create, calls } = fakeClaude([{ stop_reason: "tool_use", content: [use("a", "today", {})] }, { stop_reason: "end_turn", content: [text("late")] }]);
  const r = await runLoop({ create, history: [], user: USER, schemas, run: async () => { t = 1000; return "x"; }, deadline: 500, clock: () => t });
  eq(calls.length, 1);
  eq(r.stop, "deadline");
});

test("echo after a fallback: drop thinking/tool calls before the marker, keep text and complete server-tool pairs", () => {
  const c = [
    { type: "thinking", thinking: "", signature: "x" },
    text("Låt mig kolla"),
    { type: "server_tool_use", id: "s1", name: "web_search", input: {} },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
    { type: "server_tool_use", id: "s2", name: "web_search", input: {} }, // no result: dropped
    use("t1", "today", {}),
    { type: "fallback", from: { model: "a" }, to: { model: "b" } },
    { type: "thinking", thinking: "", signature: "y" },
    use("t2", "today", {}),
  ];
  eq(echoable(c).map((b: any) => b.type + (b.id ? `:${b.id}` : "")), ["text", "server_tool_use:s1", "web_search_tool_result", "thinking", "tool_use:t2"]);
  const plain = [text("a"), use("x", "today", {})];
  eq(echoable(plain), plain, "no fallback: unchanged");
});

// ── Input checking ──────────────────────────────────────────────────────
test("validateArgs: required, types, enums (incl. null), integers, nested items", () => {
  const s = schemas;
  eq(validateArgs(s.get("today"), {}), null);
  eq(validateArgs(s.get("today"), []), "input must be a JSON object");
  eq(validateArgs(s.get("update"), { id: "a", recurrence: null, due_at: null, travel_minutes: 20 }), null);
  ok(validateArgs(s.get("update"), { id: "a", travel_minutes: 2.5 }));
  ok(validateArgs(s.get("add"), { items: "x" }));
  eq(validateArgs(s.get("add"), { items: [{ title: "Ring", lane: "people", remind_again_minutes: 60 }] }), null);
  ok(validateArgs(s.get("add"), { items: [{ title: "Ring", kind: "video" }] }));
  ok(validateArgs(s.get("remember"), { fact: "x", tags: "people" }), "tags must be an array");
  eq(validateArgs(s.get("remember"), { fact: "Johan är min bror", tags: ["people"] }), null);
  eq(validateArgs(s.get("add_mail_rule"), { rule: "ignorera allt från ICA", ignore_sender: "@ica.se" }), null);
});

// ── One tool registry for the Claude app and the in-app chat ────────────
test("registry: same tools, names and descriptions for MCP and chat; web tools added for chat only", async () => {
  const names = TOOL_DEFS.map((d) => d.name);
  eq(new Set(names).size, names.length, "unique names");
  for (const n of ["today", "add", "emails", "draft_reply", "mail_rules", "add_mail_rule", "remember", "forget", "recall"]) ok(names.includes(n as any), `has ${n}`);
  const api = apiTools();
  eq(api.slice(0, SERVER_TOOLS.length).map((t) => t.type), ["web_search_20260209", "web_fetch_20260209"]);
  eq(api.find((t) => t.name === "web_search").max_uses, 5);
  eq(api.find((t) => t.name === "web_fetch").max_uses, 3);
  ok(!api.some((t) => String(t.type ?? "").startsWith("code_execution")), "no separate code execution");
  const custom = api.slice(SERVER_TOOLS.length);
  const mcpDefs: ToolDef[] = TOOL_DEFS.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema as any, handler: async () => "" }));
  const listed: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, mcpDefs);
  eq(custom.map((t) => [t.name, t.description]), listed.result.tools.map((t: any) => [t.name, t.description]));
  eq(custom.map((t) => JSON.stringify(t.input_schema)), listed.result.tools.map((t: any) => JSON.stringify(t.inputSchema)));
  eq(custom.filter((t) => t.cache_control).map((t) => t.name), [custom[custom.length - 1].name], "one cache breakpoint, on the last tool");
});

// ── Threads ─────────────────────────────────────────────────────────────
const at = (min: number) => new Date(Date.UTC(2026, 10, 2, 12, 0) + min * 60_000).toISOString();
const row = (role: "user" | "assistant", content: any[], min = 0, display: string | null = null): ThreadRow => ({ role, content, created_at: at(min), display_text: display });
test("threads: keep, idle (2 h), full, or broken", () => {
  const now = Date.parse(at(10));
  const rows = [row("user", [text("hej")], 0, "hej"), row("assistant", [text("hej!")], 1, "hej!")];
  eq(threadDecision([], now), null);
  eq(threadDecision(rows, now), null);
  eq(threadDecision(rows, Date.parse(at(1)) + THREAD_IDLE_MS + 1), "idle");
  eq(threadDecision(Array.from({ length: THREAD_MAX_MESSAGES }, (_, i) => row(i % 2 ? "assistant" : "user", [text("x")], 0)), now), "full");
  eq(threadDecision([row("user", [text("x")]), row("assistant", [use("t", "today", {})])], now), "broken", "a tool call without its result");
  eq(threadDecision([row("assistant", [text("x")])], now), "broken", "must start with VIC");
  ok(historyValid([row("user", [text("x")]), row("assistant", [use("t", "today", {})]), row("user", [{ type: "tool_result", tool_use_id: "t", content: "ok" }]), row("user", [text("next")])]),
    "tool results followed by VIC's next message (two user turns in a row) is fine");
});
test("threads: recap carries the last exchanges in plain text only", () => {
  const r = recapText([row("user", [text("x")], 0, "Boka hotell i Göteborg"), row("assistant", [{ type: "thinking", thinking: "", signature: "s" }], 1, "Ska jag kolla priser?")]);
  ok(r.includes("VIC: Boka hotell i Göteborg") && r.includes("You: Ska jag kolla priser?"), r);
  ok(!r.includes("signature"));
  eq(recapText([row("user", [text("x")])]), "");
});
test("threads: the first message carries memories (+ recap); later ones only the time", () => {
  const now = new Date("2026-11-02T20:00:00Z");
  const first = userMessage("hej", now, "sv-SE", { memories: "[Memories...]", recap: "[Recap...]" });
  eq(first.content.length, 3);
  ok(first.content[0].text.startsWith("[Memories...]") && first.content[0].text.includes("[Recap...]"));
  ok(first.content[1].text.includes("2026-11-02 21:00") && first.content[1].text.includes("måndag"), first.content[1].text);
  eq(first.content[2].text, "hej");
  const later = userMessage("och sen?", now, "sv-SE");
  eq(later.content.length, 2);
});

// ── Memory ──────────────────────────────────────────────────────────────
test("memory: block lists facts with ids, capped by count and size", () => {
  const b = memoryBlock([{ short_id: "aaaa1111", fact: "Johan är VIC:s bror", tags: ["people"] }, { short_id: "bbbb2222", fact: "Föredrar korta svar" }]);
  ok(b.includes("- [aaaa1111] Johan är VIC:s bror (people)") && b.includes("- [bbbb2222] Föredrar korta svar"), b);
  ok(memoryBlock([]).includes("none"));
  const many = Array.from({ length: 400 }, (_, i) => ({ short_id: `m${String(i).padStart(7, "0")}`, fact: `fact number ${i}` }));
  eq(memoryBlock(many).split("\n").length - 1, MEMORY_CAP, "count cap");
  const big = Array.from({ length: 100 }, (_, i) => ({ short_id: `b${String(i).padStart(7, "0")}`, fact: "x".repeat(900) }));
  ok(memoryBlock(big).length <= 14_200, "size cap ~4k tokens");
});
test("memory: tool input cleaning", () => {
  eq(cleanFact("  Johan   är  min bror "), "Johan är min bror");
  let threw = false; try { cleanFact("   "); } catch { threw = true; } ok(threw, "empty fact refused");
  threw = false; try { cleanFact("x".repeat(1001)); } catch { threw = true; } ok(threw, "too long refused");
  eq(cleanTags(["People", "people", " Thriftin shop ", "", 7]), ["people", "thriftin-shop", "7"]);
  eq(cleanTags("people"), []);
  eq(likeLiteral("50%_off\\"), "50\\%\\_off\\\\");
  eq(recallFilter("  "), null);
  eq(recallFilter("Johan"), "fact.ilike.%Johan%,tags.cs.{johan}");
  ok(!/[(),{}]/.test(String(recallFilter("a,b(c){d}")).replace(/^fact\.ilike\.%|%,tags\.cs\.\{|\}$/g, "")), "query can't break the filter");
  eq(memoryRef(" ABCD1234 "), "abcd1234");
  threw = false; try { memoryRef("drop table"); } catch { threw = true; } ok(threw);
});

// ── Small things ────────────────────────────────────────────────────────
test("effort: medium by default, only low|medium|high allowed", () => {
  eq(chatEffort(""), "medium");
  eq(chatEffort("HIGH"), "high");
  eq(chatEffort("max"), "medium");
  eq(chatEffort(undefined), "medium");
});
test("language of the answer, for reading it aloud", () => {
  eq(detectLang("Lagt till: ring Johan i PEOPLE, imorgon.", "en-US"), "sv-SE");
  eq(detectLang("Added it to your list for tomorrow.", "sv-SE"), "en-US");
  eq(detectLang("OK", "en-US"), "en-US");
});
test("chips: write tools only; errors marked", () => {
  eq(actionsFor("today", "Now: ...", false), []);
  eq(actionsFor("complete", "Done: Post on TikTok", false), [{ tool: "complete", ok: true, summary: "Done: Post on TikTok" }]);
  eq(actionsFor("draft_reply", "Error: Hotmail is not connected", true), [{ tool: "draft_reply", ok: false, summary: "draft_reply failed: Hotmail is not connected" }]);
  eq(actionsFor("remember", "Remembered [abcd1234]: Johan är min bror", false), [{ tool: "remember", ok: true, summary: "Remembered: Johan är min bror" }]);
  eq(actionsFor("update", "Updated: [abcd1234] Ring Johan · fre 6 nov · PEOPLE", false)[0].summary, "Updated: Ring Johan · fre 6 nov · PEOPLE");
});
