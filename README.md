# Jarvis

VIC's personal organiser. You talk to it through the **Claude app** (phone or
laptop, voice or text) using a custom connector; the **Jarvis web app** is
the mic-first capture button, the colour-coded lists and the phone alerts.

- **Lanes**: coloured areas of life — BUY IN, THRIFTIN, MONEY, PEOPLE, LIFE,
  INBOX (rename/recolour/add in the app).
- **Capture**: the app opens on a big mic. Without a Claude API key a note is
  saved as *unsorted* and Claude sorts it ("sort my notes"); with a key it
  becomes items straight away.
- **Reminders and alerts** (web push): due reminders, leave-now for events
  with a place, birthdays (a week before + the day).
- **Proof to close**: posting tasks need the post's link (tiktok.com /
  instagram.com); photo-proof items need a photo. Skips need a reason.
  Streak + weekly score.
- **09:30 brief** (template, no AI), Mondays = weekly review: calendar with
  leave-by times, must-dos, overdue, THRIFTIN shifts + web orders to ship,
  buy list from THRIFTIN sales, flagged email, unsorted notes.
- **Hotmail**: fetched 09:15 and 15:00, flagged by keywords + VIP senders.
  Claude reads it through the connector and saves reply **drafts** to the
  original sender (never sends). Each draft adds a "Send reply" item.
- **Calendar**: the iPhone's iCloud calendars ("Hem", "Arbete") via their
  share links, refreshed every 10 minutes.

## Layout

```
supabase/
  migrations/…_jarvis_init.sql   tables, RLS (owner only), app_secrets, seed
  cron.sql                       every-minute tick (run once, by hand)
  config.toml                    function settings (verify_jwt off, see why)
  functions/
    api/        app actions (complete, skip, push test, Hotmail connect …)
    capture/    mic/text notes
    tick/       the heartbeat: reminders, alerts, calendar, email, brief
    ms-auth/    Microsoft sign-in start + callback
    mcp/        the Claude connector (MCP over HTTP)
    _shared/    all logic; *-core.ts / time / recur / proof … are pure
web/            React PWA (Vite): Talk, Today, Lanes, Brief, Settings
docs/CLAUDE_PROJECT_INSTRUCTIONS.md   paste into a Claude Project
tests/          unit tests (Node), SQL checks, THRIFTIN feed harness
```

THRIFTIN side: `supabase/functions/jarvis-feed/` in the THRIFTIN repo
(read-only shifts, web orders to ship, category sales).

## Secrets

Made inside the Jarvis database by the migration or on first use, never
typed anywhere: `CRON_SECRET`, `STATE_SECRET`, `MCP_KEY`, `PROJECT_URL`,
`VAPID_KEYS` (table `app_secrets`, service role only).

Set in Supabase → Edge Functions → Secrets (Jarvis project):

| Secret | What |
|---|---|
| `MS_CLIENT_ID` | Microsoft Entra app (Application (client) ID) |
| `MS_CLIENT_SECRET` | Microsoft Entra client secret **Value** |
| `APP_URL` | the Vercel URL of the web app, e.g. `https://jarvis-xyz.vercel.app` |
| `ICS_URL` | iCloud share links, comma separated (`webcal://…,webcal://…`) |
| `THRIFTIN_FEED_URL` | `https://mpkazwsxjorocqajpkao.supabase.co/functions/v1/jarvis-feed` |
| `THRIFTIN_FEED_TOKEN` | random token (`npm run token`), same as THRIFTIN's `JARVIS_FEED_TOKEN` |
| `ANTHROPIC_API_KEY` | optional: auto-sort notes in the app |
| `JARVIS_MODEL` | optional, default `claude-opus-5-5` |

## Deploy order

1. **Migration** → Jarvis project (`supabase/migrations/…_jarvis_init.sql`).
2. **Auth** → Authentication → Sign In / Providers: Email on. URL
   Configuration → Site URL = the Vercel URL (after step 7).
3. **Secrets** (table above). `MS_*` can come later; Hotmail just shows
   "not connected" until then.
4. **Functions** (Jarvis): `api`, `capture`, `tick`, `ms-auth`, `mcp`, all
   with verify_jwt **off** (`supabase functions deploy <name> --no-verify-jwt`).
5. **THRIFTIN**: secret `JARVIS_FEED_TOKEN`, deploy `jarvis-feed` with
   verify_jwt off.
6. **Cron**: run `supabase/cron.sql` in the Jarvis SQL editor (no edits
   needed). Check after 2 minutes with the queries at the bottom of the file.
7. **Web** on Vercel: import `pukinghydra/jarvis`, Root Directory `web`,
   framework Vite, env `VITE_SUPABASE_URL=https://mcrpchqkconbesgborhj.supabase.co`
   and `VITE_SUPABASE_ANON_KEY=<publishable key>`. Then set `APP_URL`.
8. **iPhone**: open the URL in Safari → Share → Add to Home Screen → open
   Jarvis → "First time: create account" → **then turn off "Allow new users
   to sign up"** in Supabase Auth (the first account is the owner; nobody
   else can claim it, but closing sign-ups keeps strangers out entirely).
9. In Jarvis → Settings: **Turn alerts on**, **Connect Hotmail**, **Copy
   connector URL** → Claude app → Settings → Connectors → Add custom
   connector → paste. Make a Claude Project with
   `docs/CLAUDE_PROJECT_INSTRUCTIONS.md`.

iCloud links: iPhone Calendar → Calendars → ⓘ next to "Hem" → Public
Calendar on → Share Link → Copy. Same for "Arbete". Anyone with a link can
read that calendar, so keep the links secret.

## Checks

```bash
npm install && npm test              # 70+ unit tests (time/DST, recurrence, proof, buy list, MCP, ICS, brief, email rules)
npm run typecheck                    # strict tsc over all functions
npm run check:functions              # esbuild bundle of each function
npm run test:sql                     # migration + RLS/trigger checks on a local Postgres
node tests/feed/feed-harness.mjs ../THRIFTIN/supabase/functions/jarvis-feed/index.ts
cd web && npm install && npm run build
```
