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
    if (q.get("ms") === "ok") setMsg(`Hotmail kopplad: ${q.get("account") ?? ""}`);
    if (q.get("ms") === "error") setErr(`Hotmail: ${q.get("reason") ?? "misslyckades"}`);
  }, []);

  const act = async (name, fn) => {
    setBusy(name); setErr(""); setMsg("");
    try { const r = await fn(); if (typeof r === "string") setMsg(r); await load(); } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };
  const saveSetting = (key, value) => act(key, async () => { must(await supabase.from("settings").upsert({ key, value, updated_at: new Date().toISOString() })); return "Sparat"; });

  // VIC's edits win: the weekly relearn leaves an edited guide alone for 7 days.
  const saveStyle = () => act("style", async () => {
    const now = new Date().toISOString();
    const { data } = await supabase.from("settings").select("value").eq("key", "writing_style").maybeSingle();
    const value = { ...(data?.value ?? {}), sv: style.sv.trim() || undefined, en: style.en.trim() || undefined };
    must(await supabase.from("settings").upsert([
      { key: "writing_style", value, updated_at: now },
      { key: "writing_style_edited_at", value: now, updated_at: now },
    ]));
    return "Sparat. Jarvis skriver så här från och med nu.";
  });
  const relearn = () => {
    if (styleMeta.edited_at && !window.confirm("Att lära om ersätter dina egna ändringar. Fortsätta?")) return;
    act("relearn", async () => {
      const r = await api("style_relearn");
      return r.skipped ?? `Lärde sig av ${r.samples} skickade mejl (${(r.languages ?? []).join(" + ")}), ${r.examples} exempel sparade.`;
    });
  };

  const copyMcp = async () => {
    try { await navigator.clipboard.writeText(owner.mcp_url); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt("Kopiera adressen", owner.mcp_url); }
  };

  const hm = status?.hotmail;
  return (
    <div className="screen settings">
      {msg && <div className="ok">{msg}</div>}
      {err && <div className="err">{err}</div>}

      <section>
        <h3>Koppla till Claude</h3>
        <p className="muted small">Claude-appen → Inställningar → Connectors → Lägg till → klistra in adressen. Håll den hemlig: den är nyckeln till Jarvis.</p>
        <button className="primary" onClick={copyMcp} disabled={!owner?.mcp_url}>{copied ? "Kopierad ✓" : "Kopiera adressen"}</button>
      </section>

      <section>
        <h3>Notiser på den här enheten</h3>
        <p className="muted small">Status: {push === "on" ? "på" : push}{!isStandalone() ? " · på iPhone: lägg Jarvis på hemskärmen först (Dela → Lägg till på hemskärmen)" : ""}</p>
        <div className="row">
          <button className="primary" disabled={!!busy || push === "on"} onClick={() => act("push", async () => { await enablePush(); return "Notiser är på för den här enheten"; })}>Slå på notiser</button>
          <button className="ghost" disabled={!!busy} onClick={() => act("test", async () => { const r = await api("push_test"); return `Test skickad till ${r.sent}/${r.devices} enheter`; })}>Skicka test</button>
        </div>
      </section>

      <section>
        <h3>Hotmail</h3>
        <p className="muted small">{hm?.connected ? `Kopplad: ${hm.account ?? "ja"}` : status?.hotmail_ready ? "Inte kopplad" : "Väntar på MS_CLIENT_ID / MS_CLIENT_SECRET"}</p>
        <div className="row">
          {!hm?.connected && <button className="primary" disabled={!!busy || !status?.hotmail_ready} onClick={() => act("ms", async () => { const { url } = await api("ms_start"); location.href = url; })}>Koppla Hotmail</button>}
          {hm?.connected && <button className="ghost" disabled={!!busy} onClick={() => act("scan", async () => {
            const r = await api("scan_now");
            if (r.skipped) return r.skipped;
            const t = r.triage;
            if (!t) return `Hämtade ${r.fetched}, nya ${r.new}, flaggade ${r.flagged}`;
            if (t.running) return `Hämtade ${r.fetched}, nya ${r.new}. Sorterar nu, notiser kommer.`;
            if (t.error || t.skipped) return `Hämtade ${r.fetched}, nya ${r.new}. Sortering: ${t.error ?? t.skipped}`;
            return `Hämtade ${r.fetched}, nya ${r.new}. Sorterade ${t.triaged}: ${t.urgent} brådskande, ${t.important} viktiga, ${t.noise} skräp · ${t.drafts} utkast · ${t.items} att göra`;
          })}>{busy === "scan" ? "Kollar…" : "Kolla mejlen nu"}</button>}
          {hm?.connected && <button className="ghost danger" disabled={!!busy} onClick={() => window.confirm("Koppla bort Hotmail?") && act("msd", async () => { await api("ms_disconnect"); return "Bortkopplad"; })}>Koppla bort</button>}
        </div>
        <label className="field">VIP-avsändare (alltid viktiga): adresser eller @domäner, kommaseparerat
          <input className="input" value={vips} onChange={(e) => setVips(e.target.value)} onBlur={() => saveSetting("vip_senders", vips.split(",").map((v) => v.trim()).filter(Boolean))} placeholder="richie@…, @skatteverket.se" />
        </label>
      </section>

      {hm?.connected && (
        <section>
          <h3>Mejlregler</h3>
          <p className="muted small">Dina regler för mejlen, med dina egna ord. Jarvis följer dem för varje nytt mejl. Du kan också säga "ignorera allt från …" under Prata.</p>
          <textarea className="input" rows={8} value={mailRules} onChange={(e) => setMailRules(e.target.value)} />
          <label className="field">Alltid skräp (adresser eller @domäner, kommaseparerat)
            <input className="input" value={ignore} onChange={(e) => setIgnore(e.target.value)} onBlur={() => saveSetting("mail_ignore", ignore.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean))} placeholder="@nyhetsbrev.se, info@butik.se" />
          </label>
          <div className="row">
            <button className="primary" disabled={!!busy || !mailRules.trim()} onClick={() => saveSetting("mail_rules", mailRules.trim())}>Spara regler</button>
          </div>
        </section>
      )}

      {status?.claude_api && hm?.connected && (
        <section>
          <h3>Så skriver Jarvis som du</h3>
          <p className="muted small">
            Inlärt från dina skickade mejl{styleMeta.built_at ? ` (${String(styleMeta.built_at).slice(0, 10)}, ${styleMeta.samples ?? "?"} mejl)` : " (inte inlärt än)"}. Ändra fritt: din version sparas och måndagens omlärning rör den inte på 7 dagar.
          </p>
          <label className="field">Svenska
            <textarea className="input" rows={8} value={style.sv} onChange={(e) => setStyle({ ...style, sv: e.target.value })} placeholder="Tryck på Lär om min stil" />
          </label>
          <label className="field">English
            <textarea className="input" rows={8} value={style.en} onChange={(e) => setStyle({ ...style, en: e.target.value })} placeholder="Tryck på Lär om min stil" />
          </label>
          <div className="row">
            <button className="primary" disabled={!!busy} onClick={saveStyle}>Spara</button>
            <button className="ghost" disabled={!!busy} onClick={relearn}>{busy === "relearn" ? "Lär sig…" : "Lär om min stil"}</button>
          </div>
        </section>
      )}

      <section>
        <h3>Röst</h3>
        <p className="muted small">Tal till text: {status ? (status.speech_to_text ?? "av: lägg till OPENAI_API_KEY i Supabase-hemligheterna") : "–"}</p>
        <p className="muted small">Tryck på mikrofonen för att spela in, tryck igen för att stoppa, kolla texten och tryck Skicka. Svaren kommer som text.</p>
      </section>

      <section>
        <h3>Dags att gå-notiser</h3>
        <label className="field">Minuter att ta sig dit (standard)
          <input className="input" type="number" min="0" max="600" value={travel} onChange={(e) => setTravel(e.target.value)} onBlur={() => saveSetting("travel_minutes", Math.max(0, Math.min(600, Number(travel) || 30)))} />
        </label>
      </section>

      <section>
        <h3>Status</h3>
        <ul className="status-list">
          <li>Kalendrar kopplade: {status?.calendars ?? "–"}</li>
          <li>THRIFTIN: {status ? (status.thriftin ? "kopplad" : "inte kopplad") : "–"}</li>
          <li>Sortera anteckningar (Claude API): {status ? (status.claude_api ? "på" : "av") : "–"}</li>
          <li>Mejlsortering + utkast (Claude API): {status ? (status.claude_api ? "på, var 15:e minut 07–23" : "av") : "–"}</li>
        </ul>
      </section>

      <section>
        <p className="muted small">Inloggad som {session.user.email}</p>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Logga ut</button>
      </section>
    </div>
  );
}
