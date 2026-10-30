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

/** v1.226.0 - this browser's push address, or null. Never waits for a
    service worker that is not registered (navigator.serviceWorker.ready
    would hang forever), and gives up after 1.5 s. */
export async function currentPushEndpoint(): Promise<string | null> {
  try {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
    const look = (async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      return sub?.endpoint ?? null;
    })();
    return await Promise.race([look, new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  } catch {
    return null;
  }
}

/** v1.226.0 - SIGN OUT, AND THIS DEVICE STOPS RECEIVING THE PERSON'S PUSHES
    (the owner's answer to the Shift Reminders brief). The push address goes
    with the logout so the server removes it for the person signing out;
    then the browser drops the subscription itself, so the next person who
    signs in on this phone starts with push off and turns it on for
    themselves. `all` signs out every device (and removes all of them). */
export async function signOutRequest(opts: { all?: boolean } = {}) {
  const endpoint = await currentPushEndpoint();
  const res = await api("/auth/logout", {
    method: "POST",
    body: JSON.stringify({ ...(opts.all ? { all: true } : {}), ...(endpoint ? { push_endpoint: endpoint } : {}) }),
  });
  if (endpoint) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      await sub?.unsubscribe();
    } catch { /* best-effort */ }
  }
  return res;
}

export type DevicePush = "unsupported" | "denied" | "off" | "on";

/** v1.226.0 - is push really on for THIS device and THIS person? Permission
    alone is not enough: the browser may have permission while the server has
    no address for this person (signed out, or turned off). */
export async function devicePushStatus(): Promise<DevicePush> {
  const perm = pushPermission();
  if (perm === "unsupported" || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (perm === "denied") return "denied";
  if (perm !== "granted") return "off";
  const endpoint = await currentPushEndpoint();
  if (!endpoint) return "off";
  const r = await api<{ device: boolean }>("/staff/push/device", { method: "POST", body: JSON.stringify({ endpoint }) });
  return r.ok && r.data?.device ? "on" : "off";
}
