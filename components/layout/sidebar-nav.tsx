"use client";

/* v1.8.0 — the desktop icon sidebar (reference-design shell, brand palette).
   Renders from the SAME `tabs` array the portal already computes, so the
   CEO's tab-access control, role gates and the no-flash clamp all keep
   working unchanged. Hidden below `md` — phones keep the bottom nav. */

import { TabIcon, LogOut } from "@/components/layout/nav-icons";

interface SidebarItem { name: string; label: string }

/* v1.126.0 — the ICONS emoji map that lived here is DELETED.

   v1.16.0 replaced it with lucide SVGs (nav-icons.tsx) and left it behind
   under a DEPRECATED note, "nothing in the UI should render from it". Nothing
   did — no file imported it. But the CEO's icon audit, 06-09-2026, opened this
   file, read the map, and reported the whole navigation as emoji. It was the
   single biggest finding in that audit and it was about dead code.

   That is the cost of a deprecated export nobody deletes: it is indexed,
   grepped and read as current long after it stops running. The nav has been
   SVG since v1.16.0; now the file says so only once, and only in the truth. */
export function SidebarNav({ items, active, onSelect, onSignOut }: {
  items: SidebarItem[];
  active: string;
  onSelect: (name: string) => void;
  onSignOut: () => void;
}) {
  /* v1.21.1: the shell is viewport-fixed now (content scrolls INSIDE the
     canvas), so the rail is a plain full-height flex child of the navy
     gutter — the old sticky/100vh arithmetic is gone with the page scroll. */
  return (
    <aside
      className="z-40 hidden h-full w-14 flex-col items-center gap-1 py-3 md:flex"
      aria-label="Portal navigation"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="A2Z CREATIVE MARKETING" className="mb-2 h-8 w-8 shrink-0 rounded-lg bg-white/90 object-contain p-1" />
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
