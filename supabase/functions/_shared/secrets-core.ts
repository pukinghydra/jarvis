// Pure WebCrypto helpers for app secrets (testable in Node).

const b64u = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

// A VAPID key pair in web-push's format: public = uncompressed P-256 point
// (65 bytes), private = the 32-byte scalar, both base64url.
export async function generateVapid(): Promise<{ public: string; private: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey;
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(fromB64u(jwk.x!), 1);
  pub.set(fromB64u(jwk.y!), 33);
  return { public: b64u(pub), private: jwk.d! };
}

