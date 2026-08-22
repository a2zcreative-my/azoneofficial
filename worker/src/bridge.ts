/* v1.36.0–v1.38.0 — the ELFIA bridge's env-bound side: the movements
   endpoint (feed B), the orders poller (feed C), and their housekeeping.
   Decision logic lives in bridge-core.ts (pure, guard-tested); this file is
   the wiring: D1, R2-free, no cookies, no CORS — server-to-server only.

   The one rule that must not be got wrong (PORTAL-BRIDGE-SPEC.md):
   any event_id NOT in one of the three response lists is treated as
   undelivered and WILL be sent again. Silence means retry. So the lists must
   be truthful — never add an id that was not actually processed, never omit
   one that was. */

import type { Env } from "./index";
import { json, err, logError, postJournal } from "./shared";
import {
  parseBatch, skuKey, planApply, bridgeStockStatus,
  parseWebOrder, parseWebOrderLines, isPaidStatus,
} from "./bridge-core";

const MAX_BODY_BYTES = 64 * 1024; // same cap as the TikTok webhook

/** Constant-time compare — local copy (index.ts's is module-private, and a
    bridge auth check must never become a timing oracle). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bridgeAuth(request: Request, env: Env): Response | null {
  if (!env.ELFIA_BRIDGE_KEY) return err("not_configured", "Bridge is not enabled", 501);
  const given = request.headers.get("X-Bridge-Key") ?? "";
  if (!constantTimeEqual(given, env.ELFIA_BRIDGE_KEY)) {
    return err("unauthorized", "Bad bridge key", 401);
  }
  return null;
}

/* ==================== feed B — movements (store → portal) ==================== */

