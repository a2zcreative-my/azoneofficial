/**
 * ONE DESK — everything waiting on the person looking. v1.106.0 (roadmap
 * phase 04).
 *
 * The roadmap, 05-09-2026: *"Today approvals live in five different tabs,
 * which means the answer to 'what is waiting on me' is a tour of the
 * product."* This module is the one answer. It is a READ over tables other
 * modules own, so it decides nothing and writes nothing; every item it lists
 * is acted on where it always was, and the tab it names is where that is.
 *
 * THE RULE THIS FILE HAS TO GET RIGHT: an item is on your desk only if YOU
 * may act on it, by the same rule the acting route enforces. A desk that
 * shows the COO a claim only the CEO can decide is a desk that teaches people
 * to ignore it. So the leave rule is imported from leave-chain.ts (shared with
 * the decide route), the claim chain is written out below exactly as
 * staff.ts has it, and tests/one-desk.mjs runs BOTH against the same cases.
 *
 * WHAT COUNTS AS WAITING, per bucket:
 *   leave      pending requests at a stage this role acts at, not my own
 *   claims     pending claims at the step this role performs - HR review
 *              (hr_admin), pre-approval (COO for staff, CCO for HR), final
 *              (CEO: chain complete, or exec/top claimants) - never my own,
 *              never one that pays me
 *   ot         overtime with both punches, undecided (CEO/COO)
 *   punches    forgotten or offline punches awaiting approval (CEO)
 *   (commission and enquiries: retired at v1.183.0)
 *   tasks      my open tasks, overdue first; and tasks I created whose scope
 *              is fully ticked but not yet closed ("review and close")
 *   news       announcements from the last 30 days I have not acknowledged
 *   followups  v1.181.16: client follow-ups due today or earlier that are
 *              mine, or nobody's (sales permission)
 *   billing    v1.181.16: recurring invoices due this month and not yet
 *              raised (sales permission); raised by a person, in Sales
 *   people     v1.181.17 (hr_manage): a probation ending within 14 days or
 *              past its end undecided; open joining steps for someone who
 *              joined in the last 60 days; open leaving steps
 *   quotes     v1.181.17 (CEO, only while the owner's approval limit is
 *              set): quotations over the limit not yet approved
 *
 * Every query is armoured on its own: a table a pending migration has not
 * created yet costs its bucket, not the desk (the v1.4.218 lesson).
 *
 * The client remembers this view (lib/cached-api) and refetches when any of
 * its topics moves, so the desk is live without polling.
 */

import type { Env } from "./index";
import { can } from "./permissions";
import { leaveCanActAt } from "./leave-chain";
import { pendingOtDays } from "./ot-pending"; // v1.181.10
import { JOINING_KEYS, LEAVING_KEYS } from "./business"; // v1.181.17
import { annAckedSql, annRequiredSql, viewerOf } from "./news"; // v1.217.0

