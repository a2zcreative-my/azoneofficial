"use client";

/* v1.13.0 — the grouped ERP sidebar (CEO's DZI reference).
 *
 * Replaces the v1.8.0/v1.12.0 icon-only rail on desktop. An icon rail works
 * for six destinations; this system has twenty-one and is heading for closer
 * to thirty once Purchasing, Commission, Ads Fund, Cash Flow, Reconciliation
 * and Accounting land. Unlabelled icons at that count stop being navigation
 * and become a memory test — hence sections with headers.
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

import { TabIcon, LogOut } from "@/components/layout/nav-icons";

interface NavItem { name: string; label: string }

/**
 * Presentation grouping only — see the note above. Order defines display order.
 *
 * v1.102.0 — CEO, 05-09-2026, writing the whole tab list out in the order he
 * wants it. These sections are now CUTS of that one sequence, not a second
 * ordering laid over it: read the tabs down this list and you get exactly
 * ALL_TABS in lib/portal-tabs.ts, which is also the order of the phone bottom
 * bar. tests/registry-parity.mjs holds the two together, because a sidebar
 * that resequences the registry is a second answer to "what order are the
 * tabs in", and the whole point of v1.79.0 was that there is one.
 *
 * Five tabs had never been placed at all — Hotels, Threads, ELFIA Store, Web
 * Orders and ELFIA Traffic all landed after v1.13.0 and fell through to
 * "Other" at the bottom of the rail. That is what the CEO was looking at.
 *
 * Stokis and Content are absent because they are PARKED, and a parked tab
 * never reaches this component: it is filtered out of `items` upstream.
 */
export const SECTIONS: { title: string; tabs: string[] }[] = [
  { title: "Overview", tabs: ["Dashboard"] },
  { title: "Business", tabs: ["Ecommerce", "Inventory", "Sales", "Assets", "Hotels", "Threads"] },
  { title: "ELFIA", tabs: ["ELFIA Store", "Web Orders", "ELFIA Traffic"] },
  { title: "People", tabs: ["HR", "Attendance", "Tasks", "Announcements", "Staff Details", "Leave", "Claims", "Payroll"] },
  { title: "Finance", tabs: ["Finance", "Reconciliation", "Commission", "Ads Fund", "Purchasing", "Accounting"] },
  { title: "Account", tabs: ["Profile", "Users"] },
];

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
  const byName = new Map(items.map((i) => [i.name, i]));
  const grouped = SECTIONS
    .map((s) => ({ title: s.title, items: s.tabs.map((t) => byName.get(t)).filter((x): x is NavItem => !!x) }))
    .filter((s) => s.items.length > 0);

  // Anything the SECTIONS map doesn't know about still gets a home.
  const placed = new Set(SECTIONS.flatMap((s) => s.tabs));
  const orphans = items.filter((i) => !placed.has(i.name));
  if (orphans.length) grouped.push({ title: "Other", items: orphans });

  return (
    <aside
      className={`bg-brand sticky top-0 hidden h-screen shrink-0 flex-col md:flex ${collapsed ? "w-16" : "w-60"} transition-[width] duration-200`}
      aria-label="Main navigation"
    >
      {/* Brand + collapse toggle */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-8 w-8 shrink-0 rounded-lg bg-white/90 object-contain p-1" />
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-white">
            A2Z CREATIVE MARKETING
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span aria-hidden>{collapsed ? "»" : "«"}</span>
        </button>
      </div>

      <nav className="scrollbar-none min-h-0 flex-1 overflow-y-auto py-2">
        {grouped.map((section) => (
          <div key={section.title} className="mb-1">
            {/* The section header is decorative; the list below is what is
                announced. Collapsed mode replaces it with a hairline so the
                grouping is still legible without text. */}
            {collapsed ? (
              <div className="mx-3 my-2 border-t border-white/10" aria-hidden />
            ) : (
              <p className="text-gold px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.14em] uppercase">
                {section.title}
              </p>
            )}
            <ul>
              {section.items.map((it) => {
                const on = it.name === active;
                return (
                  <li key={it.name}>
                    <button
                      type="button"
                      onClick={() => onSelect(it.name)}
                      aria-current={on ? "page" : undefined}
                      title={collapsed ? it.label : undefined}
                      className={`group relative flex w-full items-center gap-2.5 py-2 text-[13px] font-medium transition-colors ${
                        collapsed ? "justify-center px-0" : "px-3"
                      } ${on ? "bg-brand-soft text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
                    >
                      {/* gold active marker — the same cue the rail used */}
                      {on && <span aria-hidden className="bg-gold absolute inset-y-0 left-0 w-1" />}
                      <span className="grid w-5 shrink-0 place-items-center"><TabIcon name={it.name} className="h-4 w-4" /></span>
                      {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{it.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Signed-in identity + sign out */}
      <div className="shrink-0 border-t border-white/10 p-2">
        {!collapsed && (
          <div className="px-1 pb-2">
            <p className="truncate text-[12.5px] font-medium text-white">{userName}</p>
            <p className="text-gold truncate text-[11px] capitalize">{userRole.replace(/_/g, " ")}</p>
          </div>
        )}
        <button
          type="button"
          onClick={onSignOut}
          title={collapsed ? "Sign out" : undefined}
          className={`flex w-full items-center gap-2.5 rounded-lg py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white ${
            collapsed ? "justify-center px-0" : "px-2"
          }`}
        >
          <span className="grid w-5 shrink-0 place-items-center"><LogOut aria-hidden className="h-4 w-4" strokeWidth={1.75} /></span>
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}
