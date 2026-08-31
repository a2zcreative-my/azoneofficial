"use client";

/**
 * System health (v1.4.72) — the operator's early-warning card, shown above
 * the audit trail. Two things staff would otherwise report first:
 *  - the last 20 recorded errors (unexpected 500s, failed audit writes,
 *    cron sync failures) from the error_log table, and
 *  - the latest nightly database backup in R2, with a "Back up now" button.
 */

import { api } from "@/lib/api"; // v1.5.0: one shared helper (was a per-file copy)
import { useCallback, useEffect, useState } from "react";
import { useSaveToast } from "@/components/ui/save-toast";
import { getLang } from "@/lib/i18n";
import { Skel, SkelTable } from "@/components/ui/skeleton"; // v1.77.0
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const API = "/api/v1";


interface ErrRow { id: number; created_at: string; source: string; message: string; path?: string | null }
interface Health { errors: ErrRow[]; last_backup: { key: string; size: number; uploaded: string } | null; last_offsite?: string | null; migrations_pending?: string[]; migrations_all?: { name: string; applied: boolean }[] | null }

function myt(iso: string): string {
  const d = new Date(new Date(iso.replace(" ", "T").replace(/Z?$/, "Z")).getTime() + 8 * 3600 * 1000);
  const i = d.toISOString();
  return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
}

