// Bundle every edge function with esbuild to catch syntax and import
// errors (Deno isn't needed). npm:/jsr: imports stay external.
// Run: node scripts/check-functions.mjs [extra/function/index.ts ...]
import { build } from "esbuild";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../supabase/functions/", import.meta.url).pathname;
const entries = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(root, d.name, "index.ts")))
  .map((d) => join(root, d.name, "index.ts"));
entries.push(...process.argv.slice(2));

let failed = 0;
for (const entry of entries) {
  try {
    await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent", external: ["npm:*", "jsr:*", "node:*"] });
    console.log(`ok    ${entry.replace(root, "")}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${entry}\n${e.errors?.map((x) => `  ${x.location?.file}:${x.location?.line} ${x.text}`).join("\n") ?? e}`);
  }
}
process.exit(failed ? 1 : 0);
