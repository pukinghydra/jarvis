// Microsoft (Hotmail) sign-in, one URL for both ends - the redirect URI
// registered in Microsoft Entra is exactly
//   https://mcrpchqkconbesgborhj.supabase.co/functions/v1/ms-auth
//
//   ?start=1&t=<ticket>   begin: the api function gives the owner a signed
//                         10-minute ticket; we send the browser to Microsoft
//                         with a signed state
//   ?code=...&state=...   callback from Microsoft: check state, keep the
//                         refresh token, go back to the app
//
// verify_jwt is off (a browser coming back from Microsoft has no Supabase
// login); the signed ticket/state prove it was started from VIC's Jarvis.

import { config } from "../_shared/config.ts";
import { signState, verifyState } from "../_shared/crypto.ts";
import { appSecret } from "../_shared/secrets.ts";
import { authorizeUrl, connectWithCode } from "../_shared/graph.ts";

const back = async (params: Record<string, string>): Promise<Response> => {
  const appUrl = await config("APP_URL").catch(() => "");
  const target = `${appUrl || "/"}?${new URLSearchParams({ tab: "settings", ...params })}`;
  return new Response(null, { status: 302, headers: { Location: target } });
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = await appSecret("STATE_SECRET").catch(() => "");
  if (!secret) return new Response("Jarvis is not set up (STATE_SECRET missing)", { status: 500 });

  if (url.searchParams.get("start")) {
    if (!(await verifyState(`${secret}:start`, url.searchParams.get("t") ?? ""))) {
      return back({ ms: "error", reason: "That link expired. Tap Connect Hotmail again." });
    }
    try {
      return new Response(null, { status: 302, headers: { Location: await authorizeUrl(await signState(`${secret}:state`)) } });
    } catch (e) {
      return back({ ms: "error", reason: String((e as Error).message ?? e).slice(0, 200) });
    }
  }

  const err = url.searchParams.get("error");
  if (err) return back({ ms: "error", reason: (url.searchParams.get("error_description") ?? err).slice(0, 200) });
  const code = url.searchParams.get("code");
  if (!code) return new Response("Nothing to do here", { status: 400 });
  if (!(await verifyState(`${secret}:state`, url.searchParams.get("state") ?? ""))) {
    return back({ ms: "error", reason: "Sign-in expired or not started from Jarvis. Try again." });
  }
  try {
    const account = await connectWithCode(code);
    return back({ ms: "ok", account });
  } catch (e) {
    return back({ ms: "error", reason: String((e as Error).message ?? e).slice(0, 200) });
  }
});
