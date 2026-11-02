// Rule-based email flags (no AI): keywords in the subject or the start of
// the body, and VIP senders from settings. Pure.

export const KEYWORDS = [
  // Money / authorities
  "faktura", "betala", "betalning", "påminnelse", "förfaller", "sista dag", "skatteverket", "fortnox",
  "kronofogden", "inkasso", "invoice", "payment", "overdue",
  // Shop / parcels
  "order", "retur", "refund", "vinted", "shopify", "zettle", "postnord", "dhl",
  // Bookings
  "booking", "bokning",
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Matches at the start of a word, so "faktura" finds "fakturan" and "order"
// finds "orderbekräftelse", but "order" doesn't fire on "border".
function keywordRe(word: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(word.toLowerCase())}`, "iu");
}

export function vipMatch(address: string | null, vips: string[]): string | null {
  const a = (address ?? "").toLowerCase().trim();
  if (!a) return null;
  for (const raw of vips) {
    const v = String(raw ?? "").toLowerCase().trim();
    if (!v) continue;
    if (v.includes("@") && !v.startsWith("@")) {
      if (a === v) return v;
    } else {
      const dom = v.replace(/^@/, "");
      if (a.endsWith(`@${dom}`) || a.endsWith(`.${dom}`)) return v;
    }
  }
  return null;
}

export function flagEmail(
  m: { from_address: string | null; from_name?: string | null; subject: string | null; body: string | null },
  vips: string[] = [],
  extraKeywords: string[] = [],
): string[] {
  const reasons: string[] = [];
  const vip = vipMatch(m.from_address, vips);
  if (vip) reasons.push(`VIP ${vip}`);
  // Sender too: "Skatteverket", "Vinted", "PostNord" are usually who it's from.
  const hay = `${m.from_name ?? ""}\n${m.from_address ?? ""}\n${m.subject ?? ""}\n${(m.body ?? "").slice(0, 3000)}`;
  const words = [...KEYWORDS, ...extraKeywords.map((w) => String(w).toLowerCase().trim()).filter(Boolean)];
  for (const w of [...new Set(words)]) {
    if (keywordRe(w).test(hay)) reasons.push(w);
    if (reasons.length >= 6) break;
  }
  return reasons;
}

// Plain-text body, tidy and capped (Claude reads it through the connector).
export function cleanBody(text: string, max = 8000): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}
