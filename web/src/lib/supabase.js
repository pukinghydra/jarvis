import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = !!(url && key);
export const supabase = configured ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

// Call the api function; throws with the server's message on failure.
export async function api(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("api", { body: { action, ...body } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function captureNote(text, lang, source) {
  const { data, error } = await supabase.functions.invoke("capture", { body: { text, lang, source } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Throw on a Supabase query error, return data otherwise.
export function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}
