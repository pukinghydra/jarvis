// Type-check the edge functions with plain tsc (no Deno here): map the
// versioned npm: specifiers to the locally installed packages and declare
// the few Deno globals the code uses.
declare module "npm:@supabase/supabase-js@2.118.0" { export * from "@supabase/supabase-js"; }
declare module "npm:@anthropic-ai/sdk@1.3.0" { import A from "@anthropic-ai/sdk"; export default A; }
declare module "npm:ical.js@2.2.1" { import I from "ical.js"; export default I; }
declare module "npm:web-push@3.6.7" { const w: any; export default w; }
// Node built-in used only by the tests (no @types/node in this repo).
declare module "node:fs" { export function readFileSync(path: string | URL, encoding: "utf8"): string; }
declare const Deno: {
  env: { get(name: string): string | undefined; toObject(): Record<string, string> };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};
