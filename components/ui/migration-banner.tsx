"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function MigrationBanner() {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // Only check once per page load to avoid spamming
    void api<{ pending: boolean }>("/health/migrations").then((r) => {
      if (r.ok && r.data?.pending) {
        setPending(true);
      }
    });
  }, []);

  if (!pending) return null;

  return (
    <div className="bg-destructive/10 border-destructive text-destructive sticky top-0 z-40 flex w-full flex-col items-center justify-center border-b px-4 py-2 text-center text-sm font-medium backdrop-blur transition-all">
      <div className="flex items-center">
        <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Database migrations pending.
      </div>
      <span className="text-xs font-normal opacity-90">
        The backend database is out-of-date. Some features (like payroll and documents) may fail until migrations are applied.
      </span>
    </div>
  );
}
