/* v1.397.0 - SALES COMMAND CENTER, PHASE 1 (the CEO, 21-11-2026: "make A2Z OS actively
   guide the Sales Team"; claude/ plan, decisions 1-7 approved, Phase 1 authorised).

   THE DAILY ACTION CENTER'S ORDER AND WORDS, worked out once with no React and no
   database, so the worker (worker/src/sales-today.ts), the Sales Overview, the Desk
   summary and the Dashboard line all agree, and the guard (tests/sales-today.mjs)
   runs it.

   Each action is ONE existing record that needs someone: an open follow-up that is
   due, a quotation or an invoice with nothing booked next, an accepted quotation to
   invoice, a website enquiry or a Business Growth Check entry waiting for a reply.
   Nothing here is stored and nothing here completes anything: an action leaves the
   list only when its own record changes (a follow-up closed with what the customer
   said, a next follow-up booked, an enquiry answered, a quotation invoiced).

   THE INDICATORS (the CEO, 21-11-2026), each with its own words, never colour alone:
     red     overdue      a follow-up date that has passed, a reply that has waited too
                          long, an invoice marked overdue
     amber   no_next      nothing is scheduled next on an open quotation or invoice
     grey    age          how long a quotation has been open - a fact, never "overdue"
     green   done         an activity recorded today (the Done today list)
   Due today, new and ready-to-invoice are blue: work for today, not late. */

export type SalesActionKind = "followup" | "quotation" | "invoice" | "enquiry" | "growth";
export type SalesActionFlag = "overdue" | "waiting" | "payment_overdue" | "today" | "new" | "ready" | "no_next";
export type SalesTone = "red" | "amber" | "blue" | "grey" | "green";

export interface SalesAction {
  /** kind:id - unique in one answer */
  key: string;
  kind: SalesActionKind;
  flag: SalesActionFlag;
  /** the record that opens: a follow-up, a document, an enquiry, a growth entry */
  record_id: number;
  customer_id: number | null;
  customer: string;
  /** the document's number or the enquiry's reference */
  ref: string | null;
  doc_id: number | null;
  /** what the record is about: the follow-up's note, the enquiry's first words */
  note: string | null;
  cents: number | null;
  owner_id: number | null;
  owner_name: string | null;
  /** the follow-up's due day (YYYY-MM-DD, Malaysia) */
  due_on: string | null;
  /** an open quotation's or invoice's age in days - shown grey, never as late */
  age_days: number | null;
  /** hours a website enquiry has waited */
  waited_hours: number | null;
  /** when it started to need someone: due day, created, picked up (ordering only) */
  since: string;
  phone: string | null;
  /** an accepted quotation whose follow-up is the row */
  accepted?: boolean;
}

export interface SalesDone {
  key: string;
  kind: "followup_done" | "next_booked" | "enquiry_replied" | "growth_recorded" | "quotation_issued" | "payment_reported";
  at: string;
  customer: string;
  ref: string | null;
  detail: string | null;
  customer_id: number | null;
  doc_id: number | null;
  record_id: number | null;
}

/** the order of the tiers, most urgent first */
export const FLAG_TIER: Record<SalesActionFlag, number> = {
  overdue: 0, waiting: 1, payment_overdue: 2, today: 3, new: 4, ready: 5, no_next: 6,
};

export const FLAG_TONE: Record<SalesActionFlag, SalesTone> = {
  overdue: "red", waiting: "red", payment_overdue: "red",
  today: "blue", new: "blue", ready: "blue",
  no_next: "amber",
};

/** the words of each indicator, English and Malay - the colour is never the only signal */
export const FLAG_WORD: Record<SalesActionFlag, [string, string]> = {
  overdue: ["Overdue follow-up", "Susulan lewat"],
  waiting: ["Overdue reply", "Balasan lewat"],
  payment_overdue: ["Payment overdue", "Bayaran lewat"],
  today: ["Due today", "Hari ini"],
  new: ["New enquiry", "Pertanyaan baharu"],
  ready: ["Accepted - ready to invoice", "Diterima - sedia diinvois"],
  no_next: ["No next action", "Tiada tindakan seterusnya"],
};

/** the late ones: what the Overdue filter, the Desk and the Dashboard call overdue */
export const isLate = (f: SalesActionFlag) => FLAG_TONE[f] === "red";

/** a follow-up is overdue only when its date has passed - an old quotation is never overdue by age */
export const followupFlag = (dueOn: string, today: string): "overdue" | "today" | null =>
  dueOn < today ? "overdue" : dueOn === today ? "today" : null;

/** Most urgent first. Late follow-ups by how long they are late, then the larger
    sum; quotations with nothing booked by value, then age; the rest oldest first. */
export function rankActions<T extends Pick<SalesAction, "flag" | "since" | "cents" | "age_days" | "key">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const t = FLAG_TIER[a.flag] - FLAG_TIER[b.flag];
    if (t) return t;
    if (a.flag === "no_next") {
      const v = (b.cents ?? 0) - (a.cents ?? 0);
      if (v) return v;
      const g = (b.age_days ?? 0) - (a.age_days ?? 0);
      if (g) return g;
    } else {
      const s = a.since.localeCompare(b.since);
      if (s) return s;
      const v = (b.cents ?? 0) - (a.cents ?? 0);
      if (v) return v;
    }
    return a.key.localeCompare(b.key);
  });
}

/** the counts the Desk line, the Dashboard line and the Overview all print */
export function actionCounts(items: readonly Pick<SalesAction, "flag">[]): { total: number; overdue: number; today: number; no_next: number } {
  let overdue = 0, today = 0, noNext = 0;
  for (const i of items) {
    if (isLate(i.flag)) overdue += 1;
    else if (i.flag === "no_next") noNext += 1;
    else today += 1;
  }
  return { total: items.length, overdue, today, no_next: noNext };
}

/** the Action Center's filters */
export type ActionFilter = "all" | "overdue" | "today" | "no_next" | "enquiries" | "done";
export function matchesFilter(i: Pick<SalesAction, "flag" | "kind">, f: ActionFilter): boolean {
  if (f === "all") return true;
  if (f === "overdue") return isLate(i.flag);
  if (f === "today") return i.flag === "today" || i.flag === "ready";
  if (f === "no_next") return i.flag === "no_next";
  if (f === "enquiries") return i.kind === "enquiry" || i.kind === "growth";
  return false;
}

/** Recent activities: the five filters the CEO named */
export type ActivityGroup = "sales" | "followups" | "payments" | "enquiries";
export interface SalesActivity {
  key: string;
  group: ActivityGroup;
  kind: "quotation" | "invoice" | "followup_done" | "payment_reported" | "payment_verified" | "enquiry" | "growth";
  at: string;
  title: string;
  customer: string | null;
  cents: number | null;
  detail: string | null;
  doc_id: number | null;
  customer_id: number | null;
  record_id: number | null;
}
