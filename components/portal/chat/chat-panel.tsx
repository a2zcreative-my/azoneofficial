"use client";

/* v1.364.0 - STAFF CHAT ON SCREEN (the CEO's brief and pictures, 18-11-2026;
   decisions in docs/STAFF-CHAT-STAGE-0-AUDIT.md).

   ChatButton sits in the existing header beside the bell, with the unread
   count. It opens ONE drawer - the shared SideDrawer in its form size: a wide
   panel at the right on a desktop, the whole screen on a phone (PWA). There
   is no new sidebar item, no phone-bar stop and no new tab.

   From 1024px the list and the conversation sit side by side; below it, one
   at a time with a Back button. No call buttons, no emoji picker, no
   reactions (the brief). "Messages expire after 12 hours" is always on
   screen, and so is the rule that chat is never the official record. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SideDrawer } from "@/components/ui/side-drawer";
import { PillSwitch } from "@/components/ui/panel";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { SkelRows } from "@/components/ui/skeleton";
import { L } from "@/components/portal/page-shared";
import { btnHdr } from "@/lib/ui-styles";
import {
  useChat, chatStart, chatStop, openConversation, loadOlder, sendMessage, uploadFile, startDirect,
  createGroup, editGroup, leaveGroup, pictureUrl, fileHref, serverNow, CHAT_LIMITS, CHAT_ACCEPT,
  type ChatConv, type ChatFile, type ChatMsg, type ChatPerson,
} from "@/lib/chat-client";
import css from "./chat.module.css";

/* ---------------- the header button ---------------- */

export function ChatButton({ role }: { role: string }) {
  /* every staff role, custom roles included: the server decides on every call,
     and the icon goes away by itself if it says no (status "unavailable") */
  const may = role !== "agent" && role !== "customer";
  const chat = useChat();
  /* a push opens the portal at /portal?chat=1: the chat opens once (the shell
     draws after sign-in, in the browser, so the address is there to read) */
  const [open, setOpen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("chat") === "1");
  useEffect(() => {
    if (!may) return;
    chatStart();
    if (new URLSearchParams(location.search).get("chat") === "1") {
      const u = new URL(location.href); u.searchParams.delete("chat"); history.replaceState(null, "", u.toString());
    }
    return () => chatStop();
  }, [may]);
  if (!may || chat.status === "unavailable") return null;
  const n = chat.total;
  return (
    <>
      <button type="button" className={`${btnHdr} ${css.anchor}`} onClick={() => setOpen(true)} data-testid="chat-button"
        aria-label={n > 0 ? L(`Staff chat - ${n} unread`, `Sembang staf - ${n} belum dibaca`) : L("Staff chat", "Sembang staf")}>
        <AppIcon name="chat" className="erp-icon" />
        {n > 0 && <span className="erp-badge" data-testid="chat-unread">{n > 9 ? "9+" : n}</span>}
      </button>
      {/* drawn on the page, not inside the header: the phone header's blur
          makes it the box a fixed layer is placed in (v1.174.2's lesson) */}
      {typeof document !== "undefined" && createPortal(
        <SideDrawer open={open} onClose={() => setOpen(false)} form icon="chat"
          title={L("Staff Chat", "Sembang Staf")}
          subtitle={L("Internal communication for A2Z team only", "Komunikasi dalaman untuk pasukan A2Z sahaja")}>
          <ChatBody />
        </SideDrawer>, document.body)}
    </>
  );
}

