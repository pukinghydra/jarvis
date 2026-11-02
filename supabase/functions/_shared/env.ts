// The function environment. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase itself. VIC's settings (MS_CLIENT_ID, APP_URL, ICS_URL,
// ...) are read with config() from config.ts: env first, else app_secrets.

// Secret names typed by hand in the dashboard may end up lowercase
// ("ms_client_secret"), so the lowercase spelling counts too.
export const env = (name: string, fallback = ""): string =>
  (Deno.env.get(name) || Deno.env.get(name.toLowerCase()) || fallback).trim();

export const SUPABASE_URL = env("SUPABASE_URL");
export const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
