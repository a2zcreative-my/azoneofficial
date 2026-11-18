"use client";

/* v1.364.0 - STAFF CHAT, THE BROWSER'S SIDE (worker/src/chat.ts is the server).

   WHAT THIS KEEPS, AND WHERE: everything lives in this module's memory and
   nowhere else - no localStorage, no IndexedDB, no service-worker cache, no
   offline queue (chat routes are not in lib/outbox.ts QUEUEABLE, and must
   never be). A reload starts empty and asks the server again.

   EXPIRY ON THIS SCREEN: every message carries the server's expires_at. A
   timer removes each one at that moment (by the server's clock, corrected
   for this device's drift), even with the network down, and the hub's
   "expired" event removes it too. Object URLs made for a picture are revoked
   with it.

   ONE CONNECTION per open portal: a WebSocket that only listens. Every
   action is an ordinary authorised HTTP call, so a revoked person cannot
   send anything even before the socket is closed. "revoked" (sign-out,
   suspension, role change) empties the store at once and stops reconnecting. */

import { useSyncExternalStore } from "react";
import { api, csrfFetch } from "@/lib/api";

export interface ChatFile { id: string; name: string; type: string; size: number }
export interface ChatMsg {
  id: number; conv_id: number; sender_id: number; text: string;
  created_at: number; expires_at: number; client_id: string | null; files: ChatFile[];
  /** local only: still on its way / could not be sent */
  pending?: boolean; failed?: string;
}
export interface ChatConv {
  id: number; kind: "direct" | "group"; name: string | null; created_by: number; created_at: number;
  members: { id: number; last_read: number }[]; unread: number;
  last: { id: number; sender_id: number; preview: string; files: number; at: number; expires_at: number } | null;
}
export interface ChatPerson { id: number; name: string; role: string; position: string | null; photo_key: string | null; on_staff: boolean; can_chat: boolean; why: "role" | "no_2fa" | "off" | "left" | null; online: boolean }
export type ChatStatus = "idle" | "connecting" | "live" | "offline" | "revoked" | "unavailable";

interface State {
  status: ChatStatus;
  me: number;
  people: ChatPerson[];
  convs: ChatConv[];
  total: number;
  messages: Record<number, ChatMsg[]>;
  more: Record<number, boolean>;
  online: number[];
  ttl: number;
  error: string | null;
}

const EMPTY: State = { status: "idle", me: 0, people: [], convs: [], total: 0, messages: {}, more: {}, online: [], ttl: 12 * 3600_000, error: null };
let state: State = EMPTY;
const subs = new Set<() => void>();
const set = (patch: Partial<State> | ((s: State) => Partial<State>)) => {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const f of subs) f();
};
let skew = 0; // server clock minus this device's clock
export const serverNow = () => Date.now() + skew;
const noteNow = (now: unknown) => { if (typeof now === "number") skew = now - Date.now(); };

export function useChat(): State {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state, () => EMPTY);
}

/* ---------------- the connection ---------------- */

let ws: WebSocket | null = null;
let started = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let sweepTimer: ReturnType<typeof setTimeout> | null = null;
let openConv: number | null = null;

export function chatStart(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  set({ status: "connecting" });
  void refreshInbox().then(() => { connect(); void loadPeople(); });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
}

export function chatStop(): void {
  started = false;
  if (retryTimer) clearTimeout(retryTimer);
  if (pingTimer) clearInterval(pingTimer);
  if (sweepTimer) clearTimeout(sweepTimer);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("online", onVisible);
  try { ws?.close(); } catch { /* gone */ }
  ws = null;
  wipe("idle");
}

/** Empty everything this screen holds - on sign-out, revocation or stop. */
function wipe(status: ChatStatus) {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  openConv = null;
  state = { ...EMPTY, status };
  for (const f of subs) f();
}

function onVisible() {
  if (!started || state.status === "revoked" || state.status === "unavailable") return;
  if (document.visibilityState === "visible" && (!ws || ws.readyState > 1)) { retry = 0; connect(); void refreshInbox(); }
  purgeExpired();
}

