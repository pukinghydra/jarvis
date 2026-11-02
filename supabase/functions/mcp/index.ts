// MCP server for the Claude app (custom connector). URL:
//   https://<project>.supabase.co/functions/v1/mcp/<MCP_KEY>
// MCP_KEY lives in app_secrets (made by the migration); Settings in the app
// shows the full URL with a copy button. The secret path segment is the password (claude.ai connectors can't send
// custom headers), compared in constant time. verify_jwt is off.

import { appSecret } from "../_shared/secrets.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { handleBody } from "../_shared/mcp-core.ts";
import { buildTools, INSTRUCTIONS } from "../_shared/mcp-tools.ts";

const tools = buildTools();
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
  const res = await handleBody(body, tools, INSTRUCTIONS);
  if (res.status === 202) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(res.json), { status: 200, headers: H });
});