export function SystemHealthCard() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [health, setHealth] = useState<Health | null>(null);
  /* v1.77.0 — first fetch settled (ok or not). `health` stays null on a failed
     request, so the skeleton keys off this flag rather than the data. */
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  type ErrCol = "date" | "source" | "message";
  const [errSort, setErrSort] = useState<{ col: ErrCol; asc: boolean }>({ col: "date", asc: false });
  const cycleErr = (col: ErrCol) => setErrSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: col !== "date" });

  const load = useCallback(async () => {
    const res = await api<Health>(`/system/health`);
    if (res.ok && res.data) setHealth(res.data);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const backupNow = async () => {
    setBusy(true);
    setMsg(L("Backing up…", "Membuat sandaran…"));
    const res = await api<{ key?: string; tables?: number; rows?: number; error?: { message?: string } }>(
      `/system/backup`, { method: "POST", body: JSON.stringify({}) },
    );
    setBusy(false);
    if (res.ok && res.data?.key) {
      setMsg(`${L("Backup saved", "Sandaran disimpan")}: ${res.data.key} (${res.data.tables} ${L("tables", "jadual")}, ${res.data.rows} ${L("rows", "baris")})`);
      showToast(L("Saved", "Disimpan"), `${L("Backup complete", "Sandaran selesai")} — ${res.data.tables} ${L("tables", "jadual")}, ${res.data.rows} ${L("rows", "baris")}`);
      void load();
    } else {
      const m = res.data?.error?.message ?? L("Backup failed — see the error list below", "Sandaran gagal — lihat senarai ralat di bawah");
      setMsg(m);
      showToast(L("No changes", "Tiada perubahan"), m, "notice");
    }
  };

  const backupAge = health?.last_backup
    ? Math.floor((Date.now() - new Date(health.last_backup.uploaded).getTime()) / 86400000)
    : null;

  return (
    <div className="border-border bg-card rounded-lg border p-4 md:p-5">
      {toastNode}
      {/* v1.4.265: the database names the migrations it is missing — the
          v1.4.218 blank-staff-directory incident was exactly a deploy that
          outran its schema, and memory is not a deploy tool. */}
      {/* v1.4.282 (auditor pick 1): the FULL migration ledger — every
          migration this build ships, applied ✓ or missing ✗, read from
          wrangler's own d1_migrations table. The red box above stays for
          urgency; this is the complete picture. */}
      {(health?.migrations_all?.length ?? 0) > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer select-none font-medium">
            🗄 {L("Migration health", "Kesihatan migrasi")} — {health!.migrations_all!.filter((m) => m.applied).length}/{health!.migrations_all!.length} {L("applied", "diterapkan")}
            {health!.migrations_all!.some((m) => !m.applied) ? ` · ${health!.migrations_all!.filter((m) => !m.applied).length} ${L("missing", "belum diterapkan")}` : ` · ${L("all up to date ✓", "semua terkini ✓")}`}
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {health!.migrations_all!.map((m) => (
              <p key={m.name} className={m.applied ? "text-muted-foreground" : "font-semibold text-red-600"}>
                {m.applied ? "✓" : "✗"} {m.name}
              </p>
            ))}
          </div>
          {health!.migrations_all!.some((m) => !m.applied) && (
            <p className="mt-2 font-medium">Missing ones switch off their features — DEPLOY.bat (or the migrations command) applies them all.</p>
          )}
        </details>
      )}
      {(health?.migrations_pending?.length ?? 0) > 0 && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
          <p className="font-semibold">⛔ {health!.migrations_pending!.length} database migration{health!.migrations_pending!.length === 1 ? "" : "s"} pending — parts of the newest releases are switched off until they run:</p>
          <ul className="mt-1 list-disc pl-4">{health!.migrations_pending!.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="mt-1.5 font-mono">npx wrangler d1 migrations apply azoneofficial --remote</p>
          <p className="mt-0.5">then <span className="font-mono">cd worker && wrangler deploy</span></p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{L("System health", "Kesihatan sistem")}</p>
          {/* v1.77.0 — skeleton until the first fetch lands: the backup line,
              the off-site line and the error list must not read "No backup
              yet" / "never downloaded" / "No recorded errors" while loading. */}
          {!loaded ? <Skel className="mt-1.5 h-3 w-72 max-w-full" /> : (
          <p className="text-muted-foreground mt-0.5 text-xs">
            {health?.last_backup
              ? <>{L("Last backup", "Sandaran terakhir")} <span className={backupAge !== null && backupAge > 2 ? "font-semibold text-amber-700" : "font-medium"}>{myt(health.last_backup.uploaded)}</span> · {(health.last_backup.size / 1024).toFixed(0)} KB{backupAge !== null && backupAge > 2 ? ` — ${L("older than 2 days, check the nightly cron", "melebihi 2 hari, semak cron malam")}` : ""}</>
              : L("No backup yet — nightly backups run at 03:20 MYT after the next deploy, or run one now.", "Belum ada sandaran — sandaran malam berjalan pada 03:20 MYT selepas deploy seterusnya, atau jalankan satu sekarang.")}
          </p>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className="border-border inline-flex h-9 items-center rounded-lg border px-4 text-sm font-medium hover:bg-secondary disabled:opacity-50"
            onClick={() => void backupNow()}
          >
            {L("Back up now", "Buat sandaran sekarang")}
          </button>
          {/* v1.4.191 (CEO gap list): OFF-CLOUDFLARE copy — download the
              newest backup and keep it OUTSIDE this Cloudflare account
              (ransomware / account-loss insurance). Quarterly nag below. */}
          <a
            className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
            href={`${API}/system/backup/download`}
            title={L("Downloads the newest backup file — store it on a drive or another cloud, outside Cloudflare", "Muat turun fail sandaran terbaru — simpan pada pemacu atau awan lain, di luar Cloudflare")}
          >
            ⬇ {L("Off-site copy", "Salinan luar tapak")}
          </a>
        </span>
      </div>
      {!loaded ? <Skel className="mt-2 h-3 w-80 max-w-full" /> : (() => {
        const off = health?.last_offsite ? new Date(health.last_offsite + "Z") : null;
        const days = off ? Math.floor((Date.now() - off.getTime()) / 86400000) : null;
        return (
          <p className={`mt-1.5 text-xs ${days === null || days > 90 ? "font-semibold text-amber-700" : "text-muted-foreground"}`}>
            {days === null
              ? L("No off-site copy has ever been downloaded — take one now and store it outside Cloudflare (quarterly).", "Tiada salinan luar tapak pernah dimuat turun — ambil satu sekarang dan simpan di luar Cloudflare (setiap suku tahun).")
              : days > 90
                ? `${L("Last off-site copy", "Salinan luar tapak terakhir")} ${days} ${L("days ago — a quarter has passed, download a fresh one.", "hari lalu — sudah satu suku tahun berlalu, muat turun yang baharu.")}`
                : `${L("Last off-site copy", "Salinan luar tapak terakhir")} ${days} ${L("day(s) ago.", "hari lalu.")}`}
          </p>
        );
      })()}
      {msg && <p className="mt-2 text-xs font-medium text-amber-700">{msg}</p>}
      <div className="mt-3">
        <p className="text-xs font-semibold tracking-wide uppercase">{L("Recent errors", "Ralat terkini")}</p>
        {!loaded ? (
          <SkelTable rows={3} cols={3} className="mt-2" />
        ) : (health?.errors ?? []).length === 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">{L("No recorded errors. 🎉", "Tiada ralat direkodkan. 🎉")}</p>
        ) : (
          <div className="border-border mt-2 max-h-60 overflow-x-auto overflow-y-auto rounded-lg border">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-border bg-secondary/40 border-b">
                  {([
                    ["date", L("When (MYT)", "Bila (MYT)")],
                    ["source", L("Source", "Sumber")],
                    ["message", L("Message", "Mesej")]
                  ] as [ErrCol, string][]).map(([col, label]) => (
                    <th key={col} className="cursor-pointer px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase select-none"
                      title={`${L("Sort by", "Susun ikut")} ${label} — ${L("click again to reverse", "klik sekali lagi untuk terbalikkan susunan")}`}
                      onClick={() => cycleErr(col)}>
                      {label}{errSort.col === col ? (errSort.asc ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...(health?.errors ?? [])].sort((a, b) => {
                  const dir = errSort.asc ? 1 : -1;
                  switch (errSort.col) {
                    case "date": return dir * a.created_at.localeCompare(b.created_at);
                    case "source": return dir * a.source.localeCompare(b.source);
                    case "message": return dir * a.message.localeCompare(b.message);
                    default: return 0;
                  }
                }).map((e) => (
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
