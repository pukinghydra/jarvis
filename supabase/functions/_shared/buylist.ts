// "What should I buy more of?" from THRIFTIN sales. Pure.
//
// Signals per category (from the THRIFTIN jarvis-feed):
//   sold_30 / sold_prev_30  how many sold in the last 30 days vs the 30 before
//   in_stock                tagged items still in stock (null = not tracked)
//   median_days_to_sell     added -> sold, only for tagged items (null if too few)
//   avg_price_90            average sale price
// Most THRIFTIN sales are logged without a tagged item, so stock and speed are
// often missing; the score then leans on sales volume and trend.

export type CategoryStat = {
  category: string;
  sold_30: number;
  sold_prev_30: number;
  sold_90: number;
  revenue_30: number;
  avg_price_90: number | null;
  in_stock: number | null;
  median_days_to_sell: number | null;
};

export type BuyRow = CategoryStat & { score: number; why: string };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function median(xs: number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function scoreCategories(stats: CategoryStat[]): BuyRow[] {
  const medPrice = median(stats.map((s) => s.avg_price_90 ?? 0)) ?? 0;
  return stats.map((s) => {
    const trend = clamp((s.sold_30 + 1) / (s.sold_prev_30 + 1), 0.5, 2);
    const stock = s.in_stock == null ? 1 : clamp((s.sold_30 + 1) / (s.in_stock + 1), 0.5, 2);
    const speed = s.median_days_to_sell == null ? 1 : clamp(30 / Math.max(s.median_days_to_sell, 3), 0.5, 2);
    const price = medPrice > 0 && s.avg_price_90 ? clamp(s.avg_price_90 / medPrice, 0.7, 1.4) : 1;
    const score = Math.round(s.sold_30 * Math.sqrt(trend) * stock * speed * price * 100) / 100;
    return { ...s, score, why: explain(s) };
  }).sort((a, b) => b.score - a.score || b.sold_90 - a.sold_90 || a.category.localeCompare(b.category));
}

export function explain(s: CategoryStat): string {
  const parts = [`${s.sold_30} sold in 30 days`];
  if (s.sold_prev_30 !== s.sold_30) parts[0] += ` (${s.sold_prev_30} the 30 before)`;
  if (s.in_stock != null) parts.push(`${s.in_stock} in stock`);
  if (s.median_days_to_sell != null) parts.push(`sells in ~${Math.round(s.median_days_to_sell)} days`);
  if (s.avg_price_90) parts.push(`avg ${Math.round(s.avg_price_90)} kr`);
  return parts.join(", ");
}

export function buyList(stats: CategoryStat[], top = 5, bottom = 3): { buy: BuyRow[]; skip: BuyRow[]; all: BuyRow[] } {
  const all = scoreCategories(stats.filter((s) => s.sold_90 > 0 || (s.in_stock ?? 0) > 0));
  const buy = all.filter((r) => r.sold_30 > 0).slice(0, top);
  const buyNames = new Set(buy.map((r) => r.category));
  // Skip: slowest movers, worst first: stock sitting there beats "just slow".
  const skip = all
    .filter((r) => !buyNames.has(r.category))
    .sort((a, b) => a.score - b.score || (b.in_stock ?? 0) - (a.in_stock ?? 0))
    .slice(0, bottom);
  return { buy, skip, all };
}
