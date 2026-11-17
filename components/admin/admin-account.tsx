"use client";

/* v1.351.0 - MY ACCOUNT (Phase 3 of the /admin plan the CEO approved,
   17-11-2026): the Super Admin's own sign-in security on the portal's pages.
   One KPI strip from the reads the panels below already make, then the same
   five panels - each still decides and saves exactly as before:
     Two-Factor     GET /auth/2fa/status   (enabled, backup codes left)
     Google         GET /auth/2fa/status   (google.linked)
     Passkeys       GET /auth/passkeys     (how many; "Not enabled" before the rollout)
     Recovery Panel GET /staff/recovery    (Ready only when the server says two can act)
   A read that fails says "Not available"; nothing is assumed. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SkelRows } from "@/components/ui/skeleton";
import { SplitPane } from "@/components/ui/workspace-split";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { TwoFactorPanel } from "@/components/security/two-factor-panel";
import { GoogleConnectPanel } from "@/components/security/google-connect-panel";
import { PasskeysPanel } from "@/components/security/passkeys-panel";
import { RecoveryPanel } from "@/components/security/recovery-panel";
import css from "./admin-console.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type Read<T> = T | "failed" | null;
interface TwoFa { enabled: boolean; backup_codes_left?: number; google?: { linked: boolean } }
interface Keys { stage: "off" | "A" | "B" | "C"; passkeys: unknown[] }
interface Panel { available: boolean; panel: unknown[] }

export function AdminAccount({ onReload }: { onReload: () => void }) {
  const [tick, setTick] = useState(0);
  const [twofa, setTwofa] = useState<Read<TwoFa>>(null);
  const [keys, setKeys] = useState<Read<Keys>>(null);
  const [panel, setPanel] = useState<Read<Panel>>(null);
  useEffect(() => {
    void api<TwoFa>("/auth/2fa/status").then((r) => setTwofa(r.ok && r.data ? r.data : "failed"));
    void api<Keys>("/auth/passkeys").then((r) => setKeys(r.ok && r.data ? r.data : "failed"));
    void api<Panel>("/staff/recovery").then((r) => setPanel(r.ok && r.data ? r.data : "failed"));
  }, [tick]);
  const na = L("Not available", "Tiada data");
  const t = twofa && twofa !== "failed" ? twofa : null;
  const k = keys && keys !== "failed" ? keys : null;
  const p = panel && panel !== "failed" ? panel : null;
  return (
    <TabPage className={css.page}>
      <TabZone label={L("My sign-in", "Log masuk saya")}>
        {twofa === null && keys === null && panel === null ? <SkelRows rows={2} /> : (
        <KpiRow label={L("My sign-in security", "Keselamatan log masuk saya")} testid="account-strip">
          <KpiTile icon="verify" tone={t ? (t.enabled ? "green" : "red") : "gold"} label={L("Two-Factor", "Dua Faktor")} busy={twofa === null} testid="tile-2fa"
            value={twofa === "failed" ? na : t?.enabled ? L("On", "Hidup") : L("Off", "Mati")}
            sub={t?.enabled && typeof t.backup_codes_left === "number" ? L(`${t.backup_codes_left} backup code(s) left`, `${t.backup_codes_left} kod sandaran berbaki`) : t && !t.enabled ? L("Required for a Super Admin", "Diwajibkan untuk Super Admin") : undefined} />
          <KpiTile icon="link" tone={t?.google?.linked ? "green" : "blue"} label={L("Google Sign-in", "Log Masuk Google")} busy={twofa === null} testid="tile-google"
            value={twofa === "failed" ? na : t?.google?.linked ? L("Connected", "Disambung") : L("Not connected", "Tidak disambung")} />
          <KpiTile icon="access" tone="navy" label={L("Passkeys", "Kunci Laluan")} busy={keys === null} testid="tile-passkeys"
            value={keys === "failed" ? na : k ? (k.stage === "off" ? L("Not enabled", "Belum dihidupkan") : k.passkeys.length) : "—"}
            sub={k && k.stage === "off" ? L("Turned on in stages", "Dihidupkan berperingkat") : undefined} />
          <KpiTile icon="users" tone={p ? (p.available ? "green" : "gold") : "gold"} label={L("Recovery Panel", "Panel Pemulihan")} busy={panel === null} testid="tile-recovery"
            value={panel === "failed" ? na : p ? (p.available ? L("Ready", "Sedia") : L("Not ready", "Belum sedia")) : "—"}
            sub={p ? L(`${p.panel.length} member(s) named`, `${p.panel.length} ahli dinamakan`) : undefined} />
        </KpiRow>
        )}
      </TabZone>
      <TabZone label={L("Password and two-factor", "Kata laluan dan dua faktor")} cols={2}>
        <SplitPane testid="change-password" title={L("Change password", "Tukar kata laluan")}
          sub={L("Changing it signs you out everywhere else - any other device or stolen session loses access at once.", "Menukarnya melog keluar anda di tempat lain - peranti lain atau sesi yang dicuri hilang akses serta-merta.")}>
          <ChangePasswordForm />
        </SplitPane>
        <TwoFactorPanel onEnabled={() => { setTick((n) => n + 1); onReload(); }} />
      </TabZone>
      <TabZone label={L("Connected sign-ins", "Log masuk bersambung")} cols={2}>
        <GoogleConnectPanel />
        <PasskeysPanel />
      </TabZone>
      <TabZone label={L("Executive recovery", "Pemulihan eksekutif")}>
        <RecoveryPanel />
      </TabZone>
    </TabPage>
  );
}