function connect() {
  if (!started || state.status === "revoked" || state.status === "unavailable") return;
  if (ws && ws.readyState <= 1) return;
  let sock: WebSocket;
  try { sock = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/v1/staff/chat/ws`); } catch { scheduleRetry(); return; }
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    set({ status: "live", error: null });
    if (pingTimer) clearInterval(pingTimer);
    /* answered by the hub's auto-response without waking it */
    pingTimer = setInterval(() => { try { sock.send("ping"); } catch { /* closing */ } }, 45_000);
  };
  sock.onmessage = (e) => {
    if (typeof e.data !== "string" || e.data === "pong") return;
    try { onEvent(JSON.parse(e.data) as Record<string, unknown>); } catch { /* not ours */ }
  };
  sock.onclose = (e) => {
    if (pingTimer) clearInterval(pingTimer);
    if (ws === sock) ws = null;
    if (e.code === 4001 || state.status === "revoked") { wipe("revoked"); return; }
    if (!started) return;
    set({ status: "offline" });
    scheduleRetry();
  };
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  const wait = Math.min(30_000, 1000 * 2 ** retry) + Math.random() * 500;
  retry += 1;
  retryTimer = setTimeout(() => { void refreshInbox().then(() => connect()); }, wait);
}

function onEvent(ev: Record<string, unknown>) {
  switch (ev.type) {
    case "hello":
      set({ online: (ev.online as number[]) ?? [], total: Number(ev.total) || 0 });
      return;
    case "presence": {
      const uid = Number(ev.uid);
      set((s) => ({ online: ev.online ? [...new Set([...s.online, uid])] : s.online.filter((x) => x !== uid) }));
      return;
    }
    case "unread":
      set((s) => ({ total: Number(ev.total) || 0, convs: s.convs.map((c) => ({ ...c, unread: Number((ev.by_conv as Record<string, number>)?.[c.id] ?? 0) })) }));
      return;
    case "message": {
      const m = ev.message as ChatMsg;
      addMessage(m);
      if (ev.unread) {
        const u = ev.unread as { total: number; by_conv: Record<string, number> };
        set((s) => ({ total: u.total, convs: s.convs.map((c) => ({ ...c, unread: Number(u.by_conv[c.id] ?? 0) })) }));
      }
      if (!state.convs.some((c) => c.id === m.conv_id)) void refreshInbox();
      if (openConv === m.conv_id && m.sender_id !== state.me && document.visibilityState === "visible") void markRead(m.conv_id);
      return;
    }
    case "read": {
      const conv = Number(ev.conv_id), uid = Number(ev.uid), upto = Number(ev.upto);
      set((s) => ({ convs: s.convs.map((c) => c.id !== conv ? c : { ...c, members: c.members.map((m) => m.id === uid ? { ...m, last_read: Math.max(m.last_read, upto) } : m) }) }));
      return;
    }
    case "expired":
      dropIds(new Set((ev.ids as number[]) ?? []));
      return;
    case "conv":
      if (ev.removed) {
        const conv = Number(ev.conv_id);
        set((s) => { const messages = { ...s.messages }; delete messages[conv]; return { messages, convs: s.convs.filter((c) => c.id !== conv) }; });
      }
      void refreshInbox();
      return;
    case "revoked":
      wipe("revoked");
      try { ws?.close(); } catch { /* gone */ }
      return;
  }
}

/* ---------------- expiry on this screen ---------------- */

const objectUrls = new Map<string, string>();

function dropIds(ids: Set<number>) {
  if (!ids.size) return;
  set((s) => {
    const messages: Record<number, ChatMsg[]> = {};
    for (const [k, list] of Object.entries(s.messages)) {
      const keep = list.filter((m) => !ids.has(m.id));
      for (const m of list) if (ids.has(m.id)) for (const f of m.files) { const u = objectUrls.get(f.id); if (u) { URL.revokeObjectURL(u); objectUrls.delete(f.id); } }
      messages[Number(k)] = keep;
    }
    return { messages, convs: s.convs.map((c) => (c.last && ids.has(c.last.id) ? { ...c, last: null } : c)) };
  });
}

function purgeExpired() {
  const now = serverNow();
  const gone = new Set<number>();
  for (const list of Object.values(state.messages)) for (const m of list) if (m.expires_at <= now && !m.pending) gone.add(m.id);
  if (gone.size) dropIds(gone);
  if (state.convs.some((c) => c.last && c.last.expires_at <= now)) set((s) => ({ convs: s.convs.map((c) => (c.last && c.last.expires_at <= now ? { ...c, last: null } : c)) }));
  if (sweepTimer) clearTimeout(sweepTimer);
  let next = Infinity;
  for (const list of Object.values(state.messages)) for (const m of list) if (!m.pending) next = Math.min(next, m.expires_at);
  for (const c of state.convs) if (c.last) next = Math.min(next, c.last.expires_at);
  if (Number.isFinite(next)) sweepTimer = setTimeout(purgeExpired, Math.max(250, Math.min(next - now + 50, 60_000)));
}

/* ---------------- reads ---------------- */

export async function refreshInbox(): Promise<void> {
  const r = await api<{ conversations: ChatConv[]; total: number; ttl_ms: number; now: number }>("/staff/chat/inbox");
  if (r.status === 401 || r.status === 403) { wipe(r.status === 401 ? "revoked" : "unavailable"); return; }
  if (r.status === 503) { set({ status: "unavailable", error: "chat_off" }); return; }
  if (!r.ok || !r.data) { set({ error: "inbox" }); return; }
  noteNow(r.data.now);
  /* v1.368.0 - an answer without its list (an old worker, a test fixture) is an empty inbox, never a crash in the expiry timer */
  set({ convs: Array.isArray(r.data.conversations) ? r.data.conversations : [], total: Number(r.data.total ?? 0), ttl: r.data.ttl_ms, error: null });
  purgeExpired();
}

export async function loadPeople(): Promise<void> {
  const r = await api<{ me: number; people: ChatPerson[] }>("/staff/chat/people");
  if (!r.ok || !r.data) return;
  const people = Array.isArray(r.data.people) ? r.data.people : []; /* v1.368.0 - an answer without the list is no one, never a crash */
  set({ me: r.data.me, people, online: people.filter((p) => p.online).map((p) => p.id) });
}

export async function openConversation(conv: number | null): Promise<void> {
  openConv = conv;
  if (conv === null) return;
  const r = await api<{ messages: ChatMsg[]; more: boolean; now: number }>(`/staff/chat/c/${conv}/messages`);
  if (!r.ok || !r.data) { set({ error: r.status === 404 ? "gone" : "messages" }); return; }
  noteNow(r.data.now);
  set((s) => ({ messages: { ...s.messages, [conv]: r.data!.messages }, more: { ...s.more, [conv]: r.data!.more }, error: null }));
  purgeExpired();
  void markRead(conv);
}

export async function loadOlder(conv: number): Promise<void> {
  const first = state.messages[conv]?.find((m) => !m.pending);
  if (!first) return;
  const r = await api<{ messages: ChatMsg[]; more: boolean }>(`/staff/chat/c/${conv}/messages?before=${first.id}`);
  if (r.ok && r.data) set((s) => ({ messages: { ...s.messages, [conv]: [...r.data!.messages, ...(s.messages[conv] ?? [])] }, more: { ...s.more, [conv]: r.data!.more } }));
}

async function markRead(conv: number) {
  const list = state.messages[conv];
  const last = list?.filter((m) => !m.pending).at(-1);
  if (!last) return;
  const c = state.convs.find((x) => x.id === conv);
  const mine = c?.members.find((m) => m.id === state.me);
  if (mine && mine.last_read >= last.id && !c?.unread) return;
  await api(`/staff/chat/c/${conv}/read`, { method: "POST", body: JSON.stringify({ upto: last.id }) });
}

function addMessage(m: ChatMsg) {
  set((s) => {
    const list = (s.messages[m.conv_id] ?? []).filter((x) => x.id !== m.id && !(m.client_id && x.client_id === m.client_id));
    const messages = s.messages[m.conv_id] || openConv === m.conv_id ? { ...s.messages, [m.conv_id]: [...list, m].sort((a, b) => a.id - b.id) } : s.messages;
    const convs = s.convs.map((c) => c.id !== m.conv_id ? c : { ...c, last: { id: m.id, sender_id: m.sender_id, preview: m.text.slice(0, 90), files: m.files.length, at: m.created_at, expires_at: m.expires_at } });
    convs.sort((a, b) => (b.last?.at ?? b.created_at) - (a.last?.at ?? a.created_at));
    return { messages, convs };
  });
  purgeExpired();
}

/* ---------------- writes ---------------- */

export const CHAT_LIMITS = { text: 1500, file: 2 * 1024 * 1024, files: 3, total: 5 * 1024 * 1024 } as const;
export const CHAT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const TYPES = new Set(CHAT_ACCEPT.split(","));

export async function sendMessage(conv: number, text: string, files: ChatFile[]): Promise<string | null> {
  const client_id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const temp: ChatMsg = { id: Number.MAX_SAFE_INTEGER - Math.floor(Math.random() * 1e6), conv_id: conv, sender_id: state.me, text, created_at: serverNow(), expires_at: serverNow() + state.ttl, client_id, files, pending: true };
  set((s) => ({ messages: { ...s.messages, [conv]: [...(s.messages[conv] ?? []), temp] } }));
  const r = await api<{ message: ChatMsg; error?: { message?: string } }>(`/staff/chat/c/${conv}/messages`, { method: "POST", body: JSON.stringify({ text, files: files.map((f) => f.id), client_id }) });
  if (!r.ok || !r.data?.message) {
    const why = (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Not sent - check your connection and try again";
    set((s) => ({ messages: { ...s.messages, [conv]: (s.messages[conv] ?? []).filter((m) => m.client_id !== client_id) } }));
    return why;
  }
  addMessage(r.data.message);
  return null;
}

/** Checked here first (type, size), compressed when it is a picture, then
    checked again by the server before anything is stored. */
export async function uploadFile(file: File): Promise<{ file?: ChatFile; error?: string }> {
  if (!TYPES.has(file.type)) return { error: "Only JPG, PNG, WebP or PDF" };
  let body: Blob = file;
  if (file.type.startsWith("image/")) {
    try { const { compressImage } = await import("@/lib/compress-image"); body = await compressImage(file, 1600, 0.82); } catch { body = file; }
  }
  if (body.size > CHAT_LIMITS.file) return { error: `${file.name} is over 2 MB` };
  const type = body.type && TYPES.has(body.type) ? body.type : file.type;
  const res = await csrfFetch("/api/v1/staff/chat/files", { method: "POST", body, headers: { "Content-Type": type, "X-File-Name": encodeURIComponent(file.name) } });
  const data = (await res.json().catch(() => null)) as { file?: ChatFile; error?: { message?: string } } | null;
  if (!res.ok || !data?.file) return { error: data?.error?.message ?? "The file could not be sent" };
  return { file: data.file };
}

export async function startDirect(userId: number): Promise<number | string> {
  const r = await api<{ conversation: ChatConv; error?: { message?: string } }>("/staff/chat/direct", { method: "POST", body: JSON.stringify({ user_id: userId }) });
  if (!r.ok || !r.data?.conversation) return (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Could not open the chat";
  const c = r.data.conversation;
  set((s) => ({ convs: s.convs.some((x) => x.id === c.id) ? s.convs : [c, ...s.convs] }));
  return c.id;
}

export async function createGroup(name: string, memberIds: number[]): Promise<number | string> {
  const r = await api<{ conversation: ChatConv; error?: { message?: string } }>("/staff/chat/groups", { method: "POST", body: JSON.stringify({ name, member_ids: memberIds }) });
  if (!r.ok || !r.data?.conversation) return (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Could not make the group";
  await refreshInbox();
  return r.data.conversation.id;
}

export async function editGroup(conv: number, patch: { name?: string; add?: number[]; remove?: number[] }): Promise<string | null> {
  const r = await api<{ error?: { message?: string } }>(`/staff/chat/groups/${conv}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!r.ok) return (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Could not change the group";
  await refreshInbox();
  return null;
}

export async function leaveGroup(conv: number): Promise<string | null> {
  const r = await api<{ error?: { message?: string } }>(`/staff/chat/groups/${conv}/leave`, { method: "POST", body: "{}" });
  if (!r.ok) return (r.data as { error?: { message?: string } } | null)?.error?.message ?? "Could not leave the group";
  set((s) => { const messages = { ...s.messages }; delete messages[conv]; return { messages, convs: s.convs.filter((c) => c.id !== conv) }; });
  return null;
}

/** A picture is fetched with the session and shown from memory; the URL is
    revoked when its message expires or the chat closes. */
export async function pictureUrl(fileId: string): Promise<string | null> {
  const have = objectUrls.get(fileId);
  if (have) return have;
  const res = await fetch(`/api/v1/staff/chat/files/${fileId}`, { credentials: "include", cache: "no-store" });
  if (!res.ok) return null;
  const url = URL.createObjectURL(await res.blob());
  objectUrls.set(fileId, url);
  return url;
}
export const fileHref = (fileId: string) => `/api/v1/staff/chat/files/${fileId}`;
