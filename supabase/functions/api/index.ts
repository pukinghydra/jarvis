// deno-lint-ignore-file no-explicit-any
// Actions from the Jarvis web app that need server rules or secrets. Called
// with VIC's login; the owner is checked in code (verify_jwt off, see
// config.toml).
//
// POST {action, ...}:
//   complete {id, proof_url?, proof_path?}   skip {id, reason}
//   stats    status    vapid    push_test
//   ms_start (-> Microsoft sign-in URL)    ms_disconnect
//   scan_now (fetch + AI triage when a key is set)    style_relearn
//   brief_now    calendar_sync    buy_list

import { CORS, errorText, json } from "../_shared/http.ts";
import { SUPABASE_URL } from "../_shared/env.ts";
import { config } from "../_shared/config.ts";
import { HttpError, requireOwner } from "../_shared/db.ts";
import { completeItem, skipItem, stats } from "../_shared/items.ts";
import { push } from "../_shared/push.ts";
import { msDisconnect, msStatus, redirectUri } from "../_shared/graph.ts";
import { signState } from "../_shared/crypto.ts";
import { scanEmails } from "../_shared/email.ts";
import { triageNewEmails } from "../_shared/email-triage.ts";
import { rebuildStyle } from "../_shared/style.ts";
import { runBrief } from "../_shared/brief.ts";
import { icsUrls, syncCalendar } from "../_shared/calendar.ts";
import { thriftinFeed } from "../_shared/thriftin.ts";
import { buyList } from "../_shared/buylist.ts";
import { hasClaude } from "../_shared/claude.ts";
import { appSecret, vapidKeys } from "../_shared/secrets.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const waitUntil = (p: Promise<unknown>) => (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil ? EdgeRuntime.waitUntil(p) : undefined);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    await requireOwner(req);
    const b = await req.json().catch(() => ({}));
    const now = new Date();
    switch (b.action) {
      case "complete":
        return json(await completeItem(String(b.id ?? ""), { proof_url: b.proof_url ?? null, proof_path: b.proof_path ?? null }));
      case "skip":
        return json(await skipItem(String(b.id ?? ""), String(b.reason ?? "")));
      case "stats":
        return json(await stats(now));
      case "status": {
        const [msId, msSecret, ics, feedUrl, feedToken, appUrl] = await Promise.all(
          (["MS_CLIENT_ID", "MS_CLIENT_SECRET", "ICS_URL", "THRIFTIN_FEED_URL", "THRIFTIN_FEED_TOKEN", "APP_URL"] as const).map((k) => config(k)),
        );
        return json({
          claude_api: await hasClaude(),
          hotmail: await msStatus(),
          hotmail_ready: !!(msId && msSecret),
          hotmail_redirect_uri: redirectUri(),
          calendars: icsUrls(ics).length,
          thriftin: !!(feedUrl && feedToken),
          app_url: appUrl || null,
        });
      }
      case "vapid":
        return json({ key: (await vapidKeys()).public });
      case "push_test":
        return json(await push({ title: "Jarvis test", body: "Alerts work on this device.", url: "/?tab=settings", tag: "test" }));
      case "ms_start": {
        if (!(await config("MS_CLIENT_ID")) || !(await config("MS_CLIENT_SECRET"))) throw new HttpError(400, "MS_CLIENT_ID / MS_CLIENT_SECRET are not set yet");
        const ticket = await signState(`${await appSecret("STATE_SECRET")}:start`);
        return json({ url: `${SUPABASE_URL}/functions/v1/ms-auth?start=1&t=${encodeURIComponent(ticket)}` });
      }
      case "ms_disconnect":
        await msDisconnect();
        return json({ ok: true });
      case "scan_now": {
        const scan: any = await scanEmails(now, { notify: false });
        if (scan.skipped || !(await hasClaude())) return json(scan);
        // Sorting can take a while: answer after 45 s at most, the rest
        // carries on in the background (pushes still arrive).
        const triage = triageNewEmails(now, { notify: true }).catch((e) => ({ error: errorText(e) }));
        const first = await Promise.race([triage, new Promise((r) => setTimeout(() => r(null), 45_000))]);
        if (!first) waitUntil(triage);
        return json({ ...scan, triage: first ?? { running: true } });
      }
      case "style_relearn":
        return json(await rebuildStyle(now, { force: true }));
      case "brief_now":
        return json(await runBrief(now, { push: !!b.push }));
      case "calendar_sync":
        return json(await syncCalendar(now));
      case "buy_list": {
        const feed = await thriftinFeed();
        return json(feed ? buyList(feed.categories, 8, 5) : { error: "THRIFTIN feed not connected" });
      }
      default:
        throw new HttpError(400, `Unknown action ${b.action}`);
    }
  } catch (e) {
    return json({ error: errorText(e) }, e instanceof HttpError ? e.status : 500);
  }
});
