"use client";

/**
 * THE ENQUIRIES TAB — v1.112.0.
 *
 * The CEO, 05-09-2026: *"Customer enquiries - I think should create a new
 * tabs under customer/client inquiry which is require Staff action for
 * response their inquire either via apps or emails."*
 *
 * Since v1.21.0 the enquiries were a card at the top of the Sales tab, with a
 * status dropdown and (v1.4.191) an in-app reply. That card is now this tab,
 * and an enquiry is WORK rather than a record: the chips at the top are the
 * worklist (Waiting, Overdue, Mine, ...), a waiting enquiry can be TAKEN so
 * two people do not answer the same customer, one that has waited a day is
 * marked overdue, and the same enquiry sits on the One Desk of everyone who
 * can answer it until somebody does. The reply stays in-app (the customer
 * reads it on their Account page) - the CEO chose that for now; WhatsApp and
 * mailto links remain for answering outside, followed by setting the status.
 *
 * Remembered and live (lib/cached-api, topic "enquiries"): a colleague's reply
 * or take shows here without a refresh.
 *
 * WHO: enquiry_manage - ENQUIRY_ROLES in lib/portal-tabs.ts.
 */

import { useMemo, useState } from "react";
import { makeApi } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, StaleHint } from "@/components/ui/skeleton";
import { rowBtn } from "@/components/ui/row-button";
import { card, inputClassSm, btnSm, btnSmPrimary } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const api = makeApi("");

interface Enq {
  id: number; name: string; company: string | null; phone: string | null; email: string | null; message: string;
  category: string | null; status: string; reply: string | null; replied_at: string | null; replied_name: string | null;
  assigned_to: number | null; assigned_name: string | null; created_at: string; overdue: boolean; hours_waiting: number;
}
interface Person { id: number; name: string; role: string }
interface Data { enquiries: Enq[]; counts: Record<string, number>; people: Person[]; overdue_hours: number }

const STATUS_LABEL: Record<string, [string, string]> = {
  new: ["Waiting", "Menunggu"],
  contacted: ["Answered", "Dijawab"],
  qualified: ["Became business", "Jadi urusan"],
  closed: ["Closed", "Ditutup"],
};
const STATUS_CLASS: Record<string, string> = {
  new: "bg-warning-soft text-warning",
  contacted: "bg-primary/10 text-primary",
  qualified: "bg-success-soft text-success",
  closed: "bg-secondary text-muted-foreground",
};
const CATEGORY_LABEL: Record<string, [string, string]> = {
  general: ["General", "Umum"],
  package_pricing: ["Package & pricing", "Pakej & harga"],
  live_commerce: ["Live commerce", "Jualan LIVE"],
  order_delivery: ["Order & delivery", "Pesanan & penghantaran"],
  collaboration: ["Collaboration", "Kerjasama"],
};
/* the worklist chips; "" is everything */
const FILTERS: { key: string; en: string; ms: string; count: (c: Record<string, number>) => number | null }[] = [
  { key: "new", en: "Waiting", ms: "Menunggu", count: (c) => c.new ?? 0 },
  { key: "overdue", en: "Overdue", ms: "Tertunggak", count: (c) => c.overdue ?? 0 },
  { key: "mine", en: "Mine", ms: "Saya", count: (c) => c.mine ?? 0 },
  { key: "contacted", en: "Answered", ms: "Dijawab", count: (c) => c.contacted ?? 0 },
  { key: "qualified", en: "Became business", ms: "Jadi urusan", count: (c) => c.qualified ?? 0 },
  { key: "closed", en: "Closed", ms: "Ditutup", count: (c) => c.closed ?? 0 },
  { key: "", en: "All", ms: "Semua", count: () => null },
];
const statusLabel = (s: string) => { const p = STATUS_LABEL[s]; return p ? L(p[0], p[1]) : s; };
const categoryLabel = (c: string | null) => { if (!c) return null; const p = CATEGORY_LABEL[c]; return p ? L(p[0], p[1]) : c.replace(/_/g, " "); };

