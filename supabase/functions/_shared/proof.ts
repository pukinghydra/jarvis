// Proof to close: the rules the database trigger also enforces, with
// friendlier messages. Pure.

export type ProofType = "none" | "link" | "photo";

export type ProofInput = { proof_url?: string | null; proof_path?: string | null };
export type ProofCheck = { ok: true; proof_url: string | null; proof_path: string | null } | { ok: false; error: string };

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function domainMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\.+/, "");
  return host === d || host.endsWith(`.${d}`);
}

export function checkProof(
  item: { proof_type: ProofType; proof_domains?: string[] | null; title?: string },
  input: ProofInput,
): ProofCheck {
  const url = (input.proof_url ?? "").trim() || null;
  const path = (input.proof_path ?? "").trim() || null;
  if (item.proof_type === "none") return { ok: true, proof_url: url, proof_path: path };
  if (item.proof_type === "photo") {
    if (!path) return { ok: false, error: "Proof needed: add a photo to close this." };
    return { ok: true, proof_url: url, proof_path: path };
  }
  // link
  const domains = (item.proof_domains ?? []).filter(Boolean);
  if (!url) {
    return { ok: false, error: `Proof needed: paste the link${domains.length ? ` (${domains.join(" or ")})` : ""} to close this.` };
  }
  const host = hostOf(url);
  if (!host) return { ok: false, error: "That isn't a web link. Paste the full link (https://…)." };
  if (domains.length && !domains.some((d) => domainMatches(host, d))) {
    return { ok: false, error: `The link must be on ${domains.join(" or ")}, not ${host}.` };
  }
  return { ok: true, proof_url: url, proof_path: path };
}

export function checkSkip(reason: string | null | undefined): { ok: true; reason: string } | { ok: false; error: string } {
  const r = (reason ?? "").trim();
  if (r.length < 3) return { ok: false, error: "Skipping needs a reason (it counts against this week's score)." };
  return { ok: true, reason: r.slice(0, 500) };
}
