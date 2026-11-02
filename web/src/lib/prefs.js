// Per-device preferences (localStorage, wrapped: private mode can throw).
const read = (k, d) => { try { const v = localStorage.getItem(`jarvis.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(`jarvis.${k}`, JSON.stringify(v)); } catch { /* ignore */ } };

export const prefs = {
  lang: () => read("lang", "sv-SE"),
  setLang: (v) => write("lang", v),
  readBack: () => read("readBack", false),
  setReadBack: (v) => write("readBack", v),
};
