// Service-role database client (server side only) and the owner check for
// calls that come from the web app with VIC's login.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { SERVICE_KEY, SUPABASE_URL } from "./env.ts";

export const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Throws if the request isn't from the owner's login. verify_jwt only proves
// "some signed-in user"; this proves "VIC".
export async function requireOwner(req: Request): Promise<string> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Not signed in");
  const { data: owner } = await sb.from("owner").select("user_id").eq("id", 1).maybeSingle();
  if (!owner || owner.user_id !== data.user.id) throw new HttpError(403, "Not the owner of this Jarvis");
  return data.user.id;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Throw on a Supabase error, return data otherwise.
export function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await sb.from("settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

// Claim a one-off job/alert key. True the first time only.
export async function claimOnce(key: string): Promise<boolean> {
  const { data, error } = await sb.from("sent_log").upsert({ key }, { onConflict: "key", ignoreDuplicates: true }).select("key");
  if (error) throw new Error(`sent_log: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function lanesBySlug(): Promise<Map<string, { id: string; slug: string; name: string; color: string; description: string }>> {
  const rows = must(await sb.from("lanes").select("id, slug, name, color, description, sort").order("sort"), "lanes") ?? [];
  return new Map(rows.map((l: any) => [l.slug, l]));
}
