"use client";

/* v1.4.273 idea 1 — the client report page. Public, read-only, reachable
   only via the token the agency shares (?t=…), same trust model as the
   sales-document share link. No login, no zero-stat sections: anything
   empty simply doesn't render.

   v1.124.0 — the brand navy and gold were spelled here as literal hex; they
   now come from the --doc-* PAPER variables (styles/globals.css, mirrored in
   lib/doc-theme.ts). The same change gave this page an explicit white ground:
   it had none, so a client whose phone was in dark mode got navy ink on the
   app's dark background and could not read their own report. A report is
   paper — it is white in every theme. */

import { useEffect, useState } from "react";
import { fmtRM, ym, dmy } from "@/lib/format";
/* v1.28.0 — the monthly report is prepared TODAY by the current operator,
   so every identity string on it comes from DOCUMENT_ISSUER (lib/issuers.ts). */
import { DOCUMENT_ISSUER } from "@/lib/issuers";
import { Skel } from "@/components/ui/skeleton"; // v1.77.0

interface Report {
  company: string;
  month: string;
  lives: { this_month: number; minutes: number; last_month: number };
  invoiced_paid_cents: number;
  top_hours: { hour: string; n: number }[];
  generated: string;
}

export default function ClientReportPage() {
  const [rep, setRep] = useState<Report | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "bad">("loading");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t") ?? "";
    if (!t) { setState("bad"); return; }
    void fetch(`/api/v1/client-report?t=${encodeURIComponent(t)}`)
      .then(async (r) => {
        if (!r.ok) { setState("bad"); return; }
        setRep((await r.json()) as Report); setState("ok");
      })
      .catch(() => setState("bad"));
  }, []);

  if (state === "loading") {
    /* v1.77.0 — skeleton until the first fetch lands. It used to say
       "Loading your report…" in words; now the report's own shape in the
       SAME max-w-2xl wrapper — gold-ruled header, the two-across stat grid
       (navy tile first, like the real one), footer line — so nothing jumps
       when the figures arrive. The eyebrow line is real: it never loads. */
    return (
      <main className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-10" aria-busy="true">
        <header className="border-b-2 border-[var(--doc-gold)] pb-4">
          <p className="text-xs font-semibold tracking-widest text-[var(--doc-gold)] uppercase">{DOCUMENT_ISSUER.name} · Creative & Live Commerce</p>
          <Skel className="mt-2 h-7 w-56 max-w-full" />
          <Skel className="mt-2 h-3.5 w-48" />
        </header>
        <section className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-[var(--doc-navy)] p-4">
            <div className="h-2.5 w-28 rounded bg-white/20" />
            <div className="mt-2 h-9 w-16 rounded bg-white/25" />
            <div className="mt-2 h-3 w-32 rounded bg-white/15" />
          </div>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-xl border border-t-2 border-[var(--doc-line)] border-t-[var(--doc-gold)] p-4">
              <Skel className="h-2.5 w-28" />
              <Skel className="mt-2 h-8 w-24" />
            </div>
          ))}
        </section>
        <footer className="mt-8 border-t border-[var(--doc-line)] pt-4">
          <Skel className="h-3 w-64 max-w-full" />
          <Skel className="mt-2 h-3.5 w-52 max-w-full" />
        </footer>
      </main>
    );
  }
  if (state === "bad" || !rep) {
    return (
      <main className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-16 text-center">
        <p className="text-lg font-semibold text-[var(--doc-navy)]">This report link isn&apos;t valid.</p>
        <p className="mt-2 text-sm text-[var(--doc-muted)]">Please ask {DOCUMENT_ISSUER.name} for a fresh link.</p>
      </main>
    );
  }

  const hours = rep.lives.minutes > 0 ? `${Math.floor(rep.lives.minutes / 60)}h ${String(rep.lives.minutes % 60).padStart(2, "0")}m` : null;
  const delta = rep.lives.this_month - rep.lives.last_month;

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-4 py-10">
      <header className="border-b-2 border-[var(--doc-gold)] pb-4">
        <p className="text-xs font-semibold tracking-widest text-[var(--doc-gold)] uppercase">{DOCUMENT_ISSUER.name} · Creative & Live Commerce</p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--doc-navy)]">{rep.company}</h1>
        <p className="mt-0.5 text-sm text-[var(--doc-muted)]">Monthly performance — {ym(rep.month)}</p>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-[var(--doc-navy)] p-4 text-white">
          <p className="text-[10px] font-semibold tracking-wider uppercase opacity-70">Live sessions this month</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{rep.lives.this_month}</p>
          {rep.lives.last_month > 0 && (
            <p className="mt-1 text-xs opacity-80">
              {delta > 0 ? `▲ ${delta} more than last month` : delta < 0 ? `▼ ${-delta} fewer than last month` : "level with last month"}
            </p>
          )}
        </div>
        {rep.invoiced_paid_cents > 0 && (
          <div className="rounded-xl border border-t-2 border-[var(--doc-line)] border-t-[var(--doc-gold)] p-4">
            <p className="text-[10px] font-semibold tracking-wider text-[var(--doc-muted)] uppercase">Settled with us this month</p>
            <p className="mt-1 text-2xl font-bold text-[var(--doc-navy)] tabular-nums">{fmtRM(rep.invoiced_paid_cents)}</p>
          </div>
        )}
        {hours && (
          <div className="rounded-xl border border-t-2 border-[var(--doc-line)] border-t-[var(--doc-gold)] p-4">
            <p className="text-[10px] font-semibold tracking-wider text-[var(--doc-muted)] uppercase">Hours live</p>
            <p className="mt-1 text-2xl font-bold text-[var(--doc-navy)] tabular-nums">{hours}</p>
          </div>
        )}
        {rep.top_hours.length > 0 && (
          <div className="rounded-xl border border-t-2 border-[var(--doc-line)] border-t-[var(--doc-gold)] p-4">
            <p className="text-[10px] font-semibold tracking-wider text-[var(--doc-muted)] uppercase">Your best live hours</p>
            <p className="mt-1 text-lg font-semibold text-[var(--doc-navy)]">
              {rep.top_hours.map((h) => `${h.hour}:00`).join(" · ")}
            </p>
            <p className="mt-0.5 text-xs text-[var(--doc-muted)]">last 60 days, by sessions run</p>
          </div>
        )}
      </section>

      <footer className="mt-8 border-t border-[var(--doc-line)] pt-4 text-xs text-[var(--doc-muted)]">
        <p>Prepared by {DOCUMENT_ISSUER.name} · generated {dmy(rep.generated)}</p>
        <a className="mt-1 inline-block font-semibold text-[var(--doc-navy)] underline" href={`https://wa.me/${DOCUMENT_ISSUER.whatsapp.replace(/\D/g, "")}`}>
          WhatsApp us to plan next month&apos;s lives →
        </a>
      </footer>
    </main>
  );
}
