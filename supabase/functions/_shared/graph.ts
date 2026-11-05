// deno-lint-ignore-file no-explicit-any
// Microsoft Graph for VIC's personal Hotmail (Outlook.com) account.
//
// Scopes (ms-scopes.ts): read mail and write drafts (Mail.ReadWrite), keep
// access (offline_access). No Mail.Send: Jarvis can't send email even if it
// tried. No calendar: VIC's calendars are iCloud (calendar.ts).

import { SUPABASE_URL } from "./env.ts";
import { config } from "./config.ts";
import { sb } from "./db.ts";

const AUTH = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
import { SCOPES } from "./ms-scopes.ts";
export { SCOPES };

export const redirectUri = () => `${SUPABASE_URL}/functions/v1/ms-auth`;

export async function authorizeUrl(state: string): Promise<string> {
  const clientId = await config("MS_CLIENT_ID");
  if (!clientId) throw new Error("MS_CLIENT_ID is not set");
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: SCOPES,
    state,
    prompt: "select_account",
  });
  return `${AUTH}/authorize?${q}`;
}

async function tokenRequest(form: Record<string, string>) {
  const [clientId, clientSecret] = await Promise.all([config("MS_CLIENT_ID"), config("MS_CLIENT_SECRET")]);
  if (!clientId || !clientSecret) throw new Error("MS_CLIENT_ID / MS_CLIENT_SECRET are not set yet");
  const res = await fetch(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: SCOPES, ...form }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Microsoft login failed: ${body.error_description?.split("\r\n")[0] ?? body.error ?? res.status}`);
  return body as { access_token: string; refresh_token?: string; scope?: string };
}

export async function connectWithCode(code: string): Promise<string> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error("Microsoft gave no refresh token (offline_access missing?)");
  const me = await graphFetch("/me?$select=userPrincipalName,mail,displayName", t.access_token);
  const account = me.mail ?? me.userPrincipalName ?? null;
  const { error } = await sb.from("ms_tokens").upsert({ id: 1, refresh_token: t.refresh_token, account, scope: t.scope ?? SCOPES, updated_at: new Date().toISOString() });
  if (error) throw new Error(`save token: ${error.message}`);
  cached = { token: t.access_token, until: Date.now() + 50 * 60_000 };
  return account ?? "connected";
}

let cached: { token: string; until: number } | null = null;

// A fresh access token, or null when Hotmail isn't connected. Microsoft may
// hand back a new refresh token each time: always keep the newest.
export async function accessToken(): Promise<string | null> {
  if (cached && cached.until > Date.now()) return cached.token;
  const { data } = await sb.from("ms_tokens").select("refresh_token").eq("id", 1).maybeSingle();
  if (!data?.refresh_token) return null;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: data.refresh_token });
  if (t.refresh_token && t.refresh_token !== data.refresh_token) {
    await sb.from("ms_tokens").update({ refresh_token: t.refresh_token, updated_at: new Date().toISOString() }).eq("id", 1);
  }
  cached = { token: t.access_token, until: Date.now() + 50 * 60_000 };
  return t.access_token;
}

export async function msStatus(): Promise<{ connected: boolean; account: string | null; since: string | null }> {
  const { data } = await sb.from("ms_tokens").select("account, updated_at").eq("id", 1).maybeSingle();
  return { connected: !!data, account: data?.account ?? null, since: data?.updated_at ?? null };
}

export async function msDisconnect() {
  cached = null;
  await sb.from("ms_tokens").delete().eq("id", 1);
}

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function graphFetch(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GraphError(res.status, `Graph ${res.status}: ${body?.error?.message ?? "error"}`);
  return body;
}

export async function graph(path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessToken();
  if (!token) throw new Error("Hotmail is not connected");
  return graphFetch(path, token, init);
}

export type MailMessage = {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  received_at: string;
  preview: string;
  body: string;
  conversation_id: string | null;
  internet_message_id: string | null;
  headers: { name: string; value: string }[] | null; // null = not fetched
  last_verb: number | null;                          // PidTagLastVerbExecuted
};

// Outlook's "last verb" (0x1081): 102 replied, 103 replied all, 104 forwarded.
const LAST_VERB = "Integer 0x1081";
const EXPAND_VERB = `singleValueExtendedProperties($filter=id eq '${LAST_VERB}')`;
const lastVerbOf = (m: any): number | null => {
  const p = (m?.singleValueExtendedProperties ?? []).find((x: any) => String(x?.id ?? "").toLowerCase() === LAST_VERB.toLowerCase());
  const n = Number(p?.value);
  return Number.isFinite(n) ? n : null;
};

// GET a list, following @odata.nextLink up to `pages` pages.
async function listAll(path: string, init: RequestInit, pages = 5): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = path;
  for (let i = 0; next && i < pages; i++) {
    const r: any = await graph(next, init);
    out.push(...(r?.value ?? []));
    next = r?.["@odata.nextLink"] ?? null;
  }
  return out;
}

// Inbox mail received since `since`, newest first, bodies as plain text,
// with the conversation id, the internet headers (mass-mail signals) and
// the last verb (answered?). If Outlook refuses the extras, the plain
// fields still come back (headers/last_verb null).
export async function inboxSince(since: Date, top = 40): Promise<MailMessage[]> {
  const base = {
    $filter: `receivedDateTime ge ${since.toISOString()}`,
    $orderby: "receivedDateTime desc",
    $top: String(top),
  };
  const init = { headers: { Prefer: 'outlook.body-content-type="text"' } };
  let r: any;
  let rich = true;
  try {
    const q = new URLSearchParams({ ...base, $select: "id,subject,from,receivedDateTime,bodyPreview,body,conversationId,internetMessageId,internetMessageHeaders", $expand: EXPAND_VERB });
    r = await graph(`/me/mailFolders/inbox/messages?${q}`, init);
  } catch (e) {
    if (!(e instanceof GraphError) || e.status !== 400) throw e;
    rich = false;
    const q = new URLSearchParams({ ...base, $select: "id,subject,from,receivedDateTime,bodyPreview,body,conversationId,internetMessageId" });
    r = await graph(`/me/mailFolders/inbox/messages?${q}`, init);
  }
  return (r?.value ?? []).map((m: any) => ({
    id: m.id,
    subject: m.subject ?? null,
    from_name: m.from?.emailAddress?.name ?? null,
    from_address: m.from?.emailAddress?.address ?? null,
    received_at: m.receivedDateTime,
    preview: m.bodyPreview ?? "",
    body: String(m.body?.content ?? m.bodyPreview ?? ""),
    conversation_id: m.conversationId ?? null,
    internet_message_id: m.internetMessageId ?? null,
    headers: rich ? (Array.isArray(m.internetMessageHeaders) ? m.internetMessageHeaders : []) : null,
    last_verb: rich ? lastVerbOf(m) : null,
  }));
}

// The state of inbox mail since `since` (no bodies): conversation, headers
// and last verb. Used to re-check open emails every scan (VIC may have
// answered from his phone). Map keyed by Graph message id.
export async function inboxState(since: Date): Promise<Map<string, { conversation_id: string | null; internet_message_id: string | null; headers: { name: string; value: string }[] | null; last_verb: number | null }>> {
  const base = { $filter: `receivedDateTime ge ${since.toISOString()}`, $orderby: "receivedDateTime desc", $top: "100" };
  let rows: any[];
  let rich = true;
  try {
    rows = await listAll(`/me/mailFolders/inbox/messages?${new URLSearchParams({ ...base, $select: "id,conversationId,receivedDateTime,internetMessageId,internetMessageHeaders", $expand: EXPAND_VERB })}`, {});
  } catch (e) {
    if (!(e instanceof GraphError) || e.status !== 400) throw e;
    rich = false;
    rows = await listAll(`/me/mailFolders/inbox/messages?${new URLSearchParams({ ...base, $select: "id,conversationId,receivedDateTime,internetMessageId" })}`, {});
  }
  return new Map(rows.map((m: any) => [m.id, {
    conversation_id: m.conversationId ?? null,
    internet_message_id: m.internetMessageId ?? null,
    headers: rich ? (Array.isArray(m.internetMessageHeaders) ? m.internetMessageHeaders : []) : null,
    last_verb: rich ? lastVerbOf(m) : null,
  }]));
}

// What VIC sent since `since`: conversation + time only (answered check).
export async function sentSince(since: Date): Promise<{ conversation_id: string | null; sent_at: string | null; subject: string | null; to: string[] }[]> {
  const q = new URLSearchParams({ $filter: `sentDateTime ge ${since.toISOString()}`, $orderby: "sentDateTime desc", $top: "100", $select: "conversationId,sentDateTime,subject,toRecipients" });
  const rows = await listAll(`/me/mailFolders/sentitems/messages?${q}`, {});
  return rows.map((m: any) => ({
    conversation_id: m.conversationId ?? null, sent_at: m.sentDateTime ?? null, subject: m.subject ?? null,
    to: (m.toRecipients ?? []).map((r: any) => String(r?.emailAddress?.address ?? "")).filter(Boolean),
  }));
}

// Is this message (still) a draft? null when it no longer exists.
export async function messageMeta(id: string): Promise<{ isDraft?: boolean } | null> {
  try {
    const m = await graph(`/me/messages/${encodeURIComponent(id)}?$select=isDraft`);
    return { isDraft: m?.isDraft === true };
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null;
    throw e;
  }
}

// Delete one message by id. Only ever called for Jarvis's own drafts, after
// messageMeta confirmed it is still a draft (mail-rules-core.ts).
export async function deleteMessage(id: string): Promise<void> {
  try {
    await graph(`/me/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return;
    throw e;
  }
}

