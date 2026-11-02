// The function environment. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase itself. VIC's settings (MS_CLIENT_ID, APP_URL, ICS_URL,
// ...) are read with config() from config.ts: env first, else app_secrets.

export const env = (name: string, fallback = ""): string => (Deno.env.get(name) ?? fallback).trim();

export const SUPABASE_URL = env("SUPABASE_URL");
export const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
