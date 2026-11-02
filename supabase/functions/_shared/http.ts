// Response helpers and CORS for calls from the Jarvis web app. Auth is a
// bearer token (never cookies), so a wildcard origin is safe here.

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...headers } });

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
