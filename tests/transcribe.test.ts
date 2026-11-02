import { suite, eq, ok } from "./t.ts";
import {
  ELEVEN_STT_MODEL, ELEVEN_STT_URL, MAX_AUDIO_BYTES, NO_PROVIDER, OPENAI_STT_MODEL, OPENAI_STT_URL, STT_PROMPT,
  audioExt, checkAudio, chooseProvider, handleTranscribe, sttRequest, transcriptText,
} from "../supabase/functions/_shared/transcribe-core.ts";

const { test, run } = suite();
export { run };

test("provider: OpenAI first, then ElevenLabs, else none; model override per provider", () => {
  eq(chooseProvider({}), null);
  eq(chooseProvider({ openai: "  ", elevenlabs: "" }), null);
  eq(chooseProvider({ openai: "sk-1", elevenlabs: "el-1" }), { name: "openai", key: "sk-1", model: OPENAI_STT_MODEL });
  eq(chooseProvider({ elevenlabs: "el-1" }), { name: "elevenlabs", key: "el-1", model: ELEVEN_STT_MODEL });
  eq(chooseProvider({ openai: "sk", model: "gpt-4o-mini-transcribe" })?.model, "gpt-4o-mini-transcribe");
  eq(chooseProvider({ openai: "sk", model: "scribe_v2" })?.model, OPENAI_STT_MODEL, "scribe model is not used for OpenAI");
  eq(chooseProvider({ elevenlabs: "el", model: "gpt-4o-transcribe" })?.model, ELEVEN_STT_MODEL);
});

test("audio types: iPhone mp4, webm, ogg, mp3, wav; others refused", () => {
  eq(audioExt("audio/mp4"), "m4a");
  eq(audioExt("audio/webm;codecs=opus"), "webm");
  eq(audioExt("audio/ogg; codecs=opus"), "ogg");
  eq(audioExt("audio/mpeg"), "mp3");
  eq(audioExt("audio/wav"), "wav");
  eq(audioExt("text/plain"), null);
  eq(audioExt(""), null);
});

test("size limit: empty and over 25 MB refused", () => {
  ok(checkAudio(0, "audio/mp4")?.includes("empty"));
  eq(checkAudio(1000, "audio/mp4"), null);
  eq(checkAudio(MAX_AUDIO_BYTES, "audio/webm"), null);
  ok(checkAudio(MAX_AUDIO_BYTES + 1, "audio/mp4")?.includes("max 25 MB"));
  ok(checkAudio(1000, "image/png")?.includes("Unsupported"));
});

test("multipart: OpenAI gets file, model, prompt, json; no language forced", async () => {
  const p = chooseProvider({ openai: "sk-test" })!;
  const r = sttRequest(p, new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" }), "audio/mp4");
  eq(r.url, OPENAI_STT_URL);
  eq(r.headers, { Authorization: "Bearer sk-test" });
  const f = r.form.get("file") as File;
  eq(f.name, "talk.m4a");
  eq(f.size, 3);
  eq(r.form.get("model"), OPENAI_STT_MODEL);
  eq(r.form.get("prompt"), STT_PROMPT);
  eq(r.form.get("response_format"), "json");
  eq(r.form.get("language"), null, "language not forced (Swedish/English mix)");
  for (const w of ["Thriftin", "Vinted", "Richie", "Zettle", "Shopify", "moms", "Fortnox"]) ok(STT_PROMPT.includes(w), `prompt has ${w}`);
});

test("multipart: ElevenLabs gets file + model_id with xi-api-key", () => {
  const p = chooseProvider({ elevenlabs: "el-test" })!;
  const r = sttRequest(p, new Blob([new Uint8Array(5)], { type: "audio/webm" }), "audio/webm;codecs=opus");
  eq(r.url, ELEVEN_STT_URL);
  eq(r.headers, { "xi-api-key": "el-test" });
  eq((r.form.get("file") as File).name, "talk.webm");
  eq(r.form.get("model_id"), ELEVEN_STT_MODEL);
  eq(r.form.get("model"), null);
});

test("transcript text is read from {text} and tidied", () => {
  eq(transcriptText({ text: "  hej   Jarvis\nlägg till  " }), "hej Jarvis lägg till");
  eq(transcriptText({}), "");
  eq(transcriptText(null), "");
});

const upload = (bytes: number, type = "audio/mp4") => {
  const fd = new FormData();
  fd.append("audio", new Blob([new Uint8Array(bytes)], { type }), "talk.m4a");
  return new Request("https://x/functions/v1/transcribe", { method: "POST", body: fd });
};
const noFetch = (async () => { throw new Error("fetch must not be called"); }) as unknown as typeof fetch;

test("handler: check answers the provider (or null)", async () => {
  const req = () => new Request("https://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ check: true }) });
  eq((await handleTranscribe(req(), { provider: null, fetchFn: noFetch })).body, { provider: null, model: null });
  eq((await handleTranscribe(req(), { provider: chooseProvider({ openai: "k" }), fetchFn: noFetch })).body.provider, "openai");
});

test("handler: no key -> 400 with a clear message, nothing sent anywhere", async () => {
  const r = await handleTranscribe(upload(100), { provider: null, fetchFn: noFetch });
  eq(r.status, 400);
  eq(r.body.error, NO_PROVIDER);
  ok(String(r.body.error).includes("OPENAI_API_KEY"));
  eq(r.body.code, "no_stt");
});

test("handler: empty, wrong type and missing audio refused before any upload", async () => {
  const p = chooseProvider({ openai: "k" });
  eq((await handleTranscribe(upload(0), { provider: p, fetchFn: noFetch })).status, 400);
  eq((await handleTranscribe(upload(10, "text/plain"), { provider: p, fetchFn: noFetch })).status, 400);
  const fd = new FormData();
  fd.append("note", "x");
  eq((await handleTranscribe(new Request("https://x", { method: "POST", body: fd }), { provider: p, fetchFn: noFetch })).body.error, "No audio in the upload.");
  const big = new Request("https://x", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_AUDIO_BYTES + 2 * 1048576) }, body: "x" });
  eq((await handleTranscribe(big, { provider: p, fetchFn: noFetch })).status, 413);
});

test("handler: sends to the provider and returns the text; provider errors become 502", async () => {
  const p = chooseProvider({ openai: "sk-9" });
  let seen: any = null;
  const okFetch = (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ text: "Påminn mig att ringa Richie" }), { status: 200 }); }) as unknown as typeof fetch;
  const r = await handleTranscribe(upload(2048), { provider: p, fetchFn: okFetch });
  eq(r, { status: 200, body: { text: "Påminn mig att ringa Richie", provider: "openai" } });
  eq(seen.url, OPENAI_STT_URL);
  eq(seen.init.headers.Authorization, "Bearer sk-9");
  eq((seen.init.body as FormData).get("model"), OPENAI_STT_MODEL);
  const badFetch = (async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
  const logs: unknown[][] = [];
  const e = await handleTranscribe(upload(2048), { provider: p, fetchFn: badFetch, log: (...a) => logs.push(a) });
  eq(e.status, 502);
  ok(String(e.body.error).includes("Invalid API key"));
  eq(logs.length, 1);
});
