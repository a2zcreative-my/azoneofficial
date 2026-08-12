/* v1.7.0 — printable Receipt / Credit Note.
   Opens a print window with the AZ ONE OFFICIAL letterhead + logo. Kept
   self-contained so no server-side PDF template is needed; "Save as PDF" in
   the browser's print dialog produces the shareable file. */

import { SITE_CONFIG } from "@/constants/site";
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
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function printBusinessDoc(d: PrintDocData): void {
  const title = d.kind === "RECEIPT" ? "OFFICIAL RECEIPT" : "CREDIT NOTE";
  const dateStr = d.date ? new Date(d.date.replace(" ", "T")).toLocaleDateString("en-MY", { day: "2-digit", month: "long", year: "numeric" }) : "";
  const rows: [string, string][] = [];
  if (d.invoiceNumber) rows.push(["Against invoice", d.invoiceNumber]);
  if (d.customer) rows.push(["Customer", d.customer]);
  if (d.method) rows.push(["Payment method", d.method.replace(/_/g, " ")]);
  if (d.reference) rows.push(["Reference", d.reference]);
  if (d.reason) rows.push(["Reason", d.reason]);

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
    <img class="logo" src="/logo.png" alt="AZ ONE OFFICIAL" onerror="this.style.display='none'"/>
    <div class="co"><b>${esc(SITE_CONFIG.legalName)}</b><br/>${esc(SITE_CONFIG.address)}<br/>${esc(SITE_CONFIG.url)}</div>
  </div>
  <h1>${title}</h1>
  <div class="num">${esc(d.number)}${dateStr ? ` · ${dateStr}` : ""}</div>
  <table>${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
  <div class="amt"><span class="lbl">${d.kind === "RECEIPT" ? "Amount received" : "Amount credited"}</span><span class="val">${fmtRM(d.amountCents)}</span></div>
  <div class="foot">This is a computer-generated ${d.kind.toLowerCase()} and is valid without a signature. ${esc(SITE_CONFIG.name)} · ${esc(SITE_CONFIG.tagline)}</div>
</div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;

  const w = window.open("", "_blank", "width=820,height=1000");
  if (!w) { window.alert("Please allow pop-ups to print the document."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
