// The app's Talk screen. Called with VIC's login; the owner is checked in
// code (verify_jwt off, see config.toml).
//   { action: "say", text, lang, source }  -> Claude answers and acts
//   { action: "history" }                  -> the current conversation
//   { action: "new_topic" }                -> start a fresh one
// No Claude API key: "say" saves the words as a note, like before.

import { CORS, errorText, json } from "../_shared/http.ts";
import { HttpError, requireOwner } from "../_shared/db.ts";
import { chatHistory, chatNewTopic, chatSay } from "../_shared/chat.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    await requireOwner(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "say");
    if (action === "history") return json(await chatHistory());
    if (action === "new_topic") return json(await chatNewTopic());
    if (action !== "say") throw new HttpError(400, `Unknown action ${action}`);
    const lang = typeof body.lang === "string" ? body.lang.slice(0, 10) : null;
    const source = body.source === "voice" ? "voice" : "app";
    return json(await chatSay(String(body.text ?? ""), lang, source));
  } catch (e) {
    return json({ error: errorText(e) }, e instanceof HttpError ? e.status : 500);
  }
});
