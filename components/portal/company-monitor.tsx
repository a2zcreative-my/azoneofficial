"use client";

/* v1.19.0 (consolidation C1) — the two cards worth saving from the retired
 * Overview tab, re-homed where their subject lives: the company-wide task
 * table on the Tasks tab (managers), the stock-status breakdown on the
 * Inventory tab. Same /staff/overview payload, same exec_view server gate —
 * the fetch simply 403s for anyone else and the card renders nothing.
 */

import { useEffect, useState } from "react";

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
    v1.21.1 (CEO: "should not take so much width and try to minimalist"):
    no longer a full-width card — one slim strip that hugs its content,
    label and chips on a single line. */
export function InventoryStatusCard() {
  const data = useOverview();
  if (!data?.inventory_status?.length) return null;
  return (
    <div className="border-border bg-card inline-flex max-w-full flex-wrap items-center gap-2 self-start rounded-xl border px-3 py-2">
      <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">Stock status</span>
      {data.inventory_status.map((r) => (
        <span key={r.status} className="bg-secondary rounded-full px-2.5 py-0.5 text-xs">
          <b className="tabular-nums">{r.n}</b>{" "}
          <span className="text-muted-foreground capitalize">{r.status.replace(/_/g, " ")}</span>
        </span>
      ))}
    </div>
  );
}
