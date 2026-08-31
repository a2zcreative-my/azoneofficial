/* v1.36.0, rebuilt v1.39.0 after AUDIT-2026-08-22 — the ELFIA bridge's
   env-bound side: the movements endpoint (feed B), the orders poller
   (feed C), and their housekeeping. Decision logic lives in bridge-core.ts
   (pure, guard-tested); this file is the wiring: D1, no cookies, no CORS —
   server-to-server only.

   The audit found the v1.36.0 version of this file could lose a sale
   permanently (B1), lose every order's cash booking silently (B2), and
   under-deduct on concurrent movements (M1). The rules this rebuild lives
   by, each traceable to a finding:

   - B1/M1: every movement's writes happen in ONE env.DB.batch() (a single
     D1 transaction), and stock moves by an atomic SQL expression — never a
     JS read-modify-write. The `pending` outcome is therefore only reachable
     when the batch itself failed, and a conflict on a `pending` row is
     treated as a FIRST ATTEMPT (apply now) — never answered "ignored".
   - B2/M2: cash booking binds a real created_by, is gated on the
     paid_seen_at UPDATE's meta.changes (an atomic claim — only one
     concurrent booker wins), stamps paid_seen_at only WITH the booking, and
     logs failures instead of swallowing them.
   - M4: the first poll seeds the cursor to "now" (OD-16a) so history is
     never accidentally booked into the deployment month.
   - M5/M6: a malformed or failing order is counted and logged, never
     silently dropped; a cursor that does not advance aborts the loop and
     raises an alert instead of re-fetching the same page forever.
   - Silence still means retry: any event_id in NO response list will be
     re-sent by the store, and the lists must stay truthful. */

