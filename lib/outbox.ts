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

/* v1.238.0 - ONCE ONLY: money writes that never wait on the device but must
   never land twice. Sent with a key made from the request itself and a
   five-minute window, re-sent once with the same key when the network
   drops; the worker answers a repeat with the first answer. The same list as
   worker/src/outbox.ts ONCE_ONLY (tests/outbox.mjs). */
export const ONCE_ONLY: readonly { method: string; path: RegExp; kind: string }[] = [
  { method: "POST", path: /^\/staff\/docs$/,                         kind: "document" },
  { method: "POST", path: /^\/staff\/docs\/\d+\/payments$/,           kind: "payment" },
  { method: "POST", path: /^\/staff\/docs\/\d+\/credit-note$/,        kind: "credit_note" },
  { method: "POST", path: /^\/staff\/credit-notes\/\d+\/refund$/,     kind: "refund" },
  { method: "POST", path: /^\/staff\/docs\/\d+\/convert$/,            kind: "convert" },
  { method: "POST", path: /^\/staff\/docs\/\d+\/void$/,               kind: "void" },          // v1.242.0 (B2)
  /* v1.242.0 (go-live audit C8) - stock writes: a lost reply and a second press moved stock twice */
  { method: "POST", path: /^\/staff\/inventory\/\d+\/adjust$/,       kind: "stock_adjust" },
  { method: "POST", path: /^\/staff\/inventory\/receipts$/,          kind: "stock_receipt" },
  { method: "POST", path: /^\/staff\/inventory\/returns$/,           kind: "stock_return" },
  { method: "POST", path: /^\/staff\/postage$/,                      kind: "postage" },
  { method: "POST", path: /^\/staff\/stock-counts\/\d+\/post$/,      kind: "stock_count" },
];
export function onceOnlyKind(method: string | undefined, path: string): string | null {
  const m = (method ?? "GET").toUpperCase();
  for (const r of ONCE_ONLY) if (r.method === m && r.path.test(path)) return r.kind;
  return null;
}
/* v1.242.0 (go-live audit B10) - the key is minted ONCE PER PRESS (api.ts,
   newIdempotencyKey) and reused only for that press's retry. The 1.238.0
   key was a hash of the request in a five-minute window, so a genuine
   second identical write - two RM 50 part payments on one invoice within
   five minutes - was answered with the first one's result and never
   recorded. `onceKey` stays exported for the guard that documents the
   change; nothing calls it. */
