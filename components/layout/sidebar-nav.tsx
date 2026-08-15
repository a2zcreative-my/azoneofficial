"use client";

/* v1.8.0 — the desktop icon sidebar (reference-design shell, brand palette).
   Renders from the SAME `tabs` array the portal already computes, so the
   CEO's tab-access control, role gates and the no-flash clamp all keep
   working unchanged. Hidden below `md` — phones keep the bottom nav. */

import { TabIcon, LogOut } from "@/components/layout/nav-icons";

interface SidebarItem { name: string; label: string }

/* v1.10.0: exported — the mobile bottom nav renders the SAME icon per tab,
   so the two navigations speak one visual language.
   v1.16.0: DEPRECATED — chrome icons are lucide SVGs now (nav-icons.tsx).
   This emoji map remains only for the PDF/doc templates and anything else
   that needs a plain-text glyph; nothing in the UI should render from it. */
export const ICONS: Record<string, string> = {
  Dashboard: "▦",
  Overview: "◫",
  Announcements: "📣",
  HR: "🗂",
  "Staff Details": "🪪",
  Attendance: "⏱",
  Leave: "🌴",
  Tasks: "☑",
  Pipeline: "🧲",
  Content: "🎬",
  Claims: "🧾",
  Payroll: "💰",
  Expenses: "📉",
  Sales: "📄",
  Inventory: "📦",
  Stokis: "🏪",
  Ecommerce: "🛒",
  Assets: "🎥",
  Birthdays: "🎂",
  Profile: "👤",
  Users: "🔐",
};

export function SidebarNav({ items, active, onSelect, onSignOut }: {
  items: SidebarItem[];
  active: string;
  onSelect: (name: string) => void;
  onSignOut: () => void;
}) {
  /* v1.12.0: the rail no longer pins itself to the viewport. It is `sticky`
     inside AppShell's navy gutter, so it rides the rounded canvas instead of
     sitting on top of it. The gutter owns the navy background and the rounded
     left corners; this element owns the icons. top-5 and 100vh-2.5rem match
     the shell's p-5 band on the top and bottom edges. */
  return (
    <aside
      className="sticky top-5 z-40 hidden h-[calc(100vh-2.5rem)] w-14 flex-col items-center gap-1 py-3 md:flex"
      aria-label="Portal navigation"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="AZ ONE OFFICIAL" className="mb-2 h-8 w-8 shrink-0 rounded-lg bg-white/90 object-contain p-1" />
      <nav className="scrollbar-none flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {items.map((it) => (
          <button
            key={it.name}
            type="button"
            title={it.label}
            aria-label={it.label}
            aria-current={it.name === active ? "page" : undefined}
            onClick={() => onSelect(it.name)}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base transition-colors ${
              it.name === active
                ? "bg-gold text-brand shadow-sm"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <TabIcon name={it.name} />
          </button>
        ))}
      </nav>
      <button
        type="button"
        title="Sign out"
        aria-label="Sign out"
        onClick={onSignOut}
        className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <LogOut aria-hidden className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </button>
    </aside>
  );
}
