"use client";

/* v1.216.0 - NEW ENQUIRIES ON SALES (the owner, 28-10-2026, the Sales growth
   audit M1: "Show on Sales, notify"). Since v1.183.0 the website form and the
   customer account kept saving enquiries, but nobody was told and no screen
   showed them. The Enquiries tab stays retired; this is its intake only, on
   Customers & Follow-ups, over the routes that never left:
     GET  /api/v1/enquiries          the list, who took it, who answered
     PATCH /api/v1/enquiries/:id     take it, hand it over, reply, status
   Both are the server's enquiry_manage permission; a role without it gets a
   403 and this card renders nothing. "Make quotation" is the existing
   enquiry -> quotation prefill in Sales (v1.181.16). Nothing is written here
   that those routes did not already accept. */

import { useEffect, useState } from "react";
import { SkelRows } from "@/components/ui/skeleton";
import type { ApiResult } from "@/lib/api";
import { PanelTitle } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { api } from "@/lib/api";
import { dmyMYT } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, card, inputClass } from "@/lib/ui-styles";
import type { WsScope } from "@/components/portal/sales-workspace";
import css from "./sales-enquiries.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface Enquiry {
  id: number; name: string; company: string | null; phone: string | null; email: string | null; message: string;
  category: string | null; status: string; reply: string | null; replied_at: string | null;
  assigned_to: number | null; assigned_name: string | null; replied_name: string | null; created_at: string;
  overdue?: boolean; hours_waiting?: number;
}
type View = "open" | "new" | "closed";
const STATUS_LABEL: Record<string, [string, string]> = {
  new: ["New", "Baharu"], contacted: ["Contacted", "Dihubungi"], qualified: ["Qualified", "Layak"], closed: ["Closed", "Ditutup"],
};
const chipOf = (s: string) => s === "new" ? "erp-chip-warning" : s === "qualified" ? "erp-chip-success" : s === "closed" ? "erp-chip-neutral" : "erp-chip-info";

