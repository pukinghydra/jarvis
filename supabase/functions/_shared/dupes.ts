// Is a new to-do the same thing as one that's already open? Used before
// saving so the same return / meeting doesn't show up twice (Vinted sends
// several emails per return; Claude may add a thing twice). Pure.

const STOP = new Set([
  "skicka", "vinted", "retur", "send", "return", "back", "tillbaka", "the", "a", "an", "en", "ett", "och", "and", "of", "with", "med",
  "to", "till", "pa", "on", "for", "for", "i", "in", "at", "size", "storlek", "coat", "wool", "kappa", "kappan", "jacka", "jacket",
  "plaszcz", "vintage", "winter", "attend", "do", "gor", "go",
]);

export function titleWords(title: string): Set<string> {
  const t = String(title ?? "").toLowerCase().replace(/ł/g, "l").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w)));
}

// Share of the shorter title's words that the other one also has.
export function overlap(a: string, b: string): number {
  const A = titleWords(a), B = titleWords(b);
  const small = A.size <= B.size ? A : B, big = small === A ? B : A;
  if (small.size < 2) return 0;
  let n = 0;
  for (const w of small) if (big.has(w)) n++;
  return n / small.size;
}

type Due = { title: string; due_at: string | null };
const DAY = 86400_000;

// Same thing = most words in common and due within `days` of each other
// (or both without a date).
export function sameThing(a: Due, b: Due, days = 1): boolean {
  const ta = a.due_at ? Date.parse(a.due_at) : null, tb = b.due_at ? Date.parse(b.due_at) : null;
  if ((ta === null) !== (tb === null)) return false;
  if (ta !== null && tb !== null && Math.abs(ta - tb) > days * DAY) return false;
  return overlap(a.title, b.title) >= 0.6;
}

export function findSame<T extends Due>(row: Due, open: T[], days = 1): T | null {
  return open.find((o) => sameThing(row, o, days)) ?? null;
}
