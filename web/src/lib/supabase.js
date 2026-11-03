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

// The Talk screen: chat("say", { text, lang, source }), chat("history"),
// chat("new_topic").
export async function chat(action, body = {}) {
  const { data, error } = await supabase.functions.invoke("chat", { body: { action, ...body } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Speech to text: transcribe({check: true}) -> {provider}; transcribe(blob)
// -> {text}.
export async function transcribe(audio) {
  let body;
  if (audio instanceof Blob) {
    body = new FormData();
    const ext = audio.type.includes("wav") ? "wav" : audio.type.includes("webm") ? "webm" : audio.type.includes("ogg") ? "ogg" : "m4a";
    body.append("audio", audio, `talk.${ext}`);
    body.append("type", audio.type);
  } else {
    body = audio;
  }
  const { data, error } = await supabase.functions.invoke("transcribe", { body });
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
