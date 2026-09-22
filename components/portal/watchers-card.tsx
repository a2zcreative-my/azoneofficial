"use client";

/**
 * WATCHERS — v1.108.0 (roadmap phase 04c).
 *
 * The second card on the Dashboard, for the executive tier: every condition
 * the company's watchers currently find true - stock under the line, a paid
 * order not shipped, a claim aged past a week, a warranty ending - oldest
 * first, each pressable to the tab where it
 * is fixed. Underneath, for the CEO only, the rules themselves: on or off,
 * and the number each watches against. The COO and CCO see the findings and
 * the rules; only the CEO changes a rule.
 *
 * Findings are pushed ONCE when they first appear (worker/src/watchers.ts);
 * this card is where they stay visible until the thing is fixed, which is the
 * half a push cannot do. Like the desk, it is one quiet line when there is
 * nothing to show.
 */

import { useState } from "react";
import { useCachedApi } from "@/lib/cached-api";
import { makeApi } from "@/lib/api";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, StaleHint } from "@/components/ui/skeleton";
import { btnSm, card, inputClassSm } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const api = makeApi("/staff");

interface WatcherRow {
  key: string; label: string; audience: string[]; tab: string;
  threshold_label: string | null; default_threshold: number | null;
  enabled: boolean; threshold: number | null; open: number;
}
interface Finding { ref: string; watcher: string; title: string; first_seen: string }
interface Data { watchers: WatcherRow[]; open: Finding[]; pending_migration?: boolean }

const LABEL_MS: Record<string, string> = {
  "Stock below the line": "Stok di bawah garis",
  "Paid web order not shipped": "Pesanan web berbayar belum dihantar",
  "Claim undecided": "Tuntutan belum diputuskan",
  "Asset warranty ending": "Jaminan aset akan tamat",
  "Leave request waiting too long": "Permohonan cuti menunggu terlalu lama",
};
const UNIT_MS: Record<string, string> = { units: "unit", days: "hari", "days ahead": "hari ke hadapan" };

