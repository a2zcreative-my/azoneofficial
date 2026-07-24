"use client";

/**
 * Public components that read published content from D1 via the API Worker.
 * Graceful: if the API is unreachable or empty, they fall back to the honest
 * "in preparation" state / hide entirely — the static site never breaks.
 */

import { useEffect, useState } from "react";

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

  if (!items || items.length === 0) return <>{fallback}</>;

  return (
    <section className="grid gap-6 sm:grid-cols-2">
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

  useEffect(() => {
    void fetch(`${API}/testimonials`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items: TestimonialRow[] } | null) =>
        setItems(data?.items ?? []),
      )
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="mt-16">
      <h3 className="text-xl font-semibold tracking-tight">
        What clients say
      </h3>
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
