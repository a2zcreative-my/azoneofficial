"use client";

/**
 * v1.181.16 - A CLIENT'S FILE (ERP roadmap, phase 4).
 *
 * Sales -> Customers -> a client's row -> File. Everything that sits beside
 * the customer record without changing it:
 *
 *   Tags            free words (retainer, hijab, F&B) the client list filters by
 *   Credit terms    days to pay. With terms set, a NEW invoice for this client
 *                   is created with a due date; invoices already issued are
 *                   never touched. No terms, nothing changes.
 *   Contacts        more than one person at the company
 *   Follow-ups      a day, an owner, a note. Due ones sit on the owner's Desk.
 *   Monthly invoice an invoice to raise again on a day each month. Nothing
 *                   raises it by itself: the Desk and the Sales tab list it
 *                   when due, and a person fills the normal form from it.
 *
 * Reads need Sales; changes need the sales permission (the server says which).
 */

import { useEffect, useState } from "react";

import { openAppDialog } from "@/components/ui/app-dialog";
import { rowBtn } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Contact { id: number; name: string; role: string | null; phone: string | null; email: string | null; note: string | null }
interface Followup { id: number; due_on: string; note: string; owner_name: string | null; done_at: string | null; done_note: string | null; cancelled_at: string | null; done_by_name: string | null }
interface Recurring { id: number; source_number: string | null; total_cents: number | null; day_of_month: number; note: string | null; due_on: string; raised: boolean; raised_number: string | null; due: boolean }
interface Invoice { id: number; doc_number: string; total_cents: number; created_at: string }
interface File {
  customer: { id: number; company: string };
  contacts: Contact[]; tags: string[]; all_tags: string[]; terms_days: number | null;
  followups: Followup[]; recurring: Recurring[]; invoices: Invoice[]; owners: { id: number; name: string }[]; me: number;
  today: string; can_write: boolean; pending_migration?: boolean;
}

const TERMS = [7, 14, 30, 45, 60, 90];
const errOf = (r: { data?: unknown }) => (r.data as { error?: { message?: string } } | null)?.error?.message;

