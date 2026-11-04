// MCP server for the Claude app (custom connector). URL:
//   https://<project>.supabase.co/functions/v1/mcp/<MCP_KEY>
// MCP_KEY lives in app_secrets (made by the migration); Settings in the app
// shows the full URL with a copy button. The secret path segment is the password (claude.ai connectors can't send
// custom headers), compared in constant time. verify_jwt is off.

import { appSecret } from "../_shared/secrets.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { handleBody } from "../_shared/mcp-core.ts";
import { buildTools } from "../_shared/tools.ts";
import { INSTRUCTIONS } from "../_shared/tool-defs.ts";

const tools = buildTools({ source: "mcp" });

// One log line per message: method, tool name, ok/error. Never the arguments
// or results (they hold VIC's mail and plans). Shows in the function's logs.
function logCalls(body: unknown, json: unknown, ms: number) {
  const msgs = Array.isArray(body) ? body : [body];
  const outs = Array.isArray(json) ? json : [json];
  for (const m of msgs as any[]) {
    const out = outs.find((o: any) => o && m && o.id === m.id && m.id != null) as any;
    const tool = m?.method === "tools/call" ? ` ${String(m?.params?.name ?? "?")}` : "";
    const state = !out ? "" : out.error ? ` ERROR ${out.error.message}` : out.result?.isError ? ` TOOL-ERROR ${String(out.result.content?.[0]?.text ?? "").slice(0, 200)}` : " ok";
    console.log(`mcp ${String(m?.method ?? "?")}${tool}${state} ${ms}ms`);
  }
}
const H = { "Content-Type": "application/json", "Cache-Control": "no-store" };

Deno.serve(async (req) => {
  const key = await appSecret("MCP_KEY").catch(() => "");
  const m = /\/mcp\/([^/?#]+)\/?$/.exec(new URL(req.url).pathname);
  if (!key || key.length < 24 || !m || !timingSafeEqual(decodeURIComponent(m[1]), key)) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: H });
  }
  if (req.method === "GET" || req.method === "DELETE") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: H });
  }
  const t0 = Date.now();
  const res = await handleBody(body, tools, INSTRUCTIONS);
  logCalls(body, res.json, Date.now() - t0);
  if (res.status === 202) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(res.json), { status: 200, headers: H });
});
