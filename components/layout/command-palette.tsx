"use client";

/* v1.8.0 — global search (the reference design's "Search CL or client").
   Ctrl/Cmd+K or the top-bar field opens it; fuzzy-matches portal tabs,
   staff, clients and quick actions, entirely client-side.

   v1.107.0 (roadmap phase 04b) — SEARCH EVERYTHING. Tabs and actions still
   match here, instantly; everything else - hotels and their contacts, staff,
   clients, quotations and invoices, web orders, stock, assets, tasks - comes
   from /staff/search, one request over eight tables, each gated by the
   permission its own tab is gated by. Type a phone number and get the hotel
   contact, the client and the order it belongs to; the worker strips both
   sides to digits so "017-476 1019" finds "0174761019". The directory
   preload (staff + clients, two fetches on every open) is gone: the server
   answers in one. */

import { useCallback, useEffect, useRef, useState } from "react";
import { makeApi } from "@/lib/api";
import { Skel } from "@/components/ui/skeleton";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* Display-only BM group headers. The group strings themselves stay English —
   GROUP_ORDER and the lastGroup comparison key off them. */
const GROUP_MS: Record<string, string> = {
  "Go to": "Pergi ke",
  Actions: "Tindakan",
  Staff: "Kakitangan",
  Clients: "Klien",
  Hotels: "Hotel",
  Contacts: "Kenalan",
  Documents: "Dokumen",
  Orders: "Pesanan",
  Stock: "Stok",
  Assets: "Aset",
  Tasks: "Tugasan",
};

/** v1.107.0 - what the worker returns for one query. */
interface Hit { kind: string; id: number; title: string; sub: string; tab: string }
const KIND_GROUP: Record<string, string> = {
  hotel: "Hotels", contact: "Contacts", staff: "Staff", client: "Clients",
  document: "Documents", order: "Orders", stock: "Stock", asset: "Assets", task: "Tasks",
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

export function CommandPalette({ open, onClose, tabs, onTab, extraActions = [] }: {
  open: boolean;
  onClose: () => void;
  tabs: { name: string; label: string }[];
  onTab: (name: string) => void;
  extraActions?: PaletteAction[];
  /** v1.107.0 - canSeeClients is gone: the worker decides per source what
      this role may find, by the same permissions its tabs use. */
  canSeeClients?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /* v1.107.0 - the server's answer for the query as typed. `hits` is for
     `hitsFor`; a stale answer for an earlier query is never shown as the
     answer to a later one. `searching` is true from the first keystroke of a
     new query until its answer lands (v1.77.0: a skeleton, never "No
     matches." for names still in flight). */
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitsFor, setHitsFor] = useState("");
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const queryNow = q.trim();
  useEffect(() => {
    if (!open || queryNow.length < 2) { setHits([]); setHitsFor(""); setSearching(false); return; }
    setSearching(true);
    const mine = ++seq.current;
    const t = window.setTimeout(() => {
      void api<{ hits: Hit[] }>(`/search?q=${encodeURIComponent(queryNow)}`).then((r) => {
        if (seq.current !== mine) return; // a newer query is out
        setHits(r.ok && r.data?.hits ? r.data.hits : []);
        setHitsFor(queryNow);
        setSearching(false);
      });
    }, 220);
    return () => window.clearTimeout(t);
  }, [open, queryNow]);
  const dirLoaded = !searching && hitsFor === queryNow;

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
  /* v1.107.0 - the server's hits are already matched; they are not re-scored
     against the label (a phone-number hit has no digits in its title). */
  if (query && hitsFor === query) {
    for (const h of hits) {
      rows.push({ group: KIND_GROUP[h.kind] ?? "Results", label: h.title, hint: h.sub, run: () => { onTab(h.tab); onClose(); } });
    }
  }
  const GROUP_ORDER = ["Go to", "Actions", "Staff", "Hotels", "Contacts", "Clients", "Documents", "Orders", "Stock", "Assets", "Tasks"];
  const ranked = (query
    ? rows.sort((a, b) => {
        const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
        if (g !== 0) return g;
        return (a.group === "Go to" || a.group === "Actions") ? score(query, b.label) - score(query, a.label) : 0;
      })
    : rows
  ).slice(0, 24);
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
          placeholder={L("Search anything — a name, a hotel, a phone number, an order…  (Esc to close)", "Cari apa sahaja — nama, hotel, nombor telefon, pesanan…  (Esc untuk tutup)")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={onKey}
        />
        <div className="max-h-72 overflow-y-auto p-1.5">
          {ranked.length === 0 && (dirLoaded || !query || query.length < 2) && <p className="text-muted-foreground px-3 py-4 text-sm">{L("No matches.", "Tiada padanan.")}</p>}
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
                  {r.hint && <span className="text-muted-foreground ml-2 max-w-[55%] shrink-0 truncate text-xs">{r.hint}</span>}
                </button>
              </div>
            );
          })}
          {/* v1.77.0 — skeleton until the first fetch lands: the Staff group
              (header + three result rows in the real row's padding) while the
              directory is still in flight and a query is waiting on it. */}
          {query.length >= 2 && !dirLoaded && (
            <div aria-hidden>
              <p className="px-3 pt-2 pb-0.5"><Skel className="h-2.5 w-12" /></p>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2">
                  <Skel className="h-4 w-40" />
                  <Skel className="ml-2 h-3 w-16 shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
