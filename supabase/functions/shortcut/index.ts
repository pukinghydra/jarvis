// The iPhone "Jarvis Talk" shortcut: Apple dictation → text → Jarvis (the
// same chat brain as the Talk tab, same conversation) → plain-text answer.
//   POST https://<project>.supabase.co/functions/v1/shortcut
//   header x-jarvis-key: <SHORTCUT_KEY>   body: {"text": "..."} or plain text
// SHORTCUT_KEY lives in app_secrets (made by a migration); Settings in the
// app shows it with a copy button. verify_jwt off (see config.toml).

import { appSecret } from "../_shared/secrets.ts";
import { chatSay } from "../_shared/chat.ts";
import { errorText } from "../_shared/http.ts";
import { answerText, givenKey, keyOk, readText } from "../_shared/shortcut-core.ts";

const textResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return textResponse("Use POST.", 405);
  const stored = await appSecret("SHORTCUT_KEY").catch(() => "");
  if (!keyOk(givenKey(req), stored)) return textResponse("Wrong or missing Jarvis key. Copy it again from Jarvis → Settings.", 401);
  try {
    const text = await readText(req);
    if (!text) return textResponse("I didn't catch anything. Try again.", 400);
    const r = await chatSay(text, null, "voice");
    return textResponse(answerText(r.reply_text, r.actions as { summary?: string; ok?: boolean }[]));
  } catch (e) {
    console.error("shortcut:", e);
    return textResponse(`Jarvis hit a problem: ${errorText(e)}`, 500);
  }
});
