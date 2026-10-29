"use client";

/* v1.224.0 - THE COMMISSION CARD on Sales -> Overview (the owner's
   Commission brief, 29-10-2026: "a compact commission summary ... with a View
   Details action linking to the Commission module"). Four figures from
   /staff/commission/summary - Estimated, Eligible, Included in payroll, Paid
   - for the scope on screen (a consultant always gets their own; the server
   enforces it). Nothing is calculated here, and the weekly target beside it
   never changes any of these figures. */

import { useEffect, useState } from "react";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { usePortal } from "@/components/portal/portal-provider";
import { makeApi } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, card } from "@/lib/ui-styles";
import { SkelRows } from "@/components/ui/skeleton";
import css from "./commission.module.css";

/** a commission policy version (worker/src/commission.ts) */
export interface Policy {
  id: number; version: number; name: string; status: "draft" | "active" | "rejected"; effective_from: string;
  rate_kind: "percent" | "fixed"; rate_bp: number | null; fixed_cents: number | null; basis: "net_of_tax_delivery" | "invoice_total";
  reason: string; created_at: string; approved_at: string | null; reject_reason?: string | null;
  created_by_name?: string | null; approved_by_name?: string | null; rejected_by_name?: string | null;
}
export interface Summary {
  scope: "mine" | "all"; month: string; start: string; sync: boolean; can_view_all: boolean; policy: Policy | null;
  estimated: { cents: number; n: number }; eligible: { cents: number; n: number }; included: { cents: number; n: number }; paid: { cents: number; n: number }; review: { cents: number; n: number };
}
const api = makeApi("/staff/commission");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export function CommissionCard({ scope }: { scope: "mine" | "all" }) {
  const { setTab, canOpen } = usePortal();
  const [got, setGot] = useState<{ scope: string; d: Summary | null; status: number } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void api<Summary>(`/summary?scope=${scope}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ scope, d: r.ok && r.data ? r.data : null, status: r.status }); });
    return () => c.abort();
  }, [scope]);
  const mine = got?.scope === scope ? got : null;
  /* an older worker without the commission engine: no card at all */
  if (mine && !mine.d && mine.status === 404) return null;
  const d = mine?.d;
  const rate = d?.policy ? (d.policy.rate_kind === "fixed" ? fmtRM(d.policy.fixed_cents ?? 0) : `${((d.policy.rate_bp ?? 0) / 100).toFixed(2)}%`) : null;
  const items: [string, number | undefined, string][] = [
    [L("Estimated", "Anggaran"), d?.estimated.cents, L("open invoices - not earned yet", "invois terbuka - belum diperoleh")],
    [L("Eligible", "Layak"), d?.eligible.cents, L("paid in full and confirmed", "dibayar penuh dan disahkan")],
    [L("Included in payroll", "Dalam gaji"), d?.included.cents, d && !d.sync ? L("payroll link not on yet", "pautan gaji belum hidup") : L("bank run not yet done", "pembayaran bank belum selesai")],
    [L("Commission paid", "Komisen dibayar"), d?.paid.cents, L("this month's payroll", "gaji bulan ini")],
  ];
  return (
    <section className={card} aria-label={L("Commission", "Komisen")}>
      <div className={css.head}>
        <div>
          <PanelTitle icon="money">{d?.scope === "all" ? L("Commission - the team", "Komisen - pasukan") : L("My commission", "Komisen saya")}</PanelTitle>
          <p className={css.sub}>{!d ? "…" : rate ? L(`${rate} of the sale after discounts, excl. SST and delivery · earned when paid in full and confirmed by the CEO/COO · separate from weekly targets`, `${rate} jualan selepas diskaun, tanpa SST dan penghantaran · diperoleh apabila dibayar penuh dan disahkan CEO/COO · berasingan daripada sasaran mingguan`) : L("No commission policy approved yet - nothing is estimated or earned", "Tiada polisi komisen diluluskan lagi - tiada apa dianggar atau diperoleh")}</p>
        </div>
        {canOpen("Commission") && <button type="button" className={btnSm} onClick={() => setTab("Commission")}><AppIcon name="next" />{L("View details", "Lihat butiran")}</button>}
      </div>
      {!d ? <SkelRows rows={2} /> : <ul className={css.cardGrid}>
        {items.map(([k, v, sub]) => <li key={k}><span>{k}</span><strong>{v === undefined ? "…" : fmtRM(v)}</strong><span>{sub}</span></li>)}
      </ul>}
    </section>
  );
}
