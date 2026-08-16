"use client";

/* v1.22.7 — portal crash recovery (a staff member was locked out: her last
   tab crashed on load, the portal reopens the last tab, so every visit
   white-screened with "Application error"). Any unhandled render error now
   lands HERE instead: a branded recovery screen whose primary action clears
   the remembered tab and restarts on the Dashboard. */

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const backToDashboard = () => {
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith("azone-tab:")) window.localStorage.removeItem(k);
      }
    } catch { /* private mode */ }
    // full reload — a clean mount on the Dashboard, nothing half-broken kept
    window.location.reload();
  };

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="border-border bg-card w-full max-w-md rounded-2xl border p-6 text-center shadow-sm">
        <p className="text-gold-deep text-[10px] font-semibold tracking-[0.25em] uppercase">AZ ONE OFFICIAL</p>
        <h1 className="mt-2 text-lg font-semibold">Something went wrong on this screen</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          A card on the page hit an error. Your data is safe — go back to the
          Dashboard and carry on; if this keeps happening, tell the CEO or COO
          which tab you clicked.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={backToDashboard}
            className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Back to Dashboard
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="border-border rounded-lg border px-4 py-2 text-sm font-medium hover:bg-secondary"
          >
            Try again
          </button>
        </div>
        {error?.message && (
          <p className="text-muted-foreground/70 mt-4 text-[10px] break-words">
            Detail for support: {error.message.slice(0, 160)}
          </p>
        )}
      </div>
    </div>
  );
}
