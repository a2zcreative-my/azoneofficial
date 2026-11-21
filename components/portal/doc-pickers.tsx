"use client";

/* v1.400.0 - THE CREATE FORM'S TWO PICKERS (Sales Command Center Phase 4; the CEO, 21-11-2026, "As recommended").

   CustomerPicker  decision 1: type to search EVERY customer (the server's Leads & CRM search: name, contact,
                   phone or email), instead of a list cut at the first 300. Walk-in stays one press away. The
                   chosen customer's card is fetched whole, so the paper prints its address. Adding a new
                   customer stays where it was (Leads & CRM -> Add customer, with its duplicate check).
   DealPicker      decision 3: an optional "Deal" for a quotation - the open deals of the chosen customer that
                   this person may change. Nothing is linked unless one is chosen; a quotation made from a
                   deal arrives with it chosen. The server links it when the quotation is saved.

   QuoteStateChips decision 5: where an open quotation stands on the Documents list - one chip (Accepted,
                   Expired, Expires in N days, Open N days) and the follow-up under it (lib/quote-state.ts).

   All three only READ. Every write is the existing POST /docs. */

import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM } from "@/lib/format";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { chipSmDanger, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClass, selectClass } from "@/lib/ui-styles";
import { quoteState, type QuoteLike } from "@/lib/quote-state";
import { STAGE_WORD, type Stage } from "@/lib/pipeline-words";
import css from "./doc-pickers.module.css";

export interface PickedCustomer { id: number; company: string; contact_person: string | null; phone: string | null; email: string | null; address?: string | null; owner_id?: number | null }
interface Hit { id: number; company: string; contact_person: string | null; phone: string | null; email: string | null; owner_id: number | null }