export function CustomerFile({ customerId, onChanged }: { customerId: number; onChanged?: () => void }) {
  const [f, setF] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const { show: toast, node: toastNode } = useSaveToast();
  const [tagDraft, setTagDraft] = useState("");
  const [terms, setTerms] = useState("");
  const [ct, setCt] = useState({ name: "", role: "", phone: "", email: "" });
  const [fu, setFu] = useState({ due_on: "", note: "", owner: "" });
  const [rec, setRec] = useState({ source: "", day: "1" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void api<File>(`/staff/customers/${customerId}/file`).then((r) => {
      if (!live) return;
      if (r.ok && r.data) { setF(r.data); setTerms(r.data.terms_days ? String(r.data.terms_days) : ""); } else setFailed(true);
    });
    return () => { live = false; };
  }, [customerId, tick]);

  /** one write, one toast, one reload */
  const send = async (path: string, method: string, payload: unknown, done: string): Promise<boolean> => {
    setBusy(true);
    const r = await api(path, { method, body: JSON.stringify(payload ?? {}) });
    setBusy(false);
    if (!r.ok) { toast(L("No changes", "Tiada perubahan"), errOf(r) ?? L("Not saved", "Tidak disimpan"), "notice"); return false; }
    toast(L("Saved", "Disimpan"), done);
    setTick((t) => t + 1); onChanged?.();
    return true;
  };

  if (failed) return <p className={`${css.empty} ${css.dialog}`}>{L("The client file could not be loaded. Try again.", "Fail klien tidak dapat dimuatkan. Cuba lagi.")}</p>;
  if (!f) return <div className={css.dialog}><SkelRows rows={6} /></div>;
  if (f.pending_migration) return <p className={`erp-note erp-note-warning ${css.dialog}`}>{L("The client file needs the 0143 database update. It is applied by the next PUSH.bat.", "Fail klien memerlukan kemas kini pangkalan data 0143. Ia dipasang oleh PUSH.bat seterusnya.")}</p>;

  const w = f.can_write;
  const saveTags = (tags: string[]) => send(`/staff/customers/${customerId}/tags`, "PUT", { tags }, L("Tags saved", "Tag disimpan"));
  const open = f.followups.filter((x) => !x.done_at && !x.cancelled_at);
  const closed = f.followups.filter((x) => x.done_at || x.cancelled_at).slice(0, 5);

  return (
    <div className={`${css.stack} ${css.dialog}`}>
      {toastNode}
      {!w && <p className={css.hiddenNote}>{L("You can read this file. Changes need the sales permission.", "Anda boleh membaca fail ini. Perubahan memerlukan kebenaran jualan.")}</p>}

      {/* ---- tags ---- */}
      <p className={css.sub}>{L("Tags", "Tag")}</p>
      <div className={css.figures}>
        {f.tags.length === 0 && <span className={css.empty}>{L("No tags yet.", "Belum ada tag.")}</span>}
        {f.tags.map((t) => (
          <span key={t} className={chipSmNeutral}>
            {t}
            {w && <button type="button" className={css.chipX} aria-label={L(`Remove tag ${t}`, `Buang tag ${t}`)} disabled={busy} onClick={() => void saveTags(f.tags.filter((x) => x !== t))}>×</button>}
          </span>
        ))}
      </div>
      {w && (
        <div className={css.form}>
          <label className={css.field}>{L("Add a tag", "Tambah tag")}
            <input className={inputClassSm} list="crm-tags" value={tagDraft} maxLength={30} placeholder={L("e.g. retainer", "cth. retainer")} onChange={(e) => setTagDraft(e.target.value)} />
            <datalist id="crm-tags">{f.all_tags.filter((t) => !f.tags.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
          </label>
          <button type="button" className={btnSm} disabled={busy || tagDraft.trim().length < 2} onClick={() => { void saveTags([...f.tags, tagDraft]).then((ok) => { if (ok) setTagDraft(""); }); }}>{L("Add tag", "Tambah tag")}</button>
        </div>
      )}

      {/* ---- credit terms ---- */}
      <p className={css.sub}>{L("Credit terms", "Terma kredit")}</p>
      <p className={css.hiddenNote}>
        {f.terms_days
          ? L(`${f.terms_days} days. A new invoice for this client is created with its due date ${f.terms_days} days after the invoice date. Invoices already issued are not changed.`,
            `${f.terms_days} hari. Invois baharu untuk klien ini dibuat dengan tarikh perlu dibayar ${f.terms_days} hari selepas tarikh invois. Invois sedia ada tidak diubah.`)
          : L("None. Invoices print \"Payment due: On receipt\", as today.", "Tiada. Invois mencetak \"Payment due: On receipt\", seperti biasa.")}
      </p>
      {w && (
        <div className={css.form}>
          <label className={css.field}>{L("Days to pay", "Hari untuk bayar")}
            <select className={selectClassSm} value={terms} onChange={(e) => setTerms(e.target.value)}>
              <option value="">{L("No terms", "Tiada terma")}</option>
              {TERMS.map((d) => <option key={d} value={d}>{L(`${d} days`, `${d} hari`)}</option>)}
            </select>
          </label>
          <button type="button" className={btnSm} disabled={busy || terms === (f.terms_days ? String(f.terms_days) : "")}
            onClick={() => void send(`/staff/customers/${customerId}/terms`, "PUT", { terms_days: terms ? Number(terms) : null }, terms ? L(`Terms set to ${terms} days`, `Terma ditetapkan ${terms} hari`) : L("Terms cleared", "Terma dikosongkan"))}>
            {L("Save terms", "Simpan terma")}
          </button>
        </div>
      )}

      {/* ---- contacts ---- */}
      <p className={css.sub}>{L("Contacts", "Orang hubungan")} · {f.contacts.length}</p>
      {f.contacts.length === 0 ? <p className={css.empty}>{L("Only the main contact on the customer record.", "Hanya orang hubungan utama pada rekod pelanggan.")}</p> : (
        <ul className={css.list} aria-label={L("Contacts", "Orang hubungan")}>
          {f.contacts.map((c) => (
            <li key={c.id} className={css.item}>
              <span className={css.what}><span className={css.whatTitle}>{c.name}{c.role ? ` · ${c.role}` : ""}</span>
                <span className={css.whatDetail}>{[c.phone, c.email].filter(Boolean).join(" · ") || "-"}</span></span>
              {c.phone && <a className={rowBtn} href={`https://wa.me/${c.phone.replace(/\D/g, "").replace(/^0/, "60")}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
              {w && <button type="button" className={rowBtn} disabled={busy} onClick={() => void send(`/staff/customers/${customerId}/contacts/${c.id}/remove`, "POST", {}, L(`${c.name} removed`, `${c.name} dibuang`))}>{L("Remove", "Buang")}</button>}
            </li>
          ))}
        </ul>
      )}
      {w && (
        <div className={css.form}>
          <label className={css.field}>{L("Name", "Nama")}<input className={inputClassSm} value={ct.name} maxLength={120} onChange={(e) => setCt({ ...ct, name: e.target.value })} /></label>
          <label className={css.field}>{L("Role", "Jawatan")}<input className={inputClassSm} value={ct.role} maxLength={80} placeholder={L("e.g. Finance", "cth. Kewangan")} onChange={(e) => setCt({ ...ct, role: e.target.value })} /></label>
          <label className={css.field}>{L("Phone", "Telefon")}<input className={inputClassSm} value={ct.phone} maxLength={40} inputMode="tel" onChange={(e) => setCt({ ...ct, phone: e.target.value })} /></label>
          <label className={css.field}>{L("Email", "E-mel")}<input className={inputClassSm} value={ct.email} maxLength={200} inputMode="email" onChange={(e) => setCt({ ...ct, email: e.target.value })} /></label>
          <button type="button" className={btnSm} disabled={busy || ct.name.trim().length < 2}
            onClick={() => { void send(`/staff/customers/${customerId}/contacts`, "POST", ct, L(`${ct.name} added`, `${ct.name} ditambah`)).then((ok) => { if (ok) setCt({ name: "", role: "", phone: "", email: "" }); }); }}>
            {L("Add contact", "Tambah orang hubungan")}
          </button>
        </div>
      )}

      {/* ---- follow-ups ---- */}
      <p className={css.sub}>{L("Follow-ups", "Susulan")} · {open.length}</p>
      {open.length === 0 && <p className={css.empty}>{L("Nothing to follow up.", "Tiada susulan.")}</p>}
      {open.length > 0 && (
        <ul className={css.list} aria-label={L("Open follow-ups", "Susulan terbuka")}>
          {open.map((x) => (
            <li key={x.id} className={css.item}>
              <span className={css.when}>{dmy(x.due_on)}</span>
              <span className={css.what}><span className={css.whatTitle}>{x.note}</span>
                <span className={css.whatDetail}>{x.owner_name ?? L("nobody", "tiada sesiapa")}</span></span>
              {x.due_on < f.today ? <span className={chipSmWarn}>{L("overdue", "lewat")}</span> : x.due_on === f.today ? <span className={chipSmNeutral}>{L("today", "hari ini")}</span> : null}
              {w && <button type="button" className={rowBtn} disabled={busy} onClick={() => void send(`/staff/followups/${x.id}/done`, "POST", {}, L("Follow-up done", "Susulan selesai"))}>{L("Done", "Selesai")}</button>}
              {w && <button type="button" className={rowBtn} disabled={busy} onClick={() => void send(`/staff/followups/${x.id}/cancel`, "POST", {}, L("Follow-up cancelled", "Susulan dibatalkan"))}>{L("Cancel", "Batal")}</button>}
            </li>
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <ul className={css.list} aria-label={L("Recent follow-ups", "Susulan terkini")}>
          {closed.map((x) => (
            <li key={x.id} className={`${css.item} ${css.voided}`}>
              <span className={css.when}>{dmy(x.due_on)}</span>
              <span className={css.what}><span className={css.whatTitle}>{x.note}</span>
                <span className={css.whatDetail}>{x.done_at ? L(`done ${dmyMYT(x.done_at)}${x.done_by_name ? ` by ${x.done_by_name}` : ""}`, `selesai ${dmyMYT(x.done_at)}${x.done_by_name ? ` oleh ${x.done_by_name}` : ""}`) : L("cancelled", "dibatalkan")}</span></span>
            </li>
          ))}
        </ul>
      )}
      {w && (
        <div className={css.form}>
          <label className={css.field}>{L("Follow up on", "Susulan pada")}<input className={inputClassSm} type="date" min={mytToday()} value={fu.due_on} onChange={(e) => setFu({ ...fu, due_on: e.target.value })} /></label>
          <label className={css.field}>{L("About", "Tentang")}<input className={inputClassSm} value={fu.note} maxLength={300} placeholder={L("e.g. Ask about the Raya package", "cth. Tanya tentang pakej Raya")} onChange={(e) => setFu({ ...fu, note: e.target.value })} /></label>
          <label className={css.field}>{L("Owner", "Pemilik")}
            <select className={selectClassSm} value={fu.owner} onChange={(e) => setFu({ ...fu, owner: e.target.value })}>
              <option value="">{L("Me", "Saya")}</option>
              {f.owners.filter((o) => o.id !== f.me).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <button type="button" className={btnSm} disabled={busy || !fu.due_on || fu.note.trim().length < 3}
            onClick={() => { void send(`/staff/customers/${customerId}/followups`, "POST", { due_on: fu.due_on, note: fu.note, owner_id: fu.owner ? Number(fu.owner) : undefined }, L("Follow-up added", "Susulan ditambah")).then((ok) => { if (ok) setFu({ due_on: "", note: "", owner: "" }); }); }}>
            {L("Add follow-up", "Tambah susulan")}
          </button>
        </div>
      )}

      {/* ---- monthly invoice ---- */}
      <p className={css.sub}>{L("Monthly invoice", "Invois bulanan")}</p>
      {f.recurring.length === 0 ? <p className={css.empty}>{L("No invoice repeats for this client.", "Tiada invois berulang untuk klien ini.")}</p> : (
        <ul className={css.list} aria-label={L("Monthly invoices", "Invois bulanan")}>
          {f.recurring.map((r) => (
            <li key={r.id} className={css.item}>
              <span className={css.what}><span className={css.whatTitle}>{L(`Repeats ${r.source_number ?? "-"} on day ${r.day_of_month}`, `Ulang ${r.source_number ?? "-"} pada hari ${r.day_of_month}`)}</span>
                <span className={css.whatDetail}>{r.raised ? L(`this month: ${r.raised_number}`, `bulan ini: ${r.raised_number}`) : L(`this month due ${dmy(r.due_on)}`, `bulan ini perlu ${dmy(r.due_on)}`)}</span></span>
              {r.total_cents != null && <span className={css.amount}>{fmtRM(r.total_cents)}</span>}
              <span className={r.raised ? chipSmSuccess : r.due ? chipSmWarn : chipSmNeutral}>{r.raised ? L("raised", "dibuat") : r.due ? L("due", "perlu") : L("later", "kemudian")}</span>
              {w && <button type="button" className={rowBtn} disabled={busy} onClick={() => void send(`/staff/customers/recurring/${r.id}/stop`, "POST", {}, L("Monthly invoice stopped", "Invois bulanan dihentikan"))}>{L("Stop", "Henti")}</button>}
            </li>
          ))}
        </ul>
      )}
      {w && f.invoices.length > 0 && (
        <>
          <p className={css.hiddenNote}>{L("Nothing is raised by itself. When it is due, it shows on the Desk and on Sales, and you fill the normal invoice form from it.",
            "Tiada yang dibuat sendiri. Apabila tiba masanya, ia dipaparkan di Meja dan di Jualan, dan anda mengisi borang invois biasa daripadanya.")}</p>
          <div className={css.form}>
            <label className={css.field}>{L("Invoice to repeat", "Invois untuk diulang")}
              <select className={selectClassSm} value={rec.source} onChange={(e) => setRec({ ...rec, source: e.target.value })}>
                <option value="">{L("- pick an invoice -", "- pilih invois -")}</option>
                {f.invoices.map((i) => <option key={i.id} value={i.id}>{i.doc_number} · {fmtRM(i.total_cents)}</option>)}
              </select>
            </label>
            <label className={css.field}>{L("Day of the month", "Hari dalam bulan")}
              <select className={selectClassSm} value={rec.day} onChange={(e) => setRec({ ...rec, day: e.target.value })}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <button type="button" className={btnSmPrimary} disabled={busy || !rec.source}
              onClick={() => { void send(`/staff/customers/recurring`, "POST", { source_doc_id: Number(rec.source), day_of_month: Number(rec.day) }, L("Monthly invoice set", "Invois bulanan ditetapkan")).then((ok) => { if (ok) setRec({ source: "", day: "1" }); }); }}>
              {L("Repeat monthly", "Ulang setiap bulan")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Open a client's file in the app dialog. */
export function openCustomerFile(customerId: number, company: string, onChanged?: () => void) {
  openAppDialog(L(`File · ${company}`, `Fail · ${company}`), <CustomerFile customerId={customerId} onChanged={onChanged} />);
}
