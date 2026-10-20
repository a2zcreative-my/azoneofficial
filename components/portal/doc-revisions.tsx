"use client";

/**
 * v1.181.11 - A REVISED QUOTATION'S HISTORY.
 *
 * The CEO, 20-10-2026: *"I want to add on the Quotation if there is anything
 * that I want to add based on customer request without require to create a
 * new one Quotation"*. Revise keeps the quotation's number and prints it as
 * REV 1, REV 2 ... - and every version it replaced is kept whole on the
 * server (sales_document_revisions). This is where those versions are seen:
 * which revision the customer was sent when, for how much, who replaced it,
 * and the PDF of it exactly as it went out. A customer who says "but your
 * first quote said RM 3,000" is answered by opening it.
 */

import { useEffect, useState } from "react";

import { openDocumentPreview } from "@/components/ui/document-preview";
import { rowBtn } from "@/components/ui/row-button";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { buildDocPdf } from "@/lib/doc-pdf";
import { buildDocHtml, docDateOf, docFileName, docRevisionLabel, type DocFull } from "@/lib/doc-template";
import { dmy, dmyMYT, fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";

import css from "./doc-revisions.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Rev {
  revision: number;
  total_cents: number;
  replaced_at: string;
  replaced_by_name: string | null;
  doc: Partial<DocFull>;
}

/** The chip beside a revised quotation's number in the list. */
export function RevisionChip({ revision }: { revision?: number | null }) {
  const n = Number(revision ?? 0);
  if (n <= 0) return null;
  return (
    <span
      className={`erp-chip erp-chip-sm erp-chip-neutral ${css.revChip}`}
      title={L(`Revised ${n} time${n === 1 ? "" : "s"} at the customer's request — open the number for History`,
        `Disemak ${n} kali atas permintaan pelanggan — buka nombor untuk Sejarah`)}
    >
      REV {n}
    </span>
  );
}

/** Print one earlier version: today's customer and signer, that version's
    lines, totals, dates and revision number. */
function printVersion(docId: number, v: Rev) {
  openDocumentPreview(L("Document", "Dokumen"), async (signal) => {
    const res = await fetch(`/api/v1/staff/docs/${docId}`, { credentials: "include", signal });
    if (!res.ok) throw new Error(L("The document could not be loaded. Try again.", "Dokumen tidak dapat dimuatkan. Cuba lagi."));
    const { doc } = ((await res.json().catch(() => ({}))) ?? {}) as { doc?: DocFull };
    if (!doc) throw new Error(L("The document response was incomplete. Try again.", "Maklum balas dokumen tidak lengkap. Cuba lagi."));
    const then: DocFull = { ...doc, ...v.doc, revision: v.doc.revision ?? 0, revised_at: v.doc.revised_at ?? null } as DocFull;
    const blob = await buildDocPdf(then);
    return { html: buildDocHtml(then, false), blob, filename: docFileName(then) };
  });
}

export function DocRevisions({ docId, docNumber, revision, revisedAt, totalCents }: {
  docId: number;
  docNumber: string;
  revision: number;
  revisedAt?: string | null;
  totalCents: number;
}) {
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ revisions?: Rev[] }>(`/staff/docs/${docId}/revisions`).then((r) => {
      if (!live) return;
      if (r.ok) setRevs(r.data?.revisions ?? []);
      else setFailed(true);
    });
    return () => { live = false; };
  }, [docId, revision]);

  if (failed) return <span>{L("History could not be loaded.", "Sejarah tidak dapat dimuatkan.")}</span>;
  if (revs === null) return <SkelRows rows={2} />;
  const nameOf = (n: number) => (n > 0 ? `REV ${n}` : L("Original", "Asal"));
  return (
    <ul className={css.list} aria-label={L(`Revisions of ${docNumber}`, `Semakan ${docNumber}`)}>
      <li className={css.item}>
        <span className={css.label}>{nameOf(revision)}</span>
        <span className={css.meta}>{revisedAt ? dmy(revisedAt) : ""}</span>
        <span className={css.amount}>{fmtRM(totalCents)}</span>
        <span className={css.current}>{L("current", "semasa")}</span>
      </li>
      {revs.map((v) => (
        <li key={v.revision} className={css.item}>
          <span className={css.label}>{nameOf(v.revision)}</span>
          <span className={css.meta}>
            {v.doc.created_at ? dmy(docDateOf(v.doc as DocFull)) : ""}
            {" · "}
            {L("replaced", "diganti")} {dmyMYT(v.replaced_at)}
            {v.replaced_by_name ? ` ${L("by", "oleh")} ${v.replaced_by_name}` : ""}
          </span>
          <span className={css.amount}>{fmtRM(v.total_cents)}</span>
          <button
            type="button"
            className={rowBtn}
            title={L(`${docRevisionLabel({ doc_number: docNumber, revision: v.revision })} exactly as the customer received it`,
              `${docRevisionLabel({ doc_number: docNumber, revision: v.revision })} tepat seperti yang diterima pelanggan`)}
            onClick={() => printVersion(docId, v)}
          >
            PDF
          </button>
        </li>
      ))}
    </ul>
  );
}
