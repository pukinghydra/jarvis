// deno-lint-ignore-file no-explicit-any
// Actions from the Jarvis web app that need server rules or secrets. Called
// with VIC's login; the owner is checked in code (verify_jwt off, see
// config.toml).
//
// POST {action, ...}:
//   complete {id, proof_url?, proof_path?}   skip {id, reason}
//   stats    status    vapid    push_test
//   ms_start (-> Microsoft sign-in URL)    ms_disconnect
//   scan_now    brief_now    calendar_sync    buy_list

import { CORS, errorText, json } from "../_shared/http.ts";
import { env, SUPABASE_URL } from "../_shared/env.ts";
import { HttpError, requireOwner } from "../_shared/db.ts";
import { completeItem, skipItem, stats } from "../_shared/items.ts";
import { push } from "../_shared/push.ts";
import { msDisconnect, msStatus, redirectUri } from "../_shared/graph.ts";
import { signState } from "../_shared/crypto.ts";
import { scanEmails } from "../_shared/email.ts";
import { runBrief } from "../_shared/brief.ts";
import { icsUrls, syncCalendar } from "../_shared/calendar.ts";
import { thriftinFeed } from "../_shared/thriftin.ts";
import { buyList } from "../_shared/buylist.ts";
import { hasClaude } from "../_shared/claude.ts";
import { appSecret, vapidKeys } from "../_shared/secrets.ts";

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
      case "status":
        return json({
          claude_api: hasClaude(),
          hotmail: await msStatus(),
          hotmail_ready: !!(env("MS_CLIENT_ID") && env("MS_CLIENT_SECRET")),
          hotmail_redirect_uri: redirectUri(),
          calendars: icsUrls(env("ICS_URL")).length,
          thriftin: !!(env("THRIFTIN_FEED_URL") && env("THRIFTIN_FEED_TOKEN")),
          app_url: env("APP_URL") || null,
        });
      case "vapid":
        return json({ key: (await vapidKeys()).public });
      case "push_test":
        return json(await push({ title: "Jarvis test", body: "Alerts work on this device.", url: "/?tab=settings", tag: "test" }));
      case "ms_start": {
        if (!env("MS_CLIENT_ID") || !env("MS_CLIENT_SECRET")) throw new HttpError(400, "MS_CLIENT_ID / MS_CLIENT_SECRET are not set in the function secrets yet");
        const ticket = await signState(`${await appSecret("STATE_SECRET")}:start`);
        return json({ url: `${SUPABASE_URL}/functions/v1/ms-auth?start=1&t=${encodeURIComponent(ticket)}` });
      }
      case "ms_disconnect":
        await msDisconnect();
        return json({ ok: true });
      case "scan_now":
        return json(await scanEmails(now, { notify: false }));
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
