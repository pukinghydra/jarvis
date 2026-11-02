// deno-lint-ignore-file no-explicit-any
// Web push to every phone/laptop that turned alerts on (same library and
// pattern as THRIFTIN's shopify function). Never throws.
//
// Pushes only ever link into the Jarvis app itself (`url` is an app path),
// never to anything that came from an email.

import webpush from "npm:web-push@3.6.7";
import { config } from "./config.ts";
import { sb } from "./db.ts";
import { appSecret, vapidKeys } from "./secrets.ts";

export type PushMsg = { title: string; body: string; url?: string; tag?: string };

export async function push(msg: PushMsg) {
  const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth");
  const out = { devices: subs?.length ?? 0, sent: 0, gone: 0, failed: 0 };
  if (!subs?.length) return out;
  try {
    const keys = await vapidKeys();
    // Subject: a contact URL for the push services (the app, else the project).
    webpush.setVapidDetails((await config("APP_URL")) || (await appSecret("PROJECT_URL")) || "https://supabase.com", keys.public, keys.private);
  } catch (e: any) {
    return { ...out, error: `push keys: ${e?.message ?? e}` };
  }
  const safe = {
    title: msg.title.slice(0, 120),
    body: msg.body.slice(0, 400),
    url: msg.url && msg.url.startsWith("/") ? msg.url : "/",
    tag: msg.tag,
  };
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(safe), { TTL: 6 * 3600, timeout: 5000 });
      out.sent++;
      await sb.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        out.gone++;
        await sb.from("push_subscriptions").delete().eq("id", s.id);
      } else out.failed++;
    }
  }
  return out;
}
