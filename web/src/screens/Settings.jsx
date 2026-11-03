import { useEffect, useState } from "react";
import { api, supabase, must } from "../lib/supabase.js";
import { enablePush, pushState, isStandalone } from "../lib/push.js";

export default function Settings({ session }) {
  const [status, setStatus] = useState(null);
  const [owner, setOwner] = useState(null);
  const [push, setPush] = useState("…");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [travel, setTravel] = useState(30);
  const [vips, setVips] = useState("");
  const [copied, setCopied] = useState(false);
  const [style, setStyle] = useState({ sv: "", en: "" });
  const [styleMeta, setStyleMeta] = useState({});
  const [mailRules, setMailRules] = useState("");
  const [ignore, setIgnore] = useState("");

  const load = async () => {
    try {
      const [st, os, sets] = await Promise.all([
        api("status"),
        supabase.rpc("owner_settings").then(must),
        supabase.from("settings").select("key, value").then(must),
      ]);
      setStatus(st); setOwner(os);
      const map = Object.fromEntries(sets.map((r) => [r.key, r.value]));
      setTravel(Number(map.travel_minutes ?? 30));
      setVips((map.vip_senders ?? []).join(", "));
      setMailRules(typeof map.mail_rules === "string" ? map.mail_rules : "");
      setIgnore((map.mail_ignore ?? []).join(", "));
      const ws = map.writing_style ?? {};
      setStyle({ sv: ws.sv ?? "", en: ws.en ?? "" });
      setStyleMeta({ built_at: ws.built_at, samples: ws.samples, edited_at: map.writing_style_edited_at });
    } catch (e) { setErr(e.message); }
    setPush(await pushState().catch(() => "unsupported"));
  };
  useEffect(() => {
    load();
    const q = new URLSearchParams(location.search);
    if (q.get("ms") === "ok") setMsg(`Hotmail connected: ${q.get("account") ?? ""}`);
    if (q.get("ms") === "error") setErr(`Hotmail: ${q.get("reason") ?? "failed"}`);
  }, []);

  const act = async (name, fn) => {
    setBusy(name); setErr(""); setMsg("");
    try { const r = await fn(); if (typeof r === "string") setMsg(r); await load(); } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };
  const saveSetting = (key, value) => act(key, async () => { must(await supabase.from("settings").upsert({ key, value, updated_at: new Date().toISOString() })); return "Saved"; });

  // VIC's edits win: the weekly relearn leaves an edited guide alone for 7 days.
  const saveStyle = () => act("style", async () => {
    const now = new Date().toISOString();
    const { data } = await supabase.from("settings").select("value").eq("key", "writing_style").maybeSingle();
    const value = { ...(data?.value ?? {}), sv: style.sv.trim() || undefined, en: style.en.trim() || undefined };
    must(await supabase.from("settings").upsert([
      { key: "writing_style", value, updated_at: now },
      { key: "writing_style_edited_at", value: now, updated_at: now },
    ]));
    return "Saved. Jarvis writes like this from now on.";
  });
  const relearn = () => {
    if (styleMeta.edited_at && !window.confirm("Relearning replaces your own edits to the style. Continue?")) return;
    act("relearn", async () => {
      const r = await api("style_relearn");
      return r.skipped ?? `Learned from ${r.samples} sent emails (${(r.languages ?? []).join(" + ")}), ${r.examples} examples kept.`;
    });
  };

  const [copiedWhat, setCopiedWhat] = useState("");
  const copy = async (value, what) => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setCopiedWhat(what); setTimeout(() => setCopiedWhat(""), 2500); }
    catch { window.prompt("Copy this", value); }
  };
  const copyMcp = async () => {
    try { await navigator.clipboard.writeText(owner.mcp_url); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt("Copy this URL", owner.mcp_url); }
  };

  const hm = status?.hotmail;
  return (
    <div className="screen settings">
      {msg && <div className="ok">{msg}</div>}
      {err && <div className="err">{err}</div>}

      <section>
        <h3>Connect to Claude</h3>
        <p className="muted small">Claude app → Settings → Connectors → Add custom connector → paste this URL. Keep it secret: it is the key to Jarvis.</p>
        <button className="primary" onClick={copyMcp} disabled={!owner?.mcp_url}>{copied ? "Copied ✓" : "Copy connector URL"}</button>
      </section>

      <section>
        <h3>Jarvis Talk shortcut (iPhone)</h3>
        <p className="muted small">Talk to Jarvis with Apple's dictation: home-screen icon, Action Button or "Hey Siri, Jarvis". Copy these two into the shortcut. Keep the key secret.</p>
        <div className="row">
          <button className="ghost" onClick={() => copy(owner?.shortcut_url, "url")} disabled={!owner?.shortcut_url}>{copiedWhat === "url" ? "Copied ✓" : "Copy address"}</button>
          <button className="primary" onClick={() => copy(owner?.shortcut_key, "key")} disabled={!owner?.shortcut_key}>{copiedWhat === "key" ? "Copied ✓" : "Copy key"}</button>
        </div>
      </section>

      <section>
        <h3>Alerts on this device</h3>
        <p className="muted small">Status: {push}{!isStandalone() ? " · on iPhone, add Jarvis to the Home Screen first (Share → Add to Home Screen)" : ""}</p>
        <div className="row">
          <button className="primary" disabled={!!busy || push === "on"} onClick={() => act("push", async () => { await enablePush(); return "Alerts are on for this device"; })}>Turn alerts on</button>
          <button className="ghost" disabled={!!busy} onClick={() => act("test", async () => { const r = await api("push_test"); return `Test sent to ${r.sent}/${r.devices} devices`; })}>Send test</button>
        </div>
      </section>

      <section>
        <h3>Hotmail</h3>
        <p className="muted small">{hm?.connected ? `Connected: ${hm.account ?? "yes"}` : status?.hotmail_ready ? "Not connected" : "Waiting for MS_CLIENT_ID / MS_CLIENT_SECRET in the function secrets"}</p>
        <div className="row">
          {!hm?.connected && <button className="primary" disabled={!!busy || !status?.hotmail_ready} onClick={() => act("ms", async () => { const { url } = await api("ms_start"); location.href = url; })}>Connect Hotmail</button>}
          {hm?.connected && <button className="ghost" disabled={!!busy} onClick={() => act("scan", async () => {
            const r = await api("scan_now");
            if (r.skipped) return r.skipped;
            const t = r.triage;
            if (!t) return `Fetched ${r.fetched}, new ${r.new}, flagged ${r.flagged}`;
            if (t.running) return `Fetched ${r.fetched}, new ${r.new}. Sorting with Claude — alerts will follow.`;
            if (t.error || t.skipped) return `Fetched ${r.fetched}, new ${r.new}. Sorting: ${t.error ?? t.skipped}`;
            return `Fetched ${r.fetched}, new ${r.new}. Sorted ${t.triaged}: ${t.urgent} urgent, ${t.important} important, ${t.noise} noise · ${t.drafts} drafts · ${t.items} to-dos`;
          })}>{busy === "scan" ? "Checking…" : "Check mail now"}</button>}
          {hm?.connected && <button className="ghost danger" disabled={!!busy} onClick={() => window.confirm("Disconnect Hotmail?") && act("msd", async () => { await api("ms_disconnect"); return "Disconnected"; })}>Disconnect</button>}
        </div>
        <label className="field">VIP senders (always flagged) — addresses or @domains, comma separated
          <input className="input" value={vips} onChange={(e) => setVips(e.target.value)} onBlur={() => saveSetting("vip_senders", vips.split(",").map((v) => v.trim()).filter(Boolean))} placeholder="richie@…, @skatteverket.se" />
        </label>
      </section>

      {hm?.connected && (
        <section>
          <h3>Mail rules</h3>
          <p className="muted small">Your rules for sorting mail, in your own words. Jarvis follows them for every new email. You can also say "ignorera allt från …" to Jarvis.</p>
          <textarea className="input" rows={8} value={mailRules} onChange={(e) => setMailRules(e.target.value)} />
          <label className="field">Always noise (addresses or @domains, comma separated)
            <input className="input" value={ignore} onChange={(e) => setIgnore(e.target.value)} onBlur={() => saveSetting("mail_ignore", ignore.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean))} placeholder="@nyhetsbrev.se, info@butik.se" />
          </label>
          <div className="row">
            <button className="primary" disabled={!!busy || !mailRules.trim()} onClick={() => saveSetting("mail_rules", mailRules.trim())}>Save rules</button>
          </div>
        </section>
      )}

      {status?.claude_api && hm?.connected && (
        <section>
          <h3>How Jarvis writes as you</h3>
          <p className="muted small">
            Learned from your Sent mail{styleMeta.built_at ? ` (${String(styleMeta.built_at).slice(0, 10)}, ${styleMeta.samples ?? "?"} emails)` : " — not learned yet"}. Edit freely: your version is kept, and the Monday relearn skips it for 7 days.
          </p>
          <label className="field">Svenska
            <textarea className="input" rows={8} value={style.sv} onChange={(e) => setStyle({ ...style, sv: e.target.value })} placeholder="Tryck på Relearn my style" />
          </label>
          <label className="field">English
            <textarea className="input" rows={8} value={style.en} onChange={(e) => setStyle({ ...style, en: e.target.value })} placeholder="Tap Relearn my style" />
          </label>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={saveStyle}>Save</button>
            <button className="ghost" disabled={!!busy} onClick={relearn}>{busy === "relearn" ? "Learning…" : "Relearn my style"}</button>
          </div>
        </section>
      )}

      <section>
        <h3>Voice</h3>
        <p className="muted small">Speech to text: {status ? (status.speech_to_text ?? "off: add OPENAI_API_KEY in the Supabase function secrets") : "–"}</p>
        <p className="muted small">Tap the mic to record, tap again to stop, check the text, then Skicka. Answers are text only.</p>
      </section>

      <section>
        <h3>Leave-now alerts</h3>
        <label className="field">Minutes to get somewhere (default)
          <input className="input" type="number" min="0" max="600" value={travel} onChange={(e) => setTravel(e.target.value)} onBlur={() => saveSetting("travel_minutes", Math.max(0, Math.min(600, Number(travel) || 30)))} />
        </label>
      </section>

      <section>
        <h3>Status</h3>
        <ul className="status-list">
          <li>iPhone calendar: {status?.calendar_write?.configured
            ? (status.calendar_write.ok ? `read + write (${status.calendar_write.calendars.join(", ")}; new events go to ${status.calendar_write.default_calendar})` : `error: ${status.calendar_write.error ?? "not checked yet"}`)
            : `read only (${status?.calendars ?? 0} share link${status?.calendars === 1 ? "" : "s"})`}</li>
          <li>THRIFTIN data: {status ? (status.thriftin ? "connected" : "not connected") : "–"}</li>
          <li>Auto-sort notes (Claude API): {status ? (status.claude_api ? "on" : "off — sort them in the Claude app") : "–"}</li>
          <li>Email sorting + drafts (Claude API): {status ? (status.claude_api ? "on — every 15 min, 07–23" : "off — rule flags only") : "–"}</li>
        </ul>
      </section>

      <section>
        <p className="muted small">Signed in as {session.user.email}</p>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>
    </div>
  );
}
