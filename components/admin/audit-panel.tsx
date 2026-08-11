"use client";

/**
 * Audit-log viewer (v1.4.16). Reads the trail every consequential action
 * already writes — logins, leave approvals, role changes, password resets,
 * suspensions. After the backdoor incident, being able to SEE this history in
 * /admin is the point: nothing new is logged here, it's a window onto what was
 * always recorded.
 */

import { useCallback, useEffect, useState } from "react";

const API = "/api/v1";

async function api<T>(path: string) {
  try {
    const res = await fetch(`${API}${path}`, { credentials: "include" });
    return { ok: res.ok, data: (await res.json()) as T | null };
  } catch {
    return { ok: false, data: null };
  }
}

interface Entry {
  id: number;
  action: string;
  entity?: string;
  entity_id?: string;
  detail?: string;
  created_at: string;
  user_name?: string;
}

// Group the noisy action namespace into filter chips.
const FILTERS: [string, string][] = [
  ["", "All"],
  ["auth", "Sign-ins"],
  ["user", "User changes"],
  ["leave", "Leave"],
  ["holiday", "Holidays"],
  ["task", "Tasks"],
];

function myt(iso: string): string {
  // DD-MM-YYYY HH:mm, Malaysia time.
  const d = new Date(new Date(iso.replace(" ", "T") + "Z").getTime() + 8 * 3600 * 1000);
  const i = d.toISOString();
  return `${i.slice(8, 10)}-${i.slice(5, 7)}-${i.slice(0, 4)} ${i.slice(11, 16)}`;
}

export function AuditPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filter, setFilter] = useState("");
  type AuditCol = "date" | "who" | "action" | "target";
  const [auditSort, setAuditSort] = useState<{ col: AuditCol; asc: boolean }>({ col: "date", asc: false });
  const cycleAudit = (col: AuditCol) => setAuditSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: col !== "date" });

  const load = useCallback(async () => {
    const q = filter ? `?action=${filter}` : "";
    const res = await api<{ entries: Entry[] }>(`/audit${q}`);
    if (res.ok && res.data) setEntries(res.data.entries);
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => setFilter(val)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              filter === val
                ? "bg-primary text-primary-foreground"
                : "border-border border hover:bg-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="border-border max-h-[30rem] overflow-x-auto overflow-y-auto rounded-lg border">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-border bg-secondary/40 border-b">
              {([
                ["date", "When (MYT)"],
                ["who", "Who"],
                ["action", "Action"],
                ["target", "Target"]
              ] as [AuditCol, string][]).map(([col, label]) => (
                <th key={col} className="cursor-pointer px-3 py-2 text-left text-xs font-semibold tracking-wide uppercase select-none"
                  title={`Sort by ${label} — click again to reverse`}
                  onClick={() => cycleAudit(col)}>
                  {label}{auditSort.col === col ? (auditSort.asc ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td className="text-muted-foreground px-3 py-3" colSpan={4}>
                  No matching activity.
                </td>
              </tr>
            )}
            {[...entries].sort((a, b) => {
              const dir = auditSort.asc ? 1 : -1;
              switch (auditSort.col) {
                case "date": return dir * a.created_at.localeCompare(b.created_at);
                case "who": return dir * (a.user_name || "system").localeCompare(b.user_name || "system");
                case "action": return dir * a.action.localeCompare(b.action);
                case "target": return dir * ((a.entity || "") + (a.entity_id || "")).localeCompare((b.entity || "") + (b.entity_id || ""));
                default: return 0;
              }
            }).map((e) => (
              <tr key={e.id} className="border-border border-b last:border-0">
                <td className="text-muted-foreground px-3 py-1.5 whitespace-nowrap">{myt(e.created_at)}</td>
                <td className="px-3 py-1.5">{e.user_name ?? "system"}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{e.action}</td>
                <td className="text-muted-foreground px-3 py-1.5 text-xs">
                  {e.entity ? `${e.entity}${e.entity_id ? ` #${e.entity_id}` : ""}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
