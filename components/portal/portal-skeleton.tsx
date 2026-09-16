import { AppShell } from "@/components/layout/app-shell";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { card } from "@/lib/ui-styles";

/** Static first paint uses the same shell as the authenticated portal. */
export function PortalSkeleton() {
  return (
    <AppShell navigation={
      <aside className="border-border bg-background hidden h-full w-16 shrink-0 flex-col gap-3 border-r p-3 md:flex xl:w-56" aria-hidden>
        <Skel className="mb-3 h-10 w-full rounded-lg" />
        {Array.from({ length: 9 }, (_, i) => <Skel key={i} className="h-11 w-full rounded-lg" />)}
      </aside>
    }>
      <div className="w-full px-4 py-3 pb-28 md:px-5 md:py-4 md:pb-6" aria-busy="true" aria-label="Portal A2Z CREATIVE MARKETING">
        <div className="border-border bg-background -mx-4 flex items-center justify-between gap-3 border-b px-4 py-3 md:-mx-5 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Skel className="h-9 w-9 shrink-0 rounded-full md:h-11 md:w-11" />
            <Skel className="h-5 w-28" />
          </div>
          <div className="flex gap-1.5"><Skel className="h-11 w-11 rounded-lg" /><Skel className="h-11 w-11 rounded-lg" /></div>
        </div>
        <div className="mt-4 space-y-4">
          <Skel className="h-5 w-44 md:hidden" />
          <div className={card}>
            <Skel className="h-4 w-28" />
            <div className="mt-3 grid grid-cols-2 gap-2 md:flex">
              {Array.from({ length: 4 }, (_, i) => <Skel key={i} className="h-11 rounded-lg md:h-9 md:w-36" />)}
            </div>
          </div>
          <div className={card}><Skel className="h-4 w-36" /><SkelRows rows={4} className="mt-3" /></div>
          <div className={`${card} grid grid-cols-2 gap-4 xl:grid-cols-4`}>
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="space-y-3"><Skel className="h-3 w-20" /><Skel className="h-7 w-14" /><Skel className="h-3 w-24" /></div>)}
          </div>
        </div>
      </div>
      <nav className="border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6px)" }} aria-hidden>
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 py-2"><Skel className="h-9 w-9 rounded-lg" /><Skel className="h-2 w-10" /></div>)}
      </nav>
    </AppShell>
  );
}
