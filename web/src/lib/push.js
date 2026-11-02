import { api, supabase, must } from "./supabase.js";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js"); } catch { return null; }
}

const b64ToBytes = (b64) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

// Ask for permission, subscribe this device, save it. Must run from a tap.
export async function enablePush() {
  if (!pushSupported()) throw new Error(isStandalone() ? "This browser can't do alerts." : "On iPhone: Share > Add to Home Screen, open Jarvis from there, then turn alerts on.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Alerts were not allowed. Turn them on in iPhone Settings > Notifications > Jarvis.");
  const reg = (await registerSW()) ?? (await navigator.serviceWorker.ready);
  const { key } = await api("vapid");
  if (!key) throw new Error("Push keys are not set up on the server yet (VAPID_PUBLIC_KEY).");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  const j = sub.toJSON();
  must(await supabase.from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: "endpoint" }));
  return true;
}

export async function pushState() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}