function waited(h: number): string {
  if (h < 1) return L("just now", "baru sahaja");
  if (h < 48) return L(`${h}h`, `${h}j`);
  return L(`${Math.round(h / 24)}d`, `${Math.round(h / 24)}h`);
}
function dmyhm(sqlite: string): string {
  const t = new Date(sqlite.replace(" ", "T") + "Z");
  if (Number.isNaN(t.getTime())) return sqlite;
  const m = new Date(t.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(m.getUTCDate())}-${p(m.getUTCMonth() + 1)}-${m.getUTCFullYear()} ${p(m.getUTCHours())}:${p(m.getUTCMinutes())}`;
}
const waDigits = (phone: string) => { const d = phone.replace(/\D/g, ""); return d.startsWith("0") ? `6${d}` : d; };

export function EnquiriesPanel({ userId }: { userId: number }) {
  const { show: toast, node: toastNode } = useSaveToast();
  const [filter, setFilter] = useState<string>("new");
  const [open, setOpen] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  /* the server filters by status; "overdue" and "mine" are cuts of everything open */
  const serverStatus = filter === "new" || filter === "contacted" || filter === "qualified" || filter === "closed" ? filter : "";
  const view = useCachedApi<Data>(`/enquiries${serverStatus ? `?status=${serverStatus}` : ""}`, true, ["enquiries"]);
  const counts = view.data?.counts ?? {};
  const list = useMemo(() => {
    const all = view.data?.enquiries ?? [];
    if (filter === "overdue") return all.filter((e) => e.overdue);
    if (filter === "mine") return all.filter((e) => e.assigned_to === userId && e.status !== "closed");
    return all;
  }, [view.data, filter, userId]);
  const people = view.data?.people ?? [];

  const patch = async (e: Enq, body: Record<string, unknown>, done: [string, string], fail: [string, string]) => {
    setBusy(e.id);
    const r = await api<{ ok?: boolean; error?: { message?: string } }>(`/enquiries/${e.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setBusy(null);
    if (r.ok) { toast(L(done[0], done[1]), e.name); view.refresh(); return true; }
    toast(L(fail[0], fail[1]), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
    return false;
  };
  const reply = async (e: Enq) => {
    const text = (draft[e.id] ?? "").trim();
    if (!text) { toast(L("Nothing to send", "Tiada apa untuk dihantar"), L("Write the reply first", "Tulis balasan dahulu"), "notice"); return; }
    const ok = await patch(e, { reply: text }, ["Reply sent — the customer reads it on their Account page", "Balasan dihantar — pelanggan membacanya di halaman Akaun mereka"], ["Not sent — your text is still in the box", "Tidak dihantar — teks anda masih dalam kotak"]);
    if (ok) setDraft((d) => ({ ...d, [e.id]: "" }));
  };

  if (view.loading) {
    return (
      <div className={card} aria-busy="true">
        <Skel className="h-4 w-40" />
        <div className="mt-3 flex gap-1.5">{Array.from({ length: 5 }, (_, i) => <Skel key={i} className="h-6 w-20 rounded-full" />)}</div>
        <div className="mt-3 space-y-2">{Array.from({ length: 5 }, (_, i) => <Skel key={i} className="h-14" />)}</div>
      </div>
    );
  }

  return (
    <div className={card}>
      {toastNode}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {(counts.new ?? 0) > 0 ? L(`Enquiries — ${counts.new} waiting`, `Pertanyaan — ${counts.new} menunggu`) : L("Enquiries", "Pertanyaan")}
            <StaleHint show={view.stale} className="ml-2" />
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(`Customers who wrote to us from the website or their Account page. A reply here reaches them on their Account page; one that has waited ${view.data?.overdue_hours ?? 24} hours is overdue.`,
               `Pelanggan yang menulis kepada kami dari laman web atau halaman Akaun mereka. Balasan di sini sampai kepada mereka di halaman Akaun; yang menunggu ${view.data?.overdue_hours ?? 24} jam adalah tertunggak.`)}
          </p>
        </div>
        {(counts.overdue ?? 0) > 0 && (
          <span className="bg-warning-soft text-warning rounded-full px-2.5 py-1 text-[11px] font-medium">
            {L(`${counts.overdue} overdue`, `${counts.overdue} tertunggak`)}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label={L("Show enquiries that are", "Tunjuk pertanyaan yang")}>
        {FILTERS.map((f) => {
          const n = f.count(counts);
          return (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${filter === f.key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
              {L(f.en, f.ms)}{n !== null ? ` ${n}` : ""}
            </button>
          );
        })}
      </div>

      {list.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {filter === "new" ? L("Nobody is waiting. Every enquiry has been answered.", "Tiada siapa menunggu. Semua pertanyaan telah dijawab.")
            : filter === "overdue" ? L("Nothing overdue.", "Tiada yang tertunggak.")
            : filter === "mine" ? L("Nothing is assigned to you.", "Tiada yang ditugaskan kepada anda.")
            : L("No enquiries here.", "Tiada pertanyaan di sini.")}
        </p>
      ) : (
        <ul className="divide-border mt-3 divide-y overflow-y-auto overscroll-contain pr-1" style={{ maxHeight: "min(40rem, calc(100svh - 18rem))" }}>
          {list.map((e) => {
            const isOpen = open === e.id;
            const mine = e.assigned_to === userId;
            return (
              <li key={e.id} className="py-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.id)}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{e.name}</span>
                      {e.company && <span className="text-muted-foreground text-xs">· {e.company}</span>}
                      <span className={`rounded-full px-2 py-px text-[10px] font-medium ${STATUS_CLASS[e.status] ?? STATUS_CLASS.closed}`}>{statusLabel(e.status)}</span>
                      {e.overdue && <span className="bg-warning-soft text-warning rounded-full px-2 py-px text-[10px] font-medium">{L("overdue", "tertunggak")}</span>}
                      {e.category && <span className="bg-secondary rounded-full px-2 py-px text-[10px]">{categoryLabel(e.category)}</span>}
                    </span>
                    <span className={`mt-0.5 block text-xs ${isOpen ? "whitespace-pre-wrap" : "truncate"} text-muted-foreground`}>{e.message}</span>
                    <span className="text-muted-foreground mt-0.5 block text-[11px] tabular-nums">
                      {dmyhm(e.created_at)} · {e.status === "new" ? L(`waiting ${waited(e.hours_waiting)}`, `menunggu ${waited(e.hours_waiting)}`) : waited(e.hours_waiting) + " " + L("ago", "lalu")}
                      {e.assigned_name ? ` · ${mine ? L("yours", "anda") : e.assigned_name}` : e.status === "new" ? ` · ${L("nobody has taken it", "belum diambil siapa")}` : ""}
                    </span>
                  </button>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {e.status === "new" && !mine && (
                      <button type="button" className={btnSmPrimary} disabled={busy === e.id}
                        onClick={() => void patch(e, { assigned_to: userId }, ["You took it — it is on your desk until answered", "Anda mengambilnya — ia di meja anda sehingga dijawab"], ["Not taken", "Tidak diambil"])}>
                        {L("Take it", "Ambil")}
                      </button>
                    )}
                    {e.phone && (
                      <a className={rowBtn} target="_blank" rel="noopener noreferrer" href={`https://wa.me/${waDigits(e.phone)}`}>WhatsApp</a>
                    )}
                    {e.email && <a className={rowBtn} href={`mailto:${e.email}?subject=${encodeURIComponent(L("Your enquiry to A2Z Creative Marketing", "Pertanyaan anda kepada A2Z Creative Marketing"))}`}>{L("Email", "E-mel")}</a>}
                  </span>
                </div>

                {isOpen && (
                  <div className="bg-secondary/40 mt-2 rounded-lg p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {e.phone && <span>{e.phone}</span>}
                      {e.email && <span className="truncate">{e.email}</span>}
                    </div>

                    {e.reply && (
                      <div className="bg-success-soft text-success mt-2 rounded-lg px-2.5 py-2">
                        <p className="text-[10px] font-semibold tracking-wider uppercase">
                          {L("Replied", "Dibalas")}{e.replied_name ? ` · ${e.replied_name}` : ""}{e.replied_at ? ` · ${dmyhm(e.replied_at)}` : ""}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap">{e.reply}</p>
                      </div>
                    )}

                    {e.status !== "closed" && (
                      <div className="mt-2">
                        <textarea className={`${inputClassSm} w-full`} rows={3} maxLength={2000} value={draft[e.id] ?? ""}
                          placeholder={e.reply ? L("Write a further reply — it replaces the one the customer sees", "Tulis balasan lanjut — ia menggantikan yang dilihat pelanggan")
                                              : L("Write the reply the customer will read on their Account page", "Tulis balasan yang akan dibaca pelanggan di halaman Akaun mereka")}
                          aria-label={L("Reply", "Balasan")} onChange={(ev) => setDraft((d) => ({ ...d, [e.id]: ev.target.value }))} />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button type="button" className={btnSmPrimary} disabled={busy === e.id} onClick={() => void reply(e)}>
                            {busy === e.id ? <Skel className="inline-block h-3 w-12" /> : L("Send reply", "Hantar balasan")}
                          </button>
                          {e.status === "new" && (
                            <button type="button" className={btnSm} disabled={busy === e.id}
                              onClick={() => void patch(e, { status: "contacted" }, ["Marked answered", "Ditanda dijawab"], ["Not changed", "Tidak diubah"])}>
                              {L("Answered outside (WhatsApp / email)", "Dijawab di luar (WhatsApp / e-mel)")}
                            </button>
                          )}
                          {e.status !== "qualified" && (
                            <button type="button" className={btnSm} disabled={busy === e.id}
                              onClick={() => void patch(e, { status: "qualified" }, ["Marked as business — raise the quotation on Sales", "Ditanda sebagai urusan — buat sebut harga di Jualan"], ["Not changed", "Tidak diubah"])}>
                              {L("Became business", "Jadi urusan")}
                            </button>
                          )}
                          <button type="button" className={btnSm} disabled={busy === e.id}
                            onClick={() => void patch(e, { status: "closed" }, ["Closed", "Ditutup"], ["Not changed", "Tidak diubah"])}>
                            {L("Close", "Tutup")}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Who answers", "Siapa jawab")}</span>
                      <select className={`${inputClassSm} w-auto`} value={e.assigned_to ?? ""} disabled={busy === e.id}
                        aria-label={L("Hand this enquiry to", "Serahkan pertanyaan ini kepada")}
                        onChange={(ev) => void patch(e, { assigned_to: ev.target.value ? Number(ev.target.value) : null },
                          ev.target.value ? ["Handed over — they are told", "Diserahkan — mereka dimaklumkan"] : ["Nobody has it now", "Tiada siapa memegangnya sekarang"], ["Not changed", "Tidak diubah"])}>
                        <option value="">{L("(nobody yet)", "(belum ada)")}</option>
                        {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === userId ? ` (${L("you", "anda")})` : ""}</option>)}
                      </select>
                      {e.status === "closed" && (
                        <button type="button" className="text-muted-foreground text-[11px] underline" disabled={busy === e.id}
                          onClick={() => void patch(e, { status: "new" }, ["Reopened — it is waiting again", "Dibuka semula — ia menunggu lagi"], ["Not changed", "Tidak diubah"])}>
                          {L("Reopen", "Buka semula")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