export async function handleElfiaMovements(request: Request, env: Env): Promise<Response> {
  const unauthorized = bridgeAuth(request, env);
  if (unauthorized) return unauthorized;

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return err("too_large", "Body exceeds 64KB", 400);
  let parsedBody: unknown;
  try { parsedBody = JSON.parse(rawBody); } catch { return err("invalid_json", "Body must be JSON", 400); }
  const batch = parseBatch(parsedBody);
  if (!batch) return err("invalid_input", "movements must be a non-empty array of at most 50", 400);

  const applied: string[] = [];
  const ignored: string[] = [];
  const unknownSku: string[] = [];

  for (const m of batch.parsed) {
    if (!m) continue; // malformed → in NO list → the store will resend it
    try {
      const key = skuKey(m.sku);
      /* Step 1 — the idempotency gate. ON CONFLICT DO NOTHING: zero rows
         changed means this event_id was already accounted for. Answer
         "ignored" and apply NOTHING — this is the line between one deduction
         and two. */
      const ins = await env.DB.prepare(
        `INSERT INTO bridge_events (source, event_id, sku, sku_key, delta, reason, reference, occurred_at, outcome)
         VALUES ('elfia', ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending')
         ON CONFLICT (source, event_id) DO NOTHING`,
      ).bind(m.event_id, m.sku, key, m.delta, m.reason, m.reference, m.occurred_at).run();
      if (!ins.meta.changes) { ignored.push(m.event_id); continue; }

      /* Step 2 — match the SKU (case- and whitespace-insensitive, the
         sku_key column maintained by every sku write). */
      const item = await env.DB.prepare(
        `SELECT id, sku, stock FROM inventory_items WHERE sku_key = ?1 LIMIT 1`,
      ).bind(key).first<{ id: number; sku: string; stock: number }>();
      if (!item) {
        await env.DB.prepare(
          `UPDATE bridge_events SET outcome = 'unknown_sku' WHERE source = 'elfia' AND event_id = ?1`,
        ).bind(m.event_id).run();
        unknownSku.push(m.event_id); // the store stops retrying and shows it in /admin
        continue;
      }

      /* Step 3 — apply, clamped at zero. The pieces already physically left
         the shop; refusing would make the store retry forever. */
      const plan = planApply(item.stock, m.delta);
      await env.DB.prepare(
        `UPDATE inventory_items SET stock = ?1, status = ?2, updated_at = datetime('now') WHERE id = ?3`,
      ).bind(plan.newStock, bridgeStockStatus(plan.newStock), item.id).run();

      /* Step 4 — the trails. One append-only ledger row (the applied delta,
         which is what actually happened) … */
      await env.DB.prepare(
        `INSERT INTO stock_ledger (item_id, sku, delta, balance_after, source, ref_type, ref_id, reason)
         VALUES (?1, ?2, ?3, ?4, 'elfia', 'bridge_event', ?5, ?6)`,
      ).bind(item.id, item.sku, plan.appliedDelta, plan.newStock, m.event_id,
        `${m.reason ?? "movement"}${m.reference ? ` ${m.reference}` : ""}`).run();
      /* … and one manual_stockouts row so the Inventory tab's existing
         movement list shows web sales alongside everything else. remark is
         NOT NULL there — always provide one. */
      try {
        await env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, direction, out_date, created_by)
           SELECT i.id, i.sku, i.name, ?1, NULL, ?2, ?3, date('now', '+8 hours'), NULL
           FROM inventory_items i WHERE i.id = ?4`,
        ).bind(Math.abs(plan.appliedDelta), `ELFIA ${m.reason ?? "movement"}${m.reference ? ` ${m.reference}` : ""}`,
          plan.appliedDelta < 0 ? "out" : "in", item.id).run();
      } catch { /* pre-0064 — the ledger row above is the authoritative trail */ }

      await env.DB.prepare(
        `UPDATE bridge_events SET outcome = 'applied', item_id = ?1 WHERE source = 'elfia' AND event_id = ?2`,
      ).bind(item.id, m.event_id).run();
      applied.push(m.event_id);

      /* Step 5 — the loud parts. A clamp means the shop sold pieces the
         portal did not think existed: bell sales + CEO for reconciliation.
         The regular low-stock sweep (≤5, low_alerted dedupe) runs on the
         30-min cron and covers bridge deductions like any other. */
      if (plan.clamped) {
        try {
          const { results: alertStaff } = await env.DB.prepare(
            `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'ceo')`,
          ).all<{ id: number }>();
          for (const st of alertStaff) {
            await env.DB.prepare(
              `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'stock', ?2, ?3)`,
            ).bind(st.id,
              `⚠ ELFIA sold ${Math.abs(m.delta)}× ${item.sku} but the portal only had ${item.stock} — count clamped at 0. Reconcile the physical stock.`,
              `bridge_clamp:${item.id}`).run();
          }
        } catch { /* notification failure never blocks the movement */ }
      }
    } catch (e) {
      /* This movement failed mid-flight (D1 blip). Leave its id out of every
         list — the store resends it, and the ON CONFLICT gate makes the
         retry safe whether or not the event row survived. */
      await logError(env, "bridge_movements", e instanceof Error ? e.message : String(e), m.event_id);
    }
  }

  return json({ applied, ignored, unknown_sku: unknownSku });
}

/* ==================== feed C — orders (portal ← store) ==================== */

const CURSOR_KEY = "elfia_orders_cursor";
const POLL_FAIL_KEY = "elfia_poll_failures";

export async function pollElfiaOrders(env: Env): Promise<void> {
  if (!env.ELFIA_BRIDGE_KEY || !env.ELFIA_ORDERS_URL) return; // not configured — silent, like the TikTok cron
  try {
    let cursor: string | null = null;
    try {
      cursor = (await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`)
        .bind(CURSOR_KEY).first<{ value: string }>())?.value ?? null;
    } catch { /* pre-0057 system_meta — first poll starts from the beginning */ }

    for (let page = 0; page < 10; page++) { // hard stop: 10 pages per tick
      const url = cursor
        ? `${env.ELFIA_ORDERS_URL}?since=${encodeURIComponent(cursor)}`
        : env.ELFIA_ORDERS_URL;
      const res = await fetch(url, {
        headers: { "X-Bridge-Key": env.ELFIA_BRIDGE_KEY },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`orders feed answered ${res.status}`);
      const data = (await res.json()) as { orders?: unknown[]; cursor?: string };
      const orders = Array.isArray(data.orders) ? data.orders : [];

      for (const raw of orders) {
        const o = parseWebOrder(raw);
        if (!o) continue;
        await upsertWebOrder(env, o);
      }

      /* Persist the cursor only after the page is fully written — a crash
         mid-page re-reads that page next tick, and the upsert makes the
         re-read harmless. */
      if (typeof data.cursor === "string" && data.cursor !== "") {
        cursor = data.cursor;
        await env.DB.prepare(
          `INSERT INTO system_meta (key, value) VALUES (?1, ?2)
           ON CONFLICT (key) DO UPDATE SET value = ?2`,
        ).bind(CURSOR_KEY, cursor).run();
      }
      if (orders.length === 0) break;
    }

    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('elfia_last_poll', datetime('now'))
       ON CONFLICT (key) DO UPDATE SET value = datetime('now')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES (?1, '0') ON CONFLICT (key) DO UPDATE SET value = '0'`,
    ).bind(POLL_FAIL_KEY).run();
  } catch (e) {
    await logError(env, "elfia_orders_poll", e instanceof Error ? e.message : String(e));
    /* Three consecutive failed ticks = 15 minutes blind on web orders — bell
       super_admin + CEO once per day (ref-deduped by the notify funnel). */
    try {
      const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`)
        .bind(POLL_FAIL_KEY).first<{ value: string }>();
      const fails = (Number(row?.value) || 0) + 1;
      await env.DB.prepare(
        `INSERT INTO system_meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2`,
      ).bind(POLL_FAIL_KEY, String(fails)).run();
      if (fails === 3) {
        const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        const { results: admins } = await env.DB.prepare(
          `SELECT id FROM users WHERE is_active = 1 AND role IN ('super_admin', 'ceo')`,
        ).all<{ id: number }>();
        for (const a of admins) {
          await env.DB.prepare(
            `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'system', ?2, ?3)`,
          ).bind(a.id, "🔌 ELFIA orders feed unreachable for 3 polls — web orders are not syncing. Check the store and the bridge key.", `elfia_poll:${today}`).run();
        }
      }
    } catch { /* alerting failure never breaks the cron */ }
  }
}

