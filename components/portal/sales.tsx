"use client";
import { openDocumentPreview, openPrintPreview } from "@/components/ui/document-preview";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { RevenueData } from "@/components/portal/dashboard";
import { Sub } from "@/components/portal/leave";
import { L, MANAGE_ROLES, SectionTabs, User, ZoneLabel, payStatusL } from "@/components/portal/page-shared";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs, TabAction, TabAside, TabPeriod } from "@/components/ui/line-tabs";
import { ClosedSales, FollowUps, SalesOverviewCards, ScopeSwitch, closerLocked, type SalesSummary, type WsFollowUp, type WsScope } from "@/components/portal/sales-workspace"; // v1.214.0
import { SalesEnquiries, type Enquiry } from "@/components/portal/sales-enquiries"; // v1.216.0
import { useConfirm } from "@/components/ui/confirm-dialog";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { DetailGrid, RecordToggle } from "@/components/ui/record-row";
import { rowBtn, rowBtnDanger, rowBtnGood, rowBtnPrimary, rowBtnWarning } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows, SkelTable, SkelText } from "@/components/ui/skeleton";
import { MiniBar } from "@/components/ui/stat-card";
import { RowCell } from "@/components/ui/sub-label";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { buildDocPdf } from "@/lib/doc-pdf";
import { docSubtotal } from "@/lib/doc-totals"; // v1.231.0
import { PackagePicker, PackagesPanel } from "@/components/portal/packages-panel"; // v1.231.0 - sales packages
import type { PackageRef, PackageRow } from "@/lib/packages";
import { DocFull, DocItem, buildDocHtml, docFileName, docPageFit, docRevisionLabel } from "@/lib/doc-template";
import { esc } from "@/lib/escape-html";
import { dmy, fmtRM, mytDateOf, mytToday, ym } from "@/lib/format";
import { DOCUMENT_ISSUER, Issuer, resolveIssuer } from "@/lib/issuers";
import { firstName, properName } from "@/lib/names";
import { btnClass, btnSm, card, fieldRow, inputClass, inputClassSm, td, tdR2, th, thR2, selectClassSm, chipSmNeutral, tabPill, tabPillOn } from "@/lib/ui-styles";
import { ReactNode, cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useRecordFocus, useScrollToRecord, type RecordFocus } from "@/lib/record-focus";
/* v1.124.0 — the paper palette has one owner (lib/doc-theme.ts). This
   document is written into a separate window/iframe that cannot see the
   app stylesheet, so it needs literal hex, not var(--doc-*). */
import { DOC } from "@/lib/doc-theme";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { DocRevisions, RevisionChip } from "@/components/portal/doc-revisions";
import { InvoicePayments, PartPaidChip } from "@/components/portal/invoice-payments";
import { openCustomerTimeline } from "@/components/portal/customer-timeline";
import { openCustomerFile } from "@/components/portal/customer-file"; // v1.181.16
import { QuotationAcceptance } from "@/components/portal/quotation-acceptance"; // v1.181.16
import { RecurringDue, type RecurringRow } from "@/components/portal/recurring-due"; // v1.181.16
import bizCss from "@/components/portal/business.module.css"; // v1.181.16
import sc from "@/components/portal/sales-docs.module.css"; // v1.186.0 - the documents table
import { QuoteApprovalLimit, type QuoteApproval } from "@/components/portal/quote-approval"; // v1.181.17

/* ================= Sales (CRM + documents) ================= */

export interface Customer {
  id: number;
  company: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address?: string | null;
  website?: string | null;
  logo_key?: string | null;
}
export interface SalesDoc {
  id: number;
  doc_type: string;
  doc_number: string;
  company: string;
  total_cents: number;
  payment_status: string | null;
  delivery_status: string | null;
  created_at: string;
  converted_from?: number | null; // v1.4.233 — set when this INV came from a QT
  invoiced_as?: string | null; // v1.154.0 — on a QT: the INV it already became
  invoiced_as_id?: number | null;
  /* v1.181.11 - a revised quotation (0139); 0 = the original */
  revision?: number | null;
  revised_at?: string | null;
  payment_ref?: string | null;
  paid_at?: string | null;
  salesperson_name?: string | null;
  salesperson_id?: number | null; // v1.214.0 - the closer (GET /docs sends d.*)
  /* v1.215.0 - the CEO/COO confirmation that the money arrived in full (0145) */
  paid_confirmed_at?: string | null;
  paid_confirmed_by?: string | null;
  paid_confirmed_self?: boolean; // v1.216.2
  valid_until?: string | null;
  customer_id?: number;
  customer_phone?: string | null;
  kind?: string | null; // v1.4.234
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. */
  issuer_code?: string | null;
  /* v1.231.0 - the package and version a quotation was made from (0153) */
  package_id?: number | null;
  package_version?: number | null;
  package_customized?: number | null;
}

/* v1.28.0 — "MAYBANK · <HOLDER> · A/C <number>": the bank-transfer instruction
   the SOA and the WhatsApp invoice chase print, composed from the issuer so
   the payee named is always the entity whose account it is. Issuer.bank is
   "<BANK> <account number>" (lib/issuers.ts). */
export function bankTransferLine(iss: Issuer): string {
  const [bankName, ...account] = iss.bank.split(" ");
  return `${bankName} · ${iss.bankHolder} · A/C ${account.join(" ")}`;
}

/** v1.4.101: printable Statement of Account per customer — same branded
    template family as the QT/DO/INV. Invoices only (paid + outstanding). */
/* v1.28.0: the SOA is not a re-print of a stored document — it is a fresh
   chase statement issued TODAY, so its letterhead, bank instruction and
   footer carry DOCUMENT_ISSUER (the current operator), even when the
   invoices it lists were issued by the earlier entity. */
export function printSOA(company: string, docs: SalesDoc[]) {
  const invs = docs
    .filter((d) => d.doc_type === "INV" && d.company === company)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (invs.length === 0) return;
  const rm = fmtRM; // v1.4.272 global
  const total = invs.reduce((a, d) => a + d.total_cents, 0);
  const paid = invs
    .filter((d) => d.payment_status === "paid")
    .reduce((a, d) => a + d.total_cents, 0);
  const outstanding = total - paid;
  const today = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const rows = invs
    .map(
      (d, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(d.doc_number)}</td><td class="c">${esc(dmy(d.created_at.slice(0, 10)))}</td>
    <td class="c">${d.payment_status === "paid" ? `<span style="color:#15803d;font-weight:700">PAID${d.paid_at ? " " + dmy(d.paid_at.slice(0, 10)) : ""}</span>` : '<span style="color:#b45309;font-weight:700">OUTSTANDING</span>'}</td>
    <td class="r">${rm(d.total_cents)}</td>
    <td class="r">${d.payment_status === "paid" ? "—" : rm(d.total_cents)}</td>
  </tr>`
    )
    .join("");
  openPrintPreview(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=794">
  <title>SOA — ${esc(company)}</title>
  <style>
    /* v1.158.1 - the viewport is the paper (794px), so a phone prints the same one page as a desk; see lib/doc-template.ts */
    html { min-width: 210mm; }
    @page { size: A4; margin: 0; } * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; } /* v1.4.239 */
    body { font-family: Arial, Helvetica, sans-serif; color: ${DOC.navy}; font-size: 12px; margin: 0; padding: 12px; width: 210mm; max-width: 210mm; margin-inline: auto; display: flex; flex-direction: column; min-height: 268mm; }
    .goldbar { height: 5px; background: linear-gradient(90deg, ${DOC.gold}, ${DOC.goldLight}, ${DOC.gold}); border-radius: 3px; }
    .hd { display: flex; justify-content: space-between; gap: 12px; padding: 14px 0 10px; border-bottom: 2.5px solid ${DOC.navy}; flex-wrap: wrap; }
    .brand { font-size: 19px; font-weight: 800; }
    .brand small { display: block; font-size: 8px; letter-spacing: .32em; color: ${DOC.gold}; font-weight: 700; margin-top: 2px; }
    .brand .addr { font-size: 9.5px; color: ${DOC.inkSoft}; font-weight: 400; margin-top: 6px; line-height: 1.5; }
    .docbox { text-align: right; } .docbox h2 { margin: 0 0 4px; font-size: 19px; letter-spacing: .1em; }
    .party { margin-top: 12px; background: ${DOC.tint}; border-left: 3px solid ${DOC.gold}; border-radius: 6px; padding: 10px 12px; max-width: 340px; }
    .party .bt { margin: 0 0 4px; font-size: 9px; letter-spacing: .18em; color: ${DOC.muted}; font-weight: 700; }
    .party .co { font-weight: 800; font-size: 13px; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
    .items th { background: ${DOC.navy}; color: #fff; padding: 7px 9px; text-align: left; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; }
    .items th.c, .items td.c { text-align: center; } .items th.r, .items td.r { text-align: right; }
    .items td { padding: 7px 9px; border-bottom: 1px solid ${DOC.line}; }
    .items tr:nth-child(even) td { background: #fafbfd; }
    .totwrap { display: flex; justify-content: flex-end; margin-top: 10px; }
    .tot { width: 300px; border-collapse: collapse; } .tot td { padding: 4px 10px; } .tot td:last-child { text-align: right; }
    .tot tr.grand td { background: ${DOC.navy}; color: #fff; font-weight: 800; padding: 8px 10px; }
    .pay { margin-top: auto; padding-top: 20px; font-size: 11px; }
    .foot { margin-top: 14px; font-size: 8.5px; color: ${DOC.muted}; border-top: 1px solid ${DOC.line}; padding-top: 8px; text-align: center; }
    @media print { html, body { width: 210mm; } body { padding: 14mm; min-height: calc(100vh - 2mm); } } /* v1.4.239; v1.158.1 min-height follows the printable page, not a fixed 296mm */
  </style></head><body onload="window.print()">
  <div class="goldbar"></div>
  <div class="hd">
    <div class="brand">${DOCUMENT_ISSUER.name}<small>LIVE &nbsp;·&nbsp; CONNECT &nbsp;·&nbsp; GROW</small>
      <div class="addr">${DOCUMENT_ISSUER.descriptor} · ${DOCUMENT_ISSUER.registration}<br/>
      ${DOCUMENT_ISSUER.addressLines.join("<br/>")}<br/>
      ${DOCUMENT_ISSUER.email} · WhatsApp ${DOCUMENT_ISSUER.whatsapp}</div>
    </div>
    <div class="docbox"><h2>STATEMENT OF ACCOUNT</h2><div>As at ${dmy(today)}</div></div>
  </div>
  <div class="party"><p class="bt">ACCOUNT OF</p><p class="co">${esc(company)}</p></div>
  <table class="items">
    <thead><tr><th class="c" style="width:6%">#</th><th>Invoice No.</th><th class="c">Date</th><th class="c">Status</th><th class="r">Amount</th><th class="r">Balance</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totwrap"><table class="tot">
    <tr><td>Total invoiced</td><td>${rm(total)}</td></tr>
    <tr><td>Total paid</td><td>${rm(paid)}</td></tr>
    <tr class="grand"><td>BALANCE OUTSTANDING</td><td>${rm(outstanding)}</td></tr>
  </table></div>
  <div class="pay">Kindly settle the outstanding balance by bank transfer — ${bankTransferLine(DOCUMENT_ISSUER)}, quoting the invoice number. Please send the transfer receipt via WhatsApp ${DOCUMENT_ISSUER.whatsapp}.</div>
  <div class="foot">${DOCUMENT_ISSUER.name} · ${DOCUMENT_ISSUER.slogan} · ${DOCUMENT_ISSUER.website}<br/>This is a computer-generated statement; no signature is required.</div>
  </body></html>`);
}

/** Fetch a full document and open a branded, print-ready PDF window. */
/* v1.4.244: printDoc now only fetches and opens the window — the document
   itself is built by lib/doc-template so the customer's shared link renders
   the identical thing. */
