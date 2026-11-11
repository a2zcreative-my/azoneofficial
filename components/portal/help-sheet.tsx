"use client";

/* v1.279.0 - MINIMAL EXECUTIVE WORKSPACE: the header's Help (?) button (the
   CEO approved it, 11-11-2026, claude/MINIMAL-EXECUTIVE-WORKSPACE-BLUEPRINT.md
   decision 4). A short sheet, no new content system: what the open page is
   for (the one line TAB_HINTS already holds, where there is one), how to get
   around, and where the settings went when they left the header. It says
   nothing it cannot back up - no phone number, no promise of a reply time. */

import { SideDrawer } from "@/components/ui/side-drawer";
import { TAB_HINTS, type TabName } from "@/lib/portal-tabs";
import { t as tr, type Lang } from "@/lib/i18n";
import { APP_VERSION } from "@/lib/version";
import css from "./help-sheet.module.css";

export function HelpSheet({ open, onClose, tab, lang }: { open: boolean; onClose: () => void; tab: string; lang: Lang }) {
  const ms = lang === "ms";
  const L = (en: string, bm: string) => (ms ? bm : en);
  const hint = TAB_HINTS[tab as TabName];
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
  return (
    <SideDrawer open={open} onClose={onClose} title={L("Help", "Bantuan")} subtitle={tr(tab, lang)}>
      <div className={css.body}>
        {hint && (
          <section className={css.section} aria-labelledby="help-page">
            <h3 id="help-page" className={css.h}>{L("This page", "Halaman ini")}</h3>
            <p className={css.p}><b>{tr(tab, lang)}</b> — {ms ? hint.ms : hint.en}</p>
          </section>
        )}
        <section className={css.section} aria-labelledby="help-move">
          <h3 id="help-move" className={css.h}>{L("Getting around", "Cara bergerak")}</h3>
          <dl className={css.keys}>
            <dt><kbd className={css.kbd}>{mac ? "⌘" : "Ctrl"} K</kbd></dt>
            <dd>{L("Search anything - people, documents, pages", "Cari apa sahaja - orang, dokumen, halaman")}</dd>
            <dt><kbd className={css.kbd}>↑</kbd> <kbd className={css.kbd}>↓</kbd></dt>
            <dd>{L("Move along the sidebar; Enter opens", "Bergerak di bar sisi; Enter membuka")}</dd>
            <dt><kbd className={css.kbd}>Esc</kbd></dt>
            <dd>{L("Close a sheet or menu", "Tutup helaian atau menu")}</dd>
          </dl>
        </section>
        <section className={css.section} aria-labelledby="help-settings">
          <h3 id="help-settings" className={css.h}>{L("Where the settings are", "Di mana tetapan")}</h3>
          <p className={css.p}>
            {L(
              "Your name at the foot of the sidebar opens your profile, cards, notification sound, push alerts, language, colour theme and Sign out. On a phone they are under More.",
              "Nama anda di bawah bar sisi membuka profil, kad, bunyi pemberitahuan, makluman push, bahasa, tema warna dan Log keluar. Di telefon, semuanya di bawah Lagi.",
            )}
          </p>
          <p className={css.p}>
            {L(
              "Modules not shown in the sidebar are under More, and every page you may open is in search.",
              "Modul yang tiada di bar sisi ada di bawah Lagi, dan setiap halaman yang anda boleh buka ada dalam carian.",
            )}
          </p>
        </section>
        <section className={css.section} aria-labelledby="help-wrong">
          <h3 id="help-wrong" className={css.h}>{L("Something not right?", "Ada yang tidak kena?")}</h3>
          <p className={css.p}>
            {L(
              "Tell your manager or the CEO what you were doing and what you saw - a screenshot helps.",
              "Beritahu pengurus anda atau CEO apa yang anda lakukan dan apa yang anda lihat - tangkapan skrin membantu.",
            )}
          </p>
          <p className={css.build}>{L(`Staff portal · v${APP_VERSION}`, `Portal kakitangan · v${APP_VERSION}`)}</p>
        </section>
      </div>
    </SideDrawer>
  );
}
