"use client";

/* v1.395.0 - DIGITAL CARDS, Stage 6 (the CEO 21-11-2026): review, publishing and AZ ONE.

   - ReviewStep: step 5 of the editor. What is ready and what is not (the server's own checks), the
     preview, and Submit - which freezes the design as a numbered version (worker/src/card-review.ts).
   - ReviewSection: inside the template drawer, for everyone on Digital Cards: where the review
     stands, the versions, and what AZ ONE reported - only what the feed and AZ ONE's own report say,
     never "live" on a guess. The buttons are the server's `can` flags: a COO or CCO pre-checks or
     returns, the CEO or the super admin publishes or returns, unpublishes, or sends a failed hand-over
     again; the designer opens a published template again. Nobody reviews their own design. */

import { useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { DrawerFoot, DrawerForm, DrawerPanel } from "@/components/ui/side-drawer";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { dmyMYT } from "@/lib/format";
import { btnClass, btnGhost, btnSm, chipSmDanger, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import css from "./card-review.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
export interface ReviewInfo {
  version_no: number | null; prechecked_by: string | null; prechecked_at: string | null;
  returned: { note: string | null; at: string } | null; live_version: number | null;
  versions: { version_no: number; content_hash: string; created_at: string; by_name: string | null }[];
  sync: { id: number; version_no: number; action: string; status: string; attempts: number; last_error: string | null; retry_of: number | null; created_at: string; sent_at: string | null; acked_at: string | null }[];
  bridge_configured: boolean;
  can: { submit: boolean; precheck: boolean; publish: boolean; unpublish: boolean; revise: boolean; retry: number[] };
}
interface Ready { specs_ok: boolean; missing: string[]; zones_missing: string[] }
type Answer = { error?: { message?: string; missing?: string[] } };

/** step 5 of the editor: the last checks, then Submit */
export function ReviewStep({ templateId, version, ready, onBack, onPreview, onSubmitted }: {
  templateId: number; version: number; ready: Ready; onBack: () => void; onPreview: () => void; onSubmitted: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checks: [string, boolean, string[]][] = [
    [L("Design specs confirmed", "Spesifikasi reka bentuk disahkan"), ready.specs_ok, []],
    [L("Every page uploaded and the right size", "Setiap halaman dimuat naik dan saiz betul"), ready.missing.length === 0, ready.missing],
    [L("Fields placed, all inside the safe area", "Medan diletakkan, semua dalam kawasan selamat"), ready.zones_missing.length === 0, ready.zones_missing],
  ];
  const ok = checks.every(([, y]) => y);
  const submit = async () => {
    setBusy(true); setError(null);
    const r = await api<Answer>(`/staff/card-templates/${templateId}/submit`, { method: "POST", body: JSON.stringify({ version, note }) });
    setBusy(false);
    if (r.ok) onSubmitted();
    else setError(r.data?.error?.message ?? L("Not sent - try again.", "Tidak dihantar - cuba lagi."));
  };
  return (
    <DrawerForm testid="dc-review-step" aside={
      <DrawerPanel icon="info" title={L("What happens next", "Apa berlaku seterusnya")}>
        <ol className={css.steps}>
          <li>{L("The design is frozen as a numbered version - what is reviewed is exactly what is published.", "Reka bentuk dibekukan sebagai versi bernombor - yang disemak ialah yang diterbitkan.")}</li>
          <li>{L("The COO or the CCO pre-checks it, or returns it to you with a note.", "COO atau CCO membuat pra-semakan, atau mengembalikannya kepada anda dengan nota.")}</li>
          <li>{L("The CEO or the super admin publishes it to AZ ONE.", "CEO atau super admin menerbitkannya ke AZ ONE.")}</li>
        </ol>
      </DrawerPanel>
    }>
      <ul className={css.checks} data-testid="dc-review-checks">
        {checks.map(([label, y, why]) => (
          <li key={label}><span className={y ? chipSmSuccess : chipSmDanger}>{y ? L("Ready", "Sedia") : L("Not yet", "Belum")}</span> {label}
            {!y && why.length > 0 && <ul className={css.why}>{why.slice(0, 4).map((w) => <li key={w}>{w}</li>)}</ul>}</li>
        ))}
      </ul>
      <label className="erp-field"><span className="erp-label">{L("Note for the reviewers (optional)", "Nota untuk penyemak (pilihan)")}</span>
        <textarea className="erp-input erp-textarea" rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-testid="dc-review-note" /></label>
      {error && <p className="erp-error" role="alert" data-testid="dc-review-error">{error}</p>}
      <DrawerFoot testid="dc-review-actions">
        <button type="button" className={btnGhost} onClick={onBack} disabled={busy}>{L("Back", "Kembali")}</button>
        <button type="button" className={btnSm} onClick={onPreview} disabled={busy}><AppIcon name="preview" /> {L("Preview", "Pratonton")}</button>
        <button type="button" className={btnClass} onClick={() => void submit()} disabled={busy || !ok} data-testid="dc-review-submit">{busy ? L("Sending…", "Menghantar…") : L("Send for review", "Hantar untuk semakan")}</button>
      </DrawerFoot>
    </DrawerForm>
  );
}

const SYNC: Record<string, [() => string, string]> = {
  pending: [() => L("Waiting for AZ ONE to collect it", "Menunggu AZ ONE mengambilnya"), chipSmNeutral],
  sent: [() => L("Collected by AZ ONE - waiting for its report", "Diambil oleh AZ ONE - menunggu laporannya"), chipSmWarn],
  imported: [() => L("AZ ONE has it", "AZ ONE telah menerimanya"), chipSmSuccess],
  failed: [() => L("AZ ONE could not import it", "AZ ONE tidak dapat mengimportnya"), chipSmDanger],
};

/** the review, the versions and AZ ONE, inside the template drawer */
export function ReviewSection({ templateId, version, state, review, onChanged }: {
  templateId: number; version: number; state: string; review: ReviewInfo; onChanged: (msg: string) => void;
}) {
  const { prompt, node: promptNode } = usePrompt();
  const { confirm, node: confirmNode } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (path: string, body: Record<string, unknown>, done: string) => {
    setBusy(true); setError(null);
    const r = await api<Answer>(`/staff/card-templates/${templateId}/${path}`, { method: "POST", body: JSON.stringify({ version, ...body }) });
    setBusy(false);
    if (r.ok) onChanged(done); else setError(r.data?.error?.message ?? L("Not saved - try again.", "Tidak disimpan - cuba lagi."));
  };
  const withNote = async (title: string, label: string, confirmLabel: string, danger = false) => {
    const r = await prompt({ title, label, required: true, confirmLabel, variant: danger ? "danger" : undefined });
    return r ? r.value.trim() : null;
  };
  const back = async (step: "precheck" | "publish") => {
    const note = await withNote(L("Return to the designer?", "Kembalikan kepada pereka?"), L("What should change? (at least 10 characters)", "Apa yang perlu diubah? (sekurang-kurangnya 10 aksara)"), L("Return", "Kembalikan"), true);
    if (note) await send(step, { decision: "return", note }, L("Returned to the designer", "Dikembalikan kepada pereka"));
  };
  const v = review.version_no;
  const status = state === "in_review" ? (review.prechecked_by
    ? L(`v${v} pre-checked by ${review.prechecked_by} - waiting for the CEO or the super admin to publish`, `v${v} dipra-semak oleh ${review.prechecked_by} - menunggu CEO atau super admin menerbitkan`)
    : L(`v${v} sent for review - waiting for the COO or the CCO to pre-check`, `v${v} dihantar untuk semakan - menunggu COO atau CCO membuat pra-semakan`))
    : state === "returned" ? L("Returned to the designer", "Dikembalikan kepada pereka")
      : state === "published" ? L(`Published (v${review.versions[0]?.version_no ?? "?"})`, `Diterbitkan (v${review.versions[0]?.version_no ?? "?"})`)
        : state === "unpublished" ? L("Unpublished", "Ditarik balik") : L("Not sent for review yet", "Belum dihantar untuk semakan");
  return (
    <section className={css.section} data-testid="dc-review">
      <h3 className={css.subhead}>{L("Review", "Semakan")}</h3>
      <p className={css.status} data-testid="dc-review-status">{status}</p>
      {review.returned?.note && <p className={css.note}>“{review.returned.note}” <small>{dmyMYT(review.returned.at)}</small></p>}
      {review.live_version != null && <p><span className={chipSmSuccess}>{L(`v${review.live_version} is the version for AZ ONE`, `v${review.live_version} ialah versi untuk AZ ONE`)}</span></p>}
      {(review.can.precheck || review.can.publish) && (
        <div className={css.actions}>
          {review.can.precheck && <button type="button" className={btnClass} disabled={busy} data-testid="dc-precheck-pass"
            onClick={async () => { if (await confirm({ title: L(`Pre-check v${v}?`, `Pra-semak v${v}?`), message: L("It goes to the CEO or the super admin to publish.", "Ia pergi kepada CEO atau super admin untuk diterbitkan."), confirmLabel: L("Pre-check", "Pra-semak") })) await send("precheck", { decision: "pass" }, L("Pre-checked", "Dipra-semak")); }}>
            {L("Pre-check", "Pra-semak")}</button>}
          {review.can.publish && <button type="button" className={btnClass} disabled={busy} data-testid="dc-publish"
            onClick={async () => { if (await confirm({ title: L(`Publish v${v} to AZ ONE?`, `Terbitkan v${v} ke AZ ONE?`), message: L("AZ ONE collects it through the signed feed. Customer cards already made stay on their own version.", "AZ ONE mengambilnya melalui suapan bertandatangan. Kad pelanggan sedia ada kekal pada versi masing-masing."), confirmLabel: L("Publish", "Terbitkan") })) await send("publish", { decision: "publish" }, L("Published - waiting for AZ ONE", "Diterbitkan - menunggu AZ ONE")); }}>
            {L("Publish", "Terbitkan")}</button>}
          <button type="button" className={btnGhost} disabled={busy} onClick={() => void back(review.can.publish ? "publish" : "precheck")} data-testid="dc-return">{L("Return", "Kembalikan")}</button>
        </div>
      )}
      {(review.can.unpublish || review.can.revise) && (
        <div className={css.actions}>
          {review.can.revise && <button type="button" className={btnSm} disabled={busy} data-testid="dc-revise"
            onClick={async () => { if (await confirm({ title: L("Make a new version?", "Buat versi baharu?"), message: L("The template opens as a draft again. The published version stays on AZ ONE until the next one is published.", "Templat dibuka sebagai draf semula. Versi yang diterbitkan kekal di AZ ONE sehingga versi seterusnya diterbitkan."), confirmLabel: L("Make a new version", "Buat versi baharu") })) await send("revise", {}, L("Open as a draft again", "Dibuka sebagai draf semula")); }}>
            <AppIcon name="edit" /> {L("Make a new version", "Buat versi baharu")}</button>}
          {review.can.unpublish && <button type="button" className={btnGhost} disabled={busy} data-testid="dc-unpublish"
            onClick={async () => { const note = await withNote(L("Take it off AZ ONE?", "Keluarkan dari AZ ONE?"), L("Why? (at least 10 characters) - customer cards already made keep working", "Kenapa? (sekurang-kurangnya 10 aksara) - kad pelanggan sedia ada terus berfungsi"), L("Unpublish", "Tarik balik"), true); if (note) await send("unpublish", { note }, L("Unpublished - AZ ONE will hide it", "Ditarik balik - AZ ONE akan menyembunyikannya")); }}>
            {L("Unpublish", "Tarik balik")}</button>}
        </div>
      )}
      {error && <p className="erp-error" role="alert" data-testid="dc-review-error">{error}</p>}

      {(review.sync.length > 0 || review.live_version != null) && (
        <>
          <h3 className={css.subhead}>AZ ONE</h3>
          {!review.bridge_configured && <p className="erp-help" role="status" data-testid="dc-bridge-off"><AppIcon name="warning" /> {L("AZ ONE is not connected yet. Published templates wait here and go over once the connection is switched on.", "AZ ONE belum disambungkan. Templat yang diterbitkan menunggu di sini dan dihantar sebaik sambungan dihidupkan.")}</p>}
          <ul className={css.syncList} data-testid="dc-sync">
            {review.sync.map((s) => (
              <li key={s.id}>
                <span className={SYNC[s.status]?.[1] ?? chipSmNeutral}>{SYNC[s.status]?.[0]() ?? s.status}</span>{" "}
                <strong>{s.action === "publish" ? L(`Publish v${s.version_no}`, `Terbit v${s.version_no}`) : L(`Unpublish v${s.version_no}`, `Tarik balik v${s.version_no}`)}</strong>
                <small className={css.muted}> · {dmyMYT(s.created_at)}{s.acked_at ? ` · ${L("reported", "dilaporkan")} ${dmyMYT(s.acked_at)}` : ""}{s.retry_of ? ` · ${L("sent again", "dihantar semula")}` : ""}</small>
                {s.last_error && <p className="erp-error">{s.last_error}</p>}
                {review.can.retry.includes(s.id) && <button type="button" className={btnSm} disabled={busy} data-testid={`dc-retry-${s.id}`} onClick={() => void send(`sync/${s.id}/retry`, {}, L("Sent again", "Dihantar semula"))}><AppIcon name="refresh" /> {L("Send again", "Hantar semula")}</button>}
              </li>
            ))}
          </ul>
        </>
      )}
      {review.versions.length > 0 && (
        <>
          <h3 className={css.subhead}>{L("Versions", "Versi")}</h3>
          <ul className={css.syncList} data-testid="dc-versions">
            {review.versions.map((x) => (
              <li key={x.version_no}><strong>v{x.version_no}</strong> <small className={css.muted}>{dmyMYT(x.created_at)}{x.by_name ? ` · ${x.by_name}` : ""} · <span className="erp-nowrap" title={x.content_hash}>{x.content_hash.slice(0, 12)}</span></small></li>
            ))}
          </ul>
        </>
      )}
      {promptNode}{confirmNode}
    </section>
  );
}