export interface DeskItem {
  bucket: "leave" | "claims" | "ot" | "punches" | "tasks" | "news" | "followups" | "billing" | "people" | "quotes"; // v1.183.0 - commission and enquiries retired
  id: string;
  title: string;
  sub: string;
  /** ISO-ish SQLite datetime of when it started waiting */
  since: string | null;
  /** the registry tab where this is acted on */
  tab: string;
  /** true when it has waited longer than the bucket's comfortable window */
  overdue: boolean;
  /**
   * v1.175.0 — WHICH HALF OF THE DESK THIS IS.
   *   "decide"  someone else's item and you are a signer on it: leave, claims,
   *             overtime, a forgotten punch, a task of yours whose
   *             scope is finished. Nobody else can move it while it sits here.
   *   "do"      your own work, or a thing that clears when you have read or
   *             answered it: your open tasks, unacknowledged news, follow-ups.
   * The split is the whole point of the two lists on the client: a CEO opening
   * the portal wants the first group, not a merged pile.
   */
  kind: "decide" | "do";
  /** the person the item is ABOUT, when it is somebody else's — null for your own work */
  who: string | null;
  /**
   * The next action, in words, imperative and short: "Approve or reject".
   *
   * v1.176.0 — THE DIVISION OF LABOUR BETWEEN `sub` AND `next`, which a row
   * must not blur: `sub` says what the item IS and what state it is in
   * ("RM 1,240.00 · final approval", "both punches recorded, undecided");
   * `next` says what YOU do about it. Putting the action in both — a row
   * reading "approve or reject" above "→ Approve or reject" — is the
   * repetition the owner saw on his phone, and it makes a scannable queue
   * unscannable.
   */
  next: string;
  /* v1.175.0-v1.182.1 the desk offered ONE inline action, taking an
     unassigned enquiry (`takeable`); v1.183.0 retired Enquiries and the
     action with it. Every bucket is an approval or work whose evidence is
     NOT in a one-line row, so a row only ever opens the record. */
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const DAY_MS = 86_400_000;
const ageDays = (sqliteDt: string | null): number => {
  if (!sqliteDt) return 0;
  const t = new Date(sqliteDt.replace(" ", "T") + (sqliteDt.endsWith("Z") ? "" : "Z")).getTime();
  return Number.isNaN(t) ? 0 : (Date.now() - t) / DAY_MS;
};
const rm = (cents: number) => `RM ${(cents / 100).toFixed(2)}`;
const dmy = (iso: string) => iso.length >= 10 ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : iso;

/** The claim chain, exactly as staff.ts spells it. */
export const claimChain = (role: string): "staff" | "hr" | "exec" | "top" =>
  ["marketing", "sales_marketing", "editor", "live_host"].includes(role) ? "staff"
    : role === "hr_admin" ? "hr"
      : ["coo", "cco"].includes(role) ? "exec" : "top";

/**
 * Which step of a pending claim is waiting on THIS person, if any. Pure, so
 * the guard can run it against the decide routes' own rules.
 */
export function claimStepFor(
  viewer: { id: number; role: string },
  claim: { user_id: number; payee_user_id: number | null; claimant_role: string; hr_reviewed_at: string | null; pre_approved_at: string | null },
): "hr_review" | "pre_approve" | "decide" | null {
  if (claim.user_id === viewer.id) return null;              // never your own
  const chain = claimChain(claim.claimant_role);
  const adminTier = viewer.role === "admin" || viewer.role === "super_admin";
  if (can(viewer.role, "claims_decide")) {
    /* the CEO decides when the chain is complete, and decides exec/top
       claims directly; a claim still mid-chain is not waiting on him yet */
    if (chain === "staff") return claim.hr_reviewed_at && claim.pre_approved_at ? "decide" : null;
    if (chain === "hr") return claim.pre_approved_at ? "decide" : null;
    return "decide";
  }
  if (claim.payee_user_id === viewer.id) return null;        // pays to you: the CEO decides it directly
  if (chain === "staff") {
    if (!claim.hr_reviewed_at) return viewer.role === "hr_admin" || adminTier ? "hr_review" : null;
    if (!claim.pre_approved_at) return viewer.role === "coo" || adminTier ? "pre_approve" : null;
    return null;
  }
  if (chain === "hr") {
    if (!claim.pre_approved_at) return viewer.role === "cco" || adminTier ? "pre_approve" : null;
    return null;
  }
  return null;
}

export async function handleDesk(env: Env, user: { id: number; role: string; name: string }): Promise<Response> {
  const { items, counts, missing } = await deskItems(env, user);
  return json({ items, counts, total: items.length, missing, generated_at: new Date().toISOString() });
}

/** The desk as data - shared with the morning brief (watchers.ts), which
    tells each executive how many things are waiting on them today. */
export async function deskItems(env: Env, user: { id: number; role: string }): Promise<{ items: DeskItem[]; counts: Record<string, number>; missing: string[] }> {
  const items: DeskItem[] = [];
  const missing: string[] = [];
  const guard = async (bucket: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) {
      if (String(e).includes("no such")) missing.push(bucket); else throw e;
    }
  };

