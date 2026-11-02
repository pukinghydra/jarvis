// The web app's mic button / text box. Called with VIC's login; the owner
// is checked in code (verify_jwt off, see config.toml). Saves the note;
// sorts it into items only if a Claude API key is set.

import { CORS, errorText, json } from "../_shared/http.ts";
import { HttpError, requireOwner } from "../_shared/db.ts";
import { capture } from "../_shared/capture.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    await requireOwner(req);
    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "");
    const lang = typeof body.lang === "string" ? body.lang.slice(0, 10) : null;
    const source = body.source === "voice" ? "voice" : "app";
    return json(await capture(text, { lang, source }));
  } catch (e) {
    return json({ error: errorText(e) }, e instanceof HttpError ? e.status : 500);
  }
});