export function SalesEnquiries({ scope, userId, onQuote }: { scope: WsScope; userId: number; onQuote: (e: Enquiry) => void }) {
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [people, setPeople] = useState<{ id: number; name: string }[]>([]);
  const [denied, setDenied] = useState(false);
  const [view, setView] = useState<View>("open");
  const [reply, setReply] = useState<Enquiry | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  type ListRes = ApiResult<{ enquiries: Enquiry[]; people: { id: number; name: string }[] }>;
  const fetchList = () => api<{ enquiries: Enquiry[]; people: { id: number; name: string }[] }>(`/enquiries`);
  const apply = (r: ListRes) => {
    if (r.status === 403) { setDenied(true); return; }
    if (r.ok && r.data) { setRows(r.data.enquiries ?? []); setPeople(r.data.people ?? []); }
    else setRows([]);
  };
  useEffect(() => {
    let alive = true;
    void fetchList().then((r) => { if (alive) apply(r); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = async () => apply(await fetchList());

  const patch = async (e: Enquiry, body: Record<string, unknown>) => {
    setBusy(true); setMsg("");
    const r = await api<{ error?: { message?: string } }>(`/enquiries/${e.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setMsg(r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("Not saved.", "Tidak disimpan.")); return false; }
    await load();
    return true;
  };

  if (denied) return null;
  /* "Mine": taken by you, or nobody's yet (a new lead is everyone's to take) */
  const scoped = (rows ?? []).filter((e) => scope === "all" || e.assigned_to === userId || e.assigned_to === null);
  const shown = scoped.filter((e) => view === "closed" ? e.status === "closed" : view === "new" ? e.status === "new" : e.status !== "closed");
  const nNew = scoped.filter((e) => e.status === "new").length;

  return (
    <section className={card} aria-label={L("New enquiries", "Pertanyaan baharu")}>
      <div className={css.head}>
        <div>
          <PanelTitle icon="chat">{L("Enquiries", "Pertanyaan")}</PanelTitle>
          <p className={css.meta}>{L("From the website and customer accounts. Take one, reply, then make the quotation.", "Daripada laman web dan akaun pelanggan. Ambil, balas, kemudian buat sebut harga.")}</p>
        </div>
        <div className={css.views} role="group" aria-label={L("Which enquiries", "Pertanyaan mana")}>
          {([["open", L("Open", "Terbuka")], ["new", L(`New (${nNew})`, `Baharu (${nNew})`)], ["closed", L("Closed", "Ditutup")]] as const).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
          ))}
        </div>
      </div>
      {msg && <p className="erp-note erp-note-warning" role="alert">{msg}</p>}
      {rows === null ? <SkelRows rows={3} />
        : shown.length === 0 ? <p className={css.empty}>{view === "new" ? L("No new enquiries.", "Tiada pertanyaan baharu.") : L("Nothing here.", "Tiada apa-apa di sini.")}</p> : (
        <ul className={css.list}>
          {shown.slice(0, 30).map((e) => (
            <li key={e.id} className={css.item}>
              <div className={css.top}>
                <strong>{e.name}{e.company ? <span className={css.co}> · {e.company}</span> : null}</strong>
                <span className={`erp-chip erp-chip-sm ${chipOf(e.status)}`}>{L(...(STATUS_LABEL[e.status] ?? [e.status, e.status]))}</span>
                {e.overdue && <span className="erp-chip erp-chip-sm erp-chip-danger">{L(`Waiting ${e.hours_waiting ?? 0} h`, `Menunggu ${e.hours_waiting ?? 0} j`)}</span>}
              </div>
              <p className={css.msg}>{e.message}</p>
              <p className={css.meta}>
                {[e.phone, e.email].filter(Boolean).join(" · ")}{e.phone || e.email ? " · " : ""}{dmyMYT(e.created_at)}
                {" · "}{e.assigned_name ? L(`Taken by ${e.assigned_name}`, `Diambil oleh ${e.assigned_name}`) : L("Nobody has taken it", "Belum diambil sesiapa")}
                {e.replied_at ? ` · ${L(`Replied by ${e.replied_name ?? "—"}`, `Dibalas oleh ${e.replied_name ?? "—"}`)}` : ""}
              </p>
              <div className={css.acts}>
                {e.assigned_to !== userId && e.status !== "closed" && (
                  <button type="button" className={btnSm} disabled={busy} onClick={() => void patch(e, { assigned_to: userId })}>{L("Take it", "Ambil")}</button>
                )}
                {e.status !== "closed" && <button type="button" className={btnSm} disabled={busy} onClick={() => { setReply(e); setText(e.reply ?? ""); }}>{L("Reply", "Balas")}</button>}
                <label className={css.sel}>
                  <span className="erp-sr-only">{L("Status", "Status")} — {e.name}</span>
                  <select className={inputClass} value={e.status} disabled={busy} onChange={(ev) => void patch(e, { status: ev.target.value })}>
                    {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{L(...v)}</option>)}
                  </select>
                </label>
                {scope === "all" && people.length > 0 && (
                  <label className={css.sel}>
                    <span className="erp-sr-only">{L("Hand over", "Serahkan")} — {e.name}</span>
                    <select className={inputClass} value={e.assigned_to ?? ""} disabled={busy} onChange={(ev) => void patch(e, { assigned_to: ev.target.value === "" ? null : Number(ev.target.value) })}>
                      <option value="">{L("Nobody", "Tiada")}</option>
                      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                )}
                {e.status !== "closed" && <button type="button" className={btnSmPrimary} onClick={() => onQuote(e)}>{L("Make quotation", "Buat sebut harga")}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <SideDrawer open={!!reply} onClose={() => setReply(null)} title={L("Reply to the enquiry", "Balas pertanyaan")} subtitle={reply ? reply.name : undefined}
        footer={<div className={css.foot}>
          <button type="button" className={btnSm} onClick={() => setReply(null)}>{L("Cancel", "Batal")}</button>
          <button type="button" className={btnSmPrimary} disabled={busy || !text.trim()} onClick={() => { if (reply) void patch(reply, { reply: text }).then((ok) => { if (ok) setReply(null); }); }}>{busy ? L("Saving…", "Menyimpan…") : L("Save reply", "Simpan balasan")}</button>
        </div>}>
        {reply && (
          <div className={css.drawer}>
            <p className={css.msg}>{reply.message}</p>
            <label className={css.field}>
              <span>{L("Your reply (kept on the enquiry; send it by phone, WhatsApp or email)", "Balasan anda (disimpan pada pertanyaan; hantar melalui telefon, WhatsApp atau e-mel)")}</span>
              <textarea className={inputClass} rows={5} maxLength={2000} value={text} onChange={(ev) => setText(ev.target.value)} />
            </label>
            <p className={css.meta}>{L("Saving a reply marks a new enquiry Contacted and takes it for you if nobody has.", "Menyimpan balasan menandakan pertanyaan baharu Dihubungi dan mengambilnya untuk anda jika belum diambil.")}</p>
          </div>
        )}
      </SideDrawer>
    </section>
  );
}
