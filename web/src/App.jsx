import { useCallback, useEffect, useState } from "react";
import { configured, supabase, must } from "./lib/supabase.js";
import { registerSW } from "./lib/push.js";
import Login from "./screens/Login.jsx";
import Talk from "./screens/Talk.jsx";
import Today from "./screens/Today.jsx";
import Lanes from "./screens/Lanes.jsx";
import Brief from "./screens/Brief.jsx";
import Settings from "./screens/Settings.jsx";

const TABS = [["capture", "🎙", "Prata"], ["today", "☀️", "Idag"], ["lanes", "🎨", "Områden"], ["brief", "📋", "Brief"], ["settings", "⚙️", "Inställningar"]];
const tabFromUrl = () => {
  const t = new URLSearchParams(location.search).get("tab");
  return TABS.some(([id]) => id === t) ? t : "capture";
};

export default function App() {
  const [session, setSession] = useState(undefined);
  const [isOwner, setIsOwner] = useState(null);
  const [tab, setTab] = useState(tabFromUrl);
  const [lanes, setLanes] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    registerSW();
    const onMsg = (e) => { if (e.data?.type === "open") { history.replaceState(null, "", e.data.url); setTab(tabFromUrl()); bump(); } };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    const onVisible = () => document.visibilityState === "visible" && bump();
    document.addEventListener("visibilitychange", onVisible);
    return () => { data.subscription.unsubscribe(); navigator.serviceWorker?.removeEventListener("message", onMsg); document.removeEventListener("visibilitychange", onVisible); };
  }, [bump]);

  const loadLanes = useCallback(async () => {
    try { setLanes(must(await supabase.from("lanes").select("*").order("sort")) ?? []); } catch { /* shown per screen */ }
  }, []);

  useEffect(() => {
    if (!session) { setIsOwner(null); return; }
    supabase.rpc("claim_owner").then(({ data, error }) => setIsOwner(error ? false : !!data));
  }, [session]);
  useEffect(() => { if (isOwner) loadLanes(); }, [isOwner, loadLanes]);

  const go = (t) => { setTab(t); history.replaceState(null, "", `/?tab=${t}`); };

  if (!configured) return <div className="screen"><div className="err">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set (Vercel → Settings → Environment Variables).</div></div>;
  if (session === undefined) return <div className="screen muted center">…</div>;
  if (!session) return <Login />;
  if (isOwner === null) return <div className="screen muted center">…</div>;
  if (!isOwner) return <div className="screen"><div className="err">Den här Jarvis tillhör någon annan.</div><button className="ghost" onClick={() => supabase.auth.signOut()}>Logga ut</button></div>;

  return (
    <div className="app">
      <main>
        {tab === "capture" && <Talk onSaved={bump} />}
        {tab === "today" && <Today lanes={lanes} refreshKey={refreshKey} onChange={bump} />}
        {tab === "lanes" && <Lanes lanes={lanes} reloadLanes={loadLanes} refreshKey={refreshKey} onChange={bump} />}
        {tab === "brief" && <Brief />}
        {tab === "settings" && <Settings session={session} />}
      </main>
      <nav className="tabs">
        {TABS.map(([id, icon, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => go(id)}><span>{icon}</span>{label}</button>
        ))}
      </nav>
    </div>
  );
}
