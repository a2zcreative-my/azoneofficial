"use client";

/**
 * v1.181.16 - MONTHLY INVOICES DUE (ERP roadmap, phase 4), on Sales.
 *
 * A client's monthly invoice is never raised by itself. When its day comes
 * it is listed here (and on the Desk); "Fill the form" loads the invoice it
 * repeats into the normal Create document form, with a reference that marks
 * the month raised once it is saved. The person reviews it and saves it -
 * the same form, the same checks, the same numbering as any invoice.
 */

import { dmy, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { rowBtn } from "@/components/ui/row-button";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export interface RecurringRow { id: number; company: string; source_number: string | null; total_cents: number | null; due_on: string; due: boolean; raised: boolean }

export function RecurringDue({ rows, onFill }: { rows: RecurringRow[]; onFill: (id: number) => void }) {
  const due = rows.filter((r) => r.due);
  if (due.length === 0) return null;
  return (
    <div className={`${css.stack} ${css.dueStrip} erp-note erp-note-info`} role="status">
      <span className={css.whatTitle}>{L(`Monthly invoices to raise · ${due.length}`, `Invois bulanan untuk dibuat · ${due.length}`)}</span>
      <ul className={css.list} aria-label={L("Monthly invoices to raise", "Invois bulanan untuk dibuat")}>
        {due.map((r) => (
          <li key={r.id} className={css.item}>
            <span className={css.what}><span className={css.whatTitle}>{r.company}</span>
              <span className={css.whatDetail}>{L(`repeats ${r.source_number ?? "-"} · due ${dmy(r.due_on)}`, `ulang ${r.source_number ?? "-"} · perlu ${dmy(r.due_on)}`)}</span></span>
            {r.total_cents != null && <span className={css.amount}>{fmtRM(r.total_cents)}</span>}
            <button type="button" className={rowBtn} onClick={() => onFill(r.id)}>{L("Fill the form", "Isi borang")}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
