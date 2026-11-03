// Structured items from Claude (MCP tools add / sort_note) -> database rows.
// Claude in the Claude app does the understanding; this only checks and
// normalises. Pure.

import { localToUtc, parseDateStr, parseTimeStr } from "./time.ts";
import { RECURS, type Recur } from "./recur.ts";

export type LaneRef = { id: string; slug: string; name: string };

export type ItemInput = {
  title?: unknown;
  lane?: unknown;
  kind?: unknown;
  notes?: unknown;
  due_at?: unknown;
  remind_at?: unknown;
  recurrence?: unknown;
  proof_type?: unknown;
  proof_domains?: unknown;
  location?: unknown;
  travel_minutes?: unknown;
  remind_again_minutes?: unknown;
};

export type ItemRowIn = {
  lane_id: string | null;
  kind: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  all_day: boolean;
  remind_at: string | null;
  recur: Recur | null;
  proof_type: "none" | "link" | "photo";
  proof_domains: string[];
  location: string | null;
  travel_minutes: number | null;
  remind_again_minutes: number | null;
};

const KINDS = ["task", "reminder", "buy", "birthday", "event"];
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// "2026-11-06" -> all day; "2026-11-06T14:00" -> Stockholm time;
// "2026-11-06T14:00:00+01:00" / "...Z" -> that instant.
export function parseWhen(v: unknown): { at: Date; allDay: boolean } | null | "bad" {
  const s = str(v);
  if (!s) return null;
  if (parseDateStr(s)) return { at: localToUtc(s, "00:00"), allDay: true };
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})(:\d{2}(\.\d+)?)?$/.exec(s);
  if (local && parseDateStr(local[1]) && parseTimeStr(local[2])) return { at: localToUtc(local[1], local[2]), allDay: false };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) return { at: new Date(t), allDay: false };
  }
  return "bad";
}

function inferDomains(title: string): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  if (t.includes("tiktok")) out.push("tiktok.com");
  if (/\binsta(gram)?\b|\big\b/.test(t)) out.push("instagram.com");
  return out;
}

const cleanDomain = (d: string) =>
  d.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

export function normalizeItem(input: ItemInput, lanes: LaneRef[]): { ok: true; row: ItemRowIn } | { ok: false; error: string } {
  const title = str(input.title).slice(0, 200);
  if (!title) return { ok: false, error: "title is required" };

  let kind = str(input.kind).toLowerCase() || "task";
  if (!KINDS.includes(kind)) return { ok: false, error: `kind must be one of ${KINDS.join(", ")}` };

  const laneKey = str(input.lane).toLowerCase();
  let lane = lanes.find((l) => l.slug === laneKey || l.name.toLowerCase() === laneKey);
  if (kind === "buy") lane = lanes.find((l) => l.slug === "buy") ?? lane;
  if (kind === "birthday" && !lane) lane = lanes.find((l) => l.slug === "people");
  if (!lane) {
    if (laneKey) return { ok: false, error: `unknown lane "${laneKey}". Lanes: ${lanes.map((l) => l.slug).join(", ")}` };
    lane = lanes.find((l) => l.slug === "life") ?? lanes[0];
  }

  const due = parseWhen(input.due_at);
  if (due === "bad") return { ok: false, error: `due_at "${str(input.due_at)}" is not a date (YYYY-MM-DD) or ISO time` };
  const remind = parseWhen(input.remind_at);
  if (remind === "bad") return { ok: false, error: `remind_at "${str(input.remind_at)}" is not an ISO time` };

  // A date-only reminder means 09:00 that day (Stockholm).
  let remindAt: Date | null = remind ? (remind.allDay ? localToUtc(str(input.remind_at), "09:00") : remind.at) : null;
  if (kind === "reminder" && !remindAt && due) {
    remindAt = due.allDay ? localToUtc(str(input.due_at), "09:00") : due.at;
  }
  if (kind === "reminder" && !due && !remindAt) kind = "task";

  const recRaw = str(input.recurrence).toLowerCase();
  let recur: Recur | null = null;
  if (recRaw && recRaw !== "none") {
    if (!RECURS.includes(recRaw as Recur)) return { ok: false, error: `recurrence must be one of ${RECURS.join(", ")}` };
    recur = recRaw as Recur;
  }
  if (kind === "birthday") recur = "yearly";
  if (recur && !due && !remindAt) return { ok: false, error: "a repeating item needs due_at (the first time it happens)" };

  const proofRaw = str(input.proof_type).toLowerCase() || "none";
  if (!["none", "link", "photo"].includes(proofRaw)) return { ok: false, error: "proof_type must be none, link or photo" };
  const proof = proofRaw as "none" | "link" | "photo";
  let domains: string[] = [];
  if (proof === "link") {
    const given = Array.isArray(input.proof_domains) ? input.proof_domains.filter((d): d is string => typeof d === "string") : [];
    domains = [...new Set((given.length ? given : inferDomains(title)).map(cleanDomain).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))];
  }

  const tm = input.travel_minutes;
  const travel = typeof tm === "number" && Number.isInteger(tm) && tm >= 0 && tm <= 600 ? tm : null;
  const ra = typeof input.remind_again_minutes === "string" ? Number(input.remind_again_minutes) : input.remind_again_minutes;
  const again = typeof ra === "number" && Number.isInteger(ra) && ra >= 5 && ra <= 720 && remindAt ? ra : null;

  return {
    ok: true,
    row: {
      lane_id: lane?.id ?? null,
      kind,
      title,
      notes: str(input.notes).slice(0, 4000) || null,
      due_at: due ? due.at.toISOString() : null,
      all_day: !!due && due.allDay,
      remind_at: remindAt ? remindAt.toISOString() : null,
      recur,
      proof_type: proof,
      proof_domains: domains,
      location: str(input.location).slice(0, 300) || null,
      travel_minutes: travel,
      remind_again_minutes: again,
    },
  };
}
