"use client";

/* v1.238.0 - THE OFFBOARD SHEET (the owner, 31-10-2026; claude/ACCOUNT-
   RECOVERY-AUDIT.md: "Transfer outstanding Tasks. Transfer relevant customer
   responsibility. Preserve historical records. Do not automatically delete
   former employees.").

   Replaces the one-field date prompt. It shows what the leaver still holds
   (GET /staff/users/:id/handover - open tasks, open customer follow-ups,
   assets to collect, commission not yet paid), lets the CEO hand the open
   tasks and follow-ups to one active colleague in the same audited step, and
   asks for the last day. An executive or Admin account asks for the
   authenticator code through withStepUp - the v1.236.0 prompt never did, so
   the owner's offboard of one was refused with no way to sign it.

   Nothing finished moves, nothing is deleted: history keeps the leaver's
   name. Assets are listed for return, never moved. Commission is settled by
   the CEO's existing leaver decision in Payroll. */

import { useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { L, withStepUp } from "@/components/portal/page-shared";
import { api, makeApi } from "@/lib/api";
import { dmy, fmtRM } from "@/lib/format";
import { btnSmDanger, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./offboard-sheet.module.css";

const apiRoot = makeApi("");

interface Handover {
  tasks: { id: number; title: string; status: string; deadline: string | null }[];
  followups: { id: number; due_on: string | null; note: string | null; company: string | null }[];
  assets: { id: number; asset_tag: string | null; name: string }[];
  commission: { open: number; cents: number };
}
export interface OffboardPerson { id: number; name: string }

function todayMyt(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function OffboardSheet({ person, colleagues, onClose, onDone }: {
  person: OffboardPerson | null;
  /** Active staff who can receive the handover (the leaver excluded by the caller). */
  colleagues: OffboardPerson[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { prompt, node: promptNode } = usePrompt();
  const [got, setGot] = useState<{ id: number; d: Handover | null; e: string } | null>(null);
  const [leftOn, setLeftOn] = useState(todayMyt());
  const [to, setTo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!person) return;
    const c = new AbortController();
    void api<Handover>(`/staff/users/${person.id}/handover`, { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setGot({ id: person.id, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : L("What they hold could not be read - you can still offboard.", "Apa yang mereka pegang tidak dapat dibaca - anda masih boleh menamatkan khidmat.") });
    });
    return () => c.abort();
  }, [person]);

  const close = () => { setTo(0); setError(""); setLeftOn(todayMyt()); setGot(null); onClose(); };
  const h = got && person && got.id === person.id ? got : null;
  const d = h?.d ?? null;
  const open = (d?.tasks.length ?? 0) + (d?.followups.length ?? 0);

  const run = async () => {
    if (!person) return;
    setBusy(true); setError("");
    const r = await withStepUp<{ left_on?: string; moved?: { tasks: number; followups: number }; error?: { message?: string } }>(
      (totp) => apiRoot(`/users/${person.id}/offboard`, { method: "POST", body: JSON.stringify({ left_on: leftOn, ...(to ? { handover_to: to } : {}), ...(totp ? { totp } : {}) }) }),
      prompt,
      { title: L("Confirm with your authenticator", "Sahkan dengan pengesah anda"), label: L("Your 6-digit authenticator code - an executive or Admin account is being offboarded", "Kod pengesah 6 digit anda - akaun eksekutif atau Admin sedang ditamatkan khidmat") },
    );
    setBusy(false);
    if (!r.ok) { setError(r.data?.error?.message ?? L("Offboard failed", "Tamat khidmat gagal")); return; }
    const m = r.data?.moved;
    const toName = colleagues.find((c) => c.id === to)?.name;
    onDone(`${person.name} — ${L(`last day ${dmy(r.data?.left_on ?? leftOn)}, signed out everywhere, 2FA cleared`, `hari terakhir ${dmy(r.data?.left_on ?? leftOn)}, dilog keluar di semua peranti, 2FA dibuang`)}${m && toName && (m.tasks || m.followups) ? L(`; ${m.tasks} task(s) and ${m.followups} follow-up(s) to ${toName}`, `; ${m.tasks} tugasan dan ${m.followups} susulan kepada ${toName}`) : ""}`);
    close();
  };

  return (
    <SideDrawer open={!!person} onClose={close} wide full
      title={person ? L(`Offboard ${person.name}`, `Tamatkan khidmat ${person.name}`) : ""}
      subtitle={L("One audited step: marked resigned from the last day, signed out everywhere, two-factor setup removed. The account and every record stay.", "Satu langkah diaudit: ditandakan letak jawatan dari hari terakhir, dilog keluar di semua peranti, persediaan dua faktor dibuang. Akaun dan setiap rekod kekal.")}>
      {promptNode}
      <div className={css.sheet}>
        <section className={css.block} aria-label={L("What they still hold", "Apa yang mereka masih pegang")}>
          <p className={css.label}>{L("What they still hold", "Apa yang mereka masih pegang")}</p>
          {!h ? <SkelRows rows={3} /> : h.e ? <p className={css.muted}>{h.e}</p> : d && (
            <dl className={css.dl}>
              <dt>{L("Open tasks", "Tugasan terbuka")}</dt>
              <dd>{d.tasks.length === 0 ? L("None", "Tiada") : <ul className={css.list}>{d.tasks.slice(0, 8).map((t) => <li key={t.id}>{t.title}{t.deadline ? ` · ${dmy(t.deadline.slice(0, 10))}` : ""}</li>)}{d.tasks.length > 8 && <li>{L(`and ${d.tasks.length - 8} more`, `dan ${d.tasks.length - 8} lagi`)}</li>}</ul>}</dd>
              <dt>{L("Customer follow-ups", "Susulan pelanggan")}</dt>
              <dd>{d.followups.length === 0 ? L("None", "Tiada") : <ul className={css.list}>{d.followups.slice(0, 8).map((f) => <li key={f.id}>{f.company ?? L("Customer", "Pelanggan")}{f.due_on ? ` · ${dmy(f.due_on.slice(0, 10))}` : ""}</li>)}{d.followups.length > 8 && <li>{L(`and ${d.followups.length - 8} more`, `dan ${d.followups.length - 8} lagi`)}</li>}</ul>}</dd>
              <dt>{L("Assets to collect", "Aset untuk dikutip")}</dt>
              <dd>{d.assets.length === 0 ? L("None", "Tiada") : d.assets.map((a) => `${a.asset_tag ? `${a.asset_tag} ` : ""}${a.name}`).join(", ")}</dd>
              <dt>{L("Commission not yet paid", "Komisen belum dibayar")}</dt>
              <dd>{d.commission.open === 0 ? L("None", "Tiada") : L(`${d.commission.open} line(s), ${fmtRM(d.commission.cents)} - settled by your leaver decision in Payroll`, `${d.commission.open} baris, ${fmtRM(d.commission.cents)} - diselesaikan oleh keputusan anda dalam Gaji`)}</dd>
            </dl>
          )}
        </section>

        <fieldset className={css.form} disabled={busy}>
          <label>{L("Last day of employment", "Hari terakhir bekerja")}
            <input type="date" className={inputClassSm} value={leftOn} required onChange={(e) => setLeftOn(e.target.value)} />
            <span className={css.muted}>{L("Payroll prorates their final month on this date.", "Gaji bulan akhir dikira mengikut tarikh ini.")}</span>
          </label>
          <label>{L("Hand open tasks and follow-ups to", "Serahkan tugasan dan susulan terbuka kepada")}
            <select className={selectClassSm} value={to} onChange={(e) => setTo(Number(e.target.value))}>
              <option value={0}>{L("Nobody - leave them where they are", "Tiada - biarkan di tempatnya")}</option>
              {colleagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {open > 0 && !to && <span className={css.warnText}>{L(`${open} open item(s) stay with the leaver unless you choose someone.`, `${open} perkara terbuka kekal dengan yang berhenti melainkan anda memilih seseorang.`)}</span>}
          </label>
          {error && <p role="alert" className={css.error}>{error}</p>}
          <div className={css.actions}>
            <button type="button" className={btnSmDanger} disabled={!/^\d{4}-\d{2}-\d{2}$/.test(leftOn)} onClick={() => void run()}>
              <AppIcon name="offboard" />{busy ? L("Offboarding…", "Menamatkan…") : L("Offboard", "Tamatkan khidmat")}
            </button>
          </div>
        </fieldset>
      </div>
    </SideDrawer>
  );
}
