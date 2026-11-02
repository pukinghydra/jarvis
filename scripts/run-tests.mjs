// Run tests/*.test.ts in Node: bundle each with esbuild, mapping
// "npm:pkg@ver" imports to the locally installed package.
// Run: node scripts/run-tests.mjs
import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const here = new URL("..", import.meta.url).pathname;
const testDir = join(here, "tests");
const outDir = join(here, "node_modules", ".tests");
mkdirSync(outDir, { recursive: true });

const npmSpecifiers = {
  name: "npm-specifiers",
  setup(b) {
    // "npm:web-push@3.6.7" -> external "web-push", loaded by Node from
    // this repo's node_modules (works for CommonJS packages too).
    b.onResolve({ filter: /^npm:/ }, (args) => ({
      path: args.path.slice(4).replace(/^(@[^/]+\/[^@/]+|[^@/]+)@[^/]+/, "$1"),
      external: true,
    }));
  },
};

let failed = 0;
for (const f of readdirSync(testDir).filter((x) => x.endsWith(".test.ts"))) {
  const out = join(outDir, f.replace(/\.ts$/, ".mjs"));
  await build({ entryPoints: [join(testDir, f)], bundle: true, format: "esm", platform: "node", outfile: out, plugins: [npmSpecifiers], logLevel: "error" });
  const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
  const results = await mod.run();
  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${f}: ${r.name}${r.ok ? "" : `\n      ${r.error}`}`);
    if (!r.ok) failed++;
  }
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
