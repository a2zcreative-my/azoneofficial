/**
 * SALES REPORTS - v1.403.0, Sales Command Center Phase 6 (the CEO, 21-11-2026, "As recommended" on the seven
 * Phase 6 decisions). Four reports beside the five Sales already has, all PURE READS:
 *
 *   GET /sales/reports/team?period=        per salesperson: ACTIVITY (contacts logged, follow-ups completed,
 *                                          quotations issued) apart from RESULTS (deals won, invoices paid in
 *                                          full and their total - the weekly engine's own basis, personWeek).
 *                                          exec_view only, as the Action Center's team table.
 *   GET /sales/reports/pipeline?period=&scope=   open deals by stage NOW (value counted once, dealValue), the
 *                                          moves between stages in the period, average days in each stage
 *                                          left in the period, won and lost in the period.
 *   GET /sales/reports/winloss?period=&scope=    how deals were won (acceptance / invoice / a manager's reason)
 *                                          and why they were lost (the seven reasons, with notes).
 *   GET /sales/reports/sources?period=&scope=    leads by source, how many became deals, how many were won.
 *
 * Periods are Malaysian days: week (the company's week start), month, last_month, 3m, year. Scope "all" only
 * with exec_view (the Action Center's Everyone); otherwise a person's own work. Money collected is only what
 * personWeek already counts (paid in full, by closer) - this file makes no revenue figure of its own, and a
 * deal's value is never revenue.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { canUser } from "./permissions";
import { err, json } from "./shared";
import { personWeek, staffList, weekStartDow, weekStartOf } from "./weekly-sales";
import { quotesOf } from "./deals";
import { LOST_REASONS, OPEN_STAGES, dealValue } from "../../lib/pipeline-words";

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const missing = (e: unknown) => /no such (table|column)/i.test(String(e));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const monthStart = (iso: string, back = 0) => { const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 - back, 1)); return d.toISOString().slice(0, 10); };
export const PERIODS = ["week", "month", "last_month", "3m", "year"] as const;
export type Period = (typeof PERIODS)[number];

export async function periodRange(env: Env, period: string, today = mytToday()): Promise<{ period: Period; from: string; to: string }> {
  const p = (PERIODS as readonly string[]).includes(period) ? (period as Period) : "month";
  if (p === "week") { const from = weekStartOf(today, await weekStartDow(env)); return { period: p, from, to: addDays(from, 6) }; }
  if (p === "last_month") { const from = monthStart(today, 1); return { period: p, from, to: addDays(monthStart(today), -1) }; }
  if (p === "3m") return { period: p, from: monthStart(today, 2), to: today };
  if (p === "year") return { period: p, from: `${today.slice(0, 4)}-01-01`, to: today };
  return { period: p, from: monthStart(today), to: addDays(monthStart(today, -1), -1) };
}
const MYT = (col: string) => `date(${col}, '+8 hours')`;
const ts = (s: string) => Date.parse(s.replace(" ", "T") + (/[zZ]$/.test(s) ? "" : "Z")) || 0;

export async function handleSalesReports(env: Env, path: string, method: string, user: StaffUser, params: URLSearchParams): Promise<Response | null> {
  const m = /^\/sales\/reports\/(team|pipeline|winloss|sources)$/.exec(path);
  if (!m) return null;
  if (method !== "GET") return err("method_not_allowed", "Reports only read", 405);
  if (["agent", "customer"].includes(user.role) || (!canUser(user, "sales") && !canUser(user, "exec_view"))) return err("forbidden", "Sales access required", 403);
  const kind = m[1]!;
  const exec = canUser(user, "exec_view");
  const today = mytToday();
  const { period, from, to } = await periodRange(env, params.get("period") ?? "month", today);
  const scope: "mine" | "all" = params.get("scope") === "all" && exec ? "all" : "mine";
  const base = { kind, period, from, to, today, scope, can_all: exec };
  try {
    if (kind === "team") {
      if (!exec) return err("forbidden", "Team Performance is for management", 403);
      const people = await staffList(env, from, to);
      const rows: { user_id: number; name: string; activity: { contacts: number; followups_done: number; quotations: number }; results: { deals_won: number; deals_won_cents: number; paid_invoices: number; collected_cents: number } }[] = [];
      for (const p of people) {
        const w = await personWeek(env, p.id, from, to, today);
        const contacts = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sales_activities WHERE created_by = ?1 AND kind != 'followup' AND ${MYT("occurred_at")} BETWEEN ?2 AND ?3`)
          .bind(p.id, from, to).first<{ n: number }>().then((r) => Number(r?.n ?? 0)).catch(() => 0);
        const won = await env.DB.prepare(`SELECT id, est_value_cents, won_doc_id FROM sales_opportunities WHERE owner_id = ?1 AND stage = 'won' AND ${MYT("closed_at")} BETWEEN ?2 AND ?3`)
          .bind(p.id, from, to).all<{ id: number; est_value_cents: number | null }>().then((r) => r.results ?? []).catch(() => []);
        const q = await quotesOf(env, won.map((d) => d.id)).catch(() => new Map());
        const wonCents = won.reduce((t, d) => t + (dealValue(d.est_value_cents, q.get(d.id) ?? []).cents ?? 0), 0);
        rows.push({ user_id: p.id, name: p.name,
          activity: { contacts, followups_done: w.followups_done, quotations: w.quotations.n },
          results: { deals_won: won.length, deals_won_cents: wonCents, paid_invoices: w.paid_invoices, collected_cents: w.basis_cents } });
      }
      rows.sort((a, b) => b.results.collected_cents - a.results.collected_cents || a.name.localeCompare(b.name));
      const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
      return json({ ...base, scope: "all", rows, total: {
        activity: { contacts: sum((r) => r.activity.contacts), followups_done: sum((r) => r.activity.followups_done), quotations: sum((r) => r.activity.quotations) },
        results: { deals_won: sum((r) => r.results.deals_won), deals_won_cents: sum((r) => r.results.deals_won_cents), paid_invoices: sum((r) => r.results.paid_invoices), collected_cents: sum((r) => r.results.collected_cents) } } });
    }

    const mine = scope === "mine";
    if (kind === "pipeline") {
      const { results: deals } = await env.DB.prepare(`SELECT id, stage, est_value_cents, closed_at FROM sales_opportunities WHERE (?1 = 0 OR owner_id = ?2)`)
        .bind(mine ? 1 : 0, user.id).all<{ id: number; stage: string; est_value_cents: number | null; closed_at: string | null }>();
      const all = deals ?? [];
      const q = await quotesOf(env, all.map((d) => d.id));
      const val = (d: (typeof all)[number]) => dealValue(d.est_value_cents, q.get(d.id) ?? []);
      const now = OPEN_STAGES.map((s) => {
        const here = all.filter((d) => d.stage === s);
        return { stage: s, deals: here.length, quoted_cents: here.filter((d) => val(d).basis === "quotation").reduce((t, d) => t + (val(d).cents ?? 0), 0),
          estimated_cents: here.filter((d) => val(d).basis === "estimate").reduce((t, d) => t + (val(d).cents ?? 0), 0) };
      });
      const ids = new Set(all.map((d) => d.id));
      const { results: evs } = await env.DB.prepare(`SELECT opportunity_id, from_stage, to_stage, created_at FROM opportunity_stage_events ORDER BY opportunity_id, id`)
        .all<{ opportunity_id: number; from_stage: string | null; to_stage: string; created_at: string }>();
      const mine2 = (evs ?? []).filter((e) => ids.has(e.opportunity_id));
      const inRange = (t: string) => { const d = new Date(ts(t) + 8 * 3600000).toISOString().slice(0, 10); return d >= from && d <= to; };
      const moves: Record<string, number> = {};
      const stay: Record<string, number[]> = {};
      let last: { id: number; at: string; stage: string } | null = null;
      for (const e of mine2) {
        if (last && last.id === e.opportunity_id && e.from_stage && inRange(e.created_at)) (stay[e.from_stage] ??= []).push((ts(e.created_at) - ts(last.at)) / 86400000);
        if (e.from_stage && inRange(e.created_at)) moves[`${e.from_stage}>${e.to_stage}`] = (moves[`${e.from_stage}>${e.to_stage}`] ?? 0) + 1;
        last = { id: e.opportunity_id, at: e.created_at, stage: e.to_stage };
      }
      const closed = (s: string) => all.filter((d) => d.stage === s && d.closed_at && inRange(d.closed_at));
      return json({ ...base, now,
        moves: Object.entries(moves).map(([k, n]) => ({ from: k.split(">")[0], to: k.split(">")[1], n })).sort((a, b) => b.n - a.n),
        avg_days: OPEN_STAGES.map((s) => ({ stage: s, n: (stay[s] ?? []).length, days: (stay[s] ?? []).length ? Math.round(((stay[s] ?? []).reduce((t, x) => t + x, 0) / (stay[s] ?? []).length) * 10) / 10 : null })),
        won: { n: closed("won").length, cents: closed("won").reduce((t, d) => t + (val(d).cents ?? 0), 0) },
        lost: { n: closed("lost").length, cents: closed("lost").reduce((t, d) => t + (val(d).cents ?? 0), 0) } });
    }

    if (kind === "winloss") {
      const { results } = await env.DB.prepare(
        `SELECT o.id, o.title, o.stage, o.won_basis, o.override_reason, o.lost_reason, o.lost_note, o.closed_at, o.est_value_cents, c.company AS customer,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS owner
           FROM sales_opportunities o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.owner_id
          WHERE o.stage IN ('won', 'lost') AND ${MYT("o.closed_at")} BETWEEN ?1 AND ?2 AND (?3 = 0 OR o.owner_id = ?4)
          ORDER BY o.closed_at DESC LIMIT 500`,
      ).bind(from, to, mine ? 1 : 0, user.id).all<{ id: number; title: string; stage: string; won_basis: string | null; override_reason: string | null; lost_reason: string | null; lost_note: string | null; closed_at: string; est_value_cents: number | null; customer: string; owner: string | null }>();
      const rows = results ?? [];
      const q = await quotesOf(env, rows.map((d) => d.id));
      const shaped = rows.map((d) => { const v = dealValue(d.est_value_cents, q.get(d.id) ?? []); return { ...d, value_cents: v.cents, value_basis: v.basis }; });
      const won = shaped.filter((d) => d.stage === "won"), lost = shaped.filter((d) => d.stage === "lost");
      return json({ ...base,
        won: ["acceptance", "invoice", "override"].map((b) => ({ basis: b, n: won.filter((d) => d.won_basis === b).length, cents: won.filter((d) => d.won_basis === b).reduce((t, d) => t + (d.value_cents ?? 0), 0) })),
        lost: LOST_REASONS.map((r) => ({ reason: r, n: lost.filter((d) => d.lost_reason === r).length, cents: lost.filter((d) => d.lost_reason === r).reduce((t, d) => t + (d.value_cents ?? 0), 0) })),
        rows: shaped });
    }

    /* sources: leads that came in during the period, by source */
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(c.lead_source, 'unknown') AS source, COUNT(*) AS leads,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM sales_opportunities o WHERE o.customer_id = c.id) THEN 1 ELSE 0 END) AS with_deal,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM sales_opportunities o WHERE o.customer_id = c.id AND o.stage = 'won') THEN 1 ELSE 0 END) AS won
         FROM customers c
        WHERE c.company != 'Walk-in Customer' AND ${MYT("c.created_at")} BETWEEN ?1 AND ?2 AND (?3 = 0 OR c.owner_id = ?4)
        GROUP BY COALESCE(c.lead_source, 'unknown') ORDER BY leads DESC`,
    ).bind(from, to, mine ? 1 : 0, user.id).all<{ source: string; leads: number; with_deal: number; won: number }>();
    const rows = (results ?? []).map((r) => ({ source: r.source, leads: Number(r.leads), with_deal: Number(r.with_deal ?? 0), won: Number(r.won ?? 0) }));
    return json({ ...base, rows, total: { leads: rows.reduce((t, r) => t + r.leads, 0), with_deal: rows.reduce((t, r) => t + r.with_deal, 0), won: rows.reduce((t, r) => t + r.won, 0) } });
  } catch (e) {
    if (missing(e)) return err("migration_missing", "Run migrations 0226 and 0227 first (PUSH.bat)", 503);
    throw e;
  }
}
