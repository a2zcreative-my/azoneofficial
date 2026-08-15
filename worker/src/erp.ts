/* v1.18.0 — the ERP module (programme phases 4–7).
 *
 * Orders (unified product+service model) · Cash Flow · Reconciliation ·
 * Commission · Ads Fund · Purchasing · Accounting (GL + journal + trial
 * balance). Mounted under /api/v1/staff/erp/* by handleStaff, so every route
 * here already sits behind session auth; each one then checks its own
 * permission from permissions.ts — the SAME matrix that gates the tabs.
 *
 * Conventions carried over from the rest of the Worker:
 *  - money is integer cents end to end; the API accepts RM decimals and
 *    converts ONCE at the edge via cents() (NUMBERS ONLY — the 0°,0° lesson);
 *  - every write lands one audit_log row;
 *  - migration-skew never 500s a whole tab: table-missing errors return an
 *    empty list plus a `pending_migration` flag the UI can surface.
 */

import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { audit, cents, err, json, logError, num, str } from "./shared";
import { can } from "./permissions";

/* Doc numbering, same shape as sales_documents: PREFIX-YYYY-NNNN. The count
   query and the insert are not atomic; at this company's write volume (a few
   docs a day, one office) a doc_no collision means two people pressed Save in
   the same millisecond — the UNIQUE constraint turns that into a clean 400
   rather than a duplicate. */
async function nextNo(env: Env, table: "orders" | "purchase_orders", col: string, prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} LIKE ?1`,
  ).bind(`${prefix}-${year}-%`).first<{ n: number }>();
  return `${prefix}-${year}-${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
}

const isMissingTable = (e: unknown): boolean =>
  e instanceof Error && /no such table/i.test(e.message);

/** Empty-but-honest response when 0071 hasn't been applied yet. */
function pendingMigration(listKey: string): Response {
  return json({ [listKey]: [], pending_migration: true });
}

