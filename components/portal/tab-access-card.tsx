"use client";

import { csrfFetch } from "@/lib/api";

/* v1.4.219 (CEO: "I want to have a users access control for CEO to
   assigned to the roles … which users need to access the tabs"): the
   manager card. Per tab, click role chips on/off and Save; "Reset to
   default" removes the override. Safety rails mirrored from the worker:
   Dashboard + On Shift + Profile are not listed (always visible to everyone), and
   super_admin ignores overrides — shown as a locked ✓ so the CEO knows
   the escape hatch exists. */

/* v1.79.0 (CEO: "🔐 Tab access control should update all the tabs available
   to make it up-to-date" + "I want minimalist style to make it easy in
   order"). TWO changes, one cause.

   THE LIST IS NO LONGER TYPED HERE. It had been a hand-copy of ALL_TABS
   carrying a comment that said to keep the two in sync — which is exactly
   what the same request at v1.21.4 was answered with, and it drifted again:
   different order from the portal, and a Users default of CEO + COO when the
   portal has allowed `admin` since v1.40.0. The card now renders
   GOVERNABLE_TABS from lib/portal-tabs.ts and asks canSeeTab() what a
   setting means, so it shows the portal's tabs, in the portal's order, with
   the portal's rules. A tab added anywhere appears here on the same deploy. */

/* v1.189.0 — THE PERMISSION MATRIX (the owner, 22-10-2026: "replace the long
   access-control list with a clean permission matrix ... group permissions
   by existing system modules ... display roles and access levels clearly").

   The list was one row per tab with the audience as a count ("7 of 9
   roles"); to know whether the COO opens Payroll you had to open the row.
   It is now a grid: a row per module, grouped as the sidebar groups them
   (SECTIONS in components/layout/side-nav.tsx), a column per role, and a
   mark in each cell - opens / hidden - from the SAME canSeeTab() the portal
   draws its tab strip with, so the matrix cannot describe a rule the portal
   does not follow. A cell that is not the built-in default is ringed, so the
   CEO's custom rules are seen across the whole grid at once.

   EDITING IS THE SAME EDIT. A row's Edit opens the role chips under it, Save
   posts { tab, roles } and Reset posts { tab, reset: true } to the same
   /staff/tabs/access route, with the same toast; nothing is saved by
   clicking a cell, so a stray click on the grid changes nothing. The grid is
   drawn read-only for everyone who may open the Users tab - the overrides
   it reads are the ones every signed-in person already fetches to build
   their own tab strip - and Edit exists only for the CEO and the super
   admin; the worker refuses anyone else. */

import { Fragment, useCallback, useEffect, useState } from "react";
import { SECTIONS, sectionTitle } from "@/components/layout/side-nav";
import { roleLabel } from "@/components/portal/users-shared";
import { useSaveToast } from "@/components/ui/save-toast";
import { btnSmPrimary, card, tabPill, tabPillOn } from "@/lib/ui-styles";
import { Skel } from "@/components/ui/skeleton";
import { rowBtn } from "@/components/ui/row-button";
import { getLang, t } from "@/lib/i18n";
import { AppIcon } from "@/components/ui/app-icon";
import {
  ASSIGNABLE_ROLES,
  GOVERNABLE_TABS,
  TAB_HINTS,
  canSeeTab,
  defaultRolesFor,
} from "@/lib/portal-tabs";
import css from "./users-panel.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

