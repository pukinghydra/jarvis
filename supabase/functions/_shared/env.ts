// The function environment. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase itself. VIC's settings (MS_CLIENT_ID, APP_URL, ICS_URL,
// ...) are read with config() from config.ts: env first, else app_secrets.

// Secret names typed by hand on a phone end up as "ms_client_secret" or
// "Ics_url", so any capitalisation of the name counts.
export const env = (name: string, fallback = ""): string => {
  const exact = Deno.env.get(name) || Deno.env.get(name.toLowerCase());
  if (exact) return exact.trim();
  try {
    const want = name.toLowerCase();
    for (const [k, v] of Object.entries(Deno.env.toObject())) {
      if (k.toLowerCase() === want && v) return v.trim();
    }
  } catch { /* env listing not allowed: fall through */ }
  return fallback.trim();
};

export const SUPABASE_URL = env("SUPABASE_URL");
export const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
