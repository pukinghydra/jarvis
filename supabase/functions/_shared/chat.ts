// deno-lint-ignore-file no-explicit-any
// The in-app voice chat: VIC talks, Claude answers and acts with the same
// tools the Claude app uses (tools.ts), plus web search. Without a Claude
// API key it falls back to saving the words as a note (capture.ts).
//
// History lives in chat_messages, append-only (see chat-core.ts). The
// current thread id is settings.chat_thread.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { anthropic, FALLBACK_OK, hasClaude, model } from "./claude.ts";
import { config } from "./config.ts";
import { sb, must, getSetting, HttpError } from "./db.ts";
import { buildTools, type ItemSource } from "./tools.ts";
import { capture } from "./capture.ts";
import {
  apiTools, chatEffort, CHAT_MAX_TOKENS, CHAT_SYSTEM, detectLang, MEMORY_CAP, memoryBlock, recapText, runLoop,
  threadDecision, toolSchemas, userMessage, type Action, type ThreadRow,
} from "./chat-core.ts";

export type ChatReply = { mode: "chat" | "note"; reply_text: string; lang: string; actions: Action[]; thread_id: string | null };

const TIME_BUDGET_MS = 120_000; // edge functions stop at ~150 s

async function loadThread(id: string): Promise<ThreadRow[]> {
  return (must(
    await sb.from("chat_messages").select("role, content, display_text, created_at").eq("thread_id", id).order("id", { ascending: true }).limit(400),
    "chat history",
  ) ?? []) as ThreadRow[];
}

async function newThread(now: Date): Promise<string> {
  const id = crypto.randomUUID();
  must(await sb.from("settings").upsert({ key: "chat_thread", value: { id, started_at: now.toISOString() }, updated_at: now.toISOString() }), "new chat thread");
  return id;
}

// The thread to talk in: the current one, or a fresh one when it went quiet
// (2 h), got long, or can't be replayed. Long/broken threads carry a recap.
async function thread(now: Date): Promise<{ id: string; rows: ThreadRow[]; fresh: boolean; recap: string }> {
  const st = await getSetting<any>("chat_thread", null);
  if (st?.id) {
    const rows = await loadThread(st.id);
    const why = threadDecision(rows, now.getTime());
    if (!why) return { id: st.id, rows, fresh: rows.length === 0, recap: "" };
    return { id: await newThread(now), rows: [], fresh: true, recap: why === "idle" ? "" : recapText(rows) };
  }
  return { id: await newThread(now), rows: [], fresh: true, recap: "" };
}

async function memories(): Promise<string> {
  const rows = must(await sb.from("memories").select("short_id, fact, tags").order("updated_at", { ascending: false }).limit(MEMORY_CAP), "memories") ?? [];
  return memoryBlock(rows as any[]);
}

