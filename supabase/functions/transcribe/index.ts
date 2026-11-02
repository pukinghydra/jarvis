// Speech to text for the Talk screen. The app records audio and posts it
// here as multipart form data (field "audio"); this answers {text}.
// POST {check: true} (JSON) answers {provider} so the app knows whether to
// record or to fall back to the keyboard's dictation. Owner only; the
// request handling itself is in transcribe-core.ts (tested in Node).

import { CORS, errorText, json } from "../_shared/http.ts";
import { HttpError, requireOwner } from "../_shared/db.ts";
import { config } from "../_shared/config.ts";
import { chooseProvider, handleTranscribe } from "../_shared/transcribe-core.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    await requireOwner(req);
    const [openai, elevenlabs, model] = await Promise.all([config("OPENAI_API_KEY"), config("ELEVENLABS_API_KEY"), config("TRANSCRIBE_MODEL")]);
    const r = await handleTranscribe(req, { provider: chooseProvider({ openai, elevenlabs, model }), fetchFn: fetch, log: console.error });
    return json(r.body, r.status);
  } catch (e) {
    return json({ error: errorText(e) }, e instanceof HttpError ? e.status : 500);
  }
});
