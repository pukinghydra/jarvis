// deno-lint-ignore-file no-explicit-any
// The web app's mic/text capture. Always saves the note first.
//  - No Claude API key (the normal setup): the note stays "unsorted"; VIC
//    asks Claude in the Claude app to sort it (MCP tools unsorted/sort_note).
//  - Key set: Claude sorts it into items straight away.

import { askJson, hasClaude } from "./claude.ts";
import { sb, must } from "./db.ts";
import { captureSchema, captureSystem, captureUser, type Lane, type Parsed, toRows } from "./capture-core.ts";

export type CaptureResult = { capture_id: string; mode: "unsorted" | "parsed"; reply: string; items: any[] };

export async function capture(text: string, opts: { lang?: string | null; source: "app" | "voice" }): Promise<CaptureResult> {
  const clean = (text ?? "").trim();
  if (!clean) throw new Error("Nothing to save: the note was empty");
  const sv = (opts.lang ?? "").startsWith("sv");

  const cap = must(
    await sb.from("captures").insert({ text: clean.slice(0, 8000), lang: opts.lang ?? null, source: opts.source, status: "unsorted" }).select("id, short_id").single(),
    "save note",
  ) as { id: string; short_id: string };

  const unsortedReply = sv ? "Sparat som anteckning. Säg \"sortera mina anteckningar\" i Claude." : "Saved as a note. Say \"sort my notes\" in Claude.";
  if (!hasClaude()) return { capture_id: cap.id, mode: "unsorted", reply: unsortedReply, items: [] };

  const now = new Date();
  const lanes = (must(await sb.from("lanes").select("id, slug, name, description").order("sort"), "lanes") ?? []) as Lane[];
  let parsed: Parsed;
  try {
    parsed = await askJson<Parsed>({
      system: captureSystem(lanes),
      user: captureUser(clean, now, opts.lang ?? null),
      schema: captureSchema(lanes.map((l) => l.slug)),
      effort: "low",
    });
  } catch (e) {
    // Claude failed: the note is safe and stays unsorted.
    await sb.from("captures").update({ result: { error: String((e as Error).message ?? e) } }).eq("id", cap.id);
    return { capture_id: cap.id, mode: "unsorted", reply: unsortedReply, items: [] };
  }

  const rows = toRows(parsed, lanes, now).map((r) => ({ ...r, source: opts.source, capture_id: cap.id }));
  let items: any[] = [];
  if (rows.length) {
    items = must(
      await sb.from("items").insert(rows).select("id, short_id, lane_id, kind, title, notes, due_at, all_day, remind_at, recur, proof_type, proof_domains, location"),
      "save items",
    ) ?? [];
  }
  await sb.from("captures").update({
    reply: parsed.reply, result: parsed as any,
    status: items.length ? "parsed" : "unsorted",
    sorted_at: items.length ? new Date().toISOString() : null,
  }).eq("id", cap.id);
  return { capture_id: cap.id, mode: items.length ? "parsed" : "unsorted", reply: items.length ? parsed.reply : unsortedReply, items };
}
