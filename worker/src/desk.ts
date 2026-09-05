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
 *   commission pending commission entries (commission_decide)
 *   tasks      my open tasks, overdue first; and tasks I created whose scope
 *              is fully ticked but not yet closed ("review and close")
 *   news       announcements from the last 30 days I have not acknowledged
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

export interface DeskItem {
  bucket: "leave" | "claims" | "ot" | "punches" | "commission" | "tasks" | "news";
  id: string;
  title: string;
  sub: string;
  /** ISO-ish SQLite datetime of when it started waiting */
  since: string | null;
  /** the registry tab where this is acted on */
  tab: string;
  /** true when it has waited longer than the bucket's comfortable window */
  overdue: boolean;
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
        sub: `${(c.description ?? "").slice(0, 60) || "claim"} · ${step === "hr_review" ? "HR review" : step === "pre_approve" ? "pre-approval" : "your decision"}`,
        since: c.created_at, overdue: ageDays(c.created_at) > 7,
      });
    }
  });

  /* ---- overtime ---- */
  if (["ceo", "coo", "super_admin", "admin"].includes(user.role)) {
    await guard("ot", async () => {
      const { results } = await env.DB.prepare(
        `SELECT o.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, date(o.created_at, '+8 hours') AS d,
                MIN(CASE WHEN o.type = 'ot_in' THEN o.created_at END) AS ot_in,
                MAX(CASE WHEN o.type = 'ot_out' THEN o.created_at END) AS ot_out
           FROM ot_records o JOIN users u ON u.id = o.user_id
          WHERE o.status = 'pending'
          GROUP BY o.user_id, d
         HAVING ot_out IS NOT NULL
          ORDER BY d DESC LIMIT 100`,
      ).all<{ user_id: number; name: string; d: string; ot_in: string | null; ot_out: string }>();
      for (const r of results) {
        items.push({
          bucket: "ot", id: `ot:${r.user_id}:${r.d}`, tab: "Attendance",
          title: `${r.name} — overtime on ${dmy(r.d)}`,
          sub: "approve or reject", since: r.ot_out, overdue: ageDays(r.ot_out) > 3,
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
        });
      }
    });
  }

  /* ---- commission ---- */
  if (can(user.role, "commission_decide")) {
    await guard("commission", async () => {
      const { results } = await env.DB.prepare(
        `SELECT c.id, c.period, c.amount_cents, c.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM commission_entries c JOIN users u ON u.id = c.host_id
          WHERE c.status = 'pending'
          ORDER BY c.created_at ASC LIMIT 100`,
      ).all<{ id: number; period: string; amount_cents: number; created_at: string; name: string }>();
      for (const r of results) {
        items.push({
          bucket: "commission", id: `commission:${r.id}`, tab: "Commission",
          title: `${r.name} — ${rm(r.amount_cents)}`, sub: `commission for ${r.period}`,
          since: r.created_at, overdue: ageDays(r.created_at) > 14,
        });
      }
    });
  }

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
        sub: `${t.assignee} finished every item — review and close`, since: t.created_at, overdue: false,
      });
    }
  });

  /* ---- news I have not acknowledged ---- */
  await guard("news", async () => {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.title, a.created_at
         FROM announcements a
        WHERE a.created_at >= datetime('now', '-30 days')
          AND NOT EXISTS (SELECT 1 FROM announcement_acks k WHERE k.announcement_id = a.id AND k.user_id = ?1)
        ORDER BY a.created_at DESC LIMIT 20`,
    ).bind(user.id).all<{ id: number; title: string; created_at: string }>();
    for (const a of results) {
      items.push({
        bucket: "news", id: `announcement:${a.id}`, tab: "Announcements", title: a.title,
        sub: "not yet acknowledged", since: a.created_at, overdue: ageDays(a.created_at) > 7,
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
