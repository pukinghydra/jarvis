// Tiny test helper: collect named checks, report pass/fail.
export type Result = { name: string; ok: boolean; error?: string };
export function suite() {
  const tests: [string, () => unknown | Promise<unknown>][] = [];
  return {
    test: (name: string, fn: () => unknown | Promise<unknown>) => tests.push([name, fn]),
    run: async (): Promise<Result[]> => {
      const out: Result[] = [];
      for (const [name, fn] of tests) {
        try { await fn(); out.push({ name, ok: true }); } catch (e) { out.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) }); }
      }
      return out;
    },
  };
}
export function eq(a: unknown, b: unknown, msg = "") {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`);
}
export function ok(v: unknown, msg = "expected truthy") { if (!v) throw new Error(msg); }
