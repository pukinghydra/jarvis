// Long-term memory, the pure part: cleaning what Claude saves and the
// PostgREST filter for recall. No Deno, so tests run it in Node.

export const MEMORY_MAX_CHARS = 1000;

export function cleanFact(v: unknown): string {
  const fact = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!fact) throw new Error("fact is empty");
  if (fact.length > MEMORY_MAX_CHARS) throw new Error(`Keep a memory under ${MEMORY_MAX_CHARS} characters`);
  return fact;
}

export function cleanTags(v: unknown): string[] {
  return [...new Set((Array.isArray(v) ? v : [])
    .map((t) => String(t ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean))].slice(0, 8);
}

// ilike pattern that matches the fact literally (no wildcards from the text).
export const likeLiteral = (s: string) => s.replace(/[%_\\]/g, "\\$&");

// PostgREST `or` filter for recall: words in the fact, or the query as a tag.
// null = no query (list the most recent).
export function recallFilter(query: unknown): string | null {
  const q = String(query ?? "").replace(/[%,()*"{}\\]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return null;
  const tag = q.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  return tag ? `fact.ilike.%${q}%,tags.cs.{${tag}}` : `fact.ilike.%${q}%`;
}

export function memoryRef(v: unknown): string {
  const ref = String(v ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{8,36}$/.test(ref)) throw new Error("Give the memory id (8 characters)");
  return ref;
}