export function CustomerPicker({ value, known, onPick }: {
  /** the chosen customer id: -1 none, 0 walk-in */
  value: number;
  /** the customers Sales already holds (for the chosen one's name without a request) */
  known: { id: number; company: string }[];
  onPick: (c: PickedCustomer | null, id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const listId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const chosen = value === 0 ? L("Walk-in / general buyer", "Walk-in / pembeli umum") : value > 0 ? known.find((c) => c.id === value)?.company ?? name : null;

  /* one search a moment after typing stops; the server pages and searches the whole customer table */
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const c = new AbortController();
    const t = window.setTimeout(() => {
      setBusy(true);
      void api<{ rows?: Hit[] }>(`/staff/crm/leads?view=all&sort=name&q=${encodeURIComponent(term)}`, { signal: c.signal }).then((r) => {
        if (c.signal.aborted) return;
        setBusy(false);
        setHits(r.ok ? (r.data?.rows ?? []).slice(0, 12) : []);
      });
    }, 300);
    return () => { c.abort(); window.clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);

  const pick = async (h: Hit) => {
    setOpen(false); setQ(""); setHits(null); setName(h.company);
    onPick({ ...h }, h.id);
    /* the whole card (its address prints on the paper) */
    const r = await api<{ lead?: PickedCustomer & { address?: string | null } }>(`/staff/crm/leads/${h.id}`);
    if (r.ok && r.data?.lead) onPick({ ...h, address: r.data.lead.address ?? null }, h.id);
  };
  const term = q.trim();
  return (
    <div className={css.picker} ref={box} data-testid="cust-picker">
      {chosen && !open ? (
        <div className={css.chosen}>
          <span className={css.chosenName} data-testid="cust-picker-chosen">{chosen}</span>
          <button type="button" className={css.change} onClick={() => { setOpen(true); setQ(""); }} data-testid="cust-picker-change">{L("Change", "Tukar")}</button>
        </div>
      ) : (
        <>
          <label className={css.search}>
            <AppIcon name="search" />
            <span className="erp-sr-only">{L("Customer", "Pelanggan")}</span>
            <input type="search" className={inputClass} value={q} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={listId}
              placeholder={L("Search every customer: name, contact, phone or email…", "Cari semua pelanggan: nama, hubungan, telefon atau e-mel…")}
              onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); if (e.target.value.trim().length < 2) setHits(null); }}
              onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} data-testid="cust-picker-q" />
          </label>
          {open && (
            <ul className={css.list} id={listId} role="listbox" aria-label={L("Customers", "Pelanggan")} data-testid="cust-picker-list">
              <li><button type="button" role="option" aria-selected={value === 0} className={css.option} onClick={() => { setOpen(false); setQ(""); onPick(null, 0); }} data-testid="cust-picker-walkin">
                <strong>{L("Walk-in / general buyer", "Walk-in / pembeli umum")}</strong><span>{L("No address printed", "Tiada alamat dicetak")}</span></button></li>
              {term.length < 2 ? <li className={css.hint}>{L("Type 2 letters to search every customer.", "Taip 2 huruf untuk mencari semua pelanggan.")}</li>
                : busy && !hits ? <li className={css.hint} aria-busy="true" data-testid="cust-picker-busy"><SkelRows rows={3} /></li>
                  : (hits ?? []).length === 0 ? <li className={css.hint} data-testid="cust-picker-none">{L("No customer matches. Add them in Leads & CRM first.", "Tiada pelanggan sepadan. Tambah mereka di Prospek & CRM dahulu.")}</li>
                    : (hits ?? []).map((h) => (
                      <li key={h.id}><button type="button" role="option" aria-selected={value === h.id} className={css.option} onClick={() => void pick(h)} data-testid={`cust-picker-${h.id}`}>
                        <strong>{h.company}</strong><span>{[h.contact_person, h.phone, h.email].filter(Boolean).join(" · ") || L("No contact yet", "Tiada hubungan lagi")}</span></button></li>
                    ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface DealRow { id: number; title: string; stage: Stage; owner_id: number | null; value_cents: number | null }
interface Board { deals: DealRow[] }
interface Opts { can_assign: boolean; can_write: boolean; me: number }

export function DealPicker({ customerId, value, onChange }: { customerId: number; value: number | null; onChange: (id: number | null) => void }) {
  const on = customerId > 0;
  const list = useCachedApi<Board>(`/staff/deals?customer=${customerId}`, on, ["deals"]);
  const opts = useCachedApi<Opts>("/staff/deals/options", on, ["deals"]);
  const o = opts.data;
  const open = (list.data?.deals ?? []).filter((d) => ["new", "qualified", "proposal", "negotiation"].includes(d.stage)
    && !!o?.can_write && (o.can_assign || d.owner_id === o.me || d.owner_id === null));
  /* a deal chosen for another customer, or one that closed, is dropped */
  const stale = value !== null && !!list.data && !!o && !open.some((d) => d.id === value);
  useEffect(() => { if (stale) onChange(null); }, [stale, onChange]);
  if (!on || (list.data && open.length === 0 && value === null)) return null;
  return (
    <label className={css.deal} data-testid="doc-deal">
      <span>{L("Deal (optional)", "Urusan (pilihan)")}</span>
      <select className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} data-testid="doc-deal-select">
        <option value="">{L("Not linked to a deal", "Tidak dipaut kepada urusan")}</option>
        {open.map((d) => <option key={d.id} value={d.id}>{d.title} · {L(STAGE_WORD[d.stage][0], STAGE_WORD[d.stage][1])}{d.value_cents != null ? ` · ${fmtRM(d.value_cents)}` : ""}</option>)}
      </select>
      <small>{L("Saving links the quotation to the deal; a deal in New or Qualified moves to Proposal sent. It is never marked won by this.", "Menyimpan memaut sebut harga kepada urusan; urusan di Baharu atau Layak beralih ke Cadangan dihantar. Ia tidak sekali-kali ditanda berjaya oleh ini.")}</small>
    </label>
  );
}

export function QuoteStateChips({ d, today }: { d: QuoteLike & { revision?: number | null }; today: string }) {
  const st = quoteState(d, today);
  if (!st) return null;
  const chip = st.accepted
    ? <span className={chipSmSuccess} data-testid="qt-state" data-state="accepted">{d.revision ? L(`Accepted · rev ${d.revision}`, `Diterima · sem ${d.revision}`) : L("Accepted", "Diterima")}</span>
    : st.expired
      ? <span className={chipSmDanger} data-testid="qt-state" data-state="expired">{L("Expired", "Tamat tempoh")}</span>
      : st.expiring
        ? <span className={chipSmWarn} data-testid="qt-state" data-state="expiring">{st.days_left === 0 ? L("Expires today", "Tamat hari ini") : L(`Expires in ${st.days_left} day${st.days_left === 1 ? "" : "s"}`, `Tamat dalam ${st.days_left} hari`)}</span>
        : <span className={chipSmNeutral} data-testid="qt-state" data-state="open">{L(`Open ${st.age_days} day${st.age_days === 1 ? "" : "s"}`, `Terbuka ${st.age_days} hari`)}</span>;
  return (
    <>
      {chip}
      {!st.accepted && (
        <span className={st.followup ? css.fuOn : css.fuOff} data-testid="qt-followup" data-booked={st.followup ? "1" : "0"}>
          {st.followup ? L("Follow-up booked", "Susulan ditetapkan") : L("No follow-up", "Tiada susulan")}
        </span>
      )}
    </>
  );
}
