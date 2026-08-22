/* v1.4.244 — the printed document, in ONE place.
   printDoc() in /portal writes it into a popup; the public /doc page (the
   link a customer opens on their phone) renders the same string in an
   iframe. One template, so a customer and the office can never see two
   different documents. Layout notes live in v1.4.243's CHANGELOG entry;
   the short version: sized for A4's 688px printable width, fixed-height
   signature zones, no tax line while AZ ONE OFFICIAL is not SST-registered. */

import { firstName } from "@/lib/names";

function dmy(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return iso;
  return `${d[2]}-${d[1]}-${d[0]}`;
}

export interface DocItem {
  name: string; qty: number; unit_price_cents: number;
  sku?: string; uom?: string; disc_cents?: number; sub?: string[];
}

import { resolveIssuer } from "@/lib/issuers";

export interface DocFull {
  doc_type: string; doc_number: string; company: string; contact_person?: string;
  address?: string; customer_phone?: string; customer_email?: string; items: string; discount_cents: number;
  tax_percent: number; delivery_cents?: number; total_cents: number; notes?: string; due_date?: string; valid_until?: string; created_at: string;
  payment_status?: string | null; payment_method?: string | null; payment_ref?: string | null; paid_at?: string | null;
  salesperson_name?: string | null;
  created_by_role?: string | null;
  converted_from?: number | null; // v1.4.233
  kind?: string | null; // v1.4.234 — 'product' | 'service'
  delivery_status?: string | null;
  reference?: string | null;          // v1.4.243 — buyer's PO / their own ref
  delivery_address?: string | null;   // v1.4.243 — ship-to on THIS document
  customer_delivery_address?: string | null; // customer's default ship-to
  signer_role?: string | null;
  signer_name?: string | null;
  signer_position?: string | null;
  /* v1.28.0 — per-document legal issuer (migration 0073). NULL/absent =
     legacy row = AZ ONE OFFICIAL; 'a2z' = A2Z CREATIVE MARKETING. The
     letterhead, SST note, bank instruction and footer all follow this. */
  issuer_code?: string | null;
}

/* autoPrint: the portal's popup should raise the print dialog the moment it
   opens (that is what the PDF button is for). The customer's shared link must
   NOT — they get a Save as PDF button instead. */
