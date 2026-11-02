// HMAC signing and constant-time compare (WebCrypto: works in Deno and Node).

const enc = new TextEncoder();

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

export function randomToken(bytes = 18): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// OAuth state: "<nonce>.<expires ms>.<sig>", valid for `ttlMs`.
export async function signState(secret: string, now = Date.now(), ttlMs = 10 * 60 * 1000): Promise<string> {
  if (!secret) throw new Error("STATE_SECRET is not set");
  const body = `${randomToken()}.${now + ttlMs}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyState(secret: string, state: string, now = Date.now()): Promise<boolean> {
  if (!secret || !state) return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const body = `${parts[0]}.${parts[1]}`;
  if (!timingSafeEqual(await hmac(secret, body), parts[2])) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp > now;
}
