"use client";

/* v1.245.0 - THE QUOTATION PAGE (the owner's reference picture 1, decision
   P-4 "Full tabbed page"). Opened from a quotation row in Sales > Documents.
   Six tabs (v1.246.0, picture 01) - Overview, Client Details, Items &
   Package, Financial, Project & Tasks (its files inside), Activity Log - over the records that already exist: the
   quotation (sales_documents), the customer file, the package version it was
   made from, and the project brief (projects, 0159). Nothing here edits a
   price, the closer, a payment or a commission: Edit and Convert are the
   Sales list's own presses (openInForm, convertQt), passed in. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { docSubtotal, lineAmount } from "@/lib/doc-totals";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { LineTabs } from "@/components/ui/line-tabs";
import { SkelRows } from "@/components/ui/skeleton";
import { CustomerFile } from "@/components/portal/customer-file";
import { CreateBrief, ProjectActivity, ProjectStatusChip, ProjectWorkspace, QuotationStateChip, fmtDay, type TItem } from "@/components/portal/project-workspace";
import { btnClass, btnSm, btnSmPrimary } from "@/lib/ui-styles";
import pw from "./project-workspace.module.css";
import { DocSigningCard } from "@/components/portal/signing-panel";

type Tab = "overview" | "client" | "items" | "financial" | "project" | "activity";
type Line = { name: string; qty: number; uom?: string | null; unit_price_cents: number; disc_cents?: number; description?: string | null };
type Full = {
  id: number; doc_number: string; doc_type: string; company: string; contact_person: string | null; customer_id: number;
  items: string; discount_cents: number | null; tax_percent: number | null; delivery_cents: number | null; total_cents: number;
  created_at: string; valid_until: string | null; revision: number | null; revised_at: string | null; reference: string | null;
  salesperson_name: string | null; package_id: number | null; package_version: number | null; package_customized: number | null;
};
type ByQt = {
  project: { id: number; status: string; title: string; owner_id: number | null } | null;
  quotation_state: { label: string; accepted_at: string | null; accepted_name: string | null; invoice: string | null; expired: boolean };
  events: { at: string; kind: string; text: string; by: string | null }[];
  can_create: boolean;
};

export function QuotationPage({ docId, canInvoice, invoicing, onBack, onEdit, onRevise, onConvert, onPdf, billing = null, onConvertPart }: {
  docId: number; canInvoice: boolean; invoicing: boolean;
  onBack: () => void; onEdit: () => void; onRevise: () => void; onConvert: () => Promise<void> | void; onPdf: () => void;
  /** v1.273.0 - a SERVICE quotation billed in parts: its total and what its live invoices add up to */
  billing?: { total_cents: number; invoiced_cents: number } | null;
  onConvertPart?: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<Tab>("project");
  const [d, setD] = useState<Full | null>(null);
  const [failed, setFailed] = useState("");
  const [qs, setQs] = useState<ByQt | null>(null);
  const [pkg, setPkg] = useState<{ name: string; version: number } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void api<{ doc?: Full; error?: { message?: string } }>(`/staff/docs/${docId}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data?.doc) { setD(r.data.doc); setFailed(""); } else setFailed(r.data?.error?.message ?? L("This quotation could not be opened.", "Sebut harga ini tidak dapat dibuka."));
    });
    void api<ByQt>(`/staff/projects/by-quotation/${docId}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setQs(r.ok && r.data ? r.data : null); });
    return () => c.abort();
  }, [docId, tick]);
  useEffect(() => {
    if (!d?.package_id) return;
    let alive = true;
    const v = Number(d.package_version ?? 1);
    void api<{ package?: { name: string } }>(`/staff/packages/${d.package_id}?version=${v}`).then((r) => { if (alive) setPkg({ name: r.data?.package?.name ?? L(`Package #${d.package_id}`, `Pakej #${d.package_id}`), version: v }); });
    return () => { alive = false; };
  }, [d?.package_id, d?.package_version]);

  if (failed) return <div className={pw.wrap}><button type="button" className={pw.back} onClick={onBack}>← {L("Back to documents", "Kembali ke dokumen")}</button><p className={pw.warn} role="alert">{failed}</p></div>;
  if (!d) return <SkelRows rows={6} />;

  let lines: Line[] = [];
  try { lines = JSON.parse(d.items) as Line[]; } catch { lines = []; }
  const subtotal = docSubtotal(lines); // the one line arithmetic (lib/doc-totals.ts)
  const st = qs?.quotation_state;
  const invoiced = !!st?.invoice;
  const project = qs?.project ?? null;
  const reload = () => setTick((n) => n + 1);
  const extra: TItem[] = (qs?.events ?? []).map((e, i) => ({ key: `qt-${i}-${e.at}`, at: e.at, by: e.by, text: e.text }));

  const tabs = [
    ["overview", L("Overview", "Gambaran")], ["client", L("Client Details", "Butiran Pelanggan")], ["items", L("Items & Package", "Item & Pakej")],
    ["financial", L("Financial", "Kewangan")], ["project", L("Project & Tasks", "Projek & Tugasan")], ["activity", L("Activity Log", "Log Aktiviti")],
  ] as const;

  return (
    <div className={pw.wrap} data-testid="quotation-page">
      <nav className={pw.crumbs} aria-label={L("Breadcrumb", "Serbuk roti")}>
        <button type="button" className={pw.linkBtn} onClick={onBack}>{L("Sales", "Jualan")}</button>
        <span aria-hidden="true">›</span>
        <button type="button" className={pw.linkBtn} onClick={onBack}>{L("Quotations & Invoices", "Sebut Harga & Invois")}</button>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{d.doc_number}</span>
      </nav>
      <header className={pw.head}>
        <div className={pw.lead}>
          <div>
            <h2 className={pw.title}>{d.doc_number} {st && <QuotationStateChip label={st.label} />}</h2>
            <p className={pw.sub}>{L(`Created on ${fmtDay(d.created_at)}`, `Dicipta pada ${fmtDay(d.created_at)}`)}{d.salesperson_name ? ` · ${L("By", "Oleh")} ${d.salesperson_name}` : ""}{Number(d.revision ?? 0) > 0 ? ` · REV ${d.revision}` : ""}</p>
          </div>
        </div>
        <div className={pw.cmds}>
          {!invoiced && <button type="button" className={btnSm} onClick={onEdit}><AppIcon name="edit" className="erp-icon" />{L("Edit Quotation", "Sunting Sebut Harga")}</button>}
          {!invoiced && <button type="button" className={btnSm} onClick={onRevise}>{L("Revise", "Semak semula")}</button>}
          {!invoiced && canInvoice && (
            <button type="button" className={btnSm} disabled={invoicing} aria-busy={invoicing || undefined}
              onClick={() => { void Promise.resolve(onConvert()).then(reload); }}>
              → {invoicing ? L("Invoicing…", "Menginvois…") : L("Convert to Invoice", "Tukar ke Invois")}
            </button>
          )}
          {/* v1.273.0 - deposit billing: a part now, the balance later (service quotations) */}
          {billing && canInvoice && onConvertPart && billing.invoiced_cents < billing.total_cents && (
            <button type="button" className={btnSm} disabled={invoicing} onClick={() => { void Promise.resolve(onConvertPart()).then(reload); }}>
              {L("Invoice part", "Invois sebahagian")}
            </button>
          )}
          {billing && canInvoice && invoiced && billing.invoiced_cents < billing.total_cents && (
            <button type="button" className={btnSmPrimary} disabled={invoicing} onClick={() => { void Promise.resolve(onConvert()).then(reload); }}>
              → {L("Invoice balance", "Invois baki")} {fmtRM(billing.total_cents - billing.invoiced_cents)}
            </button>
          )}
          <button type="button" className={btnSmPrimary} onClick={() => setTab("project")}><AppIcon name="assignment" className="erp-icon" />{L("Project & Tasks", "Projek & Tugasan")}</button>
          <button type="button" className={btnSm} onClick={onPdf} aria-label={L("Open the PDF", "Buka PDF")}>PDF</button>
        </div>
      </header>

      <LineTabs value={tab} onChange={setTab} tabs={tabs} label={L("Quotation sections", "Bahagian sebut harga")} />

      <div hidden={tab !== "overview"}>
        <div className={pw.strip}>
          <div className={pw.fact}><span className={pw.factLabel}>{L("Client", "Pelanggan")}</span><span className={pw.factValue}>{d.company}</span>{d.contact_person && <span className={pw.factMuted}>{d.contact_person}</span>}</div>
          <div className={pw.fact}><span className={pw.factLabel}>{L("Sales person", "Jurujual")}</span><span className={pw.factValue}>{d.salesperson_name ?? "—"}</span></div>
          <div className={pw.fact}><span className={pw.factLabel}>{L("Total", "Jumlah")}</span><span className={pw.factValue}>{fmtRM(d.total_cents)}</span></div>
          <div className={pw.fact}><span className={pw.factLabel}>{L("Valid until", "Sah hingga")}</span><span className={pw.factValue}>{fmtDay(d.valid_until)}</span></div>
          <div className={pw.fact}><span className={pw.factLabel}>{L("Package", "Pakej")}</span><span className={pw.factValue}>{pkg ? `${pkg.name} · v${pkg.version}${d.package_customized ? ` · ${L("customised", "disesuaikan")}` : ""}` : L("Custom lines", "Baris khas")}</span></div>
          <div className={pw.fact}><span className={pw.factLabel}>{L("Project", "Projek")}</span><span className={pw.factValue}>{project ? <ProjectStatusChip status={project.status} /> : L("No brief yet", "Belum ada ringkasan")}</span></div>
        </div>
        {st?.accepted_at && <p className={pw.note}>{L(`Accepted by ${st.accepted_name ?? "the client"} on ${fmtDay(st.accepted_at)}.`, `Diterima oleh ${st.accepted_name ?? "pelanggan"} pada ${fmtDay(st.accepted_at)}.`)}</p>}
        <DocSigningCard docId={docId} />{/* v1.248.0 - who signs it, and Approve and sign */}
        {st?.invoice && <p className={pw.note}>{L(`Invoiced as ${st.invoice} - this quotation is a sale now.`, `Diinvois sebagai ${st.invoice} - sebut harga ini kini jualan.`)}</p>}
        {billing && invoiced && billing.invoiced_cents < billing.total_cents && (
          <p className={pw.note} data-testid="qt-left-to-invoice">{L(`Billed in parts: ${fmtRM(billing.invoiced_cents)} of ${fmtRM(billing.total_cents)} invoiced; ${fmtRM(billing.total_cents - billing.invoiced_cents)} is still to be invoiced.`, `Dibil berperingkat: ${fmtRM(billing.invoiced_cents)} daripada ${fmtRM(billing.total_cents)} diinvois; ${fmtRM(billing.total_cents - billing.invoiced_cents)} belum diinvois.`)}</p>
        )}
      </div>

      <div hidden={tab !== "client"}>{tab === "client" && <CustomerFile customerId={d.customer_id} />}</div>

      <div hidden={tab !== "items"}>
        <section className={pw.panel} aria-label={L("Items", "Item")}>
          <h3 className={pw.panelTitle}>{pkg ? `${pkg.name} · v${pkg.version}` : L("Quotation lines", "Baris sebut harga")}</h3>
          {lines.length === 0 ? <p className={pw.empty}>{L("No lines.", "Tiada baris.")}</p> : (
            <div className={pw.finTable} role="table" aria-label={L("Quotation lines", "Baris sebut harga")}>
              <div className={`${pw.finRow} ${pw.finHead}`} role="row"><span role="columnheader">{L("Item", "Item")}</span><span role="columnheader">{L("Qty", "Kuantiti")}</span><span role="columnheader">{L("Unit (RM)", "Seunit (RM)")}</span><span role="columnheader">{L("Amount (RM)", "Amaun (RM)")}</span></div>
              {lines.map((l, i) => (
                <div key={i} className={pw.finRow} role="row">
                  <span role="cell"><span className={pw.scopeLine}>{l.name}</span>{l.description && <span className={pw.scopeSub}>{l.description}</span>}</span>
                  <span role="cell">{l.qty}{l.uom ? ` ${l.uom}` : ""}</span>
                  <span role="cell">{fmtRM(Number(l.unit_price_cents))}</span>
                  <span role="cell">{fmtRM(lineAmount(l))}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div hidden={tab !== "financial"}>
        <section className={pw.panel} aria-label={L("Financial", "Kewangan")}>
          <h3 className={pw.panelTitle}>{L("Financial summary", "Ringkasan kewangan")}</h3>
          <dl className={pw.finSum}>
            <dt>{L("Subtotal", "Subjumlah")}</dt><dd>{fmtRM(subtotal)}</dd>
            {Number(d.discount_cents) > 0 && <><dt>{L("Discount", "Diskaun")}</dt><dd>− {fmtRM(Number(d.discount_cents))}</dd></>}
            {Number(d.tax_percent) > 0 && <><dt>{L(`Tax (${d.tax_percent}%)`, `Cukai (${d.tax_percent}%)`)}</dt><dd>{fmtRM(Math.round((subtotal - Number(d.discount_cents ?? 0)) * Number(d.tax_percent) / 100))}</dd></>}
            {Number(d.delivery_cents) > 0 && <><dt>{L("Delivery", "Penghantaran")}</dt><dd>{fmtRM(Number(d.delivery_cents))}</dd></>}
            <dt className={pw.finTotal}>{L("Total", "Jumlah")}</dt><dd className={pw.finTotal}>{fmtRM(d.total_cents)}</dd>
          </dl>
          <p className={pw.note}>{invoiced ? L(`Payments are recorded on the invoice${st?.invoice?.includes(" + ") ? "s" : ""} ${st?.invoice ?? ""} in Sales.`, `Bayaran direkodkan pada invois ${st?.invoice ?? ""} dalam Jualan.`) : L("Not invoiced yet. Payments are recorded on the invoice once this quotation is converted.", "Belum diinvois. Bayaran direkodkan pada invois selepas sebut harga ini ditukar.")}</p>
        </section>
      </div>

      <div hidden={tab !== "project"}>
        {tab === "project" && (project
          ? <ProjectWorkspace projectId={project.id} onChanged={reload} />
          : qs ? <CreateBrief quotationId={d.id} docNumber={d.doc_number} company={d.company} contact={d.contact_person} onCreated={reload} /> : <SkelRows rows={3} />)}
      </div>

      <div hidden={tab !== "activity"}>
        {tab === "activity" && <ProjectActivity projectId={project?.id ?? null} extra={extra} />}
      </div>
      {!project && tab === "project" && qs && !qs.can_create && <p className={pw.factMuted}><button type="button" className={btnClass} onClick={onBack}>{L("Back to documents", "Kembali ke dokumen")}</button></p>}
    </div>
  );
}
