// VIC's mail rules: the parts code decides for certain, so no Claude call is
// spent on them. Pure (no network, no Deno), so Node tests run all of it.
//
//  1. Mass / copy-paste mail is noise: List-Unsubscribe / List-Id /
//     Precedence: bulk|list|junk / Auto-Submitted headers, or a mass-sender
//     address (noreply@, newsletter@, info@, marketing@, notifications@ ...).
//     Kept for Claude instead (not certain enough): VIP senders, and mass
//     mail that mentions money or an authority (Skatteverket, Kronofogden,
//     a bill), because a templated "you have a new message" can still matter.
//  2. Vinted is noise, except a return VIC has to send: Vinted mail with no
//     sign of a return is noise right here; with one, Claude decides return
//     vs not, and code turns a return into one THRIFTIN item.
//  3. Already answered: VIC replied (or forwarded) after it arrived, read
//     from Outlook's last-verb property (0x1081) or a Sent Items message in
//     the same conversation sent after it. Answered mail is handled: never
//     listed as important, no draft; Jarvis's own draft for it is deleted
//     (only if it is still a draft) and its "Send reply" item is closed.
//
// The rules are also text in settings.mail_rules (VIC edits them in the app
// or by voice); that text goes to Claude as VIC's own instructions.

import { vipMatch } from "./email-rules.ts";
import { addDays, localDateStr, localTimeStr, localToUtc, parseDateStr } from "./time.ts";

export const DEFAULT_MAIL_RULES = `1. Massutskick är brus: nyhetsbrev, reklam, mallade notiser och allt som skickas till många (copy-paste). / Mass or copy-paste mail (newsletters, marketing, templated notifications) is noise.
2. Vinted: allt från Vinted är brus UTOM en retur jag måste skicka (returförfrågan, "retur", "skicka tillbaka", returetikett, sista dag för retur). Den är viktig och blir en uppgift "Skicka Vinted-retur: <vara>" med deadline. / Everything from Vinted is noise except a return I have to send.
3. Redan besvarat: har jag svarat i samma tråd efter att mejlet kom är det klart. Visa det inte som viktigt och skriv inget utkast. / If I already replied in the thread after it arrived, it is handled.`;

export type Header = { name?: unknown; value?: unknown };

const BULK_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|noreply|newsletters?|news|nyhetsbrev|info|marketing|notifications?|notify|notiser|mailer|campaigns?|promo|promotions?|utskick)$/i;

// The mass-sender part of an address ("noreply+abc@x.se" -> "noreply@"), or null.
export function bulkSender(address: string | null | undefined): string | null {
  const a = String(address ?? "").trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 1) return null;
  const local = a.slice(0, at).split("+")[0];
  return BULK_LOCAL.test(local) ? `${local}@` : null;
}

// Mass-mail headers. Returns why, or null.
export function bulkHeaders(headers: Header[] | null | undefined): string | null {
  const h = new Map<string, string>();
  for (const x of Array.isArray(headers) ? headers : []) {
    const name = String(x?.name ?? "").trim().toLowerCase();
    if (name && !h.has(name)) h.set(name, String(x?.value ?? "").trim());
  }
  if (h.has("list-unsubscribe")) return "List-Unsubscribe header";
  if (h.has("list-id")) return "List-Id header";
  const prec = (h.get("precedence") ?? "").toLowerCase();
  if (/^(bulk|list|junk)$/.test(prec)) return `Precedence: ${prec}`;
  const auto = (h.get("auto-submitted") ?? "").toLowerCase();
  if (auto && auto !== "no") return `Auto-Submitted: ${auto}`;
  return null;
}

export function isVinted(e: { from_address?: string | null; from_name?: string | null }): boolean {
  const a = String(e.from_address ?? "").trim().toLowerCase();
  const domain = a.slice(a.lastIndexOf("@") + 1);
  return /(^|\.)vinted\.[a-z.]+$/.test(domain) || /\bvinted\b/i.test(String(e.from_name ?? ""));
}

// Any sign this Vinted mail is about a return (then Claude decides).
export function vintedReturnHint(subject: string | null | undefined, body: string | null | undefined): boolean {
  const t = `${subject ?? ""}\n${String(body ?? "").slice(0, 6000)}`;
  return /\bretur|\breturn|skicka tillbaka|send (it |the item |them )?back/i.test(t);
}

// Senders VIC said to ignore ("ignorera allt från X"): addresses or domains.
export function ignoreMatch(address: string | null | undefined, ignore: unknown): string | null {
  const list = Array.isArray(ignore) ? ignore.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  return vipMatch(address ?? null, list);
}

const MONEY_OR_AUTHORITY = /(skatteverket|kronofogden|inkasso|försäkringskassan|tullverket|polisen|faktura|betala|betalning|förfaller|sista dag|påminnelse|overdue|invoice|payment due|bankid)/i;

export type HardInput = {
  from_address: string | null;
  from_name?: string | null;
  subject?: string | null;
  body?: string | null;
  bulk_reason?: string | null; // from the headers, stored when fetched
};

