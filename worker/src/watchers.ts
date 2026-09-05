/**
 * WATCHERS — rules over the company's own data. v1.108.0 (roadmap phase 04c).
 *
 * The roadmap, 05-09-2026: *"Rules over the data you already hold, checked on
 * the cron that already runs: stock below a line, an order not moved in five
 * days, a claim older than a week, a hotel's MOF or Halal validity expiring
 * ... They arrive as the push from phase 3 and as one morning brief at
 * eight."* A SaaS vendor gives you alerts inside their one product; this
 * gives you alerts across all of them, because all of them are in one place.
 *
 * SHAPE. A watcher is a small object: a key, a label, who hears about it, a
 * default threshold, and check(env, threshold) returning findings - each with
 * a STABLE ref (stock:17, order:1042) and a sentence. The runner (hourly, on
 * the five-minute cron's :00 tick) diffs each watcher's findings against
 * watcher_open: a ref seen for the first time is pushed to its audience and
 * recorded; a ref still present is touched; a ref no longer present is
 * cleared, so it will be new again if the condition returns. Nobody is told
 * the same thing twice for the same reason.
 *
 * THE MORNING BRIEF, 08:00 MYT, to the CEO, COO and CCO: how many things wait
 * on THEM (the desk, personalised), who has clocked in so far, yesterday's web
 * sales, and how many watcher findings are open. One notification, one glance,
 * before the day starts. It is the only thing here that repeats daily, and it
 * repeats because a morning is a new morning.
 *
 * WHAT IS DELIBERATELY NOT A WATCHER: anything the desk already lists for a
 * specific person (pending leave, claims, punches). The desk is the place for
 * "waiting on you"; watchers are for "the company should know". A claim that
 * has aged past a week is the one exception - at that point it is no longer
 * one person's queue, it is a problem.
 */

import type { Env } from "./index";
import { notify } from "./staff";
import { deskItems } from "./desk";
import { bumpVersion } from "./shared";

