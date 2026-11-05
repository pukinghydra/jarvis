// deno-lint-ignore-file no-explicit-any
// Hotmail without AI: fetch new mail, store it as plain text, flag it by
// rules. Claude (in the Claude app) reads it through the MCP connector and
// writes reply drafts with draft_reply. Nothing here ever sends email.

import { sb, must, getSetting, HttpError } from "./db.ts";
import { accessToken, createReplyDraft, deleteMessage, inboxSince, inboxState, messageMeta, searchMailbox, sentSince } from "./graph.ts";
import { cleanBody, flagEmail } from "./email-rules.ts";
import { answeredState, bulkHeaders, cleanupPlan, deleteJarvisDraft } from "./mail-rules-core.ts";
import { push } from "./push.ts";

export async function scanEmails(now: Date, opts: { notify?: boolean } = {}) {
  if (!(await accessToken().catch(() => null))) return { skipped: "Hotmail not connected" };
  const since = new Date(now.getTime() - 26 * 3600_000);
  const messages = await inboxSince(since, 50);
  if (!messages.length) {
    const recheck = await recheckOpen(now).catch((e) => ({ error: String((e as Error)?.message ?? e) }));
    return { fetched: 0, new: 0, flagged: 0, recheck };
  }

  // Already stored? (look up by time, not by a long list of ids in the URL)
  const oldest = messages.reduce((t, m) => Math.min(t, Date.parse(m.received_at)), Date.now());
  const known = new Set(
    (must(await sb.from("emails").select("graph_id").gte("received_at", new Date(oldest - 3600_000).toISOString()), "known emails") ?? [])
      .map((r: any) => r.graph_id),
  );
  const vips = await getSetting<string[]>("vip_senders", []);
  const extra = await getSetting<string[]>("email_keywords_extra", []);

  const rows = messages.filter((m) => !known.has(m.id)).map((m) => {
    const body = cleanBody(m.body);
    const reasons = flagEmail({ from_address: m.from_address, from_name: m.from_name, subject: m.subject, body }, Array.isArray(vips) ? vips : [], Array.isArray(extra) ? extra : []);
    return {
      graph_id: m.id, received_at: m.received_at, from_name: m.from_name, from_address: m.from_address,
      subject: m.subject, preview: cleanBody(m.preview, 300), body, flagged: reasons.length > 0, flag_reasons: reasons,
      conversation_id: m.conversation_id, bulk_reason: bulkHeaders(m.headers), last_verb: m.last_verb,
      internet_message_id: m.internet_message_id,
    };
  });
  if (rows.length) {
    must(await sb.from("emails").upsert(rows, { onConflict: "graph_id", ignoreDuplicates: true }), "save emails");
  }
  const flagged = rows.filter((r) => r.flagged);
  if (opts.notify && flagged.length) {
    const who = flagged.slice(0, 3).map((r) => r.from_name || r.from_address || "?").join(", ");
    await push({
      title: `${flagged.length} email${flagged.length > 1 ? "s" : ""} to look at`,
      body: `${who}${flagged.length > 3 ? " …" : ""}. Open Claude and say: check my mail`,
      url: "/?tab=today",
      tag: "email",
    });
  }
  const recheck = await recheckOpen(now).catch((e) => ({ error: String((e as Error)?.message ?? e) }));
  return { fetched: messages.length, new: rows.length, flagged: flagged.length, recheck };
}

