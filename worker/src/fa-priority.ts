/* v1.299.0 - FINANCIAL ADVISORY 2.0, PHASE 2: A CASE'S PRIORITY (the CEO,
   13-11-2026, blueprint decision D-2 as recommended).

   Worked out on every read from the case's own records - never stored, never
   typed, and NEVER from the DSR (directive: "Do not automatically treat a high
   DSR as a high-probability Sales opportunity"):

     Critical  a follow-up overdue more than 2 days; a management review
               waiting more than 3 working days; a banker asked for documents
               more than 5 days ago; a blocker marked urgent
     High      a follow-up due today or overdue up to 2 days; a review waiting;
               a banker asked for documents; no meaningful update for more than
               7 days on an open case
     Low       paused by management, or waiting on the client with the next
               follow-up more than 7 days away
     Normal    anything else open

   Management (fa_priority) may override it with a reason; the computed level
   stays visible beside the override. A closed case has no priority. Every
   date is the Malaysian day. */

export type Priority = "critical" | "high" | "normal" | "low";
export const PRIORITIES: readonly Priority[] = ["critical", "high", "normal", "low"];
/** the numbers the CEO approved (D-2) - one place */
export const PRIORITY_RULES = { followUpCriticalDays: 2, reviewCriticalWorkingDays: 3, bankerDocsCriticalDays: 5, staleHighDays: 7, lowAheadDays: 7 } as const;

export interface PriorityInput {
  stage: string;
  next_follow_up: string | null;
  review_pending: boolean;
  review_at: string | null;
  banker_status: string;
  banker_docs_at: string | null;
  last_update: string | null;
  waiting_on: string | null;
  blocker_urgent: boolean;
}

/** a stored time ("YYYY-MM-DD HH:MM:SS", UTC) or a day ("YYYY-MM-DD", already Malaysian) as the Malaysian day */
export function mytDayOf(v: string | null): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(`${v.replace(" ", "T").replace(/Z?$/, "Z")}`);
  return Number.isNaN(t) ? v.slice(0, 10) : new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
/** whole calendar days from a to b (b later = positive) */
export const daysFrom = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 864e5);
/** working days (Monday to Friday) after a, up to and including b */
export function workingDaysFrom(a: string, b: string): number {
  let n = 0;
  for (let t = dayMs(a) + 864e5; t <= dayMs(b); t += 864e5) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export function priorityOf(x: PriorityInput, today: string): { level: Priority; reasons: string[] } | null {
  if (x.stage === "closed") return null;
  const R = PRIORITY_RULES;
  const fu = mytDayOf(x.next_follow_up);
  const rv = mytDayOf(x.review_at);
  const docs = mytDayOf(x.banker_docs_at);
  const last = mytDayOf(x.last_update);
  const late = fu ? daysFrom(fu, today) : null; /* > 0 = overdue by that many days */
  const critical: string[] = [], high: string[] = [];
  if (late != null && late > R.followUpCriticalDays) critical.push(`Follow-up overdue ${late} days`);
  if (x.review_pending && rv && workingDaysFrom(rv, today) > R.reviewCriticalWorkingDays) critical.push(`Management review waiting ${workingDaysFrom(rv, today)} working days`);
  if (x.banker_status === "documents_required" && docs && daysFrom(docs, today) > R.bankerDocsCriticalDays) critical.push(`Banker asked for documents ${daysFrom(docs, today)} days ago`);
  if (x.blocker_urgent) critical.push("Urgent blocker");
  if (critical.length) return { level: "critical", reasons: critical };
  if (late != null && late >= 0) high.push(late === 0 ? "Follow-up due today" : `Follow-up overdue ${late} day${late === 1 ? "" : "s"}`);
  if (x.review_pending) high.push("Management review waiting");
  if (x.banker_status === "documents_required") high.push("Banker asked for documents");
  if (last && daysFrom(last, today) > R.staleHighDays) high.push(`No update for ${daysFrom(last, today)} days`);
  if (high.length) return { level: "high", reasons: high };
  if (x.waiting_on === "paused") return { level: "low", reasons: ["Paused by management"] };
  if (x.waiting_on === "client" && fu && daysFrom(today, fu) > R.lowAheadDays) return { level: "low", reasons: [`Waiting on the client; next follow-up in ${daysFrom(today, fu)} days`] };
  return { level: "normal", reasons: [] };
}
