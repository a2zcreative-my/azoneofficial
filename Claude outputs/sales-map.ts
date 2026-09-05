/**
 * THE SALES MAP — v1.113.0.
 *
 * The CEO, 05-09-2026: *"on Sales tabs should add Sales mapped like ecommerce
 * or hotel type for me to monitor on the sales state location and revenue by
 * states."* Two layers on the one Malaysian geometry the portal already draws
 * (lib/malaysia-map.ts):
 *
 *   invoices - A2Z's own documents (sales_documents INV), placed by the
 *              CUSTOMER's address; invoiced and paid separately, because an
 *              invoice raised is not money in.
 *   orders   - ELFIA web orders the portal has seen PAID (paid_seen_at, the
 *              same fact the Finance tab's revenue reads, audit B2), placed
 *              by the SHIPPING address.
 *
 * The state is read out of the free-text address by my-state.ts. What cannot
 * be placed is not dropped: it comes back as an "unplaced" line with its
 * count and its money, so the CEO can see how much of the picture the map is
 * missing and the team can fix the addresses that cause it.
 *
 * Range is by Malaysian calendar: this month, this year, or everything.
 * aggregate() is pure and RUN by tests/sales-map.mjs.
 */

import type { Env } from "./index";
import { json, err } from "./shared";
import { can } from "./permissions";
import { stateFromAddress, MY_STATE_NAMES } from "./my-state";

export const RANGES = ["month", "year", "all"] as const;
export type Range = (typeof RANGES)[number];

export interface StateCell {
  invoices: number; invoiced_cents: number; paid_cents: number;
  orders: number; order_cents: number;
}
const empty = (): StateCell => ({ invoices: 0, invoiced_cents: 0, paid_cents: 0, orders: 0, order_cents: 0 });

export interface InvoiceRow { total_cents: number; payment_status: string | null; address: string | null }
export interface OrderRow { cents: number; address: string | null }

/** Sixteen states plus one honest "unplaced" bucket. */
export function aggregate(invoices: InvoiceRow[], orders: OrderRow[]): { states: Record<string, StateCell>; unplaced: StateCell; totals: StateCell } {
  const states: Record<string, StateCell> = {};
  for (const s of MY_STATE_NAMES) states[s] = empty();
  const unplaced = empty();
  const totals = empty();
  for (const r of invoices) {
    const st = stateFromAddress(r.address);
    const cell = st ? states[st]! : unplaced;
    for (const c of [cell, totals]) {
      c.invoices++;
      c.invoiced_cents += r.total_cents;
      if (r.payment_status === "paid") c.paid_cents += r.total_cents;
    }
  }
  for (const r of orders) {
    const st = stateFromAddress(r.address);
    const cell = st ? states[st]! : unplaced;
    for (const c of [cell, totals]) { c.orders++; c.order_cents += r.cents; }
  }
  return { states, unplaced, totals };
}

/** The SQLite datetime (UTC) at which the chosen range began, Malaysian
    calendar; null for everything. */
export function rangeStart(range: Range, now = new Date()): string | null {
  if (range === "all") return null;
  const myt = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = myt.getUTCFullYear();
  const m = range === "month" ? myt.getUTCMonth() : 0;
  const startMyt = Date.UTC(y, m, 1) - 8 * 3600 * 1000;
  return new Date(startMyt).toISOString().slice(0, 19).replace("T", " ");
}

export async function handleSalesMap(env: Env, user: { role: string }, params: URLSearchParams): Promise<Response> {
  if (!can(user.role, "revenue_view")) return err("forbidden", "Sales access required", 403);
  const range: Range = (RANGES as readonly string[]).includes(params.get("range") ?? "") ? (params.get("range") as Range) : "year";
  const since = rangeStart(range);

  let invoices: InvoiceRow[] = [];
  try {
    ({ results: invoices } = await env.DB.prepare(
      `SELECT d.total_cents, d.payment_status, c.address
         FROM sales_documents d JOIN customers c ON c.id = d.customer_id
        WHERE d.doc_type = 'INV' ${since ? "AND d.created_at >= ?1" : ""}`,
    ).bind(...(since ? [since] : [])).all<InvoiceRow>());
  } catch { /* no documents table yet */ }

  let orders: OrderRow[] = [];
  try {
    ({ results: orders } = await env.DB.prepare(
      `SELECT COALESCE(booked_cents, total_cents) AS cents, address
         FROM web_orders WHERE paid_seen_at IS NOT NULL ${since ? "AND paid_seen_at >= ?1" : ""}`,
    ).bind(...(since ? [since] : [])).all<OrderRow>());
  } catch { /* pre-0081 */ }

  const agg = aggregate(invoices, orders);
  return json({ range, since, ...agg, generated_at: new Date().toISOString() });
}
