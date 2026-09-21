"use client";

/* v1.13.0 — the grouped ERP sidebar (CEO's DZI reference).
 *
 * Replaces the v1.8.0/v1.12.0 icon-only rail on desktop. An icon rail works
 * for six destinations; this system has more than twenty. Unlabelled icons
 * at that count stop being navigation and become a memory test — hence
 * sections with headers.
 *
 * CRITICAL — this component does NOT decide what you can see.
 * It renders the SAME `items` array the portal already computes from role
 * gating and the CEO's per-user tab-access overrides. Grouping is presentation
 * only: a section renders if and only if at least one of its tabs survived
 * that filter, and any tab missing from SECTIONS still appears (under "Other")
 * rather than silently vanishing. Adding a tab to the system can never make it
 * unreachable by forgetting to list it here.
 *
 * Phones never render this — they keep the v1.11.1 bottom nav.
 */

import { useRef, useState, type KeyboardEvent } from "react";
import { TabIcon, LogOut } from "@/components/layout/nav-icons";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getLang } from "@/lib/i18n";

interface NavItem { name: string; label: string }

/**
 * Presentation grouping only — see the note above. Order defines display order.
 *
 * v1.102.0 — CEO, 05-09-2026, writing the whole tab list out in the order he
 * wants it. These sections are CUTS of that one sequence, not a second
 * ordering laid over it: read the tabs down this list and you get exactly
 * ALL_TABS in lib/portal-tabs.ts, which is also the order of the phone bottom
 * bar. tests/registry-parity.mjs holds the two together, because a sidebar
 * that resequences the registry is a second answer to "what order are the
 * tabs in", and the whole point of v1.79.0 was that there is one.
 *
 * v1.172.0 — Portal UI V2. The CEO's target information architecture is
 * OVERVIEW / SALES / OPERATIONS / PEOPLE / AUTOMATION / INTELLIGENCE / SYSTEM,
 * exposing only modules that exist. Mapped onto this portal:
 *   Overview    Dashboard
 *   Sales       Ecommerce, Sales, Enquiries, Sales Performance, Hankei's
 *               (what is sold, to whom, by whom, and the second brand's orders)
 *   Operations  Inventory, Assets, Hotels (what the company holds and works)
 *   ELFIA       ELFIA Store, Web Orders, ELFIA Traffic - the client store is a
 *               workspace of its own and keeps the heading the CEO gave it
 *   People      HR through Payroll
 *   Finance     Finance, Commission, Accounting, Companies - no target group
 *               names them and they exist, so they keep their own heading
 *   Account     Cards, Profile (who you are)
 *   System      Users (accounts, permissions, locations - the settings)
 * AUTOMATION and INTELLIGENCE have no portal modules yet (Telegram is an API
 * contract and a simulator, not a tab) and are therefore not drawn: a heading
 * with nothing under it is a promise the product does not keep.
 *
 * Stokis, Content and Threads are absent because they are PARKED, and a parked
 * tab never reaches this component: it is filtered out of `items` upstream.
 */
export const SECTIONS: { title: string; tabs: string[] }[] = [
  { title: "Overview", tabs: ["Dashboard"] },
  { title: "Sales", tabs: ["Ecommerce", "Sales", "Enquiries", "Sales Performance", "Hankeis"] },
  { title: "Operations", tabs: ["Inventory", "Assets", "Hotels"] },
  { title: "ELFIA", tabs: ["ELFIA Store", "Web Orders", "ELFIA Traffic"] },
  { title: "People", tabs: ["HR", "Attendance", "On Shift", "Tasks", "Announcements", "Staff Details", "Leave", "Claims", "Payroll"] },
  { title: "Finance", tabs: ["Finance", "Commission", "Accounting", "Companies"] },
  { title: "Account", tabs: ["Cards", "Profile"] },
  { title: "System", tabs: ["Users"] },
];

/** BM display names for the section headings - ONE map, read by this rail
    and by the phone's More sheet (app/portal/page.tsx), so the two surfaces
    cannot name a group differently. */
export const SECTION_LABEL_MS: Record<string, string> = {
  Overview: "Ringkasan", Sales: "Jualan", Operations: "Operasi", ELFIA: "ELFIA", People: "Kakitangan",
  Finance: "Kewangan", Account: "Akaun", System: "Sistem", Other: "Lain-lain",
};
export const sectionTitle = (title: string, lang: string): string =>
  lang === "ms" ? SECTION_LABEL_MS[title] ?? title : title;

/** v1.172.0 - the rail remembers whether it was collapsed. One key, read
    before the first paint of the shell by app/portal/page.tsx. */
export const NAV_COLLAPSED_KEY = "azone-nav-collapsed";

