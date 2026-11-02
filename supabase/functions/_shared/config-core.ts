// Pure part of config(): which value wins. Testable in Node.

// Settings Jarvis reads from the function environment OR, when that is not
// set, from public.app_secrets. The second way exists because the dashboard's
// secrets box is not always usable: VIC (or Claude, through the Supabase
// connector) can then set a value with one SQL insert.
export const CONFIG_KEYS = [
  "MS_CLIENT_ID",
  "MS_CLIENT_SECRET",
  "APP_URL",
  "ICS_URL",
  "THRIFTIN_FEED_URL",
  "THRIFTIN_FEED_TOKEN",
  "JARVIS_MODEL",
  "JARVIS_TRIAGE_MODEL",
  "JARVIS_CHAT_EFFORT",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "TRANSCRIBE_MODEL",
] as const;
export type ConfigKey = typeof CONFIG_KEYS[number];

// The environment wins when it holds a non-blank value; otherwise the stored
// value; otherwise "". Values are trimmed. APP_URL loses trailing slashes.
export function resolveConfig(name: ConfigKey, envValue: string | undefined, stored: Record<string, string | null | undefined>): string {
  const fromEnv = (envValue ?? "").trim();
  const value = fromEnv || String(stored[name] ?? "").trim();
  return name === "APP_URL" ? value.replace(/\/+$/, "") : value;
}