export async function onceKey(method: string, path: string, body: string | null, now = Date.now()): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${method} ${path} ${body ?? ""}`));
  const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  return `${hex}-${Math.floor(now / 300_000)}`;
}

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
  /** v1.177.1 - not before this moment. A server error backs the entry off
      instead of dropping it; rows written before this version have no `nextAt`
      and are read as due now, which is the correct answer for them. */
  nextAt?: number;
  /* v1.243.0 (go-live audit F3) - WHERE THE WRITE STANDS, said to the person:
     queued (saved on this phone, pressed time kept) -> sending -> confirmed
     (the server said 2xx: only then is it "recorded"; the entry is removed)
     | held_signin (the server said 401/403: the session is gone; the entry
     and its pressed time are KEPT and sent again, with the same key, after
     the next successful sign-in) | needs_hr (the server refused it with
     400/409, or it is older than the server's 48-hour late window: it is
     kept, shown with its pressed time and the reason, and HR enters it by
     hand with the original time; the person dismisses it once told). */
  state?: "queued" | "sending" | "held_signin" | "needs_hr";
  reason?: string | null;
}
/** The server (worker/src/outbox.ts MAX_LATE_MS) records a late punch at its
    pressed time only within 48 hours; later than that it would be stored at
    the arrival time, which is the wrong record. The phone stops sending it
    and hands it to HR instead. */
export const MAX_LATE_MS = 48 * 3600 * 1000;

/** v1.177.1 - after this many server errors the queue stops trying and SAYS
    so. Six attempts across the backoff below spans about half an hour; a write
    that has failed that persistently is a fault to report, not a loop. */
const MAX_ATTEMPTS = 6;
/** 30s, 1m, 2m, 4m, 8m - doubling, capped. */
const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 8 * 60_000);

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

/**
 * v1.177.1 - DID THE TRANSACTION COMPLETE?
 *
 * `tx()` below resolves the REQUEST's result, and a `put` has no result - so
 * `tx(...)` resolved `undefined` on success and `undefined` on failure alike.
 * That is why `enqueue` ended up returning `ok !== undefined || true`: the
 * check could never be true, and the `|| true` hid it. This helper answers the
 * only question a write needs answered.
 */
function txOk(mode: IDBTransactionMode, run: (s: IDBObjectStore) => void): Promise<boolean> {
  return openDb().then((db) => new Promise<boolean>((resolve) => {
    if (!db) { resolve(false); return; }
    try {
      const t = db.transaction(STORE, mode);
      run(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(true); };
      t.onerror = () => { db.close(); resolve(false); };
      t.onabort = () => { db.close(); resolve(false); };
    } catch { try { db.close(); } catch { /* already gone */ } resolve(false); }
  }));
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
  /* v1.243.0 (F3) - a PUNCH is never quietly aged out: past the server's
     late window it is shown as "needs HR" for two weeks, with its pressed
     time, until the person dismisses it. Other writes keep the two-day rule. */
  const cutoffPunch = Date.now() - 14 * 86400000;
  return all
    .filter((e) => e.scope === scope && e.createdAt >= (e.kind === "punch" ? cutoffPunch : cutoff))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function outboxCount(): Promise<number> {
  return (await outboxAll()).length;
}

/**
 * v1.177.1 - KEPT MEANS KEPT.
 *
 * The old body was `return ok !== undefined || true`, which is `true` for every
 * input. `enqueue` could not report failure, so when IndexedDB was unavailable
 * - Safari private browsing, storage pressure, a locked database - the punch
 * was dropped and the person was told "Kept - sent the moment you are back
 * online". They found out at payroll, which is the exact failure this whole
 * file was written in v1.105.0 to prevent.
 *
 * Two things now have to be true before this returns true: the transaction
 * COMPLETED (`txOk`), and the row can be READ BACK. The read-back is a second
 * transaction and it is worth it - this is somebody's attendance, and a quota
 * error can abort a write that every other signal calls successful.
 */
export async function enqueue(entry: Omit<OutboxEntry, "createdAt" | "attempts" | "scope">): Promise<boolean> {
  const full: OutboxEntry = { ...entry, createdAt: Date.now(), attempts: 0, scope, nextAt: 0 };
  const written = await txOk("readwrite", (s) => { s.put(full); });
  notifyChange();
  if (!written) return false;
  const back = await tx<OutboxEntry | undefined>("readonly", (s) => s.get(full.id));
  return back?.id === full.id;
}

async function remove(id: string): Promise<void> {
  await tx("readwrite", (s) => { s.delete(id); });
  notifyChange();
}

async function bumpAttempts(e: OutboxEntry, due = 0): Promise<void> {
  const attempts = e.attempts + 1;
  await txOk("readwrite", (s) => { s.put({ ...e, attempts, nextAt: due || Date.now() }); });
}
/* v1.243.0 (F3) - the state is written on the entry itself, so every screen
   that lists the queue reads the same word */
async function setState(e: OutboxEntry, state: NonNullable<OutboxEntry["state"]>, reason: string | null): Promise<void> {
  await txOk("readwrite", (s) => { s.put({ ...e, state, reason }); });
  notifyChange();
}
/** After a successful sign-in: everything held for it is due again. */
export async function releaseHeld(): Promise<number> {
  const held = (await outboxAll()).filter((e) => e.state === "held_signin");
  for (const e of held) await txOk("readwrite", (s) => { s.put({ ...e, state: "queued", reason: null, nextAt: Date.now() }); });
  if (held.length) notifyChange();
  return held.length;
}
/** The person has told HR about a punch the phone could not deliver: it leaves the queue. */
export async function dismissNeedsHr(id: string): Promise<void> {
  const e = (await outboxAll()).find((x) => x.id === id);
  if (e && e.state === "needs_hr") await remove(id);
}

/* ---------------- listeners ---------------- */

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function notifyChange(): void { for (const l of listeners) { try { l(); } catch { /* a listener must not break the queue */ } } }

/** A queued write the server has now REFUSED (4xx), or one the queue has
    GIVEN UP on after MAX_ATTEMPTS server errors. Either way the person is
    told: the difference between the two is the message, not the silence. */
export interface Refusal { entry: OutboxEntry; status: number; message: string; gaveUp?: boolean }
let onRefused: ((r: Refusal) => void) | null = null;
export function setRefusalHandler(fn: ((r: Refusal) => void) | null): void { onRefused = fn; }

/**
 * v1.177.1 - THE DEVICE COULD NOT KEEP IT. Called by lib/api.ts when `enqueue`
 * fails, so the person is told through the SAME surface that already reports a
 * refused write - one place, every caller covered, whether or not that caller
 * happens to render its own error. A write nobody was told about is the bug
 * this release exists to end.
 */
export function reportDropped(kind: string, path: string): void {
  onRefused?.({
    entry: { id: "", path, method: "", body: null, kind, clientAt: new Date().toISOString(), createdAt: Date.now(), attempts: 0, scope },
    status: 0,
    gaveUp: true,
    message: "this phone could not store it — nothing was saved, please try again",
  });
}

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
    const now = Date.now();
    for (const e of await outboxAll()) {
      /* v1.177.1 - a server error backs this entry off; until it is due again
         we step over it rather than hammering the same failing write. */
      if ((e.nextAt ?? 0) > now) continue;
      /* v1.243.0 (F3) - a punch the server could no longer record at its
         pressed time is not sent: it goes to HR with that time */
      if (e.state === "needs_hr" || e.state === "held_signin") continue;
      if (e.kind === "punch" && now - Date.parse(e.clientAt) > MAX_LATE_MS) {
        await setState(e, "needs_hr", "older than 48 hours - the server would record it at the wrong time");
        continue;
      }
      await setState(e, "sending", null);
      const r = await send(e);
      if (r === null) { await bumpAttempts({ ...e, state: "queued" }); break; } // network: try again later
      if (r.status >= 200 && r.status < 300) { await remove(e.id); sent++; continue; }
      if (r.status === 401 || r.status === 403) {
        /* v1.243.0 (F3) - THE SESSION IS GONE, NOT THE PUNCH. It stays, with
           its pressed time and its key, and is sent again after the next
           successful sign-in (releaseHeld). Nothing else in the queue is
           tried: it would meet the same door. */
        await setState(e, "held_signin", "sign in to send it");
        break;
      }
      if (r.status >= 400 && r.status < 500) {
        const msg = (r.data as { error?: { message?: string } } | null)?.error?.message ?? `refused (${r.status})`;
        if (e.kind === "punch") {
          /* v1.243.0 (F3) - a refused PUNCH is a day somebody worked: kept,
             with the reason, for HR to enter by hand at the pressed time */
          await setState(e, "needs_hr", msg);
          onRefused?.({ entry: { ...e, state: "needs_hr", reason: msg }, status: r.status, message: msg });
          continue;
        }
        /* the server has SEEN it and said no. Repeating cannot change the
           answer, so it leaves the queue - and the person is told why. */
        await remove(e.id);
        onRefused?.({ entry: e, status: r.status, message: msg });
        continue;
      }
      /* v1.177.1 - A 5xx IS RETRIED, because the worker was built for that.
         The old code removed it, reasoning that the idempotency key would only
         replay a stored answer. The opposite is true and the worker's own
         guard says so - tests/outbox.mjs: "a 5xx is not stored, so the retry
         really retries". A server error usually means the write never landed,
         so dropping it here silently lost exactly the punches this file
         exists to protect. It stays, backs off, and after MAX_ATTEMPTS the
         queue stops and SAYS it stopped rather than looping forever. */
      if (e.attempts + 1 >= MAX_ATTEMPTS) {
        await remove(e.id);
        onRefused?.({
          entry: e, status: r.status, gaveUp: true,
          message: `the server could not take this after ${MAX_ATTEMPTS} tries (${r.status})`,
        });
        continue;
      }
      await bumpAttempts(e, Date.now() + backoffMs(e.attempts + 1));
      break; /* the server is unwell; give the rest of the queue the same rest */
    }
  } finally {
    draining = false;
    notifyChange();
  }
  return { sent, left: await outboxCount() };
}

/** Wire the automatic drains once per page. Returns an unsubscribe. */
let kickNow: (() => void) | null = null;
/** v1.243.0 (F3) - drain now (after a sign-in released the held entries). */
export function pokeOutbox(): void { kickNow?.(); }
export function startOutbox(send: (e: OutboxEntry) => Promise<{ status: number; data: unknown } | null>): () => void {
  if (typeof window === "undefined") return () => {};
  const kick = () => { void drainOutbox(send); };
  kickNow = kick;
  window.addEventListener("online", kick);
  const onVis = () => { if (document.visibilityState === "visible") kick(); };
  document.addEventListener("visibilitychange", onVis);
  timer = window.setInterval(async () => { if ((await outboxCount()) > 0) kick(); }, DRAIN_EVERY_MS);
  kick();
  return () => {
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", onVis);
    if (timer !== null) window.clearInterval(timer);
    if (kickNow === kick) kickNow = null;
  };
}
