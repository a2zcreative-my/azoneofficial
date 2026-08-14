"use client";

/* v1.8.0 — AppShell (UI-REDESIGN-PLAN.md Phase 1).
   The reference design's frame, in navy/gold: on desktop a dark backdrop
   band, a slim navy ICON RAIL, an optional navy CONTEXT PANEL (mini
   calendar + today list), and the rounded content canvas. On phones the
   proven bottom-nav + More-sheet pattern (moved here verbatim from
   /portal v1.4.49, restyled with icons) — the rail is desktop-only.

   Behaviour contract: this component RENDERS navigation, it never decides
   it. The caller passes the already-gated tab list (role matrix + CEO
   overrides applied) exactly as before — a re-skin, not a re-gate. */

import { useState, type ReactNode, type ComponentType } from "react";
import {
  LayoutDashboard, Gauge, Megaphone, HeartHandshake, IdCard, AlarmClock,
  CalendarMinus, ListChecks, Magnet, Clapperboard, ReceiptText, Banknote,
  Wallet, LineChart, Package, Store, ShoppingCart, Boxes, Cake, UserRound,
  ShieldCheck, Globe, Inbox, Images, FileText, Newspaper, ScrollText,
  Settings2, MessageSquareText, ShoppingBag, KeyRound, Circle, type LucideProps,
} from "lucide-react";

/* One icon per known tab across /portal, /admin and /account. A tab this
   map doesn't know falls back to a dot — never a crash. */
const TAB_ICONS: Record<string, ComponentType<LucideProps>> = {
  // portal
  Dashboard: LayoutDashboard,
  Overview: Gauge,
  Announcements: Megaphone,
  HR: HeartHandshake,
  "Staff Details": IdCard,
  Attendance: AlarmClock,
  Leave: CalendarMinus,
  Tasks: ListChecks,
  Pipeline: Magnet,
  Content: Clapperboard,
  Claims: ReceiptText,
  Payroll: Banknote,
  Expenses: Wallet,
  Sales: LineChart,
  Inventory: Package,
  Stokis: Store,
  Ecommerce: ShoppingCart,
  Assets: Boxes,
  Birthdays: Cake,
  Profile: UserRound,
  Users: ShieldCheck,
  // admin
  Website: Globe,
  Enquiries: Inbox,
  Portfolio: Images,
  Testimonials: MessageSquareText,
  Posts: Newspaper,
  Media: Images,
  Staff: IdCard,
  Audit: ScrollText,
  Account: KeyRound,
  Advanced: Settings2,
  // account
  Orders: ShoppingBag,
  Docs: FileText,
};

export function tabIcon(tab: string): ComponentType<LucideProps> {
  return TAB_ICONS[tab] ?? Circle;
}

export function AppShell<T extends string>({
  tabs, tab, onTab, tabLabel = (t) => t, context, children, brand = "AZ ONE",
}: {
  /** The caller's ALREADY-GATED tab list — order preserved. */
  tabs: readonly T[];
  tab: T;
  onTab: (t: T) => void;
  tabLabel?: (t: T) => string;
  /** Optional navy context column (mini calendar, today list) — lg+ only. */
  context?: ReactNode;
  children: ReactNode;
  brand?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const go = (t: T) => {
    onTab(t);
    setMoreOpen(false);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="md:bg-shell min-h-svh md:p-3 lg:p-5">
      <div className="mx-auto flex w-full max-w-[1400px] items-stretch gap-3 lg:gap-4">

        {/* ── Icon rail — desktop only ─────────────────────────────── */}
        <aside
          aria-label="Sections"
          className="bg-brand rounded-shell sticky top-3 hidden max-h-[calc(100svh-1.5rem)] w-16 shrink-0 flex-col items-center py-4 md:flex lg:top-5 lg:max-h-[calc(100svh-2.5rem)]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- static asset */}
          <img src="/icon-192.png" alt={brand} className="mb-3 h-9 w-9 rounded-xl" />
          <nav className="scrollbar-none flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-1"
            aria-label="Sections">
            {tabs.map((t) => {
              const Icon = tabIcon(t);
              const active = t === tab;
              return (
                <button
                  key={t}
                  type="button"
                  title={tabLabel(t)}
                  aria-label={tabLabel(t)}
                  aria-current={active ? "page" : undefined}
                  onClick={() => go(t)}
                  className={
                    active
                      ? "bg-brand-soft text-gold flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      : "hover:bg-brand-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/60 transition-colors hover:text-white"
                  }
                >
                  <Icon size={19} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Context panel — large screens, optional ──────────────── */}
        {context && (
          <aside className="bg-brand rounded-shell sticky top-5 hidden max-h-[calc(100svh-2.5rem)] w-72 shrink-0 flex-col gap-3 self-start overflow-y-auto p-3 xl:flex"
            aria-label="Context">
            {context}
          </aside>
        )}

        {/* ── Canvas ───────────────────────────────────────────────── */}
        <div className="bg-background md:rounded-shell md:shadow-soft min-w-0 flex-1 md:overflow-hidden">
          <div className="mx-auto w-full max-w-6xl px-4 py-3 pb-24 md:px-6 md:py-6 md:pb-8">
            {children}
          </div>
        </div>
      </div>

      {/* ── Mobile bottom nav (v1.4.49 pattern, v1.8.0 icon restyle) ── */}
      <nav
        className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Sections (mobile)"
      >
        {tabs.slice(0, 4).map((t) => {
          const Icon = tabIcon(t);
          const active = tab === t && !moreOpen;
          return (
            <button
              key={t}
              type="button"
              onClick={() => go(t)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span className={`flex h-7 items-center justify-center rounded-full px-4 transition-colors ${active ? "bg-primary text-primary-foreground" : ""}`}>
                <Icon size={17} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
              </span>
              {tabLabel(t)}
            </button>
          );
        })}
        {tabs.length > 4 && (
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
              moreOpen || tabs.indexOf(tab) >= 4 ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <span className={`flex h-7 items-center justify-center rounded-full px-4 transition-colors ${
              moreOpen || tabs.indexOf(tab) >= 4 ? "bg-primary text-primary-foreground" : ""
            }`}>
              <span className="text-base leading-none" aria-hidden>⋯</span>
            </span>
            More
          </button>
        )}
      </nav>

      {/* ── Mobile "More" sheet (v1.4.49 pattern preserved) ─────────── */}
      {moreOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 cursor-pointer bg-black/40"
            onClick={() => setMoreOpen(false)}
          />
          <div className="border-border bg-card absolute inset-x-0 bottom-0 rounded-t-2xl border-t p-4 pb-16">
            <div className="mb-3 flex items-center justify-between">
              <span className="w-9" />
              <button
                type="button"
                aria-label="Close menu"
                className="bg-border mx-auto h-1.5 w-12 rounded-full"
                onClick={() => setMoreOpen(false)}
              />
              <button
                type="button"
                aria-label="Close"
                className="border-border text-muted-foreground flex h-9 w-9 items-center justify-center rounded-full border text-base"
                onClick={() => setMoreOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {tabs.slice(4).map((t) => {
                const Icon = tabIcon(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => go(t)}
                    className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium ${
                      tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
                    }`}
                  >
                    <Icon size={18} strokeWidth={1.8} aria-hidden />
                    {tabLabel(t)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
