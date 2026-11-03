// The iPhone "Jarvis Talk" shortcut, the pure part (Node tests run it).
// The shortcut sends Apple's dictation as text with VIC's shortcut key; the
// answer goes back as plain text so Shortcuts can show it as it is.

import { timingSafeEqual } from "./crypto.ts";

export const MAX_TEXT = 4000;

// The key may come as header x-jarvis-key, "Authorization: Bearer <key>" or
// ?key= in the URL (whatever is easiest to set up in Shortcuts).
export function givenKey(req: Request): string {
  const h = req.headers.get("x-jarvis-key") ?? "";
  if (h.trim()) return h.trim();
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  return (new URL(req.url).searchParams.get("key") ?? "").trim();
}

export function keyOk(given: string, stored: string): boolean {
  return stored.length >= 32 && given.length > 0 && timingSafeEqual(given, stored);
}

// Body: JSON {text}, a form field "text", or the plain text itself.
export async function readText(req: Request): Promise<string> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  let text = "";
  if (type.includes("application/json")) {
    const b = await req.json().catch(() => ({}));
    text = typeof (b as any)?.text === "string" ? (b as any).text : "";
  } else if (type.includes("form")) {
    const f = await req.formData().catch(() => null);
    const v = f?.get("text");
    text = typeof v === "string" ? v : "";
  } else {
    text = await req.text().catch(() => "");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

// What the iPhone shows: the answer, then one line per thing Jarvis did.
export function answerText(reply: string, actions: { summary?: string; ok?: boolean }[] = []): string {
  const done = actions.filter((a) => a.summary).map((a) => `${a.ok === false ? "✗" : "✓"} ${a.summary}`);
  return [reply.trim() || "Done.", ...(done.length ? ["", ...done] : [])].join("\n");
}