// Noise for certain (no Claude call), with the reason; null = let Claude decide.
export function hardNoise(e: HardInput, opts: { vips?: unknown; ignore?: unknown } = {}): string | null {
  const ignored = ignoreMatch(e.from_address, opts.ignore);
  if (ignored) return `ignored sender ${ignored}`;
  const vips = Array.isArray(opts.vips) ? opts.vips.map((x) => String(x ?? "")) : [];
  if (vipMatch(e.from_address, vips)) return null;
  if (isVinted(e)) return vintedReturnHint(e.subject, e.body) ? null : "Vinted, not a return";
  const mass = e.bulk_reason || (bulkSender(e.from_address) ? `sender ${bulkSender(e.from_address)}` : null);
  if (!mass) return null;
  const hay = `${e.from_name ?? ""}\n${e.from_address ?? ""}\n${e.subject ?? ""}\n${String(e.body ?? "").slice(0, 2000)}`;
  if (MONEY_OR_AUTHORITY.test(hay)) return null;
  return `mass mail (${mass})`;
}

// ── Vinted returns ─────────────────────────────────────────────────────
// Remind the day before the deadline at 10:00, or tomorrow 10:00 if no
// deadline; never in the past (then in 10 minutes). Local "YYYY-MM-DDTHH:MM".
export function vintedRemind(deadline: string | null, now: Date): string {
  const at = (date: string, time: string) => ({ s: `${date}T${time}`, t: localToUtc(date, time).getTime() });
  const r = deadline && parseDateStr(deadline) ? at(addDays(deadline, -1), "10:00") : at(addDays(localDateStr(now), 1), "10:00");
  if (r.t > now.getTime()) return r.s;
  const soon = new Date(now.getTime() + 10 * 60_000);
  return `${localDateStr(soon)}T${localTimeStr(soon)}`;
}

export type VintedVerdict = { vinted_return: boolean; return_item: string | null; return_deadline: string | null };
export type RuleTriage = {
  importance: "urgent" | "important" | "normal" | "noise";
  needs_reply: boolean;
  why: string;
  actions: { title: string; lane: string; due_at: string | null; remind_at: string | null }[];
};

// Code has the last word on Vinted mail: a return becomes important with
// exactly one THRIFTIN item; anything else is noise with nothing to do.
export function applyVintedRule<T extends RuleTriage>(t: T & Partial<VintedVerdict>, email: { from_address: string | null; from_name?: string | null }, now: Date): T {
  if (!isVinted(email)) return t;
  if (!t.vinted_return) return { ...t, importance: "noise", needs_reply: false, actions: [], why: t.why || "Vinted, not a return" };
  const item = String(t.return_item ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || "vara";
  const deadline = t.return_deadline && parseDateStr(String(t.return_deadline).slice(0, 10)) ? String(t.return_deadline).slice(0, 10) : null;
  return {
    ...t,
    importance: t.importance === "urgent" ? "urgent" : "important",
    needs_reply: false,
    why: t.why || "Vinted return to send",
    actions: [{ title: `Skicka Vinted-retur: ${item}`, lane: "thriftin", due_at: deadline, remind_at: vintedRemind(deadline, now) }],
  };
}

// ── Already answered ───────────────────────────────────────────────────
// PidTagLastVerbExecuted (0x1081): 102 reply, 103 reply all, 104 forward.
export type Answered = "replied" | "forwarded";
export function lastVerbState(v: unknown): Answered | null {
  const n = Number(v);
  if (n === 102 || n === 103) return "replied";
  if (n === 104) return "forwarded";
  return null;
}

export type SentRef = { conversation_id: string | null; sent_at: string | null };

export function answeredState(
  email: { conversation_id: string | null; received_at: string | null },
  lastVerb: unknown,
  sent: SentRef[],
): Answered | null {
  const v = lastVerbState(lastVerb);
  if (v) return v;
  const received = Date.parse(String(email.received_at ?? ""));
  if (!email.conversation_id || !Number.isFinite(received)) return null;
  return sent.some((s) => s.conversation_id === email.conversation_id && Date.parse(String(s.sent_at ?? "")) > received) ? "replied" : null;
}

// What to clean up once an email is answered or turns out to be noise.
export function cleanupPlan(email: { draft_id: string | null }, outcome: "answered" | "noise") {
  return {
    deleteDraft: !!email.draft_id,          // only drafts Jarvis made (their ids are the only ones stored)
    closeSendReply: true,                   // the "Send reply to ..." item
    deleteAutoItems: outcome === "noise",   // to-dos Jarvis made from a now-noise email
  };
}

// Delete Jarvis's own draft, but only while it is still a draft: once VIC
// sent it (or it was deleted) it is left alone. Never touches anything else.
export async function deleteJarvisDraft(
  draftId: string | null | undefined,
  io: { get: (id: string) => Promise<{ isDraft?: boolean } | null>; del: (id: string) => Promise<void> },
): Promise<"none" | "gone" | "kept-not-draft" | "deleted"> {
  if (!draftId) return "none";
  const m = await io.get(draftId);
  if (!m) return "gone";
  if (m.isDraft !== true) return "kept-not-draft";
  await io.del(draftId);
  return "deleted";
}

// ── Rules VIC adds by voice ────────────────────────────────────────────
// "ignorera allt från X" -> X normalised to an address or @domain, or null.
export function normalizeSender(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/^mailto:/, "");
  if (!s) return null;
  if (/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return s;
  const d = s.replace(/^@/, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d)) return `@${d}`;
  return null;
}

export function appendRule(rules: unknown, rule: string): string {
  const base = typeof rules === "string" && rules.trim() ? rules.trimEnd() : DEFAULT_MAIL_RULES;
  const r = String(rule ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!r) return base;
  const n = (base.match(/^\d+\./gm) ?? []).length + 1;
  return `${base}\n${n}. ${r}`;
}
