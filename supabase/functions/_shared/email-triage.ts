// deno-lint-ignore-file no-explicit-any
// AI email triage. ONLY runs when a Claude API key is set (hasClaude());
// without one Jarvis keeps the rule-only flags from email.ts.
//
// For each new email Claude says how important it is (urgent / important /
// normal / noise), sums it up in a line and lists what VIC must do. Jarvis
// then:
//  - creates items for those actions (source 'email', one per email+title),
//  - pushes urgent mail at once,
//  - for urgent/important mail that needs an answer, writes a reply DRAFT in
//    VIC's own style (style.ts), saves it in Outlook > Drafts (never sent:
//    there is no send permission), adds an INBOX item "Send reply to ..." and
//    pushes "Draft ready for ..." with what the draft says.
//
// Email text is untrusted: Claude gets no tools, only a JSON schema, and the
// prompts say instructions in emails are never followed. No link from an
// email ever reaches a push or an item (email-triage-core.ts strips them).

import { sb, must, claimOnce, getSetting } from "./db.ts";
import { askJson, hasClaude, model, triageModel } from "./claude.ts";
import { cleanupEmail, draftReply } from "./email.ts";
import { applyVintedRule, DEFAULT_MAIL_RULES, hardNoise } from "./mail-rules-core.ts";
import { push } from "./push.ts";
import { styleFor } from "./style.ts";
import { localDateStr, localTimeStr, weekdayName } from "./time.ts";
import { normalizeItem, type LaneRef } from "./items-input.ts";
import {
  DRAFT_SCHEMA, DRAFT_SYSTEM, MAX_DRAFTS_PER_RUN, TRIAGE_BATCH, TRIAGE_MAX_PER_RUN, TRIAGE_SCHEMA, TRIAGE_SYSTEM,
  actionKey, draftUser, shouldDraft, triageUser, urgentPush, validateDraft, validateTriage,
  type Draft, type Triage, type TriageEmail,
} from "./email-triage-core.ts";

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// Run tasks with at most `limit` at a time.
async function pool<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(xs.length);
  let next = 0;
  const worker = async () => {
    while (next < xs.length) {
      const i = next++;
      try { out[i] = { status: "fulfilled", value: await fn(xs[i]) }; } catch (e) { out[i] = { status: "rejected", reason: e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, worker));
  return out;
}

// One triage run at a time (the tick and "Check mail now" can overlap). A
// lock older than 4 minutes is stale (the function was stopped) and taken over.
async function lock(): Promise<boolean> {
  if (await claimOnce("triage-run")) return true;
  const { data } = await sb.from("sent_log").select("sent_at").eq("key", "triage-run").maybeSingle();
  if (data && Date.now() - Date.parse(data.sent_at) > 4 * 60_000) {
    await sb.from("sent_log").delete().eq("key", "triage-run");
    return await claimOnce("triage-run");
  }
  return false;
}
const unlock = () => sb.from("sent_log").delete().eq("key", "triage-run");

export async function triageNewEmails(now: Date, opts: { notify?: boolean } = {}) {
  if (!(await hasClaude())) return { skipped: "No Claude API key: rule flags only" };
  if (!(await lock())) return { skipped: "Already sorting mail" };
  try {
    return await triageLocked(now, opts.notify ?? true);
  } finally {
    await unlock();
  }
}

async function triageLocked(now: Date, notify: boolean) {
  // Drafts that failed last time (Claude or Outlook hiccup) are retried.
  const backlog = must(
    await sb.from("emails").select("id, graph_id, from_name, from_address, subject, received_at, body, status, draft_id, importance, summary, needs_reply, reply_language")
      .eq("status", "new").is("draft_id", null).eq("needs_reply", true).in("importance", ["urgent", "important"])
      .gte("triaged_at", new Date(now.getTime() - 3 * 86400_000).toISOString()).limit(MAX_DRAFTS_PER_RUN),
    "draft backlog",
  ) ?? [];

  const unsorted = must(
    await sb.from("emails").select("id, graph_id, from_name, from_address, subject, received_at, body, status, draft_id, bulk_reason, triage")
      .is("triaged_at", null).in("status", ["new", "drafted"]).order("received_at", { ascending: false }).limit(TRIAGE_MAX_PER_RUN),
    "untriaged emails",
  ) ?? [];
  if (!unsorted.length && !backlog.length) return { triaged: 0 };

  // VIC's rules: what code can decide for certain is decided here, without
  // a Claude call (mass mail, Vinted that isn't a return, ignored senders).
  const [rulesSetting, vips, ignore] = await Promise.all([
    getSetting<unknown>("mail_rules", DEFAULT_MAIL_RULES),
    getSetting<unknown>("vip_senders", []),
    getSetting<unknown>("mail_ignore", []),
  ]);
  const rules = typeof rulesSetting === "string" ? rulesSetting : DEFAULT_MAIL_RULES;
  let hard = 0;
  const pending: any[] = [];
  for (const e of unsorted as any[]) {
    const reason = hardNoise(e, { vips, ignore });
    if (!reason) { pending.push(e); continue; }
    must(await sb.from("emails").update({
      importance: "noise", summary: String(e.subject ?? "(no subject)").slice(0, 160), why: reason.slice(0, 120),
      needs_reply: false, reply_language: null, triaged_at: now.toISOString(), triage: { hard: reason },
    }).eq("id", e.id), "save rule triage");
    if (e.draft_id || e.triage) await cleanupEmail(e, "noise");
    hard++;
  }
  if (!pending.length && !backlog.length) return { triaged: hard, hard, urgent: 0, important: 0, noise: hard, items: 0, drafts: 0 };

  const nowLocal = `${weekdayName(localDateStr(now))} ${localDateStr(now)} ${localTimeStr(now)}`;
  const tModel = await triageModel();
  const batches = chunks(pending as any[], TRIAGE_BATCH);
  const results = await pool(batches, 6, async (batch) => {
    const asked: TriageEmail[] = batch.map((e) => ({
      id: e.id, from_name: e.from_name, from_address: e.from_address, subject: e.subject, received_at: e.received_at, body: e.body,
    }));
    const raw = await askJson<unknown>({ system: TRIAGE_SYSTEM, user: triageUser(asked, nowLocal, rules), schema: TRIAGE_SCHEMA, effort: "low", model: tModel, maxTokens: 16000 });
    return validateTriage(raw, asked.map((a) => a.id));
  });

  const triage = new Map<string, Triage>();
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") for (const [id, t] of r.value) triage.set(id, t);
    else errors.push(String((r.reason as Error)?.message ?? r.reason));
  }

  const lanes = (must(await sb.from("lanes").select("id, slug, name"), "lanes") ?? []) as LaneRef[];
  const byId = new Map((pending as any[]).map((e) => [e.id, e]));
  let itemsAdded = 0;
  const urgent: any[] = [];
  const toDraft: { email: any; t: Triage }[] = [];

  for (const [id, t0] of triage) {
    const email = byId.get(id);
    if (!email) continue;
    const t = applyVintedRule(t0, email, now);
    triage.set(id, t);
    must(await sb.from("emails").update({
      importance: t.importance, summary: t.summary, why: t.why, needs_reply: t.needs_reply,
      reply_language: t.reply_language, triaged_at: now.toISOString(),
      triage: { actions: t.actions, model: tModel, ...(t.vinted_return ? { vinted_return: true } : {}) },
    }).eq("id", id), "save triage");

    // Sorted again (rules changed): the new verdict decides Jarvis's own
    // open to-dos for this email, so the old ones go first.
    if (email.triage) must(await sb.from("items").delete().eq("email_id", id).eq("status", "open").eq("source", "email"), "replace email to-dos");
    if (t.importance === "noise" && (email.draft_id || email.triage)) await cleanupEmail(email, "noise");

    // Email has its own Mail tab now, so it no longer makes to-dos on its
    // own. The one exception: a Vinted return VIC must send (his rule).
    if (t.actions.length && t.vinted_return) {
      const existing = new Set(
        (must(await sb.from("items").select("title").eq("email_id", id), "email items") ?? []).map((r: any) => actionKey(id, r.title)),
      );
      for (const a of t.actions) {
        const key = actionKey(id, a.title);
        if (existing.has(key)) continue;
        const n = normalizeItem({ title: a.title, lane: a.lane, kind: a.remind_at || a.due_at ? "reminder" : "task", due_at: a.due_at, remind_at: a.remind_at, notes: `From email: ${t.summary}` }, lanes);
        const row = n.ok ? n.row : (normalizeItem({ title: a.title, lane: a.lane, notes: `From email: ${t.summary}` }, lanes) as any).row;
        if (!row) continue;
        const { error } = await sb.from("items").insert({ ...row, source: "email", email_id: id });
        if (!error) { itemsAdded++; existing.add(key); }
      }
    }
    if (t.importance === "urgent" && email.status === "new" && await claimOnce(`urgent-mail:${id}`).catch(() => false)) {
      urgent.push({ ...email, summary: t.summary });
    }
    if (shouldDraft(t, email)) toDraft.push({ email, t });
  }

  if (notify && urgent.length) {
    const p = urgentPush(urgent);
    await push({ ...p, url: "/?tab=mail", tag: urgent.length === 1 ? `urgent-${urgent[0].id}` : "urgent-mail" });
  }

  for (const e of backlog as any[]) {
    if (toDraft.some((d) => d.email.id === e.id)) continue;
    toDraft.push({ email: e, t: { id: e.id, importance: e.importance, summary: e.summary ?? "", why: "", needs_reply: true, reply_language: e.reply_language, actions: [] } });
  }
  const drafted = await pool(toDraft.slice(0, MAX_DRAFTS_PER_RUN), 4, ({ email, t }) => writeDraft(email, t, notify));
  for (const d of drafted) if (d.status === "rejected") errors.push(String((d.reason as Error)?.message ?? d.reason));

  return {
    triaged: triage.size + hard,
    hard,
    urgent: urgent.length,
    important: [...triage.values()].filter((t) => t.importance === "important").length,
    noise: [...triage.values()].filter((t) => t.importance === "noise").length + hard,
    items: itemsAdded,
    drafts: drafted.filter((d) => d.status === "fulfilled" && d.value).length,
    ...(errors.length ? { errors: errors.slice(0, 3) } : {}),
  };
}

