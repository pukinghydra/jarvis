import { useState } from "react";
import { api, supabase } from "../lib/supabase.js";

// Proof to close: paste the post's link, or add a photo.
export default function ProofSheet({ item, onClose, onDone }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const domains = item.proof_domains?.length ? item.proof_domains.join(" or ") : "the post";

  const paste = async () => {
    try { setUrl((await navigator.clipboard.readText()).trim()); } catch { setErr("Couldn't read the clipboard: long-press the box and Paste."); }
  };
  const sendLink = async () => {
    setBusy(true); setErr("");
    try { await api("complete", { id: item.id, proof_url: url.trim() }); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const sendPhoto = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${item.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("proof").upload(path, file, { contentType: file.type || "image/jpeg" });
      if (error) throw new Error(error.message);
      await api("complete", { id: item.id, proof_path: path });
      onDone();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Proof: {item.title}</h3>
        {item.proof_type === "link" ? (
          <>
            <p className="muted">Paste the link to {domains}.</p>
            <input className="input" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <div className="row">
              <button className="ghost" onClick={paste} disabled={busy}>Paste</button>
              <button className="primary" onClick={sendLink} disabled={busy || !url.trim()}>Close it</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Take or pick a photo as proof.</p>
            <label className="primary file">
              {busy ? "Uploading…" : "Add photo"}
              <input type="file" accept="image/*" capture="environment" onChange={(e) => sendPhoto(e.target.files?.[0])} disabled={busy} hidden />
            </label>
          </>
        )}
        {err && <div className="err">{err}</div>}
        <button className="ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