function since(sqlite: string): string {
  const t = new Date(sqlite.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return "";
  const h = Math.round((Date.now() - t) / 3_600_000);
  return h < 24 ? `${h}${L("h", "j")}` : `${Math.round(h / 24)}${L("d", "h")}`;
}

/* v1.171.0 - the tier that sees the watchers, exported so the Dashboard can
   decide whether to frame the desk and the watchers together (the CEO chose
   "One Desk + Watchers merged") without keeping a second copy of this list. */
export const WATCHER_ROLES = ["ceo", "coo", "cco", "super_admin", "admin"];

/* v1.171.0 - `bare`: drawn under the desk inside the Dashboard's own frame;
   a rule separates the two, and the card brings no frame of its own. */
/**
 * v1.176.0 — `section` splits the two halves that used to share one card.
 *   "both"      the Dashboard's old shape (kept for any caller that wants it)
 *   "findings"  what the rules currently find true — the Desk page's
 *               "Needs attention" zone, GROUPED: eleven low-stock SKUs are
 *               one row saying "Stock below the line — 11", opened on demand.
 *               A queue that lists every SKU separately is a queue nobody
 *               scrolls to the bottom of.
 *   "rules"     the rule editor, which is management configuration and does
 *               not belong in an everyday queue. The Desk page puts it in a
 *               Setup zone at the foot of the page, per the tab concept's
 *               figures → work → records → setup order.
 */
/**
 * v1.176.1 - HOW MANY THINGS THE RULES CURRENTLY FIND. The Desk's "Needs
 * attention" figure read 0 while the watchers card two inches below it read
 * "4 open", because the figure counted only the desk's own items. Both now
 * come from here, and `useCachedApi` keys on the path, so this shares the
 * request the card itself makes - no extra fetch, and the two cannot part
 * company. Returns null while the answer is not KNOWN, so the tile shows
 * "···" rather than a false zero (v1.25.1).
 */
export function useWatcherOpenCount(role: string): number | null {
  const exec = WATCHER_ROLES.includes(role);
  const view = useCachedApi<Data>("/staff/watchers", exec, ["watchers"]);
  if (!exec) return 0;
  if (!view.data) return null;
  return view.data.open.length;
}

export function WatchersCard({ role, go, bare = false, section = "both" }: { role: string; go: (tab: string) => void; bare?: boolean; section?: "both" | "findings" | "rules" }) {
  const exec = WATCHER_ROLES.includes(role);
  const canEdit = role === "ceo" || role === "super_admin";
  const view = useCachedApi<Data>("/staff/watchers", exec, ["watchers"]);
  const { show: toast, node: toastNode } = useSaveToast();
  const [rules, setRules] = useState(false);
  /* which watcher groups the reader has opened, on the findings view */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!exec) return null;

  const save = async (w: WatcherRow, patch: { enabled?: boolean; threshold?: number }) => {
    setBusy(w.key);
    const r = await api<{ ok?: boolean; error?: { message?: string } }>(`/watchers/${w.key}`, { method: "PUT", body: JSON.stringify(patch) });
    setBusy(null);
    if (r.ok) {
      toast(L("Watcher updated", "Pemerhati dikemas kini"),
        patch.enabled === undefined
          ? `${L(w.label, LABEL_MS[w.label] ?? w.label)} — ${patch.threshold} ${L(w.threshold_label ?? "", UNIT_MS[w.threshold_label ?? ""] ?? w.threshold_label ?? "")}`
          : `${L(w.label, LABEL_MS[w.label] ?? w.label)} — ${patch.enabled ? L("on", "hidup") : L("off", "mati")}`);
      view.refresh();
    } else {
      toast(L("Not changed", "Tidak diubah"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
    }
  };

  if (view.loading) {
    return <div className={bare ? "border-border mt-4 border-t pt-4" : card} aria-busy="true"><Skel className="h-4 w-36" /><Skel className="mt-3 h-9 rounded-lg" /></div>;
  }
  const open = view.data?.open ?? [];
  const watchers = view.data?.watchers ?? [];
  const tabOf = (f: Finding) => watchers.find((w) => w.key === f.watcher)?.tab ?? "Dashboard";

  return (
    <div className={bare ? "border-border mt-4 border-t pt-4" : card}>
      {toastNode}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {open.length ? L(`Watchers — ${open.length} open`, `Pemerhati — ${open.length} terbuka`) : L("Watchers", "Pemerhati")}
            <StaleHint show={view.stale} className="ml-2" />
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {open.length
              ? L("What the company's rules currently find true. Press one to go where it is fixed.", "Apa yang peraturan syarikat dapati benar sekarang. Tekan satu untuk ke tempat ia dibetulkan.")
              : L("Nothing the company's rules watch for is true right now.", "Tiada apa yang diperhatikan oleh peraturan syarikat benar sekarang.")}
          </p>
        </div>
        {section === "both" && (
          <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setRules((v) => !v)}>
            {rules ? L("Hide rules", "Sembunyi peraturan") : L(`Rules (${watchers.length})`, `Peraturan (${watchers.length})`)}
          </button>
        )}
      </div>
      {view.data?.pending_migration && (
        <p className="text-warning mt-2 text-xs">{L("Run the deploy so migration 0115 applies — the watchers start on the next hour.", "Jalankan deploy supaya migrasi 0115 digunakan — pemerhati bermula pada jam berikutnya.")}</p>
      )}

      {section !== "rules" && open.length > 0 && (
        /* v1.176.0 - GROUPED. One row per rule with its count and the oldest
           finding's age; press it to list that rule's findings, press one of
           those to go where it is fixed. Eleven low-stock SKUs were eleven
           rows of a queue that is meant to be scanned in one screen. */
        <ul className="erp-mt-3">
          {[...new Set(open.map((f) => f.watcher))].map((key) => {
            const group = open.filter((f) => f.watcher === key);
            const oldest = group[group.length - 1] ?? group[0];
            const newest = group[0];
            if (!newest || !oldest) return null;
            const w = watchers.find((x) => x.key === key);
            const label = w ? L(w.label, LABEL_MS[w.label] ?? w.label) : key.replace(/_/g, " ");
            const isOpen = Boolean(openGroups[key]);
            return (
              <li key={key} className="erp-list-row erp-watch-group">
                <button type="button" className="erp-row-lead erp-watch-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpenGroups((g) => ({ ...g, [key]: !g[key] }))}
                  title={isOpen ? L("Hide the detail", "Sembunyi perincian") : L("Show the detail", "Tunjuk perincian")}>
                  <span aria-hidden className="erp-dot erp-dot-warning" />
                  <span className="erp-min0 erp-grow">
                    <span className="erp-watch-title">{label} — {group.length}</span>
                    <span className="erp-meta">
                      {group.length === 1
                        ? newest.title
                        : L(`oldest ${since(oldest.first_seen)} · ${isOpen ? "hide" : "show"} the list`,
                            `terlama ${since(oldest.first_seen)} · ${isOpen ? "sembunyi" : "tunjuk"} senarai`)}
                    </span>
                  </span>
                </button>
                <span className="erp-row-actions">
                  <span className="erp-num erp-nowrap erp-text-xs erp-muted">{since(newest.first_seen)}</span>
                  <button type="button" className={btnSm} onClick={() => go(w?.tab ?? "Dashboard")}
                    title={L(`Open ${w?.tab ?? "the tab"}`, `Buka ${w?.tab ?? "tab"}`)}>
                    {L("Open", "Buka")}
                  </button>
                </span>
                {isOpen && (
                  <ul className="erp-watch-detail">
                    {group.slice(0, 20).map((f) => (
                      <li key={f.ref}>
                        <button type="button" className="erp-watch-item" onClick={() => go(tabOf(f))}>
                          <span className="erp-min0 erp-grow">{f.title}</span>
                          <span className="erp-num erp-nowrap erp-text-xs erp-muted">{since(f.first_seen)}</span>
                        </button>
                      </li>
                    ))}
                    {group.length > 20 && (
                      <li className="erp-meta">{L(`and ${group.length - 20} more`, `dan ${group.length - 20} lagi`)}</li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(rules || section === "rules") && (
        <ul className="border-border mt-3 divide-y rounded-xl border">
          {watchers.map((w) => (
            <li key={w.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={w.enabled} disabled={!canEdit || busy === w.key}
                  onChange={(e) => void save(w, { enabled: e.target.checked })} />
                <span className="min-w-0">
                  <span className={`block truncate font-medium ${w.enabled ? "" : "text-muted-foreground line-through"}`}>{L(w.label, LABEL_MS[w.label] ?? w.label)}</span>
                  <span className="text-muted-foreground block truncate text-[10px]">
                    {L("tells", "memberitahu")} {w.audience.map((r) => r.replace(/_/g, " ")).join(", ")}{w.open ? ` · ${w.open} ${L("open", "terbuka")}` : ""}
                  </span>
                </span>
              </label>
              {w.threshold_label && (
                <span className="flex items-center gap-1.5">
                  <input type="number" min={0} max={3650} className={`${inputClassSm} w-20 text-right tabular-nums`} key={`thr:${w.threshold ?? w.default_threshold ?? 0}`} defaultValue={w.threshold ?? w.default_threshold ?? 0}
                    disabled={!canEdit || busy === w.key} aria-label={L(`${w.label} threshold`, `Ambang ${w.label}`)}
                    onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== (w.threshold ?? w.default_threshold)) void save(w, { threshold: n }); }} />
                  <span className="text-muted-foreground">{L(w.threshold_label, UNIT_MS[w.threshold_label] ?? w.threshold_label)}</span>
                </span>
              )}
            </li>
          ))}
          {!canEdit && <li className="text-muted-foreground px-3 py-2 text-[11px]">{L("Only the CEO changes a rule.", "Hanya CEO mengubah peraturan.")}</li>}
        </ul>
      )}
    </div>
  );
}