  /* ---- leave ---- */
  await guard("leave", async () => {
    const { results } = await env.DB.prepare(
      `SELECT l.id, l.user_id, l.stage, l.type, l.start_date, l.end_date, l.days, l.created_at,
              u.role AS applicant_role, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
         FROM leave_requests l JOIN users u ON u.id = l.user_id
        WHERE l.status = 'pending'
        ORDER BY l.created_at ASC LIMIT 200`,
    ).all<{ id: number; user_id: number; stage: string; type: string; start_date: string; end_date: string | null; days: number; created_at: string; applicant_role: string; name: string }>();
    for (const r of results) {
      if (!leaveCanActAt(user, r.stage, r.applicant_role, r.user_id)) continue;
      items.push({
        bucket: "leave", id: `leave:${r.id}`, tab: "Leave",
        title: `${r.name} — ${r.type} leave, ${r.days} day${r.days === 1 ? "" : "s"}`,
        sub: `${dmy(r.start_date)}${r.end_date && r.end_date !== r.start_date ? ` – ${dmy(r.end_date)}` : ""} · ${r.stage === "applied" ? "HR review" : r.stage === "hr_reviewed" ? "pre-approval" : "final approval"}`,
        since: r.created_at, overdue: ageDays(r.created_at) > 3,
        kind: "decide", who: r.name,
        next: r.stage === "applied" ? "Review as HR" : r.stage === "hr_reviewed" ? "Pre-approve or reject" : "Approve or reject",
      });
    }
  });

