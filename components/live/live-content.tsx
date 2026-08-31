"use client";

/**
 * Public components that read published content from D1 via the API Worker.
 * Graceful: if the API is unreachable or empty, they fall back to the honest
 * "in preparation" state / hide entirely — the static site never breaks.
 */

import { useEffect, useState } from "react";
import { Skel } from "@/components/ui/skeleton";

const API = "/api/v1";

/* ---------------- Portfolio ---------------- */

interface PortfolioRow {
  id: number;
  client: string;
  summary: string | null;
  result: string | null;
}

export function LivePortfolio({ fallback }: { fallback: React.ReactNode }) {
  const [items, setItems] = useState<PortfolioRow[] | null>(null);

  useEffect(() => {
    void fetch(`${API}/portfolio`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items: PortfolioRow[] } | null) =>
        setItems(data?.items ?? []),
      )
      .catch(() => setItems([]));
  }, []);

  /* v1.77.0 — skeleton until the first fetch lands. `items === null` is
     "still loading" (a failed or empty answer resolves it to []); the tiles
     use the real grid and card classes so the section keeps its footprint. */
  if (items === null) {
    return (
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <article key={i} className="rounded-xl border border-border p-5">
            <Skel className="h-5 w-40" />
            <Skel className="mt-2 h-3 w-full" />
            <Skel className="mt-1.5 h-3 w-5/6" />
            <Skel className="mt-4 h-3 w-1/2" />
          </article>
        ))}
      </section>
    );
  }
  if (items.length === 0) return <>{fallback}</>;

  return (
    <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">{item.client}</h2>
          {item.summary && <p className="mt-1 text-sm">{item.summary}</p>}
          {item.result && (
            <p className="text-gold-deep mt-3 text-sm font-medium">{item.result}</p>
          )}
        </article>
      ))}
    </section>
  );
}

/* ---------------- Testimonials ---------------- */

interface TestimonialRow {
  id: number;
  author: string;
  company: string | null;
  position: string | null;
  review: string;
  rating: number | null;
}

export function LiveTestimonials() {
  const [items, setItems] = useState<TestimonialRow[]>([]);
  /* v1.77.0 — skeleton until the first fetch lands. `items` starts [] (the
     same value as "no testimonials"), so one flag separates the two. */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch(`${API}/testimonials`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items: TestimonialRow[] } | null) =>
        setItems(data?.items ?? []),
      )
      .catch(() => setItems([]))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <div className="mt-16" aria-hidden>
        <Skel className="h-7 w-48" />
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <figure key={i} className="h-full rounded-xl border border-border p-6">
              <Skel className="h-3.5 w-20" />
              <Skel className="mt-3 h-3 w-full" />
              <Skel className="mt-1.5 h-3 w-full" />
              <Skel className="mt-1.5 h-3 w-2/3" />
              <Skel className="mt-4 h-2.5 w-1/2" />
            </figure>
          ))}
        </div>
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <div className="mt-16">
      <h3 className="text-xl font-semibold tracking-tight">
        What clients say
      </h3>
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((t) => (
          <figure key={t.id} className="h-full rounded-xl border border-border p-6">
            {typeof t.rating === "number" && t.rating > 0 && (
              <p className="text-gold-deep text-sm" aria-label={`${t.rating} out of 5 stars`}>
                {"★".repeat(Math.min(5, t.rating))}
                <span className="text-border">{"★".repeat(Math.max(0, 5 - t.rating))}</span>
              </p>
            )}
            <blockquote className="mt-2 text-sm leading-relaxed">
              &ldquo;{t.review}&rdquo;
            </blockquote>
            <figcaption className="text-muted-foreground mt-4 text-xs">
              <span className="font-medium text-foreground">{t.author}</span>
              {t.position || t.company
                ? ` — ${[t.position, t.company].filter(Boolean).join(", ")}`
                : ""}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