export function buildDocHtml(doc: DocFull, autoPrint = true, sigSrcOverride?: string): string {
  /* v1.28.0: a document forever shows the entity that ISSUED it — legacy
     rows (issuer_code NULL) stay AZ ONE OFFICIAL, new rows are A2Z. */
  const issuer = resolveIssuer(doc.issuer_code);
  const items: DocItem[] = (() => {
    try { return JSON.parse(doc.items); } catch { return []; }
  })();
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const rm = (c: number) => (c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dOnly = (v: string) => dmy(v.slice(0, 10));
  const title = { QT: "QUOTATION", DO: "DELIVERY ORDER", INV: "INVOICE" }[doc.doc_type] ?? doc.doc_type;
  const isDO = doc.doc_type === "DO";
  const isINV = doc.doc_type === "INV";
  const isService = doc.kind === "service";
  const isPaid = isINV && doc.payment_status === "paid";

  /* ---- amount in words (Malaysian convention: RINGGIT MALAYSIA … ONLY) ---- */
  const ONES = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
    "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
  const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
  const under1000 = (n: number): string => {
    const out: string[] = [];
    if (n >= 100) { out.push(`${ONES[Math.floor(n / 100)]} HUNDRED`); n %= 100; if (n) out.push("AND"); }
    if (n >= 20) out.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
    else if (n) out.push(ONES[n] || "");
    return out.join(" ");
  };
  const inWords = (n: number): string => {
    if (n === 0) return "ZERO";
    const parts: string[] = [];
    for (const [v, name] of [[1e9, "BILLION"], [1e6, "MILLION"], [1e3, "THOUSAND"]] as [number, string][]) {
      if (n >= v) { parts.push(`${under1000(Math.floor(n / v))} ${name}`); n %= v; }
    }
    if (n) { if (parts.length && n < 100) parts.push("AND"); parts.push(under1000(n)); }
    return parts.join(" ");
  };
  const amountWords = (cents: number) => {
    const ringgit = Math.floor(cents / 100), sen = cents % 100;
    return `RINGGIT MALAYSIA : ${inWords(ringgit)}${sen ? ` AND SEN ${inWords(sen)}` : ""} ONLY`;
  };

  /* ---- money ---- */
  const gross = items.reduce((a, i) => a + i.qty * i.unit_price_cents, 0);
  const lineDisc = items.reduce((a, i) => a + (i.disc_cents ?? 0), 0);
  const docDisc = doc.discount_cents ?? 0;
  const taxAmt = Math.round((gross - lineDisc - docDisc) * ((doc.tax_percent ?? 0) / 100));
  const delivery = doc.delivery_cents ?? 0;

  /* ---- line items ---- */
  const rows = items.map((it, i) => {
    const subs = (it.sub ?? []).length
      ? `<ul>${(it.sub ?? []).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "";
    const sku = it.sku ? `<div class="sku">SKU ${esc(it.sku)}</div>` : "";
    const desc = `<td><div class="nm">${esc(it.name)}</div>${sku}${subs}</td>`;
    if (isDO) {
      return `<tr><td class="c">${i + 1}</td>${desc}<td class="c">${it.uom ?? ""}</td><td class="c">${it.qty.toLocaleString()}</td></tr>`;
    }
    return `<tr>
      <td class="c">${i + 1}</td>${desc}
      <td class="c">${it.uom ?? ""}</td>
      <td class="c">${it.qty.toLocaleString()}</td>
      <td class="r">${rm(it.unit_price_cents)}</td>
      <td class="r">${it.disc_cents ? rm(it.disc_cents) : "&mdash;"}</td>
      <td class="r">${rm(it.qty * it.unit_price_cents - (it.disc_cents ?? 0))}</td>
    </tr>`;
  }).join("");

  /* ---- meta strip: no cell borders (CEO), one hairline under the row ---- */
  const meta: [string, string, string][] = [
    ["Sales person", doc.salesperson_name ? firstName(doc.salesperson_name) : "&mdash;", "15%"],
    ["Doc no.", doc.doc_number, "23%"],
    ["Date", dOnly(doc.created_at), "14%"],
  ];
  if (doc.doc_type === "QT") meta.push(["Valid until", doc.valid_until ? dOnly(doc.valid_until) : "14 days", "14%"]);
  else if (isINV) meta.push(["Payment due", doc.due_date ? dOnly(doc.due_date) : "On receipt", "14%"]);
  else meta.push(["Delivery", doc.delivery_status === "delivered" ? "Delivered" : "Pending", "14%"]);
  meta.push(["Reference", doc.reference ? esc(doc.reference) : "N/A", "22%"]);
  meta.push(["Page", "1 of 1", "12%"]);
  const metaTds = meta.map(([k, v, w]) =>
    `<td style="width:${w}"><span class="mk">${k}</span><span class="mv">${v}</span></td>`).join("");

  /* ---- billing | ship-to. Identical (or absent) ship-to collapses rather
       than printing the same block twice. ---- */
  const billLines = [doc.address, doc.customer_phone, doc.customer_email].filter(Boolean) as string[];
  const shipTo = doc.delivery_address || doc.customer_delivery_address || "";
  const shipLabel = isService ? "SERVICE ADDRESS" : "DELIVERY ADDRESS";
  const shipBlock = shipTo && shipTo.trim() !== (doc.address ?? "").trim()
    ? `<div class="party"><p class="bt">${shipLabel}</p><p class="co">${esc(doc.company)}</p>
       <p>${esc(shipTo).replace(/\n/g, "<br/>")}</p></div>`
    : `<div class="party"><p class="bt">${shipLabel}</p><p class="co">Same as billing address</p>
       <p class="tiny" style="margin-top:4px">${isService
         ? "Work is carried out at, or delivered to, the address on the left."
         : "Goods are delivered to the address on the left."}</p></div>`;

  /* ---- signer (v1.4.233 rule kept verbatim) ---- */
  const manualSig = doc.signer_role === null;
  /* v1.38.0 (S-1): signatures moved out of /public into the vault. The
     portal's print window fetches the staff-authenticated route (same
     origin, the session cookie rides along on the <img> request); the
     customer's shared link passes its own token-scoped URL via
     sigSrcOverride. The old /signatures/<role>-sign.png files are gone —
     they were downloadable by anyone on the internet. */
  const sigSrc = sigSrcOverride
    ?? `${location.origin}/api/v1/staff/signature/${doc.signer_role ?? (doc.created_by_role === "coo" ? "coo" : "ceo")}-sign.png`;
  /* The zone is the same height signed or not — that is what holds the two
     columns level once the auto signature drops in. */
  const zone = (img: boolean) =>
    `<div class="sigzone">${img ? `<img src="${sigSrc}" alt="" onerror="this.style.display='none'"/>` : ""}</div>`;
  const signerLines = `<div class="who"><span class="nm">${esc((doc.signer_name ?? "").toUpperCase())}</span><br/>
    ${esc(doc.signer_position ?? "")}<br/><span class="tiny">${esc(issuer.name)}${manualSig ? " &middot; sign &amp; date above" : ""}</span></div>`;
  const partnerBlock = (label: string, l1: string, l2: string) =>
    `<div class="sig blank">${zone(false)}<span class="lbl">${label}</span>
     <div class="who"><span class="nm">${l1}</span><br/>${l2}<br/><span class="tiny">Date</span></div></div>`;

  const preparedBy = (label: string) =>
    `<div class="sig">${zone(!manualSig)}<span class="lbl">${label}</span>${signerLines}</div>`;

  /* One closing shape for all three types — heading, a short clause on the
     left, signer + counterparty on the right — so the three documents read as
     one family and the signature rules land identically on every one. */
  let bottom: string;
  if (isINV) {
    bottom = `<div class="accept">
      <div class="hdr">PAYMENT</div>
      <div class="split">
        <div>
          <p class="body">Payment by bank transfer to <strong>${esc(issuer.bank)}</strong> (${esc(issuer.bankHolder)}).
          Please send the transfer receipt via WhatsApp +60 12-383 4821 quoting the invoice number.</p>
          ${isPaid ? `<p class="paidline">&#10004; PAID${doc.paid_at ? ` &middot; ${dOnly(doc.paid_at)}` : ""}${doc.payment_ref ? ` &middot; Ref: ${esc(doc.payment_ref)}` : ""}</p>` : ""}
        </div>
        <div class="split2">${preparedBy("Authorised signature")}
          ${partnerBlock("Received &amp; acknowledged by", "Name &amp; designation", "Company chop")}</div>
      </div>
    </div>`;
  } else if (isDO) {
    bottom = `<div class="accept">
      <div class="hdr">DELIVERY CONFIRMATION</div>
      <div class="split">
        <p class="body">The goods listed above were delivered in the quantities stated.
        Please sign and return one copy as proof of receipt.</p>
        <div class="split2">${preparedBy("Delivered by")}
          ${partnerBlock("Received in good order", "Name &amp; designation", "Company chop")}</div>
      </div>
    </div>`;
  } else {
    bottom = `<div class="accept">
      <div class="hdr">COMMITMENT ORDER CONFIRMATION</div>
      <div class="split">
        <p class="body">We hereby accept the quoted items and agree that this signed
        document shall be deemed our official Purchase Order, subject to the terms above.</p>
        <div class="split2">${preparedBy("Prepared by")}
          ${partnerBlock("Accepted &amp; confirmed by", "Name &amp; designation", "Company chop")}</div>
      </div>
    </div>`;
  }

  let ladder = `<tr><td>Gross</td><td>${rm(gross)}</td></tr>`;
  if (lineDisc) ladder += `<tr><td>Less: line discounts</td><td>&minus; ${rm(lineDisc)}</td></tr>`;
  if (docDisc) ladder += `<tr><td>Less: discount</td><td>&minus; ${rm(docDisc)}</td></tr>`;
  ladder += `<tr class="sub"><td>Subtotal</td><td>${rm(gross - lineDisc - docDisc)}</td></tr>`;
  if (doc.tax_percent) ladder += `<tr><td>Tax (${doc.tax_percent}%)</td><td>${rm(taxAmt)}</td></tr>`;
  if (delivery) ladder += `<tr><td>Delivery / postage</td><td>${rm(delivery)}</td></tr>`;
  ladder += `<tr class="grand"><td>TOTAL (RM)</td><td>${rm(doc.total_cents)}</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${doc.doc_number}</title>
  <style>
    /* v1.4.239 print pipeline: margin lives on the body inside @media print so
       Chrome prints no header strip; print-color-adjust keeps the navy + gold. */
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a2946; font-size: 11px; margin: 0;
           padding: 12px; max-width: 210mm; margin-inline: auto; display: flex; flex-direction: column; min-height: 268mm; }
    @media print { body { padding: 14mm; min-height: 296mm; } }
    .goldbar { height: 5px; background: linear-gradient(90deg, #C9A227, #E8CB6B, #C9A227); border-radius: 3px; }
    .hd { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 12px 0 9px; border-bottom: 2.5px solid #1a2946; }
    .brand { font-size: 19px; font-weight: 800; letter-spacing: .02em; }
    .brand small { display: block; font-size: 7.5px; letter-spacing: .32em; color: #C9A227; font-weight: 700; margin-top: 2px; }
    .brand .addr { font-size: 9px; color: #5b6472; font-weight: 400; letter-spacing: 0; margin-top: 6px; line-height: 1.55; }
    .docbox { text-align: right; }
    .docbox h2 { margin: 0; font-size: 23px; letter-spacing: .12em; }
    .docbox .kindchip { display: inline-block; margin-top: 5px; font-size: 8px; letter-spacing: .16em;
      border: 1px solid #C9A227; color: #8a6d12; border-radius: 3px; padding: 2px 7px; font-weight: 700; }
    table.meta { width: 100%; border-collapse: collapse; margin-top: 9px; table-layout: fixed; border-bottom: 1px solid #e8ebf1; }
    .meta td { padding: 0 10px 7px 0; vertical-align: top; }
    .meta .mk { display: block; font-size: 7.5px; letter-spacing: .1em; color: #8a93a6; text-transform: uppercase; }
    .meta .mv { font-weight: 700; font-size: 11px; white-space: nowrap; }
    .parties { display: flex; gap: 10px; margin-top: 10px; }
    .party { flex: 1 1 0; min-width: 0; background: #f6f7fa; border-left: 3px solid #C9A227; border-radius: 5px; padding: 8px 10px; }
    .party .bt { margin: 0 0 3px; font-size: 8px; letter-spacing: .16em; color: #8a93a6; font-weight: 700; }
    .party p { margin: 1px 0; line-height: 1.45; }
    .party .co { font-weight: 800; font-size: 12.5px; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 11px; }
    .items th { background: #1a2946; color: #fff; padding: 6px 7px; text-align: left; font-size: 8.5px; letter-spacing: .08em; text-transform: uppercase; }
    .items td { padding: 6px 7px; border-bottom: 1px solid #e8ebf1; vertical-align: top; }
    .items .c { text-align: center; }
    .items .r { text-align: right; font-variant-numeric: tabular-nums; }
    .items .nm { font-weight: 700; }
    .items .sku { font-size: 9px; color: #8a93a6; font-weight: 400; }
    .items ul { margin: 3px 0 0; padding-left: 13px; color: #5b6472; font-size: 10px; line-height: 1.5; }
    .mid { display: flex; gap: 12px; margin-top: 10px; align-items: flex-start; }
    .words { flex: 1 1 0; min-width: 0; border: 1px solid #1a2946; border-radius: 5px; padding: 7px 9px; }
    .words .bt { font-size: 7.5px; letter-spacing: .14em; color: #8a93a6; font-weight: 700; }
    .words .val { font-weight: 700; font-size: 10.5px; margin-top: 2px; line-height: 1.4; }
    .words .sst { margin-top: 6px; font-size: 8.5px; color: #8a93a6; line-height: 1.45; }
    table.tot { width: 240px; flex: none; border-collapse: collapse; }
    .tot td { padding: 3px 9px; font-size: 11px; }
    .tot td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .tot tr.sub td { border-top: 1px solid #e8ebf1; font-weight: 700; }
    .tot tr.grand td { background: #1a2946; color: #fff; font-weight: 800; font-size: 13px; padding: 7px 9px; }
    .tot tr.grand td:first-child { border-radius: 5px 0 0 5px; }
    .tot tr.grand td:last-child { border-radius: 0 5px 5px 0; }
    .notes { margin-top: 10px; font-size: 10.5px; color: #5b6472; white-space: pre-wrap; }
    .accept { margin-top: auto; padding-top: 18px; }
    .accept .hdr { text-align: center; font-size: 11px; font-weight: 800; letter-spacing: .06em; border-top: 1px solid #1a2946; padding-top: 7px; }
    .accept .body { font-size: 10px; color: #5b6472; margin: 4px 0 0; line-height: 1.5; flex: none; width: 300px; }
    .split { display: flex; gap: 12px; margin-top: 10px; justify-content: space-between; align-items: flex-end; }
    /* flex-start: both signature rules sit on ONE baseline whatever the block
       holds — a long name wraps downward instead of lifting its own rule. */
    .split2 { display: flex; gap: 12px; flex: 1; justify-content: flex-end; align-items: flex-start; }
    .pay { background: #f6f7fa; border-radius: 5px; padding: 9px 11px; max-width: 300px; margin-top: auto; }
    .pay p { margin: 2px 0; }
    .pay .bt { font-size: 8px; letter-spacing: .16em; color: #8a93a6; font-weight: 700; }
    .paidline { color: #15803d; font-weight: 800; margin-top: 6px !important; }
    .sig { text-align: center; flex: 1 1 0; min-width: 168px; font-size: 10px; }
    /* RESERVED AUTO-SIGNATURE SPACE — identical height in every block so the
       officer's PNG never shifts the layout, and a blank block lines up with
       a signed one exactly. */
    .sigzone { height: 74px; display: flex; align-items: flex-end; justify-content: center;
               border-bottom: 1px solid #1a2946; margin-bottom: 4px; overflow: hidden; }
    .sigzone img { max-height: 72px; max-width: 100%; object-fit: contain; display: block; }
    .sig .lbl { display: block; font-size: 8px; letter-spacing: .13em; text-transform: uppercase; color: #8a93a6; margin-bottom: 3px; }
    .sig .who { margin-top: 1px; line-height: 1.5; }
    .sig .nm { font-weight: 800; font-size: 10px; letter-spacing: -.01em; }
    .sig.blank .who { color: #8a93a6; }
    .sig.blank .who .nm { font-weight: 700; }
    .tiny { font-size: 8.5px; color: #8a93a6; }
    .foot { margin-top: 12px; font-size: 8px; color: #8a93a6; border-top: 1px solid #e8ebf1; padding-top: 7px; text-align: center; line-height: 1.5; }
    .stamp { position: fixed; top: 34%; left: 50%; transform: translate(-50%,-50%) rotate(-18deg); border: 4px solid #15803d;
      color: #15803d; font-size: 44px; font-weight: 900; letter-spacing: .2em; padding: 6px 26px; border-radius: 10px; opacity: .18; pointer-events: none; }
  </style></head><body${autoPrint ? ' onload="window.print()"' : ""}>
  ${isPaid ? '<div class="stamp">PAID</div>' : ""}
  <div class="goldbar"></div>
  <div class="hd">
    <div class="brand">${esc(issuer.name)}
      <small>LIVE &nbsp;&middot;&nbsp; CONNECT &nbsp;&middot;&nbsp; GROW</small>
      <div class="addr">${esc(issuer.descriptor)} &middot; ${esc(issuer.registration)}<br/>
      ${issuer.addressLines.map(esc).join("<br/>\n      ")}<br/>
      ${esc(issuer.email)} &middot; WhatsApp ${esc(issuer.whatsapp)}</div>
    </div>
    <div class="docbox"><h2>${title}</h2>
      ${doc.kind ? `<div class="kindchip">${isService ? "SERVICES" : "PRODUCTS"}</div>` : ""}
    </div>
  </div>
  <table class="meta"><tr>${metaTds}</tr></table>
  <div class="parties">
    <div class="party">
      <p class="bt">BILLING ADDRESS</p>
      <p class="co">${esc(doc.company)}</p>
      ${doc.contact_person ? `<p>${esc(doc.contact_person)}</p>` : ""}
      ${billLines.map((l) => `<p>${esc(l).replace(/\n/g, "<br/>")}</p>`).join("")}
    </div>
    ${shipBlock}
  </div>
  <table class="items">
    <thead><tr>
      <th class="c" style="width:5%">No</th>
      <th>${isService ? "Description of services" : "Description"}</th>
      <th class="c" style="width:8%">UOM</th>
      <th class="c" style="width:8%">Qty</th>
      ${isDO ? "" : `<th class="r" style="width:13%">Unit price</th>
      <th class="r" style="width:12%">Discount</th>
      <th class="r" style="width:15%">Amount (RM)</th>`}
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="${isDO ? 4 : 7}" style="padding:10px;color:#999">No line items</td></tr>`}</tbody>
  </table>
  ${isDO ? "" : `<div class="mid">
    <div class="words">
      <div class="bt">AMOUNT IN WORDS</div>
      <div class="val">${amountWords(doc.total_cents)}</div>
      <div class="sst">${issuer.sstRegistered
        ? ""
        : `Prices are in Ringgit Malaysia and exclude SST. ${esc(issuer.name)} is not
      registered for Sales &amp; Service Tax; no service tax is charged on this document.`}</div>
    </div>
    <table class="tot">${ladder}</table>
  </div>`}
  ${doc.notes ? `<p class="notes">${esc(doc.notes)}</p>` : ""}
  ${bottom}
  <div class="foot">${esc(issuer.name)} &middot; ${esc(issuer.slogan)} &middot; ${esc(issuer.website)}<br/>
  This is a computer-generated document; no signature is required unless indicated above.</div>
  </body></html>`;
}
