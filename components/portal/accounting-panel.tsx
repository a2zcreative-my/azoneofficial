"use client";

/* v1.18.0 — Accounting (programme phase 7): chart of accounts, a
 * balanced-only journal (the server refuses an entry whose debits ≠ credits —
 * the invariant lives where it cannot be bypassed) and a trial balance
 * computed from the journal.
 *
 * v1.172.0 — this file was purchasing-panels.tsx and carried the Purchasing
 * module too. Purchasing is retired (with Reconciliation and Ads Fund): its
 * panel, tab, roles, icon and strings are gone from the portal; the worker's
 * /erp/suppliers, /erp/purchase-orders and /erp/stock-items routes and the
 * suppliers / purchase_orders tables stay as they are - dormant, nothing
 * calls them, nothing is dropped. Only the Accounting half moved here.
 */

import { useCallback, useEffect, useState } from "react";

import { StatStrip, StatTile } from "@/components/ui/stat-tile";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel } from "@/components/ui/skeleton";
import { makeApi } from "@/lib/api";
import { fmtRM } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, card, chipNeutral, fieldLabel, fieldRow, inputClass, inputClassSm, td, tdOneLine, tdR2, th, thR2 } from "@/lib/ui-styles";

const api = makeApi("/staff/erp");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/* v1.77.0 — the KPI strip's skeleton: four tiles inside the real StatStrip,
   so the grid geometry is the strip's own and nothing jumps when the numbers
   land. */
function SkelTileStrip() {
  return (
    <StatStrip>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-secondary rounded-xl p-3" aria-hidden>
          <Skel className="h-2.5 w-24" />
          <Skel className="mt-2 h-7 w-28" />
        </div>
      ))}
    </StatStrip>
  );
}

/* ============================ Accounting ============================ */

interface GlAccount { id: number; code: string; name: string; type: string; debit_cents?: number; credit_cents?: number }
interface JournalLineDraft { account_id: string; debit: string; credit: string }

