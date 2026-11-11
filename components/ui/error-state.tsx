"use client";

/* v1.276.0 - A2Z OS 3.0: THE ERROR STATE. A failed request is not an empty
   list: it says what could not be loaded, in safe words (never a stack or a
   server message meant for a developer), and offers Retry when retrying can
   help. Built on EmptyState's error tone, so the two read as one family. */

import { EmptyState } from "@/components/ui/empty-state";
import { btnSm } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export function ErrorState({ title, hint, onRetry }: {
  /** what could not be loaded ("The invoices could not be loaded") */
  title?: string;
  /** what the person can do, when Retry is not enough */
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      tone="error"
      title={title ?? L("This could not be loaded", "Ini tidak dapat dimuatkan")}
      hint={hint ?? L("Check the connection and try again. Nothing was changed.", "Semak sambungan dan cuba lagi. Tiada apa yang diubah.")}
      action={onRetry ? <button type="button" className={btnSm} onClick={onRetry}>{L("Retry", "Cuba lagi")}</button> : undefined}
    />
  );
}
