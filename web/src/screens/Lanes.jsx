import { useEffect, useState } from "react";
import { supabase, must } from "../lib/supabase.js";
import { startOfDay } from "../lib/time.js";
import ItemCard from "../components/ItemCard.jsx";

// Coloured lanes. Pick one to see its items; BUY IN shows as a checklist.
// Quick add works without Claude; rename/recolour/add lanes here.
export default function Lanes({ lanes, reloadLanes, refreshKey, onChange }) {
  const [sel, setSel] = useState(lanes[0]?.id ?? null);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ title: "", date: "", time: "", proof: "none" });
  const lane = lanes.find((l) => l.id === sel);

  const load = async () => {
    setErr("");
    try {
      const all = must(await supabase.from("items").select("*").eq("status", "open").order("due_at", { nullsFirst: false }).limit(1000)) ?? [];
      const c = {};
      for (const i of all) c[i.lane_id] = (c[i.lane_id] ?? 0) + 1;
      setCounts(c);
      setItems(all.filter((i) => i.lane_id === sel));
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [sel, refreshKey]);
  useEffect(() => { if (!sel && lanes[0]) setSel(lanes[0].id); }, [lanes]);

  const add = async () => {
    if (!form.title.trim() || !lane) return;
    setErr("");
    try {
      let due_at = null, all_day = false;
      if (form.date) {
        const day = startOfDay(form.date);
        if (form.time) {
          const [h, m] = form.time.split(":").map(Number);
          due_at = new Date(day.getTime() + (h * 60 + m) * 60000).toISOString();
        } else { due_at = day.toISOString(); all_day = true; }
      }
      const proof = form.proof;
      const domains = proof === "link" ? (/tiktok/i.test(form.title) ? ["tiktok.com"] : /insta/i.test(form.title) ? ["instagram.com"] : []) : [];
      must(await supabase.from("items").insert({
        lane_id: lane.id, title: form.title.trim(), kind: lane.slug === "buy" ? "buy" : "task", due_at, all_day,
        remind_at: due_at && !all_day ? due_at : null, proof_type: proof, proof_domains: domains, source: "app",
      }));
      setForm({ title: "", date: "", time: "", proof: "none" });
      load(); onChange?.();
    } catch (e) { setErr(e.message); }
  };

  const saveLane = async (l, patch) => {
    try { must(await supabase.from("lanes").update(patch).eq("id", l.id)); reloadLanes(); } catch (e) { setErr(e.message); }
  };
  const newLane = async () => {
    const name = window.prompt("New lane name");
    if (!name?.trim()) return;
    const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || `lane-${Date.now()}`;
    try {
      must(await supabase.from("lanes").insert({ slug, name: name.trim().toUpperCase(), color: "#64748B", description: "", sort: 100 + lanes.length * 10 }));
      reloadLanes();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="screen">
      <div className="chips">
        {lanes.map((l) => (
          <button key={l.id} className={`chip${l.id === sel ? " on" : ""}`} style={{ "--c": l.color }} onClick={() => setSel(l.id)}>
            {l.name} <span className="count">{counts[l.id] ?? 0}</span>
          </button>
        ))}
        <button className="chip ghost" onClick={() => setEdit(!edit)}>{edit ? "Done" : "Edit lanes"}</button>
      </div>

      {edit && (
        <div className="lane-edit">
          {lanes.map((l) => (
            <div key={l.id} className="row">
              <input type="color" value={l.color} onChange={(e) => saveLane(l, { color: e.target.value.toUpperCase() })} />
              <input className="input" defaultValue={l.name} onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && saveLane(l, { name: e.target.value.trim() })} />
            </div>
          ))}
          <button className="ghost" onClick={newLane}>+ New lane</button>
          <p className="muted small">Lane keys (for Claude) stay the same when you rename.</p>
        </div>
      )}

      {lane && (
        <div className="quick-add" style={{ borderColor: lane.color }}>
          <input className="input" placeholder={lane.slug === "buy" ? "What to buy (e.g. wool coats)" : `Add to ${lane.name}`} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
          {lane.slug !== "buy" && (
            <div className="row">
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              <input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              <select className="input" value={form.proof} onChange={(e) => setForm({ ...form, proof: e.target.value })}>
                <option value="none">No proof</option><option value="link">Proof: link</option><option value="photo">Proof: photo</option>
              </select>
            </div>
          )}
          <button className="primary" onClick={add} disabled={!form.title.trim()}>Add</button>
        </div>
      )}

      {err && <div className="err">{err}</div>}
      {items.map((i) => <ItemCard key={i.id} item={i} lane={lane} checklist={lane?.slug === "buy"} onChange={() => { load(); onChange?.(); }} />)}
      {!items.length && <p className="muted center">Empty.</p>}
    </div>
  );
}
