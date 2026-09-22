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
   answers in one.

   v1.172.0 (Portal UI V2) - RECENTS, ICONS, KEYS. With nothing typed the
   palette opens on the tabs this person opened from it most recently (a
   device-local list, filtered against the tabs they may see RIGHT NOW, so a
   revoked tab is not offered back), then every destination; each row wears
   its tab's icon; the results are a real listbox for a screen reader; the
   footer names the keys. The search contract above is unchanged. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { makeApi } from "@/lib/api";
import { TabIcon } from "@/components/layout/nav-icons";
import { Skel } from "@/components/ui/skeleton";
import { getLang } from "@/lib/i18n";

/** Device-local list of the tab names most recently opened from here. Read
    through useSyncExternalStore - localStorage is an external store, so the
    component neither reads it during render nor copies it into state. */
const RECENTS_KEY = "azone-palette-recents";
const RECENTS_MAX = 5;
const recentListeners = new Set<() => void>();
const parseRecents = (raw: string): string[] => {
  try {
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, RECENTS_MAX) : [];
  } catch { return []; }
};
function recentsSnapshot(): string {
  try { return localStorage.getItem(RECENTS_KEY) ?? "[]"; } catch { return "[]"; }
}
function subscribeRecents(cb: () => void): () => void {
  recentListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { recentListeners.delete(cb); window.removeEventListener("storage", cb); };
}
function pushRecent(tab: string): void {
  try {
    const next = [tab, ...parseRecents(recentsSnapshot()).filter((t) => t !== tab)].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch { /* a convenience, not state */ }
  recentListeners.forEach((cb) => cb());
}

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* Display-only BM group headers. The group strings themselves stay English —
   GROUP_ORDER and the lastGroup comparison key off them. */
const GROUP_MS: Record<string, string> = {
  Recent: "Terkini",
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

interface Row extends PaletteAction { group: string; icon?: string }

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

export function CommandPalette({ open, onClose, tabs, onTab, extraActions = [], pinned = [] }: {
  open: boolean;
  onClose: () => void;
  tabs: { name: string; label: string }[];
  onTab: (name: string) => void;
  extraActions?: PaletteAction[];
  /** v1.175.0 - the person's pinned modules, in their order, already filtered
      against `tabs` by the shell. They lead the list while nothing is typed;
      a query ranks on merit like everything else. */
  pinned?: readonly string[];
  /** v1.107.0 - canSeeClients is gone: the worker decides per source what
      this role may find, by the same permissions its tabs use. */
  canSeeClients?: boolean;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const recentsRaw = useSyncExternalStore(subscribeRecents, recentsSnapshot, () => "[]");
  const recents = useMemo(() => parseRecents(recentsRaw), [recentsRaw]);
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

  // Reset before paint so a fast first keystroke cannot be cleared on opening.
  useLayoutEffect(() => {
    if (open) { setQ(""); setSel(0); inputRef.current?.focus(); }
  }, [open]);

  const rows: Row[] = [];
  const query = q.trim();
  const push = (group: string, label: string, run: () => void, hint?: string, icon?: string) => {
    if (query && score(query, label) === 0) return;
    rows.push({ group, label, hint, run, icon });
  };
  const goTo = (name: string) => { pushRecent(name); onTab(name); onClose(); };
  /* Recents lead only while nothing is typed; a query ranks on merit. Each is
     resolved against `tabs` - the permission-filtered strip - so a tab this
     person can no longer see is silently dropped, never offered. */
  if (!query) {
    /* v1.175.0 - pins first: they are the modules this person said they use.
       Recents follow, minus anything already pinned, so the top of the list
       is never the same module twice. */
    for (const name of pinned) {
      const t = tabs.find((x) => x.name === name);
      if (t) push("Pinned", t.label, () => goTo(t.name), undefined, t.name);
    }
    for (const name of recents) {
      if (pinned.includes(name)) continue;
      const t = tabs.find((x) => x.name === name);
      if (t) push("Recent", t.label, () => goTo(t.name), undefined, t.name);
    }
  }
  for (const t of tabs) push("Go to", t.label, () => goTo(t.name), undefined, t.name);
  for (const a of extraActions) {
    if (!query || score(query, a.label) > 0) rows.push({ group: "Actions", ...a });
  }
  /* v1.107.0 - the server's hits are already matched; they are not re-scored
     against the label (a phone-number hit has no digits in its title). */
  if (query && hitsFor === query) {
    for (const h of hits) {
      rows.push({ group: KIND_GROUP[h.kind] ?? "Results", label: h.title, hint: h.sub, icon: h.tab, run: () => goTo(h.tab) });
    }
  }
  const GROUP_ORDER = ["Pinned", "Recent", "Go to", "Actions", "Staff", "Hotels", "Contacts", "Clients", "Documents", "Orders", "Stock", "Assets", "Tasks"];
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
    if (e.key === "Home") { e.preventDefault(); setSel(0); }
    if (e.key === "End") { e.preventDefault(); setSel(Math.max(0, ranked.length - 1)); }
    if (e.key === "Enter" && ranked[clampedSel]) { ranked[clampedSel].run(); }
  }, [ranked, clampedSel, onClose]);
  /* The highlighted row follows the keyboard into view. */
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${clampedSel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [clampedSel]);

  if (!open) return null;
  let lastGroup = "";
  const optionId = (i: number) => `palette-option-${i}`;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[2px]" onClick={onClose} role="presentation">
      <motion.div
        role="dialog" aria-modal="true" aria-label={L("Search everything", "Cari semua")}
        initial={reduceMotion ? false : { opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        className="bg-card border-border w-full max-w-lg rounded-2xl border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          role="combobox" aria-expanded aria-controls="palette-listbox" aria-autocomplete="list"
          aria-activedescendant={ranked[clampedSel] ? optionId(clampedSel) : undefined}
          className="text-foreground placeholder:text-muted-foreground w-full rounded-t-2xl border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
          placeholder={L("Search anything — a name, a hotel, a phone number, an order…  (Esc to close)", "Cari apa sahaja — nama, hotel, nombor telefon, pesanan…  (Esc untuk tutup)")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={onKey}
        />
        <div ref={listRef} id="palette-listbox" role="listbox" aria-label={L("Results", "Hasil")} className="max-h-72 overflow-y-auto p-1.5">
          {ranked.length === 0 && (dirLoaded || !query || query.length < 2) && <p className="text-muted-foreground px-3 py-4 text-sm">{L("No matches.", "Tiada padanan.")}</p>}
          {ranked.map((r, i) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={`${r.group}-${r.label}-${i}`} role="presentation">
                {header && <p role="presentation" className="text-muted-foreground px-3 pt-2 pb-0.5 text-[10px] font-semibold tracking-wider uppercase">{L(header, GROUP_MS[header] ?? header)}</p>}
                <button
                  type="button"
                  id={optionId(i)} data-index={i}
                  role="option" aria-selected={i === clampedSel}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${i === clampedSel ? "bg-secondary" : "hover:bg-secondary/60"}`}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => r.run()}
                >
                  {r.icon && <span aria-hidden className="text-muted-foreground grid w-5 shrink-0 place-items-center"><TabIcon name={r.icon} className="h-4 w-4" /></span>}
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {r.hint && <span className="text-muted-foreground max-w-[50%] shrink-0 truncate text-xs">{r.hint}</span>}
                </button>
              </div>
            );
          })}
          {/* v1.77.0 — skeleton until the first fetch lands: the Staff group
              (header + three result rows in the real row's padding) while the
              directory is still in flight and a query is waiting on it. */}
          {query.length >= 2 && !dirLoaded && (
            <div aria-hidden>
              <div className="px-3 pt-2 pb-0.5"><Skel className="h-2.5 w-12" /></div>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg px-3 py-2">
                  <Skel className="h-4 w-40" />
                  <Skel className="ml-2 h-3 w-16 shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
        {/* v1.172.0 - the keys, named. Decorative kbd caps; the behaviour is in onKey. */}
        <div className="text-muted-foreground border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-[11px]" aria-hidden>
          <span><kbd className="bg-secondary rounded px-1 font-sans">↑</kbd> <kbd className="bg-secondary rounded px-1 font-sans">↓</kbd> {L("move", "gerak")}</span>
          <span><kbd className="bg-secondary rounded px-1 font-sans">↵</kbd> {L("open", "buka")}</span>
          <span><kbd className="bg-secondary rounded px-1 font-sans">esc</kbd> {L("close", "tutup")}</span>
          <span className="ml-auto"><kbd className="bg-secondary rounded px-1 font-sans">Ctrl</kbd> <kbd className="bg-secondary rounded px-1 font-sans">K</kbd></span>
        </div>
      </motion.div>
    </div>
  );
}
