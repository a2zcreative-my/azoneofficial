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

interface Acc { revision: number; accepted_name: string; accepted_position: string | null; accepted_at: string; channel?: string | null; recorded_by_name?: string | null; note?: string | null }
/* v1.246.3 - how the customer agreed, when staff recorded it */
const HOW: Record<string, [string, string]> = { whatsapp: ["on WhatsApp", "di WhatsApp"], email: ["by email", "melalui e-mel"], phone: ["by phone", "melalui telefon"], signed: ["on a signed order", "pada pesanan bertandatangan"], in_person: ["in person", "secara bersemuka"] };

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
    const how = now.channel && HOW[now.channel];
    return (
      <span className={css.whatDetail}>
        {how
          ? L(`Accepted ${how[0]} by ${now.accepted_name}${now.accepted_position ? `, ${now.accepted_position}` : ""} on ${dmyMYT(now.accepted_at)}${now.recorded_by_name ? ` - recorded by ${now.recorded_by_name}` : ""}${now.note ? ` (${now.note})` : ""}.`,
            `Diterima ${how[1]} oleh ${now.accepted_name}${now.accepted_position ? `, ${now.accepted_position}` : ""} pada ${dmyMYT(now.accepted_at)}${now.recorded_by_name ? ` - direkod oleh ${now.recorded_by_name}` : ""}${now.note ? ` (${now.note})` : ""}.`)
          : L(`Accepted on the shared link by ${now.accepted_name}${now.accepted_position ? `, ${now.accepted_position}` : ""} on ${dmyMYT(now.accepted_at)}.`,
            `Diterima melalui pautan oleh ${now.accepted_name}${now.accepted_position ? `, ${now.accepted_position}` : ""} pada ${dmyMYT(now.accepted_at)}.`)}
      </span>
    );
  }
  return (
    <span className={css.whatDetail}>
      {earlier
        ? L(`${earlier.accepted_name} accepted ${rev(earlier.revision)} on ${dmyMYT(earlier.accepted_at)}. This revision is not accepted yet.`,
          `${earlier.accepted_name} menerima ${rev(earlier.revision)} pada ${dmyMYT(earlier.accepted_at)}. Semakan ini belum diterima.`)
        : L("Not accepted yet. The customer can accept it on the shared link, or record their acceptance under Tasks > Projects (or the Project & Tasks tab) once they agree.",
          "Belum diterima. Pelanggan boleh menerimanya melalui pautan kongsi, atau rekod penerimaan mereka di bawah Tugasan > Projek (atau tab Projek & Tugasan) setelah mereka bersetuju.")}
    </span>
  );
}
