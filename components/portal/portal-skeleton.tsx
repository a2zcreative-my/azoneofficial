/* v1.25.0 — THE FIRST PAINT (CEO: "a dead skeleton waiting for my website
 * like a Threads so that my staff wont see any loading").
 *
 * Why this file matters more than any other skeleton: the site is a STATIC
 * EXPORT, so whatever the portal renders on its very first pass is baked
 * into portal.html. That was `null` — the file painted NOTHING, and staff
 * watched a white screen while 1.1 MB of JavaScript downloaded, then while
 * /auth/me answered. This component replaces that null, so the full app
 * silhouette — navy rail, header, cards, bottom nav — is IN the HTML file
 * and paints the moment it arrives, before a single byte of JS runs.
 *
 * Constraints, deliberately: no hooks, no state, no props that vary. It has
 * to render identically during prerender and hydration or React warns, and
 * it must never itself delay the real app by one frame.
 */

import { Skel, SkelCard, SkelStat, SkelRows, SkelDonut } from "@/components/ui/skeleton";
import { card } from "@/lib/ui-styles";

export function PortalSkeleton() {
  return (
    /* v1.27.0 — A2Z CREATIVE MARKETING owns the portal, so the landmark names
       it. The label is deliberately the SAME TEXT in English and BM instead of
       an L("…","…") pair: this node is baked into portal.html by the static
       export, where getLang() cannot see localStorage, so a translated label
       would differ between the prerender and the first client render and cost
       us the hydration — which is the one thing this file exists to protect.
       "Portal" is the word in both languages, the company name is a proper
       noun, and aria-busy carries the "loading" half for screen readers. */
    <div className="md:bg-shell-backdrop md:h-dvh md:overflow-hidden md:p-5" aria-busy="true" aria-label="Portal A2Z CREATIVE MARKETING">
      <div className="md:rounded-shell md:bg-background md:shadow-shell md:mx-auto md:flex md:h-full md:max-w-[1440px] md:overflow-hidden">
        {/* navy icon rail (desktop) — real chrome, not a placeholder, so it
            never flickers when the app takes over */}
        <div className="bg-brand rounded-l-shell hidden w-14 shrink-0 flex-col items-center gap-1 py-3 md:flex">
          <div className="mb-2 h-8 w-8 shrink-0 rounded-lg bg-white/90" />
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="h-10 w-10 shrink-0 rounded-xl bg-white/10" />
          ))}
        </div>

        <div className="min-w-0 max-md:overflow-x-clip md:h-full md:flex-1 md:overflow-y-auto">
          <div className="w-full px-4 py-3 pb-28 md:mx-0 md:max-w-none md:px-5 md:py-4 md:pb-6">
            {/* header: avatar · title · action icons */}
            <div className="border-border bg-background/95 sticky top-0 z-30 -mx-4 flex items-center justify-between gap-3 border-b px-4 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
              <div className="flex min-w-0 items-center gap-3">
                <Skel className="h-9 w-9 shrink-0 rounded-full md:h-11 md:w-11" />
                <div className="min-w-0 space-y-1.5">
                  <Skel className="hidden h-2.5 w-24 md:block" />
                  <Skel className="h-5 w-36" />
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skel key={i} className="h-9 w-9 rounded-lg" />
                ))}
              </div>
            </div>

            {/* greeting + the Dashboard's own shape (the tab everyone lands on) */}
            <div className="mt-4 space-y-1.5">
              <Skel className="h-3 w-32" />
              <Skel className="h-7 w-52" />
            </div>

            {/* next-event band */}
            <div className="bg-brand/95 mt-4 rounded-2xl p-4">
              <div className="space-y-2">
                <div className="h-2.5 w-24 rounded bg-white/20" />
                <div className="h-6 w-40 rounded bg-white/25" />
                <div className="h-3 w-56 max-w-full rounded bg-white/15" />
              </div>
            </div>

            {/* quick actions */}
            <div className={`${card} mt-4`}>
              <Skel className="h-4 w-28" />
              {/* two across, exactly like the real Clock in / Clock out ·
                  Apply leave / Create quotation pad — a skeleton that does
                  not match the real column count makes the page jump. */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skel key={i} className="h-11 rounded-lg" />
                ))}
              </div>
              <Skel className="mt-3 h-9 w-full rounded-lg" />
            </div>

            {/* ticker row */}
            <div className="mt-4 grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-3">
              <SkelStat />
              <SkelStat className="hidden lg:block" />
              <SkelStat className="hidden lg:block" />
            </div>

            {/* attendance donut + today's assignments */}
            <div className="mt-4 grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-3">
              <SkelDonut />
              <div className={card}>
                <Skel className="h-4 w-36" />
                <SkelRows rows={3} className="mt-2" />
              </div>
              <SkelCard lines={2} className="hidden lg:block" />
            </div>
          </div>
        </div>
      </div>

      {/* bottom navigation (phones) — five real-sized slots */}
      <nav className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 py-2">
            <Skel className="h-9 w-9 rounded-xl" />
            <Skel className="h-2 w-12" />
          </div>
        ))}
      </nav>
    </div>
  );
}
