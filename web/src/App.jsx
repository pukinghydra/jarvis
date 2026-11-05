import { useCallback, useEffect, useState } from "react";
import { api, configured, supabase, must } from "./lib/supabase.js";
import { registerSW } from "./lib/push.js";
import { startTheme } from "./lib/theme.js";
import Login from "./screens/Login.jsx";
import Today from "./screens/Today.jsx";
import Mail, { needsYou } from "./screens/Mail.jsx";
import Lists from "./screens/Lists.jsx";
import Settings from "./screens/Settings.jsx";
import Focus from "./components/Focus.jsx";
import Celebrate from "./components/Celebrate.jsx";

// Three tabs: Today (timeline), Mail (only what needs you), Lists. Settings
// sits behind the gear. Talking happens in the Claude app (Action Button).
const TABS = [["today", "☀️", "Today"], ["mail", "✉️", "Mail"], ["lists", "🛍", "Lists"]];
const OLD = { capture: "today", brief: "today", lanes: "lists" };
const tabFromUrl = () => {
  const raw = new URLSearchParams(location.search).get("tab") || "today";
  const t = OLD[raw] ?? raw;
  return t === "settings" || TABS.some(([id]) => id === t) ? t : "today";
};
const itemFromUrl = () => new URLSearchParams(location.search).get("item");

export default function App() {
  const [session, setSession] = useState(undefined);
  const [isOwner, setIsOwner] = useState(null);
  const [tab, setTab] = useState(tabFromUrl);
  const [lanes, setLanes] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [focus, setFocus] = useState(null);
  const [cheer, setCheer] = useState(false);
  const [stats, setStats] = useState(null);
  const [mailCount, setMailCount] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => startTheme(), []);

  // A push names one item: open it straight in Focus.
  const openFromUrl = useCallback(async () => {
    const id = itemFromUrl();
    if (!id) return;
    history.replaceState(null, "", `/?tab=${tabFromUrl()}`);
    const { data } = await supabase.from("items").select("*").eq("id", id).maybeSingle();
    if (data && data.status === "open") setFocus({ item: data, auto: false });
  }, []);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    registerSW();
    const onMsg = (e) => { if (e.data?.type === "open") { history.replaceState(null, "", e.data.url); setTab(tabFromUrl()); bump(); openFromUrl(); } };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    const onVisible = () => document.visibilityState === "visible" && bump();
    document.addEventListener("visibilitychange", onVisible);
    return () => { data.subscription.unsubscribe(); navigator.serviceWorker?.removeEventListener("message", onMsg); document.removeEventListener("visibilitychange", onVisible); };
  }, [bump, openFromUrl]);

  const loadLanes = useCallback(async () => {
    try { setLanes(must(await supabase.from("lanes").select("*").order("sort")) ?? []); } catch { /* shown per screen */ }
  }, []);

  useEffect(() => {
    if (!session) { setIsOwner(null); return; }
    supabase.rpc("claim_owner").then(({ data, error }) => setIsOwner(error ? false : !!data));
  }, [session]);
  useEffect(() => { if (isOwner) { loadLanes(); openFromUrl(); } }, [isOwner, loadLanes, openFromUrl]);

  // Streak + how many emails need VIC (the Mail tab's badge).
  useEffect(() => {
    if (!isOwner) return;
    api("stats").then(setStats).catch(() => {});
    supabase.from("emails").select("id, status, importance, flagged, triaged_at, received_at").in("status", ["new", "drafted"]).limit(400)
      .then(({ data }) => setMailCount(needsYou(data ?? []).length));
  }, [isOwner, refreshKey]);

  const go = (t) => { setTab(t); history.replaceState(null, "", `/?tab=${t}`); window.scrollTo(0, 0); };
  const openFocus = useCallback((item, auto) => setFocus({ item, auto }), []);
  const celebrate = useCallback(() => setCheer(true), []);
  const endCheer = useCallback(() => setCheer(false), []);
  const laneOf = (item) => lanes.find((l) => l.id === item?.lane_id);

  if (!configured) return <div className="screen"><div className="err">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set (Vercel → Settings → Environment Variables).</div></div>;
  if (session === undefined) return <div className="screen muted center">…</div>;
  if (!session) return <Login />;
  if (isOwner === null) return <div className="screen muted center">…</div>;
  if (!isOwner) return <div className="screen"><div className="err">This Jarvis belongs to someone else.</div><button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></div>;

  const shared = { lanes, refreshKey, onChange: bump, openFocus, celebrate };
  return (
    <div className="app">
      <main>
        {tab === "today" && <Today {...shared} go={go} mailCount={mailCount} stats={stats} />}
        {tab === "mail" && <Mail refreshKey={refreshKey} onChange={bump} />}
        {tab === "lists" && <Lists {...shared} reloadLanes={loadLanes} />}
        {tab === "settings" && <Settings session={session} onBack={() => go("today")} />}
      </main>
      {tab !== "settings" && (
        <nav className="nav">
          {TABS.map(([id, icon, label]) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => go(id)}>
              {icon} {label}{id === "mail" && mailCount > 0 ? <span className="count-dot">{mailCount}</span> : null}
            </button>
          ))}
        </nav>
      )}
      {focus && (
        <Focus
          key={focus.item.id}
          item={focus.item}
          lane={laneOf(focus.item)}
          autoStart={focus.auto}
          onClose={() => setFocus(null)}
          onChanged={bump}
          onDone={() => { setFocus(null); setCheer(true); bump(); }}
        />
      )}
      {cheer && <Celebrate streak={stats?.streak} onEnd={endCheer} />}
    </div>
  );
}
