"use client";

/* v1.293.0 - SYSTEM -> AUTOMATION & RULES (the Desk consolidation, the CEO,
   12-11-2026, K3 / D4). The watcher RULES, moved whole out of the Desk's old
   Watcher Settings tab: which rules run, who each tells, the line each
   watches, and "Run now". The same card, the same reads and writes
   (/staff/watchers), the same server rule - the CEO and the super admin
   change a rule, the COO, CCO and admin read them. What the rules FIND is
   worked in the Desk's Action Inbox (Alerts); rules and findings stay apart. */

import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { WatchersCard } from "@/components/portal/watchers-card";
import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";
import css from "./automation-rules.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export function AutomationRulesPage({ role, go }: { role: string; go: (tab: string) => void }) {
  const canEdit = role === "ceo" || role === "super_admin";
  return (
    <TabPage>
      <p className={css.lead}>
        {L("The rules the company watches its own data with. A rule finds records; what it finds appears in each person's Desk → Action Inbox → Alerts. ",
          "Peraturan yang syarikat gunakan untuk memerhati datanya sendiri. Peraturan menemui rekod; dapatannya muncul dalam Meja → Peti Tindakan → Amaran setiap orang. ")}
        {canEdit ? L("Only you and the super admin can change a rule.", "Hanya anda dan pentadbir super boleh mengubah peraturan.")
          : L("Only the CEO changes a rule; you can read them.", "Hanya CEO mengubah peraturan; anda boleh membacanya.")}
      </p>
      <TabZone label={L("Watcher rules", "Peraturan pemerhati")}>
        <section className={`${card} ${css.card}`} data-testid="automation-rules">
          <WatchersCard role={role} go={go} section="rules" bare />
        </section>
      </TabZone>
    </TabPage>
  );
}
