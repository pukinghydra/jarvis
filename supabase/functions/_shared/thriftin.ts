// deno-lint-ignore-file no-explicit-any
// THRIFTIN data for the brief and buy list, read from THRIFTIN's own
// jarvis-feed function (read-only, token-guarded, no customer details).
// Without THRIFTIN_FEED_URL / THRIFTIN_FEED_TOKEN this returns null and
// the brief leaves the shop section out.

import { config } from "./config.ts";
import type { CategoryStat } from "./buylist.ts";

export type ThriftinFeed = {
  generated_at: string;
  shifts: { date: string; user_name: string | null; hours: number | null; status: string }[];
  web_orders: { order_name: string | null; ordered_at: string; ship_by: string; items: number; total: number | null; currency: string | null; shipping_method: string | null }[];
  categories: CategoryStat[];
};

export async function thriftinFeed(): Promise<ThriftinFeed | null> {
  const [url, token] = await Promise.all([config("THRIFTIN_FEED_URL"), config("THRIFTIN_FEED_TOKEN")]);
  if (!url || !token) return null;
  try {
    const res = await fetch(url, { method: "POST", headers: { "x-jarvis-token": token, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return await res.json() as ThriftinFeed;
  } catch {
    return null;
  }
}
