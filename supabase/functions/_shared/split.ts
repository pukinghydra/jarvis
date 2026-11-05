// deno-lint-ignore-file no-explicit-any
// "Split it" for the app: ask Claude for a first step + small steps and save
// them on the item.

import { askJson, hasClaude } from "./claude.ts";
import { HttpError, must, sb } from "./db.ts";
import { SPLIT_SCHEMA, SPLIT_SYSTEM, splitUser, validateSplit } from "./split-core.ts";

export async function splitItem(id: string) {
  if (!(await hasClaude())) throw new HttpError(400, "Split it needs the Claude API key (ANTHROPIC_API_KEY)");
  const item: any = must(await sb.from("items").select("id, title, notes, minutes").eq("id", id).maybeSingle(), "item");
  if (!item) throw new HttpError(404, "Item not found");
  const raw = await askJson<unknown>({ system: SPLIT_SYSTEM, user: splitUser(item), schema: SPLIT_SCHEMA, effort: "low", maxTokens: 2000 });
  const s = validateSplit(raw);
  if (!s) throw new HttpError(502, "Couldn't split it this time. Try again");
  const patch: Record<string, unknown> = { first_step: s.first_step, steps: s.steps };
  if (!item.minutes && s.minutes) patch.minutes = s.minutes;
  const saved = must(await sb.from("items").update(patch).eq("id", id).select("*").single(), "save split");
  return saved;
}
