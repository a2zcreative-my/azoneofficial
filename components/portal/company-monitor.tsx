"use client";

/* v1.19.0 (consolidation C1) — the two cards worth saving from the retired
 * Overview tab, re-homed where their subject lives: the company-wide task
 * table on the Tasks tab (managers), the stock-status breakdown on the
 * Inventory tab. Same /staff/overview payload, same exec_view server gate —
 * the fetch simply 403s for anyone else and the card renders nothing.
 */

import { useEffect, useState } from "react";
import { SkelText } from "@/components/ui/skeleton";

import { makeApi } from "@/lib/api";
import { card, td, th } from "@/lib/ui-styles";

const api = makeApi("/staff");

interface OverviewData {
  task_summary?: { status: string; n: number }[];
  task_by_staff?: { name: string; role: string; open_tasks: number; done_tasks: number }[];
  inventory_status?: { status: string; n: number }[];
}

function useOverview(): OverviewData | null {
  const [data, setData] = useState<OverviewData | null>(null);
  useEffect(() => {
    void api<OverviewData>(`/overview`).then((r) => { if (r.ok && r.data) setData(r.data); });
  }, []);
  return data;
}

/** Company-wide task load — Tasks tab, management roles. */
export function TaskProgressCard() {
  const data = useOverview();
  if (!data?.task_summary) return null;
  const staff = [...(data.task_by_staff ?? [])].sort((a, b) => b.open_tasks - a.open_tasks);
  return (
    <div className={card}>
      <p className="text-sm font-semibold">Task progress — company-wide</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {([["open", "Open"], ["in_progress", "Pending"], ["completed", "Closed"]] as const).map(([k, lbl]) => (
          <div key={k} className="border-border rounded-lg border py-2">
            <p className="text-xl font-semibold tabular-nums">{data.task_summary?.find((t) => t.status === k)?.n ?? 0}</p>
            <p className="text-muted-foreground text-[11px]">{lbl}</p>
          </div>
        ))}
      </div>
      {staff.length > 0 && (
        <div className="mt-4 max-h-64 overflow-x-auto overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-border border-b">
              <th className={th}>Staff</th><th className={th}>Open</th><th className={th}>Done</th>
            </tr></thead>
            <tbody>
              {staff.map((r) => (
                <tr key={r.name} className="border-border border-b last:border-0">
                  <td className={td}>{r.name} <span className="text-muted-foreground text-xs capitalize">· {r.role.replace(/_/g, " ")}</span></td>
                  <td className={`${td} tabular-nums`}>{r.open_tasks}</td>
                  <td className={`${td} tabular-nums`}>{r.done_tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Stock status breakdown — Inventory tab, management roles.
    v1.21.1 (CEO): one slim strip that hugs its content.
    v1.21.5 (CEO: "for low should like animation to make staff alert and
    data will appear when click without go to the tabs/table"): the low /
    out-of-stock chips PULSE while their count is above zero, and clicking
    one opens the affected items right under the strip — SKU, name and the
    exact quantity left — no trip to the inventory table. */
export function InventoryStatusCard() {
  const data = useOverview();
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<{ sku: string; name: string; stock: number; status: string }[] | null>(null);
  useEffect(() => {
    if (!open || items) return;
    void api<{ items: { sku: string; name: string; stock: number; status: string }[] }>(`/inventory`)
      .then((r) => { if (r.ok && r.data) setItems(r.data.items ?? []); });
  }, [open, items]);
  if (!data?.inventory_status?.length) return null;
  const ALERT: Record<string, string> = {
    low: "bg-warning-soft text-warning",
    out_of_stock: "bg-danger-soft text-danger",
  };
  const openItems = open ? (items ?? []).filter((i) => i.status === open) : [];
  return (
    <div className="max-w-full self-start">
      <div className="border-border bg-card inline-flex max-w-full flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
        <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Stock status</span>
        {data.inventory_status.map((r) => {
          const alert = ALERT[r.status] && r.n > 0;
          if (!alert) return (
            <span key={r.status} className="bg-secondary rounded-full px-2.5 py-0.5 text-xs">
              <b className="tabular-nums">{r.n}</b>{" "}
              <span className="text-muted-foreground capitalize">{r.status.replace(/_/g, " ")}</span>
            </span>
          );
          const isOpen = open === r.status;
          return (
            <button key={r.status} type="button" aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : r.status)}
              className={`${ALERT[r.status]} ${isOpen ? "" : "animate-pulse"} rounded-full px-2.5 py-0.5 text-xs font-semibold`}
              title="Tap to see which items">
              <b className="tabular-nums">{r.n}</b>{" "}
              <span className="capitalize">{r.status.replace(/_/g, " ")}</span>
              <span aria-hidden className="ml-1 text-[10px]">{isOpen ? "▲" : "▼"}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <div className="border-border bg-card mt-1.5 rounded-xl border px-3 py-2">
          <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            {open.replace(/_/g, " ")} items
          </p>
          {!items ? (
            <SkelText lines={2} className="mt-2" />
          ) : openItems.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">Nothing here anymore — the count refreshes on reload.</p>
          ) : (
            <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {openItems.map((i) => (
                <p key={i.sku} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate"><span className="text-muted-foreground tabular-nums">{i.sku}</span> {i.name}</span>
                  <span className={`shrink-0 font-semibold tabular-nums ${i.stock === 0 ? "text-danger" : "text-warning"}`}>
                    {i.stock} left
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
