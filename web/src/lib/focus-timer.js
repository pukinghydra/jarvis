// When VIC pressed Start on a task (kept on this phone, so the ring keeps
// counting after the app closes). Per item; cleared when it's done.
const key = (id) => `jarvis.focus.${id}`;
export function startedAt(id) {
  try { const v = Number(localStorage.getItem(key(id))); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}
export function start(id) { try { localStorage.setItem(key(id), String(Date.now())); } catch { /* private mode */ } return Date.now(); }
export function clear(id) { try { localStorage.removeItem(key(id)); } catch { /* ignore */ } }
const stepsKey = (id) => `jarvis.steps.${id}`;
export function tickedSteps(id) { try { return JSON.parse(localStorage.getItem(stepsKey(id)) || "[]"); } catch { return []; } }
export function saveTicked(id, list) { try { localStorage.setItem(stepsKey(id), JSON.stringify(list)); } catch { /* ignore */ } }
export const fmt = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