export function SideNav({
  items, active, onSelect, onSignOut, collapsed, onToggleCollapsed, userName, userRole,
}: {
  items: NavItem[];
  active: string;
  onSelect: (name: string) => void;
  onSignOut: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  userName: string;
  userRole: string;
}) {
  const lang = getLang();
  const ms = lang === "ms";
  const byName = new Map(items.map((i) => [i.name, i]));
  const navRef = useRef<HTMLElement | null>(null);
  /* v1.172.0 - the icon-only rail names its destinations on hover and on
     keyboard focus, so a collapsed rail is never a memory test. ONE floating
     label, fixed to the viewport beside the hovered button: a label inside
     the scrolling <nav> would be clipped by its overflow. Decorative - each
     button's aria-label already carries the name. */
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTip = (el: HTMLElement, label: string) => {
    if (!collapsed) return;
    const r = el.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
  };
  /* v1.172.0 - roving keyboard focus along the rail: Up/Down move between
     destinations across section boundaries, Home/End jump to the ends. Tab
     still leaves the rail after one stop, as a toolbar should. */
  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const nodes = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>("button[data-nav-item]") ?? []);
    if (nodes.length === 0) return;
    const at = nodes.indexOf(document.activeElement as HTMLButtonElement);
    let next = at;
    if (e.key === "ArrowDown") next = at < 0 ? 0 : Math.min(at + 1, nodes.length - 1);
    if (e.key === "ArrowUp") next = at < 0 ? nodes.length - 1 : Math.max(at - 1, 0);
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = nodes.length - 1;
    e.preventDefault();
    nodes[next]?.focus();
  };
  const grouped = SECTIONS
    .map((s) => ({ title: s.title, items: s.tabs.map((t) => byName.get(t)).filter((x): x is NavItem => !!x) }))
    .filter((s) => s.items.length > 0);

  // Anything the SECTIONS map doesn't know about still gets a home.
  const placed = new Set(SECTIONS.flatMap((s) => s.tabs));
  const orphans = items.filter((i) => !placed.has(i.name));
  if (orphans.length) grouped.push({ title: "Other", items: orphans });

  return (
    <aside
      className={`border-border bg-background hidden h-full shrink-0 flex-col border-r md:flex ${collapsed ? "w-16" : "w-56"}`}
      aria-label={ms ? "Navigasi utama" : "Main navigation"}
    >
      {/* Brand + collapse toggle */}
      <div className={`flex min-h-16 shrink-0 items-center gap-2 border-b border-border ${collapsed ? "justify-center px-2" : "px-3"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {!collapsed && <img src="/logo.png" alt="" className="h-8 w-8 shrink-0 rounded-lg bg-white object-contain p-1" />}
        {!collapsed && (
          <span className="min-w-0 flex-1 text-xs font-semibold leading-relaxed">
            A2Z CREATIVE MARKETING
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? (ms ? "Buka navigasi" : "Expand navigation") : (ms ? "Kecilkan navigasi" : "Collapse navigation")}
          title={collapsed ? (ms ? "Buka navigasi" : "Expand navigation") : (ms ? "Kecilkan navigasi" : "Collapse navigation")}
          aria-expanded={!collapsed}
          className="text-muted-foreground hover:bg-secondary grid h-11 w-11 shrink-0 place-items-center rounded-lg"
        >
          {collapsed ? <PanelLeftOpen aria-hidden className="h-4 w-4" /> : <PanelLeftClose aria-hidden className="h-4 w-4" />}
        </button>
      </div>

      <nav ref={navRef} onKeyDown={onNavKey} className="scrollbar-none min-h-0 flex-1 overflow-y-auto py-2">
        {grouped.map((section) => (
          <div key={section.title} className="mb-1">
            {/* The section header is decorative; the list below is what is
                announced. Collapsed mode replaces it with a hairline so the
                grouping is still legible without text. */}
            {collapsed ? (
              <div className="border-border mx-3 my-2 border-t" aria-hidden />
            ) : (
              <p className="text-muted-foreground px-4 pt-3 pb-1 text-[10px] font-semibold tracking-wider uppercase">
                {sectionTitle(section.title, lang)}
              </p>
            )}
            <ul>
              {section.items.map((it) => {
                const on = it.name === active;
                return (
                  <li key={it.name}>
                    <button
                      type="button"
                      data-nav-item
                      onClick={() => onSelect(it.name)}
                      onMouseEnter={(e) => showTip(e.currentTarget, it.label)}
                      onFocus={(e) => showTip(e.currentTarget, it.label)}
                      onMouseLeave={() => setTip(null)}
                      onBlur={() => setTip(null)}
                      aria-current={on ? "page" : undefined}
                      title={collapsed ? it.label : undefined}
                      aria-label={it.label}
                      className={`group relative flex min-h-11 w-full items-center gap-2.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                        collapsed ? "justify-center px-0" : "px-3"
                      } ${on ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                    >
                      {/* gold active marker — the same cue the rail used */}
                      {on && <span aria-hidden className="bg-gold absolute inset-y-0 left-0 w-1" />}
                      <span className="grid w-5 shrink-0 place-items-center"><TabIcon name={it.name} className="h-4 w-4" /></span>
                      {!collapsed && <span className="min-w-0 flex-1 text-left break-words">{it.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {tip && collapsed && (
        <span aria-hidden style={{ top: tip.top, left: tip.left }}
          className="bg-foreground text-background pointer-events-none fixed z-40 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium shadow-md">
          {tip.label}
        </span>
      )}

      {/* Signed-in identity + sign out */}
      <div className="border-border shrink-0 border-t p-2">
        {!collapsed && (
          <div className="px-1 pb-2">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="text-muted-foreground truncate text-xs capitalize">{userRole.replace(/_/g, " ")}</p>
          </div>
        )}
        <button
          type="button"
          onClick={onSignOut}
          title={ms ? "Log keluar" : "Sign out"}
          aria-label={ms ? "Log keluar" : "Sign out"}
          className={`text-muted-foreground hover:bg-secondary hover:text-foreground flex min-h-11 w-full items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium transition-colors ${
            collapsed ? "justify-center px-0" : "px-2"
          }`}
        >
          <span className="grid w-5 shrink-0 place-items-center"><LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} /></span>
          {!collapsed && <span>{ms ? "Log keluar" : "Sign out"}</span>}
        </button>
      </div>
    </aside>
  );
}
