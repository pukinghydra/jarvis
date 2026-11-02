// Per-device preferences (localStorage, wrapped: private mode can throw).
const read = (k, d) => { try { const v = localStorage.getItem(`jarvis.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(`jarvis.${k}`, JSON.stringify(v)); } catch { /* ignore */ } };

export const prefs = {
  lang: () => read("lang", "sv-SE"),
  setLang: (v) => write("lang", v),
  // Read Jarvis's answers aloud (Talk screen). On unless turned off.
  readAloud: () => read("readAloud", true),
  setReadAloud: (v) => write("readAloud", v),
};
