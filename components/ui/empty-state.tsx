"use client";

/* v1.170.0 - the one empty state.
 *
 * "No data." answers nothing. A person looking at an empty list wants three
 * things: WHAT is empty, WHY it is probably empty, and WHAT they can do about
 * it. This component carries exactly those three, in the house vocabulary
 * (AppIcon, the erp-empty geometry in styles/globals.css; v1.172.2: no utilities), so every panel that
 * adopts it reads the same way. Errors are NOT empty states - a failed
 * request has its own copy and a retry; use `tone="error"` for that so the
 * icon and the emphasis say "something failed" rather than "nothing here".
 */
import type { ReactNode } from "react";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";

export function EmptyState({
  icon = "documents", title, hint, action, tone = "neutral", className = "",
}: {
  icon?: AppIconName;
  /** what is empty - short, a noun phrase or one sentence */
  title: string;
  /** why it is likely empty, and what fills it */
  hint?: string;
  /** the one thing they can do about it, when there is one */
  action?: ReactNode;
  tone?: "neutral" | "error";
  className?: string;
}) {
  return (
    <div className={`erp-empty ${className}`} role={tone === "error" ? "alert" : undefined}>
      <span className={`erp-empty-icon ${tone === "error" ? "erp-empty-icon-error" : ""}`} aria-hidden>
        <AppIcon name={tone === "error" ? "warning" : icon} className="erp-icon-lg" />
      </span>
      <p className="erp-empty-title">{title}</p>
      {hint && <p className="erp-empty-hint">{hint}</p>}
      {action && <div className="erp-empty-action">{action}</div>}
    </div>
  );
}
