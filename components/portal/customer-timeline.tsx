"use client";

/**
 * v1.181.13 - ONE CLIENT'S STORY (ERP roadmap, phase 1).
 *
 * Every quotation and its revisions, invoice, payment, receipt and credit
 * note for one customer, newest first - and the enquiries, engagements and
 * live sessions too, for the roles whose own screens show those. A pure
 * read (GET /staff/customers/:id/timeline). What a role may not see is not
 * fetched at all, and the panel says so in one line instead of pretending
 * the client has no enquiries.
 */

import { useEffect, useState } from "react";

import { openAppDialog } from "@/components/ui/app-dialog";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Ev { at: string; kind: string; title: string; detail?: string | null; amount_cents?: number | null; doc_id?: number | null; tab?: string }
interface Tl { customer: { id: number; company: string }; events: Ev[]; hidden: string[] }

const HIDDEN_WORD: Record<string, [string, string]> = {
  live_sessions: ["live sessions", "sesi live"],
  enquiries: ["enquiries", "pertanyaan"],
  engagements: ["engagements", "penglibatan"],
};

/** "2026-10-20 14:05" or "2026-10-20" -> "20-10-2026 14:05" / "20-10-2026" */
const when = (at: string) => `${dmy(at.slice(0, 10))}${at.length > 10 ? ` ${at.slice(11, 16)}` : ""}`;

export function CustomerTimeline({ customerId }: { customerId: number }) {
  const [data, setData] = useState<Tl | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void api<Tl>(`/staff/customers/${customerId}/timeline`).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setData(r.data); else setFailed(true);
    });
    return () => { live = false; };
  }, [customerId]);

  if (failed) return <p className={`${css.empty} ${css.dialog}`}>{L("The history could not be loaded. Try again.", "Sejarah tidak dapat dimuatkan. Cuba lagi.")}</p>;
  if (!data) return <div className={css.dialog}><SkelRows rows={5} /></div>;
  const hiddenWords = data.hidden.map((h) => (HIDDEN_WORD[h] ? L(HIDDEN_WORD[h]![0], HIDDEN_WORD[h]![1]) : h));
  return (
    <div className={`${css.stack} ${css.dialog}`}>
      {data.events.length === 0 ? (
        <p className={css.empty}>{L("Nothing recorded for this client yet.", "Belum ada rekod untuk klien ini.")}</p>
      ) : (
        <ul className={css.list} aria-label={L(`History of ${data.customer.company}`, `Sejarah ${data.customer.company}`)}>
          {data.events.map((e, i) => (
            <li key={`${e.kind}-${e.at}-${i}`} className={css.tlItem}>
              <span className={css.when}>{when(e.at)}</span>
              <span className={css.what}>
                <span className={css.whatTitle}>{e.title}</span>
                {e.detail ? <span className={css.whatDetail}>{e.detail}</span> : null}
              </span>
              {typeof e.amount_cents === "number" ? <span className={css.amount}>{fmtRM(e.amount_cents)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {hiddenWords.length > 0 && (
        <p className={css.hiddenNote}>
          {L(`Not shown for your role: ${hiddenWords.join(", ")}.`, `Tidak dipaparkan untuk peranan anda: ${hiddenWords.join(", ")}.`)}
        </p>
      )}
    </div>
  );
}

/** Open a client's history in the app dialog. */
export function openCustomerTimeline(customerId: number, company: string) {
  openAppDialog(L(`History · ${company}`, `Sejarah · ${company}`), <CustomerTimeline customerId={customerId} />);
}
