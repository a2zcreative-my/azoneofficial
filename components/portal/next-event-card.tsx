"use client";

/* v1.10.0 — the reference design's hero card: a navy panel at the top of the
   mobile Dashboard announcing the next thing that matters. Priority:
   next company event → whichever comes sooner of the next public holiday or
   staff birthday → nothing (the card hides rather than sit empty).
   Mobile only (md:hidden) — the desktop dashboard opens with the pulse strip.
   Tapping scrolls to the Upcoming events card further down the Dashboard. */

import { useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { Skel } from "@/components/ui/skeleton";
import { t as tr, type Lang } from "@/lib/i18n";

const api = makeApi("/staff");

interface Hero {
  eyebrow: "event" | "holiday" | "birthday";
  title: string;
  date: string; // YYYY-MM-DD
  location?: string | null;
}

function mytTodayISO(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function NextEventCard({ lang }: { lang: Lang }) {
  const [hero, setHero] = useState<Hero | null>(null);
  /* v1.77.0 — skeleton until the first fetch lands. `hero` is null BOTH while
     the requests are in flight and when there is genuinely nothing coming up
     (the card hides rather than sit empty), so a flag tells the two apart:
     band-shaped skeleton while loading, nothing once loaded with no hero. */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // md:hidden hides the card on desktop — skip the fetches there too
    // (1–3 calls per Dashboard visit for a card that can never be seen).
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) { setLoaded(true); return; }
    void (async () => {
      try {
      const today = mytTodayISO();
      const ev = await api<{ events: { title: string; event_date: string; location?: string | null }[] }>(`/events`);
      const next = (ev.data?.events ?? [])
        .filter((e) => e.event_date >= today)
        .sort((a, b) => a.event_date.localeCompare(b.event_date))[0];
      if (next) {
        setHero({ eyebrow: "event", title: next.title, date: next.event_date, location: next.location });
        return;
      }
      // Fallbacks: soonest of the next public holiday / next staff birthday.
      const [hol, bd] = await Promise.all([
        api<{ holidays: { holiday_date: string; name: string }[] }>(`/holidays?year=${today.slice(0, 4)}`),
        api<{ birthdays: { name: string; birthday: string }[] }>(`/birthdays-lite`),
      ]);
      let nh = (hol.data?.holidays ?? [])
        .filter((h) => h.holiday_date >= today)
        .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))[0];
      if (!nh) {
        // Late December: this year's holidays are spent — look at next year's
        // (birthdays already project across the year end; holidays should too).
        const hol2 = await api<{ holidays: { holiday_date: string; name: string }[] }>(`/holidays?year=${Number(today.slice(0, 4)) + 1}`);
        nh = (hol2.data?.holidays ?? []).sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))[0];
      }
      const nb = (bd.data?.birthdays ?? [])
        .flatMap((b) => {
          const md = b.birthday?.slice(5);
          if (!md || md.length !== 5) return [];
          let iso = `${today.slice(0, 4)}-${md}`;
          if (iso < today) iso = `${Number(today.slice(0, 4)) + 1}-${md}`;
          return [{ name: b.name, iso }];
        })
        .sort((a, b) => a.iso.localeCompare(b.iso))[0];
      if (nh && (!nb || nh.holiday_date <= nb.iso)) {
        setHero({ eyebrow: "holiday", title: nh.name, date: nh.holiday_date });
      } else if (nb) {
        setHero({ eyebrow: "birthday", title: `🎂 ${nb.name}`, date: nb.iso });
      }
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  if (!hero && !loaded) {
    /* v1.77.0 — skeleton until the first fetch lands: the navy band in the
       real card's shape (eyebrow · title · date line), mobile only like it. */
    return (
      <div className="bg-brand/95 relative block w-full overflow-hidden rounded-2xl p-5 shadow-sm md:hidden" aria-hidden>
        <div className="flex items-baseline justify-between gap-2">
          <Skel className="h-2.5 w-24 rounded bg-white/20" />
          <Skel className="h-2.5 w-16 rounded bg-white/15" />
        </div>
        <Skel className="mt-2.5 h-7 w-48 max-w-full rounded bg-white/25" />
        <Skel className="mt-3 h-3 w-56 max-w-full rounded bg-white/15" />
      </div>
    );
  }
  if (!hero) return null; // loaded, nothing upcoming — the card hides rather than sit empty

  const days = Math.round((Date.parse(hero.date) - Date.parse(mytTodayISO())) / 86400000);
  const when = days <= 0 ? tr("Today", lang) : days === 1 ? (lang === "ms" ? "Esok" : "Tomorrow") : lang === "ms" ? `${days} hari lagi` : `in ${days} days`;
  const eyebrow =
    hero.eyebrow === "event" ? tr("Next event", lang)
    : hero.eyebrow === "holiday" ? tr("Public holiday", lang)
    : tr("Birthday", lang);

  // App-wide standard: dates display DD-MM-YYYY (the column stores ISO).
  const shownDate = hero.date.split("-").reverse().join("-");

  return (
    <button
      type="button"
      onClick={() => document.getElementById("upcoming-events")?.scrollIntoView({ behavior: "smooth", block: "start" })}
      /* bg-brand (fixed navy), NOT bg-primary: in dark mode --primary flips
         near-white and the gold eyebrow would sit at ~2:1 contrast. bg-brand
         is the SidebarNav convention — navy in light and dark, plum-tinted
         under the plum preset, and text-gold is tuned against it. */
      className="bg-brand relative block w-full overflow-hidden rounded-2xl p-5 text-left text-white shadow-sm md:hidden"
      aria-label={`${eyebrow}: ${hero.title}, ${shownDate}`}
    >
      {/* the reference design's soft decorative circles */}
      <span aria-hidden className="pointer-events-none absolute -top-14 -right-8 h-44 w-44 rounded-full bg-white/[0.06]" />
      <span aria-hidden className="pointer-events-none absolute top-3 right-14 h-14 w-14 rounded-full bg-white/[0.05]" />
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-gold text-[10px] font-semibold tracking-[0.35em] uppercase">{eyebrow}</span>
        <span className="text-[11px] font-medium text-white/70">{when}</span>
      </span>
      <span className="mt-1.5 block truncate text-2xl font-bold tracking-tight">{hero.title}</span>
      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/85">
        <span>🗓 {shownDate}</span>
        {hero.location && <span className="truncate">📍 {hero.location.toUpperCase()}</span>}
      </span>
    </button>
  );
}
