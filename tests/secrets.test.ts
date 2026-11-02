import { suite, ok, eq } from "./t.ts";
import webpush from "npm:web-push@3.6.7";
import { generateVapid } from "../supabase/functions/_shared/secrets-core.ts";

const { test, run } = suite();
export { run };

test("VAPID keys from WebCrypto are accepted by web-push", async () => {
  const k = await generateVapid();
  eq(k.public.length, 87); eq(k.private.length, 43);
  webpush.setVapidDetails("https://example.com", k.public, k.private); // throws on a bad key
  const h = webpush.getVapidHeaders("https://web.push.apple.com", "https://example.com", k.public, k.private, "aes128gcm");
  ok(String(h.Authorization).startsWith("vapid t="), "vapid header");
});

// ── config(): env first, else app_secrets ──
import { CONFIG_KEYS, resolveConfig } from "../supabase/functions/_shared/config-core.ts";

test("config: env value wins over the stored one", () => eq(resolveConfig("MS_CLIENT_ID", " env-id ", { MS_CLIENT_ID: "db-id" }), "env-id"));
test("config: blank env falls back to app_secrets", () => {
  eq(resolveConfig("MS_CLIENT_ID", "", { MS_CLIENT_ID: " db-id " }), "db-id");
  eq(resolveConfig("ICS_URL", "   ", { ICS_URL: "webcal://a,webcal://b" }), "webcal://a,webcal://b");
  eq(resolveConfig("JARVIS_MODEL", undefined, { JARVIS_MODEL: "claude-sonnet-5-5" }), "claude-sonnet-5-5");
});
test("config: neither set gives empty string", () => {
  eq(resolveConfig("THRIFTIN_FEED_TOKEN", undefined, {}), "");
  eq(resolveConfig("THRIFTIN_FEED_TOKEN", "", { THRIFTIN_FEED_TOKEN: null }), "");
});
test("config: APP_URL loses trailing slashes from either source", () => {
  eq(resolveConfig("APP_URL", "https://jarvis.example.app//", {}), "https://jarvis.example.app");
  eq(resolveConfig("APP_URL", "", { APP_URL: "https://jarvis.example.app/" }), "https://jarvis.example.app");
});
test("config: covers every setting VIC may need to set", () => {
  for (const k of ["MS_CLIENT_ID", "MS_CLIENT_SECRET", "APP_URL", "ICS_URL", "THRIFTIN_FEED_URL", "THRIFTIN_FEED_TOKEN", "JARVIS_MODEL", "ANTHROPIC_API_KEY"]) {
    ok((CONFIG_KEYS as readonly string[]).includes(k), `${k} in CONFIG_KEYS`);
  }
  ok(!(CONFIG_KEYS as readonly string[]).includes("CRON_SECRET"), "generated secrets are not config keys");
});

// ── Microsoft scopes: mail only, no calendar, never send ──
import { SCOPES } from "../supabase/functions/_shared/ms-scopes.ts";
import { readFileSync } from "node:fs";

test("ms scopes: offline_access, User.Read, Mail.ReadWrite only", () => {
  eq(SCOPES.split(" ").sort().join(" "), "Mail.ReadWrite User.Read offline_access");
  ok(!/Calendars\./.test(SCOPES), "no calendar scope");
  ok(!/Mail\.Send/.test(SCOPES), "never Mail.Send");
});
test("calendar sync reads iCloud only (no Graph calendarView)", () => {
  const src = readFileSync(new URL("../../supabase/functions/_shared/calendar.ts", import.meta.url), "utf8");
  ok(!/calendarView|graph\.ts/.test(src), "calendar.ts must not call Graph");
});
