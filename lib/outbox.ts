"use client";

/**
 * THE OUTBOX — v1.105.0 (roadmap phase 03).
 *
 * Before this file, the portal's answer to a dead signal was a red banner:
 * "You are offline. Changes cannot be saved until connectivity is restored."
 * The banner was honest and the outcome was not acceptable - a clock-in
 * pressed in a lift was gone, and the person found out at payroll.
 *
 * Now a write on a QUEUEABLE route that cannot reach the server is kept on
 * the device (IndexedDB, so it survives the tab and the browser closing) and
 * sent, in order, the moment the network is back. The CEO, 05-09-2026, chose
 * what may queue: attendance punches, task updates, leave and claim
 * submissions, and hotel call notes when they exist.
 *
 * THREE RULES that make this safe rather than clever:
 *
 *  1. THE LIST IS EXPLICIT. Only routes named in QUEUEABLE are ever kept;
 *     everything else fails the way it always did. A sign-in, a 2FA code, a
 *     payment, a "pull now" - replaying any of those later is wrong, and a
 *     blanket "queue every POST" would replay them. The worker holds the SAME
 *     list (worker/src/outbox.ts) and tests/outbox.mjs compares the two.
 *
 *  2. EVERY QUEUEABLE WRITE CARRIES AN IDEMPOTENCY KEY, queued or not. The
 *     key is minted once, when the person presses the button, and travels
 *     with every attempt. The worker records the first answer under that key
 *     and returns the SAME answer to any repeat - so a request that reached
 *     the server but whose reply was lost in the tunnel does not clock the
 *     person in twice when the queue replays it.
 *
 *  3. THE PHONE SAYS WHEN. X-Client-At carries the moment the button was
 *     pressed. For a punch the worker records THAT time, not the time the
 *     queue drained - and marks it pending, as the CEO decided, so it counts
 *     for nothing until approved. Nothing lost, nothing trusted blindly.
 *
 * What a queued call returns: { ok: true, status: 202, queued: true, data:
 * null }. The caller's toast must say so (house rule #25) - "saved on this
 * phone, will be sent when you are back online" is a different sentence from
 * "saved", and the difference is the whole point.
 *
 * WHEN IT DRAINS: on the `online` event, when the app comes to the front,
 * and every 45 s while there is something waiting. Entries drain in order; a
 * network failure stops the drain (the next one will pick up where it
 * stopped); a server answer of any kind - success or a 4xx refusal - removes
 * the entry, because the server has now SEEN it and repeating it cannot
 * change the answer. A refusal is surfaced to the person through
 * onRefused(), so an offline clock-in that turns out to be a duplicate is
 * explained, not silently dropped.
 */

const DB_NAME = "azone-outbox";
const STORE = "queue";
const MAX_AGE_MS = 48 * 3600 * 1000; // older than two days is history, not a queue
const DRAIN_EVERY_MS = 45_000;

/** Routes that may wait on the device. Method + a regex over the path AFTER
    /api/v1. Keep this list short and boring; tests/outbox.mjs holds the worker
    to the same one. */
export const QUEUEABLE: readonly { method: string; path: RegExp; kind: string }[] = [
  { method: "POST",  path: /^\/staff\/attendance$/,                       kind: "punch" },
  { method: "PATCH", path: /^\/staff\/tasks\/\d+$/,                       kind: "task" },
  { method: "POST",  path: /^\/staff\/tasks\/\d+\/items\/\d+\/toggle$/,   kind: "task" },
  { method: "POST",  path: /^\/staff\/tasks\/\d+\/ack$/,                  kind: "task" },
  { method: "POST",  path: /^\/staff\/leave$/,                            kind: "leave" },
  { method: "POST",  path: /^\/staff\/claims$/,                           kind: "claim" },
  { method: "POST",  path: /^\/staff\/hotels\/\d+\/calls$/,               kind: "hotel_call" },
];

export function queueableKind(method: string | undefined, path: string): string | null {
  const m = (method ?? "GET").toUpperCase();
  for (const r of QUEUEABLE) if (r.method === m && r.path.test(path)) return r.kind;
  return null;
}

