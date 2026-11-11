import { useEffect, useState } from "react";
import { api, supabase, must } from "../lib/supabase.js";
import { useSwipeClose } from "../lib/swipe.js";
import { emojiFor } from "../lib/emoji.js";
import { when } from "../lib/time.js";
import { snoozePatch } from "../lib/snooze.js";
import { openInMailHref } from "../lib/mailto.js";
import { haptic } from "../lib/haptic.js";
import * as timer from "../lib/focus-timer.js";
import SnoozeSheet from "./SnoozeSheet.jsx";

// One thing on the whole screen: a ring that counts down its minutes, the
// first step (or small steps to tick), a big Done, and Not now / Split it.
// Close with ✕ or a swipe left.
export default function Focus({ item: initial, lane, autoStart, onClose, onChanged, onDone }) {
  const [item, setItem] = useState(initial);
  const [started, setStarted] = useState(() => timer.startedAt(initial.id) ?? (autoStart ? timer.start(initial.id) : null));
  const [now, setNow] = useState(Date.now());
  const [ticked, setTicked] = useState(() => timer.tickedSteps(initial.id));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [snooze, setSnooze] = useState(false);
  const [mailHref, setMailHref] = useState(null);
  const swipe = useSwipeClose(onClose);

  useEffect(() => { if (!started) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [started]);
  useEffect(() => {
    if (!item.email_id) return;
    supabase.from("emails").select("internet_message_id").eq("id", item.email_id).maybeSingle().then(({ data }) => setMailHref(openInMailHref(data)));
  }, [item.email_id]);

  const mins = item.minutes || null;
  const elapsed = started ? now - started : 0;
  const total = (mins ?? 10) * 60000;
  const p = started ? Math.min(100, (elapsed / total) * 100) : 0;
  const over = started && mins && elapsed > total;
  const steps = Array.isArray(item.steps) ? item.steps : [];

  const run = async (name, fn) => {
    setBusy(name); setErr("");
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };
  // Confetti and a buzz the moment Done is tapped; saving happens behind it.
  const done = () => {
    if (busy) return;
    haptic();
    timer.clear(item.id); timer.saveTicked(item.id, []);
    onDone?.(item, api("complete", { id: item.id }));
  };
  const pickSnooze = (at) => run("snooze", async () => {
    must(await supabase.from("items").update(snoozePatch(item, at)).eq("id", item.id));
    setSnooze(false); timer.clear(item.id);
    onChanged?.(); onClose();
  });
  const split = () => run("split", async () => {
    const saved = await api("split", { id: item.id });
    setItem(saved); setTicked([]); timer.saveTicked(item.id, []);
    onChanged?.();
  });
  const del = () => window.confirm(`Delete "${item.title}"?`) && run("delete", async () => {
    must(await supabase.from("items").delete().eq("id", item.id));
    timer.clear(item.id); onChanged?.(); onClose();
  });
  const tick = (i) => {
    const next = ticked.includes(i) ? ticked.filter((x) => x !== i) : [...ticked, i];
    setTicked(next); timer.saveTicked(item.id, next);
  };
  const startNow = () => setStarted(timer.start(item.id));

  return (
    <>
    <div className="focus" style={{ "--lane": lane?.color, "--ring": lane?.color ? `color-mix(in srgb, ${lane.color} 80%, #000)` : undefined }} {...swipe}>
      <div className="focus-in">
        <div className="focus-top">
          <span className="lane-chip lane-bg">{lane?.name ?? "TODAY"}</span>
          <button className="close-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <button className="ring" style={{ "--p": `${p}%`, padding: 0, minHeight: 0, background: undefined }} onClick={started ? undefined : startNow} aria-label={started ? "Timer" : "Start the timer"}>
          <div>
            <div>
              <div className="e">{emojiFor(item, lane?.slug)}</div>
              {started ? (
                <>
                  <div className="c">{over ? `+${timer.fmt(elapsed - total)}` : mins ? timer.fmt(total - elapsed) : timer.fmt(elapsed)}</div>
                  <div className="l">{over ? "over time, no stress" : mins ? `of ${mins} min` : "so far"}</div>
                </>
              ) : (
                <>
                  <div className="c" style={{ fontSize: 22 }}>▶ Start</div>
                  <div className="l">{mins ? `about ${mins} min` : "tap to start"}</div>
                </>
              )}
            </div>
          </div>
        </button>

        <div className="ft">{item.title}</div>
        {item.due_at && <div className="fmeta">{when(item)}{item.location ? ` · @ ${item.location}` : ""}</div>}

        {steps.length > 0 ? (
          <div className="steps">
            {steps.map((s, i) => (
              <button key={i} className={ticked.includes(i) ? "ticked" : ""} onClick={() => tick(i)}><span className="box">{ticked.includes(i) ? "✓" : ""}</span>{s}</button>
            ))}
          </div>
        ) : item.first_step ? (
          <div className="step"><span style={{ fontSize: 22 }}>👉</span><div><small>FIRST STEP</small>{item.first_step}</div></div>
        ) : null}

        {err && <div className="err">{err}</div>}
        <button className="done-big" onClick={done} disabled={!!busy}>{busy === "done" ? "…" : "✓ Done"}</button>
        <div className="row2">
          <button onClick={() => setSnooze(true)} disabled={!!busy}>⏰ Not now</button>
          <button onClick={split} disabled={!!busy}>{busy === "split" ? "Splitting…" : steps.length ? "✂️ Split again" : "✂️ Split it"}</button>
        </div>
        {mailHref && <a className="button-link small ghost center-block" style={{ width: "fit-content" }} href={mailHref}>📬 Open the email in Mail</a>}
        {item.notes && <div className="notes-box">{item.notes}</div>}
        <button className="ghost small center-block danger" onClick={del} disabled={!!busy}>🗑 Delete</button>
      </div>
    </div>
    {/* Outside the swipeable Focus panel, so swiping the sheet doesn't close Focus too. */}
    {snooze && <SnoozeSheet onPick={pickSnooze} onClose={() => setSnooze(false)} />}
    </>
  );
}
