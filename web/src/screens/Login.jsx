import { useState } from "react";
import { supabase } from "../lib/supabase.js";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const go = async (signup) => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const fn = signup ? supabase.auth.signUp : supabase.auth.signInWithPassword;
      const { data, error } = await fn.call(supabase.auth, { email: email.trim(), password });
      if (error) throw error;
      if (signup && !data.session) setMsg("Kolla din mejl och bekräfta, logga sedan in.");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="screen login">
      <h1>Jarvis</h1>
      <input className="input" type="email" autoComplete="username" placeholder="Mejl" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="input" type="password" autoComplete="current-password" placeholder="Lösenord" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go(false)} />
      <button className="primary" disabled={busy || !email || !password} onClick={() => go(false)}>Logga in</button>
      <button className="ghost" disabled={busy || !email || password.length < 8} onClick={() => go(true)}>Första gången: skapa konto</button>
      {err && <div className="err">{err}</div>}
      {msg && <div className="ok">{msg}</div>}
    </div>
  );
}