export interface Finding { ref: string; title: string }
export interface Watcher {
  key: string;
  label: string;
  /** roles who are told when a finding first appears */
  audience: string[];
  /** what `threshold` means, for the settings card */
  thresholdLabel: string | null;
  defaultThreshold: number | null;
  /** the tab where the thing is fixed */
  tab: string;
  check: (env: Env, threshold: number) => Promise<Finding[]>;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const EXEC = ["ceo", "coo", "cco"];

/** "25.06.2027" or "2027-06-25" -> "2027-06-25"; anything else -> null. The
    hotel workbook wrote validity dates by hand, in dd.mm.yyyy. */
export function isoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}
const daysUntil = (iso: string): number => Math.round((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);

export const WATCHERS: readonly Watcher[] = [
  {
    key: "low_stock", label: "Stock below the line", audience: ["ceo", "coo", "sales_marketing"],
    thresholdLabel: "units", defaultThreshold: 5, tab: "Inventory",
    async check(env, t) {
      const { results } = await env.DB.prepare(
        `SELECT id, sku, name, stock FROM inventory_items WHERE stock <= ?1 AND COALESCE(status, 'active') != 'discontinued' ORDER BY stock ASC LIMIT 50`,
      ).bind(t).all<{ id: number; sku: string; name: string; stock: number }>();
      return results.map((r) => ({ ref: `stock:${r.id}`, title: `Low stock: ${r.name} (${r.sku}) — ${r.stock} left` }));
    },
  },
  {
    key: "order_stuck", label: "Paid web order not shipped", audience: ["ceo", "coo", "sales_marketing"],
    thresholdLabel: "days", defaultThreshold: 3, tab: "Web Orders",
    async check(env, t) {
      const { results } = await env.DB.prepare(
        `SELECT id, order_number, customer_name, COALESCE(paid_seen_at, store_updated_at, first_seen_at) AS since
           FROM web_orders WHERE status = 'paid' AND COALESCE(paid_seen_at, store_updated_at, first_seen_at) <= datetime('now', ?1)
          ORDER BY since ASC LIMIT 50`,
      ).bind(`-${t} days`).all<{ id: number; order_number: string; customer_name: string | null; since: string }>();
      return results.map((r) => ({ ref: `order:${r.id}`, title: `Order #${r.order_number} (${r.customer_name ?? "customer"}) paid ${t}+ days ago and not shipped` }));
    },
  },
  {
    key: "claim_aging", label: "Claim undecided", audience: ["ceo"],
    thresholdLabel: "days", defaultThreshold: 7, tab: "Claims",
    async check(env, t) {
      const { results } = await env.DB.prepare(
        `SELECT c.id, c.amount_cents, c.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM claims c JOIN users u ON u.id = c.user_id
          WHERE c.status = 'pending' AND c.created_at <= datetime('now', ?1) ORDER BY c.created_at ASC LIMIT 50`,
      ).bind(`-${t} days`).all<{ id: number; amount_cents: number; created_at: string; name: string }>();
      return results.map((r) => ({ ref: `claim:${r.id}`, title: `${r.name}'s claim of RM ${(r.amount_cents / 100).toFixed(2)} has waited ${t}+ days` }));
    },
  },
  {
    key: "hotel_cert", label: "Hotel MOF / Halal certificate expiring", audience: ["ceo", "cco", "sales_marketing"],
    thresholdLabel: "days ahead", defaultThreshold: 30, tab: "Hotels",
    async check(env, t) {
      const { results } = await env.DB.prepare(
        `SELECT id, hotel_name, state, mof_validity, halal_validity FROM hotels
          WHERE is_active = 1 AND (mof_validity IS NOT NULL OR halal_validity IS NOT NULL)`,
      ).all<{ id: number; hotel_name: string; state: string; mof_validity: string | null; halal_validity: string | null }>();
      const out: Finding[] = [];
      for (const h of results) {
        for (const [kind, raw] of [["MOF", h.mof_validity], ["Halal", h.halal_validity]] as const) {
          const iso = isoDate(raw);
          if (!iso) continue;
          const d = daysUntil(iso);
          /* already lapsed for more than a year is history, not a watch */
          if (d > t || d < -365) continue;
          out.push({
            ref: `hotel:${h.id}:${kind.toLowerCase()}`,
            title: d < 0 ? `${h.hotel_name} (${h.state}): ${kind} certificate lapsed ${-d} days ago` : `${h.hotel_name} (${h.state}): ${kind} certificate expires in ${d} days`,
          });
        }
      }
      return out.slice(0, 80);
    },
  },
  {
    key: "asset_warranty", label: "Asset warranty ending", audience: ["ceo", "hr_admin"],
    thresholdLabel: "days ahead", defaultThreshold: 30, tab: "Assets",
    async check(env, t) {
      const { results } = await env.DB.prepare(
        `SELECT id, asset_tag, name, warranty_until FROM assets
          WHERE warranty_until IS NOT NULL AND warranty_until != '' AND COALESCE(status, '') NOT IN ('disposed', 'retired')`,
      ).all<{ id: number; asset_tag: string; name: string; warranty_until: string }>();
      const out: Finding[] = [];
      for (const a of results) {
        const iso = isoDate(a.warranty_until);
        if (!iso) continue;
        const d = daysUntil(iso);
        if (d > t || d < -30) continue;
        out.push({ ref: `asset:${a.id}`, title: d < 0 ? `${a.asset_tag} ${a.name}: warranty ended ${-d} days ago` : `${a.asset_tag} ${a.name}: warranty ends in ${d} days` });
      }
      return out.slice(0, 50);
    },
  },
  {
    key: "leave_aging", label: "Leave request waiting too long", audience: ["ceo", "hr_admin"],
    thresholdLabel: "days", defaultThreshold: 3, tab: "Leave",
    async check(env, t) {
      const { results } = await env.DB.prepare(
        `SELECT l.id, l.stage, l.start_date, l.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name
           FROM leave_requests l JOIN users u ON u.id = l.user_id
          WHERE l.status = 'pending' AND l.created_at <= datetime('now', ?1) ORDER BY l.created_at ASC LIMIT 50`,
      ).bind(`-${t} days`).all<{ id: number; stage: string; start_date: string; created_at: string; name: string }>();
      return results.map((r) => ({ ref: `leave:${r.id}`, title: `${r.name}'s leave from ${r.start_date} has waited ${t}+ days at "${r.stage}"` }));
    },
  },
];

async function settingsFor(env: Env): Promise<Map<string, { enabled: boolean; threshold: number | null }>> {
  const m = new Map<string, { enabled: boolean; threshold: number | null }>();
  try {
    const { results } = await env.DB.prepare(`SELECT key, enabled, threshold FROM watcher_settings`).all<{ key: string; enabled: number; threshold: number | null }>();
    for (const r of results) m.set(r.key, { enabled: r.enabled === 1, threshold: r.threshold });
  } catch { /* pre-0115: every watcher on, at its default */ }
  return m;
}

/** Hourly. Returns what it pushed, for the log. */
export async function runWatchers(env: Env): Promise<{ checked: number; pushed: number; open: number; failed: string[] }> {
  const settings = await settingsFor(env);
  let pushed = 0, open = 0, checked = 0;
  const failed: string[] = [];
  let known = new Set<string>();
  try {
    const { results } = await env.DB.prepare(`SELECT ref FROM watcher_open`).all<{ ref: string }>();
    known = new Set(results.map((r) => r.ref));
  } catch { return { checked: 0, pushed: 0, open: 0, failed: ["pre-0115"] }; }

  const seen = new Set<string>();
  for (const w of WATCHERS) {
    const s = settings.get(w.key);
    if (s && !s.enabled) continue;
    const threshold = s?.threshold ?? w.defaultThreshold ?? 0;
    let findings: Finding[];
    try { findings = await w.check(env, threshold); checked++; }
    catch (e) { failed.push(`${w.key}: ${e instanceof Error ? e.message : String(e)}`); continue; }
    for (const f of findings) {
      seen.add(f.ref);
      open++;
      if (known.has(f.ref)) {
        await env.DB.prepare(`UPDATE watcher_open SET last_seen = datetime('now'), title = ?2 WHERE ref = ?1`).bind(f.ref, f.title).run();
        continue;
      }
      await env.DB.prepare(`INSERT OR IGNORE INTO watcher_open (ref, watcher, title) VALUES (?1, ?2, ?3)`).bind(f.ref, w.key, f.title).run();
      const { results: people } = await env.DB.prepare(
        `SELECT id FROM users WHERE is_active = 1 AND role IN (${w.audience.map(() => "?").join(",")})`,
      ).bind(...w.audience).all<{ id: number }>();
      for (const p of people) await notify(env, p.id, "watch", `👁 ${f.title}`, `watch:${f.ref}`);
      pushed++;
    }
  }
  /* findings that are gone are cleared, so they are new again if they return */
  const stale = [...known].filter((r) => !seen.has(r));
  for (const r of stale) await env.DB.prepare(`DELETE FROM watcher_open WHERE ref = ?1`).bind(r).run();
  /* the cron does not pass through the staff dispatch, so the topic is
     bumped by hand - an open Dashboard learns about a new finding at once */
  if (pushed > 0 || stale.length > 0) await bumpVersion(env, "watchers");
  return { checked, pushed, open, failed };
}

/** 08:00 MYT, to each executive: their desk, today's attendance so far,
    yesterday's web sales, open watcher findings. */
export async function morningBrief(env: Env): Promise<number> {
  const { results: execs } = await env.DB.prepare(
    `SELECT id, role, COALESCE(NULLIF(TRIM(full_name), ''), name) AS name FROM users WHERE is_active = 1 AND role IN ('ceo', 'coo', 'cco')`,
  ).all<{ id: number; role: string; name: string }>();
  if (execs.length === 0) return 0;

  const n = async (sql: string, ...binds: unknown[]): Promise<number | null> => {
    try { return (await env.DB.prepare(sql).bind(...binds).first<{ c: number }>())?.c ?? 0; } catch { return null; }
  };
  const clockedIn = await n(`SELECT COUNT(DISTINCT user_id) AS c FROM attendance_records WHERE type = 'clock_in' AND date(created_at, '+8 hours') = date('now', '+8 hours')`);
  const headcount = await n(`SELECT COUNT(*) AS c FROM users WHERE is_active = 1 AND role NOT IN ('customer', 'super_admin', 'admin')`);
  const yesterdayCents = await n(`SELECT COALESCE(SUM(COALESCE(booked_cents, total_cents)), 0) AS c FROM web_orders WHERE paid_seen_at IS NOT NULL AND date(paid_seen_at, '+8 hours') = date('now', '+8 hours', '-1 day')`);
  const yesterdayOrders = await n(`SELECT COUNT(*) AS c FROM web_orders WHERE paid_seen_at IS NOT NULL AND date(paid_seen_at, '+8 hours') = date('now', '+8 hours', '-1 day')`);
  const openWatch = await n(`SELECT COUNT(*) AS c FROM watcher_open`);

  let sent = 0;
  for (const e of execs) {
    const desk = await deskItems(env, e).catch(() => ({ items: [], counts: {}, missing: [] as string[] }));
    const overdue = desk.items.filter((i) => i.overdue).length;
    const parts: string[] = [];
    parts.push(desk.items.length === 0 ? "Nothing is waiting on you" : `${desk.items.length} waiting on you${overdue ? ` (${overdue} overdue)` : ""}`);
    if (clockedIn !== null && headcount !== null) parts.push(`${clockedIn} of ${headcount} clocked in so far`);
    if (yesterdayOrders !== null && yesterdayCents !== null) parts.push(`yesterday: ${yesterdayOrders} web order${yesterdayOrders === 1 ? "" : "s"}, RM ${(yesterdayCents / 100).toFixed(2)}`);
    if (openWatch) parts.push(`${openWatch} watcher finding${openWatch === 1 ? "" : "s"} open`);
    const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    await notify(env, e.id, "brief", `☀ Good morning, ${e.name.split(" ")[0]}. ${parts.join(" · ")}.`, `brief:${day}`);
    sent++;
  }
  return sent;
}

/* ---------------- the settings and findings, for the card ---------------- */

export async function handleWatchers(env: Env, method: string, subPath: string, body: Record<string, unknown> | null, user: { id: number; role: string }): Promise<Response | null> {
  const exec = EXEC.includes(user.role) || user.role === "super_admin" || user.role === "admin";
  if (subPath === "" && method === "GET") {
    if (!exec) return json({ error: { code: "forbidden", message: "Watchers are for the executive tier" } }, 403);
    const settings = await settingsFor(env);
    let open: { ref: string; watcher: string; title: string; first_seen: string }[] = [];
    let pending = false;
    try {
      ({ results: open } = await env.DB.prepare(`SELECT ref, watcher, title, first_seen FROM watcher_open ORDER BY first_seen ASC LIMIT 200`).all());
    } catch { pending = true; }
    return json({
      watchers: WATCHERS.map((w) => ({
        key: w.key, label: w.label, audience: w.audience, tab: w.tab,
        threshold_label: w.thresholdLabel, default_threshold: w.defaultThreshold,
        enabled: settings.get(w.key)?.enabled ?? true,
        threshold: settings.get(w.key)?.threshold ?? w.defaultThreshold,
        open: open.filter((o) => o.watcher === w.key).length,
      })),
      open, pending_migration: pending,
    });
  }
  const m = /^\/([a-z_]+)$/.exec(subPath);
  if (m && method === "PUT") {
    /* only the CEO changes a rule; the COO and CCO read */
    if (user.role !== "ceo" && user.role !== "super_admin") return json({ error: { code: "forbidden", message: "Only the CEO changes a watcher" } }, 403);
    const w = WATCHERS.find((x) => x.key === m[1]);
    if (!w) return json({ error: { code: "not_found", message: "No such watcher" } }, 404);
    const enabled = body?.enabled === undefined ? null : body.enabled ? 1 : 0;
    const threshold = body?.threshold === undefined || body.threshold === null ? null : Number(body.threshold);
    if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0 || threshold > 3650)) {
      return json({ error: { code: "invalid_input", message: "threshold must be a whole number of 0 to 3650" } }, 400);
    }
    try {
      await env.DB.prepare(
        `INSERT INTO watcher_settings (key, enabled, threshold, updated_by) VALUES (?1, COALESCE(?2, 1), COALESCE(?3, ?4), ?5)
         ON CONFLICT(key) DO UPDATE SET enabled = COALESCE(?2, enabled), threshold = COALESCE(?3, threshold), updated_by = ?5, updated_at = datetime('now')`,
      ).bind(w.key, enabled, threshold, w.defaultThreshold, user.id).run();
    } catch {
      return json({ error: { code: "pending_migration", message: "Run the deploy so migration 0115 applies" } }, 409);
    }
    return json({ ok: true, key: w.key, enabled: enabled === null ? undefined : enabled === 1, threshold: threshold ?? undefined });
  }
  if (subPath === "/run" && method === "POST") {
    if (user.role !== "ceo" && user.role !== "super_admin") return json({ error: { code: "forbidden", message: "Only the CEO runs the watchers by hand" } }, 403);
    const r = await runWatchers(env);
    return json({ ok: true, ...r });
  }
  return null;
}
