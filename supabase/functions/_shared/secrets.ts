// Secrets Jarvis made for itself, stored in public.app_secrets (service
// role only): CRON_SECRET, STATE_SECRET, MCP_KEY, PROJECT_URL, VAPID_KEYS.
// None of them is ever typed into chat or the dashboard.

import { sb } from "./db.ts";
import { generateVapid } from "./secrets-core.ts";

const cache = new Map<string, string>();

export async function appSecret(key: string): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  const { data, error } = await sb.from("app_secrets").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`app_secrets: ${error.message}`);
  const v = (data?.value ?? "").trim();
  if (v) cache.set(key, v);
  return v;
}

// Made on first use; a race between two functions keeps the first pair.
export async function vapidKeys(): Promise<{ public: string; private: string }> {
  const raw = await appSecret("VAPID_KEYS");
  if (raw) return JSON.parse(raw);
  const fresh = await generateVapid();
  await sb.from("app_secrets").upsert({ key: "VAPID_KEYS", value: JSON.stringify(fresh) }, { onConflict: "key", ignoreDuplicates: true });
  cache.delete("VAPID_KEYS");
  const stored = await appSecret("VAPID_KEYS");
  return stored ? JSON.parse(stored) : fresh;
}