// Every scan: look at all open emails again. VIC may have answered one
// (from his phone, hours later): then it is handled, Jarvis's own draft for
// it is deleted (only while still a draft) and its "Send reply" item closed.
// Also fills in conversation ids, mass-mail headers and the last verb for
// emails stored before Jarvis read those.
export async function recheckOpen(now: Date) {
  const open = must(
    await sb.from("emails").select("id, graph_id, conversation_id, received_at, status, draft_id, bulk_reason, last_verb, subject, from_address, internet_message_id")
      .in("status", ["new", "drafted"]).gte("received_at", new Date(now.getTime() - 30 * 86400_000).toISOString())
      .order("received_at", { ascending: true }).limit(300),
    "open emails",
  ) ?? [];
  if (!open.length) return { checked: 0, answered: 0, updated: 0 };
  const since = new Date(Date.parse((open[0] as any).received_at) - 60_000);
  const [state, sent] = await Promise.all([inboxState(since), sentSince(since)]);
  let answered = 0, updated = 0;
  for (const e of open as any[]) {
    const s = state.get(e.graph_id);
    const patch: Record<string, unknown> = {};
    if (s?.conversation_id && s.conversation_id !== e.conversation_id) patch.conversation_id = s.conversation_id;
    if (s?.internet_message_id && !e.internet_message_id) patch.internet_message_id = s.internet_message_id;
    if (s && s.last_verb !== null && s.last_verb !== e.last_verb) patch.last_verb = s.last_verb;
    if (s?.headers && !e.bulk_reason) {
      const b = bulkHeaders(s.headers);
      if (b) patch.bulk_reason = b;
    }
    if (Object.keys(patch).length) {
      must(await sb.from("emails").update(patch).eq("id", e.id), "update email state");
      updated++;
    }
    const ans = answeredState(
      { conversation_id: (patch.conversation_id as string) ?? e.conversation_id, received_at: e.received_at, subject: e.subject, from_address: e.from_address },
      s ? s.last_verb : e.last_verb,
      sent,
    );
    if (ans) {
      await cleanupEmail(e, "answered", ans);
      answered++;
    }
  }
  return { checked: open.length, answered, updated };
}

// Tidy up after an email turned out answered, or noise:
//  - Jarvis's own draft is deleted, but only while it is still a draft
//    (only drafts Jarvis made have their id stored here);
//  - answered: its "Send reply to ..." item is closed and the email handled;
//  - noise: the to-dos Jarvis made from it and its "Send reply" item go.
export async function cleanupEmail(email: { id: string; draft_id: string | null; status: string }, outcome: "answered" | "noise", reason: string = outcome) {
  const plan = cleanupPlan(email, outcome);
  let draft: string = "none";
  if (plan.deleteDraft) {
    draft = await deleteJarvisDraft(email.draft_id, { get: messageMeta, del: deleteMessage }).catch((e) => `error: ${(e as Error).message}`);
  }
  const now = new Date().toISOString();
  if (outcome === "answered") {
    must(await sb.from("items").update({ status: "done", done_at: now }).eq("email_id", email.id).eq("status", "open").ilike("title", "Send reply to%"), "close send-reply item");
    must(await sb.from("emails").update({
      status: "handled", handled_at: now, handled_reason: reason, answered_at: now,
      ...(draft === "deleted" ? { draft_deleted_at: now } : {}),
    }).eq("id", email.id), "mark answered");
  } else {
    must(await sb.from("items").delete().eq("email_id", email.id).eq("status", "open").ilike("title", "Send reply to%"), "remove send-reply item");
    if (plan.deleteAutoItems) must(await sb.from("items").delete().eq("email_id", email.id).eq("status", "open").eq("source", "email"), "remove email to-dos");
    if (draft === "deleted" || draft === "gone") {
      must(await sb.from("emails").update({ status: email.status === "drafted" ? "new" : email.status, draft_deleted_at: now }).eq("id", email.id), "draft removed");
    }
  }
  return { draft };
}

