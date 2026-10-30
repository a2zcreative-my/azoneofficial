"use client";

/* v1.236.0 - THE COMPANY OWNER (the owner, 30-10-2026; claude/CEO-OWNER-
   ACCESS-AUDIT.md: "Use a documented, authorized privileged administration
   or recovery procedure for the initial CEO permission correction").

   Management sees who the owner is and whether the account still qualifies
   (CEO role, active, 2FA on). Only a super admin names, changes or clears
   it: a reason, then the super admin's authenticator code (the same step-up
   retry the final leave and claim signatures use). The worker decides every
   part of it - GET/POST /staff/owner - and audits it as owner.designate /
   owner.clear. Nothing here grants anything. */

import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { L, withStepUp } from "@/components/portal/page-shared";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { btnClass, btnSm, card, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./access-policy.module.css";

interface OwnerState {
  owner: { user_id: number; name: string; verified: boolean; why_not: "not_ceo" | "inactive" | "no_2fa" | null; set_at: string; set_by_name: string | null; reason: string } | null;
  can_designate: boolean;
  candidates: { id: number; name: string; totp: boolean }[];
  me_owner: boolean;
}
const WHY: Record<string, [string, string]> = {
  not_ceo: ["no longer holds the CEO role", "tidak lagi memegang peranan CEO"],
  inactive: ["the account is not active", "akaun tidak aktif"],
  no_2fa: ["two-factor sign-in is off", "log masuk dua faktor dimatikan"],
};

export function useOwner(enabled: boolean, tick = 0) {
  const [got, setGot] = useState<{ d: OwnerState | null; e: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void api<OwnerState>("/staff/owner", { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setGot({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : L("The owner record needs the latest server.", "Rekod pemilik memerlukan pelayan terkini.") });
    });
    return () => c.abort();
  }, [enabled, tick]);
  return got;
}

export function OwnerCard({ state, onChanged }: { state: { d: OwnerState | null; e: string } | null; onChanged: () => void }) {
  const { prompt, node: promptNode } = usePrompt();
  const { show: toast, node: toastNode } = useSaveToast();
  const d = state?.d ?? null;
  const [pick, setPick] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = pick || d?.candidates.find((c) => c.totp)?.id || 0;

  const send = useCallback(async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setError("");
    const r = await withStepUp<{ error?: { message?: string } }>(
      (totp) => api("/staff/owner", { method: "POST", body: JSON.stringify({ ...body, ...(totp ? { totp } : {}) }) }),
      prompt,
      { title: L("Confirm with your authenticator", "Sahkan dengan pengesah anda"), label: L("Your 6-digit authenticator code - this changes who holds the owner's rights", "Kod pengesah 6 digit anda - ini menukar siapa memegang hak pemilik") },
    );
    setBusy(false);
    if (r.ok) { toast(L("Saved", "Disimpan"), done); setReason(""); onChanged(); }
    else setError(r.data?.error?.message ?? L("The server refused the change.", "Pelayan menolak perubahan."));
  }, [prompt, toast, onChanged]);

  return (
    <section className={card} aria-label={L("Company owner", "Pemilik syarikat")}>
      {toastNode}{promptNode}
      <div className={css.head}>
        <div>
          <h3 className={css.title}>{L("Company owner", "Pemilik syarikat")}</h3>
          <p className={css.sub}>{L("The one CEO account that holds the owner's rights on top of the CEO role: executive, customer and Admin accounts and roles - each change with an authenticator code and a reason. Named by a super admin; the CEO role and super admin accounts stay with the super admin.", "Satu akaun CEO yang memegang hak pemilik di atas peranan CEO: akaun dan peranan eksekutif, pelanggan dan Admin - setiap perubahan dengan kod pengesah dan sebab. Dinamakan oleh super admin; peranan CEO dan akaun super admin kekal dengan super admin.")}</p>
        </div>
      </div>
      {state?.e ? <p role="alert" className={css.error}>{state.e}</p> : !d ? <SkelRows rows={2} /> : (
        <>
          {d.owner ? (
            <ul className={css.controls}>
              <li>
                <span className={css.main}>
                  <strong>{d.owner.name}{d.me_owner ? ` · ${L("you", "anda")}` : ""}</strong>
                  <span>{L(`Named ${dmy(d.owner.set_at.slice(0, 10))}${d.owner.set_by_name ? ` by ${d.owner.set_by_name}` : ""} · ${d.owner.reason}`, `Dinamakan ${dmy(d.owner.set_at.slice(0, 10))}${d.owner.set_by_name ? ` oleh ${d.owner.set_by_name}` : ""} · ${d.owner.reason}`)}</span>
                </span>
                {d.owner.verified
                  ? <span className={chipSmSuccess}>{L("Verified", "Disahkan")}</span>
                  : <span className={chipSmWarn}>{L(`Not verified - ${WHY[d.owner.why_not ?? ""]?.[0] ?? ""}`, `Tidak disahkan - ${WHY[d.owner.why_not ?? ""]?.[1] ?? ""}`)}</span>}
              </li>
            </ul>
          ) : (
            <p className={css.warn}><AppIcon name="warning" />{L("No company owner is named. The CEO holds the CEO role's rights only, exactly as before.", "Tiada pemilik syarikat dinamakan. CEO memegang hak peranan CEO sahaja, sama seperti sebelum ini.")}</p>
          )}
          {d.can_designate && (
            <fieldset className={css.form} disabled={busy}>
              <div className={css.formRow}>
                <label>{L("CEO account", "Akaun CEO")}
                  <select className={selectClassSm} value={chosen} onChange={(e) => setPick(Number(e.target.value))}>
                    {d.candidates.length === 0 && <option value={0}>{L("No active CEO account", "Tiada akaun CEO aktif")}</option>}
                    {d.candidates.map((c) => <option key={c.id} value={c.id} disabled={!c.totp}>{c.name}{c.totp ? "" : ` - ${L("2FA off", "2FA mati")}`}</option>)}
                  </select>
                </label>
              </div>
              <label className={css.wide}>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}
                <input className={inputClassSm} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              {error && <p role="alert" className={css.error}>{error}</p>}
              <div className={css.formRow}>
                <button type="button" className={btnClass} disabled={!chosen || reason.trim().length < 10 || d.owner?.user_id === chosen}
                  onClick={() => void send({ user_id: chosen, reason: reason.trim() }, L("Company owner named", "Pemilik syarikat dinamakan"))}>
                  <AppIcon name="verify" />{d.owner ? L("Change the owner", "Tukar pemilik") : L("Name as company owner", "Namakan sebagai pemilik syarikat")}
                </button>
                {d.owner && (
                  <button type="button" className={btnSm} disabled={reason.trim().length < 10}
                    onClick={() => void send({ clear: true, reason: reason.trim() }, L("Owner cleared - the CEO is back to the CEO role's rights", "Pemilik dikosongkan - CEO kembali kepada hak peranan CEO"))}>
                    {L("Clear the owner", "Kosongkan pemilik")}
                  </button>
                )}
              </div>
              <p className={css.sub}>{L("Clearing it is the rollback: the owner's extra doors close at once, nothing else changes.", "Mengosongkannya ialah pemulangan: pintu tambahan pemilik ditutup serta-merta, tiada lain berubah.")}</p>
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}
