// The iPhone "Jarvis" shortcut → Jarvis (the same chat brain and conversation
// as the Talk tab) → plain-text answer the shortcut shows on screen.
//   POST https://<project>.supabase.co/functions/v1/shortcut
//   header x-jarvis-key: <SHORTCUT_KEY>
//   body: multipart form with field "audio" (Shortcuts "Record Audio"):
//         transcribed here (OpenAI, Swedish and English, even mixed), or
//         {"text": "..."} / plain text (e.g. Apple's Dictate Text).
// SHORTCUT_KEY lives in app_secrets; Settings in the app shows it.
// verify_jwt off (see config.toml).

import { appSecret } from "../_shared/secrets.ts";
import { chatSay } from "../_shared/chat.ts";
import { config } from "../_shared/config.ts";
import { errorText } from "../_shared/http.ts";
import { NO_PROVIDER, checkAudio, chooseProvider, sttRequest, transcriptText } from "../_shared/transcribe-core.ts";
import { answerText, givenKey, guessAudioType, keyOk, readText } from "../_shared/shortcut-core.ts";

const textResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

class Say extends Error { constructor(msg: string, public status = 400) { super(msg); } }

async function heard(req: Request): Promise<string> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("multipart/form-data")) return await readText(req);
  const form = await req.formData();
  const f = form.get("audio") ?? form.get("file");
  if (!(f instanceof Blob)) throw new Say("No recording came with the request. In the shortcut, the form field must be a File called audio.");
  const audioType = await guessAudioType(f, (f as File).name ?? "");
  const bad = checkAudio(f.size, audioType);
  if (bad) { console.error("shortcut audio rejected:", JSON.stringify({ size: f.size, type: f.type, guessed: audioType })); throw new Say(bad); }
  const [openai, elevenlabs, model] = await Promise.all([config("OPENAI_API_KEY"), config("ELEVENLABS_API_KEY"), config("TRANSCRIBE_MODEL")]);
  const p = chooseProvider({ openai, elevenlabs, model });
  if (!p) throw new Say(NO_PROVIDER);
  const r = sttRequest(p, f, audioType);
  const res = await fetch(r.url, { method: "POST", headers: r.headers, body: r.form, signal: AbortSignal.timeout(120_000) });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = body?.error?.message ?? body?.detail?.message ?? body?.detail ?? res.statusText;
    throw new Say(`Speech-to-text failed: ${typeof why === "string" ? why : res.status}`, 502);
  }
  return transcriptText(body);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return textResponse("Use POST.", 405);
  const stored = await appSecret("SHORTCUT_KEY").catch(() => "");
  if (!keyOk(givenKey(req), stored)) return textResponse("Wrong or missing Jarvis key. Copy it again from Jarvis → Settings.", 401);
  try {
    const text = await heard(req);
    if (!text) return textResponse("I didn't catch anything. Try again.", 400);
    const r = await chatSay(text, null, "voice");
    return textResponse(`🗣 ${text}\n\n${answerText(r.reply_text, r.actions as { summary?: string; ok?: boolean }[])}`);
  } catch (e) {
    if (e instanceof Say) return textResponse(e.message, e.status);
    console.error("shortcut:", e);
    return textResponse(`Jarvis hit a problem: ${errorText(e)}`, 500);
  }
});
