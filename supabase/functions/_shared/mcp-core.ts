// Minimal MCP server over Streamable HTTP: JSON-RPC 2.0 in a POST, one JSON
// answer back (no SSE). Pure routing; the tools are passed in.

import { toolAnnotations, toolName } from "./tool-defs.ts";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
};

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

export const SERVER_INFO = { name: "jarvis", version: "1.0.0" };
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST = "2025-06-18";

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function handleRpc(msg: Rpc, tools: ToolDef[], instructions?: string): Promise<object | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return err(msg?.id ?? null, -32600, "Invalid request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok(msg.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        ...(instructions ? { instructions } : {}),
      });
    }
    case "ping":
      return isNotification ? null : ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: toolAnnotations(name) })) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = tools.find((t) => t.name === toolName(name));
      if (!tool) return err(msg.id, -32602, `Unknown tool: ${name}`);
      const args = msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {};
      try {
        const text = await tool.handler(args);
        return ok(msg.id, { content: [{ type: "text", text }] });
      } catch (e) {
        // Tool errors go back to Claude as a result it can read and fix.
        return ok(msg.id, { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return null; // e.g. notifications/initialized
      return isNotification ? null : err(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

// One HTTP body may be a single message or (older clients) an array.
export async function handleBody(body: unknown, tools: ToolDef[], instructions?: string): Promise<{ status: number; json: unknown }> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m, tools, instructions)))).filter(Boolean);
    return out.length ? { status: 200, json: out } : { status: 202, json: null };
  }
  const res = await handleRpc(body as Rpc, tools, instructions);
  return res ? { status: 200, json: res } : { status: 202, json: null };
}
