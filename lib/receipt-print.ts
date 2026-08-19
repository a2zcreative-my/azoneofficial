/* v1.7.0 — printable Receipt / Credit Note.
   Opens a print window with the issuing entity's letterhead + logo. Kept
   self-contained so no server-side PDF template is needed; "Save as PDF" in
   the browser's print dialog produces the shareable file.

   v1.27.0 — letterhead now comes from DOCUMENT_ISSUER (lib/issuers.ts), NOT
   from SITE_CONFIG. A receipt and a credit note acknowledge money; they must
   name the legal entity that received or refunded it. SITE_CONFIG is the
   marketing identity and is being rewritten to A2Z CREATIVE MARKETING — had
   this file kept reading it, every receipt would have silently started
   claiming A2Z issued it while the invoice it settles still prints AZ ONE
   OFFICIAL's Maybank account. See lib/issuers.ts for the full reasoning.

   v1.28.0 — the fixed DOCUMENT_ISSUER letterhead becomes per-document: rows
   carry issuer_code (migration 0073), resolved with resolveIssuer(). A legacy
   receipt (NULL) keeps naming AZ ONE OFFICIAL — the entity that actually
   received the money — while receipts issued after the switch name A2Z
   CREATIVE MARKETING, the operating issuer. */

import { resolveIssuer } from "@/lib/issuers";
import { fmtRM } from "@/lib/format";

export interface PrintDocData {
  kind: "RECEIPT" | "CREDIT NOTE";
  number: string;
  date?: string | null;
  customer?: string | null;
  invoiceNumber?: string | null;
  amountCents: number;
  method?: string | null;
  reference?: string | null;
  reason?: string | null;
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. */
  issuer_code?: string | null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function printBusinessDoc(d: PrintDocData): void {
  const issuer = resolveIssuer(d.issuer_code);
  const title = d.kind === "RECEIPT" ? "OFFICIAL RECEIPT" : "CREDIT NOTE";
  const dateStr = d.date ? new Date(d.date.replace(" ", "T")).toLocaleDateString("en-MY", { day: "2-digit", month: "long", year: "numeric" }) : "";
  const rows: [string, string][] = [];
  if (d.invoiceNumber) rows.push(["Against invoice", d.invoiceNumber]);
  if (d.customer) rows.push(["Customer", d.customer]);
  if (d.method) rows.push(["Payment method", d.method.replace(/_/g, " ")]);
  if (d.reference) rows.push(["Reference", d.reference]);
  if (d.reason) rows.push(["Reason", d.reason]);

  /* v1.27.0 — two pre-existing letterhead inconsistencies fixed here, so the
     receipt matches every other document we issue:
       1) it printed SITE_CONFIG.legalName, "AZ One Official (JM1046169-H)" —
          title case, and carrying ONLY the old registration number. Now
          "AZ ONE OFFICIAL" + "SSM 202603168673 (JM1046169-H)", the same name
          and both numbers that doc-pdf / doc-template / payslip-pdf print.
       2) the footer printed SITE_CONFIG.tagline, "Malaysia's Premium Live
          Commerce Agency" (a marketing line), where every other document
          prints the corporate slogan. Now the slogan.
     Every other rendered value is byte-for-byte what it was before. */
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a2946; margin: 0; padding: 40px; }
  .wrap { max-width: 720px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #c9a227; padding-bottom: 16px; }
  .logo { height: 44px; }
  .co { text-align: right; font-size: 12px; color: #5d6778; line-height: 1.5; }
  .co b { color: #1a2946; font-size: 14px; }
  h1 { font-size: 22px; letter-spacing: 1px; margin: 28px 0 4px; }
  .num { color: #7d6027; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 14px; }
  td { padding: 8px 0; }
  td.k { color: #5d6778; width: 40%; }
  .amt { margin-top: 28px; background: #f6f7f9; border-radius: 10px; padding: 18px 20px; display: flex; justify-content: space-between; align-items: center; }
  .amt .lbl { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #5d6778; }
  .amt .val { font-size: 26px; font-weight: 700; }
  .foot { margin-top: 40px; font-size: 11px; color: #8a93a6; border-top: 1px solid #e6e9ee; padding-top: 12px; }
  @media print { body { padding: 0; } .wrap { max-width: none; } }
</style></head><body><div class="wrap">
  <div class="head">
    <img class="logo" src="/logo.png" alt="${esc(issuer.name)}" onerror="this.style.display='none'"/>
    <div class="co"><b>${esc(issuer.name)}</b><br/>${esc(issuer.registration)}<br/>${esc(issuer.address)}<br/>${esc(issuer.websiteUrl)}</div>
  </div>
  <h1>${title}</h1>
  <div class="num">${esc(d.number)}${dateStr ? ` · ${dateStr}` : ""}</div>
  <table>${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
  <div class="amt"><span class="lbl">${d.kind === "RECEIPT" ? "Amount received" : "Amount credited"}</span><span class="val">${fmtRM(d.amountCents)}</span></div>
  <div class="foot">This is a computer-generated ${d.kind.toLowerCase()} and is valid without a signature. ${esc(issuer.name)} · ${esc(issuer.slogan)}</div>
</div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;

  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) { window.alert("Please allow pop-ups to print the document."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
