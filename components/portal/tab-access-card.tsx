"use client";

import { csrfFetch } from "@/lib/api";

/* v1.4.219 (CEO: "I want to have a users access control for CEO to
   assigned to the roles … which users need to access the tabs"): the
   manager card. Per tab, click role chips on/off and Save; "Reset to
   default" removes the override. Safety rails mirrored from the worker:
   Dashboard + Profile are not listed (always visible to everyone), and
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
   the portal's rules. A tab added anywhere appears here on the same deploy.

   THE ROW IS QUIETER. It used to print every allowed role inline, so the
   longest rows ran to a dozen comma-separated names and the tab's own name
   was lost in the middle of them. A row is now: name, one-line hint, and the
   audience as a COUNT ("7 of 9 roles", full list on hover) — scannable
   top-to-bottom, with the detail one click away where it is being edited. */

import { useCallback, useEffect, useState } from "react";
import { useSaveToast } from "@/components/ui/save-toast";
import { card } from "@/lib/ui-styles";
import { Skel } from "@/components/ui/skeleton";
import { rowBtn } from "@/components/ui/row-button";
import { getLang, t } from "@/lib/i18n";
import {
  ASSIGNABLE_ROLES,
  GOVERNABLE_TABS,
  TAB_HINTS,
  defaultRolesFor,
} from "@/lib/portal-tabs";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const roleLabel = (r: string) => r.replace("_", " ");

export function TabAccessCard() {
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

  return (
    <div className={card}>
      <p className="text-sm font-semibold">{L("🔐 Tab access control", "🔐 Kawalan akses tab")}</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L("Choose which roles see each tab, listed in the order they appear in the portal. Everyone always keeps Dashboard and Profile (clock-in and payslips), and super_admin always sees every tab — the safety net if an assignment goes wrong. Changes apply on each person's next page refresh.",
          "Pilih peranan yang boleh melihat setiap tab, disenaraikan mengikut susunan dalam portal. Semua orang sentiasa mengekalkan Papan Pemuka dan Profil (daftar masuk dan slip gaji), dan super_admin sentiasa melihat semua tab — jaring keselamatan jika penetapan tersilap. Perubahan berkuat kuasa pada muat semula halaman seterusnya setiap orang.")}
      </p>
      {/* divide-y instead of a border per row: 24 boxes stacked read as 24
          things to deal with, one ruled list reads as one list. */}
      <div className="border-border divide-border mt-3 divide-y rounded-lg border">
        {!loaded ? GOVERNABLE_TABS.map((name) => (
          <div key={name} className="flex items-center justify-between gap-2 px-2.5 py-2" aria-hidden>
            <Skel className="h-3 w-2/3 max-w-xs" />
            <Skel className="h-6 w-12 shrink-0 rounded-lg" />
          </div>
        )) : GOVERNABLE_TABS.map((name) => {
          const eff = effective(name);
          const overridden = Object.prototype.hasOwnProperty.call(overrides, name);
          const isOpen = openTab === name;
          const hint = TAB_HINTS[name];
          const shownHint = hint ? (lang === "ms" ? hint.ms : hint.en) : "";
          /* The audience as one short phrase. The full membership is the
             `title` — a row is for scanning, the chips below are for
             reading. */
          const audience = eff === null
            ? L("all staff", "semua kakitangan")
            : eff.length === 0
              ? L("nobody", "tiada sesiapa")
              : L(`${eff.length} of ${ASSIGNABLE_ROLES.length} roles`, `${eff.length} daripada ${ASSIGNABLE_ROLES.length} peranan`);
          const audienceTitle = eff === null
            ? L("Every staff role sees this tab.", "Semua peranan kakitangan melihat tab ini.")
            : eff.length === 0
              ? L("Hidden from everyone except super_admin.", "Tersembunyi daripada semua kecuali super_admin.")
              : eff.map(roleLabel).join(", ");
          return (
            <div key={name} className="px-2.5 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 text-xs">
                  <span className="font-semibold">{t(name, lang)}</span>
                  {shownHint && <span className="text-muted-foreground"> · {shownHint}</span>}
                </p>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-muted-foreground text-[11px] whitespace-nowrap" title={audienceTitle}>
                    {audience}
                  </span>
                  {overridden && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                      title={L("Changed from the built-in default", "Diubah daripada tetapan lalai terbina")}>
                      {L("custom", "tersuai")}
                    </span>
                  )}
                  <button type="button" className={rowBtn}
                    onClick={() => { setOpenTab(isOpen ? null : name); setDraft(eff === null ? ASSIGNABLE_ROLES.map(([r]) => r) : [...eff]); }}>
                    {isOpen ? L("Close", "Tutup") : L("Edit", "Sunting")}
                  </button>
                </span>
              </div>
              {isOpen && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-green-700 px-2 py-0.5 text-[11px] font-semibold text-green-700" title={L("Always on — the safety net", "Sentiasa aktif — jaring keselamatan")}>✓ super admin 🔒</span>
                    {ASSIGNABLE_ROLES.map(([r, labelR]) => {
                      const on = draft.includes(r);
                      return (
                        <button key={r} type="button"
                          className={on
                            ? "bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[11px] font-medium"
                            : "border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]"}
                          onClick={() => setDraft((d) => (on ? d.filter((x) => x !== r) : [...d, r]))}>
                          {on ? "✓ " : ""}{labelR}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button type="button" className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium" onClick={() => void save(name, draft)}>{L("Save", "Simpan")}</button>
                    <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setDraft(ASSIGNABLE_ROLES.map(([r]) => r))}>{L("Select all", "Pilih semua")}</button>
                    <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setDraft([])}>{L("Clear", "Kosongkan")}</button>
                    {overridden && (
                      <button type="button" className="text-muted-foreground text-xs underline" onClick={() => void save(name, null)}>{L("Reset to default", "Set semula kepada lalai")}</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}
      {toastNode}
    </div>
  );
}