export interface OutboxEntry {
  id: string;            // the idempotency key
  path: string;          // after /api/v1
  method: string;
  body: string | null;
  kind: string;
  clientAt: string;      // ISO, when the button was pressed
  createdAt: number;
  attempts: number;
  scope: string;         // the account it belongs to
}

export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ---------------- storage ---------------- */

let scope = "anon";
export function setOutboxScope(userId: number | string | null): void {
  scope = userId == null ? "anon" : String(userId);
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: "id" });
          s.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve) => {
    if (!db) { resolve(undefined); return; }
    try {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      const r = run(s);
      let out: T | undefined;
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => { db.close(); resolve(out); };
      t.onerror = () => { db.close(); resolve(undefined); };
      t.onabort = () => { db.close(); resolve(undefined); };
    } catch { db.close(); resolve(undefined); }
  }));
}

export async function outboxAll(): Promise<OutboxEntry[]> {
  const all = (await tx<OutboxEntry[]>("readonly", (s) => s.getAll())) ?? [];
  const cutoff = Date.now() - MAX_AGE_MS;
  return all
    .filter((e) => e.scope === scope && e.createdAt >= cutoff)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function outboxCount(): Promise<number> {
  return (await outboxAll()).length;
}

export async function enqueue(entry: Omit<OutboxEntry, "createdAt" | "attempts" | "scope">): Promise<boolean> {
  const full: OutboxEntry = { ...entry, createdAt: Date.now(), attempts: 0, scope };
  const ok = await tx("readwrite", (s) => { s.put(full); });
  notifyChange();
  return ok !== undefined || true;
}

async function remove(id: string): Promise<void> {
  await tx("readwrite", (s) => { s.delete(id); });
  notifyChange();
}

async function bumpAttempts(e: OutboxEntry): Promise<void> {
  await tx("readwrite", (s) => { s.put({ ...e, attempts: e.attempts + 1 }); });
}

/* ---------------- listeners ---------------- */

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function notifyChange(): void { for (const l of listeners) { try { l(); } catch { /* a listener must not break the queue */ } } }

/** A queued write the server has now REFUSED (4xx). The shell shows it. */
export interface Refusal { entry: OutboxEntry; status: number; message: string }
let onRefused: ((r: Refusal) => void) | null = null;
export function setRefusalHandler(fn: ((r: Refusal) => void) | null): void { onRefused = fn; }

/* ---------------- draining ---------------- */

let draining = false;
let timer: number | null = null;

/** Send everything waiting, oldest first. Stops at the first network failure. */
export async function drainOutbox(send: (e: OutboxEntry) => Promise<{ status: number; data: unknown } | null>): Promise<{ sent: number; left: number }> {
  if (draining) return { sent: 0, left: await outboxCount() };
  draining = true;
  let sent = 0;
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return { sent: 0, left: await outboxCount() };
    for (const e of await outboxAll()) {
      const r = await send(e);
      if (r === null) { await bumpAttempts(e); break; } // network: try again later
      await remove(e.id);
      if (r.status >= 200 && r.status < 300) sent++;
      else if (r.status >= 400 && r.status < 500) {
        const msg = (r.data as { error?: { message?: string } } | null)?.error?.message ?? `refused (${r.status})`;
        onRefused?.({ entry: e, status: r.status, message: msg });
      }
      /* a 5xx is also removed: the server saw it, and the idempotency key
         means a second attempt could only return the same stored answer or
         the same failure; keeping it would loop */
    }
  } finally {
    draining = false;
    notifyChange();
  }
  return { sent, left: await outboxCount() };
}

/** Wire the automatic drains once per page. Returns an unsubscribe. */
export function startOutbox(send: (e: OutboxEntry) => Promise<{ status: number; data: unknown } | null>): () => void {
  if (typeof window === "undefined") return () => {};
  const kick = () => { void drainOutbox(send); };
  window.addEventListener("online", kick);
  const onVis = () => { if (document.visibilityState === "visible") kick(); };
  document.addEventListener("visibilitychange", onVis);
  timer = window.setInterval(async () => { if ((await outboxCount()) > 0) kick(); }, DRAIN_EVERY_MS);
  kick();
  return () => {
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", onVis);
    if (timer !== null) window.clearInterval(timer);
  };
}
