// deno-lint-ignore-file no-explicit-any
// The heartbeat. pg_cron POSTs here every minute with the x-cron-secret
// header = app_secrets.CRON_SECRET (see supabase/cron.sql). All "what time is it in Stockholm"
// decisions happen here, so DST is handled in one place.
//
// Every minute:   roll missed repeating items, send due reminders,
//                 leave-now alerts, birthdays (09:00-09:59)
// Every 10 min:   refresh the calendars
// Hotmail:        with a Claude API key: every 15 min 07:00-23:00, then AI
//                 triage (urgent pushes, drafts in VIC's style). Without a
//                 key: 09:15 + 15:00, rule-based flags, push if flagged.
// 09:30:          build + push the brief (Monday = weekly review)
// Monday 09:45:   relearn VIC's writing style (key only; keeps his edits)
// 03:00:          clean old alert keys

import { errorText, json } from "../_shared/http.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { sb, claimOnce } from "../_shared/db.ts";
import { appSecret } from "../_shared/secrets.ts";
import { rollPast } from "../_shared/items.ts";
import { sendBirthdayAlerts, sendLeaveAlerts, sendReminders } from "../_shared/alerts.ts";
import { syncCalendar } from "../_shared/calendar.ts";
import { scanEmails } from "../_shared/email.ts";
import { triageNewEmails } from "../_shared/email-triage.ts";
import { mailPlan } from "../_shared/email-triage-core.ts";
import { rebuildStyle } from "../_shared/style.ts";
import { hasClaude } from "../_shared/claude.ts";
import { isMonday } from "../_shared/brief-core.ts";
import { runBrief } from "../_shared/brief.ts";
import { inLocalWindow, localDateStr, localParts, pad } from "../_shared/time.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

async function step(report: Record<string, unknown>, name: string, fn: () => Promise<unknown>) {
  try {
    report[name] = await fn();
  } catch (e) {
    report[name] = { error: errorText(e) };
    console.error(`tick ${name}:`, errorText(e));
  }
}

// The brief is claimed once per day; a failed build un-claims itself so the
// next minute retries, at most 3 times.
async function briefWithRetry(now: Date, today: string) {
  try {
    return await runBrief(now, { push: true });
  } catch (e) {
    for (let n = 1; n <= 3; n++) {
      if (await claimOnce(`brief-fail:${today}:${n}`)) {
        if (n < 3) await sb.from("sent_log").delete().eq("key", `brief:${today}`);
        break;
      }
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  const secret = await appSecret("CRON_SECRET").catch(() => "");
  if (!secret || !timingSafeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return json({ error: "unauthorized" }, 401);

  const now = new Date();
  const today = localDateStr(now);
  const p = localParts(now);
  const report: Record<string, unknown> = { at: now.toISOString(), local: `${today} ${pad(p.h)}:${pad(p.mi)}` };

  // Quick, every minute.
  await step(report, "roll", () => rollPast(now));
  await step(report, "reminders", () => sendReminders(now));
  await step(report, "leave", () => sendLeaveAlerts(now));
  await step(report, "birthdays", () => sendBirthdayAlerts(now));

  // Slower jobs run after the answer (pg_net doesn't wait long).
  const jobs: Promise<unknown>[] = [];
  const bucket = `${today}T${pad(p.h)}:${Math.floor(p.mi / 10)}`;
  if (await claimOnce(`cal:${bucket}`).catch(() => false)) jobs.push(step(report, "calendar", () => syncCalendar(now)));
  const triageOn = await hasClaude().catch(() => false);
  const mail = mailPlan(now, triageOn, (slot, minutes) => inLocalWindow(now, slot, minutes));
  if (mail && await claimOnce(mail.key).catch(() => false)) {
    jobs.push(step(report, mail.key, async () => {
      const scan = await scanEmails(now, { notify: mail.notifyRules });
      return mail.triage ? { scan, triage: await triageNewEmails(now, { notify: true }) } : scan;
    }));
  }
  if (triageOn && isMonday(today) && inLocalWindow(now, "09:45", 120) && await claimOnce(`style:${today}`).catch(() => false)) {
    jobs.push(step(report, "style", () => rebuildStyle(now)));
  }
  if (inLocalWindow(now, "09:30", 150) && await claimOnce(`brief:${today}`).catch(() => false)) {
    jobs.push(step(report, "brief", () => briefWithRetry(now, today)));
  }
  if (inLocalWindow(now, "03:00", 30) && await claimOnce(`cleanup:${today}`).catch(() => false)) {
    jobs.push(step(report, "cleanup", async () => {
      const cutoff = new Date(now.getTime() - 30 * 86400_000).toISOString();
      await sb.from("sent_log").delete().lt("sent_at", cutoff);
      return "ok";
    }));
  }

  const all = Promise.all(jobs).then(() => console.log("tick", JSON.stringify(report)));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(all);
    return json({ ...report, background: jobs.length });
  }
  await all;
  return json(report);
});