// Write one reply draft in VIC's style and save it in Outlook (not sent).
async function writeDraft(email: any, t: Triage, notify: boolean): Promise<boolean> {
  if (!(await claimOnce(`draft:${email.id}`).catch(() => false))) return false;
  try {
    return await writeDraftClaimed(email, t, notify);
  } catch (e) {
    // Let a later run try again.
    await sb.from("sent_log").delete().eq("key", `draft:${email.id}`);
    throw e;
  }
}

async function writeDraftClaimed(email: any, t: Triage, notify: boolean): Promise<boolean> {
  const style = await styleFor(t.reply_language, email.subject, email.from_address).catch(() => "");
  const raw = await askJson<unknown>({
    system: DRAFT_SYSTEM,
    user: draftUser({ id: email.id, from_name: email.from_name, from_address: email.from_address, subject: email.subject, received_at: email.received_at, body: email.body }, t, style),
    schema: DRAFT_SCHEMA,
    effort: "medium",
    model: await model(),
    maxTokens: 8000,
  });
  const d: Draft | null = validateDraft(raw, t.reply_language);
  if (!d) return false;
  await draftReply(email.id, d.body, d.language, { source: "email", summary: d.summary_en ? `What it says: ${d.summary_en}` : undefined });
  // No push per draft: drafted mail waits in the Mail tab (fewer pushes).
  return true;
}
