"use client";

/* v1.8.0 — SegmentedTabs (UI-REDESIGN-PLAN.md Phase 0).
   The reference toolbar's pill filter row ("Today · ‹ › · Week of …",
   status filters). One control instead of every card hand-rolling its own
   row of chip buttons. Controlled; generic over string unions. */

export function SegmentedTabs<T extends string>({ options, value, onChange, size = "md", labels, ariaLabel }: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  /** Optional display names; falls back to the option string. */
  labels?: Partial<Record<T, string>>;
  ariaLabel?: string;
}) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div role="tablist" aria-label={ariaLabel}
      className="border-border bg-secondary/60 inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="tab"
          aria-selected={o === value}
          onClick={() => onChange(o)}
          className={`shrink-0 rounded-[10px] font-medium whitespace-nowrap transition-colors ${pad} ${
            o === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}
