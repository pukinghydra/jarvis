import { useEffect, useState } from "react";
import { supabase, must } from "../lib/supabase.js";
import { startOfDay } from "../lib/time.js";
import ItemCard from "../components/ItemCard.jsx";

// Everything by area: Buy list first (a checklist), then the other lanes.
// Quick add works without Claude. Lanes can be renamed and recoloured.
export default function Lists({ lanes, reloadLanes, refreshKey, onChange, openFocus, celebrate }) {
  const shown = lanes.filter((l) => l.slug !== "inbox");
  const ordered = [...shown.filter((l) => l.slug === "buy"), ...shown.filter((l) => l.slug !== "buy")];
  const [sel, setSel] = useState(null);
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ title: "", date: "", time: "" });
  const lane = ordered.find((l) => l.id === sel) ?? ordered[0];

  const load = async () => {
    setErr("");
    try {
      const all = must(await supabase.from("items").select("*").eq("status", "open").order("due_at", { nullsFirst: false }).limit(1000)) ?? [];
      const c = {};
      for (const i of all) c[i.lane_id] = (c[i.lane_id] ?? 0) + 1;
      setCounts(c);
      setItems(all.filter((i) => i.lane_id === lane?.id));
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [lane?.id, refreshKey]);

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
      must(await supabase.from("items").insert({
        lane_id: lane.id, title: form.title.trim(), kind: lane.slug === "buy" ? "buy" : "task", due_at, all_day,
        remind_at: due_at && !all_day ? due_at : null, source: "app",
      }));
      setForm({ title: "", date: "", time: "" });
      load(); onChange?.();
    } catch (e) { setErr(e.message); }
  };

  const saveLane = async (l, patch) => {
    try { must(await supabase.from("lanes").update(patch).eq("id", l.id)); reloadLanes(); } catch (e) { setErr(e.message); }
  };
  const newLane = async () => {
    const name = window.prompt("New list name");
    if (!name?.trim()) return;
    const slug = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || `lane-${Date.now()}`;
    try {
      must(await supabase.from("lanes").insert({ slug, name: name.trim().toUpperCase(), color: "#64748B", description: "", sort: 100 + lanes.length * 10 }));
      reloadLanes();
    } catch (e) { setErr(e.message); }
  };
  const nice = (n) => n.charAt(0) + n.slice(1).toLowerCase();

  return (
    <div className="screen">
      <div className="top">
        <div><div className="date">Lists</div><div className="hello">{lane ? (lane.slug === "buy" ? "🛒 Buy list" : nice(lane.name)) : "Lists"}</div></div>
        <button className="icon-btn" onClick={() => setEdit(!edit)} aria-label="Edit lists">{edit ? "✓" : "✎"}</button>
      </div>
      <div className="lane-pills">
        {ordered.map((l) => (
          <button key={l.id} className={l.id === lane?.id ? "on" : ""} style={{ "--lane": l.color }} onClick={() => setSel(l.id)}>
            {l.slug === "buy" ? "🛒 Buy" : nice(l.name)}<span className="n">{counts[l.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {edit && (
        <div className="lane-edit">
          {lanes.map((l) => (
            <div key={l.id} className="row">
              <input type="color" value={l.color} onChange={(e) => saveLane(l, { color: e.target.value.toUpperCase() })} />
              <input className="input" defaultValue={l.name} onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && saveLane(l, { name: e.target.value.trim() })} />
            </div>
          ))}
          <button className="ghost" onClick={newLane}>+ New list</button>
          <p className="muted small">Claude still finds a list by its old key after a rename.</p>
        </div>
      )}

      {lane && (
        <div className="quick-add">
          <input className="input" placeholder={lane.slug === "buy" ? "What to buy (e.g. wool coats)" : `Add to ${nice(lane.name)}`} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
          {lane.slug !== "buy" && form.title && (
            <div className="row" style={{ margin: 0 }}>
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              <input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
          )}
          {form.title && <button className="primary" onClick={add}>Add</button>}
        </div>
      )}

      {err && <div className="err">{err}</div>}
      {items.map((i) => <ItemCard key={`${i.id}:${i.due_at}`} item={i} lane={lane} checklist={lane?.slug === "buy"} openFocus={openFocus} celebrate={celebrate} onChange={() => { load(); onChange?.(); }} />)}
      {!items.length && <div className="calm"><b>🌱</b>Nothing here.</div>}
    </div>
  );
}
