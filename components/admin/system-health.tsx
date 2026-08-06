"use client";

/**
 * System health (v1.4.72) — the operator's early-warning card, shown above
 * the audit trail. Two things staff would otherwise report first:
 *  - the last 20 recorded errors (unexpected 500s, failed audit writes,
 *    cron sync failures) from the error_log table, and
 *  - the latest nightly database backup in R2, with a "Back up now" button.
 */

import { useCallback, useEffect, useState } from "react";
import { useSaveToast } from "@/components/ui/save-toast";

const API = "/api/v1";

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
    return { ok: res.ok, data: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { ok: false, data: null as T | null };
  }
}

interface ErrRow { id: number; created_at: string; source: string; message: string; path?: string | null }
interface Health { errors: ErrRow[]; last_backup: { key: string; size: number; uploaded: string } | null; last_offsite?: string | null }

function myt(iso: string): string {
  const d = new Date(new Date(iso.replace(" ", "T").replace(/Z?$/, "Z")).getTime() + 8 * 3600 * 1000);
  const i = d.toISOString();
  return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
}

export function SystemHealthCard() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [health, setHealth] = useState<Health | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<Health>(`/system/health`);
    if (res.ok && res.data) setHealth(res.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const backupNow = async () => {
    setBusy(true);
    setMsg("Backing up…");
    const res = await api<{ key?: string; tables?: number; rows?: number; error?: { message?: string } }>(
      `/system/backup`, { method: "POST", body: JSON.stringify({}) },
    );
    setBusy(false);
    if (res.ok && res.data?.key) {
      setMsg(`Backup saved: ${res.data.key} (${res.data.tables} tables, ${res.data.rows} rows)`);
      showToast("Saved", `Backup complete — ${res.data.tables} tables, ${res.data.rows} rows`);
      void load();
    } else {
      const m = res.data?.error?.message ?? "Backup failed — see the error list below";
      setMsg(m);
      showToast("No changes", m, "notice");
    }
  };

  const backupAge = health?.last_backup
    ? Math.floor((Date.now() - new Date(health.last_backup.uploaded).getTime()) / 86400000)
    : null;

  return (
    <div className="border-border bg-card rounded-lg border p-4 md:p-5">
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">System health</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {health?.last_backup
              ? <>Last backup <span className={backupAge !== null && backupAge > 2 ? "font-semibold text-amber-700" : "font-medium"}>{myt(health.last_backup.uploaded)}</span> · {(health.last_backup.size / 1024).toFixed(0)} KB{backupAge !== null && backupAge > 2 ? " — older than 2 days, check the nightly cron" : ""}</>
              : "No backup yet — nightly backups run at 03:20 MYT after the next deploy, or run one now."}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className="border-border inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-secondary disabled:opacity-50"
            onClick={() => void backupNow()}
          >
            Back up now
          </button>
          {/* v1.4.191 (CEO gap list): OFF-CLOUDFLARE copy — download the
              newest backup and keep it OUTSIDE this Cloudflare account
              (ransomware / account-loss insurance). Quarterly nag below. */}
          <a
            className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
            href={`${API}/system/backup/download`}
            title="Downloads the newest backup file — store it on a drive or another cloud, outside Cloudflare"
          >
            ⬇ Off-site copy
          </a>
        </span>
      </div>
      {(() => {
        const off = health?.last_offsite ? new Date(health.last_offsite + "Z") : null;
        const days = off ? Math.floor((Date.now() - off.getTime()) / 86400000) : null;
        return (
          <p className={`mt-1.5 text-xs ${days === null || days > 90 ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>
            {days === null
              ? "No off-site copy has ever been downloaded — take one now and store it outside Cloudflare (quarterly)."
              : days > 90
                ? `Last off-site copy ${days} days ago — a quarter has passed, download a fresh one.`
                : `Last off-site copy ${days} day(s) ago.`}
          </p>
        );
      })()}
      {msg && <p className="mt-2 text-xs font-medium text-amber-700">{msg}</p>}
      <div className="mt-3">
        <p className="text-xs font-semibold tracking-wide uppercase">Recent errors</p>
        {(health?.errors ?? []).length === 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">No recorded errors. 🎉</p>
        ) : (
          <div className="border-border mt-2 max-h-60 overflow-x-auto overflow-y-auto rounded-lg border">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-border bg-secondary/40 border-b">
                  <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">When (MYT)</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">Source</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase">Message</th>
                </tr>
              </thead>
              <tbody>
                {(health?.errors ?? []).map((e) => (
                  <tr key={e.id} className="border-border border-b align-top last:border-0">
                    <td className="text-muted-foreground px-3 py-1.5 whitespace-nowrap">{myt(e.created_at)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{e.source}{e.path ? <span className="text-muted-foreground block">{e.path}</span> : null}</td>
                    <td className="px-3 py-1.5 text-xs break-all">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
