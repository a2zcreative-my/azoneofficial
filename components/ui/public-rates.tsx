"use client";

/* v1.4.273 idea 3 — the published rate card, INSIDE the existing /packages
   page. The page has always said "we quote per brand"; the CEO can now
   publish real starting prices from the portal (Sales → 📦 Packages) and
   this section appears the moment tiers exist — no rebuild, no deploy.
   Until then it renders NOTHING, so the page keeps its current copy and
   never shows placeholders (house rule). */

import { useEffect, useState } from "react";

interface Tier { name: string; price_label: string; points: string[] }

export function PublicRates({ whatsapp }: { whatsapp: string }) {
  const [tiers, setTiers] = useState<Tier[] | null>(null);

  useEffect(() => {
    void fetch("/api/v1/packages")
      .then(async (r) => { if (r.ok) setTiers(((await r.json()) as { packages: Tier[] | null }).packages); })
      .catch(() => { /* section simply doesn't render */ });
  }, []);

  if (!tiers || tiers.length === 0) return null;

  return (
    <section>
      <h2>Published rates</h2>
      <p className="mt-3 mb-6">
        Starting prices for our most common engagements — the exact quote still
        follows the free live audit.
      </p>
      <div className={`grid gap-4 ${tiers.length >= 3 ? "md:grid-cols-3" : tiers.length === 2 ? "md:grid-cols-2" : ""}`}>
        {tiers.map((t, i) => (
          <div key={i} className={`border-border flex flex-col rounded-2xl border p-5 ${i === 1 && tiers.length >= 3 ? "border-[#C9A227] shadow-md" : ""}`}>
            <p className="text-sm font-bold tracking-wide uppercase">{t.name}</p>
            {t.price_label && <p className="mt-1 text-xl font-bold">{t.price_label}</p>}
            {t.points.length > 0 && (
              <ul className="text-muted-foreground mt-3 space-y-1.5 text-sm">
                {t.points.map((p, j) => <li key={j} className="flex gap-2"><span className="text-[#C9A227]">✓</span>{p}</li>)}
              </ul>
            )}
            {/* CTA pinned with flex margin-top:auto — never absolute */}
            <a className="mt-auto pt-4" href={whatsapp}>
              <span className="bg-primary text-primary-foreground block rounded-lg px-4 py-2 text-center text-sm font-semibold">
                WhatsApp us about {t.name}
              </span>
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