export async function printDoc(id: number) {
  openDocumentPreview(L("Document", "Dokumen"), async (signal) => {
  const res = await fetch(`/api/v1/staff/docs/${id}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(L("The document could not be loaded. Try again.", "Dokumen tidak dapat dimuatkan. Cuba lagi."));
  /* v1.33.3 — a 200 carrying no `doc` used to throw inside buildDocHtml, and
     this runs straight after a SUCCESSFUL save. The document exists; the
     person just sees the screen fall over instead of their PDF, assumes the
     save failed, and creates the invoice a second time. A duplicate invoice
     is a far worse outcome than a missing preview, so return quietly. */
  const { doc } = ((await res.json().catch(() => ({}))) ?? {}) as {
    doc?: DocFull;
  };
  if (!doc) throw new Error(L("The document response was incomplete. Try again.", "Maklum balas dokumen tidak lengkap. Cuba lagi."));
  const blob = await buildDocPdf(doc);
  return { html: buildDocHtml(doc, false), blob, filename: docFileName(doc) };
  });
}

/* v1.4.191 CLIENT LAYER (CEO gap list): per-client agency view — invoiced /
   paid / quotations / live sessions per client, from the customers registry. */

/* v1.4.273 idea 6 — RM per live hour, per client and per host, this month.
   The one number a live agency should run on: which clients to upsell,
   which hosts are earning. Renders null until the worker route exists. */
export function LiveEconomicsCard() {
  interface Econ {
    month: string;
    clients: {
      id: number;
      company: string;
      minutes: number;
      paid_cents: number;
    }[];
    hosts: { id: number; name: string; minutes: number; gmv_cents: number }[];
  }
  const [econ, setEcon] = useState<Econ | null>(null);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<Econ>(`/staff/clients/live-economics`).then((r) => {
      if (r.ok && r.data) setEcon(r.data);
      setLoaded(true);
    });
  }, []);
  if (!loaded)
    return (
      <div className={card} aria-hidden>
        <Skel className="h-4 w-56 max-w-full" />
        <SkelText lines={2} className="mt-2" />
        <SkelTable rows={3} cols={4} className="mt-3" />
      </div>
    );
  /* Nothing to show (no route yet, or no live economics this month) — the
     card stays hidden, as before. */
  if (!econ || (econ.clients.length === 0 && econ.hosts.length === 0))
    return null;
  const hm = (mins: number) =>
    `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  const perHour = (cents: number, mins: number) =>
    mins > 0 ? fmtRM(Math.round((cents * 60) / mins)) : "—";
  return (
    <div className={card}>
      <PanelTitle icon="time">
        {L("Live-hour economics", "Ekonomi jam LIVE")} — {ym(econ.month)}
      </PanelTitle>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "RM per hour of live this month. Clients: paid invoices ÷ completed session hours. Hosts: TikTok GMV landing during their sessions (motivation, not payroll).",
          "RM sejam LIVE bulan ini. Pelanggan: invois dibayar ÷ jam sesi selesai. Hos: GMV TikTok yang masuk semasa sesi mereka (motivasi, bukan gaji)."
        )}
      </p>
      {econ.clients.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>{L("CLIENT", "PELANGGAN")}</th>
                <th className={thR2}>{L("HOURS", "JAM")}</th>
                <th className={thR2}>{L("PAID", "DIBAYAR")}</th>
                <th className={thR2}>{L("RM / HOUR", "RM / JAM")}</th>
              </tr>
            </thead>
            <tbody>
              {econ.clients.map((c) => (
                <tr key={c.id} className="border-border border-b last:border-0">
                  <td className={td}>{c.company}</td>
                  <td className={tdR2}>{hm(c.minutes)}</td>
                  <td className={tdR2}>{fmtRM(c.paid_cents)}</td>
                  <td className={`${tdR2} font-semibold`}>
                    {perHour(c.paid_cents, c.minutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {econ.hosts.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <p className="text-muted-foreground text-xs font-semibold">
            {L("Hosts", "Hos")}
          </p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className={th}>{L("HOST", "HOS")}</th>
                <th className={thR2}>{L("HOURS", "JAM")}</th>
                <th className={thR2}>{L("GMV IN-LIVE", "GMV SEMASA LIVE")}</th>
                <th className={thR2}>{L("RM / HOUR", "RM / JAM")}</th>
              </tr>
            </thead>
            <tbody>
              {econ.hosts.map((h) => (
                <tr key={h.id} className="border-border border-b last:border-0">
                  <td className={td}>{properName(h.name)}</td>
                  <td className={tdR2}>{hm(h.minutes)}</td>
                  <td className={tdR2}>{fmtRM(h.gmv_cents)}</td>
                  <td className={`${tdR2} font-semibold`}>
                    {perHour(h.gmv_cents, h.minutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* v1.4.273 idea 3 — the public package rate card, edited here, served on
   the public site at /packages. Prospects who see prices pre-qualify
   themselves. The public page stays a contact-us page until tiers exist
   (house rule: never display placeholder/zero content). CEO-only. */
export function PackagesEditorCard({ role }: { role: string }) {
  interface Tier {
    name: string;
    price_label: string;
    points: string[];
  }
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { show: showToast, node: toastNode } = useSaveToast();
  useEffect(() => {
    void api<{ packages: Tier[] | null }>(`/staff/sales/packages`).then((r) => {
      if (r.ok) setTiers(r.data?.packages ?? []);
      setLoaded(true);
    });
  }, []);
  // Authorisation, not loading: only these two roles ever see the editor.
  if (!["ceo", "super_admin"].includes(role)) return null;
  /* v1.77.0 — skeleton until the first fetch lands: heading, description,
     one tier box (two fields + a text area) and the button row. */
  if (!loaded)
    return (
      <div className={card} aria-hidden>
        <Skel className="h-4 w-56 max-w-full" />
        <SkelText lines={2} className="mt-2" />
        <div className="mt-2 space-y-3">
          <div className="border-border rounded-lg border p-3">
            <div className={fieldRow}>
              <Skel className="h-9 w-full" />
              <Skel className="h-9 w-full" />
            </div>
            <Skel className="mt-2 h-20 w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skel className="h-9 w-28" />
            <Skel className="h-9 w-36" />
          </div>
        </div>
      </div>
    );
  const upd = (i: number, patch: Partial<Tier>) =>
    setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className={card}>
      <PanelTitle icon="package">
        {L("Packages — public rate card", "Pakej — kadar harga awam")}
      </PanelTitle>
      {toastNode}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Shown on a2zcreative.my/packages with a WhatsApp button. The page stays a contact-us page until you save at least one tier here.",
          "Dipaparkan di a2zcreative.my/packages dengan butang WhatsApp. Halaman itu kekal sebagai halaman hubungi-kami sehingga anda menyimpan sekurang-kurangnya satu pakej di sini."
        )}
      </p>
      <div className="mt-2 space-y-3">
        {tiers.map((t, i) => (
          <div key={i} className="border-border rounded-lg border p-3">
            <div className={fieldRow}>
              <label className="text-sm">
                <span className="text-muted-foreground text-xs">
                  {L("Tier name", "Nama pakej")}
                </span>
                <input
                  className={inputClass}
                  placeholder={L("e.g. Starter", "cth. Starter")}
                  value={t.name}
                  onChange={(e) => upd(i, { name: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground text-xs">
                  {L("Price label", "Label harga")}
                </span>
                <input
                  className={inputClass}
                  placeholder={L(
                    "e.g. from RM 1,500/month",
                    "cth. dari RM 1,500/bulan"
                  )}
                  value={t.price_label}
                  onChange={(e) => upd(i, { price_label: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}
              >
                {L("Remove tier", "Buang pakej")}
              </button>
            </div>
            <label className="mt-2 block text-sm">
              <span className="text-muted-foreground text-xs">
                {L(
                  "What's included — one point per line",
                  "Apa yang termasuk — satu poin setiap baris"
                )}
              </span>
              <textarea
                className={`${inputClass} min-h-20`}
                value={t.points.join("\n")}
                onChange={(e) => upd(i, { points: e.target.value.split("\n") })}
              />
            </label>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {tiers.length < 6 && (
            <button
              type="button"
              className={btnClass}
              onClick={() =>
                setTiers((ts) => [
                  ...ts,
                  { name: "", price_label: "", points: [] },
                ])
              }
            >
              {L("+ Add tier", "+ Tambah pakej")}
            </button>
          )}
          <button
            type="button"
            className={btnClass}
            onClick={async () => {
              const clean = tiers
                .map((t) => ({
                  ...t,
                  points: t.points.map((p) => p.trim()).filter(Boolean),
                }))
                .filter((t) => t.name.trim());
              const r = await api(`/staff/sales/packages`, {
                method: "POST",
                body: JSON.stringify({ packages: clean }),
              });
              if (r.ok) {
                setTiers(clean);
                showToast(
                  L("Saved", "Disimpan"),
                  clean.length
                    ? L(
                        `${clean.length} tier${clean.length === 1 ? "" : "s"} live on /packages`,
                        `${clean.length} pakej disiarkan di /packages`
                      )
                    : L(
                        "Rate card cleared — the public page is back to contact-us",
                        "Kadar harga dikosongkan — halaman awam kembali kepada hubungi-kami"
                      )
                );
              } else
                showToast(
                  L("Not saved", "Tidak disimpan"),
                  (r.data as { error?: { message?: string } })?.error
                    ?.message ?? "Deploy the latest server first",
                  "notice"
                );
            }}
          >
            {L("Save rate card", "Simpan kadar harga")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* v1.4.281 — 🧩 Business lines ("my company do 2 business which is one for
   product sales and the other one is for service sales"): the two
   businesses reported separately — all-time share, then month by month.
   EXPANDABLE BY DESIGN: renders whatever lines the server sends; a third
   business line some day = zero changes here. Null until the worker has
   the route. */
export function BusinessLinesCard({ bare }: { bare?: boolean } = {}) {
  interface RevLine {
    key: string;
    label: string;
    total_cents: number;
    months: { month: string; cents: number }[];
  }
  const [lines, setLines] = useState<RevLine[] | null>(null);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{ lines: RevLine[] }>(`/staff/revenue/lines`).then((r) => {
      if (r.ok && r.data) setLines(r.data.lines);
      setLoaded(true);
    });
  }, []);
  if (!loaded)
    return (
      <div className={bare ? "" : card} aria-hidden>
        {!bare && <Skel className="h-4 w-64 max-w-full" />}
        <SkelText lines={2} className="mt-2" />
        <div className="mt-2 space-y-1.5">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-2">
              <Skel className="h-3.5 w-32 shrink-0" />
              <Skel className="h-2 flex-1 rounded-full" />
              <Skel className="h-3.5 w-20 shrink-0" />
              <Skel className="h-3 w-10 shrink-0" />
            </div>
          ))}
        </div>
        <SkelTable rows={4} cols={4} className="mt-3" />
      </div>
    );
  /* v1.64.3: inside the combined card an empty section must SAY it is empty
     — a tab that opens onto nothing reads as a bug. Standalone it still
     disappears, which is what a card with no data should do. */
  const nothing = bare ? (
    <p className="text-muted-foreground text-sm">
      {L("No revenue recorded yet.", "Belum ada hasil direkodkan.")}
    </p>
  ) : null;
  if (!lines || lines.length === 0) return nothing;
  const grand = lines.reduce((a, l) => a + l.total_cents, 0);
  if (grand === 0) return nothing;
  const monthSet = new Set<string>();
  for (const l of lines) for (const m of l.months) monthSet.add(m.month);
  const monthsDesc = [...monthSet].sort().reverse();
  const cellOf = (l: RevLine, m: string) =>
    l.months.find((x) => x.month === m)?.cents ?? 0;
  const TONE: Record<string, "navy" | "gold" | "muted"> = {
    product: "navy",
    service: "gold",
  };
  return (
    <div className={bare ? "" : card}>
      {!bare && (
        <PanelTitle icon="puzzle">
          {L(
            "Business lines — product vs service",
            "Bidang perniagaan — produk vs perkhidmatan"
          )}
        </PanelTitle>
      )}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Your two businesses, reported separately. Product = TikTok, Shopee, walk-in and product invoices; service = paid service invoices. Same arithmetic as every other revenue figure.",
          "Dua perniagaan anda, dilaporkan berasingan. Produk = TikTok, Shopee, walk-in dan invois produk; perkhidmatan = invois perkhidmatan dibayar. Kiraan sama seperti setiap angka hasil yang lain."
        )}
      </p>
      <div className="mt-2 space-y-1.5">
        {lines.map((l) => (
          <div key={l.key} className="flex items-center gap-2 text-sm">
            <span className="w-32 shrink-0">{l.label.split(" (")[0]}</span>
            <div className="flex-1">
              <MiniBar
                pct={(l.total_cents / grand) * 100}
                tone={TONE[l.key] ?? "muted"}
              />
            </div>
            <span className="shrink-0 text-right font-medium tabular-nums">
              {fmtRM(l.total_cents)}
            </span>
            <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
              {Math.round((l.total_cents / grand) * 100)}%
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className={th}>{L("MONTH", "BULAN")}</th>
              {lines.map((l) => (
                <th key={l.key} className={thR2}>
                  {(l.label.split(" ")[0] || "").toUpperCase()}
                </th>
              ))}
              <th className={thR2}>{L("TOTAL", "JUMLAH")}</th>
            </tr>
          </thead>
          <tbody>
            {monthsDesc.map((m) => {
              const rowTotal = lines.reduce((a, l) => a + cellOf(l, m), 0);
              return (
                <tr key={m} className="border-border border-b last:border-0">
                  <td className={td}>{ym(m)}</td>
                  {lines.map((l) => {
                    const c = cellOf(l, m);
                    return (
                      <td key={l.key} className={tdR2}>
                        {c ? fmtRM(c) : "—"}
                      </td>
                    );
                  })}
                  <td className={`${tdR2} font-medium`}>{fmtRM(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className={th}>{L("TOTAL", "JUMLAH")}</th>
              {lines.map((l) => (
                <th key={l.key} className={thR2}>
                  {fmtRM(l.total_cents)}
                </th>
              ))}
              <th className={thR2}>{fmtRM(grand)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* v1.4.278 — 📊 Sales history ("powerful system for my sales track"):
   every month of the business, all four channels (the /revenue overall
   block), with month-over-month movement and each month measured against
   the best. Frontend-only — the arithmetic already lives server-side. */
export function SalesHistoryCard({ bare }: { bare?: boolean } = {}) {
  const [rev, setRev] = useState<RevenueData | null>(null);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<RevenueData>(`/staff/revenue`).then((r) => {
      if (r.ok && r.data) setRev(r.data);
      setLoaded(true);
    });
  }, []);
  const months = rev?.overall?.months ?? [];
  if (!loaded)
    return (
      <div className={bare ? "" : card} aria-hidden>
        {!bare && <Skel className="h-4 w-64 max-w-full" />}
        <SkelText lines={1} className="mt-2" />
        <SkelTable rows={5} cols={4} className="mt-2" />
      </div>
    );
  if (months.length === 0)
    return bare ? (
      <p className="text-muted-foreground text-sm">
        {L("No months recorded yet.", "Belum ada bulan direkodkan.")}
      </p>
    ) : null;
  const best = Math.max(...months.map((m) => m.cents), 1);
  const total = months.reduce((a, m) => a + m.cents, 0);
  const rows = [...months].reverse(); // newest first
  return (
    <div className={bare ? "" : card}>
      {!bare && (
        <PanelTitle icon="chart">
          {L(
            "Sales history — month by month",
            "Sejarah jualan — bulan demi bulan"
          )}
        </PanelTitle>
      )}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "All four channels, since day one. The bar measures each month against your best.",
          "Kesemua empat saluran, sejak hari pertama. Bar mengukur setiap bulan berbanding bulan terbaik anda."
        )}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className={th}>{L("MONTH", "BULAN")}</th>
              <th className={thR2}>{L("SALES", "JUALAN")}</th>
              <th className={thR2}>{L("VS PREV", "VS SEBELUM")}</th>
              <th className={`${th} w-28`}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const prev = rows[i + 1]; // list is newest-first
              const delta =
                prev && prev.cents > 0
                  ? ((m.cents - prev.cents) / prev.cents) * 100
                  : null;
              return (
                <tr
                  key={m.month}
                  className="border-border border-b last:border-0"
                >
                  <td className={td}>
                    {ym(m.month)}
                    {m.cents >= best - 0.5 ? <AppIcon name="trophy" className="ml-1 -mt-0.5 h-3 w-3" /> : null}
                  </td>
                  <td className={tdR2}>{fmtRM(m.cents)}</td>
                  <td
                    className={`${tdR2} ${delta == null ?"text-muted-foreground" : delta >= 0 ?"text-success" :"text-danger"}`}
                  >
                    {delta == null
                      ? "—"
                      : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}%`}
                  </td>
                  <td className={td}>
                    <MiniBar
                      pct={(m.cents / best) * 100}
                      tone={m.cents >= best - 0.5 ? "green" : "gold"}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className={th}>{L("TOTAL", "JUMLAH")}</th>
              <th className={thR2}>{fmtRM(total)}</th>
              <th className={thR2}></th>
              <th className={th}></th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* v1.4.278 — 💹 Profit & loss by month ("…and also expenses"): revenue −
   expenses − payroll − approved claims = the number the business actually
   keeps. Renders null on a worker that predates the route. */
export function PnlCard({ inModal }: { inModal?: boolean } = {}) {
  interface PnlMonth {
    month: string;
    revenue_cents: number;
    expenses_cents: number;
    payroll_cents: number;
    claims_cents: number;
    net_cents: number;
  }
  const [months, setMonths] = useState<PnlMonth[] | null>(null);
  useEffect(() => {
    void api<{ months: PnlMonth[] }>(`/staff/finance/pnl`).then((r) => {
      /* v1.77.0 — a refused request settles to "no data" so the skeleton
         ends (a skeleton that never ends is worse than a message). */
      setMonths(r.ok && r.data ? r.data.months : []);
    });
  }, []);
  const wrapCard = (node: ReactNode) =>
    inModal ? (
      <div className="flex w-full flex-col overflow-x-auto pb-4 sm:pb-0">
        {node}
      </div>
    ) : (
      <div className={card}>
        <PanelTitle icon="up">
          {L(
            "Profit & loss — month by month",
            "Untung & rugi — bulan demi bulan"
          )}
        </PanelTitle>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Revenue (all channels) minus expenses, payroll and approved claims — what the business keeps. Payroll uses the same net figures as the M2E salary file.",
            "Hasil (semua saluran) tolak perbelanjaan, gaji dan tuntutan diluluskan — apa yang perniagaan simpan. Gaji menggunakan angka bersih yang sama seperti fail gaji M2E."
          )}
        </p>
        <div className="mt-2 overflow-x-auto">{node}</div>
      </div>
    );

  /* v1.77.0 — skeleton until the first fetch lands: six columns, like the
     real table, in place of the hand-rolled pulse. */
  if (!months) {
    return wrapCard(
      <SkelTable rows={4} cols={6} className={inModal ? "px-4 pt-3 sm:px-5" : "mt-2"} />
    );
  }
  if (months.length === 0) {
    return wrapCard(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No financial data available yet.", "Tiada data kewangan lagi.")}
      </p>
    );
  }
  const rows = [...months].reverse(); // newest first

  return wrapCard(
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-border border-b">
          <th className={th}>{L("MONTH", "BULAN")}</th>
          <th className={thR2}>{L("REVENUE", "HASIL")}</th>
          <th className={thR2}>{L("EXPENSES", "PERBELANJAAN")}</th>
          <th className={thR2}>{L("PAYROLL", "GAJI")}</th>
          <th className={thR2}>{L("CLAIMS", "TUNTUTAN")}</th>
          <th className={thR2}>{L("NET", "BERSIH")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.month} className="border-border border-b last:border-0">
            <td className={td}>{ym(m.month)}</td>
            <td className={tdR2}>{fmtRM(m.revenue_cents)}</td>
            <td className={tdR2}>
              {m.expenses_cents ? fmtRM(m.expenses_cents) : "—"}
            </td>
            <td className={tdR2}>
              {m.payroll_cents ? fmtRM(m.payroll_cents) : "—"}
            </td>
            <td className={tdR2}>
              {m.claims_cents ? fmtRM(m.claims_cents) : "—"}
            </td>
            <td
              className={`${tdR2} font-semibold ${m.net_cents >= 0 ?"text-success" :"text-danger"}`}
            >
              {fmtRM(m.net_cents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* v1.5.0: PipelineInsightsCard removed with the Social tab. */

export function ClientsCard({ inModal, bare }: { inModal?: boolean; bare?: boolean } = {}) {
  interface Cl {
    id: number;
    company: string;
    name?: string | null;
    invoices: number;
    invoiced_cents: number;
    paid_cents: number;
    quotations: number;
  }
  const [clients, setClients] = useState<Cl[]>([]);
  const [sessions, setSessions] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const { show: showRlToast, node: rlToastNode } = useSaveToast();
  useEffect(() => {
    void api<{ clients?: Cl[]; sessions?: Record<string, number> }>(
      `/staff/clients/summary`
    ).then((r) => {
      if (r.ok) {
        setClients(r.data?.clients ?? []);
        setSessions(r.data?.sessions ?? {});
      }
      setLoaded(true);
    });
  }, []);

  const wrapCard = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col pb-4 sm:pb-0">{node}</div>
    ) : bare ? (
      /* v1.123.0 - a tab body: the pill above already says "Clients". */
      <div>{node}</div>
    ) : (
      <div className={card}>
        <PanelTitle icon="clients">{L("Clients", "Pelanggan")}</PanelTitle>
        <div className="mt-3">{node}</div>
      </div>
    );

  /* v1.77.0 — skeleton until the first fetch lands: client rows, the shape
     of the list, in place of the hand-rolled pulse. */
  if (!loaded) {
    return wrapCard(
      <>
        {!inModal && <SkelText lines={2} className="mt-0.5" />}
        <SkelRows rows={4} className={inModal ? "px-4 sm:px-5" : "mt-3 max-h-80 pr-1"} />
      </>
    );
  }
  if (clients.length === 0) {
    return wrapCard(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No active clients.", "Tiada pelanggan aktif.")}
      </p>
    );
  }
  const rm2 = fmtRM; // v1.4.272 global (this one even lacked thousand separators)
  return wrapCard(
    <>
      {rlToastNode}
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Per-client view from your sales documents and the live roster — invoiced, collected, quotations in play and sessions scheduled.",
          "Paparan setiap pelanggan daripada dokumen jualan anda dan roster LIVE — diinvois, dikutip, sebut harga aktif dan sesi dijadualkan."
        )}
      </p>
      <div
        className={
          inModal ? "overflow-y-auto" : "mt-3 max-h-80 overflow-y-auto pr-1"
        }
      >
        {clients.map((c) => (
          <div
            key={c.id}
            className={`border-border flex flex-wrap items-center justify-between gap-2 border-b text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-4 py-3 transition-colors sm:px-5" : "py-2"}`}
          >
            <span className="erp-row-lead font-medium">{c.company}</span>
            <span className="text-muted-foreground erp-row-actions text-xs">
              <span
                title={L(
                  "Invoiced total (all INV)",
                  "Jumlah diinvois (semua INV)"
                )}
              >
                {rm2(c.invoiced_cents)} {L("invoiced", "diinvois")}
              </span>
              <span
                className="font-medium text-success"
                title={L(
                  "Collected (paid invoices)",
                  "Dikutip (invois dibayar)"
                )}
              >
                {rm2(c.paid_cents)} {L("paid", "dibayar")}
              </span>
              <span title={L("Quotations issued", "Sebut harga dikeluarkan")}>
                {c.quotations} QT
              </span>
              <span
                title={L(
                  "Live sessions scheduled (not cancelled)",
                  "Sesi LIVE dijadualkan (tidak dibatalkan)"
                )}
              >
                {sessions[String(c.id)] ?? 0} live
              </span>
              {/* v1.4.273 idea 1: the client report link — a public monthly
                  performance page they can forward to their boss. Retention
                  weapon + our best brochure. */}
              <button
                type="button"
                className="underline"
                title={L(
                  "Copy this client's monthly report link",
                  "Salin pautan laporan bulanan pelanggan ini"
                )}
                onClick={async () => {
                  const r = await api<{ token?: string }>(
                    `/staff/clients/${c.id}/report-link`,
                    { method: "POST" }
                  );
                  if (!r.ok || !r.data?.token) {
                    showRlToast(
                      L("Not available", "Tidak tersedia"),
                      (r.data as { error?: { message?: string } })?.error
                        ?.message ??
                        "Deploy the latest server + run migration 0067 first",
                      "notice"
                    );
                    return;
                  }
                  const url = `${location.origin}/report?t=${r.data.token}`;
                  try {
                    await navigator.clipboard.writeText(url);
                    showRlToast(
                      L("Report link copied", "Pautan laporan disalin"),
                      L(
                        `${c.company} — paste it into WhatsApp`,
                        `${c.company} — tampal ke WhatsApp`
                      )
                    );
                  } catch {
                    showRlToast(
                      L("Report link", "Pautan laporan"),
                      url,
                      "notice"
                    );
                  }
                }}
              >
                <AppIcon name="link" className="mr-1" />{L("Report link", "Pautan laporan")}
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* v1.4.263: word the inventory movement an invoice caused, for the toast.
   Silence would repeat the In+ mistake (v1.4.251) — stock moving with no
   confirmation — and a wrong-SKU line NOT deducting must be said loudest. */
export function stockToastLine(
  s:
    | {
        deducted: { sku: string; qty: number; stock: number }[];
        unmatched: string[];
        short: string[];
      }
    | null
    | undefined
): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.deducted.length)
    parts.push(
      L(
        `stock deducted: ${s.deducted.map((d) => `${d.sku} −${d.qty} (now ${d.stock})`).join(", ")}`,
        `stok ditolak: ${s.deducted.map((d) => `${d.sku} −${d.qty} (kini ${d.stock})`).join(", ")}`
      )
    );
  if (s.unmatched.length)
    parts.push(
      L(
        `⚠ NOT in inventory, not deducted: ${s.unmatched.join(", ")}`,
        `⚠ TIADA dalam inventori, tidak ditolak: ${s.unmatched.join(", ")}`
      )
    );
  if (s.short.length)
    parts.push(
      L(`⚠ short: ${s.short.join("; ")}`, `⚠ kurang: ${s.short.join("; ")}`)
    );
  return parts.length ? ` — ${parts.join(" · ")}` : "";
}

/* ======================================================================
   THE LIVE PREVIEW — v1.120.0. The REAL document, drawn by the template
   that prints (lib/doc-template.ts buildDocHtml), from the form's state as
   it is typed. It cannot drift from the paper because it IS the paper. On a
   wide screen it sits beside the form; below xl it opens from a button so a
   phone keeps its one column. Scaled to the box it is given (A4 at 96dpi is
   794px wide), so nothing scrolls sideways. Module scope (house rule #30).
   ====================================================================== */
export function DocPreview({ doc, docDate, customers, staffList, user, docNumber, revision = 0, revisedAt = null, dueDate = null }: {
  doc: { doc_type: string; customer_id: number; salesperson_id: number; kind: string; items: DocItem[]; discount_cents: number; tax_percent: number; delivery_cents: number; paid_received: boolean; reference: string; delivery_address: string; issuer: string };
  docDate: string;
  customers: Customer[];
  staffList: { id: number; name: string }[];
  user: User;
  docNumber: string | null;
  /** v1.181.11 - the revision being drawn; a new one is dated today */
  revision?: number;
  revisedAt?: string | null;
  /** v1.181.16 - the due date credit terms give a new invoice, so the
      preview prints what the invoice will */
  dueDate?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => setScale(Math.max(0.2, Math.min(1, el.clientWidth / 794)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const c = customers.find((x) => x.id === doc.customer_id);
  const salesperson = doc.salesperson_id ? (staffList.find((u) => u.id === doc.salesperson_id)?.name ?? user.name) : user.name;
  const subtotal = docSubtotal(doc.items); // v1.231.0 - one line arithmetic (lib/doc-totals.ts)
  const total = Math.max(0, Math.round((subtotal - doc.discount_cents) * (1 + doc.tax_percent / 100)))
    + (doc.doc_type === "DO" || doc.kind === "service" ? 0 : doc.delivery_cents);
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const full: DocFull = {
    doc_type: doc.doc_type,
    doc_number: docNumber ?? `${doc.doc_type}-DRAFT`,
    company: c?.company ?? (doc.customer_id === 0 ? "Walk-in Customer" : "—"),
    contact_person: c?.contact_person ?? undefined,
    address: c?.address ?? undefined,
    customer_phone: c?.phone ?? undefined,
    customer_email: c?.email ?? undefined,
    items: JSON.stringify(doc.items.map((i) => ({ ...i, sub: (i.sub ?? []).map((s) => s.trim()).filter(Boolean) }))),
    discount_cents: doc.discount_cents,
    tax_percent: doc.tax_percent,
    delivery_cents: doc.doc_type === "DO" || doc.kind === "service" ? 0 : doc.delivery_cents,
    total_cents: total,
    created_at: (docDate || today) + " 00:00:00",
    revision,
    revised_at: revision > 0 ? (revisedAt ?? `${today} 00:00:00`) : null,
    payment_status: doc.doc_type === "INV" ? (doc.paid_received ? "paid" : "unpaid") : null,
    salesperson_name: salesperson,
    created_by_role: user.role,
    kind: doc.kind,
    delivery_status: "pending",
    reference: doc.reference || null,
    delivery_address: doc.delivery_address || null,
    signer_role: user.role === "coo" ? "coo" : "ceo",
    signer_name: user.name,
    signer_position: user.role.replace(/_/g, " ").toUpperCase(),
    issuer_code: doc.issuer,
    ...(dueDate ? { due_date: dueDate } : {}),
  };
  const html = buildDocHtml(full, false);
  const sheet = (
    <div ref={boxRef} className="border-border overflow-hidden rounded-md border bg-white shadow-sm" style={{ height: Math.round(1123 * scale) }}>
      <iframe
        title={L("Document preview", "Pratonton dokumen")}
        srcDoc={html}
        sandbox="allow-same-origin"
        className="block origin-top-left border-0 bg-white"
        style={{ width: 794, height: 1123, transform: `scale(${scale})` }}
      />
    </div>
  );
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-[9px] font-bold tracking-[0.14em] uppercase">{L("Preview — as it will print", "Pratonton — seperti ia akan dicetak")}</p>
        <button type="button" className="text-xs underline xl:hidden" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? L("Hide preview", "Sembunyi pratonton") : L("Preview", "Pratonton")}
        </button>
      </div>
      <div className={`mt-1.5 ${open ? "block" : "hidden xl:block"}`}>{sheet}</div>
    </div>
  );
}

export function Sales({ user, workExtra, customersExtra, reports, initialView = "documents", createRequest = 0, focus }: { user: User; workExtra?: ReactNode; customersExtra?: ReactNode; reports?: ReactNode; initialView?: "documents" | "create"; createRequest?: number; focus?: RecordFocus | null }) {
  /* v1.123.0 - one area at a time (CEO, 06-09-2026) */
  const [custTab, setCustTab] = useState<"add" | "clients">("clients");
  const [workTab, setWorkTab] = useState<"create" | "documents" | "receipts" | "packages">(initialView);
  /* v1.214.0 - THE SALES WORKSPACE: one panel, five tabs over the same
     records (sales-workspace.tsx). The bodies stay mounted and are hidden,
     so a half-written quotation survives a look at another tab. "Mine" is
     the screen's filter over records every sales role may already read: a
     consultant opens on their own sales, management on everyone's. */
  const [wsView, setWsView] = useState<"overview" | "documents" | "closed" | "customers" | "reports">(initialView === "create" ? "documents" : "overview");
  const [scope, setScope] = useState<WsScope>(MANAGE_ROLES.includes(user.role) ? "all" : "mine");
  /* v1.216.0 - the figures over the whole table (GET /staff/docs/summary),
     for the scope on screen; refreshed with every load */
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const scopeRef = useRef(scope);
  const loadSummary = useCallback(async () => {
    const want = scopeRef.current;
    const r = await api<SalesSummary>(`/staff/docs/summary?scope=${want}`);
    if (scopeRef.current !== want) return;
    setSummary(r.ok && r.data && typeof r.data.collected?.cents === "number" ? r.data : null);
  }, []);
  useEffect(() => { scopeRef.current = scope; void loadSummary(); }, [scope, loadSummary]);
  const jump = (id: "sales-work" | "sales-customers") => {
    setWsView(id === "sales-work" ? "documents" : "customers");
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })));
  };
  useEffect(() => {
    if (initialView !== "create") return;
    setWorkTab("create");
    const frame = requestAnimationFrame(() => { setWsView("documents"); requestAnimationFrame(() => document.getElementById("sales-work")?.scrollIntoView({ block: "start" })); });
    return () => cancelAnimationFrame(frame);
  }, [initialView, createRequest]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [docs, setDocs] = useState<SalesDoc[]>([]);
  /* v1.181.13 - part payments received on each unpaid invoice (invoice id
     -> sen). Display only: an invoice is paid when it is marked paid. */
  const [partPaid, setPartPaid] = useState<Record<number, number>>({});
  const [canConfirmPaid, setCanConfirmPaid] = useState(false); // v1.215.0 - the server says (CEO, COO, super admin)
  const [canConfirmOwn, setCanConfirmOwn] = useState(false); // v1.216.2 - the server says (the CEO)
  /* v1.181.16 - the client file beside each customer: tags (the list
     filters by them), credit terms (a NEW invoice takes its due date from
     them) and the monthly invoices due. Nothing here changes a customer. */
  const [crm, setCrm] = useState<{ tags: { customer_id: number; tag: string }[]; terms: { customer_id: number; terms_days: number }[]; recurring: (RecurringRow & { customer_id: number })[]; followups: WsFollowUp[] }>({ tags: [], terms: [], recurring: [], followups: [] });
  const [tagFilter, setTagFilter] = useState("");
  /* v1.181.17 - the CEO's quotation approval limit; off (null) changes nothing */
  const [qa, setQa] = useState<QuoteApproval>({ limit_cents: null, pending: [], approved: [], can_set: false });
  const awaiting = (d: { id: number; doc_type: string }) => d.doc_type === "QT" && qa.limit_cents != null && qa.pending.some((p) => p.id === d.id);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [cust, setCust] = useState({
    company: "",
    contact_person: "",
    phone: "",
    email: "",
    address: "",
    website: "",
  });
  /* v1.30.0 — the client's own mark. Uploading needs the row to exist (the
     object key is built from its id), so the button only appears while
     editing a saved customer. */
  const [logoBusy, setLogoBusy] = useState<number | null>(null);
  const [editingCust, setEditingCust] = useState<{
    id: number;
    company: string;
  } | null>(null); // v1.4.235
  // customer_id: -1 = not chosen · 0 = walk-in/unidentified buyer.
  // salesperson_id: 0 = "me" (worker defaults to the creator).
  const [doc, setDoc] = useState<{
    doc_type: string;
    customer_id: number;
    salesperson_id: number;
    kind: string;
    items: DocItem[];
    discount_cents: number;
    tax_percent: number;
    delivery_cents: number;
    paid_received: boolean;
    reference: string;
    delivery_address: string;
    /* v1.30.1 — which entity issues this document: "a2z" (default) or
       "azoo" (AZ ONE OFFICIAL, consultancy work). Set at creation only;
       the worker ignores it on edit. */
    issuer: string;
  }>({
    doc_type: "QT",
    customer_id: -1,
    salesperson_id: 0,
    kind: "product",
    items: [{ name: "", qty: 1, unit_price_cents: 0 }],
    discount_cents: 0,
    tax_percent: 0,
    delivery_cents: 0,
    paid_received: false,
    reference: "",
    delivery_address: "",
    issuer: "a2z",
  });
  const [staffList, setStaffList] = useState<
    { id: number; name: string; role: string }[]
  >([]);
  const { show: showToast, node: toastNode } = useSaveToast();


  /* v1.4.240 (CEO: "why the popup card was not standardize like the current
     use"): the Sales tab was the last place still raising the browser's own
     "azoneofficial.com says" box — every destructive action here now uses the
     branded useConfirm() dialog, same family as the toasts. */
  const { confirm: askConfirm, node: confirmNode } = useConfirm();
  /* v1.4.248: the v1.4.240 sweep replaced every window.confirm but left the
     payment-reference prompt standing — the last native browser panel
     in the portal. */
  const { prompt: askText, node: promptNode } = usePrompt();
  /* v1.4.248 minimalist rows (CEO: "click at the document number can appear
     the details. the button remain at outside"): one document open at a time
     — opening another closes the first, so the list never grows tall. */
  const [openDoc, setOpenDoc] = useState<number | null>(null);
  /* v1.186.0 - the documents list's filters and page (see docRows) */
  const [docType, setDocType] = useState<"all" | "QT" | "INV" | "DO">("all");
  const [docStatus, setDocStatus] = useState<"all" | "unpaid" | "paid" | "open" | "invoiced">("all");
  const [docQuery, setDocQuery] = useState("");
  const [docPage, setDocPage] = useState(1);
  /* v1.191.0 - the owner's photo: "10 / page" beside numbered pages */
  const [DOC_PER, setDocPer] = useState(10);
  /* v1.191.0 - the photo puts Receipts, Credit notes and Outstanding on the
     Documents card's own pill row; which of the three the money view shows */
  const [money, setMoney] = useState<"outstanding" | "receipts" | "credit">("outstanding");
  const [openCust, setOpenCust] = useState<number | null>(null);
  // v1.4.94: backdating + typo edits. editingDoc = the document being fixed
  // (its number never changes); doc_date/paid_date allow true past dates for
  // payments received before this system existed.
  const [docDate, setDocDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [editingDoc, setEditingDoc] = useState<{
    id: number;
    doc_number: string;
    /* v1.181.11 - true: saving issues the next revision of this quotation
       (the customer asked for a change). false: a typo fix, in place. */
    revise?: boolean;
    /** the revision the document is at now; 0 = the original */
    revision?: number;
    revised_at?: string | null;
  } | null>(null);
  const [invItems, setInvItems] = useState<
    { name: string; sku: string; unit_price_cents?: number }[]
  >([]);
  /* v1.231.0 - the package this quotation's lines were filled from, if any.
     The lines are the form's own (doc.items); this is only the reference the
     quotation saves (package_id + package_version). */
  const [pkgRef, setPkgRef] = useState<(PackageRef & { issuers?: string[] }) | null>(null);
  // v1.4.96: aligned with the worker's finance permission — sales_marketing
  // creates QT/DO; invoices are created by finance roles ON THEIR BEHALF via
  // the Sales person dropdown (that's the attribution mechanism).
  const canInvoice = [
    "super_admin",
    "admin",
    "hr_admin",
    "coo",
    "cco",
    "ceo",
    "sales_marketing",
  ].includes(user.role);
  /* v1.224.0 (the owner, 29-10-2026): saying an invoice's money arrived -
     mark paid / unpaid / overdue, or create it already paid - is the CEO,
     COO and admins only (worker permissions invoice_payment). Everyone who
     can invoice still sees the payment status. */
  const canPay = ["super_admin", "admin", "ceo", "coo"].includes(user.role);
  const [loaded, setLoaded] = useState(false);
  /* v1.205.0 - a search hit opens the document (the list narrowed to its
     number, its panel open) or the customer (its record open on the
     clients list), the way pressing either here does */
  const focused = useRecordFocus(focus, loaded, (f) => {
    if (f.kind === "document") {
      const d = docs.find((x) => x.id === f.id);
      setWsView("documents");
      setWorkTab("documents"); setDocType("all"); setDocStatus("all"); setDocPage(1);
      setDocQuery(d ? d.doc_number : "");
      if (d) setOpenDoc(d.id);
    } else if (f.kind === "client") {
      setWsView("customers");
      setCustTab("clients"); setTagFilter("");
      if (customers.some((c) => c.id === f.id)) setOpenCust(f.id);
    }
  });
  useScrollToRecord(focused);
  const load = useCallback(async () => {
    const c = await api<{ customers: Customer[] }>(`/staff/customers`);
    setCustomers(c.data?.customers ?? []);
    const d = await api<{ docs: SalesDoc[]; can_confirm_paid?: boolean; can_confirm_own?: boolean; error?: { message?: string } }>(
      `/staff/docs`
    );
    setDocs(d.data?.docs ?? []);
    setCanConfirmPaid(d.data?.can_confirm_paid === true);
    setCanConfirmOwn(d.data?.can_confirm_own === true);
    void loadSummary();
    setLoaded(true);
    const pp = await api<{ invoices?: { invoice_id: number; received_cents: number }[] }>(`/staff/docs/part-payments`);
    const ppMap: Record<number, number> = {};
    for (const r of pp.data?.invoices ?? []) ppMap[r.invoice_id] = r.received_cents;
    setPartPaid(ppMap);
    const cr = await api<{ tags?: { customer_id: number; tag: string }[]; terms?: { customer_id: number; terms_days: number }[]; recurring?: (RecurringRow & { customer_id: number })[]; followups?: WsFollowUp[] }>(`/staff/customers/crm`);
    if (cr.ok && cr.data) setCrm({ tags: cr.data.tags ?? [], terms: cr.data.terms ?? [], recurring: cr.data.recurring ?? [], followups: cr.data.followups ?? [] });
    const qr = await api<QuoteApproval>(`/staff/quotes/approval`);
    if (qr.ok && qr.data) setQa(qr.data);
    setDocsError(
      d.ok
        ? null
        : (d.data?.error?.message ??
            L(
              "Could not load documents — press Refresh to retry",
              "Tidak dapat memuatkan dokumen — tekan Muat semula untuk cuba lagi"
            ))
    );
    const sl = await api<{
      staff: { id: number; name: string; role: string }[];
    }>(`/staff/staff-list`);
    setStaffList(sl.data?.staff ?? []);
    // v1.4.101: item descriptions suggest from Inventory (manual entry still fine).
    const inv = await api<{
      items?: { name: string; sku: string; unit_price_cents?: number }[];
    }>(`/staff/inventory`);
    setInvItems(inv.data?.items ?? []);
  }, [loadSummary]);
  useEffect(() => {
    void load();
  }, [load]);
  /* v1.65.0 live: Sales reads customers, documents and the orders behind them. */
  useLiveRefresh(["customers", "docs", "orders"], load);

  const addCustomer = async () => {
    if (!cust.company) return;
    /* v1.4.235 (CEO: "existing data I can edit and update or delete"):
       the same form saves a new customer OR updates the one being edited
       (PUT sends every field; empty boxes clear the stored value). */
    if (editingCust) {
      const res = await api<{ error?: { message?: string } }>(
        `/staff/customers/${editingCust.id}`,
        { method: "PUT", body: JSON.stringify(cust) }
      );
      if (!res.ok) {
        showToast(
          L("No changes", "Tiada perubahan"),
          res.data?.error?.message ?? L("Update failed", "Kemas kini gagal"),
          "notice"
        );
        return;
      }
      showToast(
        L("Saved", "Disimpan"),
        L(`${cust.company} updated`, `${cust.company} dikemas kini`)
      );
    } else {
      /* v1.225.0 - the server warns when the company name or phone is
         already on file; adding anyway is a deliberate second step */
      let res = await api<{ error?: { code?: string; message?: string } }>(`/staff/customers`, {
        method: "POST",
        body: JSON.stringify(cust),
      });
      if (!res.ok && res.data?.error?.code === "possible_duplicate") {
        const go = await askConfirm({
          title: L("This customer may already exist", "Pelanggan ini mungkin sudah wujud"),
          message: res.data.error.message ?? "",
          confirmLabel: L("Add anyway", "Tambah juga"),
        });
        if (!go) return;
        res = await api<{ error?: { code?: string; message?: string } }>(`/staff/customers`, {
          method: "POST",
          body: JSON.stringify({ ...cust, confirm_duplicate: true }),
        });
        if (!res.ok) {
          showToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Could not add the customer", "Tidak dapat menambah pelanggan"), "notice");
          return;
        }
      }
      if (!res.ok) {
        showToast(L("Not saved", "Tidak disimpan"), res.data?.error?.message ?? L("Could not add the customer", "Tidak dapat menambah pelanggan"), "notice");
        return;
      }
      showToast(
        L("Saved", "Disimpan"),
        L(`${cust.company} added`, `${cust.company} ditambah`)
      );
    }
    setCust({
      company: "",
      contact_person: "",
      phone: "",
      email: "",
      address: "",
      website: "",
    });
    setEditingCust(null);
    void load();
  };
  /* v1.181.11 - Edit and Revise load a document into the form the same way;
     they differ in what saving it does (see saveDoc). */
  const openInForm = async (d: SalesDoc, revise: boolean) => {
    const r = await fetch(`/api/v1/staff/docs/${d.id}`, {
      credentials: "include",
    });
    if (!r.ok) return;
    const { doc: full } = (await r.json()) as {
      doc: DocFull & {
        customer_id?: number;
        salesperson_id?: number | null;
      };
    };
    let its: DocItem[] = [];
    try {
      its = JSON.parse(full.items);
    } catch {
      its = [];
    }
    setDoc({
      doc_type: full.doc_type,
      customer_id:
        (full as { customer_id?: number }).customer_id ?? -1,
      salesperson_id:
        (full as { salesperson_id?: number | null })
          .salesperson_id ?? 0,
      items: its.length
        ? its
        : [{ name: "", qty: 1, unit_price_cents: 0 }],
      discount_cents: full.discount_cents ?? 0,
      tax_percent: full.tax_percent ?? 0,
      delivery_cents:
        (full as { delivery_cents?: number })
          .delivery_cents ?? 0,
      paid_received: false,
      kind:
        (full as { kind?: string | null }).kind ?? "product",
      reference:
        (full as { reference?: string | null }).reference ??
        "",
      delivery_address:
        (full as { delivery_address?: string | null })
          .delivery_address ?? "",
      /* the entity never changes after creation — carried only so
         the state shape stays complete; the worker ignores it. */
      issuer:
        (full as { issuer_code?: string | null })
          .issuer_code === "azoo"
          ? "azoo"
          : "a2z",
    });
    /* a revision is dated today, and the date box shows it (locked) */
    setDocDate(revise ? mytToday() : full.created_at.slice(0, 10));
    setEditingDoc({
      id: d.id, doc_number: d.doc_number, revise,
      revision: Number(full.revision ?? 0), revised_at: full.revised_at ?? null,
    });
    setWorkTab("create");
    jump("sales-work");
    /* v1.231.0 - the package it was made from, named from that version
       (readable even if the package has since been archived) */
    const fp = full as { package_id?: number | null; package_version?: number | null };
    setPkgRef(null);
    if (full.doc_type === "QT" && fp.package_id) {
      const ref = { id: fp.package_id, version: Number(fp.package_version ?? 1) };
      void api<{ package?: { name: string; issuers: string[] } }>(`/staff/packages/${ref.id}?version=${ref.version}`).then((r) =>
        setPkgRef({ ...ref, name: r.data?.package?.name ?? L(`Package #${ref.id}`, `Pakej #${ref.id}`), issuers: r.data?.package?.issuers }));
    }
  };
  const resetDocForm = () => {
    setDoc({
      doc_type: "QT",
      customer_id: -1,
      salesperson_id: 0,
      kind: "product",
      items: [{ name: "", qty: 1, unit_price_cents: 0 }],
      discount_cents: 0,
      tax_percent: 0,
      delivery_cents: 0,
      paid_received: false,
      reference: "",
      delivery_address: "",
      issuer: "a2z",
    });
    setDocDate("");
    setPaidDate("");
    setEditingDoc(null);
    setPkgRef(null);
  };

  /* v1.4.273 idea 2: the prospect → quotation handoff. The Social tab wrote
     a prefill into localStorage and jumped here; we either pick the existing
     customer by company name or pre-fill the new-customer form, and stamp
     the reference so the QT says where it came from.
     v1.181.16 (ERP roadmap phase 4): the same handoff now also carries an
     ENQUIRY (Enquiries -> Make quotation) and a client's MONTHLY INVOICE
     (the recurring list below), both opening the Create form. A prefill
     with no `source` behaves exactly as before. */
  type Prefill = {
    company?: string; contact_person?: string; phone?: string; reference?: string;
    source?: "enquiry" | "recurring";
    customer_id?: number; doc_type?: string; kind?: string; items?: DocItem[];
    discount_cents?: number; tax_percent?: number; delivery_cents?: number; issuer?: string; salesperson_id?: number;
  };
  const applyPrefill = (pf: Prefill) => {
    if (pf.source === "recurring" && pf.customer_id) {
      resetDocForm();
      setDoc((d) => ({
        ...d,
        doc_type: "INV",
        customer_id: pf.customer_id!,
        kind: pf.kind ?? d.kind,
        items: Array.isArray(pf.items) && pf.items.length ? pf.items : d.items,
        discount_cents: pf.discount_cents ?? 0,
        tax_percent: pf.tax_percent ?? 0,
        delivery_cents: pf.delivery_cents ?? 0,
        issuer: pf.issuer ?? d.issuer,
        salesperson_id: pf.salesperson_id ?? 0,
        reference: pf.reference ?? "",
      }));
      setWorkTab("create");
      jump("sales-work");
      showToast(
        L("Form filled", "Borang diisi"),
        L("Check the lines and the date, then create the invoice.", "Semak baris dan tarikh, kemudian buat invois.")
      );
      return;
    }
    const existing = customers.find(
      (c) =>
        c.company.trim().toLowerCase() ===
        (pf.company ?? "").trim().toLowerCase()
    );
    setDoc((d) => ({
      ...d,
      doc_type: "QT",
      reference: pf.reference ?? d.reference,
      customer_id: existing ? existing.id : d.customer_id,
      /* v1.225.0 - the enquiry's consultant, if they are on the salesperson list */
      salesperson_id: pf.salesperson_id && staffList.some((u) => u.id === pf.salesperson_id) ? pf.salesperson_id : d.salesperson_id,
    }));
    if (!existing)
      setCust((c) => ({
        ...c,
        company: pf.company ?? "",
        contact_person: pf.contact_person ?? "",
        phone: pf.phone ?? "",
      }));
    if (pf.source === "enquiry") {
      setWorkTab("create");
      if (!existing) setCustTab("add");
      jump(existing ? "sales-work" : "sales-customers");
    }
    showToast(
      pf.source === "enquiry"
        ? L("Prefilled from the enquiry", "Diisi awal daripada pertanyaan")
        : L("Prefilled from prospect", "Diisi awal daripada prospek"),
      existing
        ? L(
            `${existing.company} selected — add the package lines and save the quotation`,
            `${existing.company} dipilih — tambah baris pakej dan simpan sebut harga`
          )
        : L(
            `Add ${pf.company ?? "the client"} as a customer first, then the quotation form is ready`,
            `Tambah ${pf.company ?? "pelanggan itu"} sebagai pelanggan dahulu, kemudian borang sebut harga sedia`
          )
    );
  };
  /* v1.181.16 - wait for the first customer load before reading the
     handoff: read on mount, it matched against an empty list and always
     fell to the new-customer form */
  const firstCustomers = useRef(customers);
  useEffect(() => {
    if (customers === firstCustomers.current) return;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem("azone-qt-prefill");
    } catch {
      return;
    }
    if (!raw) return;
    try {
      localStorage.removeItem("azone-qt-prefill");
    } catch {
      /* fine */
    }
    try {
      applyPrefill(JSON.parse(raw) as Prefill);
    } catch {
      /* malformed handoff — ignore */
    }
    // customers in deps: on a cold open the list arrives after mount and the
    // company match must run against the LOADED list.
  }, [customers]); // eslint-disable-line react-hooks/exhaustive-deps

  /* v1.181.16 - the due date credit terms give a new invoice, if any */
  const termsDue = (() => {
    if (doc.doc_type !== "INV" || doc.paid_received || editingDoc) return null;
    const t = crm.terms.find((x) => x.customer_id === doc.customer_id);
    if (!t) return null;
    const base = docDate || mytToday();
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + t.terms_days);
    return { on: d.toISOString().slice(0, 10), days: t.terms_days };
  })();

  /* v1.231.0 - APPLY A PACKAGE: its version's lines become this quotation's
     own lines (replacing them, or after them), as service lines; its
     discount becomes the document discount. Everything after is the form as
     it always was - edit, add, remove, preview, save. */
  const applyPackage = (p: PackageRow, mode: "replace" | "add") => {
    const lines: DocItem[] = p.items.map((i) => ({ ...i, sub: i.sub ? [...i.sub] : undefined }));
    setDoc((d) => {
      const kept = d.items.filter((it) => (it.name.trim() || it.unit_price_cents > 0) && !it.sku);
      return {
        ...d,
        kind: "service",
        delivery_cents: 0,
        items: mode === "add" && kept.length ? [...kept, ...lines] : lines,
        discount_cents: mode === "add" ? d.discount_cents + p.discount_cents : p.discount_cents,
      };
    });
    setPkgRef({ id: p.id, version: p.current_version, name: p.name, issuers: p.issuers });
    showToast(L("Package applied", "Pakej digunakan"), L(`${p.name}: ${p.item_count} line(s) copied into this quotation. Edit them as needed.`, `${p.name}: ${p.item_count} baris disalin ke sebut harga ini. Sunting mengikut keperluan.`));
  };
  const createDoc = async () => {
    // v1.4.94: silent returns were why "nothing saved" — every stop now says why.
    if (doc.customer_id === -1) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L(
          "Choose a customer first (Walk-in counts)",
          "Pilih pelanggan dahulu (Walk-in pun dikira)"
        ),
        "notice"
      );
      return;
    }
    if (doc.items.some((i) => !i.name.trim())) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L(
          "Every line needs an item description",
          "Setiap baris memerlukan keterangan barang"
        ),
        "notice"
      );
      return;
    }
    /* v1.41.0: a product document's lines come from the catalogue — the
       server refuses a product line without a SKU, so stop it here with a
       friendlier message than a 400. */
    if (doc.kind !== "service" && doc.items.some((i) => !(i.sku ?? "").trim())) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L(
          "Pick each product from the list — product lines need a SKU",
          "Pilih setiap produk daripada senarai — baris produk memerlukan SKU"
        ),
        "notice"
      );
      return;
    }
    if (doc.items.every((i) => !i.unit_price_cents)) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L("Enter a unit price (RM)", "Masukkan harga seunit (RM)"),
        "notice"
      );
      return;
    }
    /* v1.33.3 — tidy the detail lines HERE, not while he is typing. Blank
       lines and stray spaces must not reach the PDF (they print as empty
       bullets), but stripping them on every keystroke is what stopped him
       typing a space at all. Over ten lines is refused out loud rather than
       silently cut, which is what the old .slice(0, 10) did. */
    const MAX_SUB = 12;
    const overflowing = doc.items.find(
      (i) => (i.sub ?? []).filter((s) => s.trim()).length > MAX_SUB
    );
    if (overflowing) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L(
          `"${overflowing.name}" has more than ${MAX_SUB} detail lines — trim it first`,
          `"${overflowing.name}" ada lebih ${MAX_SUB} baris butiran — sila kurangkan dahulu`
        ),
        "notice"
      );
      return;
    }
    /* v1.227.0 - an invoice names its closer; the server refuses one that
       does not, so say it here before anything is sent */
    if (doc.doc_type === "INV" && !doc.salesperson_id) {
      showToast(
        L("Choose the closer", "Pilih penutup"),
        L("An invoice names the salesperson who closed the sale. Pick them under Sales person.", "Invois menamakan jurujual yang menutup jualan. Pilih di bawah Jurujual."),
        "notice"
      );
      return;
    }
    /* v1.99.2 — the page budget, checked once at save with the SAME
       measurement the template prints by. The editor already stops the Add
       button; this catches a description typed long after the line existed. */
    const fitNow = docPageFit(doc.items, doc.doc_type);
    if (fitNow.over) {
      showToast(
        L("No changes", "Tiada perubahan"),
        L("This would run past one page. Shorten a description, remove a detail line, or split it into a second document.",
          "Ini akan melebihi satu halaman. Pendekkan keterangan, buang satu baris butiran, atau pecahkan kepada dokumen kedua."),
        "notice"
      );
      return;
    }
    const payload = {
      ...doc,
      items: doc.items.map((i) => {
        const sub = (i.sub ?? []).map((s) => s.trim()).filter(Boolean);
        return { ...i, name: i.name.trim(), sub: sub.length ? sub : undefined };
      }),
      salesperson_id: doc.salesperson_id || undefined,
      doc_date: docDate || undefined,
      paid_date: doc.paid_received
        ? paidDate || docDate || undefined
        : undefined,
      /* v1.181.16 - a NEW invoice for a client with credit terms carries its
         due date; no terms, no due date, exactly as before */
      due_date: !editingDoc && termsDue ? termsDue.on : undefined,
      /* v1.231.0 - a quotation names the package it was filled from (or
         none); other documents leave the link as it is */
      ...(doc.doc_type === "QT" ? { package_id: pkgRef?.id ?? null, package_version: pkgRef?.version ?? null } : {}),
    };
    if (editingDoc) {
      const res = await api<{
        stock?: Parameters<typeof stockToastLine>[0];
        error?: { message?: string };
        revision?: number;
      }>(`/staff/docs/${editingDoc.id}/edit`, {
        method: "POST",
        body: JSON.stringify(editingDoc.revise ? { ...payload, revise: true } : payload),
      });
      if (!res.ok) {
        showToast(
          L("No changes", "Tiada perubahan"),
          res.data?.error?.message ??
            L("Update failed — check access", "Kemas kini gagal — semak akses"),
          "notice"
        );
        return;
      }
      // v1.4.265: an edited product invoice re-balances stock — say what moved.
      showToast(
        L("Saved", "Disimpan"),
        (editingDoc.revise
          ? L(
              `${editingDoc.doc_number} REV ${res.data?.revision ?? (editingDoc.revision ?? 0) + 1} issued — the earlier version is in History`,
              `${editingDoc.doc_number} REV ${res.data?.revision ?? (editingDoc.revision ?? 0) + 1} dikeluarkan — versi terdahulu dalam Sejarah`
            )
          : L(
              `${editingDoc.doc_number} updated`,
              `${editingDoc.doc_number} dikemas kini`
            )) + stockToastLine(res.data?.stock)
      );
      const idP = editingDoc.id;
      resetDocForm();
      void load();
      void printDoc(idP); // fresh PDF straight after the fix
      return;
    }
    type StockMove = {
      deducted: { sku: string; qty: number; stock: number }[];
      unmatched: string[];
      short: string[];
    } | null;
    const res = await api<{
      id?: number;
      doc_number?: string;
      stock?: StockMove;
      error?: { message?: string };
    }>(`/staff/docs`, { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok || !res.data?.id) {
      showToast(
        L("No changes", "Tiada perubahan"),
        res.data?.error?.message ??
          L("Create failed — check access", "Gagal dibuat — semak akses"),
        "notice"
      );
      return;
    }
    showToast(
      L("Saved", "Disimpan"),
      L(
        `${res.data.doc_number ?? "Document"} created${doc.paid_received ? " — PAID" : ""}`,
        `${res.data.doc_number ?? "Dokumen"} dibuat${doc.paid_received ? " — DIBAYAR" : ""}`
      ) + stockToastLine(res.data.stock)
    );
    const newId = res.data.id;
    resetDocForm();
    await load(); // v1.4.97: awaited so the new document is visible in the list at once
    void printDoc(newId); // PDF opens immediately after creation
  };
  /* v1.4.244 (CEO: "I want the format can be deliver to my customer using
     mobile instead of I need to download using web view"): minting the link
     and handing it straight to the phone's share sheet — WhatsApp, Telegram,
     email, whatever they use — is two taps. No download, no file manager.
     Desktop has no share sheet, so the link goes to the clipboard instead. */
  /* v1.4.245 (CEO: "maybe we open the pdf then I can share to customer as a
     pdf instead of a link"): Send now builds the REAL PDF in the browser and
     hands the FILE to the phone's share sheet — one tap into WhatsApp, the
     customer receives a proper attachment. Three rungs, best first:
       1. share the file          (iOS 15+/Android Chrome)
       2. download the file       (desktop, older phones)
       3. share the v1.4.244 link (if the PDF could not be built at all) */
  const shareDoc = async (d: SalesDoc) => {
    const kind =
      {
        QT: L("Quotation", "Sebut Harga"),
        INV: L("Invoice", "Invois"),
        DO: L("Delivery Order", "Pesanan Penghantaran"),
      }[d.doc_type] ?? L("Document", "Dokumen");
    const filename = docFileName(d);
    let blob: Blob | null = null;
    try {
      const r = await fetch(`/api/v1/staff/docs/${d.id}`, {
        credentials: "include",
      });
      if (r.ok) {
        const { doc: full } = (await r.json()) as { doc: DocFull };
        blob = await buildDocPdf(full);
      }
    } catch {
      blob = null;
    }

    if (blob && typeof navigator.canShare === "function") {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `${kind} ${docRevisionLabel(d)}`,
          });
          return;
        } catch {
          /* the sheet was dismissed — don't fall through to a download */
          return;
        }
      }
    }
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      showToast(
        L("PDF ready", "PDF sedia"),
        L(
          `${filename} saved — attach it from your files`,
          `${filename} disimpan — lampirkan daripada fail anda`
        )
      );
      return;
    }

    const res = await api<{ url?: string; error?: { message?: string } }>(
      `/staff/docs/${d.id}/share`,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (!res.ok || !res.data?.url) {
      showToast(
        L("No changes", "Tiada perubahan"),
        res.data?.error?.message ??
          L(
            "Could not prepare the document",
            "Tidak dapat menyediakan dokumen"
          ),
        "notice"
      );
      return;
    }
    const url = res.data.url;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${kind} ${docRevisionLabel(d)}`, url });
        return;
      } catch {
        /* dismissed */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(
        L("Link ready", "Pautan sedia"),
        L(
          `${d.doc_number} — link copied, paste it to your customer`,
          `${d.doc_number} — pautan disalin, tampal kepada pelanggan anda`
        )
      );
    } catch {
      showToast(L("Link ready", "Pautan sedia"), url);
    }
  };
  const setStatus = async (
    d: SalesDoc,
    value: string,
    paymentRef?: string,
    paidOn?: string
  ) => {
    const body =
      d.doc_type === "INV"
        ? value === "paid"
          ? {
              payment_status: "paid",
              payment_method: "bank_transfer",
              payment_ref: paymentRef || undefined,
              paid_on: paidOn || undefined,
            }
          : { payment_status: value }
        : { delivery_status: value };
    /* v1.79.0 — marking an invoice PAID, or a delivery order DELIVERED, from
       a dropdown that reported nothing. This is the money end of the
       document list: "did that save?" was unanswerable, and pressing it
       again is the natural response. Both outcomes now say so, and a
       failure reloads so the dropdown stops showing a value the server
       never accepted. */
    const r = await api(`/staff/docs/${d.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      showToast(
        L("Not saved", "Tidak disimpan"),
        L(`${d.doc_number} is unchanged — try again`, `${d.doc_number} tidak berubah — cuba lagi`),
        "notice",
      );
    } else {
      showToast(
        d.doc_type === "INV"
          ? value === "paid" ? L("Marked paid", "Ditanda dibayar") : L("Payment status updated", "Status bayaran dikemas kini")
          : value === "delivered" ? L("Marked delivered", "Ditanda dihantar") : L("Delivery status updated", "Status penghantaran dikemas kini"),
        d.doc_number,
      );
    }
    void load();
  };

  /* v1.41.2 (CEO: "I saw total was not deduct when there is discount
     insert"): this preview and the Worker MUST compute the same number.
     Line discounts shipped in v1.4.243 and the server has subtracted them
     ever since — but this preview never did, so two RM 11.70 lines with
     RM 1.70 off each showed "Total: RM 23.40" while the created document
     said RM 20.00. Staff read one number, the customer got another.
     The formula below now mirrors staff.ts POST /docs term for term:
     per-line discount capped at the line's own value, then the document
     discount, then tax, then delivery — which the server zeroes on a DO
     AND on a service document (v1.4.238), not just on a DO. */
  const subtotal = docSubtotal(doc.items); // v1.231.0 - one line arithmetic (lib/doc-totals.ts)
  // v1.4.160: delivery / postage fee — added after discount + tax (pass-through
  // charge, not taxable goods value); never on a Delivery Order or a service.
  const total =
    Math.max(
      0,
      Math.round((subtotal - doc.discount_cents) * (1 + doc.tax_percent / 100))
    ) +
    (doc.doc_type === "DO" || doc.kind === "service" ? 0 : doc.delivery_cents);

  /* v1.173.0 (tab concept) - the summary tier: this month's documents, by
     the date they were raised, from the rows already loaded. Quotations
     and invoices are the two doors most people came through; the unpaid
     figure is the one the CEO reads first. */
  const monthKey = mytToday().slice(0, 7);
  /* v1.181.12 - the month a timestamp falls in HERE: a document raised at
     00:30 on the 1st is this month's, not last month's UTC tail. */
  const mytYm = (ts?: string | null) => (ts ? mytDateOf(ts).slice(0, 7) : "");
  /* v1.214.0 - "Mine": the documents where this person is the salesperson
     (the closer). The same rules below, over the scoped list. */
  /* v1.214.0 - the closer of an invoice with money recorded is locked (the
     server refuses the change; the form says so before anyone tries) */
  const editCloserLocked = (() => { const e = editingDoc ? docs.find((x) => x.id === editingDoc.id) : null; return !!e && closerLocked(e, partPaid); })();
  const sDocs = scope === "mine" ? docs.filter((d) => d.salesperson_id === user.id) : docs;
  const sFollowups = scope === "mine" ? crm.followups.filter((f) => f.owner_id === user.id) : crm.followups;
  const monthDocs = sDocs.filter((d) => mytYm(d.created_at) === monthKey);
  const monthQt = monthDocs.filter((d) => d.doc_type === "QT");
  const monthInv = monthDocs.filter((d) => d.doc_type === "INV");
  /* v1.181.12 (CEO, 20-10-2026: "for the sales, it doesnt reflected to the
     correct date which is paid date of invoice") - PAID is money received
     this month, by the date the payment landed, whenever the invoice was
     raised. It used to be "invoices raised this month that are paid": a
     September invoice paid on 2 October counted in neither month's Paid,
     and an October invoice paid in November showed here in October. This
     is the same rule the dashboard's sales and commission already use. */
  const paidThisMonth = sDocs.filter((d) => d.doc_type === "INV" && d.payment_status === "paid"
    && mytYm(d.paid_at ?? d.created_at) === monthKey);
  const unpaidInv = sDocs.filter((d) => d.doc_type === "INV" && d.payment_status !== "paid");
  /* v1.216.0 - the server's figures, when they are for this month and this scope */
  const sm = summary && summary.month === monthKey && summary.scope === scope ? summary : null;
  const cents = (list: SalesDoc[]) => list.reduce((a, d) => a + d.total_cents, 0);
  /* v1.186.0 (the owner's reference): last month's figures beside this
     month's, by the same two rules - raised by created_at, paid by paid_at */
  const lastKey = (() => { const d = new Date(`${monthKey}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const lastInv = sDocs.filter((d) => d.doc_type === "INV" && mytYm(d.created_at) === lastKey);
  const lastPaid = sDocs.filter((d) => d.doc_type === "INV" && d.payment_status === "paid" && mytYm(d.paid_at ?? d.created_at) === lastKey);
  const vsLast = (now: number, before: number): { pct: number | null; text: string } | undefined => {
    if (!before) return undefined;
    const pct = Math.round(((now - before) / before) * 100);
    return { pct, text: L(`${Math.abs(pct)}% vs last month`, `${Math.abs(pct)}% berbanding bulan lepas`) };
  };
  /* the last six months of quotations raised, newest last - the tile's bars */
  const qtSpark = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${monthKey}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - (5 - i));
    const k = d.toISOString().slice(0, 7);
    return sDocs.filter((x) => x.doc_type === "QT" && mytYm(x.created_at) === k).length;
  });
  /* v1.186.0 - the documents list: a type pill, a search, a status pick and
     ten a page. Filters only; every row keeps every action it had. */
  const docRows = docs.filter((d) =>
    (docType === "all" || d.doc_type === docType)
    && (docStatus === "all"
      || (docStatus === "paid" ? d.doc_type === "INV" && d.payment_status === "paid"
        : docStatus === "unpaid" ? d.doc_type === "INV" && d.payment_status !== "paid"
          : docStatus === "invoiced" ? d.doc_type === "QT" && !!d.invoiced_as
            : docStatus === "open" ? d.doc_type === "QT" && !d.invoiced_as : true))
    && (!docQuery.trim() || `${d.doc_number} ${d.company} ${d.customer_phone ?? ""} ${d.salesperson_name ?? ""}`.toLowerCase().includes(docQuery.trim().toLowerCase())));
  const docPages = Math.max(1, Math.ceil(docRows.length / DOC_PER));
  const docPageSafe = Math.min(docPage, docPages);
  const pageDocs = docRows.slice((docPageSafe - 1) * DOC_PER, docPageSafe * DOC_PER);

  return (
    /* The page's TabPage is the stack; these are its zones: AT A GLANCE
       (figures), THE WORK, CUSTOMERS; the page adds THIS MONTH (the map)
       and THE LONGER VIEW after them. */
    <>
      {/* v1.214.0 - THE SALES WORKSPACE (the owner's brief, 27-10-2026): the
          shared underline tabs, the month and "Create document" at the
          right; the breadcrumb they replace said the same thing twice. */}
      <LineTabs value={wsView} onChange={(k) => setWsView(k)} label={L("Sales", "Jualan")} tabs={[
        ["overview", L("Overview", "Gambaran")],
        ["documents", L("Quotations & Invoices", "Sebut Harga & Invois")],
        ["closed", L("Closed Sales", "Jualan Ditutup")],
        ["customers", L("Customers & Follow-ups", "Pelanggan & Susulan")],
        ...(reports ? ([["reports", L("Reports", "Laporan")]] as const) : []),
      ]} aside={
        <TabAside>
          <TabPeriod>{(() => { const [y, m] = monthKey.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }); })()}</TabPeriod>
          <TabAction icon="add" onClick={() => { setWorkTab("create"); jump("sales-work"); }}>
            {L("Create document", "Buat dokumen")}
          </TabAction>
        </TabAside>
      } />
      {wsView === "overview" && (
        <>
          <div className={sc.scopeRow}>
            <ScopeSwitch scope={scope} onChange={setScope} />
            <span className="erp-meta">{scope === "mine"
              ? L("Your sales: documents where you are the salesperson, follow-ups you own.", "Jualan anda: dokumen di mana anda jurujual, susulan milik anda.")
              : L("Everyone's sales.", "Jualan semua orang.")}</span>
          </div>
          <div className={sc.tiles}>
          {/* v1.216.0 - the figures come from GET /staff/docs/summary (every
              row, the same rules); the screen's own sums over the documents it
              holds are the fallback for a worker without that route. */}
          <KpiRow label={L("Sales this month", "Jualan bulan ini")}>
            <KpiTile icon="paid" tone="green" label={L("Collected", "Dikutip")} value={fmtRM(sm ? sm.collected.cents : cents(paidThisMonth))} busy={!loaded}
              sub={L(`This month · ${sm ? sm.collected.n : paidThisMonth.length} paid in full, by payment date`, `Bulan ini · ${sm ? sm.collected.n : paidThisMonth.length} dibayar penuh, ikut tarikh bayaran`)}
              delta={sm ? vsLast(sm.collected.cents, sm.collected_last.cents) : vsLast(cents(paidThisMonth), cents(lastPaid))}
              onClick={() => setWsView("closed")} title={L("Open the closed sales", "Buka jualan ditutup")} />
            {sm && (
              <KpiTile icon="money" tone="green" label={L("Cash received", "Wang diterima")} value={fmtRM(sm.cash_cents)}
                sub={L("This month · part payments included", "Bulan ini · termasuk bayaran separa")} delta={vsLast(sm.cash_cents, sm.cash_last_cents)}
                title={L("Money received this month: part payments on the day they arrived, and what was left on each invoice marked paid this month. Collected is unchanged: it counts an invoice once it is paid in full.", "Wang diterima bulan ini: bayaran separa pada hari ia tiba, dan baki setiap invois yang ditanda dibayar bulan ini. Dikutip tidak berubah: ia mengira invois setelah dibayar penuh.")} />
            )}
            <KpiTile icon="document" tone="gold" label={L("Quotations", "Sebut harga")} value={sm ? sm.quotations.n : monthQt.length} busy={!loaded}
              spark={sm ? sm.quotations_spark : qtSpark} sub={L(`This month · ${fmtRM(sm ? sm.quotations.cents : cents(monthQt))}`, `Bulan ini · ${fmtRM(sm ? sm.quotations.cents : cents(monthQt))}`)}
              onClick={() => { setWorkTab("documents"); setDocType("QT"); setDocPage(1); jump("sales-work"); }} title={L("Open the quotations", "Buka sebut harga")} />
            <KpiTile icon="documents" tone="navy" label={L("Invoices", "Invois")} value={fmtRM(sm ? sm.invoiced.cents : cents(monthInv))} busy={!loaded}
              sub={L(`This month · ${sm ? sm.invoiced.n : monthInv.length} raised`, `Bulan ini · ${sm ? sm.invoiced.n : monthInv.length} dikeluarkan`)}
              delta={sm ? vsLast(sm.invoiced.cents, sm.invoiced_last.cents) : vsLast(cents(monthInv), cents(lastInv))}
              onClick={() => { setWorkTab("documents"); setDocType("INV"); setDocPage(1); jump("sales-work"); }} title={L("Open the invoices", "Buka invois")} />
            {sm ? (
              <KpiTile icon="pending" tone="red" label={L("Unpaid Invoices", "Invois Belum Dibayar")} value={fmtRM(sm.outstanding.balance_cents)} busy={!loaded}
                sub={L(`Still owed · ${sm.outstanding.n} invoice${sm.outstanding.n === 1 ? "" : "s"} · ${fmtRM(sm.outstanding.total_cents)} invoiced · any month`, `Masih terhutang · ${sm.outstanding.n} invois · ${fmtRM(sm.outstanding.total_cents)} diinvois · mana-mana bulan`)}
                onClick={() => { setWorkTab("receipts"); setMoney("outstanding"); jump("sales-work"); }} title={L("Open the outstanding report", "Buka laporan tertunggak")} />
            ) : (
              <KpiTile icon="pending" tone="red" label={L("Unpaid Invoices", "Invois Belum Dibayar")} value={unpaidInv.length} busy={!loaded}
                sub={L(`Any month · ${fmtRM(cents(unpaidInv))}`, `Mana-mana bulan · ${fmtRM(cents(unpaidInv))}`)}
                onClick={() => { setWorkTab("receipts"); setMoney("outstanding"); jump("sales-work"); }} title={L("Open the outstanding report", "Buka laporan tertunggak")} />
            )}
            <KpiTile icon="date" tone="blue" label={L("Follow-ups due", "Susulan perlu dibuat")} value={sFollowups.filter((f) => f.due_on <= mytToday()).length} busy={!loaded}
              sub={L(`Today or earlier · ${sFollowups.filter((f) => f.due_on < mytToday()).length} overdue`, `Hari ini atau lebih awal · ${sFollowups.filter((f) => f.due_on < mytToday()).length} lewat`)}
              onClick={() => setWsView("customers")} title={L("Open the customers and follow-ups", "Buka pelanggan dan susulan")} />
          </KpiRow>
          </div>
          <SalesOverviewCards docs={sDocs} partPaid={partPaid} followups={sFollowups} monthKey={monthKey} today={mytToday()} summary={sm} scope={scope}
            onOpenDocs={(t) => { setWorkTab("documents"); setDocType(t); setDocStatus("all"); setDocPage(1); jump("sales-work"); }}
            onOpenDoc={(d) => { setWorkTab("documents"); setDocType("all"); setDocStatus("all"); setDocQuery(d.doc_number); setDocPage(1); setOpenDoc(d.id); jump("sales-work"); }}
            onOpenCustomer={(f) => openCustomerFile(f.customer_id, f.company, () => void load())}
            onClosed={() => setWsView("closed")} />
        </>
      )}
      {wsView === "closed" && (
        <>
          <div className={sc.scopeRow}>
            <ScopeSwitch scope={scope} onChange={setScope} />
          </div>
          <ClosedSales docs={sDocs} partPaid={partPaid} monthKey={monthKey} canFix={["ceo", "super_admin"].includes(user.role)}
            canConfirm={canConfirmPaid} canConfirmOwn={canConfirmOwn} userId={user.id}
            onConfirmed={(msg) => { void load(); showToast(L("Saved", "Disimpan"), msg); }}
            staff={staffList.map((x) => ({ id: x.id, name: x.name }))}
            onOpenDoc={(d) => { setWorkTab("documents"); setDocType("all"); setDocStatus("all"); setDocQuery(d.doc_number); setDocPage(1); setOpenDoc(d.id); jump("sales-work"); }}
            onFixed={() => { void load(); showToast(L("Closer corrected", "Penutup dibetulkan"), L("Recorded in the audit trail with your reason.", "Direkodkan dalam jejak audit dengan sebab anda.")); }} />
        </>
      )}
      {wsView === "reports" && reports}
      {/* v1.152.2 (CEO: "when I pick paid, then why it doesnt update?!"):
          the toast, the confirm dialog and the prompt dialog used to be
          rendered INSIDE the "Create document" tab body. v1.120.0 put the
          three work views behind pills with the other two bodies display:
          none - so on the Documents tab the "Payment received" dialog was
          drawn inside a hidden box, `await askText()` never resolved, and
          picking "paid" did nothing at all. Delete (confirm) and every toast
          on the Documents, Receipts and Clients views were mute the same
          way. Dialogs belong to the panel, not to one of its tabs. */}
      {toastNode}
      {confirmNode}
      {promptNode}
      {/* Work precedes customer setup; hidden bodies retain unsaved drafts. */}
      {/* v1.123.0 — THE WORK, TABBED: writing a document, the documents
          themselves, and the receipts / credit notes / outstanding report -
          one at a time, in the portal's own pills. Bodies are hidden, never
          unmounted: a half-written quotation survives a look at the list. */}
      <section id="sales-work" className="erp-stack-tight erp-tab-zone scroll-mt-36" hidden={wsView !== "documents"}>
        <div className={card}>
          {/* v1.181.16 - monthly invoices whose day has come; a person
              fills the normal form from one and saves it */}
          <RecurringDue rows={crm.recurring} onFill={(id) => {
            void api<{ prefill?: Prefill; error?: { message?: string } }>(`/staff/customers/recurring/${id}/prefill`).then((r) => {
              if (r.ok && r.data?.prefill) applyPrefill(r.data.prefill);
              else showToast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Could not load that invoice", "Tidak dapat memuatkan invois itu"), "notice");
            });
          }} />
          {/* v1.191.0 - THE DOCUMENTS CARD'S HEAD AND PILLS (the owner's photo):
              Documents (All) · Quotations · Invoices · Delivery orders ·
              Receipts · Credit notes · Outstanding, one row. The first four
              filter the documents table; the last three are the receipts,
              credit notes and outstanding report (DocumentsPanel), as the
              second work tab was. Create document is the top bar's button;
              its form is the third body, as before. Every body stays mounted. */}
          {/* the head and pills stay while the form is open: a pill is the way
              back to the documents (none is lit while writing one) */}
          <div>
            <div className={sc.head}>
              <span className={sc.headIcon} aria-hidden><AppIcon name="document" /></span>
              <div className={sc.headText}>
                <p className={sc.headTitle}>{L("Documents", "Dokumen")}</p>
                <p className="erp-meta">{L("Manage quotations, invoices, delivery orders, receipts, credit notes and outstanding payments.", "Urus sebut harga, invois, pesanan penghantaran, resit, nota kredit dan bayaran tertunggak.")}</p>
              </div>
              <button type="button" className={btnSm} onClick={() => void load()}>
                <AppIcon name="refresh" />{L("Refresh", "Muat semula")}
              </button>
            </div>
            <div role="tablist" className={`erp-pill-row ${sc.pills}`}>
              {([["all", L(`Documents (All)`, `Dokumen (Semua)`)], ["QT", L("Quotations", "Sebut harga")], ["INV", L("Invoices", "Invois")], ["DO", L("Delivery orders", "Pesanan penghantaran")]] as const).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={workTab === "documents" && docType === v} className={workTab === "documents" && docType === v ? tabPillOn : tabPill}
                  onClick={() => { setWorkTab("documents"); setDocType(v); setDocPage(1); }}>{label}</button>
              ))}
              {([["receipts", L("Receipts", "Resit")], ["credit", L("Credit notes", "Nota kredit")], ["outstanding", L("Outstanding", "Tertunggak")]] as const).map(([v, label]) => (
                <button key={v} type="button" role="tab" aria-selected={workTab === "receipts" && money === v} className={workTab === "receipts" && money === v ? tabPillOn : tabPill}
                  onClick={() => { setWorkTab("receipts"); setMoney(v); }}>{label}</button>
              ))}
              {/* v1.231.0 - the packages library, beside the documents it fills */}
              <button type="button" role="tab" aria-selected={workTab === "packages"} className={workTab === "packages" ? tabPillOn : tabPill}
                onClick={() => setWorkTab("packages")}>{L("Packages", "Pakej")}</button>
            </div>
          </div>
          {workTab === "packages" && <div className="mt-3"><PackagesPanel role={user.role} /></div>}
          <div className={workTab === "create" ? "mt-3" : "hidden"}>
          <p className="text-sm font-semibold">
            {editingDoc ? (
              <>
                {editingDoc.revise
                  ? L(`Revising ${editingDoc.doc_number} — REV ${(editingDoc.revision ?? 0) + 1}`, `Menyemak semula ${editingDoc.doc_number} — REV ${(editingDoc.revision ?? 0) + 1}`)
                  : L("Editing", "Menyunting") + " " + editingDoc.doc_number}{" "}
                <button
                  type="button"
                  className="ml-1 text-xs font-normal underline"
                  onClick={resetDocForm}
                >
                  {L("cancel", "batal")}
                </button>
              </>
            ) : (
              L("Create document", "Buat dokumen")
            )}
          </p>
          {editingDoc?.revise && (
            /* v1.181.11 - said before anything is typed: what Revise does to
               the paper the customer already has. */
            <p className="erp-note erp-note-info erp-mt-2">
              {L(
                `Add or change what the customer asked for, then save. It stays ${editingDoc.doc_number}, prints as REV ${(editingDoc.revision ?? 0) + 1} dated today and valid 14 days from today, and the version the customer has now is kept in History.`,
                `Tambah atau ubah apa yang pelanggan minta, kemudian simpan. Ia kekal ${editingDoc.doc_number}, dicetak sebagai REV ${(editingDoc.revision ?? 0) + 1} bertarikh hari ini dan sah 14 hari dari hari ini, dan versi yang pelanggan ada sekarang disimpan dalam Sejarah.`
              )}
            </p>
          )}
          {/* v1.120.0 — THE FORM IS THE PAPER. The CEO, 06-09-2026: *"for Add
              customer & Create document can you make it like the actual
              format of the Invoice, Delivery Order and Quotation so that my
              staff know what they want to fill as it will help them to decide
              and fill the data correctly"*. Every control below is the one
              the form had; each now sits where its value prints - the
              letterhead and title at the top, the meta strip (sales person,
              doc no., date, valid-until / payment-due / delivery, reference),
              BILLING and DELIVERY ADDRESS side by side, the lines under the
              document's own column headers, the totals ladder on the right,
              prepared-by and acceptance at the foot. What the system fills is
              shown greyed so nobody hunts for it. Beside it, DocPreview draws
              the REAL document (the template that prints) as they type. */}
          <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
          <div className="border-border bg-card rounded-md border p-3 shadow-sm sm:p-4">
            {/* ---- letterhead + title ---- */}
            <div className="border-primary flex flex-wrap items-start justify-between gap-3 border-b-2 pb-3">
              <div className="min-w-0 flex-1">
                <p className="text-primary text-xs font-extrabold tracking-[0.12em] uppercase">{resolveIssuer(doc.issuer).name}</p>
                {/* v1.30.1 (CEO: "letterhead should all under A2Z since A2Z is
                    a main company... only under AZ ONE if it is consultancy"):
                    the entity choice, at creation only. It decides the
                    letterhead, the registration number, the SST clause AND the
                    bank account the client is told to pay — which is why the
                    amber line spells that out before anyone presses Create,
                    and why the choice is locked once the document exists. */}
                {!editingDoc ? (
                  <label className="mt-1 block">
                    <span className="text-muted-foreground mb-1 block text-[10px] tracking-wider uppercase">
                      {L("Issued by (letterhead + bank account)", "Dikeluarkan oleh (kepala surat + akaun bank)")}
                    </span>
                    <select
                      className={inputClass}
                      value={doc.issuer}
                      onChange={(e) => {
                        const v = e.target.value;
                        /* v1.181.9 (CEO: "AZ ONE OFFICIAL doesnt sell a
                           product. the description should manually insert
                           by staff instead") - choosing AZ ONE turns the
                           document into service lines. A line already
                           picked from Inventory is A2Z's stock, not AZ ONE
                           work, so it is emptied for the staff member to
                           describe; a line somebody typed is kept. */
                        setDoc((d) =>
                          v === "azoo"
                            ? {
                                ...d,
                                issuer: v,
                                kind: "service",
                                doc_type: d.doc_type === "DO" ? "QT" : d.doc_type,
                                delivery_cents: 0,
                                items: d.items.map((it) =>
                                  it.sku ? { name: "", qty: it.qty, unit_price_cents: 0 } : it
                                ),
                              }
                            : { ...d, issuer: v }
                        );
                        /* v1.231.0 - a package not offered under the new
                           issuer is let go; its lines stay as typed */
                        if (pkgRef && pkgRef.issuers && !pkgRef.issuers.includes(v)) {
                          setPkgRef(null);
                          showToast(L("Package cleared", "Pakej dikosongkan"), L(`${pkgRef.name} is not offered under this issuer. The lines stay as they are.`, `${pkgRef.name} tidak ditawarkan di bawah pengeluar ini. Baris kekal seperti sedia ada.`), "notice");
                        }
                      }}
                    >
                      <option value="a2z">
                        {L("A2Z CREATIVE MARKETING — default", "A2Z CREATIVE MARKETING — lalai")}
                      </option>
                      <option value="azoo">
                        {L("AZ ONE OFFICIAL — consultancy work", "AZ ONE OFFICIAL — kerja perundingan")}
                      </option>
                    </select>
                    {doc.issuer === "azoo" && (
                      <span className="text-warning mt-1 block text-[11px] leading-snug">
                        {L(
                          "This document will carry AZ ONE OFFICIAL's letterhead and instruct payment to AZ ONE's Maybank account. Use only for consultancy work done as AZ ONE. AZ ONE sells no products, so every line is a service you describe.",
                          "Dokumen ini akan membawa kepala surat AZ ONE OFFICIAL dan mengarahkan bayaran ke akaun Maybank AZ ONE. Guna hanya untuk kerja perundingan sebagai AZ ONE. AZ ONE tidak menjual produk, jadi setiap baris ialah perkhidmatan yang anda huraikan."
                        )}
                      </span>
                    )}
                  </label>
                ) : (
                  <p className="text-muted-foreground mt-0.5 text-[11px]">{L("Issuer is fixed once a document exists.", "Pengeluar tetap setelah dokumen wujud.")}</p>
                )}
              </div>
              <div className="w-full sm:w-auto sm:min-w-[15rem] sm:text-right">
                <p className="text-base font-extrabold tracking-[0.14em] uppercase">
                  {doc.doc_type === "QT" ? L("Quotation", "Sebut harga") : doc.doc_type === "DO" ? L("Delivery Order", "Pesanan Penghantaran") : L("Invoice", "Invois")}
                </p>
                <select
                  className={`${inputClass} mt-1`}
                  aria-label={L("Document type", "Jenis dokumen")}
                  value={doc.doc_type}
                  onChange={(e) => {
                    setDoc((d) => ({ ...d, doc_type: e.target.value }));
                    if (e.target.value !== "QT") setPkgRef(null); // v1.231.0 - a package fills quotations only
                  }}
                >
                  <option value="QT">{L("Quotation", "Sebut harga")}</option>
                  {/* v1.4.234: a Delivery Order is product-only — nothing
                      physical ships for a service, so the option hides. */}
                  {doc.kind !== "service" && (
                    <option value="DO">
                      {L("Delivery Order", "Pesanan Penghantaran")}
                    </option>
                  )}
                  {canInvoice && (
                    <option value="INV">{L("Invoice", "Invois")}</option>
                  )}
                </select>
                {/* v1.4.234 (CEO: 2 business lines — product vs service; "details
                    just filled by one details"): ONE line per document. The
                    choice tags the document, steers the item placeholder, and
                    removes Delivery Order for services. v1.27.0: the labels
                    name the KIND of line, not one client. */}
                {doc.issuer === "azoo" && doc.kind === "service" ? (
                  /* v1.181.9 - AZ ONE has one line of business, so there is
                     nothing to choose: the toggle becomes a statement. */
                  <p className="erp-note erp-note-info erp-mt-2">
                    {L(
                      "Service — consultancy work. Type each line's description.",
                      "Perkhidmatan — kerja perundingan. Taip huraian setiap baris."
                    )}
                  </p>
                ) : (
                <div className="mt-1.5 flex gap-2">
                  {(
                    [
                      ["product", "Product — client goods"],
                      ["service", "Service — agency work"],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={
                        "h-9 flex-1 rounded-lg border px-2 text-xs font-medium " +
                        (doc.kind === k
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-secondary")
                      }
                      onClick={() => {
                        if (k === "product") setPkgRef(null); // v1.231.0 - packages are service lines
                        setDoc((d) => ({
                          ...d,
                          kind: k,
                          doc_type:
                            k === "service" && d.doc_type === "DO"
                              ? "QT"
                              : d.doc_type,
                          delivery_cents: k === "service" ? 0 : d.delivery_cents,
                        }));
                      }}
                    >
                      {L(
                        label,
                        k === "product"
                          ? "Produk — barangan klien"
                          : "Perkhidmatan — kerja agensi"
                      )}
                    </button>
                  ))}
                </div>
                )}
              </div>
            </div>

            {/* ---- the meta strip, exactly the five cells the paper prints ---- */}
            <div className="border-border grid grid-cols-2 gap-x-3 gap-y-2 border-b py-3 sm:grid-cols-5">
              <label className="block">
                <span className="text-muted-foreground block text-[9px] font-semibold tracking-[0.12em] uppercase">{L("Sales person", "Jurujual")}</span>
                <select
                  className={`${inputClassSm} mt-0.5 w-full`}
                  value={doc.salesperson_id}
                  disabled={editCloserLocked}
                  onChange={(e) =>
                    setDoc((d) => ({
                      ...d,
                      salesperson_id: Number(e.target.value),
                    }))
                  }
                  title={editCloserLocked
                    ? L("Locked: a payment is recorded on this invoice. The CEO corrects the closer in Closed Sales, with a reason.", "Dikunci: bayaran telah direkodkan pada invois ini. CEO membetulkan penutup dalam Jualan Ditutup, dengan sebab.")
                    : doc.doc_type === "INV"
                    ? L("Who closed this sale - the commission follows this person", "Siapa yang menutup jualan ini - komisen mengikut orang ini")
                    : L(
                    "Captured from your login automatically — change it only when creating on someone else's behalf",
                    "Diambil daripada log masuk anda secara automatik — tukar hanya apabila membuat bagi pihak orang lain"
                  )}
                >
                  {/* v1.41.1 (CEO): the FULL name, nothing else.
                      v1.227.0 - an INVOICE names its closer (the owner's
                      answer "Require a closer"): no "me" default, the
                      person is chosen from the staff list. */}
                  {doc.doc_type === "INV" ? (
                    <option value={0} disabled>{L("Choose the closer", "Pilih penutup")}</option>
                  ) : (
                    <option value={0}>
                      {L(`${user.name} — me (auto from login)`, `${user.name} — saya (auto dari log masuk)`)}
                    </option>
                  )}
                  {staffList
                    .filter((u) => doc.doc_type === "INV" || u.name !== user.name)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </label>
              <div>
                <span className="text-muted-foreground block text-[9px] font-semibold tracking-[0.12em] uppercase">{L("Doc no.", "No. dok.")}</span>
                <p className="text-muted-foreground mt-0.5 h-8 truncate rounded-lg bg-secondary/60 px-2 py-1.5 text-xs">{editingDoc ? editingDoc.doc_number : L("auto on save", "auto semasa simpan")}</p>
              </div>
              <label className="block">
                <span className="text-muted-foreground block text-[9px] font-semibold tracking-[0.12em] uppercase">{L("Date", "Tarikh")}</span>
                <input
                  type="date"
                  className={`${inputClassSm} mt-0.5 w-full`}
                  title={editingDoc?.revise
                    ? L("A revision is dated the day it is issued. The original date stays in History.", "Semakan bertarikh hari ia dikeluarkan. Tarikh asal kekal dalam Sejarah.")
                    : L("Document date (backdate allowed)", "Tarikh dokumen (tarikh lampau dibenarkan)")}
                  disabled={editingDoc?.revise === true}
                  value={docDate}
                  max={new Date(Date.now() + 8 * 3600 * 1000)
                    .toISOString()
                    .slice(0, 10)}
                  onChange={(e) => setDocDate(e.target.value)}
                />
              </label>
              <div>
                <span className="text-muted-foreground block text-[9px] font-semibold tracking-[0.12em] uppercase">
                  {doc.doc_type === "QT" ? L("Valid until", "Sah hingga") : doc.doc_type === "INV" ? L("Payment due", "Bayaran perlu") : L("Delivery", "Penghantaran")}
                </span>
                {doc.doc_type === "INV" && doc.paid_received ? (
                  <input
                    type="date"
                    className={`${inputClassSm} mt-0.5 w-full`}
                    title={L("Payment received date", "Tarikh bayaran diterima")}
                    value={paidDate}
                    max={new Date(Date.now() + 8 * 3600 * 1000)
                      .toISOString()
                      .slice(0, 10)}
                    onChange={(e) => setPaidDate(e.target.value)}
                  />
                ) : (
                  <p className="text-muted-foreground mt-0.5 h-8 truncate rounded-lg bg-secondary/60 px-2 py-1.5 text-xs">
                    {doc.doc_type === "QT" ? L("14 days", "14 hari") : doc.doc_type === "INV" ? L("On receipt", "Semasa terima") : L("Pending", "Belum")}
                  </p>
                )}
              </div>
              <label className="block">
                <span className="text-muted-foreground block text-[9px] font-semibold tracking-[0.12em] uppercase">{L("Reference", "Rujukan")}</span>
                {/* v1.4.243: the buyer's own reference prints in the meta
                    strip — "N/A" when blank. */}
                <input
                  className={`${inputClassSm} mt-0.5 w-full`}
                  placeholder={L("their PO no. — or N/A", "no. PO mereka — atau N/A")}
                  maxLength={60}
                  value={doc.reference}
                  onChange={(e) =>
                    setDoc((d) => ({ ...d, reference: e.target.value }))
                  }
                />
              </label>
            </div>

            {/* ---- the two parties, as the paper prints them ---- */}
            <div className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-[9px] font-bold tracking-[0.14em] uppercase">{L("Billing address", "Alamat bil")}</p>
                <select
                  className={`${inputClass} mt-1`}
                  aria-label={L("Customer", "Pelanggan")}
                  value={doc.customer_id}
                  onChange={(e) =>
                    setDoc((d) => ({
                      ...d,
                      customer_id: Number(e.target.value),
                    }))
                  }
                >
                  <option value={-1}>
                    {L("Choose customer…", "Pilih pelanggan…")}
                  </option>
                  <option value={0}>
                    {L("Walk-in / general buyer", "Walk-in / pembeli umum")}
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company}
                    </option>
                  ))}
                </select>
                {(() => {
                  const c = customers.find((x) => x.id === doc.customer_id);
                  if (doc.customer_id === -1) return <p className="text-muted-foreground mt-1.5 text-[11px]">{L("The company, contact, address, phone and email print here from the customer card.", "Syarikat, kenalan, alamat, telefon dan e-mel dicetak di sini daripada kad pelanggan.")}</p>;
                  if (!c) return <p className="text-muted-foreground mt-1.5 text-xs">{L("Walk-in customer — no address printed.", "Pelanggan walk-in — tiada alamat dicetak.")}</p>;
                  return (
                    <div className="mt-1.5 text-xs leading-snug">
                      <p className="font-semibold">{c.company}</p>
                      {c.contact_person && <p>{c.contact_person}</p>}
                      {c.address ? <p className="whitespace-pre-line">{c.address}</p> : <p className="text-warning">{L("No address on the customer card — add it there or the block prints as the company name alone.", "Tiada alamat pada kad pelanggan — tambah di sana atau blok dicetak sebagai nama syarikat sahaja.")}</p>}
                      {c.phone && <p>{c.phone}</p>}
                      {c.email && <p>{c.email}</p>}
                    </div>
                  );
                })()}
              </div>
              <div>
                <p className="text-muted-foreground text-[9px] font-bold tracking-[0.14em] uppercase">{doc.kind === "service" ? L("Service address", "Alamat perkhidmatan") : L("Delivery address", "Alamat penghantaran")}</p>
                {/* v1.4.243: a ship-to prints beside the billing block. A
                    service delivers nothing physical, so the box is product-only. */}
                {doc.kind === "product" ? (
                  <>
                    <textarea
                      className={`${inputClass} mt-1 min-h-[4.5rem]`}
                      aria-label={L("Delivery address (only if different)", "Alamat penghantaran (hanya jika berbeza)")}
                      placeholder={L("Leave blank — same as billing", "Biarkan kosong — sama seperti bil")}
                      maxLength={300}
                      value={doc.delivery_address}
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          delivery_address: e.target.value,
                        }))
                      }
                    />
                    <p className="text-muted-foreground mt-1 text-[11px]">{L("Blank prints as “Same as billing address”.", "Kosong dicetak sebagai “Sama seperti alamat bil”.")}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground mt-1.5 text-xs">{L("Same as billing address — work is carried out at the address on the left.", "Sama seperti alamat bil — kerja dijalankan di alamat di sebelah kiri.")}</p>
                )}
              </div>
            </div>

            {/* v1.231.0 - PACKAGE (OPTIONAL), quotations only: the active
                packages offered under this issuer. Choosing one fills the
                lines below - the same lines, the same totals, the same paper;
                "No package" is the default and a custom quotation needs none. */}
            {doc.doc_type === "QT" && (
              <div className="mb-3">
                <PackagePicker issuer={doc.issuer} applied={pkgRef}
                  hasLines={doc.items.filter((it) => it.name.trim() || it.unit_price_cents > 0).length}
                  canAdd={doc.kind === "service" || !doc.items.some((it) => it.sku)}
                  onApply={applyPackage} onClear={() => setPkgRef(null)} />
              </div>
            )}
            {/* ---- the lines, under the paper's own column headers ---- */}
            <p className="text-muted-foreground border-primary border-b pb-1 text-[9px] font-bold tracking-[0.14em] uppercase">
              {doc.kind === "service" ? L("Description of services", "Keterangan perkhidmatan") : L("Items", "Barang")}
              {doc.doc_type === "DO" && <span className="ml-2 font-medium normal-case tracking-normal">{L("prices are kept but not printed on a Delivery Order", "harga disimpan tetapi tidak dicetak pada Pesanan Penghantaran")}</span>}
            </p>
            <div className="mt-2 space-y-3">
            <div className="text-muted-foreground hidden gap-2 text-[10px] font-semibold tracking-wider uppercase sm:grid sm:grid-cols-[1fr_66px_66px_100px_100px_auto]">
              <span>{L("Description", "Keterangan")}</span>
              <span>UOM</span>
              <span>{L("Qty", "Kuantiti")}</span>
              <span>{L("Unit price (RM)", "Harga seunit (RM)")}</span>
              {/* v1.79.0: two fields called "Discount" printed in two places;
                  each now says which it is. */}
              <span>{L("Discount (RM)", "Diskaun (RM)")}</span>
              <span />
            </div>
            {doc.items.map((item, i) => {
              // one helper so every field on the line edits the same way
              const patch = (p: Partial<DocItem>) =>
                setDoc((d) => ({
                  ...d,
                  items: d.items.map((x, xi) =>
                    xi === i ? { ...x, ...p } : x
                  ),
                }));
              return (
                <div
                  key={i}
                  className="border-border grid grid-cols-2 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_66px_66px_100px_100px_auto] sm:border-0 sm:p-0"
                >
                  {doc.kind === "service" ? (
                    <input
                      className={`${inputClass} col-span-2 sm:col-span-1`}
                      placeholder={L(
                        "e.g. TikTok LIVE hosting — 8 sessions",
                        "cth. Pengacaraan TikTok LIVE — 8 sesi"
                      )}
                      value={item.name}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  ) : (
                    /* v1.41.0 (CEO: "a list of the product with the prices
                       auto filled … SKU need to be filled for the products"):
                       product lines are PICKED, not typed. Choosing an item
                       fills name + SKU + the list price in one tap; the price
                       box locks (the Worker re-resolves it from Inventory
                       anyway) and any reduction goes in Disc, where it is
                       visible on the document instead of hidden inside a
                       hand-edited price. */
                    <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-1">
                      <select
                        className={inputClass}
                        value={item.sku ?? ""}
                        title={L(
                          "Pick the product — price and SKU fill automatically from Inventory",
                          "Pilih produk — harga dan SKU diisi automatik daripada Inventori"
                        )}
                        onChange={(e) => {
                          const hit = invItems.find(
                            (it) => it.sku === e.target.value
                          );
                          if (!hit) {
                            patch({ sku: "", name: "", unit_price_cents: 0 });
                            return;
                          }
                          patch({
                            name: hit.name,
                            sku: hit.sku,
                            unit_price_cents: hit.unit_price_cents ?? 0,
                            uom: item.uom || "PCS",
                          });
                        }}
                      >
                        <option value="">
                          {invItems.some((it) => it.sku)
                            ? L("— pick a product —", "— pilih produk —")
                            : L(
                                "No products in Inventory yet — add them on the Inventory tab",
                                "Tiada produk dalam Inventori — tambah di tab Inventori"
                              )}
                        </option>
                        {invItems
                          .filter((it) => it.sku)
                          .slice()
                          .sort((a, b) => a.sku.localeCompare(b.sku))
                          .map((it) => (
                            <option key={it.sku} value={it.sku}>
                              {it.sku} — {it.name} — RM{" "}
                              {((it.unit_price_cents ?? 0) / 100).toFixed(2)}
                            </option>
                          ))}
                      </select>
                      {item.sku ? (
                        <span className="text-muted-foreground text-xs">
                          SKU <span className="font-mono">{item.sku}</span> ·{" "}
                          {L(
                            "list price locked — use Disc for any reduction",
                            "harga senarai dikunci — guna Diskaun untuk potongan"
                          )}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {/* v1.79.0 — THE HEADER ROW ABOVE IS `hidden sm:grid`, so on
                      a phone this line was four unlabelled boxes, two of them
                      reading "0.00": unit price and line discount, side by
                      side, indistinguishable. `Cell` puts the label back
                      below the sm breakpoint and gets out of the way above
                      it, where the header row already names the columns — so
                      a five-line invoice does not repeat five sets of
                      labels, and there is still exactly ONE input per field. */}
                  <RowCell t={L("UOM", "Unit")}>
                    <input
                      className={inputClass}
                      placeholder="UOM"
                      maxLength={12}
                      value={item.uom ?? ""}
                      title={L(
                        "Unit of measure — PCS, UNIT, SET, VIDEO, SESSION…",
                        "Unit ukuran — PCS, UNIT, SET, VIDEO, SESSION…"
                      )}
                      onChange={(e) =>
                        patch({ uom: e.target.value.toUpperCase() })
                      }
                    />
                  </RowCell>
                  <RowCell t={L("Qty", "Kuantiti")}>
                    <input
                      type="number"
                      min={1}
                      className={inputClass}
                      value={item.qty}
                      onChange={(e) => patch({ qty: Number(e.target.value) })}
                    />
                  </RowCell>
                  <RowCell t={L("Unit price (RM)", "Harga seunit (RM)")}>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${inputClass} ${doc.kind !== "service" && item.sku ? "opacity-70" : ""}`}
                    placeholder="0.00"
                    readOnly={doc.kind !== "service" && !!item.sku}
                    title={
                      doc.kind !== "service" && item.sku
                        ? L(
                            "List price from Inventory — change it there, or use Disc for a reduction on this document",
                            "Harga senarai daripada Inventori — ubah di sana, atau guna Diskaun untuk potongan pada dokumen ini"
                          )
                        : undefined
                    }
                    value={
                      item.unit_price_cents
                        ? (item.unit_price_cents / 100).toString()
                        : ""
                    }
                    onChange={(e) =>
                      patch({
                        unit_price_cents: Math.max(
                          0,
                          Math.round(Number(e.target.value || 0) * 100)
                        ),
                      })
                    }
                  />
                  </RowCell>
                  <RowCell t={L("Line discount (RM)", "Diskaun baris (RM)")}>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={inputClass}
                    placeholder="0.00"
                    title={L(
                      "Discount on THIS line only — it comes off this line's amount and prints in the document's DISCOUNT column. The whole-document discount below is a separate figure, printed separately.",
                      "Diskaun untuk baris INI sahaja — ia ditolak daripada jumlah baris ini dan dicetak dalam lajur DISKAUN dokumen. Diskaun seluruh dokumen di bawah ialah angka berasingan, dicetak berasingan."
                    )}
                    value={
                      item.disc_cents ? (item.disc_cents / 100).toString() : ""
                    }
                    onChange={(e) =>
                      patch({
                        disc_cents: Math.max(
                          0,
                          Math.round(Number(e.target.value || 0) * 100)
                        ),
                      })
                    }
                  />
                  </RowCell>
                  {doc.items.length > 1 ? (
                    <button
                      type="button"
                      className="text-destructive text-xs underline"
                      title={L("Remove this line", "Buang baris ini")}
                      onClick={() =>
                        setDoc((d) => ({
                          ...d,
                          items: d.items.filter((_, xi) => xi !== i),
                        }))
                      }
                    >
                      ✕
                    </button>
                  ) : (
                    <span className="w-4" />
                  )}
                  {/* v1.4.243: inclusions belong UNDER their line, not as extra
                    RM 0.00 rows — they print as bullets beneath the item.

                    v1.33.3 (CEO: "The desc on sales cant be space?! Whyyy" —
                    he typed "Testing Testing" and got "TestingTesting"). This
                    box round-trips its text through a string[] on EVERY
                    keystroke, and the old handler normalised on the way in:
                      .map(s => s.trim())  killed the space the moment it was
                                           typed, because a trailing space is
                                           leading/trailing on its own line
                      .filter(Boolean)     deleted a new blank line the moment
                                           Enter was pressed
                      .slice(0, 10)        silently dropped pasted line 11+
                    Typing is now a pure split — what you type is what is in
                    state. Tidying happens ONCE, at save (see createDoc), which
                    is the only moment it actually matters. */}
                  <textarea
                    className={`${inputClass} col-span-2 min-h-[4rem] sm:col-span-6`}
                    placeholder={L(
                      "Detail lines — one inclusion per line (optional). e.g. Storyboard",
                      "Baris butiran — satu perkara setiap baris (pilihan). cth. Storyboard"
                    )}
                    value={(item.sub ?? []).join("\n")}
                    onChange={(e) => patch({ sub: e.target.value.split("\n") })}
                  />
                </div>
              );
            })}
            {/* v1.41.0: the name-datalist is gone — product lines are picked
                from the catalogue select above (SKU + list price fill
                automatically), services are free text. */}
            {/* v1.99.2 (CEO: "for the Item / service description I want to
                add more line if require as long as not exceed to 1 page!") —
                as many lines as the work needs, and never a second page.
                The bar is the page itself: the same measurement the template
                uses (docPageFit), so what it says here is what prints. Over
                about two-thirds full the table prints tighter automatically;
                at 100% the button stops rather than letting the document
                spill onto a page whose footer and signatures are orphaned. */}
            {(() => {
              const fit = docPageFit(doc.items, doc.doc_type);
              const tone = fit.over ? "bg-danger" : fit.ratio > 0.85 ? "bg-warning" : "bg-primary";
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <button
                    type="button"
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ${fit.over || fit.room === 0
                      ? "bg-secondary text-muted-foreground cursor-not-allowed"
                      : "bg-secondary text-foreground hover:bg-secondary/70"}`}
                    disabled={fit.over || fit.room === 0}
                    title={fit.over || fit.room === 0
                      ? L("The page is full — remove a line or shorten a description to add another",
                          "Halaman penuh — buang satu baris atau pendekkan keterangan untuk menambah lagi")
                      : L("Add another item line", "Tambah satu baris lagi")}
                    onClick={() =>
                      setDoc((d) => ({
                        ...d,
                        items: [
                          ...d.items,
                          { name: "", qty: 1, unit_price_cents: 0 },
                        ],
                      }))
                    }
                  >
                    {L("+ Add line", "+ Tambah baris")}
                  </button>
                  <span className="flex min-w-[9rem] flex-1 items-center gap-2">
                    <span className="bg-secondary h-1.5 flex-1 overflow-hidden rounded-full">
                      <span className={`block h-full rounded-full transition-all ${tone}`}
                        style={{ width: `${Math.min(100, Math.round(fit.ratio * 100))}%` }} />
                    </span>
                    <span className={`text-[11px] whitespace-nowrap ${fit.over ? "text-danger font-medium" : "text-muted-foreground"}`}
                      title={L("One A4 page. Detail lines and long descriptions use it up faster than plain lines.",
                               "Satu halaman A4. Baris butiran dan keterangan panjang menggunakannya lebih cepat daripada baris biasa.")}>
                      {fit.over
                        ? L("Over one page", "Melebihi satu halaman")
                        : `${doc.items.length} ${doc.items.length === 1 ? L("line", "baris") : L("lines", "baris")} · ${L("room for", "ruang untuk")} ${fit.room} ${L("more", "lagi")}`}
                    </span>
                  </span>
                  {fit.dense && !fit.over && (
                    <span className="text-muted-foreground text-[11px]">
                      {L("prints tighter to stay on one page", "dicetak lebih padat agar kekal satu halaman")}
                    </span>
                  )}
                </div>
              );
            })()}
            </div>

            {/* ---- the totals ladder, on the right as it prints ---- */}
            <div className="mt-3 flex justify-end">
              <div className="w-full space-y-1.5 sm:w-2/3 lg:w-1/2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{L("Subtotal", "Subjumlah")}</span>
                  <span className="tabular-nums">{fmtRM(subtotal)}</span>
                </div>
                {/* v1.79.0 (CEO, on INV-AZOO280826-1: "I see why discount not
                    populated there?") — this comes off the WHOLE document and
                    prints here as "Less: discount"; a reduction on one item
                    goes in that line's Discount box and prints in the column. */}
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{L("Less: discount (whole document)", "Tolak: diskaun (seluruh dokumen)")}</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={`${inputClassSm} w-28 text-right tabular-nums`}
                    placeholder="0.00"
                    value={
                      doc.discount_cents
                        ? (doc.discount_cents / 100).toString()
                        : ""
                    }
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        discount_cents: Math.max(
                          0,
                          Math.round(Number(e.target.value || 0) * 100)
                        ),
                      }))
                    }
                  />
                </label>
                {doc.discount_cents > subtotal && (
                  <p className="text-[11px] leading-snug font-semibold text-warning">
                    {L(`More than the items come to (${fmtRM(subtotal)}) — the total would print as RM 0.00`,
                       `Lebih daripada jumlah barang (${fmtRM(subtotal)}) — jumlah akan dicetak sebagai RM 0.00`)}
                  </p>
                )}
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{L("Tax %", "Cukai %")}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    className={`${inputClassSm} w-28 text-right tabular-nums`}
                    placeholder="0"
                    value={doc.tax_percent || ""}
                    onChange={(e) =>
                      setDoc((d) => ({
                        ...d,
                        tax_percent: Number(e.target.value || 0),
                      }))
                    }
                  />
                </label>
                {/* v1.4.160 / v1.4.238: quoted on the QT, billed on the INV; a
                    Delivery Order carries goods only and a service ships
                    nothing, so the row hides for both. */}
                {doc.doc_type !== "DO" && doc.kind !== "service" && (
                  <label className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{L("Delivery / postage", "Penghantaran / pos")}</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={`${inputClassSm} w-28 text-right tabular-nums`}
                      placeholder="0.00"
                      value={
                        doc.delivery_cents
                          ? (doc.delivery_cents / 100).toString()
                          : ""
                      }
                      onChange={(e) =>
                        setDoc((d) => ({
                          ...d,
                          delivery_cents: Math.max(
                            0,
                            Math.round(Number(e.target.value || 0) * 100)
                          ),
                        }))
                      }
                    />
                  </label>
                )}
                <div className="border-primary flex items-center justify-between border-t-2 pt-1.5 text-sm font-extrabold">
                  <span>{L("TOTAL (RM)", "JUMLAH (RM)")}</span>
                  <span className="tabular-nums">{fmtRM(total)}</span>
                </div>
              </div>
            </div>
            {doc.doc_type === "INV" && canPay && (
              <label
                className="mt-3 flex items-center gap-1.5 text-sm"
                title={L(
                  "Payment already in hand (e.g. bank transfer received) — the invoice is created as PAID and counts in revenue immediately",
                  "Bayaran sudah diterima (cth. pindahan bank) — invois dibuat sebagai DIBAYAR dan terus dikira dalam hasil"
                )}
              >
                <input
                  type="checkbox"
                  checked={doc.paid_received}
                  onChange={(e) =>
                    setDoc((d) => ({ ...d, paid_received: e.target.checked }))
                  }
                />
                {L("Payment already received (bank transfer)", "Bayaran sudah diterima (pindahan bank)")}
              </label>
            )}

            {/* ---- the foot, as the paper prints it ---- */}
            <div className="border-border text-muted-foreground mt-4 grid grid-cols-2 gap-3 border-t pt-2 text-[11px]">
              <div>
                <p className="text-[9px] font-bold tracking-[0.14em] uppercase">{doc.doc_type === "INV" ? L("Authorised signature", "Tandatangan sah") : L("Prepared by", "Disediakan oleh")}</p>
                <p className="mt-0.5">{L("signs automatically on the printed document", "ditandatangan automatik pada dokumen bercetak")}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold tracking-[0.14em] uppercase">{doc.doc_type === "QT" ? L("Customer acceptance", "Penerimaan pelanggan") : doc.doc_type === "DO" ? L("Received by", "Diterima oleh") : L("Customer", "Pelanggan")}</p>
                <p className="mt-0.5">{L("name, position, date — signed by hand", "nama, jawatan, tarikh — ditandatangan tangan")}</p>
              </div>
            </div>
            <p className="text-muted-foreground mt-2 text-[10px]">{L("The SST note, bank details and footer print exactly as on the real document.", "Nota SST, butiran bank dan pengaki dicetak seperti pada dokumen sebenar.")}</p>
            {termsDue && (
              <p className="erp-note erp-note-info erp-mt-3">
                {L(`Payment due ${dmy(termsDue.on)} - this client has ${termsDue.days}-day credit terms (set in the client's File).`,
                  `Perlu dibayar ${dmy(termsDue.on)} - klien ini mempunyai terma kredit ${termsDue.days} hari (ditetapkan dalam Fail klien).`)}
              </p>
            )}
            <button
              type="button"
              className={`${btnClass} mt-3`}
              onClick={() => void createDoc()}
            >
              {editingDoc?.revise
                ? L(
                    `Issue REV ${(editingDoc.revision ?? 0) + 1}`,
                    `Keluarkan REV ${(editingDoc.revision ?? 0) + 1}`
                  )
                : editingDoc
                ? L(
                    `Update ${editingDoc.doc_number}`,
                    `Kemas kini ${editingDoc.doc_number}`
                  )
                : L("Create with auto number", "Buat dengan nombor auto")}
            </button>
          </div>
          {/* ---- the real paper, redrawn as they type ---- */}
          <DocPreview
            doc={doc}
            docDate={docDate}
            customers={customers}
            staffList={staffList}
            user={user}
            docNumber={editingDoc?.doc_number ?? null}
            revision={editingDoc ? (editingDoc.revise ? (editingDoc.revision ?? 0) + 1 : editingDoc.revision ?? 0) : 0}
            revisedAt={editingDoc?.revise ? null : editingDoc?.revised_at ?? null}
            dueDate={termsDue?.on ?? null}
          />
          </div>
          </div>
          <div className={workTab === "documents" ? "mt-3" : "hidden"}>
        {/* v1.186.0 - THE DOCUMENTS, AS A TABLE (the owner's reference,
            22-10-2026): a type pill row, a search, a status pick, and ten a
            page; one row per document - number, type, customer, date,
            amount, status, actions. The row's every control is the control
            it was (v1.4.248 onward): the number opens the detail, the
            status pick marks a payment, the buttons act. Filters only. */}
        <div className={sc.filters}>
          <label className={sc.search}>
            <AppIcon name="search" />
            <input type="search" className={inputClassSm} value={docQuery} placeholder={L("Search document number, customer or sales person…", "Cari nombor dokumen, pelanggan atau jurujual…")}
              onChange={(e) => { setDocQuery(e.target.value); setDocPage(1); }} aria-label={L("Search documents", "Cari dokumen")} />
          </label>
          <select className={selectClassSm} value={docStatus} onChange={(e) => { setDocStatus(e.target.value as typeof docStatus); setDocPage(1); }} aria-label={L("Status", "Status")}>
            <option value="all">{L("All status", "Semua status")}</option>
            <option value="unpaid">{L("Unpaid invoices", "Invois belum dibayar")}</option>
            <option value="paid">{L("Paid invoices", "Invois dibayar")}</option>
            <option value="open">{L("Open quotations", "Sebut harga terbuka")}</option>
            <option value="invoiced">{L("Invoiced quotations", "Sebut harga diinvois")}</option>
          </select>
        </div>
        {docsError && (
          <p className="mt-2 text-sm font-medium text-warning">{docsError}</p>
        )}
        {/* v1.77.0 — skeleton until the first fetch lands. */}
        {!loaded && <SkelRows rows={5} className="max-h-96" />}
        {loaded && !docsError && docs.length === 0 && (
          <p className="text-muted-foreground mt-2 text-sm">
            {L("No documents yet.", "Tiada dokumen lagi.")}
          </p>
        )}
        {loaded && docs.length > 0 && docRows.length === 0 && (
          <p className="text-muted-foreground mt-2 text-sm">
            {L("No documents match these filters.", "Tiada dokumen sepadan dengan penapis ini.")}
          </p>
        )}
        {/* v1.176.1 - the page scrolls this list, not a 384px window inside it. */}
        <div className={sc.table} role="table">
          {loaded && docRows.length > 0 && (
            <div className={`${sc.cells} ${sc.header}`} role="row">
              <span role="columnheader">{L("Document No.", "No. dokumen")}</span>
              <span role="columnheader">{L("Type", "Jenis")}</span>
              <span role="columnheader">{L("Customer", "Pelanggan")}</span>
              <span role="columnheader">{L("Date", "Tarikh")}</span>
              <span role="columnheader" className={sc.cAmt}>{L("Amount (RM)", "Jumlah (RM)")}</span>
              <span role="columnheader">{L("Status", "Status")}</span>
              <span role="columnheader">{L("Actions", "Tindakan")}</span>
            </div>
          )}
          {loaded && pageDocs.map((d) => (
            <div
              key={d.id}
              data-record={`document:${d.id}`}
              className={sc.row}
              role="row"
            >
              <div className={sc.cells}>
                {/* v1.4.248 (CEO: "a minimalist version … click at the document
                number can appear the details. the button remain at outside"):
                the row carries only what identifies the document. Status
                chips, the payment/delivery pickers and the dates live in the
                panel below, opened by clicking the number. Actions stay on
                the row so nothing needs opening to be done. */}
                <span className={sc.cDoc} role="cell">
                  <RecordToggle
                    open={openDoc === d.id}
                    title={L(
                      "Payment, dates and reference",
                      "Bayaran, tarikh dan rujukan"
                    )}
                    onToggle={() => setOpenDoc(openDoc === d.id ? null : d.id)}
                  >
                    {d.doc_number}
                  </RecordToggle>
                  <RevisionChip revision={d.revision} />
                  {d.doc_type === "INV" && d.payment_status !== "paid" && (
                    <PartPaidChip totalCents={d.total_cents} receivedCents={partPaid[d.id]} />
                  )}
                  {/* v1.30.1 — which entity's letterhead this document carries.
                  Only the exception is tagged: A2Z is the default and a chip
                  on every row would be noise. NULL (legacy) and "azoo" both
                  render AZ ONE, so both get the tag — one glance answers
                  "whose bank account is this client paying?". */}
                  {(d.issuer_code ?? null) !== "a2z" && (
                    <span
                      className="bg-secondary ml-1 rounded-full px-1.5 py-0.5 align-middle text-[10px] font-medium"
                      title={L(
                        "Issued under AZ ONE OFFICIAL — AZ ONE letterhead and bank account",
                        "Dikeluarkan di bawah AZ ONE OFFICIAL — kepala surat dan akaun bank AZ ONE"
                      )}
                    >
                      AZ ONE
                    </span>
                  )}
                  {d.kind && (
                    <span
                      title={
                        d.kind === "service"
                          ? L("Service document", "Dokumen perkhidmatan")
                          : L("Product document", "Dokumen produk")
                      }
                    >
                      {" "}
                      <AppIcon name={d.kind === "service" ? "service" : "package"} className="h-3.5 w-3.5" />
                    </span>
                  )}
                </span>
                <span className={sc.cType} role="cell">
                  <span className={`erp-chip erp-chip-sm ${d.doc_type === "INV" ? "erp-chip-info" : d.doc_type === "QT" ? "erp-chip-warning" : "erp-chip-neutral"}`}>
                    {{ QT: L("Quotation", "Sebut harga"), INV: L("Invoice", "Invois"), DO: L("Delivery order", "Pesanan penghantaran") }[d.doc_type] ?? d.doc_type}
                  </span>
                </span>
                <span className={sc.cCust} role="cell" title={d.company}><AppIcon name="person" className={sc.custIcon} />{d.company}</span>
                <span className={`erp-num ${sc.cDate}`} role="cell">{dmy(d.created_at.slice(0, 10))}</span>
                <span className={`erp-num ${sc.cAmt}`} role="cell">{fmtRM(d.total_cents)}</span>
                {/* STATUS: the payment pick on an invoice, the delivery pick
                    on a DO, the invoiced chip on a quotation - exactly the
                    controls the row had, in their own column */}
                <span className={sc.cStatus} role="cell">
                  {d.doc_type === "INV" && canPay && (
                    <select
                      className={selectClassSm}
                      value={d.payment_status ?? "unpaid"}
                      title={L(
                        "Mark paid when the bank transfer lands — revenue counts payments received",
                        "Tanda dibayar apabila pindahan bank diterima — hasil mengira bayaran diterima"
                      )}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "paid") {
                          void (async () => {
                            /* v1.4.250: the DATE the money actually landed, not the
                          moment the box was ticked. Revenue counts invoices by
                          paid_at, so a Friday transfer entered on Monday used
                          to land in the wrong day — and, at a month boundary,
                          the wrong month. Defaults to today, capped at today. */
                            const today = mytToday();
                            const got = await askText({
                              title: L("Payment received", "Bayaran diterima"),
                              message: `${d.doc_number} — ${fmtRM(d.total_cents)}`,
                              label: L(
                                "Bank transfer reference (optional)",
                                "Rujukan pindahan bank (pilihan)"
                              ),
                              placeholder: L(
                                "e.g. MBB240726-8891",
                                "cth. MBB240726-8891"
                              ),
                              confirmLabel: L("Mark paid", "Tanda dibayar"),
                              date: {
                                label: L(
                                  "Date the payment was received",
                                  "Tarikh bayaran diterima"
                                ),
                                initial: today,
                                max: today,
                              },
                            });
                            if (got === null) return; // cancelled — status unchanged
                            await setStatus(
                              d,
                              "paid",
                              got.value || undefined,
                              got.date || undefined
                            );
                          })();
                        } else {
                          void setStatus(d, v);
                        }
                      }}
                    >
                      {["unpaid", "paid", "overdue"].map((sx) => (
                        <option key={sx} value={sx}>
                          {payStatusL(sx)}
                        </option>
                      ))}
                    </select>
                  )}
                  {d.doc_type === "DO" && (
                    <select
                      className={selectClassSm}
                      value={d.delivery_status ?? "pending"}
                      onChange={(e) => void setStatus(d, e.target.value)}
                    >
                      {["pending", "delivered"].map((sx) => (
                        <option key={sx} value={sx}>
                          {payStatusL(sx)}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* v1.154.0 (CEO: "the QT which is already click Invoice
                      should be updated as a sales! then Quotation should not
                      allowed twice Invoice generate!"): a quotation that has
                      become an invoice says so and offers no second click. */}
                  {d.doc_type === "QT" && d.invoiced_as && (
                    <span className="inline-flex h-7 items-center rounded-full bg-success-soft px-2.5 text-xs font-medium text-success"
                      title={L(`Invoiced as ${d.invoiced_as} — this quotation is a sale now. Undo on the invoice reopens it.`, `Diinvois sebagai ${d.invoiced_as} — sebut harga ini kini jualan. Batalkan pada invois untuk membukanya semula.`)}>
                      <AppIcon name="success" className="mr-1 h-3.5 w-3.5" />{L("Invoiced", "Diinvois")} · {d.invoiced_as}
                    </span>
                  )}
                  {d.doc_type === "QT" && !d.invoiced_as && (
                    <span className={chipSmNeutral}>
                      {L("Open", "Terbuka")}
                    </span>
                  )}
                  {d.doc_type === "INV" && !canPay && (
                    <span className={d.payment_status === "paid" ? "erp-chip erp-chip-sm erp-chip-success" : "erp-chip erp-chip-sm erp-chip-warning"}>
                      {payStatusL(d.payment_status ?? "unpaid")}
                    </span>
                  )}
                </span>
                {/* ACTIONS: the same buttons, the same gates (v1.181.4's
                    phone rule still holds - the buttons sit together) */}
                <span className={`erp-row-actions ${sc.cActions}`} role="cell">
                  {d.doc_type === "QT" && !d.invoiced_as && canInvoice && (
                    <button
                      type="button"
                      className={rowBtnPrimary}
                      title={L(
                        "One click Quotation → Invoice: same items, customer and sales person, fresh INV number",
                        "Satu klik Sebut harga → Invois: barang, pelanggan dan jurujual sama, nombor INV baharu"
                      )}
                      onClick={async () => {
                        const res = await api<{
                          id?: number;
                          doc_number?: string;
                          stock?: Parameters<typeof stockToastLine>[0];
                          error?: { message?: string };
                        }>(`/staff/docs/${d.id}/convert`, {
                          method: "POST",
                          body: JSON.stringify({}),
                        });
                        if (!res.ok || !res.data?.id) {
                          showToast(
                            L("No changes", "Tiada perubahan"),
                            res.data?.error?.message ??
                              L(
                                "Conversion failed — check access",
                                "Penukaran gagal — semak akses"
                              ),
                            "notice"
                          );
                          return;
                        }
                        showToast(
                          L("Saved", "Disimpan"),
                          `${d.doc_number} → ${res.data.doc_number}${stockToastLine(res.data.stock)}`
                        );
                        await load();
                        void printDoc(res.data.id);
                      }}
                    >
                      → {L("Invoice", "Invois")}
                    </button>
                  )}
                  {/* v1.4.233 (CEO: "reversal button … if accidentally click
                invoice"): only on an INV that came from a QT and is still
                unpaid — a paid invoice can never be reversed. Deletes the
                accidental invoice; the quotation stands untouched. */}
                  {d.doc_type === "INV" &&
                    d.converted_from != null &&
                    d.payment_status !== "paid" &&
                    canInvoice && (
                      <button
                        type="button"
                        className={rowBtnWarning}
                        title={L(
                          "Undo the Quotation → Invoice click: deletes this unpaid invoice; the quotation is untouched",
                          "Batalkan klik Sebut harga → Invois: memadam invois belum dibayar ini; sebut harga tidak disentuh"
                        )}
                        onClick={async () => {
                          if (
                            !(await askConfirm({
                              title: L(
                                `Reverse ${d.doc_number}?`,
                                `Terbalikkan ${d.doc_number}?`
                              ),
                              message: L(
                                "This deletes the invoice (it was created from a quotation and is still unpaid).\nThe quotation itself is not touched.",
                                "Ini memadam invois (ia dibuat daripada sebut harga dan masih belum dibayar).\nSebut harga itu sendiri tidak disentuh."
                              ),
                              confirmLabel: L(
                                "Reverse invoice",
                                "Terbalikkan invois"
                              ),
                              variant: "danger",
                            }))
                          )
                            return;
                          const res = await api<{
                            error?: { message?: string };
                          }>(`/staff/docs/${d.id}/unconvert`, {
                            method: "POST",
                            body: JSON.stringify({}),
                          });
                          if (res.ok) {
                            showToast(
                              L("Reversed", "Diterbalikkan"),
                              L(
                                `${d.doc_number} deleted — the quotation stands`,
                                `${d.doc_number} dipadam — sebut harga kekal`
                              )
                            );
                            await load();
                          } else
                            showToast(
                              L("No changes", "Tiada perubahan"),
                              res.data?.error?.message ??
                                L("Reversal failed", "Pembalikan gagal"),
                              "notice"
                            );
                        }}
                      >
                        ↩ {L("Undo", "Batalkan")}
                      </button>
                    )}
                  {/* v1.181.11 (CEO: "add on the Quotation ... based on
                      customer request without require to create a new one
                      Quotation") - Revise keeps the number, prints REV n and
                      keeps the version the customer was sent. Only an open
                      quotation: an invoiced one has become the invoice. */}
                  {d.doc_type === "QT" && !d.invoiced_as && (
                    <button
                      type="button"
                      className={rowBtn}
                      title={L(
                        "The customer asked for a change — add or change lines on this quotation. Same number, printed as the next revision; the version they have now is kept in History.",
                        "Pelanggan minta perubahan — tambah atau ubah baris pada sebut harga ini. Nombor sama, dicetak sebagai semakan seterusnya; versi yang mereka ada sekarang disimpan dalam Sejarah."
                      )}
                      onClick={() => void openInForm(d, true)}
                    >
                      {L("Revise", "Semak semula")}
                    </button>
                  )}
                  <button
                    type="button"
                    className={rowBtn}
                    title={L(
                      "Fix a typo — loads the document into the form; the number never changes",
                      "Betulkan silap taip — memuatkan dokumen ke dalam borang; nombor tidak berubah"
                    )}
                    onClick={() => void openInForm(d, false)}
                  >
                    {L("Edit", "Sunting")}
                  </button>
                  <button
                    type="button"
                    className={rowBtn}
                    onClick={() => void printDoc(d.id)}
                  >
                    PDF
                  </button>
                  {/* v1.4.258: NOT primary. A quotation row already has → Invoice
                filled, and v1.4.253's own rule is at most ONE fill per row —
                two dark blocks and neither reads as the main action. */}
                  {/* v1.181.17 - over the CEO's approval limit (only when he has
                      set one): the CEO approves here, anyone else waits */}
                  {awaiting(d) ? (
                    qa.can_approve ? (
                      <button
                        type="button"
                        className={rowBtn}
                        onClick={() => {
                          void api<{ error?: { message?: string } }>(`/staff/docs/${d.id}/approve`, { method: "POST", body: "{}" }).then((r) => {
                            if (r.ok) { showToast(L("Saved", "Disimpan"), L(`${d.doc_number} approved — it can be sent`, `${d.doc_number} diluluskan — boleh dihantar`)); void load(); }
                            else showToast(L("No changes", "Tiada perubahan"), r.data?.error?.message ?? L("Not approved", "Tidak diluluskan"), "notice");
                          });
                        }}
                      >
                        {L("Approve", "Luluskan")}
                      </button>
                    ) : (
                      <span className={chipSmNeutral} title={L("Over the CEO's approval limit — it can be sent once he approves it", "Melebihi had kelulusan CEO — boleh dihantar selepas beliau meluluskannya")}>
                        {L("Awaiting CEO approval", "Menunggu kelulusan CEO")}
                      </span>
                    )
                  ) : (
                  <button
                    type="button"
                    className={rowBtn}
                    title={L(
                      "Send the PDF to the customer — opens your phone's share sheet with the file attached",
                      "Hantar PDF kepada pelanggan — membuka helaian kongsi telefon anda dengan fail dilampirkan"
                    )}
                    onClick={() => void shareDoc(d)}
                  >
                    {L("Send PDF", "Hantar PDF")}
                  </button>
                  )}
                  {/* v1.4.237 (CEO): delete with confirm; a PAID invoice is
                refused by the server. Aging recomputes from this list, so
                a deleted unpaid invoice drops out of it immediately. */}
                  {canInvoice && (
                    <button
                      type="button"
                      className={rowBtnDanger}
                      onClick={async () => {
                        if (
                          !(await askConfirm({
                            title: L(
                              `Delete ${d.doc_number}?`,
                              `Padam ${d.doc_number}?`
                            ),
                            message: L(
                              `${d.doc_type === "INV" ? "It will disappear from Documents and from Outstanding invoices — aging." : "It will disappear from Documents."}\nThis cannot be undone.`,
                              `${d.doc_type === "INV" ? "Ia akan hilang daripada Dokumen dan daripada Invois tertunggak — usia." : "Ia akan hilang daripada Dokumen."}\nIni tidak boleh dibatalkan.`
                            ),
                            confirmLabel: L("Delete document", "Padam dokumen"),
                            variant: "danger",
                          }))
                        )
                          return;
                        const res = await api<{ error?: { message?: string } }>(
                          `/staff/docs/${d.id}`,
                          { method: "DELETE" }
                        );
                        if (res.ok) {
                          showToast(
                            L("Deleted", "Dipadam"),
                            L(
                              `${d.doc_number} removed`,
                              `${d.doc_number} dibuang`
                            )
                          );
                          await load();
                        } else
                          showToast(
                            L("No changes", "Tiada perubahan"),
                            res.data?.error?.message ??
                              L("Delete refused", "Padam ditolak"),
                            "notice"
                          );
                      }}
                    >
                      {L("Delete", "Padam")}
                    </button>
                  )}
                </span>
              </div>
              {openDoc === d.id && (
                <DetailGrid
                  items={[
                    {
                      label: L("Type", "Jenis"),
                      value: `${{ QT: L("Quotation", "Sebut harga"), INV: L("Invoice", "Invois"), DO: L("Delivery Order", "Pesanan Penghantaran") }[d.doc_type] ?? d.doc_type}${d.kind ? ` · ${d.kind === "service" ? L("Service", "Perkhidmatan") : L("Product", "Produk")}` : ""}`,
                    },
                    {
                      label: L("Date", "Tarikh"),
                      value: dmy(d.created_at.slice(0, 10)),
                    },
                    /* v1.231.0 - the package it was made from: history only */
                    ...(d.package_id
                      ? [{
                          label: L("Package", "Pakej"),
                          value: L(`#${d.package_id} · v${d.package_version ?? 1}${d.package_customized ? " · customized" : " · as packaged"}`, `#${d.package_id} · v${d.package_version ?? 1}${d.package_customized ? " · diubah suai" : " · seperti pakej"}`),
                        }]
                      : []),
                    /* v1.181.13 - part payments on an invoice: recorded and
                       shown, never marking it paid */
                    ...(d.doc_type === "INV"
                      ? [{
                          label: L("Part payments", "Bayaran separa"),
                          wide: true,
                          value: <InvoicePayments docId={d.id} onChanged={() => void load()} />,
                        }]
                      : []),
                    /* v1.181.16 - what the customer accepted on the shared
                       link: recorded, never a status */
                    ...(d.doc_type === "QT"
                      ? [{
                          label: L("Customer acceptance", "Penerimaan pelanggan"),
                          wide: true,
                          value: <QuotationAcceptance docId={d.id} revision={d.revision ?? 0} />,
                        }]
                      : []),
                    /* v1.181.11 - every version a revised quotation replaced,
                       each printable as the customer received it */
                    ...((d.revision ?? 0) > 0
                      ? [{
                          label: L("Revisions", "Semakan"),
                          wide: true,
                          value: (
                            <DocRevisions
                              docId={d.id}
                              docNumber={d.doc_number}
                              revision={d.revision ?? 0}
                              revisedAt={d.revised_at}
                              totalCents={d.total_cents}
                            />
                          ),
                        }]
                      : []),
                    {
                      label: L("Sales person", "Jurujual"),
                      value: d.salesperson_name
                        ? firstName(d.salesperson_name)
                        : "",
                    },
                    {
                      label: L("Customer phone", "Telefon pelanggan"),
                      value: d.customer_phone ?? "",
                    },
                    {
                      label: L("Payment", "Bayaran"),
                      wide: true,
                      value:
                        d.doc_type !== "INV" ? (
                          ""
                        ) : d.payment_status === "paid" ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-success">
                              {L(
                                "PAID · bank transfer",
                                "DIBAYAR · pindahan bank"
                              )}
                            </span>
                            {d.paid_at && (
                              <span className="text-muted-foreground">
                                {dmy(d.paid_at.slice(0, 10))}
                              </span>
                            )}
                            {d.payment_ref && (
                              <span className="text-muted-foreground">
                                {L("Ref", "Ruj")} {d.payment_ref}
                              </span>
                            )}
                            {/* v1.4.250: the date is correctable without unmarking the
                      invoice — unmarking would clear the reference too. */}
                            {canInvoice && (
                              <button
                                type="button"
                                className="underline"
                                title={L(
                                  "Correct the date the payment was received",
                                  "Betulkan tarikh bayaran diterima"
                                )}
                                onClick={async () => {
                                  const today = mytToday();
                                  const got = await askText({
                                    title: L(
                                      "Correct the payment date",
                                      "Betulkan tarikh bayaran"
                                    ),
                                    message: `${d.doc_number} — ${fmtRM(d.total_cents)}`,
                                    label: L(
                                      "Bank transfer reference (optional)",
                                      "Rujukan pindahan bank (pilihan)"
                                    ),
                                    initial: d.payment_ref ?? "",
                                    confirmLabel: L("Save", "Simpan"),
                                    date: {
                                      label: L(
                                        "Date the payment was received",
                                        "Tarikh bayaran diterima"
                                      ),
                                      initial: d.paid_at
                                        ? d.paid_at.slice(0, 10)
                                        : today,
                                      max: today,
                                    },
                                  });
                                  if (got === null) return;
                                  await setStatus(
                                    d,
                                    "paid",
                                    got.value || undefined,
                                    got.date || undefined
                                  );
                                }}
                              >
                                ✎ {L("change date", "tukar tarikh")}
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="text-warning">
                            {payStatusL(d.payment_status ?? "unpaid")}
                          </span>
                        ),
                    },
                    {
                      label: L("Origin", "Asal"),
                      wide: true,
                      value:
                        d.converted_from != null
                          ? L(
                              "Converted from a quotation",
                              "Ditukar daripada sebut harga"
                            )
                          : "",
                    },
                  ]}
                />
              )}
            </div>
          ))}
        </div>
        {loaded && docRows.length > 0 && (
          <div className={sc.foot}>
            <span className="erp-meta">{L(`Showing ${(docPageSafe - 1) * DOC_PER + 1}–${Math.min(docPageSafe * DOC_PER, docRows.length)} of ${docRows.length} documents`, `Menunjukkan ${(docPageSafe - 1) * DOC_PER + 1}–${Math.min(docPageSafe * DOC_PER, docRows.length)} daripada ${docRows.length} dokumen`)}</span>
            {docPages > 1 && (
              /* v1.191.0 - numbered pages (the owner's photo) */
              <nav className={sc.pager} aria-label={L("Pages", "Halaman")}>
                <button type="button" className={sc.pageBtn} disabled={docPageSafe <= 1} onClick={() => setDocPage(docPageSafe - 1)} aria-label={L("Previous page", "Halaman sebelumnya")}><AppIcon name="previous" /></button>
                {(docPages <= 7 ? Array.from({ length: docPages }, (_, k) => k + 1)
                  : [1, ...(docPageSafe > 3 ? [0] : []), ...[docPageSafe - 1, docPageSafe, docPageSafe + 1].filter((n) => n > 1 && n < docPages), ...(docPageSafe < docPages - 2 ? [-1] : []), docPages]
                ).map((n) => n <= 0
                  ? <span key={`gap${n}`} className="erp-meta" aria-hidden>…</span>
                  : <button key={n} type="button" className={n === docPageSafe ? `${sc.pageBtn} ${sc.pageOn}` : sc.pageBtn} aria-current={n === docPageSafe ? "page" : undefined} onClick={() => setDocPage(n)}>{n}</button>)}
                <button type="button" className={sc.pageBtn} disabled={docPageSafe >= docPages} onClick={() => setDocPage(docPageSafe + 1)} aria-label={L("Next page", "Halaman seterusnya")}><AppIcon name="next" /></button>
              </nav>
            )}
            <select className={`${selectClassSm} ${sc.per}`} value={DOC_PER} aria-label={L("Documents per page", "Dokumen setiap halaman")}
              onChange={(e) => { setDocPer(Number(e.target.value)); setDocPage(1); }}>
              {[10, 25, 50].map((n) => <option key={n} value={n}>{L(`${n} / page`, `${n} / halaman`)}</option>)}
            </select>
          </div>
        )}
          {/* v1.181.17 - the CEO's own switch; renders for nobody else.
              v1.191.0 - under the table: it is a setting, not a filter */}
          <div className={sc.setting}><QuoteApprovalLimit qa={qa} onChanged={() => void load()} /></div>
          </div>
          <div className={workTab === "receipts" ? "mt-3" : "hidden"}>
            {/* v1.191.0 - Outstanding: the aging list (v1.4.101, moved here
                from the documents body with its WhatsApp reminders) above the
                outstanding report; Receipts and Credit notes: their lists */}
            {money === "outstanding" && (<>
      {(() => {
        // v1.4.101: overdue invoice aging 30/60/90 + WhatsApp reminder link.
        const todayMs = Date.now() + 8 * 3600 * 1000;
        const unpaid = docs.filter(
          (d) => d.doc_type === "INV" && d.payment_status !== "paid"
        );
        if (unpaid.length === 0) return null;
        const age = (d: SalesDoc) =>
          Math.floor(
            (todayMs -
              new Date(d.created_at.slice(0, 10) + "T00:00:00Z").getTime()) /
              86400000
          );
        const bucket = (n: number) =>
          n <= 30
            ? [L("1–30 days","1–30 hari"),"bg-warning-soft text-warning"]
            : n <= 60
              ? [L("31–60 days","31–60 hari"),"bg-warning-soft text-warning"]
              : n <= 90
                ? [L("61–90 days","61–90 hari"),"bg-danger-soft text-danger"]
                : [L("90+ days","90+ hari"),"bg-danger-soft text-danger"];
        return (
          <div className={card}>
            <PanelTitle icon="pending">
              {L("Outstanding invoices — aging", "Invois tertunggak — usia")}
            </PanelTitle>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {L(
                "Unpaid invoices by age. WhatsApp opens a pre-written reminder with the invoice number, amount and bank details.",
                "Invois belum dibayar mengikut usia. WhatsApp membuka peringatan sedia tulis dengan nombor invois, amaun dan butiran bank."
              )}
            </p>
            <div className="mt-2 space-y-1.5">
              {unpaid
                .sort((a, b) => age(b) - age(a))
                .map((d) => {
                  const n = age(d);
                  const [label, cls] = bucket(n);
                  const phone = (d.customer_phone ?? "").replace(/[^0-9]/g, "");
                  /* v1.28.0: the chase names the INVOICE's issuer and ITS bank
                   account — the customer must pay the entity that invoiced
                   them, so a legacy AZ ONE invoice keeps AZ ONE's account and
                   an A2Z invoice names A2Z's (resolveIssuer on the row). */
                  const iss = resolveIssuer(d.issuer_code);
                  const msg = encodeURIComponent(
                    `Hi! Gentle reminder from ${iss.name} — invoice ${d.doc_number} (${fmtRM(d.total_cents)}) is still outstanding. Kindly settle by bank transfer to ${bankTransferLine(iss)}, quoting the invoice number. Thank you!`
                  );
                  return (
                    <div
                      key={d.id}
                      className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-1.5 text-sm last:border-0"
                    >
                      <span className="min-w-0 flex-1 basis-56">
                        <span className="font-medium">{d.doc_number}</span>
                        {d.kind && (
                          <span
                            title={
                              d.kind === "service"
                                ? L("Service document", "Dokumen perkhidmatan")
                                : L("Product document", "Dokumen produk")
                            }
                          >
                            {" "}
                            <AppIcon name={d.kind === "service" ? "service" : "package"} className="h-3.5 w-3.5" />
                          </span>
                        )}{" "}
                        · {d.company} · {fmtRM(d.total_cents)}
                        <span className="text-muted-foreground">
                          {" "}
                          · {n} {L("days", "hari")}
                        </span>
                        <PartPaidChip totalCents={d.total_cents} receivedCents={partPaid[d.id]} />
                      </span>
                      <span className="erp-row-actions">
                        <span
                          className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold ${cls}`}
                        >
                          {label}
                        </span>
                        {phone ? (
                          <a
                            className={rowBtnGood}
                            target="_blank"
                            rel="noreferrer"
                            href={`https://wa.me/${phone.startsWith("60") ? phone : "6" + phone}?text=${msg}`}
                          >
                            {L("WhatsApp reminder", "Peringatan WhatsApp")}
                          </a>
                        ) : (
                          <span
                            className="text-muted-foreground inline-flex h-7 items-center text-xs"
                            title={L(
                              "Add a phone number on the customer record to enable one-tap reminders",
                              "Tambah nombor telefon pada rekod pelanggan untuk membolehkan peringatan satu sentuhan"
                            )}
                          >
                            {L("no phone", "tiada telefon")}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })()}
            </>)}
            {isValidElement(workExtra) ? cloneElement(workExtra as ReactElement<{ view?: string }>, { view: money }) : workExtra}
          </div>
        </div>
      </section>
      {wsView === "customers" && (
        <>
          <div className={sc.scopeRow}><ScopeSwitch scope={scope} onChange={setScope} /></div>
          {/* v1.216.0 - new enquiries from the website and customer accounts
              (the owner, 28-10-2026: "Show on Sales, notify"); the server
              decides who may see them (enquiry_manage) */}
          <SalesEnquiries scope={scope} userId={user.id} onQuote={(e: Enquiry) => {
            /* v1.225.0 (the owner, 29-10-2026: "Enquiry owner -> closer") - the
               consultant the enquiry is assigned to is the quotation's closer
               from the start (still changeable on the form) */
            applyPrefill({ source: "enquiry", company: (e.company ?? "").trim() || e.name, contact_person: e.name, phone: e.phone ?? "", reference: `Enquiry #${e.id}`, salesperson_id: e.assigned_to ?? undefined });
            if (customers.some((c) => c.company.trim().toLowerCase() === ((e.company ?? "").trim() || e.name).toLowerCase())) setWsView("documents");
          }} />
          <FollowUps all rows={sFollowups} today={mytToday()} onOpen={(f) => openCustomerFile(f.customer_id, f.company, () => void load())} />
        </>
      )}
      <section id="sales-customers" className="erp-stack-tight erp-tab-zone scroll-mt-36" hidden={wsView !== "customers"}>
        <ZoneLabel>{L("Customers", "Pelanggan")}</ZoneLabel>
        <div className={card}>
          <SectionTabs value={custTab} onChange={setCustTab} tabs={[
            ["clients", L("Clients", "Pelanggan")],
            ["add", L("Add customer", "Tambah pelanggan")],
          ] as const} />
          <div className={custTab === "add" ? "mt-3" : "hidden"}>
          <p className="text-sm font-semibold">
            {editingCust ? (
              <>
                {L("Editing", "Menyunting")} {editingCust.company}{" "}
                <button
                  type="button"
                  className="ml-1 text-xs font-normal underline"
                  onClick={() => {
                    setEditingCust(null);
                    setCust({
                      company: "",
                      contact_person: "",
                      phone: "",
                      email: "",
                      address: "",
                      website: "",
                    });
                  }}
                >
                  {L("cancel", "batal")}
                </button>
              </>
            ) : (
              L("Add customer", "Tambah pelanggan")
            )}
          </p>
          {/* v1.120.0 — THE BILLING BLOCK. The fields a document prints, in the
              order and the frame it prints them (BILLING ADDRESS on every
              Quotation, DO and Invoice for this customer), and under a
              dashed line the two the portal keeps for itself. The CEO,
              06-09-2026: make the form "like the actual format" so staff
              know what to fill. Same fields, same handlers. */}
          <div className="mt-3 space-y-3">
            <div className="border-border bg-card rounded-md border p-3 shadow-sm">
              <p className="text-muted-foreground text-[9px] font-bold tracking-[0.14em] uppercase">
                {L("Billing address — prints on every document for this customer", "Alamat bil — dicetak pada setiap dokumen untuk pelanggan ini")}
              </p>
              <div className="mt-2 space-y-2">
                <Sub t={L("Company *", "Syarikat *")}>
              <input
                className={inputClass}
                placeholder={L(
                  "e.g. Acme Retail Sdn Bhd",
                  "cth. Acme Retail Sdn Bhd"
                )}
                value={cust.company}
                onChange={(e) =>
                  setCust((c) => ({ ...c, company: e.target.value }))
                }
              />
            </Sub>
                <Sub t={L("Contact person", "Orang hubungan")}>
                <input
                  className={inputClass}
                  placeholder={L("Full name", "Nama penuh")}
                  value={cust.contact_person}
                  onChange={(e) =>
                    setCust((c) => ({ ...c, contact_person: e.target.value }))
                  }
                />
              </Sub>
                <Sub t={L("Address", "Alamat")}>
              {/* v1.4.235: prints on the customer's documents. */}
              <textarea
                className={`${inputClass} min-h-16`}
                placeholder={
                  "No. 12, Jalan Contoh 3/4,\nTaman Contoh, 81200 Johor Bahru, Johor"
                }
                value={cust.address}
                onChange={(e) =>
                  setCust((c) => ({ ...c, address: e.target.value }))
                }
              />
            </Sub>
                <div className="grid grid-cols-2 gap-2">
                  <Sub t={L("Phone", "Telefon")}>
                <input
                  className={inputClass}
                  placeholder="+60 12-345 6789"
                  value={cust.phone}
                  onChange={(e) =>
                    setCust((c) => ({ ...c, phone: e.target.value }))
                  }
                />
              </Sub>
                  <Sub t={L("Email", "E-mel")}>
              <input
                className={inputClass}
                placeholder="name@company.com"
                value={cust.email}
                onChange={(e) =>
                  setCust((c) => ({ ...c, email: e.target.value }))
                }
              />
            </Sub>
                </div>
              </div>
              <p className="text-muted-foreground mt-2 text-[11px] leading-snug">
                {L("Company, contact, address, phone, email — top to bottom, as the block prints. The state at the end of the address is what places this customer on the Sales map.",
                   "Syarikat, kenalan, alamat, telefon, e-mel — atas ke bawah, seperti blok dicetak. Negeri di hujung alamat ialah yang menempatkan pelanggan ini pada peta Jualan.")}
              </p>
            </div>
            <div className="border-border rounded-md border border-dashed p-3">
              <p className="text-muted-foreground text-[9px] font-bold tracking-[0.14em] uppercase">{L("Not printed — for the portal only", "Tidak dicetak — untuk portal sahaja")}</p>
              <div className="mt-2 space-y-2">
                {/* v1.30.0 (CEO: "customer or client can have a option to click
                    on their logo then will redirecting to their own domain"):
                    the client's OWN address on the web, and their own mark. */}
                <Sub t={L("Their website", "Laman web mereka")}>
              <input
                className={inputClass}
                placeholder="https://theirbrand.my"
                value={cust.website}
                onChange={(e) =>
                  setCust((c) => ({ ...c, website: e.target.value }))
                }
              />
            </Sub>
                {editingCust && (
              <Sub t={L("Their logo", "Logo mereka")}>
                <span className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const row = customers.find((c) => c.id === editingCust.id);
                    return row?.logo_key ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/v1/media/file/${encodeURIComponent(row.logo_key)}`}
                        alt={row.company}
                        className="border-border h-8 w-auto rounded border bg-white p-0.5"
                      />
                    ) : null;
                  })()}
                  <label className={`${btnSm} cursor-pointer`}>
                    {logoBusy === editingCust.id
                      ? L("Uploading…", "Memuat naik…")
                      : L("Upload logo", "Muat naik logo")}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        setLogoBusy(editingCust.id);
                        const r = await api<{ error?: { message?: string } }>(
                          `/staff/customers/${editingCust.id}/logo`,
                          {
                            method: "POST",
                            body: f,
                            headers: { "Content-Type": f.type },
                          }
                        );
                        setLogoBusy(null);
                        if (!r.ok) {
                          showToast(
                            L("No changes", "Tiada perubahan"),
                            r.data?.error?.message ??
                              L("Upload failed", "Muat naik gagal"),
                            "notice"
                          );
                          return;
                        }
                        showToast(
                          L("Saved", "Disimpan"),
                          L(
                            `${editingCust.company} logo updated`,
                            `Logo ${editingCust.company} dikemas kini`
                          )
                        );
                        void load();
                      }}
                    />
                  </label>
                  <span className="text-muted-foreground text-[11px]">
                    {L(
                      "PNG, JPG, WEBP or SVG. Shown to this client in their own area, linking to their website.",
                      "PNG, JPG, WEBP atau SVG. Dipaparkan kepada klien ini di ruangan mereka, memaut ke laman web mereka."
                    )}
                  </span>
                </span>
              </Sub>
            )}

              </div>
            </div>
            <button
              type="button"
              className={btnClass}
              onClick={() => void addCustomer()}
            >
              {editingCust
                ? L("Update customer", "Kemas kini pelanggan")
                : L("Save customer", "Simpan pelanggan")}
            </button>
          </div>
          {/* v1.181.16 - filter the clients by a tag from their files */}
          {crm.tags.length > 0 && (
            <label className={`${bizCss.field} erp-mt-3`}>{L("Show clients tagged", "Papar klien bertag")}
              <select className={selectClassSm} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="">{L("Every client", "Semua klien")}</option>
                {[...new Set(crm.tags.map((t) => t.tag))].sort().map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
          <div className="mt-3 max-h-56 overflow-y-auto">
            {/* v1.77.0 — skeleton until the first fetch lands. */}
            {!loaded && <SkelRows rows={3} />}
            {loaded && customers.length === 0 && (
              <p className="text-muted-foreground text-sm">
                {L("No customers yet.", "Tiada pelanggan lagi.")}
              </p>
            )}
            {loaded && customers.filter((c) => !tagFilter || crm.tags.some((t) => t.customer_id === c.id && t.tag === tagFilter)).map((c) => (
              <div
                key={c.id}
                data-record={`client:${c.id}`}
                className="border-border border-b py-1.5 text-sm last:border-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0">
                    {/* v1.4.249: the company name opens the record — contact
                      details and both addresses were invisible in this list. */}
                    <RecordToggle
                      open={openCust === c.id}
                      title={L("Contact and addresses", "Hubungan dan alamat")}
                      onToggle={() =>
                        setOpenCust(openCust === c.id ? null : c.id)
                      }
                    >
                      {c.company}
                    </RecordToggle>
                    {c.contact_person && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {c.contact_person}
                      </span>
                    )}
                    {/* v1.181.16 - the client's tags, from its file */}
                    {crm.tags.some((t) => t.customer_id === c.id) && (
                      <span className={bizCss.tagRow}>
                        {crm.tags.filter((t) => t.customer_id === c.id).map((t) => <span key={t.tag} className={chipSmNeutral}>{t.tag}</span>)}
                      </span>
                    )}
                  </span>
                  <span className="erp-row-actions">
                    {/* v1.181.16 - contacts, tags, credit terms, follow-ups,
                        monthly invoice: beside the record, never in it */}
                    <button
                      type="button"
                      className={rowBtn}
                      title={L("Contacts, tags, credit terms, follow-ups and a monthly invoice for this client", "Orang hubungan, tag, terma kredit, susulan dan invois bulanan untuk klien ini")}
                      onClick={() => openCustomerFile(c.id, c.company, () => void load())}
                    >
                      {L("File", "Fail")}
                    </button>
                    {/* v1.181.13 - one client's whole story, in a dialog */}
                    <button
                      type="button"
                      className={rowBtn}
                      title={L(
                        "Everything with this client, newest first — documents, revisions, payments, receipts, and what your role may see of enquiries, engagements and live sessions",
                        "Semua dengan klien ini, terbaru dahulu — dokumen, semakan, bayaran, resit, dan apa yang peranan anda boleh lihat daripada pertanyaan, penglibatan dan sesi live"
                      )}
                      onClick={() => openCustomerTimeline(c.id, c.company)}
                    >
                      {L("History", "Sejarah")}
                    </button>
                    {docs.some(
                      (d) => d.doc_type === "INV" && d.company === c.company
                    ) && (
                      <button
                        type="button"
                        className={rowBtn}
                        title={L(
                          "Statement of Account — all invoices, paid + outstanding, printable",
                          "Penyata Akaun — semua invois, dibayar + tertunggak, boleh dicetak"
                        )}
                        onClick={() => printSOA(c.company, docs)}
                      >
                        SOA
                      </button>
                    )}
                    {/* v1.4.235: edit loads the record into the form above;
                      delete is refused by the server while documents exist. */}
                    <button
                      type="button"
                      className={rowBtn}
                      onClick={() => {
                        setEditingCust({ id: c.id, company: c.company });
                        setCust({
                          company: c.company,
                          contact_person: c.contact_person ?? "",
                          phone: c.phone ?? "",
                          email: c.email ?? "",
                          address:
                            (c as { address?: string | null }).address ?? "",
                          website: c.website ?? "",
                        });
                        setCustTab("add");
                        jump("sales-customers");
                      }}
                    >
                      ✎ {L("Edit", "Sunting")}
                    </button>
                    <button
                      type="button"
                      className={rowBtnDanger}
                      onClick={async () => {
                        if (
                          !(await askConfirm({
                            title: L(
                              `Delete ${c.company}?`,
                              `Padam ${c.company}?`
                            ),
                            message: L(
                              "Only possible when they have no documents — quotations and invoices must keep their customer for records.",
                              "Hanya boleh apabila mereka tiada dokumen — sebut harga dan invois mesti mengekalkan pelanggannya untuk rekod."
                            ),
                            confirmLabel: L(
                              "Delete customer",
                              "Padam pelanggan"
                            ),
                            variant: "danger",
                          }))
                        )
                          return;
                        const res = await api<{ error?: { message?: string } }>(
                          `/staff/customers/${c.id}`,
                          { method: "DELETE" }
                        );
                        if (res.ok) {
                          showToast(
                            L("Deleted", "Dipadam"),
                            L(`${c.company} removed`, `${c.company} dibuang`)
                          );
                          if (editingCust?.id === c.id) {
                            setEditingCust(null);
                            setCust({
                              company: "",
                              contact_person: "",
                              phone: "",
                              email: "",
                              address: "",
                              website: "",
                            });
                          }
                          void load();
                        } else
                          showToast(
                            L("No changes", "Tiada perubahan"),
                            res.data?.error?.message ??
                              L("Delete refused", "Padam ditolak"),
                            "notice"
                          );
                      }}
                    >
                      {L("Delete", "Padam")}
                    </button>
                  </span>
                </div>
                {openCust === c.id && (
                  <DetailGrid
                    items={[
                      {
                        label: L("Contact", "Hubungan"),
                        value: c.contact_person ?? "",
                      },
                      { label: L("Phone", "Telefon"), value: c.phone ?? "" },
                      { label: L("Email", "E-mel"), value: c.email ?? "" },
                      {
                        label: L("Billing address", "Alamat bil"),
                        wide: true,
                        value: (c as { address?: string | null }).address ?? "",
                      },
                      {
                        label: L("Delivery address", "Alamat penghantaran"),
                        wide: true,
                        value:
                          (c as { delivery_address?: string | null })
                            .delivery_address ?? "",
                      },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
          </div>
          <div className={custTab === "clients" ? "mt-3" : "hidden"}>
            {customersExtra}
          </div>
        </div>
      </section>
    </>
  );
}
