"use client";

/**
 * HR / payroll administration (v1.4.16), for the admin Staff area (and,
 * since v1.192.0, the HR page's Calendar & Holidays and Payroll & Payslips
 * tabs - the same two cards):
 *   - Public holidays / company calendar (feeds leave day-counting)
 *
 * v1.306.0 - HR Workspace 4.0 (H-2): the payslip summary card is gone; Payroll
 * owns the payroll figures and payslips. HolidaysCard is HR > Calendar &
 * Holidays' holiday list; HrAdminPanel is two links on the admin console.
 */

import { makeApi } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
const api = makeApi("/staff");
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { btnSm, btnSmPrimary, card, chipSmInfo, chipSmNeutral, chipSmWarn, fieldLabel, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { dmy, mytToday } from "@/lib/format";
import { AppIcon } from "@/components/ui/app-icon";
import { rowBtnDanger } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { getLang } from "@/lib/i18n";
import { Skel } from "@/components/ui/skeleton"; // v1.77.0
import css from "./hr-admin-panel.module.css";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);



const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Display-only BM labels for API values — the values themselves never change.
const HOLIDAY_KIND_MS: Record<string, string> = {
  public: "umum", company: "syarikat", replacement: "gantian",
};

interface Holiday { id: number; holiday_date: string; name: string; kind: string }


/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

export function HrAdminPanel() {
  /* v1.306.0 - HR Workspace 4.0 (the CEO, 14-11-2026, H-2 and H-6): the admin
     console no longer draws a second copy of the holidays card or the payslip
     summary. One home each: the holidays in HR > Calendar & Holidays, the
     payroll figures and payslips in Payroll (which already has the attendance
     and leave days). The route GET /staff/payslip is unchanged. */
  return (
    <section className={card} aria-label={L("Holidays and payroll", "Cuti umum dan gaji")} data-testid="admin-hr-links">
      <p className={css.sub}>{L("Public holidays are managed in HR > Calendar & Holidays. Payroll runs, attendance days and payslips are in Payroll.", "Cuti umum diurus dalam HR > Kalendar & Cuti Umum. Larian gaji, hari kehadiran dan slip gaji ada dalam Gaji.")}</p>
      <div className={css.stack}>
        <Link className={btnSm} href="/portal?tab=HR&view=calendar"><AppIcon name="holiday" />{L("Open HR > Calendar & Holidays", "Buka HR > Kalendar & Cuti Umum")}</Link>
        <Link className={btnSm} href="/portal?tab=Payroll"><AppIcon name="money" />{L("Open Payroll", "Buka Gaji")}</Link>
      </div>
    </section>
  );
}

const KIND_CHIP: Record<string, string> = { public: chipSmInfo, company: chipSmNeutral, replacement: chipSmWarn };

/** Public holidays & company calendar: add and remove, the existing rules
    (a weekend public holiday auto-creates its Monday replacement, server-side). */