import type { Env } from "./index";
import { json, err, logError, postJournal } from "./shared";
import {
  parseBatch, skuKey,
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

/** One `WHERE NOT EXISTS`-guarded notification insert — the funnel used by
    the cron jobs, without a second round trip per recipient. */
async function notifyRole(env: Env, roles: string[], kind: string, message: string, ref: string): Promise<void> {
  try {
    const placeholders = roles.map((_, i) => `?${i + 4}`).join(", ");
    await env.DB.prepare(
      `INSERT INTO notifications (user_id, kind, message, ref)
       SELECT u.id, ?1, ?2, ?3 FROM users u
       WHERE u.is_active = 1 AND u.role IN (${placeholders})
         AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.ref = ?3)`,
    ).bind(kind, message, ref, ...roles).run();
  } catch { /* notification failure never blocks bridge work */ }
}

/* ==================== feed B — movements (store → portal) ==================== */

/* The stock expression MAX(0, stock + ?1) appears INLINE in every statement
   of a movement's batch — deliberately not interpolated from a constant,
   because tests/sql-schema-check.mjs skips template literals containing
   ${...} and these are exactly the statements that must never drift from the
   schema. Clamped at zero: the pieces already physically left the shop;
   refusing would retry forever. */

export async function handleElfiaMovements(request: Request, env: Env): Promise<Response> {
  const unauthorized = bridgeAuth(request, env);
  if (unauthorized) return unauthorized;

  /* AUDIT M10: on a database that has not applied 0078 yet (the two deploy
     halves land independently), refuse the WHOLE request loudly. The v1.36.0
     behaviour — 200 with three empty lists — read as "healthy" to the store
     while deducting nothing. A non-2xx makes the store hold the batch and
     retry later, which is the contract for a whole-request failure. */
  try {
    await env.DB.prepare(`SELECT 1 FROM bridge_events LIMIT 1`).first();
  } catch {
    return err("migration_pending", "bridge_events is not migrated yet — apply 0078 and retry", 503);
  }

  /* AUDIT minor: check the declared length BEFORE buffering, then the real
     byte length after (rawBody.length counts UTF-16 units, not bytes). */
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return err("too_large", "Body exceeds 64KB", 400);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) return err("too_large", "Body exceeds 64KB", 400);
  let parsedBody: unknown;
  try { parsedBody = JSON.parse(rawBody); } catch { return err("invalid_json", "Body must be JSON", 400); }
  const batch = parseBatch(parsedBody);
  if (!batch) return err("invalid_input", "movements must be a non-empty array of at most 50", 400);

  const applied: string[] = [];
  const ignored: string[] = [];
  const unknownSku: string[] = [];
  let malformed = 0;

  for (const m of batch.parsed) {
    if (!m) { malformed++; continue; } // structurally broken → in NO list → the store resends
    try {
      const key = skuKey(m.sku);
      /* Step 1 — the idempotency gate. */
      const ins = await env.DB.prepare(
        `INSERT INTO bridge_events (source, event_id, sku, sku_key, delta, reason, reference, occurred_at, outcome)
         VALUES ('elfia', ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending')
         ON CONFLICT (source, event_id) DO NOTHING`,
      ).bind(m.event_id, m.sku, key, m.delta, m.reason, m.reference, m.occurred_at).run();

      if (!ins.meta.changes) {
        /* AUDIT B1 — the heart of the fix. A conflict does NOT mean "already
           applied": it means "already RECORDED". Read what actually happened.
           'pending' = a previous attempt died before its batch committed —
           this retry is the real first attempt, so fall through and apply.
           Answering "ignored" here was how v1.36.0 turned a routine D1 blip
           into a permanently lost sale. */
        const prev = await env.DB.prepare(
          `SELECT outcome FROM bridge_events WHERE source = 'elfia' AND event_id = ?1`,
        ).bind(m.event_id).first<{ outcome: string }>();
        if (prev?.outcome === "applied") { ignored.push(m.event_id); continue; }
        if (prev?.outcome === "unknown_sku") { unknownSku.push(m.event_id); continue; }
        /* 'pending' (or unreadable) → proceed to apply below. */
      }

      /* Step 2 — match the SKU. Primary: the indexed sku_key column.
         Fallback (AUDIT M8): the SQL expression, so a stale or NULL key —
         e.g. an item created while an old worker was still live, or a
         Unicode-vs-ASCII normalisation difference — degrades to a slower
         match instead of a lost sale. ORDER BY id keeps a collision
         deterministic. */
      let item = await env.DB.prepare(
        `SELECT id, sku, status FROM inventory_items WHERE sku_key = ?1 ORDER BY id LIMIT 1`,
      ).bind(key).first<{ id: number; sku: string; status: string }>();
      if (!item) {
        item = await env.DB.prepare(
          `SELECT id, sku, status FROM inventory_items WHERE UPPER(REPLACE(sku, ' ', '')) = ?1 ORDER BY id LIMIT 1`,
        ).bind(key).first<{ id: number; sku: string; status: string }>();
      }
      if (!item) {
        await env.DB.prepare(
          `UPDATE bridge_events SET outcome = 'unknown_sku' WHERE source = 'elfia' AND event_id = ?1`,
        ).bind(m.event_id).run();
        unknownSku.push(m.event_id); // the store stops retrying and surfaces it in its /admin
        continue;
      }

      /* Step 3 — apply, in ONE transaction (AUDIT B1/M1). The ledger and
         trail rows are written BEFORE the stock update, computing the
         applied delta and balance from the pre-update row with the same
         clamped expression the update uses — atomic within the batch, no JS
         read-modify-write, and a concurrent movement simply serialises. The
         batch is all-or-nothing: if it throws, the event stays 'pending'
         and the store's retry (step 1) applies it cleanly. */
      const reasonText = `${m.reason ?? "movement"}${m.reference ? ` ${m.reference}` : ""}`;
      await env.DB.batch([
        // one append-only ledger row: the APPLIED delta, and the balance after
        env.DB.prepare(
          `INSERT INTO stock_ledger (item_id, sku, delta, balance_after, source, ref_type, ref_id, reason)
           SELECT id, sku, MAX(0, stock + ?1) - stock, MAX(0, stock + ?1), 'elfia', 'bridge_event', ?2, ?3
           FROM inventory_items WHERE id = ?4`,
        ).bind(m.delta, m.event_id, reasonText, item.id),
        // the familiar Inventory-tab trail row — skipped when the clamp makes
        // the applied qty zero (a "sale of 0" row is noise; the ledger row
        // above still records the clamp itself). remark is NOT NULL there.
        env.DB.prepare(
          `INSERT INTO manual_stockouts (item_id, sku, item_name, qty, unit_sale_cents, remark, direction, out_date, created_by)
           SELECT id, sku, name, ABS(MAX(0, stock + ?1) - stock), NULL, ?2,
                  CASE WHEN MAX(0, stock + ?1) < stock THEN 'out' ELSE 'in' END,
                  date('now', '+8 hours'), NULL
           FROM inventory_items WHERE id = ?3 AND MAX(0, stock + ?1) != stock`,
        ).bind(m.delta, `ELFIA ${reasonText}`, item.id),
        // the stock itself — atomic expression, never a JS-computed absolute
        // (AUDIT M9: 'discontinued' survives; a movement must not silently
        // republish a withdrawn item through feed A's status filter)
        env.DB.prepare(
          `UPDATE inventory_items SET stock = MAX(0, stock + ?1),
             status = CASE WHEN status = 'discontinued' THEN 'discontinued'
                           WHEN MAX(0, stock + ?1) <= 0 THEN 'out_of_stock'
                           WHEN MAX(0, stock + ?1) <= 5 THEN 'low'
                           ELSE 'in_stock' END,
             updated_at = datetime('now')
           WHERE id = ?2`,
        ).bind(m.delta, item.id),
        env.DB.prepare(
          `UPDATE bridge_events SET outcome = 'applied', item_id = ?1 WHERE source = 'elfia' AND event_id = ?2`,
        ).bind(item.id, m.event_id),
      ]);
      applied.push(m.event_id);

      /* Step 4 — the loud part. If the ledger recorded a smaller delta than
         requested, the clamp bit: the shop sold pieces the portal did not
         think existed. A human reconciles; the count must not drift quietly. */
      const led = await env.DB.prepare(
        `SELECT delta FROM stock_ledger WHERE source = 'elfia' AND ref_id = ?1 ORDER BY id DESC LIMIT 1`,
      ).bind(m.event_id).first<{ delta: number }>();
      if (led && led.delta !== m.delta) {
        await notifyRole(env, ["sales_marketing", "ceo"], "stock",
          `⚠ ELFIA reported ${Math.abs(m.delta)}× ${item.sku} but the portal could only apply ${Math.abs(led.delta)} — count clamped at 0. Reconcile the physical stock.`,
          `bridge_clamp:${item.id}:${m.event_id.slice(0, 8)}`);
      }
    } catch (e) {
      /* This movement failed mid-flight. Leave its id out of every list —
         the store resends it, and the pending-aware gate in step 1 makes the
         retry apply exactly once. */
      await logError(env, "bridge_movements", e instanceof Error ? e.message : String(e), m.event_id);
    }
  }

  if (malformed > 0) {
    await logError(env, "bridge_movements", `${malformed} structurally malformed movement(s) left unacknowledged for retry`, "batch");
  }
  return json({ applied, ignored, unknown_sku: unknownSku });
}

