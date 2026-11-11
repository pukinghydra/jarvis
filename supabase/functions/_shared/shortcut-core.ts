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

// A recording from the Shortcuts app ("Record Audio" → m4a). Its type can
// arrive empty or as application/octet-stream, so the file's first bytes
// decide: "ftyp" = MP4/M4A, "RIFF…WAVE" = WAV, "OggS" = Ogg, ID3/0xFFEx = MP3,
// 0x1A45DFA3 = WebM.
export async function guessAudioType(f: Blob, name = ""): Promise<string> {
  const t = (f.type || "").toLowerCase().split(";")[0].trim();
  if (t.startsWith("audio/") || t === "video/mp4" || t === "video/webm") return t;
  const b = new Uint8Array(await f.slice(0, 12).arrayBuffer());
  const s = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
  if (s(4, 4) === "ftyp") return "audio/mp4";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return "audio/wav";
  if (s(0, 4) === "OggS") return "audio/ogg";
  if (s(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ({ m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", webm: "audio/webm", caf: "" } as Record<string, string>)[ext] ?? "";
}

// The alarms the iPhone shortcut creates in the Clock app: Stockholm "HH:MM"
// strings, earliest first, no duplicates (a Clock alarm is a time of day).
export function alarmTimes(rows: { remind_at: string | null }[]): string[] {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const sorted = rows.filter((r) => r.remind_at).sort((a, b) => Date.parse(a.remind_at!) - Date.parse(b.remind_at!));
  return [...new Set(sorted.map((r) => f.format(new Date(r.remind_at!))))];
}
