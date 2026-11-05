// A mailto: link that opens the phone's mail app with Jarvis's reply already
// written (to the sender, "Re: subject"), and the original email quoted under
// it. VIC checks it and presses Send there. null when there is no address or
// no draft text.
const PREFIX = /^(re|sv|aw|ant)\s*:/i;
const ADDRESS = /^[^\s<>()[\]\\,;:"?&#%]+@[^\s<>()[\]\\,;:"?&#%]+$/;
const QUOTE_MAX = 3500; // keep the link a sane length; long threads are cut

function quoteBlock(o, sv) {
  if (!o || !String(o.body ?? "").trim()) return "";
  const who = o.from_name && o.from_address ? `${o.from_name} <${o.from_address}>` : (o.from_name || o.from_address || "");
  let at = "";
  try { at = o.received_at ? new Date(o.received_at).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" }) : ""; } catch { /* no date */ }
  let body = String(o.body).trim();
  if (body.length > QUOTE_MAX) body = `${body.slice(0, QUOTE_MAX).trimEnd()}\n…`;
  const L = sv ? { from: "Från", sent: "Skickat", subj: "Ämne" } : { from: "From", sent: "Sent", subj: "Subject" };
  return [
    "", "", "________________________________",
    who && `${L.from}: ${who}`,
    at && `${L.sent}: ${at}`,
    o.subject && `${L.subj}: ${o.subject}`,
    "", body,
  ].filter((x) => x !== false && x !== null && x !== undefined).join("\n");
}

export function replyMailto({ to, subject, body, original, lang }) {
  const addr = String(to ?? "").trim();
  const text = String(body ?? "").trim();
  if (!ADDRESS.test(addr) || !text) return null;
  const s = String(subject ?? "").trim();
  const subj = !s ? "Re:" : PREFIX.test(s) ? s : `Re: ${s}`;
  const full = text + quoteBlock(original, String(lang ?? "").toLowerCase().startsWith("sv"));
  return `mailto:${addr}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(full.replace(/\r?\n/g, "\r\n"))}`;
}

// The link for one emails row (draft_text, from_address, subject, body...).
export const mailtoForEmail = (e) =>
  e?.draft_text ? replyMailto({ to: e.from_address, subject: e.subject, body: e.draft_text, original: e, lang: e.draft_language }) : null;

// Open the email itself in the iPhone Mail app: message://<Message-ID>
// (angle brackets percent-encoded). Works when that mailbox is set up in
// Mail and the email is downloaded there. null without a Message-ID.
export function openInMailHref(e) {
  const raw = String(e?.internet_message_id ?? "").trim().replace(/^<|>$/g, "");
  if (!raw || /[\s<>]/.test(raw)) return null;
  return `message://%3C${encodeURIComponent(raw)}%3E`;
}
