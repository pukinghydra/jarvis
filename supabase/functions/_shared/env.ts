// Secrets and settings from the function environment (Supabase dashboard >
// Edge Functions > Secrets). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase itself.

export const env = (name: string, fallback = ""): string => (Deno.env.get(name) ?? fallback).trim();

export const SUPABASE_URL = env("SUPABASE_URL");
export const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
export const APP_URL = env("APP_URL").replace(/\/+$/, "");
