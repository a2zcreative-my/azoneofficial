"use client";

/**
 * System health (v1.4.72) — the operator's early-warning card, shown above
 * the audit trail. Two things staff would otherwise report first:
 *  - the last 20 recorded errors (unexpected 500s, failed audit writes,
 *    cron sync failures) from the error_log table, and
 *  - the latest nightly database backup in R2, with a "Back up now" button.
 */

import { useCallback, useEffect, useState } from "react";

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
interface Health { errors: ErrRow[]; last_backup: { key: string; size: number; uploaded: string } | null }

function myt(iso: string): string {
  const d = new Date(new Date(iso.replace(" ", "T").replace(/Z?$/, "Z")).getTime() + 8 * 3600 * 1000);
  const i = d.toISOString();
  return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
}

export function SystemHealthCard() {
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
      void load();
    } else {
      setMsg(res.data?.error?.message ?? "Backup failed — see the error list below");
    }
  };

  const backupAge = health?.last_backup
    ? Math.floor((Date.now() - new Date(health.last_backup.uploaded).getTime()) / 86400000)
    : null;

  return (
    <div className="border-border bg-card rounded-lg border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">System health</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {health?.last_backup
              ? <>Last backup <span className={backupAge !== null && backupAge > 2 ? "font-semibold text-amber-700" : "font-medium"}>{myt(health.last_backup.uploaded)}</span> · {(health.last_backup.size / 1024).toFixed(0)} KB{backupAge !== null && backupAge > 2 ? " — older than 2 days, check the nightly cron" : ""}</>
              : "No backup yet — nightly backups run at 03:20 MYT after the next deploy, or run one now."}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          className="border-border inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-secondary disabled:opacity-50"
          onClick={() => void backupNow()}
        >
          Back up now
        </button>
      </div>
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
