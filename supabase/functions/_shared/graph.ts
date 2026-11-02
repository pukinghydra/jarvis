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

async function graphFetch(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph ${res.status}: ${body?.error?.message ?? "error"}`);
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
};

// Inbox mail received since `since`, newest first, bodies as plain text.
export async function inboxSince(since: Date, top = 40): Promise<MailMessage[]> {
  const q = new URLSearchParams({
    $filter: `receivedDateTime ge ${since.toISOString()}`,
    $orderby: "receivedDateTime desc",
    $top: String(top),
    $select: "id,subject,from,receivedDateTime,bodyPreview,body",
  });
  const r = await graph(`/me/mailFolders/inbox/messages?${q}`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
  return (r?.value ?? []).map((m: any) => ({
    id: m.id,
    subject: m.subject ?? null,
    from_name: m.from?.emailAddress?.name ?? null,
    from_address: m.from?.emailAddress?.address ?? null,
    received_at: m.receivedDateTime,
    preview: m.bodyPreview ?? "",
    body: String(m.body?.content ?? m.bodyPreview ?? ""),
  }));
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