async function upsertWebOrder(env: Env, o: NonNullable<ReturnType<typeof parseWebOrder>>): Promise<void> {
  /* Upsert by (store, order_number) — the stable key. The poller touches
     web_orders/web_order_lines ONLY: a cancelled order's pieces already came
     back through feed B, so inventory is out of bounds here. */
  await env.DB.prepare(
    `INSERT INTO web_orders (store, order_number, status, customer_name, phone, address,
       subtotal_cents, shipping_cents, total_cents, payment_method, tracking_no, tracking_courier,
       placed_at, store_updated_at, synced_at)
     VALUES ('elfia', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now'))
     ON CONFLICT (store, order_number) DO UPDATE SET
       status = ?2, customer_name = ?3, phone = ?4, address = ?5,
       subtotal_cents = ?6, shipping_cents = ?7, total_cents = ?8,
       payment_method = ?9, tracking_no = ?10, tracking_courier = ?11,
       placed_at = ?12, store_updated_at = ?13, synced_at = datetime('now')`,
  ).bind(o.order_number, o.status, o.customer_name, o.phone, o.address,
    o.subtotal_cents, o.shipping_cents, o.total_cents, o.payment_method,
    o.tracking_no, o.tracking_courier, o.created_at, o.updated_at).run();

  const row = await env.DB.prepare(
    `SELECT id, paid_seen_at FROM web_orders WHERE store = 'elfia' AND order_number = ?1`,
  ).bind(o.order_number).first<{ id: number; paid_seen_at: string | null }>();
  if (!row) return;

  // Lines are a snapshot — replaced whole on every upsert.
  await env.DB.prepare(`DELETE FROM web_order_lines WHERE order_id = ?1`).bind(row.id).run();
  for (const l of parseWebOrderLines(o.items)) {
    await env.DB.prepare(
      `INSERT INTO web_order_lines (order_id, store_product_id, name, sku, sku_key, qty, price_cents)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(row.id, l.store_product_id, l.name, l.sku, l.sku_key, l.qty, l.price_cents).run();
  }

  /* First time we see it paid: stamp the revenue month and book the cash —
     one cashflow money-in + one balanced journal entry, idempotent by
     ref ELF-<order_number> (post twice, book once — the recordBankMovement
     rule, applied here without importing staff.ts). */
  if (isPaidStatus(o.status) && !row.paid_seen_at && (o.total_cents ?? 0) > 0) {
    await env.DB.prepare(
      `UPDATE web_orders SET paid_seen_at = datetime('now') WHERE id = ?1 AND paid_seen_at IS NULL`,
    ).bind(row.id).run();
    const ref = `ELF-${o.order_number}`;
    const desc = `ELFIA web order ${o.order_number}`;
    try {
      const dup = await env.DB.prepare(`SELECT id FROM cashflow_entries WHERE ref = ?1 LIMIT 1`)
        .bind(ref).first<{ id: number }>();
      if (!dup) {
        await env.DB.prepare(
          `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by)
           VALUES (date('now', '+8 hours'), 'in', 'sales', ?1, ?2, ?3, NULL)`,
        ).bind(o.total_cents, desc, ref).run();
        await postJournal(env, 0, ref, desc, "sales", o.total_cents ?? 0, "in");
      }
    } catch { /* pre-0071 — Finance simply not in use yet */ }
  }
}

/* ==================== housekeeping (runs on the 30-min cron) ==================== */

export async function bridgeHousekeeping(env: Env): Promise<void> {
  try {
    /* Applied events older than 400 days have served their idempotency and
       audit purpose (the stock_ledger row is permanent). unknown_sku rows
       are kept forever — each one is an unresolved business problem. */
    await env.DB.prepare(
      `DELETE FROM bridge_events WHERE outcome = 'applied' AND received_at < datetime('now', '-400 days')`,
    ).run();
  } catch { /* pre-0076 — silent */ }
}

/* ==================== health (for /api/v1/health) ==================== */

export async function bridgeHealth(env: Env): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    configured: !!env.ELFIA_BRIDGE_KEY,
    orders_configured: !!(env.ELFIA_BRIDGE_KEY && env.ELFIA_ORDERS_URL),
  };
  try {
    out.last_movement_at = (await env.DB.prepare(
      `SELECT MAX(received_at) AS t FROM bridge_events`,
    ).first<{ t: string | null }>())?.t ?? null;
  } catch { out.last_movement_at = null; }
  try {
    out.last_poll_at = (await env.DB.prepare(
      `SELECT value FROM system_meta WHERE key = 'elfia_last_poll'`,
    ).first<{ value: string }>())?.value ?? null;
  } catch { out.last_poll_at = null; }
  return out;
}