/* ---------------- small helpers ---------------- */

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kuala_Lumpur" }).toUpperCase();
const mytDay = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
function dayWord(ms: number) {
  const d = mytDay(ms), today = mytDay(serverNow()), yday = mytDay(serverNow() - 86400_000);
  return d === today ? L("Today", "Hari ini") : d === yday ? L("Yesterday", "Semalam") : d.split("-").reverse().join("-");
}
const listTime = (ms: number) => (mytDay(ms) === mytDay(serverNow()) ? fmtTime(ms) : dayWord(ms));
const sizeWord = (b: number) => (b >= 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

function useNames() {
  const chat = useChat();
  return useMemo(() => {
    const byId = new Map(chat.people.map((p) => [p.id, p] as const));
    const name = (id: number) => byId.get(id)?.name ?? L("Former staff", "Bekas staf");
    const title = (c: ChatConv) => c.kind === "group" ? (c.name ?? L("Group", "Kumpulan")) : name(c.members.find((m) => m.id !== chat.me)?.id ?? 0);
    const other = (c: ChatConv) => c.kind === "direct" ? byId.get(c.members.find((m) => m.id !== chat.me)?.id ?? 0) ?? null : null;
    return { byId, name, title, other };
  }, [chat.people, chat.me]);
}

function Notice() {
  return (
    <div className={css.notice} role="note" data-testid="chat-expiry-notice">
      <span className={css.noticeItem}>
        <AppIcon name="time" className={css.noticeIcon} />
        <span><strong>{L("Messages expire after 12 hours", "Mesej tamat selepas 12 jam")}</strong>
          <small>{L("Chats and attachments are removed automatically.", "Sembang dan lampiran dipadam secara automatik.")}</small></span>
      </span>
      <span className={css.noticeItem}>
        <AppIcon name="attach" className={css.noticeIcon} />
        <span><strong>{L("Attachments: JPG, PNG, WebP or PDF", "Lampiran: JPG, PNG, WebP atau PDF")}</strong>
          <small>{L("2 MB each, 3 per message. Files are not virus-scanned.", "2 MB setiap satu, 3 setiap mesej. Fail tidak diimbas virus.")}</small></span>
      </span>
    </div>
  );
}

/* ---------------- the body: list | conversation ---------------- */

type Pane = { kind: "list" } | { kind: "conv"; id: number } | { kind: "new" };

function ChatBody() {
  const chat = useChat();
  const [pane, setPane] = useState<Pane>({ kind: "list" });
  const active = pane.kind === "conv" ? pane.id : null;
  useEffect(() => { void openConversation(active); return () => { void openConversation(null); }; }, [active]);

  if (chat.status === "revoked") {
    return <div className={css.state} data-testid="chat-revoked"><AppIcon name="lock" /><p>{L("Your chat access has ended. Sign in again if you are still on staff.", "Akses sembang anda telah tamat. Log masuk semula jika anda masih staf.")}</p></div>;
  }
  return (
    <div className={css.root} data-pane={pane.kind}>
      <Notice />
      {chat.status === "offline" && <p className={css.offline} role="status">{L("Reconnecting... new messages will appear when the connection is back.", "Menyambung semula... mesej baharu akan muncul apabila sambungan pulih.")}</p>}
      <div className={css.split}>
        <section className={css.listPane} aria-label={L("Conversations", "Perbualan")}>
          {pane.kind === "new"
            ? <NewChat onDone={(id) => setPane(id ? { kind: "conv", id } : { kind: "list" })} />
            : <Inbox active={active} onOpen={(id) => setPane({ kind: "conv", id })} onNew={() => setPane({ kind: "new" })} />}
        </section>
        <section className={css.convPane} aria-label={L("Conversation", "Perbualan")}>
          {active !== null
            ? <Conversation key={active} id={active} onBack={() => setPane({ kind: "list" })} />
            : <div className={css.state}><AppIcon name="chat" /><p>{L("Choose a conversation, or start one with +.", "Pilih perbualan, atau mulakan dengan +.")}</p></div>}
        </section>
      </div>
    </div>
  );
}

function Inbox({ active, onOpen, onNew }: { active: number | null; onOpen: (id: number) => void; onNew: () => void }) {
  const chat = useChat();
  const { title, other, name } = useNames();
  const [kind, setKind] = useState<"all" | "direct" | "group">("all");
  const [q, setQ] = useState("");
  const list = chat.convs.filter((c) => kind === "all" || c.kind === kind)
    .filter((c) => !q.trim() || title(c).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <div className={css.listHead}>
        <PillSwitch label={L("Which conversations", "Perbualan mana")} value={kind} onChange={setKind} testid="chat-filter"
          options={[["all", L("All", "Semua")], ["direct", L("Direct", "Terus")], ["group", L("Groups", "Kumpulan")]]} />
        <button type="button" className={`erp-button erp-button-accent ${css.plus}`} onClick={onNew} data-testid="chat-new"
          aria-label={L("New chat or group", "Sembang atau kumpulan baharu")}><AppIcon name="add" /></button>
      </div>
      <label className={css.search}>
        <AppIcon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search chats...", "Cari sembang...")} aria-label={L("Search chats", "Cari sembang")} />
      </label>
      <ul className={css.rows} data-testid="chat-list">
        {list.length === 0 && <li className={css.empty}>{chat.convs.length === 0 ? L("No conversations yet. Press + to start one.", "Belum ada perbualan. Tekan + untuk mula.") : L("Nothing matches.", "Tiada padanan.")}</li>}
        {list.map((c) => {
          const o = other(c);
          const prev = c.last
            ? `${c.kind === "group" && c.last.sender_id !== chat.me ? `${firstName(name(c.last.sender_id))}: ` : c.last.sender_id === chat.me ? L("You: ", "Anda: ") : ""}${c.last.preview || (c.last.files ? L("Attachment", "Lampiran") : "")}`
            : c.kind === "group" ? L(`${c.members.length} members`, `${c.members.length} ahli`) : L("No messages in the last 12 hours", "Tiada mesej dalam 12 jam lalu");
          return (
            <li key={c.id}>
              <button type="button" className={css.row} aria-current={c.id === active ? "true" : undefined} onClick={() => onOpen(c.id)} data-testid={`chat-conv-${c.id}`}>
                {o ? <Face name={o.name} photoKey={o.photo_key} userId={o.id} online={chat.online.includes(o.id)} dot={o.can_chat} />
                  : <span className={css.groupMark} aria-hidden><AppIcon name="users" /></span>}
                <span className={css.rowText}>
                  <span className={css.rowTop}><strong>{title(c)}</strong>{c.last && <time>{listTime(c.last.at)}</time>}</span>
                  <span className={css.rowBottom}><span className={css.preview}>{c.last?.files && !c.last.preview ? <><AppIcon name="attach" /> {prev}</> : prev}</span>
                    {c.unread > 0 && <span className={css.unread} aria-label={L(`${c.unread} unread`, `${c.unread} belum dibaca`)}>{c.unread}</span>}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A photo with its presence dot: green online, grey offline (the CEO, 18-11-2026).
    Online means the person has the portal open right now. */
function Face({ name, photoKey, userId, online, size = "md", dot = true }: { name: string; photoKey: string | null; userId: number; online: boolean; size?: "md" | "lg"; dot?: boolean }) {
  return (
    <span className={css.face}>
      <Avatar name={name} photoKey={photoKey} userId={userId} size={size} />
      {dot && <span className={`${css.dot} ${online ? css.dotOn : ""}`} role="img" aria-label={online ? L("Online", "Dalam talian") : L("Offline", "Luar talian")} data-testid="chat-presence" data-online={online ? "1" : "0"} />}
    </span>
  );
}

const whyWord = (why: ChatPerson["why"]) =>
  why === "no_2fa" ? L("Can chat once they turn on 2FA", "Boleh bersembang selepas 2FA dihidupkan")
    : why === "off" ? L("Chat is switched off for their role", "Sembang dimatikan untuk peranan mereka")
      : L("Cannot use chat", "Tidak boleh guna sembang");

function PeoplePicker({ picked, onPick, multi, exclude = [] }: { picked: number[]; onPick: (p: ChatPerson) => void; multi: boolean; exclude?: number[] }) {
  const chat = useChat();
  const [q, setQ] = useState("");
  /* every current colleague; one who cannot chat yet is shown, greyed, with why */
  const people = chat.people.filter((p) => p.on_staff && p.id !== chat.me && !exclude.includes(p.id))
    .filter((p) => !q.trim() || `${p.name} ${p.position ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <label className={css.search}>
        <AppIcon name="search" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff...", "Cari staf...")} aria-label={L("Search staff", "Cari staf")} autoFocus />
      </label>
      <ul className={css.rows} data-testid="chat-people">
        {people.length === 0 && <li className={css.empty}>{L("Nobody matches.", "Tiada padanan.")}</li>}
        {people.map((p) => (
          <li key={p.id}>
            <button type="button" className={css.row} aria-pressed={multi ? picked.includes(p.id) : undefined} onClick={() => onPick(p)} data-testid={`chat-person-${p.id}`}
              disabled={!p.can_chat} title={p.can_chat ? undefined : whyWord(p.why)}>
              <Face name={p.name} photoKey={p.photo_key} userId={p.id} online={chat.online.includes(p.id)} dot={p.can_chat} />
              <span className={css.rowText}>
                <span className={css.rowTop}><strong>{p.name}</strong>{p.can_chat && (chat.online.includes(p.id) ? <small className={css.on}>{L("Online", "Dalam talian")}</small> : <small className={css.off}>{L("Offline", "Luar talian")}</small>)}</span>
                <span className={css.rowBottom}><span className={css.preview}>{p.can_chat ? (p.position ?? p.role.replace(/_/g, " ")) : whyWord(p.why)}</span>{multi && picked.includes(p.id) && <span className={css.tick} aria-hidden>✓</span>}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function NewChat({ onDone }: { onDone: (id: number | null) => void }) {
  const [group, setGroup] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const max = 7; // 8 with you
  return (
    <div className={css.newChat}>
      <div className={css.listHead}>
        <button type="button" className="erp-icon-button" onClick={() => onDone(null)} aria-label={L("Back to chats", "Kembali ke sembang")}><AppIcon name="previous" /></button>
        <strong className={css.grow}>{group ? L("New group", "Kumpulan baharu") : L("New chat", "Sembang baharu")}</strong>
        <PillSwitch label={L("Chat or group", "Sembang atau kumpulan")} value={group ? "group" : "direct"} onChange={(v) => { setGroup(v === "group"); setErr(null); }} testid="chat-new-kind"
          options={[["direct", L("Direct", "Terus")], ["group", L("Group", "Kumpulan")]]} />
      </div>
      {group && (
        <div className={css.groupForm}>
          <input className="erp-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={L("Group name, e.g. Operations Team", "Nama kumpulan, cth. Pasukan Operasi")} aria-label={L("Group name", "Nama kumpulan")} data-testid="chat-group-name" />
          <small className="erp-meta">{L(`${picked.length} of ${max} chosen - a group is up to 8 people with you`, `${picked.length} daripada ${max} dipilih - kumpulan sehingga 8 orang termasuk anda`)}</small>
        </div>
      )}
      {err && <p className={css.err} role="alert">{err}</p>}
      <PeoplePicker multi={group} picked={picked} onPick={async (p) => {
        if (!group) { setBusy(true); const r = await startDirect(p.id); setBusy(false); if (typeof r === "number") onDone(r); else setErr(r); return; }
        setPicked((x) => x.includes(p.id) ? x.filter((i) => i !== p.id) : x.length >= max ? x : [...x, p.id]);
      }} />
      {group && (
        <div className={css.newFoot}>
          <button type="button" className="erp-button erp-button-accent" disabled={busy || !name.trim() || picked.length === 0} data-testid="chat-group-create"
            onClick={async () => { setBusy(true); setErr(null); const r = await createGroup(name.trim(), picked); setBusy(false); if (typeof r === "number") onDone(r); else setErr(r); }}>
            {L("Create group", "Cipta kumpulan")}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- one conversation ---------------- */

function Conversation({ id, onBack }: { id: number; onBack: () => void }) {
  const chat = useChat();
  const { title, other, name } = useNames();
  const conv = chat.convs.find((c) => c.id === id);
  const msgs = chat.messages[id] ?? null;
  const [info, setInfo] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs?.length]);
  if (!conv) return <div className={css.state}><p>{L("This conversation is no longer available.", "Perbualan ini tidak lagi tersedia.")}</p></div>;
  const o = other(conv);
  const sub = conv.kind === "group" ? L(`${conv.members.length} members`, `${conv.members.length} ahli`)
    : o && !o.can_chat ? L("No longer on staff", "Tidak lagi staf") : o && chat.online.includes(o.id) ? L("Online", "Dalam talian") : L("Offline", "Luar talian");
  const otherRead = conv.kind === "direct" ? (conv.members.find((m) => m.id !== chat.me)?.last_read ?? 0) : 0;

  let lastDay = "";
  return (
    <div className={css.conv} data-testid="chat-conversation">
      <header className={css.convHead}>
        <button type="button" className={`erp-icon-button ${css.back}`} onClick={onBack} aria-label={L("Back to chats", "Kembali ke sembang")} data-testid="chat-back"><AppIcon name="previous" /></button>
        {o ? <Face name={o.name} photoKey={o.photo_key} userId={o.id} size="lg" online={chat.online.includes(o.id)} dot={o.can_chat} />
          : <span className={css.groupMark} aria-hidden><AppIcon name="users" /></span>}
        <span className={css.convTitle}><strong>{title(conv)}</strong>
          <small className={o && chat.online.includes(o.id) ? css.on : css.off} data-testid="chat-status">{sub}</small></span>
        {conv.kind === "group" && <button type="button" className="erp-icon-button" aria-expanded={info} onClick={() => setInfo((v) => !v)} aria-label={L("Group members", "Ahli kumpulan")} data-testid="chat-group-info"><AppIcon name="info" /></button>}
      </header>
      {info && conv.kind === "group" ? <GroupInfo conv={conv} onLeft={onBack} /> : (
        <>
          <div className={css.msgs} ref={scroller} data-testid="chat-messages"
            onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
            {chat.more[id] && <button type="button" className={`erp-button erp-button-secondary erp-button-compact ${css.older}`} onClick={() => void loadOlder(id)}>{L("Show earlier messages", "Tunjuk mesej terdahulu")}</button>}
            {msgs === null && <SkelRows rows={4} />}
            {msgs?.length === 0 && <p className={css.empty}>{L("No messages in the last 12 hours. Say hello.", "Tiada mesej dalam 12 jam lalu. Mulakan perbualan.")}</p>}
            {msgs?.map((m) => {
              const day = mytDay(m.created_at);
              const sep = day !== lastDay ? <div className={css.day} key={`d${day}`}><span>{dayWord(m.created_at)}</span></div> : null;
              lastDay = day;
              return [sep, <Bubble key={m.client_id ?? m.id} m={m} mine={m.sender_id === chat.me} who={conv.kind === "group" && m.sender_id !== chat.me ? name(m.sender_id) : null}
                read={conv.kind === "direct" && m.sender_id === chat.me && otherRead >= m.id} />];
            })}
          </div>
          <Composer conv={id} disabled={o ? !o.can_chat : false} />
        </>
      )}
    </div>
  );
}

function Bubble({ m, mine, who, read }: { m: ChatMsg; mine: boolean; who: string | null; read: boolean }) {
  return (
    <div className={`${css.bubbleRow} ${mine ? css.mine : ""}`} data-testid="chat-message" data-id={m.id} data-expires={m.expires_at}>
      <div className={css.bubble} title={L(`Deletes at ${fmtTime(m.expires_at)}`, `Dipadam pada ${fmtTime(m.expires_at)}`)}>
        {who && <span className={css.who}>{who}</span>}
        {m.text && <p className={css.text}>{m.text}</p>}
        {m.files.map((f) => <FileChip key={f.id} f={f} sent={!m.pending} />)}
        <span className={css.meta}>
          <time>{fmtTime(m.created_at)}</time>
          {mine && (m.pending ? <span aria-label={L("Sending", "Menghantar")}>…</span>
            : <span className={read ? css.read : undefined} aria-label={read ? L("Read", "Dibaca") : L("Sent", "Dihantar")}>{read ? "✓✓" : "✓"}</span>)}
        </span>
      </div>
    </div>
  );
}

function FileChip({ f, sent }: { f: ChatFile; sent: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!sent || !f.type.startsWith("image/")) return;
    let live = true;
    void pictureUrl(f.id).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [f.id, f.type, sent]);
  if (f.type.startsWith("image/") && url) {
    return (
      <a className={css.picture} href={url} target="_blank" rel="noopener noreferrer" aria-label={L(`Open picture ${f.name}`, `Buka gambar ${f.name}`)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={f.name} />
      </a>
    );
  }
  return (
    <a className={css.file} href={sent ? fileHref(f.id) : undefined} download={f.name} data-testid="chat-file">
      <span className={css.fileIcon} aria-hidden><AppIcon name="document" /></span>
      <span className={css.fileText}><strong>{f.name}</strong><small>{f.type === "application/pdf" ? "PDF" : f.type.split("/")[1]?.toUpperCase()} · {sizeWord(f.size)}</small></span>
      {sent && <AppIcon name="download" />}
    </a>
  );
}

function Composer({ conv, disabled }: { conv: number; disabled: boolean }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const area = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { const a = area.current; if (!a) return; a.style.height = "auto"; a.style.height = `${Math.min(a.scrollHeight, 140)}px`; }, [text]);
  const total = files.reduce((s, f) => s + f.size, 0);
  const send = async () => {
    const t = text.trim();
    if ((!t && files.length === 0) || busy) return;
    setBusy(true); setErr(null);
    const why = await sendMessage(conv, t, files);
    setBusy(false);
    if (why) { setErr(why); return; }
    setText(""); setFiles([]);
    area.current?.focus();
  };
  const add = async (list: FileList | null) => {
    if (!list) return;
    setErr(null);
    for (const file of Array.from(list)) {
      if (files.length >= CHAT_LIMITS.files) { setErr(L("At most 3 files in one message", "Paling banyak 3 fail dalam satu mesej")); break; }
      setBusy(true);
      const r = await uploadFile(file);
      setBusy(false);
      if (r.error || !r.file) { setErr(r.error ?? L("The file could not be sent", "Fail tidak dapat dihantar")); continue; }
      if (total + r.file.size > CHAT_LIMITS.total) { setErr(L("Files in one message are at most 5 MB together", "Fail dalam satu mesej paling banyak 5 MB")); continue; }
      setFiles((x) => [...x, r.file!]);
    }
    if (picker.current) picker.current.value = "";
  };
  if (disabled) return <p className={css.closed}>{L("This person is no longer on staff - the chat is closed.", "Orang ini tidak lagi staf - sembang ditutup.")}</p>;
  return (
    <div className={css.composer}>
      {files.length > 0 && (
        <ul className={css.attached} aria-label={L("Attached files", "Fail dilampirkan")}>
          {files.map((f) => (
            <li key={f.id}><AppIcon name="attach" /><span>{f.name}</span><small>{sizeWord(f.size)}</small>
              <button type="button" className="erp-icon-button" onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={L(`Remove ${f.name}`, `Buang ${f.name}`)}><AppIcon name="close" /></button></li>
          ))}
        </ul>
      )}
      {err && <p className={css.err} role="alert" data-testid="chat-error">{err}</p>}
      <div className={css.compose}>
        <input ref={picker} type="file" accept={CHAT_ACCEPT} multiple hidden onChange={(e) => void add(e.target.files)} data-testid="chat-file-input" />
        <button type="button" className={`erp-icon-button ${css.attach}`} onClick={() => picker.current?.click()} disabled={busy || files.length >= CHAT_LIMITS.files}
          aria-label={L("Attach a file (JPG, PNG, WebP or PDF, 2 MB)", "Lampirkan fail (JPG, PNG, WebP atau PDF, 2 MB)")} data-testid="chat-attach"><AppIcon name="add" /></button>
        <textarea ref={area} rows={1} value={text} maxLength={CHAT_LIMITS.text} className={css.input} data-testid="chat-input"
          placeholder={L("Type a message...", "Taip mesej...")} aria-label={L("Message", "Mesej")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(min-width: 1024px)").matches) { e.preventDefault(); void send(); } }} />
        <button type="button" className={`erp-button erp-button-accent ${css.send}`} onClick={() => void send()} disabled={busy || (!text.trim() && files.length === 0)}
          aria-label={L("Send", "Hantar")} data-testid="chat-send"><AppIcon name="send" /></button>
      </div>
      <p className={css.foot}>
        <AppIcon name="time" />
        <span className={css.footLong}>{L("Messages in this chat delete automatically 12 hours after they are sent. Not for approvals, payments, HR decisions or instructions - use the module.", "Mesej dalam sembang ini dipadam secara automatik 12 jam selepas dihantar. Bukan untuk kelulusan, bayaran, keputusan HR atau arahan - guna modul.")}</span>
        <span className={css.footShort}>{L("Deletes 12 hours after sending. Not the official record.", "Dipadam 12 jam selepas dihantar. Bukan rekod rasmi.")}</span>
        {text.length > CHAT_LIMITS.text - 200 && <small className={css.count}>{text.length}/{CHAT_LIMITS.text}</small>}
      </p>
    </div>
  );
}

function GroupInfo({ conv, onLeft }: { conv: ChatConv; onLeft: () => void }) {
  const chat = useChat();
  const { byId } = useNames();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(conv.name ?? "");
  const maker = conv.created_by === chat.me;
  const room = 8 - conv.members.length;
  const wrap = (node: ReactNode) => <div className={css.info} data-testid="chat-group-panel">{node}</div>;
  if (adding) return wrap(
    <>
      <p className="erp-meta">{L(`Add up to ${room} more (8 at most).`, `Tambah sehingga ${room} lagi (paling banyak 8).`)}</p>
      <PeoplePicker multi picked={picked} exclude={conv.members.map((m) => m.id)} onPick={(p) => setPicked((x) => x.includes(p.id) ? x.filter((i) => i !== p.id) : x.length >= room ? x : [...x, p.id])} />
      {err && <p className={css.err} role="alert">{err}</p>}
      <div className={css.newFoot}>
        <button type="button" className="erp-button erp-button-secondary" onClick={() => { setAdding(false); setPicked([]); }}>{L("Cancel", "Batal")}</button>
        <button type="button" className="erp-button erp-button-accent" disabled={!picked.length} onClick={async () => { const e = await editGroup(conv.id, { add: picked }); if (e) setErr(e); else { setAdding(false); setPicked([]); } }}>{L("Add", "Tambah")}</button>
      </div>
    </>,
  );
  return wrap(
    <>
      <label className="erp-stack">
        <span className="erp-meta">{L("Group name", "Nama kumpulan")}</span>
        <span className={css.inline}>
          <input className="erp-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="erp-button erp-button-secondary erp-button-compact" disabled={!name.trim() || name.trim() === conv.name}
            onClick={async () => { const e = await editGroup(conv.id, { name: name.trim() }); setErr(e); }}>{L("Rename", "Tukar nama")}</button>
        </span>
      </label>
      <ul className={css.rows}>
        {conv.members.map((m) => {
          const p = byId.get(m.id);
          return (
            <li key={m.id} className={css.memberRow}>
              <Face name={p?.name ?? "?"} photoKey={p?.photo_key ?? null} userId={m.id} online={chat.online.includes(m.id)} dot={Boolean(p?.can_chat)} />
              <span className={css.rowText}><strong>{p?.name ?? L("Former staff", "Bekas staf")}{m.id === chat.me ? L(" (you)", " (anda)") : ""}</strong>
                <small className="erp-meta">{m.id === conv.created_by ? L("Made the group", "Pencipta kumpulan") : p?.position ?? ""}</small></span>
              {maker && m.id !== chat.me && <button type="button" className="erp-button erp-button-secondary erp-button-compact" onClick={async () => setErr(await editGroup(conv.id, { remove: [m.id] }))}>{L("Remove", "Buang")}</button>}
            </li>
          );
        })}
      </ul>
      {err && <p className={css.err} role="alert">{err}</p>}
      <div className={css.newFoot}>
        {room > 0 && <button type="button" className="erp-button erp-button-secondary" onClick={() => setAdding(true)}><AppIcon name="add" />{L("Add people", "Tambah orang")}</button>}
        <button type="button" className="erp-button erp-button-danger" onClick={async () => { const e = await leaveGroup(conv.id); if (e) setErr(e); else onLeft(); }} data-testid="chat-leave">{L("Leave group", "Keluar kumpulan")}</button>
      </div>
    </>,
  );
}
