// deno-lint-ignore-file no-explicit-any
// Hotmail without AI: fetch new mail, store it as plain text, flag it by
// rules. Claude (in the Claude app) reads it through the MCP connector and
// writes reply drafts with draft_reply. Nothing here ever sends email.

import { sb, must, getSetting, HttpError } from "./db.ts";
import { accessToken, createReplyDraft, inboxSince } from "./graph.ts";
import { cleanBody, flagEmail } from "./email-rules.ts";
import { push } from "./push.ts";

export async function scanEmails(now: Date, opts: { notify?: boolean } = {}) {
  if (!(await accessToken().catch(() => null))) return { skipped: "Hotmail not connected" };
  const since = new Date(now.getTime() - 26 * 3600_000);
  const messages = await inboxSince(since, 50);
  if (!messages.length) return { fetched: 0, new: 0, flagged: 0 };

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
  return { fetched: messages.length, new: rows.length, flagged: flagged.length };
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
export async function draftReply(ref: string, body: string, language: string | null) {
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
  const { data: lane } = await sb.from("lanes").select("id").eq("slug", "inbox").maybeSingle();
  const sender = email.from_name || email.from_address || "sender";
  const remindAt = new Date(Date.now() + 2 * 3600_000).toISOString();
  const item = must(
    await sb.from("items").insert({
      lane_id: lane?.id ?? null, kind: "task", source: "mcp", email_id: email.id,
      title: `Send reply to ${sender}: ${email.subject ?? "(no subject)"}`.slice(0, 200),
      notes: `Draft${language ? ` (${language})` : ""} saved in Outlook > Drafts:\n\n${text}`.slice(0, 4000),
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