// Find emails by words (sender, address, subject, text) among ALL emails,
// handled or not. Nothing stored matches -> search Hotmail itself (all
// folders) and keep what it finds, marked handled so it never lands in the
// Mail tab, so it gets an id VIC can link to a to-do.
export async function findEmails(query: string, limit = 10): Promise<any[]> {
  const words = String(query ?? "").replace(/[%_,()\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!words) return [];
  const cols = "id, short_id, received_at, from_name, from_address, subject, body, status, importance, summary, draft_text, draft_language, internet_message_id";
  const seen = new Map<string, any>();
  const look = async (field: string, w: string) => {
    for (const r of must(await sb.from("emails").select(cols).ilike(field, `%${w}%`).order("received_at", { ascending: false }).limit(limit), "find emails") ?? []) seen.set(r.id, r);
  };
  for (const f of ["from_name", "from_address", "subject"]) await look(f, words);
  if (!seen.size) for (const w of words.split(" ").filter((x) => x.length >= 3).slice(0, 4)) for (const f of ["from_name", "from_address", "subject"]) await look(f, w);
  if (!seen.size) await look("body", words);
  if (!seen.size) {
    const found = await searchMailbox(words, limit).catch(() => []);
    if (found.length) {
      const now = new Date().toISOString();
      const rows = found.map((m) => ({
        graph_id: m.id, received_at: m.received_at, from_name: m.from_name, from_address: m.from_address, subject: m.subject,
        preview: cleanBody(m.preview, 300), body: cleanBody(m.body), conversation_id: m.conversation_id, internet_message_id: m.internet_message_id,
        status: "handled", handled_at: now, handled_reason: "found by search",
      }));
      must(await sb.from("emails").upsert(rows, { onConflict: "graph_id", ignoreDuplicates: true }), "save found emails");
      for (const r of must(await sb.from("emails").select(cols).in("graph_id", found.map((m) => m.id)), "found emails") ?? []) seen.set(r.id, r);
    }
  }
  return [...seen.values()].sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)).slice(0, limit);
}

export async function resolveEmail(ref: string): Promise<any> {
  const r = (ref ?? "").trim().toLowerCase();
  if (!/^[0-9a-f-]{8,36}$/.test(r)) throw new HttpError(400, "Give the email id from the emails tool (8 characters is enough)");
  const q = sb.from("emails").select("*");
  const rows = must(await (r.length === 36 ? q.eq("id", r) : q.eq("short_id", r.slice(0, 8))).limit(2), "find email") ?? [];
  if (!rows.length) throw new HttpError(404, `No email ${ref}`);
  if (rows.length > 1) throw new HttpError(409, `More than one email starts with ${ref}; use the full id`);
  return rows[0];
}

// Save a reply draft in Outlook to the ORIGINAL sender only (createReply has
// no recipient field), plus an INBOX item to send it, reminding in 2 hours.
export async function draftReply(ref: string, body: string, language: string | null, opts: { source?: "mcp" | "email"; summary?: string } = {}) {
  const email = await resolveEmail(ref);
  const text = String(body ?? "").trim();
  if (text.length < 2) throw new HttpError(422, "The reply body is empty");
  if (text.length > 10000) throw new HttpError(422, "The reply is too long (max 10 000 characters)");
  const draft = await createReplyDraft(email.graph_id, text);
  must(
    await sb.from("emails").update({
      status: "drafted", draft_id: draft.id, draft_text: text, draft_language: language || null, draft_web_link: draft.webLink,
    }).eq("id", email.id),
    "save draft",
  );
  // Jarvis's own drafts wait in the Mail tab; only a draft VIC asked for
  // (Claude app) also gets a "Send reply" to-do with a reminder.
  if (opts.source === "email") return { email_id: email.short_id, draft_id: draft.id, item_id: null, remind_at: null, to: email.from_address, subject: email.subject };
  const { data: lane } = await sb.from("lanes").select("id").eq("slug", "inbox").maybeSingle();
  const sender = email.from_name || email.from_address || "sender";
  const remindAt = new Date(Date.now() + 2 * 3600_000).toISOString();
  const item = must(
    await sb.from("items").insert({
      lane_id: lane?.id ?? null, kind: "task", source: opts.source ?? "mcp", email_id: email.id,
      title: `Send reply to ${sender}: ${email.subject ?? "(no subject)"}`.slice(0, 200),
      notes: `${opts.summary ? `${opts.summary}\n\n` : ""}Draft${language ? ` (${language})` : ""} saved in Outlook > Drafts:\n\n${text}`.slice(0, 4000),
      remind_at: remindAt,
    }).select("id, short_id").single(),
    "add send-reply item",
  ) as any;
  return { email_id: email.short_id, draft_id: draft.id, item_id: item.short_id, remind_at: remindAt, to: email.from_address, subject: email.subject };
}

export async function markEmailHandled(ref: string) {
  const email = await resolveEmail(ref);
  must(await sb.from("emails").update({ status: "handled", handled_at: new Date().toISOString() }).eq("id", email.id), "mark handled");
  return { email_id: email.short_id, subject: email.subject };
}