export function AccountingPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [trial, setTrial] = useState<GlAccount[]>([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<{ entry_date: string; memo: string; lines: JournalLineDraft[] }>({
    entry_date: "", memo: "", lines: [{ account_id: "", debit: "", credit: "" }, { account_id: "", debit: "", credit: "" }],
  });

  /* v1.77.0 — true once the first load settles (ok or not); until then the
     KPI strip and the trial balance are skeletons, never "0 accounts" and
     "No journal entries yet". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const a = await api<{ accounts: GlAccount[]; pending_migration?: boolean }>(`/gl/accounts`);
    setAccounts(a.data?.accounts ?? []);
    setPending(a.data?.pending_migration === true);
    const t = await api<{ accounts: GlAccount[] }>(`/gl/trial-balance`);
    setTrial(t.data?.accounts ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const totalDebit = draft.lines.reduce((a, l) => a + (l.debit ? Number(l.debit) : 0), 0);
  const totalCredit = draft.lines.reduce((a, l) => a + (l.credit ? Number(l.credit) : 0), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  const trialDebit = trial.reduce((a, t) => a + (t.debit_cents ?? 0), 0);
  const trialCredit = trial.reduce((a, t) => a + (t.credit_cents ?? 0), 0);

  const post = async () => {
    const r = await api(`/gl/journal`, {
      method: "POST",
      body: JSON.stringify({
        entry_date: draft.entry_date, memo: draft.memo,
        lines: draft.lines
          .filter((l) => l.account_id && (l.debit || l.credit))
          .map((l) => ({ account_id: Number(l.account_id), debit: l.debit ? Number(l.debit) : 0, credit: l.credit ? Number(l.credit) : 0 })),
      }),
    });
    if (r.ok) {
      setDraft({ entry_date: "", memo: "", lines: [{ account_id: "", debit: "", credit: "" }, { account_id: "", debit: "", credit: "" }] });
      showToast(L("Saved", "Disimpan"), L("Journal entry posted", "Catatan jurnal diposkan"));
      void load();
    } else showToast(L("No changes", "Tiada perubahan"), (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Debits must equal credits", "Debit mesti sama dengan kredit"), "notice");
  };

  const setLine = (i: number, patch: Partial<JournalLineDraft>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)) }));

  return (
    /* v1.173.0 (tab concept): the four figures first (AT A GLANCE), the
       trial balance under THE BOOKS, the journal composer its own card
       under ADJUSTMENTS - balance before adjustment, as before. */
    <TabPage>
      {toastNode}
      <TabZone label={L("At a glance", "Sepintas lalu")}>
      {pending && <p className="bg-warning-soft text-warning mb-3 rounded-lg px-3 py-2 text-xs font-medium">{L("The ERP tables are not migrated yet — run DEPLOY.bat (step 2 applies 0071), then reload.", "Jadual ERP belum dimigrasi lagi — jalankan DEPLOY.bat (langkah 2 menggunakan 0071), kemudian muat semula.")}</p>}
      <div>
        {/* v1.77.0 — skeleton until the first fetch lands. */}
        {!loaded ? <SkelTileStrip /> : (
          <StatStrip>
            <StatTile tone="brand" label={L("Accounts", "Akaun")} value={accounts.length} icon="≡" />
            <StatTile tone="info" label={L("Total debits", "Jumlah debit")} value={fmtRM(trialDebit)} icon="◧" />
            <StatTile tone="info" label={L("Total credits", "Jumlah kredit")} value={fmtRM(trialCredit)} icon="◨" />
            <StatTile tone={trialDebit === trialCredit ? "success" : "danger"}
              label={trialDebit === trialCredit ? L("Balanced", "Seimbang") : L("OUT OF BALANCE", "TIDAK SEIMBANG")}
              value={trialDebit === trialCredit ? "✓" : fmtRM(Math.abs(trialDebit - trialCredit))} icon="⚖" />
          </StatStrip>
        )}
      </div>
      </TabZone>

      <TabZone label={L("The books", "Buku akaun")}>
      <div className={card}>
      <p className="text-sm font-semibold">{L("Accounting", "Perakaunan")}</p>
      <p className="text-muted-foreground mt-1 mb-3 text-[11.5px]">
        {L("Bank movements post here automatically (paid expenses, payroll runs, claim payouts, Finance-tab entries) — this composer is for adjustments only.", "Pergerakan bank diposkan di sini secara automatik (perbelanjaan dibayar, larian gaji, bayaran tuntutan, catatan tab Kewangan) — borang ini untuk pelarasan sahaja.")}
      </p>
      {/* Trial balance */}
      <p className="mb-2 text-xs font-semibold">{L("Trial balance", "Imbangan duga")}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead><tr>
            <th className={th}>{L("Code", "Kod")}</th><th className={th}>{L("Account", "Akaun")}</th><th className={th}>{L("Type", "Jenis")}</th>
            <th className={thR2}>Debit</th><th className={thR2}>{L("Credit", "Kredit")}</th>
          </tr></thead>
          <tbody>
            {/* v1.77.0 — skeleton until the first fetch lands: shimmering
                cells under the real header, same five columns. */}
            {!loaded && Array.from({ length: 5 }, (_, i) => (
              <tr key={`skel-${i}`} className="border-border border-t" aria-hidden>
                <td className={td}><Skel className="h-4 w-10" /></td>
                <td className={td}><Skel className="h-4 w-36" /></td>
                <td className={td}><Skel className="h-5 w-16 rounded-full" /></td>
                <td className={tdR2}><Skel className="ml-auto h-4 w-20" /></td>
                <td className={tdR2}><Skel className="ml-auto h-4 w-20" /></td>
              </tr>
            ))}
            {loaded && trial.filter((t) => (t.debit_cents ?? 0) !== 0 || (t.credit_cents ?? 0) !== 0).map((t) => (
              <tr key={t.id} className="border-border border-t">
                <td className={`${tdOneLine} tabular-nums`}>{t.code}</td>
                <td className={td}>{t.name}</td>
                <td className={td}><span className={chipNeutral}>{t.type}</span></td>
                <td className={tdR2}>{(t.debit_cents ?? 0) > 0 ? fmtRM(t.debit_cents ?? 0) : ""}</td>
                <td className={tdR2}>{(t.credit_cents ?? 0) > 0 ? fmtRM(t.credit_cents ?? 0) : ""}</td>
              </tr>
            ))}
            {loaded && trial.every((t) => (t.debit_cents ?? 0) === 0 && (t.credit_cents ?? 0) === 0) && (
              <tr><td colSpan={5} className="text-muted-foreground px-3 py-6 text-center text-sm">{L(`No journal entries yet — the ${accounts.length}-account chart is seeded and ready.`, `Tiada catatan jurnal lagi — carta ${accounts.length} akaun sudah dibenih dan sedia.`)}</td></tr>
            )}
          </tbody>
          {trialDebit + trialCredit > 0 && (
            <tfoot><tr className="border-border border-t-2">
              <td className={td} colSpan={3}><b>{L("Total", "Jumlah")}</b></td>
              <td className={tdR2}><b>{fmtRM(trialDebit)}</b></td>
              <td className={tdR2}><b>{fmtRM(trialCredit)}</b></td>
            </tr></tfoot>
          )}
        </table>
      </div>
      </div>
      </TabZone>

      <TabZone label={L("Adjustments", "Pelarasan")}>
      {/* Journal entry — the server refuses unbalanced entries; the button
          mirrors that rule so nobody types a whole entry to be told no. */}
      <div className={card}>
        <p className="mb-2 text-xs font-semibold">{L("New journal entry", "Catatan jurnal baharu")}</p>
        <div className={fieldRow}>
          <label><span className={fieldLabel}>{L("Date", "Tarikh")}</span>
            <input type="date" className={inputClass} value={draft.entry_date} onChange={(e) => setDraft((d) => ({ ...d, entry_date: e.target.value }))} /></label>
          <label className="col-span-2 min-w-40 flex-1 sm:col-span-1"><span className={fieldLabel}>Memo</span>
            <input className={inputClass} placeholder={L("August TikTok payout banked", "Bayaran TikTok Ogos dibankkan")} value={draft.memo} onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))} /></label>
        </div>
        {draft.lines.map((l, i) => (
          <div key={i} className={`${fieldRow} mt-2`}>
            <label className="col-span-2 min-w-44 flex-1 sm:col-span-1"><span className={fieldLabel}>{L("Account", "Akaun")}</span>
              <select className={inputClassSm} value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })}>
                <option value="">—</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select></label>
            <label><span className={fieldLabel}>Debit (RM)</span>
              <input type="number" min="0" step="0.01" className={inputClassSm} value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })} /></label>
            <label><span className={fieldLabel}>{L("Credit (RM)", "Kredit (RM)")}</span>
              <input type="number" min="0" step="0.01" className={inputClassSm} value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })} /></label>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={btnSm} onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { account_id: "", debit: "", credit: "" }] }))}>{L("+ Line", "+ Baris")}</button>
          <button type="button" className={btnClass} disabled={!draft.entry_date || !balanced} onClick={() => void post()}>{L("Post entry", "Pos catatan")}</button>
          <span className={`text-xs font-medium tabular-nums ${balanced ? "text-success" : "text-muted-foreground"}`}>
            Dr {totalDebit.toFixed(2)} / Cr {totalCredit.toFixed(2)} {balanced ? L("— balanced ✓", "— seimbang ✓") : L("— must match", "— mesti sepadan")}
          </span>
        </div>
      </div>
      </TabZone>
    </TabPage>
  );
}
