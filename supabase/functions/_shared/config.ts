// config(name): a setting from the function environment (Supabase > Edge
// Functions > Secrets), or, when that is blank, from public.app_secrets
// (service role only). The stored values are read in one query and kept for
// 60 s per function instance, so a change lands within a minute.

import { env } from "./env.ts";
import { sb } from "./db.ts";
import { CONFIG_KEYS, type ConfigKey, resolveConfig } from "./config-core.ts";

export type { ConfigKey } from "./config-core.ts";

const TTL_MS = 60_000;
let stored: { at: number; values: Record<string, string> } | null = null;

async function storedValues(): Promise<Record<string, string>> {
  if (stored && Date.now() - stored.at < TTL_MS) return stored.values;
  const { data, error } = await sb.from("app_secrets").select("key, value").in("key", [...CONFIG_KEYS]);
  if (error) throw new Error(`app_secrets: ${error.message}`);
  const values: Record<string, string> = {};
  for (const row of data ?? []) values[row.key] = String(row.value ?? "");
  stored = { at: Date.now(), values };
  return values;
}

export async function config(name: ConfigKey): Promise<string> {
  const fromEnv = env(name);
  if (fromEnv) return resolveConfig(name, fromEnv, {});
  return resolveConfig(name, "", await storedValues());
}
