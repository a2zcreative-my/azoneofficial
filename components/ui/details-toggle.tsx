"use client";

/**
 * v1.4.196 (CEO: "by click on the data I can see the details data. if I
 * didnt click on the data then it will hide the details data. this is to
 * minimalist the view"): the portal-wide disclosure standard. Summary
 * figures stay visible; supporting detail collapses behind one click.
 * Session-only state — every visit starts minimalist.
 */
import { useState, type ReactNode } from "react";

export function DetailsToggle({
  label = "Details",
  defaultOpen = false,
  className = "",
  children,
}: {
  label?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`mt-2 ${className}`}>
      <button
        type="button"
        className="text-muted-foreground inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        {open ? `Hide ${label.toLowerCase()}` : label}
      </button>
      {open && children}
    </div>
  );
}