// Request parameters, with two fallbacks if the API rejects something:
// `safe` drops the newer features (thinking block binding, top-level cache
// breakpoint); `noWeb` also drops web search/fetch (e.g. switched off for
// the organisation in the Claude Console). Sticky per function instance.
let safe = false;
let noWeb = false;
function params(m: string, effort: string, messages: any[]) {
  const tools = apiTools();
  const p: any = {
    model: m,
    max_tokens: CHAT_MAX_TOKENS,
    system: [{ type: "text", text: CHAT_SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: noWeb ? tools.filter((t) => !t.type) : tools,
    tool_choice: { type: "auto" },
    output_config: { effort },
    messages,
  };
  const betas: string[] = [];
  if (FALLBACK_OK.has(m)) { betas.push("server-side-fallback-2026-07-01"); p.fallbacks = "default"; }
  if (!safe) {
    // Append-only history; if a thinking block ever fails the conversation
    // check, drop it instead of failing the whole answer.
    betas.push("thinking-binding-controls-2026-08-01");
    p.thinking = { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } };
    p.cache_control = { type: "ephemeral" };
  }
  if (betas.length) p.betas = betas;
  return p;
}

function friendly(e: unknown): HttpError {
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(502, "Claude API key is wrong or revoked (ANTHROPIC_API_KEY)");
  if (e instanceof Anthropic.RateLimitError) return new HttpError(503, "Claude is busy right now; try again in a minute");
  if (e instanceof Anthropic.APIError) return new HttpError(502, `Claude API error ${e.status}: ${e.message}`);
  return new HttpError(500, e instanceof Error ? e.message : String(e));
}

export async function chatSay(text: string, lang: string | null, source: ItemSource): Promise<ChatReply> {
  const clean = String(text ?? "").trim();
  if (!clean) throw new HttpError(400, "Say or type something first");
  const hint = lang && /^(sv|en)/i.test(lang) ? lang : "sv-SE";

  if (!(await hasClaude())) {
    const r = await capture(clean, { lang: hint, source: source === "voice" ? "voice" : "app" });
    return { mode: "note", reply_text: r.reply, lang: hint, actions: [], thread_id: null };
  }

  const now = new Date();
  const client = await anthropic();
  const m = await model();
  const effort = chatEffort(await config("JARVIS_CHAT_EFFORT"));
  const tools = buildTools({ source });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const run = (name: string, args: Record<string, unknown>) => {
    const t = byName.get(name);
    if (!t) throw new Error(`Unknown tool ${name}`);
    return t.handler(args);
  };

  const attempt = async (th: { id: string; rows: ThreadRow[]; fresh: boolean; recap: string }) => {
    const user = userMessage(clean, now, hint, th.fresh ? { memories: await memories(), recap: th.recap } : undefined);
    must(await sb.from("chat_messages").insert({ thread_id: th.id, role: "user", content: user.content, display_text: clean, lang: hint }), "save message");
    let calls = 0;
    const create = async (messages: any[]) => {
      calls++;
      for (;;) {
        try {
          return await client.beta.messages.create(params(m, effort, messages) as any);
        } catch (e) {
          if (!(e instanceof Anthropic.BadRequestError) || (safe && noWeb)) throw e;
          if (!safe) { safe = true; console.error("chat: request rejected, retrying with plain parameters:", e.message); }
          else { noWeb = true; console.error("chat: still rejected, retrying without web search/fetch:", e.message); }
        }
      }
    };
    try {
      const res = await runLoop({
        create, history: th.rows.map((r) => ({ role: r.role, content: r.content })), user, run, schemas: toolSchemas(),
        lang: hint, deadline: Date.now() + TIME_BUDGET_MS,
      });
      return { res, calls };
    } catch (e) {
      (e as any).__firstCall = calls <= 1;
      throw e;
    }
  };

  let th = await thread(now);
  let out: Awaited<ReturnType<typeof attempt>>;
  try {
    out = await attempt(th);
  } catch (e) {
    // The stored history itself was refused (first call, 400): carry on in a
    // fresh thread with a recap instead of failing every message from now on.
    if (e instanceof Anthropic.BadRequestError && (e as any).__firstCall && th.rows.length) {
      console.error("chat: history refused, starting a fresh thread:", e.message);
      const recap = recapText(th.rows);
      th = { id: await newThread(now), rows: [], fresh: true, recap };
      try { out = await attempt(th); } catch (e2) { throw friendly(e2); }
    } else {
      throw friendly(e);
    }
  }

  const { res } = out;
  const replyLang = detectLang(res.reply, hint);
  if (res.appended.length) {
    // Assistant messages pair with their Claude call's usage, in order.
    let k = 0;
    const lastAssistant = res.appended.map((x) => x.role).lastIndexOf("assistant");
    const rows = res.appended.map((msg, i) => ({
      thread_id: th.id,
      role: msg.role,
      content: msg.content,
      usage: msg.role === "assistant" ? res.usage[k++] ?? null : null,
      ...(i === lastAssistant ? { display_text: res.reply, lang: replyLang, actions: res.actions } : {}),
    }));
    must(await sb.from("chat_messages").insert(rows), "save answer");
  }
  return { mode: "chat", reply_text: res.reply, lang: replyLang, actions: res.actions, thread_id: th.id };
}

export async function chatNewTopic(): Promise<{ thread_id: string }> {
  return { thread_id: await newThread(new Date()) };
}

// What the app shows when the Talk screen opens: the current conversation
// (if it isn't stale), as bubbles.
export async function chatHistory(): Promise<{ claude: boolean; thread_id: string | null; messages: { role: string; text: string; actions: Action[]; at: string }[] }> {
  const claude = await hasClaude();
  const st = await getSetting<any>("chat_thread", null);
  if (!st?.id) return { claude, thread_id: null, messages: [] };
  const rows = must(
    await sb.from("chat_messages").select("role, display_text, actions, created_at").eq("thread_id", st.id).not("display_text", "is", null).order("id", { ascending: true }).limit(60),
    "chat bubbles",
  ) ?? [];
  const last = rows.length ? Date.parse((rows[rows.length - 1] as any).created_at) : NaN;
  if (Number.isFinite(last) && Date.now() - last > 2 * 3600_000) return { claude, thread_id: null, messages: [] };
  return {
    claude,
    thread_id: st.id,
    messages: rows.map((r: any) => ({ role: r.role, text: r.display_text, actions: Array.isArray(r.actions) ? r.actions : [], at: r.created_at })),
  };
}
