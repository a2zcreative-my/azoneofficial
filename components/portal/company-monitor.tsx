"use client";

/* v1.19.0 (consolidation C1) — the two cards worth saving from the retired
 * Overview tab, re-homed where their subject lives: the company-wide task
 * table on the Tasks tab (managers), the stock-status breakdown on the
 * Inventory tab. Same /staff/overview payload, same exec_view server gate —
 * the fetch simply 403s for anyone else and the card renders nothing.
 */

import { useEffect, useState } from "react";
import { Skel, SkelText } from "@/components/ui/skeleton";

import { makeApi } from "@/lib/api";
import { card, td, th } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* BM labels for inventory status VALUES — display only; the values stay
   English wherever they are compared or used as keys. */
const STOCK_MS: Record<string, string> = {
  in_stock: "dalam stok",
  low: "rendah",
  out_of_stock: "kehabisan stok",
};
const stockLabel = (s: string) => L(s.replace(/_/g, " "), STOCK_MS[s] ?? s.replace(/_/g, " "));

interface OverviewData {
  task_summary?: { status: string; n: number }[];
  task_overdue?: number | null;   // v1.42.0 — absent pre-0083
  task_unacked?: number | null;
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
/** One task, as this card needs it. */
interface MonTask {
  id: number; title: string; status: string; deadline?: string | null;
  assignee?: string | null; acknowledged_at?: string | null;
}

/** v1.88.0 — the tile that opens what it counts.
 *
 * MODULE SCOPE, per guard #30: a component declared inside the card would be
 * a new type on every render. */
function CountTile({ n, label, tone, active, onPick }: {
  n: number; label: string; tone: string; active: boolean; onPick: () => void;
}) {
  return (
    <button type="button" aria-pressed={active}
      className={`rounded-lg border py-2 text-center transition hover:brightness-95 ${tone} ${active ? "ring-primary ring-2" : ""}`}
      title={L("Show these", "Tunjukkan ini")}
      onClick={onPick}>
      <p className="text-xl font-semibold tabular-nums">{n}</p>
      <p className="text-muted-foreground text-[11px]">{label}{active ? " ✕" : ""}</p>
    </button>
  );
}

export function TaskProgressCard() {
  const data = useOverview();
  /* v1.88.0 (CEO: "ensure that all the tabs have a function of clickable data
     without me need to open another new tabs") — every figure on this card
     was plain text, including the two its own v1.42.0 comment calls "the
     numbers that demand a manager's action". A number that demands action and
     cannot be opened sends you to another tab to find out which rows it means.
     The same answer the CEO already asked for on the stock chips at v1.21.5:
     "data will appear when click without go to the tabs/table". */
  const [pick, setPick] = useState<string | null>(null);
  const [tasks, setTasks] = useState<MonTask[] | null>(null);
  useEffect(() => {
    if (!pick || tasks) return;
    void api<{ tasks: MonTask[] }>(`/tasks?all=1`)
      .then((r) => { if (r.ok && r.data) setTasks(r.data.tasks ?? []); });
  }, [pick, tasks]);
  if (!data?.task_summary) return null;
  const staff = [...(data.task_by_staff ?? [])].sort((a, b) => b.open_tasks - a.open_tasks);
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  /* The same tests the server counted with, so a tile of 3 opens 3 rows. A
     list that disagrees with the number above it is worse than no list. */
  const matches = (t: MonTask): boolean =>
    pick === "overdue" ? Boolean(t.deadline && t.deadline.slice(0, 10) < today && t.status !== "completed")
    : pick === "unacked" ? (!t.acknowledged_at && t.status !== "completed")
    : pick === null ? false
    : t.status === pick;
  const shown = (tasks ?? []).filter(matches);
  const pickLabel = pick === "overdue" ? L("overdue", "tertunggak")
    : pick === "unacked" ? L("not acknowledged", "belum diakui")
    : pick === "in_progress" ? L("pending", "menunggu")
    : pick === "completed" ? L("closed", "ditutup") : L("open", "terbuka");
  return (
    <div className={card}>
      <p className="text-sm font-semibold">{L("Task progress — company-wide", "Kemajuan tugasan — seluruh syarikat")}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
        {([["open", "Open", "Terbuka"], ["in_progress", "Pending", "Menunggu"], ["completed", "Closed", "Ditutup"]] as const).map(([k, lbl, lblMs]) => (
          <CountTile key={k} n={data.task_summary?.find((t) => t.status === k)?.n ?? 0}
            label={L(lbl, lblMs)} tone="border-border" active={pick === k}
            onPick={() => setPick(pick === k ? null : k)} />
        ))}
        {/* v1.42.0 (CEO: "monitor closely"): the two numbers that demand a
            manager's action — deadlines already missed, and assignments
            nobody has confirmed seeing. Red/amber when above zero. */}
        {typeof data.task_overdue === "number" && (
          <CountTile n={data.task_overdue} label={L("Overdue", "Tertunggak")}
            tone={data.task_overdue > 0 ? "border-danger bg-danger-soft text-danger" : "border-border"}
            active={pick === "overdue"} onPick={() => setPick(pick === "overdue" ? null : "overdue")} />
        )}
        {typeof data.task_unacked === "number" && (
          <CountTile n={data.task_unacked} label={L("Not acknowledged", "Belum diakui")}
            tone={data.task_unacked > 0 ? "border-warning bg-warning-soft text-warning" : "border-border"}
            active={pick === "unacked"} onPick={() => setPick(pick === "unacked" ? null : "unacked")} />
        )}
      </div>

      {/* The rows behind the figure, right under it. */}
      {pick && (
        <div className="border-border mt-3 rounded-lg border">
          {/* Guard #28: a skeleton in the SHAPE of what is coming, never a
              sentence about waiting. The count is what lands here, so a short
              bar the width of a count is what waits here. */}
          <div className="border-border border-b px-2.5 py-1.5">
            {tasks === null
              ? <Skel className="h-3 w-24" />
              : <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {shown.length} {pickLabel}
                </p>}
          </div>
          {tasks === null ? (
            <div className="px-2.5 py-2"><SkelText lines={3} /></div>
          ) : shown.length === 0 ? (
            <p className="text-muted-foreground px-2.5 py-2 text-xs">{L("Nothing here.", "Tiada apa-apa di sini.")}</p>
          ) : (
            <ul className="divide-border max-h-56 divide-y overflow-y-auto">
              {shown.map((t) => (
                <li key={t.id} className="px-2.5 py-1.5 text-xs">
                  <span className="font-medium">{t.title}</span>
                  {t.assignee && <span className="text-muted-foreground"> · {t.assignee}</span>}
                  {t.deadline && <span className="text-muted-foreground"> · {L("due", "tarikh akhir")} {t.deadline.slice(0, 10)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {staff.length > 0 && (
        <div className="mt-4 max-h-64 overflow-x-auto overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr className="border-border border-b">
              <th className={th}>{L("Staff", "Kakitangan")}</th><th className={th}>{L("Open", "Terbuka")}</th><th className={th}>{L("Done", "Selesai")}</th>
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
        <span className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">{L("Stock status", "Status stok")}</span>
        {data.inventory_status.map((r) => {
          const alert = ALERT[r.status] && r.n > 0;
          /* v1.88.0 — the non-alert chips were the inert branch of a control
             that already worked: its sibling below has expanded its items
             since v1.21.5. Same behaviour, quieter colours — a chip that
             opens next to one that does not is the confusing case. */
          if (!alert) {
            const isOpenQ = open === r.status;
            return (
              <button key={r.status} type="button" aria-expanded={isOpenQ}
                onClick={() => setOpen(isOpenQ ? null : r.status)}
                className={`bg-secondary hover:brightness-95 rounded-full px-2.5 py-0.5 text-xs transition ${isOpenQ ? "ring-primary ring-2" : ""}`}
                title={L("Tap to see which items", "Tekan untuk lihat barang yang terlibat")}>
                <b className="tabular-nums">{r.n}</b>{" "}
                <span className="text-muted-foreground capitalize">{stockLabel(r.status)}</span>
                <span aria-hidden className="ml-1 text-[10px]">{isOpenQ ? "▲" : "▼"}</span>
              </button>
            );
          }
          const isOpen = open === r.status;
          return (
            <button key={r.status} type="button" aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : r.status)}
              className={`${ALERT[r.status]} ${isOpen ? "" : "animate-pulse"} rounded-full px-2.5 py-0.5 text-xs font-semibold`}
              title={L("Tap to see which items", "Tekan untuk lihat barang yang terlibat")}>
              <b className="tabular-nums">{r.n}</b>{" "}
              <span className="capitalize">{stockLabel(r.status)}</span>
              <span aria-hidden className="ml-1 text-[10px]">{isOpen ? "▲" : "▼"}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <div className="border-border bg-card mt-1.5 rounded-xl border px-3 py-2">
          <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            {L(`${open.replace(/_/g, " ")} items`, `barang ${STOCK_MS[open] ?? open.replace(/_/g, " ")}`)}
          </p>
          {!items ? (
            <SkelText lines={2} className="mt-2" />
          ) : openItems.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">{L("Nothing here anymore — the count refreshes on reload.", "Tiada apa-apa lagi di sini — kiraan dikemas kini selepas muat semula.")}</p>
          ) : (
            <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
              {openItems.map((i) => (
                <p key={i.sku} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate"><span className="text-muted-foreground tabular-nums">{i.sku}</span> {i.name}</span>
                  <span className={`shrink-0 font-semibold tabular-nums ${i.stock === 0 ? "text-danger" : "text-warning"}`}>
                    {L(`${i.stock} left`, `baki ${i.stock}`)}
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
