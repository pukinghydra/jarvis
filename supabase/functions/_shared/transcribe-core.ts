// Speech to text for the Talk screen, the pure part: which provider, the
// upload checks and the multipart form each provider wants, and reading the
// answer. The browser records real audio (MediaRecorder) and the server
// transcribes it, because iPhone home-screen apps' built-in recognition
// misses too much. No language is forced, so Swedish and English can mix.

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;     // both providers' upload cap
export const MAX_AUDIO_SECONDS = 10 * 60;             // the app stops at 10 min

export const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
export const OPENAI_STT_MODEL = "gpt-4o-transcribe";
export const ELEVEN_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";
export const ELEVEN_STT_MODEL = "scribe_v2";

// Names and words the recogniser should expect (spelling hints).
export const STT_PROMPT = "VIC pratar svenska eller engelska, ofta blandat. Namn och ord: Jarvis, Thriftin, THRIFTIN, Vinted, Richie, Rav, Zettle, Shopify, moms, Fortnox, Skatteverket, Hotmail, TikTok, Instagram, PostNord, Birkagatan.";

export type Provider = { name: "openai" | "elevenlabs"; key: string; model: string };

export function chooseProvider(keys: { openai?: string; elevenlabs?: string; model?: string }): Provider | null {
  const o = (keys.openai ?? "").trim(), e = (keys.elevenlabs ?? "").trim(), m = (keys.model ?? "").trim();
  if (o) return { name: "openai", key: o, model: m && !m.startsWith("scribe") ? m : OPENAI_STT_MODEL };
  if (e) return { name: "elevenlabs", key: e, model: m && m.startsWith("scribe") ? m : ELEVEN_STT_MODEL };
  return null;
}

export const NO_PROVIDER = "No speech-to-text key: add OPENAI_API_KEY (or ELEVENLABS_API_KEY) in Supabase > Edge Functions > Secrets. Until then, use the keyboard's 🎤 to dictate.";

// iPhone Safari records audio/mp4; Chrome/Firefox webm or ogg.
export function audioExt(type: string): string | null {
  const t = String(type ?? "").toLowerCase().split(";")[0].trim();
  return ({
    "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a", "audio/aac": "m4a", "video/mp4": "mp4",
    "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/opus": "ogg",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  } as Record<string, string>)[t] ?? null;
}

export function checkAudio(size: number, type: string): string | null {
  if (!size) return "The recording is empty: hold the phone closer and try again.";
  if (size > MAX_AUDIO_BYTES) return `The recording is too big (${Math.round(size / 1048576)} MB, max 25 MB): keep it under 10 minutes.`;
  if (!audioExt(type)) return `Unsupported audio type ${type || "(none)"}.`;
  return null;
}

// The form each provider expects. `audio` is the uploaded Blob/File.
export function sttRequest(p: Provider, audio: Blob, type: string): { url: string; headers: Record<string, string>; form: FormData } {
  const name = `talk.${audioExt(type) ?? "m4a"}`;
  const form = new FormData();
  form.append("file", new Blob([audio], { type: type.split(";")[0] }), name);
  if (p.name === "openai") {
    form.append("model", p.model);
    form.append("prompt", STT_PROMPT);
    form.append("response_format", "json");
    return { url: OPENAI_STT_URL, headers: { Authorization: `Bearer ${p.key}` }, form };
  }
  form.append("model_id", p.model);
  form.append("tag_audio_events", "false");
  return { url: ELEVEN_STT_URL, headers: { "xi-api-key": p.key }, form };
}

// Both answer JSON with the words in `text`.
export function transcriptText(body: unknown): string {
  const t = (body as { text?: unknown })?.text;
  return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : "";
}

// The whole request after the owner check, with the provider and fetch
// passed in (tests use fakes). Returns status + JSON body.
export async function handleTranscribe(
  req: Request,
  deps: { provider: Provider | null; fetchFn: typeof fetch; log?: (...a: unknown[]) => void },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const type = req.headers.get("content-type") ?? "";
  const p = deps.provider;
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    const b = await req.json().catch(() => ({}));
    if ((b as any)?.check) return { status: 200, body: { provider: p?.name ?? null, model: p?.model ?? null } };
    return { status: 400, body: { error: "Send the recording as multipart form data (field \"audio\")." } };
  }
  if (!p) return { status: 400, body: { error: NO_PROVIDER, code: "no_stt" } };
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_AUDIO_BYTES + 1024 * 1024) return { status: 413, body: { error: "The recording is too big (max 25 MB): keep it under 10 minutes." } };
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) return { status: 400, body: { error: "No audio in the upload." } };
  const audioType = audio.type || String(form.get("type") ?? "");
  const bad = checkAudio(audio.size, audioType);
  if (bad) return { status: audio.size > MAX_AUDIO_BYTES ? 413 : 400, body: { error: bad } };

  const r = sttRequest(p, audio, audioType);
  const res = await deps.fetchFn(r.url, { method: "POST", headers: r.headers, body: r.form, signal: AbortSignal.timeout(120_000) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = body?.error?.message ?? body?.detail?.message ?? body?.detail ?? res.statusText;
    deps.log?.("transcribe:", p.name, res.status, why);
    return { status: 502, body: { error: `Speech-to-text (${p.name}) failed: ${res.status} ${typeof why === "string" ? why : ""}`.trim() } };
  }
  return { status: 200, body: { text: transcriptText(body), provider: p.name } };
}