export async function handleErp(
  env: Env,
  path: string, // stripped of /erp, starts with /
  method: string,
  body: Record<string, unknown> | null,
  user: StaffUser,
): Promise<Response | null> {
  try {
    /* ================= Phase 4 — unified orders ================= */

    if (path === "/orders" && method === "GET") {
      if (!can(user.role, "orders_manage")) return err("forbidden", "No access to orders", 403);
      const rows = await env.DB.prepare(
        `SELECT o.*, (SELECT COUNT(*) FROM order_lines l WHERE l.order_id = o.id) AS line_count
           FROM orders o ORDER BY o.id DESC LIMIT 500`,
      ).all();
      return json({ orders: rows.results ?? [] });
    }

    if (path === "/orders" && method === "POST") {
      if (!can(user.role, "orders_manage")) return err("forbidden", "No access to orders", 403);
      const customer = str(body?.customer, 200) ? (body!.customer as string).trim() : "";
      const source = str(body?.source, 20) && ["tiktok", "shopee", "lazada", "direct", "stokis"].includes(body!.source as string)
        ? (body!.source as string) : "direct";
      const notes = str(body?.notes, 1000) ? (body!.notes as string) : "";
      const rawLines = Array.isArray(body?.lines) ? (body!.lines as Record<string, unknown>[]) : [];
      if (rawLines.length === 0) return err("validation", "An order needs at least one line", 400);
      if (rawLines.length > 100) return err("validation", "Too many lines (max 100)", 400);

      type Line = {
        kind: "product" | "service"; title: string;
        sku: string | null; qty: number | null; unit_price_cents: number | null; cost_cents: number | null;
        host_id: number | null; starts_at: string | null; ends_at: string | null; hours: number | null; rate_cents: number | null;
        line_total_cents: number;
      };
      const lines: Line[] = [];
      for (const l of rawLines) {
        const kind = l.kind === "service" ? "service" : "product";
        const title = str(l.title, 300) ? (l.title as string).trim() : "";
        if (!title) return err("validation", "Every line needs a title", 400);
        if (kind === "product") {
          const qty = num(l.qty);
          const unit = cents(l.unit_price);
          if (qty === null || qty <= 0 || qty > 100000 || unit === null) {
            return err("validation", `"${title}": product lines need a quantity and a unit price`, 400);
          }
          const cost = cents(l.cost) ?? 0;
          lines.push({
            kind, title, sku: str(l.sku, 100) ? (l.sku as string).trim() : null,
            qty, unit_price_cents: unit, cost_cents: cost,
            host_id: null, starts_at: null, ends_at: null, hours: null, rate_cents: null,
            line_total_cents: Math.round(qty * unit),
          });
        } else {
          const hours = num(l.hours);
          const rate = cents(l.rate);
          const hostId = num(l.host_id);
          if (hours === null || hours <= 0 || hours > 24 * 31 || rate === null) {
            return err("validation", `"${title}": service lines need hours and an hourly rate`, 400);
          }
          lines.push({
            kind, title, sku: null, qty: null, unit_price_cents: null, cost_cents: null,
            host_id: hostId, starts_at: str(l.starts_at, 30) ? (l.starts_at as string) : null,
            ends_at: str(l.ends_at, 30) ? (l.ends_at as string) : null,
            hours, rate_cents: rate, line_total_cents: Math.round(hours * rate),
          });
        }
      }
      const kinds = new Set(lines.map((l) => l.kind));
      const kind = kinds.size === 2 ? "mixed" : (lines[0]?.kind ?? "product");
      const subtotal = lines.reduce((a, l) => a + l.line_total_cents, 0);
      const taxPct = num(body?.tax_percent) ?? 0;
      const tax = taxPct > 0 && taxPct <= 30 ? Math.round(subtotal * taxPct / 100) : 0;
      const docNo = await nextNo(env, "orders", "doc_no", "ORD");

      const res = await env.DB.prepare(
        `INSERT INTO orders (doc_no, customer, kind, status, source, subtotal_cents, tax_cents, total_cents, notes, created_by)
         VALUES (?1, ?2, ?3, 'draft', ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
      ).bind(docNo, customer, kind, source, subtotal, tax, subtotal + tax, notes, user.id).first<{ id: number }>();
      const orderId = res?.id;
      if (!orderId) return err("server", "Order insert failed", 500);
      for (const l of lines) {
        await env.DB.prepare(
          `INSERT INTO order_lines (order_id, kind, title, sku, qty, unit_price_cents, cost_cents, host_id, starts_at, ends_at, hours, rate_cents, line_total_cents)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
        ).bind(orderId, l.kind, l.title, l.sku, l.qty, l.unit_price_cents, l.cost_cents,
          l.host_id, l.starts_at, l.ends_at, l.hours, l.rate_cents, l.line_total_cents).run();
      }
      await audit(env, user.id, "erp.order_create", "orders", String(orderId), { doc_no: docNo, kind, total: subtotal + tax });
      return json({ id: orderId, doc_no: docNo, kind, total_cents: subtotal + tax }, 201);
    }

    {
      const m = /^\/orders\/(\d+)$/.exec(path);
      if (m && method === "GET") {
        if (!can(user.role, "orders_manage")) return err("forbidden", "No access to orders", 403);
        const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?1`).bind(Number(m[1])).first();
        if (!order) return err("not_found", "Order not found", 404);
        const lines = await env.DB.prepare(`SELECT * FROM order_lines WHERE order_id = ?1 ORDER BY id`).bind(Number(m[1])).all();
        return json({ order, lines: lines.results ?? [] });
      }
      if (m && method === "PATCH") {
        if (!can(user.role, "orders_manage")) return err("forbidden", "No access to orders", 403);
        const status = str(body?.status, 20) ? (body!.status as string) : "";
        if (!["draft", "confirmed", "fulfilled", "cancelled"].includes(status)) {
          return err("validation", "Status must be draft, confirmed, fulfilled or cancelled", 400);
        }
        const r = await env.DB.prepare(
          `UPDATE orders SET status = ?1, updated_at = datetime('now') WHERE id = ?2`,
        ).bind(status, Number(m[1])).run();
        if (!r.meta.changes) return err("not_found", "Order not found", 404);
        await audit(env, user.id, "erp.order_status", "orders", m[1], { status });
        return json({ ok: true });
      }
    }

    /* ================= Phase 5 — Cash Flow ================= */

    if (path === "/banks" && method === "GET") {
      if (!can(user.role, "cashflow_manage")) return err("forbidden", "No access to cash flow", 403);
      const rows = await env.DB.prepare(`SELECT * FROM bank_accounts ORDER BY active DESC, name`).all();
      return json({ banks: rows.results ?? [] });
    }
    if (path === "/banks" && method === "POST") {
      if (!can(user.role, "cashflow_manage")) return err("forbidden", "No access to cash flow", 403);
      if (!str(body?.name, 100)) return err("validation", "The account needs a name", 400);
      const res = await env.DB.prepare(
        `INSERT INTO bank_accounts (name, bank, number_masked) VALUES (?1, ?2, ?3) RETURNING id`,
      ).bind((body!.name as string).trim(),
        str(body?.bank, 100) ? (body!.bank as string).trim() : "",
        str(body?.number_masked, 40) ? (body!.number_masked as string).trim() : "").first<{ id: number }>();
      await audit(env, user.id, "erp.bank_create", "bank_accounts", String(res?.id));
      return json({ id: res?.id }, 201);
    }

    if (path === "/cashflow" && method === "GET") {
      if (!can(user.role, "cashflow_manage")) return err("forbidden", "No access to cash flow", 403);
      const rows = await env.DB.prepare(
        `SELECT c.*, b.name AS bank_name FROM cashflow_entries c
           LEFT JOIN bank_accounts b ON b.id = c.bank_id
          ORDER BY c.entry_date DESC, c.id DESC LIMIT 1000`,
      ).all();
      return json({ entries: rows.results ?? [] });
    }
    if (path === "/cashflow" && method === "POST") {
      if (!can(user.role, "cashflow_manage")) return err("forbidden", "No access to cash flow", 403);
      const type = body?.type === "in" ? "in" : body?.type === "out" ? "out" : null;
      const amount = cents(body?.amount);
      const entryDate = str(body?.entry_date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(body!.entry_date as string)
        ? (body!.entry_date as string) : null;
      if (!type || amount === null || amount <= 0 || !entryDate) {
        return err("validation", "Cash flow entries need a date, a direction (in/out) and an amount above zero", 400);
      }
      const bankId = num(body?.bank_id);
      const res = await env.DB.prepare(
        `INSERT INTO cashflow_entries (entry_date, type, category, bank_id, amount_cents, description, ref, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
      ).bind(entryDate, type,
        str(body?.category, 100) ? (body!.category as string).trim() : "",
        bankId, amount,
        str(body?.description, 500) ? (body!.description as string).trim() : "",
        str(body?.ref, 100) ? (body!.ref as string).trim() : "",
        user.id).first<{ id: number }>();
      await audit(env, user.id, "erp.cashflow_create", "cashflow_entries", String(res?.id), { type, amount });
      return json({ id: res?.id }, 201);
    }
    {
      const m = /^\/cashflow\/(\d+)$/.exec(path);
      if (m && method === "DELETE") {
        if (!can(user.role, "cashflow_manage")) return err("forbidden", "No access to cash flow", 403);
        const r = await env.DB.prepare(`DELETE FROM cashflow_entries WHERE id = ?1`).bind(Number(m[1])).run();
        if (!r.meta.changes) return err("not_found", "Entry not found", 404);
        await audit(env, user.id, "erp.cashflow_delete", "cashflow_entries", m[1]);
        return json({ ok: true });
      }
    }

    /* ================= Phase 5 — Reconciliation ================= */

    if (path === "/reconciliation" && method === "GET") {
      if (!can(user.role, "reconcile_manage")) return err("forbidden", "No access to reconciliation", 403);
      const rows = await env.DB.prepare(
        `SELECT * FROM reconciliations ORDER BY period DESC, id DESC LIMIT 1000`,
      ).all();
      return json({ rows: rows.results ?? [] });
    }
    if (path === "/reconciliation" && method === "POST") {
      if (!can(user.role, "reconcile_manage")) return err("forbidden", "No access to reconciliation", 403);
      const period = str(body?.period, 7) && /^\d{4}-\d{2}$/.test(body!.period as string) ? (body!.period as string) : null;
      if (!period) return err("validation", "Period must be YYYY-MM", 400);
      const channel = str(body?.channel, 20) && ["tiktok", "shopee", "lazada", "direct", "stokis"].includes(body!.channel as string)
        ? (body!.channel as string) : "tiktok";
      const est = cents(body?.est_sales) ?? 0;
      const actual = cents(body?.actual_sales) ?? 0;
      const cost = cents(body?.actual_cost) ?? 0;
      const fees = cents(body?.fees) ?? 0;
      const shipping = cents(body?.shipping) ?? 0;
      const res = await env.DB.prepare(
        `INSERT INTO reconciliations (period, channel, order_id, order_no, customer, est_sales_cents, actual_sales_cents, actual_cost_cents, fees_cents, shipping_cents, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`,
      ).bind(period, channel, num(body?.order_id),
        str(body?.order_no, 60) ? (body!.order_no as string).trim() : "",
        str(body?.customer, 200) ? (body!.customer as string).trim() : "",
        est, actual, cost, fees, shipping, user.id).first<{ id: number }>();
      await audit(env, user.id, "erp.recon_create", "reconciliations", String(res?.id), { period, channel });
      return json({ id: res?.id }, 201);
    }
    {
      const m = /^\/reconciliation\/(\d+)$/.exec(path);
      if (m && method === "PATCH") {
        if (!can(user.role, "reconcile_manage")) return err("forbidden", "No access to reconciliation", 403);
        const status = str(body?.status, 20) ? (body!.status as string) : "";
        if (!["pending", "reconciled", "disputed"].includes(status)) {
          return err("validation", "Status must be pending, reconciled or disputed", 400);
        }
        const r = await env.DB.prepare(`UPDATE reconciliations SET status = ?1 WHERE id = ?2`)
          .bind(status, Number(m[1])).run();
        if (!r.meta.changes) return err("not_found", "Row not found", 404);
        await audit(env, user.id, "erp.recon_status", "reconciliations", m[1], { status });
        return json({ ok: true });
      }
    }

    /* ================= Phase 6 — Commission ================= */

    if (path === "/hosts" && method === "GET") {
      // Host picker for rates/entries — names only, no personal fields.
      if (!can(user.role, "commission_view")) return err("forbidden", "No access to commission", 403);
      const rows = await env.DB.prepare(
        `SELECT id, name FROM users WHERE role IN ('live_host', 'sales_marketing', 'marketing', 'editor') AND (suspended IS NULL OR suspended = 0) ORDER BY name`,
      ).all();
      return json({ hosts: rows.results ?? [] });
    }

    if (path === "/commission/rates" && method === "GET") {
      if (!can(user.role, "commission_view")) return err("forbidden", "No access to commission", 403);
      const rows = await env.DB.prepare(
        `SELECT r.*, u.name AS host_name FROM commission_rates r JOIN users u ON u.id = r.host_id
          ORDER BY u.name, r.effective_from DESC`,
      ).all();
      return json({ rates: rows.results ?? [] });
    }
    if (path === "/commission/rates" && method === "POST") {
      if (!can(user.role, "commission_decide")) return err("forbidden", "Only the CEO tier sets commission rates", 403);
      const hostId = num(body?.host_id);
      const percent = num(body?.percent);
      const perHour = cents(body?.per_hour) ?? 0;
      const from = str(body?.effective_from, 10) && /^\d{4}-\d{2}-\d{2}$/.test(body!.effective_from as string)
        ? (body!.effective_from as string) : null;
      if (hostId === null || percent === null || percent < 0 || percent > 50 || !from) {
        return err("validation", "A rate needs a host, a percent (0–50) and an effective date", 400);
      }
      const res = await env.DB.prepare(
        `INSERT INTO commission_rates (host_id, percent, per_hour_cents, effective_from) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
      ).bind(hostId, percent, perHour, from).first<{ id: number }>();
      await audit(env, user.id, "erp.commission_rate", "commission_rates", String(res?.id), { hostId, percent, perHour });
      return json({ id: res?.id }, 201);
    }

    if (path === "/commission" && method === "GET") {
      if (!can(user.role, "commission_view")) return err("forbidden", "No access to commission", 403);
      const rows = await env.DB.prepare(
        `SELECT e.*, u.name AS host_name FROM commission_entries e JOIN users u ON u.id = e.host_id
          ORDER BY e.period DESC, e.id DESC LIMIT 1000`,
      ).all();
      return json({ entries: rows.results ?? [] });
    }
    if (path === "/commission" && method === "POST") {
      if (!can(user.role, "commission_view")) return err("forbidden", "No access to commission", 403);
      const hostId = num(body?.host_id);
      const period = str(body?.period, 7) && /^\d{4}-\d{2}$/.test(body!.period as string) ? (body!.period as string) : null;
      const basis = cents(body?.basis);
      if (hostId === null || !period || basis === null) {
        return err("validation", "A commission entry needs a host, a period (YYYY-MM) and a basis amount", 400);
      }
      /* Amount = latest effective rate applied server-side. The client may
         NOT send the amount: the rate table is the single authority, so a
         typo in a form can never overpay a host. */
      const rate = await env.DB.prepare(
        `SELECT percent, per_hour_cents FROM commission_rates
          WHERE host_id = ?1 AND effective_from <= date('now')
          ORDER BY effective_from DESC LIMIT 1`,
      ).bind(hostId).first<{ percent: number; per_hour_cents: number }>();
      if (!rate) return err("validation", "No commission rate is set for this host yet — set the rate first", 400);
      const hours = num(body?.hours) ?? 0;
      const amount = Math.round(basis * rate.percent / 100) + Math.round(hours * rate.per_hour_cents);
      const res = await env.DB.prepare(
        `INSERT INTO commission_entries (host_id, order_id, period, basis_cents, amount_cents, note, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(hostId, num(body?.order_id), period, basis, amount,
        str(body?.note, 300) ? (body!.note as string).trim() : "", user.id).first<{ id: number }>();
      await audit(env, user.id, "erp.commission_entry", "commission_entries", String(res?.id), { hostId, period, amount });
      return json({ id: res?.id, amount_cents: amount }, 201);
    }
    {
      const m = /^\/commission\/(\d+)$/.exec(path);
      if (m && method === "PATCH") {
        if (!can(user.role, "commission_decide")) return err("forbidden", "Only the CEO tier approves commission", 403);
        const status = str(body?.status, 20) ? (body!.status as string) : "";
        if (!["pending", "approved", "paid"].includes(status)) return err("validation", "Status must be pending, approved or paid", 400);
        const r = await env.DB.prepare(`UPDATE commission_entries SET status = ?1 WHERE id = ?2`).bind(status, Number(m[1])).run();
        if (!r.meta.changes) return err("not_found", "Entry not found", 404);
        await audit(env, user.id, "erp.commission_status", "commission_entries", m[1], { status });
        return json({ ok: true });
      }
    }

    /* ================= Phase 6 — Ads Fund ================= */

    if (path === "/adsfund" && method === "GET") {
      if (!can(user.role, "adsfund_claim")) return err("forbidden", "No access to the ads fund", 403);
      const allocs = await env.DB.prepare(
        `SELECT a.*,
                (SELECT COALESCE(SUM(c.amount_cents), 0) FROM ads_fund_claims c WHERE c.allocation_id = a.id AND c.status = 'approved') AS approved_cents,
                (SELECT COALESCE(SUM(c.amount_cents), 0) FROM ads_fund_claims c WHERE c.allocation_id = a.id AND c.status = 'pending') AS pending_cents
           FROM ads_fund_allocations a ORDER BY a.period DESC, a.id DESC LIMIT 200`,
      ).all();
      const claims = await env.DB.prepare(
        `SELECT c.*, u.name AS claimant FROM ads_fund_claims c JOIN users u ON u.id = c.created_by
          ORDER BY c.id DESC LIMIT 500`,
      ).all();
      return json({ allocations: allocs.results ?? [], claims: claims.results ?? [] });
    }
    if (path === "/adsfund" && method === "POST") {
      if (!can(user.role, "adsfund_manage")) return err("forbidden", "Only management allocates the ads fund", 403);
      const period = str(body?.period, 7) && /^\d{4}-\d{2}$/.test(body!.period as string) ? (body!.period as string) : null;
      const amount = cents(body?.amount);
      if (!period || amount === null || amount <= 0) return err("validation", "An allocation needs a period (YYYY-MM) and an amount", 400);
      const res = await env.DB.prepare(
        `INSERT INTO ads_fund_allocations (period, channel, amount_cents, notes, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      ).bind(period, str(body?.channel, 20) ? (body!.channel as string) : "tiktok", amount,
        str(body?.notes, 500) ? (body!.notes as string).trim() : "", user.id).first<{ id: number }>();
      await audit(env, user.id, "erp.adsfund_alloc", "ads_fund_allocations", String(res?.id), { period, amount });
      return json({ id: res?.id }, 201);
    }
    {
      const m = /^\/adsfund\/(\d+)\/claims$/.exec(path);
      if (m && method === "POST") {
        if (!can(user.role, "adsfund_claim")) return err("forbidden", "No access to the ads fund", 403);
        const amount = cents(body?.amount);
        if (amount === null || amount <= 0 || !str(body?.description, 500)) {
          return err("validation", "A claim needs an amount and what it was spent on", 400);
        }
        const alloc = await env.DB.prepare(
          `SELECT a.amount_cents,
                  (SELECT COALESCE(SUM(c.amount_cents), 0) FROM ads_fund_claims c
                    WHERE c.allocation_id = a.id AND c.status IN ('pending', 'approved')) AS used_cents
             FROM ads_fund_allocations a WHERE a.id = ?1`,
        ).bind(Number(m[1])).first<{ amount_cents: number; used_cents: number }>();
        if (!alloc) return err("not_found", "Allocation not found", 404);
        if (alloc.used_cents + amount > alloc.amount_cents) {
          return err("over_budget",
            `That claim would take this allocation to RM ${((alloc.used_cents + amount) / 100).toFixed(2)} of its RM ${(alloc.amount_cents / 100).toFixed(2)} budget`, 400);
        }
        const res = await env.DB.prepare(
          `INSERT INTO ads_fund_claims (allocation_id, amount_cents, description, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
        ).bind(Number(m[1]), amount, (body!.description as string).trim(), user.id).first<{ id: number }>();
        await audit(env, user.id, "erp.adsfund_claim", "ads_fund_claims", String(res?.id), { amount });
        return json({ id: res?.id }, 201);
      }
    }
    {
      const m = /^\/adsfund\/claims\/(\d+)$/.exec(path);
      if (m && method === "PATCH") {
        if (!can(user.role, "adsfund_manage")) return err("forbidden", "Only management decides ads fund claims", 403);
        const status = body?.status === "approved" ? "approved" : body?.status === "rejected" ? "rejected" : null;
        if (!status) return err("validation", "Status must be approved or rejected", 400);
        const r = await env.DB.prepare(
          `UPDATE ads_fund_claims SET status = ?1, decided_by = ?2, decided_at = datetime('now') WHERE id = ?3 AND status = 'pending'`,
        ).bind(status, user.id, Number(m[1])).run();
        if (!r.meta.changes) return err("not_found", "Claim not found or already decided", 404);
        await audit(env, user.id, "erp.adsfund_decide", "ads_fund_claims", m[1], { status });
        return json({ ok: true });
      }
    }

    /* ================= Phase 7 — Purchasing ================= */

    if (path === "/suppliers" && method === "GET") {
      if (!can(user.role, "purchasing_manage")) return err("forbidden", "No access to purchasing", 403);
      const rows = await env.DB.prepare(`SELECT * FROM suppliers ORDER BY active DESC, name`).all();
      return json({ suppliers: rows.results ?? [] });
    }
    if (path === "/suppliers" && method === "POST") {
      if (!can(user.role, "purchasing_manage")) return err("forbidden", "No access to purchasing", 403);
      if (!str(body?.name, 200)) return err("validation", "The supplier needs a name", 400);
      const res = await env.DB.prepare(
        `INSERT INTO suppliers (name, contact, phone, email, notes) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      ).bind((body!.name as string).trim(),
        str(body?.contact, 200) ? (body!.contact as string).trim() : "",
        str(body?.phone, 40) ? (body!.phone as string).trim() : "",
        str(body?.email, 200) ? (body!.email as string).trim() : "",
        str(body?.notes, 500) ? (body!.notes as string).trim() : "").first<{ id: number }>();
      await audit(env, user.id, "erp.supplier_create", "suppliers", String(res?.id));
      return json({ id: res?.id }, 201);
    }

    if (path === "/purchase-orders" && method === "GET") {
      if (!can(user.role, "purchasing_manage")) return err("forbidden", "No access to purchasing", 403);
      const rows = await env.DB.prepare(
        `SELECT p.*, s.name AS supplier_name FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
          ORDER BY p.id DESC LIMIT 500`,
      ).all();
      return json({ pos: rows.results ?? [] });
    }
    if (path === "/purchase-orders" && method === "POST") {
      if (!can(user.role, "purchasing_manage")) return err("forbidden", "No access to purchasing", 403);
      const supplierId = num(body?.supplier_id);
      if (supplierId === null) return err("validation", "Pick a supplier", 400);
      const rawItems = Array.isArray(body?.items) ? (body!.items as Record<string, unknown>[]) : [];
      if (rawItems.length === 0 || rawItems.length > 100) return err("validation", "A purchase order needs 1–100 items", 400);
      const items: { title: string; qty: number; unit_cents: number }[] = [];
      for (const it of rawItems) {
        const title = str(it.title, 300) ? (it.title as string).trim() : "";
        const qty = num(it.qty);
        const unit = cents(it.unit_price);
        if (!title || qty === null || qty <= 0 || unit === null) {
          return err("validation", "Every item needs a title, a quantity and a unit price", 400);
        }
        items.push({ title, qty, unit_cents: unit });
      }
      const total = items.reduce((a, it) => a + Math.round(it.qty * it.unit_cents), 0);
      const poNo = await nextNo(env, "purchase_orders", "po_no", "PO");
      const res = await env.DB.prepare(
        `INSERT INTO purchase_orders (po_no, supplier_id, items, total_cents, expected_date, notes, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`,
      ).bind(poNo, supplierId, JSON.stringify(items), total,
        str(body?.expected_date, 10) ? (body!.expected_date as string) : null,
        str(body?.notes, 500) ? (body!.notes as string).trim() : "", user.id).first<{ id: number }>();
      await audit(env, user.id, "erp.po_create", "purchase_orders", String(res?.id), { poNo, total });
      return json({ id: res?.id, po_no: poNo, total_cents: total }, 201);
    }
    {
      const m = /^\/purchase-orders\/(\d+)$/.exec(path);
      if (m && method === "PATCH") {
        if (!can(user.role, "purchasing_manage")) return err("forbidden", "No access to purchasing", 403);
        const status = str(body?.status, 20) ? (body!.status as string) : "";
        if (!["draft", "sent", "received", "cancelled"].includes(status)) {
          return err("validation", "Status must be draft, sent, received or cancelled", 400);
        }
        const r = await env.DB.prepare(
          `UPDATE purchase_orders SET status = ?1, updated_at = datetime('now') WHERE id = ?2`,
        ).bind(status, Number(m[1])).run();
        if (!r.meta.changes) return err("not_found", "PO not found", 404);
        await audit(env, user.id, "erp.po_status", "purchase_orders", m[1], { status });
        return json({ ok: true });
      }
    }

    /* ================= Phase 7 — Accounting ================= */

    if (path === "/gl/accounts" && method === "GET") {
      if (!can(user.role, "accounting_manage")) return err("forbidden", "No access to accounting", 403);
      const rows = await env.DB.prepare(`SELECT * FROM gl_accounts ORDER BY code`).all();
      return json({ accounts: rows.results ?? [] });
    }
    if (path === "/gl/accounts" && method === "POST") {
      if (!can(user.role, "accounting_manage")) return err("forbidden", "No access to accounting", 403);
      const code = str(body?.code, 10) ? (body!.code as string).trim() : "";
      const name = str(body?.name, 200) ? (body!.name as string).trim() : "";
      const type = str(body?.type, 12) && ["asset", "liability", "equity", "income", "expense"].includes(body!.type as string)
        ? (body!.type as string) : "";
      if (!/^\d{4}$/.test(code) || !name || !type) {
        return err("validation", "An account needs a 4-digit code, a name and a type", 400);
      }
      try {
        const res = await env.DB.prepare(
          `INSERT INTO gl_accounts (code, name, type) VALUES (?1, ?2, ?3) RETURNING id`,
        ).bind(code, name, type).first<{ id: number }>();
        await audit(env, user.id, "erp.gl_account", "gl_accounts", String(res?.id), { code, name });
        return json({ id: res?.id }, 201);
      } catch {
        return err("duplicate", `Account code ${code} already exists`, 400);
      }
    }

    if (path === "/gl/journal" && method === "GET") {
      if (!can(user.role, "accounting_manage")) return err("forbidden", "No access to accounting", 403);
      const entries = await env.DB.prepare(
        `SELECT * FROM journal_entries ORDER BY entry_date DESC, id DESC LIMIT 300`,
      ).all();
      const lines = await env.DB.prepare(
        `SELECT l.*, a.code, a.name AS account_name FROM journal_lines l JOIN gl_accounts a ON a.id = l.account_id
          WHERE l.entry_id IN (SELECT id FROM journal_entries ORDER BY entry_date DESC, id DESC LIMIT 300)`,
      ).all();
      return json({ entries: entries.results ?? [], lines: lines.results ?? [] });
    }
    if (path === "/gl/journal" && method === "POST") {
      if (!can(user.role, "accounting_manage")) return err("forbidden", "No access to accounting", 403);
      const entryDate = str(body?.entry_date, 10) && /^\d{4}-\d{2}-\d{2}$/.test(body!.entry_date as string)
        ? (body!.entry_date as string) : null;
      const rawLines = Array.isArray(body?.lines) ? (body!.lines as Record<string, unknown>[]) : [];
      if (!entryDate || rawLines.length < 2 || rawLines.length > 50) {
        return err("validation", "A journal entry needs a date and at least two lines", 400);
      }
      const lines: { account_id: number; debit: number; credit: number }[] = [];
      for (const l of rawLines) {
        const accountId = num(l.account_id);
        const debit = cents(l.debit) ?? 0;
        const credit = cents(l.credit) ?? 0;
        if (accountId === null || (debit === 0 && credit === 0) || (debit > 0 && credit > 0)) {
          return err("validation", "Each line needs an account and EITHER a debit OR a credit", 400);
        }
        lines.push({ account_id: accountId, debit, credit });
      }
      const totalDebit = lines.reduce((a, l) => a + l.debit, 0);
      const totalCredit = lines.reduce((a, l) => a + l.credit, 0);
      /* THE accounting invariant. Refusing here is what makes the trial
         balance below always balance — an unbalanced entry can never enter. */
      if (totalDebit !== totalCredit) {
        return err("unbalanced",
          `Debits (RM ${(totalDebit / 100).toFixed(2)}) must equal credits (RM ${(totalCredit / 100).toFixed(2)})`, 400);
      }
      const res = await env.DB.prepare(
        `INSERT INTO journal_entries (entry_date, memo, ref, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
      ).bind(entryDate,
        str(body?.memo, 300) ? (body!.memo as string).trim() : "",
        str(body?.ref, 100) ? (body!.ref as string).trim() : "", user.id).first<{ id: number }>();
      const entryId = res?.id;
      if (!entryId) return err("server", "Journal insert failed", 500);
      for (const l of lines) {
        await env.DB.prepare(
          `INSERT INTO journal_lines (entry_id, account_id, debit_cents, credit_cents) VALUES (?1, ?2, ?3, ?4)`,
        ).bind(entryId, l.account_id, l.debit, l.credit).run();
      }
      await audit(env, user.id, "erp.journal_create", "journal_entries", String(entryId), { total: totalDebit });
      return json({ id: entryId }, 201);
    }

    if (path === "/gl/trial-balance" && method === "GET") {
      if (!can(user.role, "accounting_manage")) return err("forbidden", "No access to accounting", 403);
      const rows = await env.DB.prepare(
        `SELECT a.id, a.code, a.name, a.type,
                COALESCE(SUM(l.debit_cents), 0) AS debit_cents,
                COALESCE(SUM(l.credit_cents), 0) AS credit_cents
           FROM gl_accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
          WHERE a.active = 1
          GROUP BY a.id ORDER BY a.code`,
      ).all();
      return json({ accounts: rows.results ?? [] });
    }

    return null; // unknown /erp path → handleStaff's 404
  } catch (e) {
    if (isMissingTable(e)) {
      /* 0071 not applied yet. The UI shows "run the deploy migrations" rather
         than a broken tab; nothing 500s. */
      await logError(env, "erp_migration_skew", e instanceof Error ? e.message : String(e), path);
      if (method === "GET") return pendingMigration(path.includes("cashflow") ? "entries" : path.includes("order") ? "orders" : "rows");
      return err("pending_migration", "The ERP tables are not migrated yet — run DEPLOY.bat so step 2 applies migration 0071.", 503);
    }
    await logError(env, "erp", e instanceof Error ? e.message : String(e), path);
    return err("server", "Something went wrong in the ERP module — it has been logged.", 500);
  }
}
