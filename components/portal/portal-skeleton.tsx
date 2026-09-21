import { AppShell } from "@/components/layout/app-shell";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { card, mobileAppBottomClearance, mobileBottomNav } from "@/lib/ui-styles";
import s from "./portal-skeleton.module.css";

/** Static first paint uses the same shell as the authenticated portal.
    v1.172.2: its geometry is portal-skeleton.module.css (Tailwind retired). */
export function PortalSkeleton() {
  return (
    <AppShell navigation={
      <aside className={s.rail} aria-hidden>
        <Skel className="erp-mb-3" h={40} w="100%" />
        {Array.from({ length: 9 }, (_, i) => <Skel key={i} h={44} w="100%" />)}
      </aside>
    }>
      <div className={`${s.page} ${mobileAppBottomClearance}`} aria-busy="true" aria-label="Portal A2Z CREATIVE MARKETING">
        <div className={s.head}>
          <div className={s.headLeft}>
            <Skel className={`erp-fixed ${s.avatar}`} round="full" />
            <Skel h={20} w={112} />
          </div>
          <div className={s.headRight}><Skel h={44} w={44} /><Skel h={44} w={44} /></div>
        </div>
        <div className={s.body}>
          <Skel className={s.phoneTitle} h={20} w={176} />
          <div className={card}>
            <Skel h={16} w={112} />
            <div className={s.quick}>
              {Array.from({ length: 4 }, (_, i) => <Skel key={i} className={s.quickItem} />)}
            </div>
          </div>
          <div className={card}><Skel h={16} w={144} /><SkelRows rows={4} className="erp-mt-3" /></div>
          <div className={`${card} ${s.kpis}`}>
            {Array.from({ length: 4 }, (_, i) => <div key={i} className={s.kpi}><Skel h={12} w={80} /><Skel h={28} w={56} /><Skel h={12} w={96} /></div>)}
          </div>
        </div>
      </div>
      <nav className={mobileBottomNav} aria-hidden>
        {Array.from({ length: 5 }, (_, i) => <div key={i} className={s.navItem}><Skel h={36} w={36} /><Skel h={8} w={40} /></div>)}
      </nav>
    </AppShell>
  );
}