  /* ---- claims ---- */
  await guard("claims", async () => {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.user_id, c.payee_user_id, c.amount_cents, c.description, c.created_at, c.hr_reviewed_at, c.pre_approved_at,
              u.role AS claimant_role, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
         FROM claims c JOIN users u ON u.id = c.user_id
        WHERE c.status = 'pending'
        ORDER BY c.created_at ASC LIMIT 200`,
    ).all<{ id: number; user_id: number; payee_user_id: number | null; amount_cents: number; description: string | null; created_at: string; hr_reviewed_at: string | null; pre_approved_at: string | null; claimant_role: string; name: string }>();
    for (const c of results) {
      const step = claimStepFor(user, c);
      if (!step) continue;
      items.push({
        bucket: "claims", id: `claim:${c.id}`, tab: "Claims",
        title: `${c.name} — ${rm(c.amount_cents)}`,
        sub: `${(c.description ?? "").slice(0, 60) || "claim"} · ${step === "hr_review" ? "HR review" : step === "pre_approve" ? "pre-approval" : "final approval"}`,
        since: c.created_at, overdue: ageDays(c.created_at) > 7,
        kind: "decide", who: c.name,
        next: step === "hr_review" ? "Review as HR" : step === "pre_approve" ? "Pre-approve or reject" : "Approve or reject",
      });
    }
  });

  /* ---- overtime ---- */
  if (["ceo", "coo", "super_admin", "admin"].includes(user.role)) {
    await guard("ot", async () => {
      /* v1.181.10 - the same reader as the approvals card and the
         dashboard tile (ot-pending.ts): stretches summed pair by pair, a day
         with no OT out left out, and a month whose payslips are released no
         longer offered here either. */
      const days = (await pendingOtDays(env)).slice(0, 100);
      for (const g of days) {
        const hm = `${Math.floor(g.minutes / 60)}h${String(g.minutes % 60).padStart(2, "0")}`;
        items.push({
          bucket: "ot", id: `ot:${g.user_id}:${g.d}`, tab: "Attendance",
          title: `${g.name} — ${hm} overtime on ${dmy(g.d)}`,
          sub: "both punches recorded, undecided", since: g.last_out, overdue: ageDays(g.last_out) > 3,
          kind: "decide", who: g.name, next: "Approve, give replacement leave, or reject",
        });
      }
    });
  }

  /* ---- forgotten / offline punches ---- */
  if (can(user.role, "unpaid_leave")) {
    await guard("punches", async () => {
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.type, a.created_at, a.offline_sent_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM attendance_records a JOIN users u ON u.id = a.user_id
          WHERE a.pending_approval = 1
          ORDER BY a.created_at DESC LIMIT 100`,
      ).all<{ id: number; type: string; created_at: string; offline_sent_at: string | null; name: string }>();
      for (const r of results) {
        items.push({
          bucket: "punches", id: `punch:${r.id}`, tab: "Attendance",
          title: `${r.name} — ${r.type === "clock_in" ? "clock-in" : "clock-out"} to approve`,
          sub: r.offline_sent_at ? "sent late from offline" : "forgotten punch",
          since: r.created_at, overdue: ageDays(r.created_at) > 2,
          kind: "decide", who: r.name, next: "Approve the time, or reject it",
        });
      }
    });
  }

  /* ---- commission: retired at v1.183.0 with the Commission tab; the
     commission_entries rows are untouched and no desk reads them ---- */

  /* ---- tasks: mine, and mine-to-close ---- */
  await guard("tasks", async () => {
    const { results: mine } = await env.DB.prepare(
      `SELECT t.id, t.title, t.status, t.created_at, t.deadline AS due_date
         FROM tasks t WHERE t.assigned_to = ?1 AND t.status != 'completed'
        ORDER BY COALESCE(t.deadline, '9999') ASC, t.created_at ASC LIMIT 50`,
    ).bind(user.id).all<{ id: number; title: string; status: string; created_at: string; due_date: string | null }>();
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    for (const t of mine) {
      const late = Boolean(t.due_date && t.due_date < today);
      items.push({
        bucket: "tasks", id: `task:${t.id}`, tab: "Tasks", title: t.title,
        sub: late ? `overdue — due ${dmy(t.due_date!)}` : t.due_date ? `due ${dmy(t.due_date)}` : t.status === "in_progress" ? "in progress" : "open",
        since: t.created_at, overdue: late,
        kind: "do", who: null, next: t.status === "in_progress" ? "Finish it" : "Start it",
      });
    }
    const { results: toClose } = await env.DB.prepare(
      `SELECT t.id, t.title, t.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS assignee
         FROM tasks t JOIN users u ON u.id = t.assigned_to
        WHERE t.created_by = ?1 AND t.assigned_to != ?1 AND t.status != 'completed'
          AND EXISTS (SELECT 1 FROM task_items i WHERE i.task_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM task_items i WHERE i.task_id = t.id AND i.done = 0)
        ORDER BY t.created_at ASC LIMIT 50`,
    ).bind(user.id).all<{ id: number; title: string; created_at: string; assignee: string }>();
    for (const t of toClose) {
      items.push({
        bucket: "tasks", id: `task-close:${t.id}`, tab: "Tasks", title: t.title,
        sub: `${t.assignee} finished every item`, since: t.created_at, overdue: false,
        kind: "decide", who: t.assignee, next: "Review the work and close it",
      });
    }
  });

  /* ---- enquiries: retired at v1.183.0 with the Enquiries tab. The website
     and customer-account forms still file rows (the owner's choice); no desk
     lists them and nobody is notified ---- */

  /* ---- v1.181.16 (ERP roadmap phase 4): clients to call back, invoices to raise ---- */
  if (can(user.role, "sales")) {
    await guard("followups", async () => {
      const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const { results } = await env.DB.prepare(
        `SELECT f.id, f.due_on, f.note, f.owner_id, f.created_at, c.company
           FROM customer_followups f JOIN customers c ON c.id = f.customer_id
          WHERE f.done_at IS NULL AND f.cancelled_at IS NULL AND f.due_on <= ?1 AND (f.owner_id = ?2 OR f.owner_id IS NULL)
          ORDER BY f.due_on ASC LIMIT 50`,
      ).bind(today, user.id).all<{ id: number; due_on: string; note: string; owner_id: number | null; created_at: string; company: string }>();
      for (const f of results) {
        items.push({
          bucket: "followups", id: `followup:${f.id}`, tab: "Sales",
          title: `${f.company} — ${f.note}`,
          sub: f.due_on < today ? `follow-up, due ${dmy(f.due_on)}` : "follow-up, due today",
          since: f.due_on, overdue: f.due_on < today,
          kind: "do", who: f.company, next: "Contact the client, then mark it done",
        });
      }
    });
    await guard("billing", async () => {
      const now = new Date(Date.now() + 8 * 3600 * 1000);
      const today = now.toISOString().slice(0, 10);
      const ym = today.slice(0, 7);
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
      const { results } = await env.DB.prepare(
        `SELECT r.id, r.day_of_month, r.created_at, c.company, d.doc_number, d.total_cents
           FROM recurring_invoices r JOIN customers c ON c.id = r.customer_id JOIN sales_documents d ON d.id = r.source_doc_id
          WHERE r.stopped_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM sales_documents x WHERE x.customer_id = r.customer_id AND x.doc_type = 'INV'
                             AND x.reference LIKE 'Recurring R-' || r.id || ' %' AND strftime('%Y-%m', x.created_at, '+8 hours') = ?1)
          ORDER BY r.day_of_month LIMIT 50`,
      ).bind(ym).all<{ id: number; day_of_month: number; created_at: string; company: string; doc_number: string; total_cents: number }>();
      for (const r of results) {
        const due = `${ym}-${String(Math.min(r.day_of_month, last)).padStart(2, "0")}`;
        if (today < due) continue;
        items.push({
          bucket: "billing", id: `recurring:${r.id}`, tab: "Sales",
          title: `${r.company} — monthly invoice`,
          sub: `${rm(r.total_cents)} · repeats ${r.doc_number} · due ${dmy(due)}`,
          since: due, overdue: false,
          kind: "do", who: r.company, next: "Raise it from the recurring list in Sales",
        });
      }
    });
  }

  /* ---- v1.181.17 (ERP roadmap phase 5): people, and quotations over the owner's limit ---- */
  if (can(user.role, "hr_manage")) {
    await guard("people", async () => {
      const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 8 * 3600 * 1000 + 14 * DAY_MS).toISOString().slice(0, 10);
      const { results: prob } = await env.DB.prepare(
        `SELECT p.id, p.user_id, p.ends_on, p.set_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM probation_reviews p JOIN users u ON u.id = p.user_id
          WHERE p.outcome IS NULL AND p.ends_on <= ?1 AND u.is_active = 1
            AND p.id = (SELECT MAX(x.id) FROM probation_reviews x WHERE x.user_id = p.user_id)`,
      ).bind(soon).all<{ id: number; user_id: number; ends_on: string; set_at: string; name: string }>();
      for (const p of prob) {
        items.push({
          bucket: "people", id: `probation:${p.id}`, tab: "HR",
          title: `${p.name} — probation ends ${dmy(p.ends_on)}`,
          sub: p.ends_on < today ? "probation ended, no decision recorded" : "probation ending soon",
          since: p.ends_on, overdue: p.ends_on < today,
          kind: "decide", who: p.name, next: "Confirm, extend or end it",
        });
      }
      const joinedSince = new Date(Date.now() + 8 * 3600 * 1000 - 60 * DAY_MS).toISOString().slice(0, 10);
      const { results: joined } = await env.DB.prepare(
        `SELECT id, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name, joined_on, onboarding_json FROM users
          WHERE is_active = 1 AND left_on IS NULL AND joined_on >= ?1 AND role NOT IN ('customer', 'super_admin', 'admin')`,
      ).bind(joinedSince).all<{ id: number; name: string; joined_on: string; onboarding_json: string | null }>();
      for (const u of joined) {
        let done: Record<string, boolean> = {};
        try { done = u.onboarding_json ? JSON.parse(u.onboarding_json) : {}; } catch { done = {}; }
        const open = JOINING_KEYS.filter((k) => !done[k]).length;
        if (!open) continue;
        items.push({
          bucket: "people", id: `joining:${u.id}`, tab: "HR", title: `${u.name} — joining checklist`,
          sub: `${open} of ${JOINING_KEYS.length} steps open · joined ${dmy(u.joined_on)}`,
          since: u.joined_on, overdue: ageDays(`${u.joined_on} 00:00:00`) > 14,
          kind: "do", who: u.name, next: "Finish the joining steps",
        });
      }
      const { results: leaving } = await env.DB.prepare(
        `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.left_on, k.items
           FROM users u LEFT JOIN leaving_checklists k ON k.user_id = u.id
          WHERE u.left_on IS NOT NULL AND u.left_on >= ?1 AND u.role NOT IN ('customer', 'super_admin', 'admin')`,
      ).bind(joinedSince).all<{ id: number; name: string; left_on: string; items: string | null }>();
      for (const u of leaving) {
        let done: Record<string, boolean> = {};
        try { done = u.items ? JSON.parse(u.items) : {}; } catch { done = {}; }
        const open = LEAVING_KEYS.filter((k) => !done[k]).length;
        if (!open) continue;
        items.push({
          bucket: "people", id: `leaving:${u.id}`, tab: "HR", title: `${u.name} — leaving checklist`,
          sub: `${open} of ${LEAVING_KEYS.length} steps open · last day ${dmy(u.left_on)}`,
          since: u.left_on, overdue: u.left_on < today,
          kind: "do", who: u.name, next: "Finish the leaving steps",
        });
      }
    });
  }
  if (["super_admin", "ceo"].includes(user.role)) {
    await guard("quotes", async () => {
      const row = await env.DB.prepare(`SELECT value FROM business_settings WHERE key = 'quote_approval'`).first<{ value: string | null }>();
      let setting: { limit_cents?: number; since?: string } = {};
      try { setting = row?.value ? JSON.parse(row.value) : {}; } catch { setting = {}; }
      if (!setting.limit_cents || !setting.since) return; // off: nothing waits
      const { results } = await env.DB.prepare(
        `SELECT d.id, d.doc_number, d.total_cents, COALESCE(d.revision, 0) AS revision, COALESCE(datetime(d.revised_at, '-8 hours'), d.created_at) AS at, c.company
           FROM sales_documents d LEFT JOIN customers c ON c.id = d.customer_id
          WHERE d.doc_type = 'QT' AND d.total_cents > ?1 AND COALESCE(datetime(d.revised_at, '-8 hours'), d.created_at) >= ?2
            AND NOT EXISTS (SELECT 1 FROM quotation_approvals a WHERE a.doc_id = d.id AND a.revision = COALESCE(d.revision, 0))
          ORDER BY d.id ASC LIMIT 50`,
      ).bind(setting.limit_cents, setting.since).all<{ id: number; doc_number: string; total_cents: number; revision: number; at: string; company: string | null }>();
      for (const q of results) {
        items.push({
          bucket: "quotes", id: `quote:${q.id}:${q.revision}`, tab: "Sales",
          title: `${q.doc_number}${q.revision ? ` REV ${q.revision}` : ""}${q.company ? ` — ${q.company}` : ""}`,
          sub: `${rm(q.total_cents)} · over your approval limit of ${rm(setting.limit_cents)}`,
          since: q.at, overdue: ageDays(q.at) > 2,
          kind: "decide", who: q.company, next: "Approve it in Sales, in the quotation's details",
        });
      }
    });
  }

  /* ---- news I have not acknowledged ---- */
  await guard("news", async () => {
    /* v1.217.0 - the News rules: a post for me, not mine, not from before I
       joined, and not acknowledged in the version that stands (news.ts) */
    const nv = await viewerOf(env, user);
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.title, a.created_at
         FROM announcements a
        WHERE a.created_at >= datetime('now', '-30 days')
          AND ${annRequiredSql("a", "?1", "?2", "?3")}
          AND NOT ${annAckedSql("a", "?1")}
        ORDER BY a.created_at DESC LIMIT 20`,
    ).bind(user.id, nv.dept, nv.joined).all<{ id: number; title: string; created_at: string }>();
    for (const a of results) {
      items.push({
        bucket: "news", id: `announcement:${a.id}`, tab: "Announcements", title: a.title,
        sub: "announcement", since: a.created_at, overdue: ageDays(a.created_at) > 7,
        kind: "do", who: null, next: "Read it and acknowledge",
      });
    }
  });

  /* Overdue first, then oldest first: the thing that has waited longest is
     the thing to do first, and the desk should read that way. */
  items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.since ?? "").localeCompare(b.since ?? ""));
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.bucket] = (counts[i.bucket] ?? 0) + 1;
  return { items, counts, missing };
}
