"use client";

/* v1.8.0 — global search (the reference design's "Search CL or client").
   Ctrl/Cmd+K or the top-bar field opens it; fuzzy-matches portal tabs,
   staff, clients and quick actions, entirely client-side. */

import { useCallback, useEffect, useRef, useState } from "react";
import { makeApi } from "@/lib/api";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* Display-only BM group headers. The group strings themselves stay English —
   GROUP_ORDER and the lastGroup comparison key off them. */
const GROUP_MS: Record<string, string> = {
  "Go to": "Pergi ke",
  Actions: "Tindakan",
  Staff: "Kakitangan",
  Clients: "Klien",
};

const api = makeApi("/staff");

export interface PaletteAction {
  label: string;
  hint?: string;
  run: () => void;
}

interface Row extends PaletteAction { group: string }

function score(q: string, s: string): number {
  const t = s.toLowerCase();
  const query = q.toLowerCase();
  if (t === query) return 100;
  if (t.startsWith(query)) return 80;
  if (t.includes(query)) return 60;
  // loose subsequence match ("frh" → Farah)
  let i = 0;
  for (const ch of t) if (ch === query[i]) i++;
  return i === query.length ? 30 : 0;
}

export function CommandPalette({ open, onClose, tabs, onTab, extraActions = [], canSeeClients = false }: {
  open: boolean;
  onClose: () => void;
  tabs: { name: string; label: string }[];
  onTab: (name: string) => void;
  extraActions?: PaletteAction[];
  /** /clients/summary needs revenue_view — skip the guaranteed 403 otherwise. */
  canSeeClients?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [staff, setStaff] = useState<{ id: number; name: string; role: string }[]>([]);
  const [clients, setClients] = useState<{ id: number; company: string }[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const loadedRef = useRef(false);

  // Directory data loads once, on first open (cheap, both routes exist).
  useEffect(() => {
    if (!open || loadedRef.current) return;
    void api<{ staff: { id: number; name: string; role: string }[] }>(`/staff-list`)
      .then((r) => { if (r.ok && r.data?.staff) { setStaff(r.data.staff); loadedRef.current = true; } });
    if (canSeeClients) {
      void api<{ clients?: { id: number; company: string }[] }>(`/clients/summary`)
        .then((r) => { if (r.ok && r.data?.clients) setClients(r.data.clients); });
    }
  }, [open, canSeeClients]);

  useEffect(() => {
    if (open) { setQ(""); setSel(0); window.setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const rows: Row[] = [];
  const query = q.trim();
  const push = (group: string, label: string, run: () => void, hint?: string) => {
    if (query && score(query, label) === 0) return;
    rows.push({ group, label, hint, run });
  };
  for (const t of tabs) push("Go to", t.label, () => { onTab(t.name); onClose(); });
  for (const a of extraActions) {
    if (!query || score(query, a.label) > 0) rows.push({ group: "Actions", ...a });
  }
  if (query) {
    for (const s of staff.slice(0, 400)) {
      push("Staff", s.name, () => { onTab("Staff Details"); onClose(); }, s.role.replace(/_/g, " "));
    }
    for (const c of clients.slice(0, 400)) {
      push("Clients", c.company, () => { onTab("Sales"); onClose(); });
    }
  }
  const GROUP_ORDER = ["Go to", "Actions", "Staff", "Clients"];
  const ranked = (query
    ? rows.sort((a, b) => {
        const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
        return g !== 0 ? g : score(query, b.label) - score(query, a.label);
      })
    : rows
  ).slice(0, 12);
  const clampedSel = Math.min(sel, Math.max(0, ranked.length - 1));

  const onKey = useCallback((e: { key: string; preventDefault(): void }) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((v) => Math.min(v + 1, ranked.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
    if (e.key === "Enter" && ranked[clampedSel]) { ranked[clampedSel].run(); }
  }, [ranked, clampedSel, onClose]);

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="bg-card border-border w-full max-w-lg rounded-2xl border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="text-foreground placeholder:text-muted-foreground w-full rounded-t-2xl border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
          placeholder={L("Search tabs, staff, clients, actions…  (Esc to close)", "Cari tab, kakitangan, klien, tindakan…  (Esc untuk tutup)")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={onKey}
        />
        <div className="max-h-72 overflow-y-auto p-1.5">
          {ranked.length === 0 && <p className="text-muted-foreground px-3 py-4 text-sm">{L("No matches.", "Tiada padanan.")}</p>}
          {ranked.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={`${r.group}-${r.label}-${i}`}>
                {header && <p className="text-muted-foreground px-3 pt-2 pb-0.5 text-[10px] font-semibold tracking-wider uppercase">{L(header, GROUP_MS[header] ?? header)}</p>}
                <button
                  type="button"
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${i === clampedSel ? "bg-secondary" : "hover:bg-secondary/60"}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => r.run()}
                >
                  <span className="truncate">{r.label}</span>
                  {r.hint && <span className="text-muted-foreground ml-2 shrink-0 text-xs capitalize">{r.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