// Save a reply as a DRAFT in Outlook (Drafts folder). The text goes above
// the quoted original. Returns the draft's id and an Outlook link to it.
export async function createReplyDraft(messageId: string, text: string): Promise<{ id: string; webLink: string | null }> {
  const d = await graph(`/me/messages/${encodeURIComponent(messageId)}/createReply`, {
    method: "POST",
    body: JSON.stringify({ comment: text }),
  });
  return { id: d.id, webLink: d.webLink ?? null };
}

// VIC's own sent mail (Sent Items), newest first, bodies as plain text.
// Used only to learn how he writes (style.ts). Mail.ReadWrite covers it.
export async function sentItems(top = 60): Promise<{ subject: string | null; to_address: string | null; sent_at: string | null; body: string }[]> {
  const q = new URLSearchParams({
    $orderby: "sentDateTime desc",
    $top: String(Math.min(100, Math.max(1, top))),
    $select: "id,subject,toRecipients,sentDateTime,body",
  });
  const r = await graph(`/me/mailFolders/sentitems/messages?${q}`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
  return (r?.value ?? []).map((m: any) => ({
    subject: m.subject ?? null,
    to_address: m.toRecipients?.[0]?.emailAddress?.address ?? null,
    sent_at: m.sentDateTime ?? null,
    body: String(m.body?.content ?? ""),
  }));
}
