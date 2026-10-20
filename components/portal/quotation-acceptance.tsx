"use client";

/**
 * v1.181.16 - WHAT THE CUSTOMER ACCEPTED (ERP roadmap, phase 4).
 *
 * A customer can accept a quotation on its shared link with their name and
 * position. That is recorded against the revision they were shown and
 * nothing else happens: no status moves, nothing is sent. This panel shows
 * it on the quotation, and says plainly when the customer accepted an
 * earlier revision than the one now issued.
 */

import { useEffect, useState } from "react";

import { Skel } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmyMYT } from "@/lib/format";
import { getLang } from "@/lib/i18n";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Acc { revision: number; accepted_name: string; accepted_position: string | null; accepted_at: string }

export function QuotationAcceptance({ docId, revision }: { docId: number; revision: number }) {
  const [rows, setRows] = useState<Acc[] | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ acceptances: Acc[] }>(`/staff/docs/${docId}/acceptance`).then((r) => { if (live) setRows(r.ok && r.data ? r.data.acceptances : []); });
    return () => { live = false; };
  }, [docId]);
  if (!rows) return <Skel className={css.skelLine} />;
  const now = rows.find((a) => a.revision === revision);
  const earlier = rows.find((a) => a.revision < revision);
  const rev = (n: number) => (n === 0 ? L("the original", "versi asal") : `REV ${n}`);
  if (now) {
    return (
      <span className={css.whatDetail}>
        {L(`Accepted on the shared link by ${now.accepted_name}${now.accepted_position ? `, ${now.accepted_position}` : ""} on ${dmyMYT(now.accepted_at)}.`,
          `Diterima melalui pautan oleh ${now.accepted_name}${now.accepted_position ? `, ${now.accepted_position}` : ""} pada ${dmyMYT(now.accepted_at)}.`)}
      </span>
    );
  }
  return (
    <span className={css.whatDetail}>
      {earlier
        ? L(`${earlier.accepted_name} accepted ${rev(earlier.revision)} on ${dmyMYT(earlier.accepted_at)}. This revision is not accepted yet.`,
          `${earlier.accepted_name} menerima ${rev(earlier.revision)} pada ${dmyMYT(earlier.accepted_at)}. Semakan ini belum diterima.`)
        : L("Not accepted on the shared link yet. The customer can accept it there with their name and position.",
          "Belum diterima melalui pautan. Pelanggan boleh menerimanya di sana dengan nama dan jawatan.")}
    </span>
  );
}
