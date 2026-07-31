"use client";

import { useState, type ComponentProps } from "react";

/**
 * Password field with a show/hide eye toggle. One component so every password
 * box in the system behaves identically — login already had an eye; this
 * brings the admin and profile forms to the same standard.
 */
export function PasswordInput({
  className = "",
  ...props
}: ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative block">
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-1 transition-colors"
      >
        {visible ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2.4 2.4 0 0 0 3.35 3.35" />
            <path d="M9.4 5.2A9.8 9.8 0 0 1 12 4.9c4.6 0 8.3 3.3 9.75 7.1a13 13 0 0 1-3.2 4.6M6.2 6.8A12.6 12.6 0 0 0 2.25 12c1.45 3.8 5.15 7.1 9.75 7.1 1 0 1.95-.15 2.85-.45" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
            <path d="M2.25 12C3.7 8.2 7.4 4.9 12 4.9s8.3 3.3 9.75 7.1c-1.45 3.8-5.15 7.1-9.75 7.1S3.7 15.8 2.25 12Z" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
        )}
      </button>
    </span>
  );
}
