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
