"use client";

/* v1.8.0 — the desktop icon sidebar (reference-design shell, brand palette).
   Renders from the SAME `tabs` array the portal already computes, so the
   CEO's tab-access control, role gates and the no-flash clamp all keep
   working unchanged. Hidden below `md` — phones keep the bottom nav. */

interface SidebarItem { name: string; label: string }

const ICONS: Record<string, string> = {
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
  return (
    <aside
      className="bg-brand fixed inset-y-0 left-0 z-40 hidden w-14 flex-col items-center gap-1 py-3 md:flex"
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
            <span aria-hidden>{ICONS[it.name] ?? "▪"}</span>
          </button>
        ))}
      </nav>
      <button
        type="button"
        title="Sign out"
        aria-label="Sign out"
        onClick={onSignOut}
        className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <span aria-hidden>⎋</span>
      </button>
    </aside>
  );
}
