import { useEffect, useState } from "react";
import { supabase, must } from "../lib/supabase.js";
import { dayLabel, time } from "../lib/time.js";
import { useSwipeClose } from "../lib/swipe.js";
import { mailtoForEmail } from "../lib/mailto.js";

// One email exactly as it arrived (original language, never translated),
// with Jarvis's draft reply under it. Opens over the current screen.
// Close: ✕ (always visible at the top), swipe left, tap the dark area, or
// the Close button at the bottom.
export default function EmailSheet({ id, onClose, onChange }) {
  const [e, setE] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const swipe = useSwipeClose(onClose);

  useEffect(() => {
    let live = true;
    supabase.from("emails")
      .select("id, from_name, from_address, subject, received_at, body, preview, importance, summary, status, draft_text, draft_language")
      .eq("id", id).maybeSingle()
      .then(({ data, error }) => { if (!live) return; if (error) setErr(error.message); else setE(data); });
    return () => { live = false; };
  }, [id]);

  const handled = async () => {
    setBusy(true); setErr("");
    try {
      must(await supabase.from("emails").update({ status: "handled", handled_at: new Date().toISOString() }).eq("id", id));
      onChange?.(); onClose();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  const mailto = mailtoForEmail(e);

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet email-sheet" onClick={(x) => x.stopPropagation()} {...swipe}>
        <div className="sheet-top">
          <span className="muted small">← swipe left to close</span>
          <button className="close-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {err && <div className="err">{err}</div>}
        {!e && !err && <p className="muted center">Loading…</p>}
        {e && (
          <>
            <div className="email-head">
              <div className="email-subject">{e.subject || "(no subject)"}</div>
              <div className="muted small">
                {e.from_name || e.from_address}{e.from_name && e.from_address ? ` <${e.from_address}>` : ""}
                {e.received_at ? ` · ${dayLabel(e.received_at)} ${time(e.received_at)}` : ""}
              </div>
              {e.summary && <div className="email-summary">{e.importance === "urgent" ? "🔴 " : e.importance === "important" ? "🟠 " : ""}{e.summary}</div>}
            </div>

            {e.draft_text && (
              <div className="email-draft">
                <div className="muted small">Jarvis's draft reply{e.draft_language ? ` (${e.draft_language})` : ""}. Open in Mail: your mail app opens with it written, the email quoted under it. Check it, press Send.</div>
                <div className="email-body">{e.draft_text}</div>
                {mailto && <a className="primary button-link" href={mailto}>✉️ Open in Mail</a>}
              </div>
            )}

            <div className="muted small">The email:</div>
            <div className="email-body">{e.body || e.preview || "(empty)"}</div>

            <div className="row">
              {e.status !== "handled" && <button className="ghost" onClick={handled} disabled={busy}>Mark handled</button>}
              <button className="ghost" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
