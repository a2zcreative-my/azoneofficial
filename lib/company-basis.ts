/* v1.275.0 - THE COMPANY WEEKLY FIGURE SAYS WHAT IT COUNTS (the CEO,
   10-11-2026, "option 2"): from the week holding 10-11-2026 the company
   target counts every channel - paid invoices, TikTok orders, other shipped
   orders and manual sales (worker/src/weekly-sales.ts companyWeek). Each
   person's target stays the invoices they closed. One sentence, shared by
   the Dashboard and Sales, so the two never word it differently. */
import { fmtRM } from "@/lib/format";

export interface Channels { invoices_cents: number; tiktok_cents: number; other_cents: number; manual_cents: number }

/** `channels` is present only for a reader who may see revenue; the others
    are told what is counted, without the amounts. */
export function companyBasisLine(c: { basis_kind?: string; channels?: Channels | null }, L: (en: string, ms: string) => string): string {
  if (c.basis_kind !== "all_channels") return L("Invoices paid in full this week", "Invois dibayar penuh minggu ini");
  const ch = c.channels;
  if (!ch) return L("This week · invoices, TikTok and other channels", "Minggu ini · invois, TikTok dan saluran lain");
  return L(`This week · invoices ${fmtRM(ch.invoices_cents)} · TikTok ${fmtRM(ch.tiktok_cents)} · other ${fmtRM(ch.other_cents + ch.manual_cents)}`,
    `Minggu ini · invois ${fmtRM(ch.invoices_cents)} · TikTok ${fmtRM(ch.tiktok_cents)} · lain ${fmtRM(ch.other_cents + ch.manual_cents)}`);
}