export function HolidaysCard() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loaded, setLoaded] = useState(false); // v1.77.0 — first fetch settled (ok or not)
  const [holDraft, setHolDraft] = useState({ holiday_date: "", name: "", kind: "public" });
  /* v1.145.0 - the holidays list is fetched for the current year. */
  const [entYear] = useState(new Date().getFullYear());
  const today = mytToday();

  /* a write bumps the tick; the read is set from its promise, never
     synchronously from the effect */
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    void api<{ holidays: Holiday[] }>(`/holidays?year=${entYear}`).then((h) => {
      if (!live) return;
      if (h.data) setHolidays(h.data.holidays ?? []);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [entYear, tick]);

  const upcoming = holidays.filter((h) => h.holiday_date >= today).length;
  return (
    <section className={card} aria-label={L("Public holidays & company calendar", "Cuti umum & kalendar syarikat")}>
      {toastNode}
      <div className={css.head}>
        <span className={`${css.well} ${css.red}`}><AppIcon name="holiday" /></span>
        <div className={css.headText}>
          <p className={css.title}>{L("Public holidays & company calendar", "Cuti umum & kalendar syarikat")} <span className={css.muted}>· {entYear}</span></p>
          <p className={css.sub}>
            {L(
              "Used so leave day-counting, attendance and payroll don't treat a holiday as a working day — and shown in red on everyone's events calendar. Adding a public holiday on a Saturday/Sunday auto-creates its Monday replacement (next free working day if Monday is taken); pick kind \"replacement\" to add one manually, or Remove an auto row you don't want.",
              "Digunakan supaya kiraan hari cuti, kehadiran dan gaji tidak menganggap hari cuti sebagai hari bekerja — dan dipaparkan merah pada kalendar acara semua orang. Menambah cuti umum pada Sabtu/Ahad akan mencipta gantian Isnin secara automatik (hari bekerja kosong berikutnya jika Isnin sudah diambil); pilih jenis \"gantian\" untuk menambah secara manual, atau Buang baris auto yang anda tidak mahu.",
            )}
          </p>
        </div>
        {loaded && <span className={chipSmNeutral}>{L(`${upcoming} upcoming`, `${upcoming} akan datang`)}</span>}
      </div>
      <div className={css.form}>
        <label className={css.field}><span className={fieldLabel}>{L("Date", "Tarikh")}</span>
          <input type="date" className={inputClassSm} value={holDraft.holiday_date}
            onChange={(e) => setHolDraft((d) => ({ ...d, holiday_date: e.target.value }))} />
        </label>
        <label className={`${css.field} ${css.grow}`}><span className={fieldLabel}>{L("Holiday name", "Nama cuti")}</span>
          <input className={inputClassSm} placeholder={L("Holiday name", "Nama cuti")} value={holDraft.name}
            onChange={(e) => setHolDraft((d) => ({ ...d, name: e.target.value }))} />
        </label>
        <label className={css.field}><span className={fieldLabel}>{L("Kind", "Jenis")}</span>
          <select className={selectClassSm} value={holDraft.kind}
            onChange={(e) => setHolDraft((d) => ({ ...d, kind: e.target.value }))}>
            {["public", "company", "replacement"].map((k) => <option key={k} value={k}>{L(k, HOLIDAY_KIND_MS[k] ?? k)}</option>)}
          </select>
        </label>
        <button type="button" className={btnSmPrimary}
          onClick={async () => {
            if (!holDraft.holiday_date || !holDraft.name.trim()) {
              showToast(L("No changes", "Tiada perubahan"), L("A holiday needs both a date and a name", "Cuti memerlukan tarikh dan nama"), "notice");
              return;
            }
            const r = await api(`/holidays`, { method: "POST", body: JSON.stringify(holDraft) });
            if (!r.ok) { showToast(L("No changes", "Tiada perubahan"), L("Could not add that holiday — try again", "Tidak dapat menambah cuti itu — cuba lagi"), "notice"); return; }
            showToast(L("Saved", "Disimpan"), `${holDraft.name} ${L("added — payroll working days recount from this", "ditambah — hari bekerja gaji dikira semula dari ini")}`);
            setHolDraft({ holiday_date: "", name: "", kind: "public" });
            void load();
          }}><AppIcon name="add" />{L("Add", "Tambah")}</button>
      </div>
      <ul className={css.holidays} aria-label={L("Holidays this year", "Cuti tahun ini")}>
        {/* v1.77.0 — skeleton until the first fetch lands */}
        {!loaded && Array.from({ length: 6 }, (_, i) => (
          <li key={`skel-${i}`} className={css.holiday} aria-busy="true">
            <Skel className={css.skelLine} />
          </li>
        ))}
        {holidays.map((h) => (
          <li key={h.id} className={`${css.holiday} ${h.holiday_date < today ? css.past : ""}`}>
            <span className={css.badge} aria-hidden>
              <span className={css.badgeDay}>{h.holiday_date.slice(8, 10)}</span>
              <span className={css.badgeMon}>{MON[Number(h.holiday_date.slice(5, 7)) - 1] ?? ""}</span>
            </span>
            <span className={css.hName}>
              <span className={css.hTitle}>{h.name}</span>
              <span className={css.muted}>{dmy(h.holiday_date)}</span>
            </span>
            <span className={KIND_CHIP[h.kind] ?? chipSmNeutral}>{L(h.kind, HOLIDAY_KIND_MS[h.kind] ?? h.kind)}</span>
            <button type="button" className={rowBtnDanger}
              onClick={async () => {
                const r = await api(`/holidays/${h.id}`, { method: "DELETE" });
                showToast(r.ok ? L("Saved", "Disimpan") : L("No changes", "Tiada perubahan"),
                  r.ok ? `${h.name} ${L("removed — payroll working days recount", "dibuang — hari bekerja gaji dikira semula")}` : L("Could not remove that holiday", "Tidak dapat membuang cuti itu"),
                  r.ok ? undefined : "notice");
                void load();
              }}>
              {L("Remove", "Buang")}
            </button>
          </li>
        ))}
        {loaded && holidays.length === 0 && <li className={css.empty}>{L("No holidays yet.", "Belum ada cuti lagi.")}</li>}
      </ul>
    </section>
  );
}

/* v1.145.0 - THE ENTITLEMENT EDITOR LIVED HERE TWICE.
   The CEO, 09-09-2026: *"Leave entitlement (2026) seem appear double
   which is Leave entitlement also appear. I want only Leave entitlement
   in the Leave tabs."*

   It was not a second way in - it was a DEAD card. `leave_entitlement`
   is ["super_admin", "ceo"] in the permissions matrix and every
   entitlement route answers everyone else with "Only the CEO can view
   or change leave entitlements", so hr_admin and admin could see this
   control and never use it. The editor that remains is the one in the
   Leave tab, gated client-side on the same two roles the worker enforces. */