/* ==================== feed C — orders (portal ← store) ==================== */

const CURSOR_KEY = "elfia_orders_cursor";
const POLL_FAIL_KEY = "elfia_poll_failures";
const REJECT_KEY = "elfia_orders_rejected";

async function metaGet(env: Env, key: string): Promise<string | null> {
  try {
    return (await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`)
      .bind(key).first<{ value: string }>())?.value ?? null;
  } catch { return null; }
}
async function metaSet(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO system_meta (key, value) VALUES (?1, ?2)
     ON CONFLICT (key) DO UPDATE SET value = ?2`,
  ).bind(key, value).run();
}

export async function pollElfiaOrders(env: Env): Promise<void> {
  if (!env.ELFIA_BRIDGE_KEY || !env.ELFIA_ORDERS_URL) return; // not configured — silent, like the TikTok cron
  try {
    let cursor = await metaGet(env, CURSOR_KEY);

    /* AUDIT M4 / OD-16(a): the first poll ever SEEDS the cursor to "now"
       instead of reading the store's entire history — which would have
       booked months of old orders into the deployment month's revenue and
       one day's cash flow. Importing history is a deliberate one-off, not
       an accident of the first tick. The store's cursor format is its own
       updated_at ("YYYY-MM-DD HH:MM:SS", UTC). */
    if (cursor === null) {
      cursor = new Date().toISOString().slice(0, 19).replace("T", " ");
      await metaSet(env, CURSOR_KEY, cursor);
      await logError(env, "elfia_orders_poll", `first run — cursor seeded to ${cursor}; historical orders are deliberately not imported (OD-16a)`);
    }

    let rejected = 0;
    for (let page = 0; page < 10; page++) { // hard stop: 10 pages per tick
      const sep = env.ELFIA_ORDERS_URL.includes("?") ? "&" : "?";
      const res = await fetch(`${env.ELFIA_ORDERS_URL}${sep}since=${encodeURIComponent(cursor)}`, {
        headers: { "X-Bridge-Key": env.ELFIA_BRIDGE_KEY },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`orders feed answered ${res.status}`);
      const data = (await res.json()) as { orders?: unknown[]; cursor?: string };
      const orders = Array.isArray(data.orders) ? data.orders : [];
      if (orders.length === 0) break;

      for (const raw of orders) {
        const o = parseWebOrder(raw);
        if (!o) {
          /* AUDIT M5: never a silent drop. Counted, logged, visible on the
             bridge health card — the cursor will move past it, and that is
             now a RECORDED decision instead of an invisible one. */
          rejected++;
          await logError(env, "elfia_order_rejected", `unparseable order skipped: ${JSON.stringify(raw).slice(0, 200)}`);
          continue;
        }
        try {
          await upsertWebOrder(env, o);
        } catch (e) {
          /* AUDIT M5 (poison pill): one failing order must not wedge the
             whole feed forever. One retry for the routine D1 blip; a second
             failure is counted + logged and the poll moves on. */
          try {
            await upsertWebOrder(env, o);
          } catch {
            rejected++;
            await logError(env, "elfia_order_rejected", `order ${o.order_number} failed twice: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      /* AUDIT M6: the cursor must ADVANCE. A store whose `since` is
         inclusive, a page sharing one timestamp, or a missing cursor field
         would otherwise re-fetch the same page ten times per tick forever —
         while health looked green. Abort loudly instead. */
      if (typeof data.cursor !== "string" || data.cursor === "" || data.cursor === cursor) {
        if (orders.length > 0 && data.cursor === cursor) {
          await logError(env, "elfia_orders_poll", `cursor did not advance past ${cursor} on a non-empty page — aborting this tick`);
          await notifyRole(env, ["super_admin", "ceo"], "system",
            "🔁 ELFIA orders cursor is stuck — the same page keeps coming back. Check the store's /bridge/orders cursor behaviour.",
            `elfia_cursor:${cursor.slice(0, 10)}`);
        }
        break;
      }
      cursor = data.cursor;
      /* Persisted only after the page is fully processed — a crash mid-page
         re-reads that page next tick, and the upsert makes that harmless. */
      await metaSet(env, CURSOR_KEY, cursor);
    }

    if (rejected > 0) {
      const prev = Number(await metaGet(env, REJECT_KEY)) || 0;
      await metaSet(env, REJECT_KEY, String(prev + rejected));
    }
    await metaSet(env, "elfia_last_poll", new Date().toISOString().slice(0, 19).replace("T", " "));
    await metaSet(env, POLL_FAIL_KEY, "0");
  } catch (e) {
    await logError(env, "elfia_orders_poll", e instanceof Error ? e.message : String(e));
    /* AUDIT minor: alert from the third consecutive failure, then once per
       day while the outage lasts (the old `=== 3` fired once per outage at
       most, and a skipped count never fired at all). */
    try {
      const fails = (Number(await metaGet(env, POLL_FAIL_KEY)) || 0) + 1;
      await metaSet(env, POLL_FAIL_KEY, String(fails));
      if (fails >= 3) {
        const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        await notifyRole(env, ["super_admin", "ceo"], "system",
          `🔌 ELFIA orders feed unreachable (${fails} consecutive polls) — web orders are not syncing. Check the store and the bridge key.`,
          `elfia_poll:${today}`);
      }
    } catch { /* alerting failure never breaks the cron */ }
  }
}

async function upsertWebOrder(env: Env, o: NonNullable<ReturnType<typeof parseWebOrder>>): Promise<void> {
  /* Upsert by (store, order_number) — the stable key. The poller touches
     web_orders/web_order_lines ONLY: a cancelled order's pieces already came
     back through feed B, so inventory is out of bounds here (guard-asserted).
     COALESCE on placed_at: a status-change push that omits created_at must
     not blank the original date (audit minor). */
  await env.DB.prepare(
    `INSERT INTO web_orders (store, order_number, status, customer_name, phone, address,
       subtotal_cents, shipping_cents, total_cents, payment_method, tracking_no, tracking_courier,
       placed_at, store_updated_at, synced_at)
     VALUES ('elfia', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now'))
     ON CONFLICT (store, order_number) DO UPDATE SET
       status = ?2, customer_name = ?3, phone = ?4, address = ?5,
       subtotal_cents = ?6, shipping_cents = ?7, total_cents = ?8,
       payment_method = ?9, tracking_no = ?10, tracking_courier = ?11,
       placed_at = COALESCE(?12, placed_at), store_updated_at = ?13, synced_at = datetime('now')`,
  ).bind(o.order_number, o.status, o.customer_name, o.phone, o.address,
    o.subtotal_cents, o.shipping_cents, o.total_cents, o.payment_method,
    o.tracking_no, o.tracking_courier, o.created_at, o.updated_at).run();

  /* v1.73.0 — the courier link, built by the SHOP (feed C, spec C) and
     mirrored here. Same armored shape as consent below: a pre-0098 database
     keeps syncing orders, it just cannot store the link yet. Never derived
     locally from tracking_courier — see 0098 for why that would rot. */
  await env.DB.prepare(
    `UPDATE web_orders SET tracking_url = ?2 WHERE store = 'elfia' AND order_number = ?1`,
  ).bind(o.order_number, typeof o.tracking_url === "string" && o.tracking_url.startsWith("https://")
    ? o.tracking_url : null).run().catch(() => null);

  /* v1.44.0 — PDPA marketing consent rides the same upsert: the store sends
     the CURRENT value on every re-send, so a withdrawal over there clears
     the flag here within one poll. A separate armored statement (not a
     column in the big INSERT) so a pre-0085 database still syncs orders —
     it just cannot record consent yet. */
  await env.DB.prepare(
    `UPDATE web_orders SET marketing_consent = ?2 WHERE store = 'elfia' AND order_number = ?1`,
  ).bind(o.order_number, o.marketing_consent === 1 ? 1 : 0).run().catch(() => null);

  const row = await env.DB.prepare(
    `SELECT id, paid_seen_at, refund_flagged_at FROM web_orders WHERE store = 'elfia' AND order_number = ?1`,
  ).bind(o.order_number).first<{ id: number; paid_seen_at: string | null; refund_flagged_at: string | null }>();
  if (!row) return;

  // Lines are a snapshot — replaced whole on every upsert.
  await env.DB.prepare(`DELETE FROM web_order_lines WHERE order_id = ?1`).bind(row.id).run();
  for (const l of parseWebOrderLines(o.items)) {
    await env.DB.prepare(
      `INSERT INTO web_order_lines (order_id, store_product_id, name, sku, sku_key, qty, price_cents)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(row.id, l.store_product_id, l.name, l.sku, l.sku_key, l.qty, l.price_cents).run();
  }

  /* First time we see it paid: book the cash. AUDIT B2 + M2, rebuilt:
     1. The UPDATE below is an atomic CLAIM — `WHERE paid_seen_at IS NULL`
        means exactly one concurrent caller (cron tick vs "Pull now") gets
        meta.changes = 1 and books; the loser reads changes = 0 and walks
        away. The v1.36.0 code decided from a stale SELECT and could book
        twice; worse, it stamped paid_seen_at BEFORE booking, so the
        booking's own failure could never be retried.
     2. created_by = 0, the system actor — cashflow_entries.created_by is
        NOT NULL, and binding NULL was why every booking failed silently.
     3. booked_cents records what was actually booked, and revenueLines()
        reads it — a later store-side amendment of total_cents can no longer
        make /revenue and cash flow disagree about the same order (M3).
     4. On booking failure the claim is RELEASED (paid_seen_at back to NULL)
        so the next poll retries, and the failure is logged — never
        swallowed. */
  if (isPaidStatus(o.status) && !row.paid_seen_at && (o.total_cents ?? 0) > 0) {
    const claim = await env.DB.prepare(
      `UPDATE web_orders SET paid_seen_at = datetime('now'), booked_cents = ?2
       WHERE id = ?1 AND paid_seen_at IS NULL`,
    ).bind(row.id, o.total_cents).run();
    if (claim.meta.changes) {
      const ref = `ELF-${o.order_number}`;
      const desc = `ELFIA web order ${o.order_number}`;
      try {
        /* Single-statement guarded insert — the check and the write are one
           atomic statement, closing the check-then-insert race without a
           schema change (a unique index on ref cannot be added safely: the
           column defaults to '' across existing manual rows). */
        await env.DB.prepare(
          `INSERT INTO cashflow_entries (entry_date, type, category, amount_cents, description, ref, created_by)
           SELECT date('now', '+8 hours'), 'in', 'sales', ?1, ?2, ?3, 0
           WHERE NOT EXISTS (SELECT 1 FROM cashflow_entries WHERE ref = ?3)`,
        ).bind(o.total_cents, desc, ref).run();
        await postJournal(env, 0, ref, desc, "sales", o.total_cents ?? 0, "in");
      } catch (e) {
        await env.DB.prepare(
          `UPDATE web_orders SET paid_seen_at = NULL, booked_cents = NULL WHERE id = ?1`,
        ).bind(row.id).run();
        await logError(env, "elfia_cash_booking", `order ${o.order_number}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /* AUDIT M3 / OD-17(b): a paid order the store later cancels is a REFUND —
     a money decision, never an automatic reversal (the same rule the portal
     already holds for its own invoices: "paid orders cannot be silently
     cancelled"). Flag once, tell the people who decide, leave the revenue
     booked until a human acts. */
  if (o.status === "cancelled" && row.paid_seen_at && !row.refund_flagged_at) {
    const flag = await env.DB.prepare(
      `UPDATE web_orders SET refund_flagged_at = datetime('now')
       WHERE id = ?1 AND refund_flagged_at IS NULL`,
    ).bind(row.id).run();
    if (flag.meta.changes) {
      await notifyRole(env, ["ceo", "super_admin"], "sales",
        `💸 ELFIA order ${o.order_number} was PAID and is now CANCELLED — its revenue stays booked until you decide the refund. Web Orders tab.`,
        `elfia_refund:${o.order_number}`);
    }
  }
}

/* ==================== feed D — traffic (portal ← store) ==================== */

/* v1.43.0 (CEO: "a traffic to see which user that visit my pages … a new map
   like Operations map … a new tab for ELFIA traffic"). The store counts its
   visitors ANONYMOUSLY (OD-20a: aggregates only — no IPs, daily-rotating
   hashes that never leave the store, 60-day raw retention) and this poller
   pulls the per-day state/city/page aggregates into web_traffic_daily.

   Cursor discipline (PORTAL-BRIDGE-SPEC.md § D): `since` is the newest FINAL
   day we hold; the store answers with every later day, today included as a
   RUNNING total. Each received day is therefore REPLACED whole (delete +
   insert in one batch), never added to, and the cursor advances only to the
   feed's `final_through` — so today keeps refreshing until it is final. */

const TRAFFIC_CURSOR_KEY = "elfia_traffic_cursor";

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function pollElfiaTraffic(env: Env): Promise<void> {
  if (!env.ELFIA_BRIDGE_KEY || !env.ELFIA_ORDERS_URL) return; // not configured — silent, like the orders poller
  /* Derived, not a second secret: the store serves both feeds side by side
     (…/bridge/orders and …/bridge/traffic), so one URL configures both and
     the two can never point at different stores. */
  const trafficUrl = env.ELFIA_ORDERS_URL.replace(/\/orders(\?|$)/, "/traffic$1");
  if (trafficUrl === env.ELFIA_ORDERS_URL) {
    await logError(env, "elfia_traffic_poll", `ELFIA_ORDERS_URL does not end in /orders — cannot derive the traffic feed URL`);
    return;
  }
  try {
    let cursor = await metaGet(env, TRAFFIC_CURSOR_KEY);
    /* First run: seed to the Malaysian yesterday. Unlike orders (OD-16a,
       money), pulling traffic history would be harmless — but the store only
       starts counting when its own v1.2.0 deploys, so there is no history to
       want, and seeding keeps the two pollers' first-run shape identical. */
    if (cursor === null) {
      cursor = new Date(Date.now() + 8 * 3600 * 1000 - 86_400_000).toISOString().slice(0, 10);
      await metaSet(env, TRAFFIC_CURSOR_KEY, cursor);
    }

    const sep = trafficUrl.includes("?") ? "&" : "?";
    const res = await fetch(`${trafficUrl}${sep}since=${encodeURIComponent(cursor)}`, {
      headers: { "X-Bridge-Key": env.ELFIA_BRIDGE_KEY },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`traffic feed answered ${res.status}`);
    const data = (await res.json()) as { days?: unknown[]; final_through?: string };

    /* Group the validated rows by day; malformed rows are dropped silently —
       a lost page view is a shrug, not a lost sale. */
    const byDay = new Map<string, { state: string; city: string; path: string; visits: number; visitors: number }[]>();
    for (const raw of Array.isArray(data.days) ? data.days.slice(0, 2000) : []) {
      const r = raw as Record<string, unknown>;
      if (!isDay(r.day) || typeof r.state !== "string") continue;
      const visits = Number(r.visits), visitors = Number(r.visitors);
      if (!Number.isInteger(visits) || visits < 0 || !Number.isInteger(visitors) || visitors < 0) continue;
      const rows = byDay.get(r.day) ?? [];
      rows.push({
        state: r.state.slice(0, 40),
        city: typeof r.city === "string" ? r.city.slice(0, 60) : "",
        path: typeof r.path === "string" ? r.path.slice(0, 120) : "",
        visits, visitors,
      });
      byDay.set(r.day, rows);
    }

    for (const [day, rows] of byDay) {
      /* One batch = one transaction per day: a reader mid-poll sees the old
         day or the new day, never a half-replaced one. OR REPLACE armors
         against a duplicate key inside one payload. */
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM web_traffic_daily WHERE day = ?1`).bind(day),
        ...rows.map((r) => env.DB.prepare(
          `INSERT OR REPLACE INTO web_traffic_daily (day, state, city, path, visits, visitors)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        ).bind(day, r.state, r.city, r.path, r.visits, r.visitors)),
      ]);
    }

    /* Advance only forward, only to what the store declares final — a feed
       hiccup that answers an old final_through must not rewind the cursor
       into re-fetching weeks of settled days. */
    if (isDay(data.final_through) && data.final_through > cursor) {
      await metaSet(env, TRAFFIC_CURSOR_KEY, data.final_through);
    }
    await metaSet(env, "elfia_traffic_last_poll", new Date().toISOString().slice(0, 19).replace("T", " "));
  } catch (e) {
    /* Logged, never belled: traffic is a map, not money — the orders poller
       already owns the "store unreachable" alert for the shared outage. */
    await logError(env, "elfia_traffic_poll", e instanceof Error ? e.message : String(e));
  }
}

/* ==================== housekeeping (runs on the 30-min cron) ==================== */

export async function bridgeHousekeeping(env: Env): Promise<void> {
  try {
    /* Applied events older than 400 days have served their idempotency and
       audit purpose (the stock_ledger row is permanent). unknown_sku rows
       are kept forever — each one is an unresolved business problem.
       'pending' rows are kept too: they are retry state, and pruning one
       would resurrect audit finding B1. */
    await env.DB.prepare(
      `DELETE FROM bridge_events WHERE outcome = 'applied' AND received_at < datetime('now', '-400 days')`,
    ).run();
  } catch { /* pre-0078 — silent */ }
}

/* ==================== health ==================== */

/** For the PUBLIC /api/v1/health probe: configuration booleans ONLY, computed
    from env — zero DB work and zero business-activity disclosure. The
    v1.38.0 version ran two D1 queries per anonymous hit and published when
    the shop last made a sale (audit minor); timestamps now live only behind
    the authenticated /staff/inventory/bridge-health route. */
export function bridgeHealth(env: Env): Record<string, unknown> {
  return {
    configured: !!env.ELFIA_BRIDGE_KEY,
    orders_configured: !!(env.ELFIA_BRIDGE_KEY && env.ELFIA_ORDERS_URL),
  };
}
