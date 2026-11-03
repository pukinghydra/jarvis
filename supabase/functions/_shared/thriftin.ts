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

// The THRIFTIN schedule (shifts + day notes) through the same feed. Staff see
// this schedule, so Jarvis confirms every change with VIC before writing.
// Throws a readable error (THRIFTIN's own message for bad input).
export async function thriftinAction(action: string, args: Record<string, unknown>): Promise<any> {
  const [url, token] = await Promise.all([config("THRIFTIN_FEED_URL"), config("THRIFTIN_FEED_TOKEN")]);
  if (!url || !token) throw new Error("THRIFTIN is not connected (THRIFTIN_FEED_URL/TOKEN not set).");
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-jarvis-token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ ...args, action }),
    signal: AbortSignal.timeout(20_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`THRIFTIN: ${body?.error ?? `answered ${res.status}`}`);
  return body;
}
