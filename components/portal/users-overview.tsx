"use client";

/* v1.189.0 - THE USERS OVERVIEW (the owner's brief, 22-10-2026): how many
   accounts there are and in what state, who signed in lately, and what needs
   a look. Everything here is read from the two answers the page already has
   (/staff/users and /staff/users/activity, fetched once by users-panel.tsx);
   it asks for nothing, writes nothing, and shows no password, token, secret
   or address - the sign-in log carries a name, an email, a method and a time,
   exactly as it did. A "security alert" is a plain fact about an account
   (active without 2FA, still active after leaving) or about the log (2FA
   switched off, a backup code used); none of it is a new rule. */

import { L } from "@/components/portal/page-shared";
import { SummaryStat, SummaryStrip, TabZone } from "@/components/portal/tab-concept";
import { Avatar } from "@/components/ui/avatar";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { firstName, properName } from "@/lib/names";
import { btnSm, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import { eventLabel, eventTone, isSignIn, mytStamp2, type Account, type AuthEvent } from "@/components/portal/users-shared";
import css from "./users-panel.module.css";

export type UsersView = "overview" | "staff" | "customers" | "roles" | "security";

const TONE = { success: chipSmSuccess, info: chipSmInfo, warn: chipSmWarn, neutral: chipSmNeutral } as const;

/** one named person from an event row (the audit join can leave the name empty) */
const who = (e: AuthEvent) => properName(e.name ?? "") || e.email || "-";

export function UsersOverview({ rows, events, loaded, eventsLoaded, open }: {
  rows: Account[]; events: AuthEvent[]; loaded: boolean; eventsLoaded: boolean; open: (v: UsersView) => void;
}) {
  const staff = rows.filter((u) => u.role !== "customer");
  const customers = rows.filter((u) => u.role === "customer");
  const active = rows.filter((u) => u.is_active);
  const inactive = rows.length - active.length;
  const share = (n: number) => (rows.length > 0 ? Math.round((n / rows.length) * 100) : 0);

  /* ---- the alerts: facts about accounts, then about the log ---- */
  const no2fa = staff.filter((u) => u.is_active && !u.totp_enabled);
  const leftActive = staff.filter((u) => u.is_active && u.left_on && !u.rejoined_on);
  const off = events.filter((e) => e.action.includes("2fa_disabled"));
  const backup = events.filter((e) => e.action.includes("2fa_backup_used"));
  const names = (list: { name?: string | null; full_name?: string | null; email?: string | null }[]) =>
    list.map((u) => firstName(("full_name" in u && u.full_name) || u.name || u.email || "")).filter(Boolean).join(", ");
  const alerts: { key: string; tone: "danger" | "warn" | "info"; title: string; detail: string; go: UsersView }[] = [];
  if (leftActive.length > 0) alerts.push({
    key: "left", tone: "danger", go: "staff",
    title: L(`${leftActive.length} account${leftActive.length === 1 ? "" : "s"} still active after leaving`, `${leftActive.length} akaun masih aktif selepas berhenti`),
    detail: names(leftActive),
  });
  if (no2fa.length > 0) alerts.push({
    key: "2fa", tone: "warn", go: "staff",
    title: L(`${no2fa.length} active staff account${no2fa.length === 1 ? "" : "s"} without 2FA`, `${no2fa.length} akaun kakitangan aktif tanpa 2FA`),
    detail: names(no2fa),
  });
  if (off.length > 0) alerts.push({
    key: "off", tone: "warn", go: "security",
    title: L(`2FA switched off ${off.length} time${off.length === 1 ? "" : "s"} recently`, `2FA dimatikan ${off.length} kali baru-baru ini`),
    detail: `${who(off[0]!)} · ${mytStamp2(off[0]!.created_at)}`,
  });
  if (backup.length > 0) alerts.push({
    key: "backup", tone: "info", go: "security",
    title: L(`Backup code used ${backup.length} time${backup.length === 1 ? "" : "s"} recently`, `Kod sandaran digunakan ${backup.length} kali baru-baru ini`),
    detail: `${who(backup[0]!)} · ${mytStamp2(backup[0]!.created_at)}`,
  });

  const signIns = events.filter((e) => isSignIn(e.action)).slice(0, 6);
  const byEmail = new Map(rows.map((u) => [u.email.toLowerCase(), u]));
  const alertChip = { danger: chipSmDanger, warn: chipSmWarn, info: chipSmInfo } as const;
  const alertWord = { danger: L("Act now", "Bertindak"), warn: L("Review", "Semak"), info: L("Note", "Nota") } as const;

  return (
    <>
      <TabZone label={L("Accounts", "Akaun")}>
        <SummaryStrip cols={5} ariaLabel={L("Accounts", "Akaun")} className={css.tiles}>
          <SummaryStat icon="users" tone="brand" label={L("Total accounts", "Jumlah akaun")} value={rows.length} busy={!loaded}
            hint={L(`${staff.length} staff + ${customers.length} customer`, `${staff.length} kakitangan + ${customers.length} pelanggan`)} />
          <SummaryStat icon="success" tone="success" label={L("Active accounts", "Akaun aktif")} value={active.length} busy={!loaded}
            badge={loaded && rows.length > 0 ? { text: `${share(active.length)}%`, tone: "success" } : undefined}
            hint={L(`${share(active.length)}% active`, `${share(active.length)}% aktif`)} />
          <SummaryStat icon="blocked" tone={inactive ? "danger" : "neutral"} label={L("Inactive accounts", "Akaun tidak aktif")} value={inactive} busy={!loaded}
            badge={loaded && rows.length > 0 ? { text: `${share(inactive)}%`, tone: inactive ? "danger" : "neutral" } : undefined}
            hint={L(`${share(inactive)}% inactive`, `${share(inactive)}% tidak aktif`)} />
          <SummaryStat icon="person" tone="neutral" label={L("Staff accounts", "Akaun kakitangan")} value={staff.length} busy={!loaded}
            hint={L("Internal team members", "Ahli pasukan dalaman")}
            detail={{ label: L("View", "Lihat"), onClick: () => open("staff") }} />
          <SummaryStat icon="cart" tone="neutral" label={L("Customer accounts", "Akaun pelanggan")} value={customers.length} busy={!loaded}
            hint={L("Google & self sign-up", "Google & daftar sendiri")}
            detail={{ label: L("View", "Lihat"), onClick: () => open("customers") }} />
        </SummaryStrip>
      </TabZone>

      <div className={css.split}>
        <TabZone label={L("Recent sign-ins", "Log masuk terkini")}>
          <div className={card}>
            <div className={css.head}>
              <div className={css.headLead}>
                <span className={css.well}><AppIcon name="access" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("Recent login activity", "Aktiviti log masuk terkini")}</p>
                  <p className={css.sub}>{L("The latest sign-ins across staff and customer accounts.", "Log masuk terkini merentas akaun kakitangan dan pelanggan.")}</p>
                </div>
              </div>
              <button type="button" className={btnSm} onClick={() => open("security")}>{L("View all logs", "Lihat semua log")}</button>
            </div>
            {!eventsLoaded && <SkelRows rows={5} />}
            {eventsLoaded && signIns.length === 0 && (
              <p className={css.empty}>{L("No sign-ins recorded yet.", "Tiada log masuk direkodkan lagi.")}</p>
            )}
            {eventsLoaded && signIns.length > 0 && (
              <ul className={css.feed}>
                {signIns.map((e, i) => {
                  const acct = e.email ? byEmail.get(e.email.toLowerCase()) : undefined;
                  return (
                    <li key={i} className={css.feedRow}>
                      <div className={css.feedWho}>
                        <Avatar name={who(e)} photoKey={acct?.photo_key} size="md" />
                        <div className={css.who}>
                          <span className={css.name}>{who(e)}</span>
                          <span className={css.email}>{e.email ?? ""}</span>
                        </div>
                      </div>
                      <div className={css.feedMeta}>
                        <span className={TONE[eventTone(e.action)]}>{eventLabel(e.action)}</span>
                        <span>{mytStamp2(e.created_at)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </TabZone>

        <TabZone label={L("Needs a look", "Perlu disemak")}>
          <div className={card}>
            <div className={css.head}>
              <div className={css.headLead}>
                <span className={css.well}><AppIcon name="warning" /></span>
                <div className={css.headText}>
                  <p className={css.title}>{L("Security alerts", "Amaran keselamatan")}</p>
                  <p className={css.sub}>{L("Plain facts about accounts and the sign-in log.", "Fakta mudah tentang akaun dan log log masuk.")}</p>
                </div>
              </div>
            </div>
            {!loaded || !eventsLoaded ? <SkelRows rows={3} /> : alerts.length === 0 ? (
              <p className={css.empty}>
                <AppIcon name="success" className={css.noteIcon} />
                {L("No alerts — every active staff account has 2FA and nobody left with a live account.", "Tiada amaran — setiap akaun kakitangan aktif ada 2FA dan tiada yang berhenti masih mempunyai akaun aktif.")}
              </p>
            ) : (
              <ul className={css.alerts}>
                {alerts.map((a) => (
                  <li key={a.key} className={css.alert}>
                    <div>
                      <p className={css.alertTitle}><span className={alertChip[a.tone]}>{alertWord[a.tone]}</span> {a.title}</p>
                      {a.detail && <p className={css.alertWho}>{a.detail}</p>}
                    </div>
                    <button type="button" className={btnSm} onClick={() => open(a.go)}>{L("Open", "Buka")}</button>
                  </li>
                ))}
              </ul>
            )}
            <div className={css.doors}>
              <button type="button" className={css.door} onClick={() => open("roles")}>
                <span className={css.doorIcon}><AppIcon name="lock" /></span>
                <span className={css.doorText}>
                  <span className={css.doorTitle}>{L("Roles & permissions", "Peranan & kebenaran")}</span>
                  <span className={css.doorSub}>{L("Which role opens which module", "Peranan mana membuka modul mana")}</span>
                </span>
                <AppIcon name="next" />
              </button>
              <button type="button" className={css.door} onClick={() => open("security")}>
                <span className={css.doorIcon}><AppIcon name="place" /></span>
                <span className={css.doorText}>
                  <span className={css.doorTitle}>{L("Office check-in", "Daftar masuk pejabat")}</span>
                  <span className={css.doorSub}>{L("The geofence clock-in must happen inside", "Geopagar tempat daftar masuk mesti dibuat")}</span>
                </span>
                <AppIcon name="next" />
              </button>
            </div>
          </div>
        </TabZone>
      </div>
    </>
  );
}

