/* v1.400.0 - WHERE AN OPEN QUOTATION STANDS (Sales Command Center Phase 4, decisions 5 and 6; the CEO,
   21-11-2026, "As recommended"). One reading for the chips on the Documents list and its filters. Read from
   records that already exist (GET /staff/docs: valid_until, revision, followup_open, accepted_current,
   invoiced_as); nothing is stored and nothing changes status. "Expired" is a label only - a quotation is
   renewed with the revision button. Imports nothing. */

export interface QuoteLike {
  doc_type: string;
  created_at: string;
  payment_status?: string | null;
  valid_until?: string | null;
  revision?: number | null;
  invoiced_as?: string | null;
  followup_open?: number | boolean | null;
  accepted_current?: number | boolean | null;
}
export type QuoteFilter = "needs_followup" | "accepted" | "expiring" | "expired";
export interface QuoteState {
  open: boolean;
  age_days: number;
  accepted: boolean;
  /** whole days until valid_until (0 = expires today); null when no validity date */
  days_left: number | null;
  expired: boolean;
  expiring: boolean;
  followup: boolean;
}

const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000);
/** the Malaysia calendar day of a stored UTC time */
const mytDay = (ts: string) => {
  const t = Date.parse(ts.replace(" ", "T") + (/[zZ]$/.test(ts) ? "" : "Z"));
  return Number.isNaN(t) ? ts.slice(0, 10) : new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
};

/** null for anything that is not an open quotation (an invoice, a delivery order, an invoiced or void quotation) */
export function quoteState(d: QuoteLike, today: string): QuoteState | null {
  if (d.doc_type !== "QT" || d.invoiced_as || d.payment_status === "void") return null;
  const t = dayNum(today);
  const days_left = d.valid_until ? dayNum(d.valid_until) - t : null;
  const expired = days_left !== null && days_left < 0;
  return {
    open: true,
    age_days: Math.max(0, t - dayNum(mytDay(d.created_at))),
    accepted: !!d.accepted_current,
    days_left,
    expired,
    expiring: days_left !== null && days_left >= 0 && days_left <= 7,
    followup: !!d.followup_open,
  };
}

/** decision 6: the quotation filters. An accepted one is never "needs follow-up" - it needs its invoice. */
export function matchesQuoteFilter(s: QuoteState | null, f: QuoteFilter): boolean {
  if (!s) return false;
  if (f === "accepted") return s.accepted;
  if (f === "expired") return s.expired && !s.accepted;
  if (f === "expiring") return s.expiring && !s.accepted;
  return !s.followup && !s.accepted && !s.expired;
}
