// deno-lint-ignore-file no-explicit-any
// OPTIONAL. Jarvis works without a Claude API key: VIC talks to Jarvis
// through the Claude app (his plan) and the MCP connector. Only when
// ANTHROPIC_API_KEY is set does the app's mic auto-sort notes into items.
// Callers check hasClaude() first; nothing else depends on this file.
//
// One place that calls Claude. Every call:
//  - has NO tools (Claude can only answer, never act),
//  - returns JSON constrained by a schema (output_config.format),
//  - opts into server-side fallback when the model supports it,
//  - checks stop_reason before reading the answer.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { config } from "./config.ts";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const model = async (): Promise<string> => (await config("JARVIS_MODEL")) || DEFAULT_MODEL;
// Email sorting can run on its own (cheaper) model: JARVIS_TRIAGE_MODEL.
export const triageModel = async (): Promise<string> => (await config("JARVIS_TRIAGE_MODEL")) || DEFAULT_MODEL;
// Models that accept `fallbacks: "default"` (Claude API). Others go without.
const FALLBACK_OK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5"]);

export const hasClaude = async (): Promise<boolean> => !!(await config("ANTHROPIC_API_KEY").catch(() => ""));

let client: Anthropic | null = null;
async function anthropic(): Promise<Anthropic> {
  const apiKey = await config("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  return (client ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 }));
}

export class ClaudeRefused extends Error {}

export async function askJson<T>(opts: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  model?: string;
}): Promise<T> {
  const MODEL = opts.model || await model();
  const params: any = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 12000,
    // The system prompt is stable, so it is cached; anything that changes
    // (the time, the dictation, the email) is in the user message.
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: opts.schema } },
  };
  if (FALLBACK_OK.has(MODEL)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  let res: any;
  try {
    res = await (await anthropic()).beta.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Claude API key is wrong or revoked (ANTHROPIC_API_KEY)");
    if (e instanceof Anthropic.RateLimitError) throw new Error("Claude is rate limited right now; try again in a minute");
    if (e instanceof Anthropic.BadRequestError) throw new Error(`Claude rejected the request: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API error ${e.status}: ${e.message}`);
    throw e;
  }
  if (res.stop_reason === "refusal") {
    throw new ClaudeRefused(`Claude declined this one${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}`);
  }
  if (res.stop_reason === "max_tokens") throw new Error("Claude ran out of room for the answer");
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no answer");
  return JSON.parse(text) as T;
}

// JSON schema helpers (structured outputs need additionalProperties: false
// and every property listed in `required`).
export const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: "null" }] });
export const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