export function TabAccessCard({ canEdit = false, headcount = {} }: { canEdit?: boolean; headcount?: Record<string, number> }) {
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [openTab, setOpenTab] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  /* v1.4.221 (CEO: "there is no save popup notification"): the standard
     v1.4.87 save toast — same popup as every other Save in the portal. */
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.77.0 — skeleton until the first fetch lands. Overrides start `{}`, so
     every tab read "default" until the server answered — an empty state
     shown while loading. */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    void fetch("/api/v1/staff/tabs/access", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setOverrides((d as { overrides: Record<string, string[]> }).overrides ?? {}))
      .catch(() => setMsg(L("Tab access needs the latest server — deploy the worker first.", "Akses tab memerlukan pelayan terkini — deploy worker dahulu.")))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  /* What a tab is set to right now: the CEO's override if he has saved one,
     otherwise the built-in default. `null` = every staff role. */
  const effective = (tab: string): readonly string[] | null =>
    Object.prototype.hasOwnProperty.call(overrides, tab) ? overrides[tab]! : defaultRolesFor(tab);

  const save = async (tab: string, roles: string[] | null) => {
    const res = await csrfFetch("/api/v1/staff/tabs/access", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roles === null ? { tab, reset: true } : { tab, roles }),
    });
    if (res.ok) {
      const d = (await res.json()) as { overrides: Record<string, string[]> };
      setOverrides(d.overrides ?? {});
      setOpenTab(null);
      showToast(
        roles === null ? L("Back to default", "Kembali kepada lalai") : L("Access saved", "Akses disimpan"),
        roles === null ? L(`${tab} uses the built-in default again`, `${tab} menggunakan tetapan lalai terbina semula`) : L(`${tab} — takes effect on each person's next refresh`, `${tab} — berkuat kuasa pada muat semula seterusnya setiap orang`),
      );
    } else showToast(L("Save failed", "Simpan gagal"), L("Please try again", "Sila cuba lagi"), "notice");
  };

  const lang = getLang();
  /* the modules, grouped as the sidebar groups them; a governable tab no
     section names falls into Other rather than vanishing */
  const groups = [
    ...SECTIONS.map((s) => ({ title: s.title, tabs: GOVERNABLE_TABS.filter((tab) => s.tabs.includes(tab)) })),
    { title: "Other", tabs: GOVERNABLE_TABS.filter((tab) => !SECTIONS.some((s) => s.tabs.includes(tab))) },
  ].filter((g) => g.tabs.length > 0);
  const cols = ASSIGNABLE_ROLES.length + 2 + (canEdit ? 1 : 0); // module + roles + super admin (+ edit)
  const opens = (role: string) => GOVERNABLE_TABS.filter((tab) => canSeeTab(role, tab, overrides)).length;

  return (
    <div className={card}>
      <div className={css.head}>
        <div className={css.headLead}>
          <span className={css.well}><AppIcon name="access" /></span>
          <div className={css.headText}>
            <p className={css.title}>{L("Roles & permissions", "Peranan & kebenaran")}</p>
            <p className={css.sub}>
              {L("Which role opens which module, in portal order. Everyone keeps Dashboard, Desk, On Shift and Profile; super_admin keeps every tab as the recovery path. Changes apply on each person's next refresh.",
                "Peranan mana membuka modul mana, mengikut susunan portal. Semua orang mengekalkan Papan Pemuka, Meja, Syif Saya dan Profil; super_admin mengekalkan semua tab sebagai laluan pemulihan. Perubahan berkuat kuasa pada muat semula seterusnya.")}
            </p>
          </div>
        </div>
      </div>
      <div className={css.legend}>
        <span><span className={css.yes}>✓</span>{L("opens the module", "membuka modul")}</span>
        <span><span className={css.no}>–</span>{L("hidden", "tersembunyi")}</span>
        <span><span className={`${css.yes} ${css.custom}`}>✓</span>{L("custom — not the built-in default", "tersuai — bukan lalai terbina")}</span>
        <span><span className={css.locked}><AppIcon name="lock" /></span>{L("super admin — always on", "super admin — sentiasa aktif")}</span>
        {!canEdit && <span>{L("Read-only — the CEO and the super admin change it.", "Baca sahaja — CEO dan super admin yang mengubahnya.")}</span>}
      </div>
      <div className={css.matrixWrap}>
        <table className={css.matrix}>
          <thead>
            <tr>
              <th className={css.moduleCol} scope="col">{L("Module", "Modul")}</th>
              {ASSIGNABLE_ROLES.map(([r]) => (
                <th key={r} scope="col">
                  {roleLabel(r)}
                  {headcount[r] != null && <span className={css.moduleHint}>{L(`${headcount[r]} active`, `${headcount[r]} aktif`)}</span>}
                </th>
              ))}
              <th scope="col">{roleLabel("super_admin")}</th>
              {canEdit && <th scope="col"><span className="erp-sr-only">{L("Edit", "Sunting")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {!loaded ? GOVERNABLE_TABS.slice(0, 8).map((name) => (
              <tr key={name} aria-hidden>
                <td className={css.moduleCol}><Skel className="h-3 w-2/3" /></td>
                <td colSpan={cols - 1}><Skel className="h-3 w-full" /></td>
              </tr>
            )) : groups.map((g) => (
              <Fragment key={g.title}>
                <tr className={css.groupRow}><th colSpan={cols} scope="colgroup">{sectionTitle(g.title, lang)}</th></tr>
                {g.tabs.map((name) => {
                  const eff = effective(name);
                  const overridden = Object.prototype.hasOwnProperty.call(overrides, name);
                  const isOpen = openTab === name;
                  const hint = TAB_HINTS[name];
                  const shownHint = hint ? (lang === "ms" ? hint.ms : hint.en) : "";
                  return (
                    <Fragment key={name}>
                      <tr>
                        <th className={css.moduleCol} scope="row">
                          <span className={css.moduleName}>{t(name, lang)}</span>
                          {shownHint && <span className={css.moduleHint}>{shownHint}</span>}
                        </th>
                        {ASSIGNABLE_ROLES.map(([r, labelR]) => {
                          const sees = canSeeTab(r, name, overrides);
                          const dflt = defaultRolesFor(name);
                          const isDefault = dflt === null || dflt.includes(r);
                          const custom = overridden && sees !== isDefault;
                          return (
                            <td key={r}>
                              <span className={`${sees ? css.yes : css.no} ${custom ? css.custom : ""}`}
                                title={`${labelR}: ${sees ? L("opens", "membuka") : L("hidden", "tersembunyi")}${custom ? ` (${L("custom", "tersuai")})` : ""}`}>
                                <span aria-hidden>{sees ? "✓" : "–"}</span>
                                <span className="erp-sr-only">{sees ? L("opens", "membuka") : L("hidden", "tersembunyi")}</span>
                              </span>
                            </td>
                          );
                        })}
                        <td><span className={css.locked} title={L("Always on — the safety net", "Sentiasa aktif — jaring keselamatan")}><AppIcon name="lock" /></span></td>
                        {canEdit && (
                          <td>
                            <button type="button" className={rowBtn} aria-expanded={isOpen}
                              onClick={() => { setOpenTab(isOpen ? null : name); setDraft(eff === null ? ASSIGNABLE_ROLES.map(([r]) => r) : [...eff]); }}>
                              {isOpen ? L("Close", "Tutup") : L("Edit", "Sunting")}
                            </button>
                          </td>
                        )}
                      </tr>
                      {canEdit && isOpen && (
                        <tr className={css.editRow}>
                          <td colSpan={cols}>
                            <div className={css.editChips}>
                              {ASSIGNABLE_ROLES.map(([r, labelR]) => {
                                const on = draft.includes(r);
                                return (
                                  <button key={r} type="button" aria-pressed={on} className={on ? tabPillOn : tabPill}
                                    onClick={() => setDraft((d) => (on ? d.filter((x) => x !== r) : [...d, r]))}>
                                    {on ? "✓ " : ""}{labelR}
                                  </button>
                                );
                              })}
                            </div>
                            <div className={css.editActions}>
                              <button type="button" className={btnSmPrimary} onClick={() => void save(name, draft)}>{L("Save", "Simpan")}</button>
                              <button type="button" className={css.linkBtn} onClick={() => setDraft(ASSIGNABLE_ROLES.map(([r]) => r))}>{L("Select all", "Pilih semua")}</button>
                              <button type="button" className={css.linkBtn} onClick={() => setDraft([])}>{L("Clear", "Kosongkan")}</button>
                              {overridden && (
                                <button type="button" className={css.linkBtn} onClick={() => void save(name, null)}>{L("Reset to default", "Set semula kepada lalai")}</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
            {loaded && (
              <tr className={css.totalRow}>
                <th className={css.moduleCol} scope="row">{L("Modules opened", "Modul dibuka")}</th>
                {ASSIGNABLE_ROLES.map(([r]) => <td key={r}>{opens(r)}/{GOVERNABLE_TABS.length}</td>)}
                <td>{GOVERNABLE_TABS.length}/{GOVERNABLE_TABS.length}</td>
                {canEdit && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {msg && <p className={css.note}>{msg}</p>}
      {toastNode}
    </div>
  );
}
