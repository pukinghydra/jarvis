import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, eq } from "./t.ts";
import { TOOL_DEFS } from "../supabase/functions/_shared/tool-defs.ts";

const { test, run } = suite();
export { run };

// The Claude app remembers VIC's "Always allow" per tool under a hash of the
// tool's description and its top-level parameter names + descriptions
// (anthropics/claude-ai-mcp#1032). Change any of those and every call to that
// tool asks for approval again. So they are frozen: this test fails on any
// change. Only update tests/tool-freeze.json on purpose, and tell VIC he'll
// have to tap "Always allow" once more for those tools.
function toolKey(t: { description: string; inputSchema: any }): string {
  const props = Object.entries(t.inputSchema?.properties ?? {}).map(([k, v]: [string, any]) => [k, v?.description ?? ""]);
  return createHash("md5").update(JSON.stringify([t.description, props])).digest("hex");
}

test("tool definitions are frozen (changing them resets VIC's 'Always allow')", () => {
  const frozen = JSON.parse(readFileSync(join(process.cwd(), "tests", "tool-freeze.json"), "utf8"));
  const now = Object.fromEntries(TOOL_DEFS.map((t) => [t.name, toolKey(t as any)]));
  const changed = Object.keys({ ...frozen, ...now }).filter((n) => frozen[n] !== now[n]);
  eq(changed, [], `changed tool definitions: ${changed.join(", ")}`);
});
