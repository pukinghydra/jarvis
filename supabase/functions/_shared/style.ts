// deno-lint-ignore-file no-explicit-any
// Learn how VIC writes from his Sent Items, so drafts sound like him.
// Only runs with a Claude API key. The guide is stored in settings
// (writing_style) where VIC can read and edit it in the app; his examples go
// to the service-only table style_examples.

import { sb, must, getSetting } from "./db.ts";
import { askJson, hasClaude, model } from "./claude.ts";
import { sentItems } from "./graph.ts";
import {
  STYLE_SCHEMA, STYLE_SYSTEM, canRebuildStyle, cleanSent, domainOf, pickExamples,
  styleBlock, styleUser, validateStyle, type StyleExample, type WritingStyle,
} from "./style-core.ts";

export async function getStyle(): Promise<WritingStyle | null> {
  const s = await getSetting<WritingStyle | null>("writing_style", null);
  return s && typeof s === "object" ? s : null;
}

// Rebuild the guide from the last ~60 sent emails. The weekly run respects
// VIC's edits (no overwrite within 7 days); the "Relearn my style" button
// passes force.
export async function rebuildStyle(now: Date, opts: { force?: boolean } = {}) {
  if (!(await hasClaude())) return { skipped: "No Claude API key" };
  const editedAt = await getSetting<string | null>("writing_style_edited_at", null);
  if (!opts.force && !canRebuildStyle(editedAt, now)) return { skipped: `You edited the style on ${String(editedAt).slice(0, 10)}; kept for 7 days` };

  const sent = await sentItems(60);
  const cleaned = sent
    .map((m) => ({ ...m, clean: cleanSent(m.body) }))
    .filter((m): m is typeof m & { clean: string } => !!m.clean);
  if (cleaned.length < 3) return { skipped: `Only ${cleaned.length} usable sent emails; need at least 3` };

  const raw = await askJson<unknown>({
    system: STYLE_SYSTEM,
    user: styleUser(cleaned.map((m, index) => ({ index, subject: m.subject, body: m.clean }))),
    schema: STYLE_SCHEMA,
    effort: "medium",
    model: await model(),
  });
  const v = validateStyle(raw, cleaned.length);
  if (!v.sv && !v.en) return { skipped: "Claude found no clear style in the sent emails" };

  const style: WritingStyle = { ...(v.sv ? { sv: v.sv } : {}), ...(v.en ? { en: v.en } : {}), built_at: now.toISOString(), samples: cleaned.length };
  must(await sb.from("settings").upsert({ key: "writing_style", value: style, updated_at: now.toISOString() }), "save style");
  if (opts.force) await sb.from("settings").delete().eq("key", "writing_style_edited_at");

  // Examples: VIC's own cleaned text only (never Claude's rewrite, never
  // anyone else's words).
  const rows = v.examples.map((e) => {
    const m = cleaned[e.index];
    return { language: e.language, subject: m.subject, domain: domainOf(m.to_address), body: m.clean, sent_at: m.sent_at };
  });
  must(await sb.from("style_examples").delete().gte("created_at", "1970-01-01"), "clear examples");
  if (rows.length) must(await sb.from("style_examples").insert(rows), "save examples");
  return { languages: [v.sv ? "sv" : null, v.en ? "en" : null].filter(Boolean), samples: cleaned.length, examples: rows.length };
}

// The style part of a draft prompt for one email.
export async function styleFor(language: string | null, subject: string | null, fromAddress: string | null): Promise<string> {
  const [style, ex] = await Promise.all([
    getStyle(),
    sb.from("style_examples").select("language, subject, domain, body, sent_at").limit(40),
  ]);
  const examples = pickExamples((ex.data ?? []) as StyleExample[], language, subject, domainOf(fromAddress), 3);
  return styleBlock(style, language, examples);
}
