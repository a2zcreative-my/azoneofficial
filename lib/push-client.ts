/**
 * v1.6.0 — client-side Web Push + service-worker helpers.
 * Best-effort throughout: any unsupported browser or missing config returns a
 * status string instead of throwing, so callers can show a friendly message.
 */

import { api } from "@/lib/api";

function urlB64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushResult = "ok" | "denied" | "unsupported" | "unconfigured" | "error";

/** Ask permission and subscribe this device to web-push. */
export async function enablePush(): Promise<PushResult> {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return "unsupported";
    }
    const keyRes = await api<{ key: string | null }>("/staff/push/public-key");
    const key = keyRes.data?.key;
    if (!key) return "unconfigured";
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return "denied";
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key) as unknown as BufferSource,
    });
    const res = await api("/staff/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

/** Unsubscribe this device. */
export async function disablePush(): Promise<void> {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("/staff/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
  } catch { /* best-effort */ }
}

/** Current permission state, for showing the right button label. */
export function pushPermission(): "default" | "granted" | "denied" | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}
