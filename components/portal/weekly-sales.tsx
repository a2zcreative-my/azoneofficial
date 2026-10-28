"use client";

/* v1.223.0 - WEEKLY SALES on the Sales Overview (the owner's brief and
   answers, 28-10-2026; claude/WEEKLY-SALES-AUDIT.md). One card in place of
   "This week": the approved weekly target or "Target not set", progress on
   the Collected rule (paid in full, by closer), the confirmed amount beside
   it, the week's activity, a status that waits for the early-warning day,
   the person's sales tasks (the existing Tasks), and the recovery plan.
   Management sees everyone, sets targets (CEO, COO, super admin), reviews
   plans and assigns linked tasks. Every figure comes from /staff/sales/week;
   nothing is computed here, invented or sent to a customer. */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { makeApi, type ApiResult } from "@/lib/api";
import { dmy, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnClass, btnSm, btnSmPrimary, card, chipDanger, chipInfo, chipNeutral, chipSuccess, chipWarn, fieldLabel, inputClass } from "@/lib/ui-styles";
import css from "./weekly-sales.module.css";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const message = (r: ApiResult<unknown>) => (r.data as { error?: { message?: string } } | null)?.error?.message ?? L("Connection failed. Retry when online.", "Sambungan gagal. Cuba semula apabila dalam talian.");
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

type Status = "no_target" | "not_working" | "planning" | "achieved" | "on_track" | "at_risk" | "action" | "missed";
interface Sum { n: number; cents: number }
export interface WeekRow {
  user_id: number; name: string; target_cents: number | null; target_from: string | null; target_set_by: string | null; target_reason: string | null;
  basis_cents: number; paid_invoices: number; confirmed_cents: number; confirmed_invoices: number;
  quotations: Sum; won: Sum; open_quotations: Sum; followups_done: number; followups_overdue: number; enquiries: number | null; new_customers: number;
  tasks: { open: number; done: number; overdue: number };
  pct: number | null; gap_cents: number | null; working_days: number; elapsed_days: number; expected_cents: number | null; status: Status; activity: number;
  plan: { id: number; status: "draft" | "submitted" | "approved" | "returned"; updated_at: string; reviewed_at: string | null; reviewer: string | null } | null;
  final: { status: string | null; basis_cents: number; target_cents: number | null; finalised_at: string; changed_cents: number } | null;
}
interface Week { from: string; to: string; today: string; checkpoint: "planning" | "early_warning" | "review" | "final"; start_dow: number }
interface WeekResp { week: Week; scope: "mine" | "all"; can_set: boolean; can_view_all: boolean; me?: WeekRow; rows?: WeekRow[]; company?: { target_cents: number | null; target_from: string | null; basis_cents: number; confirmed_cents: number; pct: number | null; gap_cents: number | null } }

const STATUS: Record<Status, [string, string, string]> = {
  no_target: ["Target not set", "Sasaran belum ditetapkan", chipNeutral],
  not_working: ["Not working this week", "Tidak bekerja minggu ini", chipNeutral],
  planning: ["Planning", "Perancangan", chipInfo],
  achieved: ["Target reached", "Sasaran dicapai", chipSuccess],
  on_track: ["On track", "Mengikut landasan", chipSuccess],
  at_risk: ["At risk", "Berisiko", chipWarn],
  action: ["Action required", "Tindakan diperlukan", chipDanger],
  missed: ["Below target", "Bawah sasaran", chipWarn],
};
const statusChip = (s: Status) => <span className={STATUS[s][2]}>{L(STATUS[s][0], STATUS[s][1])}</span>;
const CHECKPOINT: Record<Week["checkpoint"], [string, string]> = {
  planning: ["Planning - Monday's plan, no judgement yet", "Perancangan - pelan Isnin, belum dinilai"],
  early_warning: ["Early warning - from mid-week", "Amaran awal - dari pertengahan minggu"],
  review: ["Weekly review", "Semakan mingguan"],
  final: ["Final - the week has ended", "Muktamad - minggu telah tamat"],
};
const PLAN: Record<string, [string, string, string]> = {
  draft: ["Plan drafted", "Pelan dideraf", chipNeutral], submitted: ["Plan submitted", "Pelan dihantar", chipInfo],
  approved: ["Plan approved", "Pelan diluluskan", chipSuccess], returned: ["Plan returned", "Pelan dikembalikan", chipWarn],
};
const ACTIONS: [string, string, string][] = [
  ["quotations", "Prioritise high-potential open quotations", "Utamakan sebut harga terbuka berpotensi tinggi"],
  ["leads", "Follow up existing qualified leads", "Susuli petunjuk layak sedia ada"],
  ["renewals", "Contact customers about genuine renewals", "Hubungi pelanggan tentang pembaharuan sebenar"],
  ["smaller_package", "Offer a smaller approved package", "Tawarkan pakej kecil yang diluluskan"],
  ["pricing_review", "Review objections and pricing with management", "Semak bantahan dan harga dengan pengurusan"],
  ["new_channel", "Develop another prospecting channel", "Bangunkan saluran prospek lain"],
  ["own", "My own action", "Tindakan saya sendiri"],
];
const actionWord = (k: string) => { const a = ACTIONS.find((x) => x[0] === k); return a ? L(a[1], a[2]) : k; };
const needsPlan = (r: WeekRow) => r.status === "at_risk" || r.status === "action" || r.status === "missed" || Boolean(r.plan);

/* ------------------------------------------------------------------ */

function Progress({ r }: { r: WeekRow }) {
  if (r.target_cents === null) {
    return (
      <div className={css.target}>
        <p className={css.notSet}>{L("Target not set", "Sasaran belum ditetapkan")}</p>
        <p className={css.sub}>{L("No weekly target has been approved for this week. The figures below are what happened, not a goal.", "Tiada sasaran mingguan diluluskan untuk minggu ini. Angka di bawah ialah apa yang berlaku, bukan matlamat.")} <strong>{fmtRM(r.basis_cents)}</strong> {L("collected", "dikutip")}.</p>
      </div>
    );
  }
  const pct = Math.min(100, r.pct ?? 0);
  const expPct = r.expected_cents !== null && r.target_cents ? Math.min(100, Math.round((r.expected_cents / r.target_cents) * 100)) : null;
  return (
    <div className={css.target}>
      <div className={css.targetTop}>
        <span><span className={css.big}>{fmtRM(r.basis_cents)}</span> <span className={css.of}>/ {fmtRM(r.target_cents)}</span></span>
        <span>{statusChip(r.status)} <strong>{r.pct ?? 0}%</strong></span>
      </div>
      <span className={css.bar} role="img" aria-label={L(`${r.pct}% of the weekly target`, `${r.pct}% daripada sasaran mingguan`)}><span style={{ width: `${pct}%` }} />{expPct !== null && r.status !== "achieved" && <i style={{ left: `${expPct}%` }} title={L("Expected by now", "Dijangka setakat ini")} />}</span>
      <span className={css.facts}>
        <span>{L("Gap", "Baki")} <strong>{fmtRM(r.gap_cents ?? 0)}</strong></span>
        {r.expected_cents !== null && r.status !== "missed" && <span>{L("Expected by now", "Dijangka setakat ini")} <strong>{fmtRM(r.expected_cents)}</strong></span>}
        <span>{L("Working days", "Hari bekerja")} <strong>{r.elapsed_days} / {r.working_days}</strong></span>
        <span>{L(`Set from ${dmy(r.target_from)}${r.target_set_by ? ` by ${r.target_set_by}` : ""}`, `Ditetapkan dari ${dmy(r.target_from)}${r.target_set_by ? ` oleh ${r.target_set_by}` : ""}`)}</span>
      </span>
      {r.final && r.final.changed_cents !== 0 && <p className={`${css.note} ${css.warnNote}`}>{L(`Final result ${fmtRM(r.final.basis_cents)}; the records have changed by ${fmtRM(r.final.changed_cents)} since the week was finalised.`, `Keputusan muktamad ${fmtRM(r.final.basis_cents)}; rekod berubah ${fmtRM(r.final.changed_cents)} sejak dimuktamadkan.`)}</p>}
    </div>
  );
}

function Figures({ r }: { r: WeekRow }) {
  const results: [string, string, string][] = [
    [L("Collected", "Dikutip"), fmtRM(r.basis_cents), L(`${r.paid_invoices} invoice(s) paid in full`, `${r.paid_invoices} invois dibayar penuh`)],
    [L("Confirmed by CEO/COO", "Disahkan CEO/COO"), fmtRM(r.confirmed_cents), L(`${r.confirmed_invoices} confirmed`, `${r.confirmed_invoices} disahkan`)],
    [L("Deals won", "Jualan dimenangi"), String(r.won.n), fmtRM(r.won.cents)],
    [L("Commission", "Komisen"), L("Waiting for the policy", "Menunggu polisi"), L("Counts confirmed invoices only", "Kira invois disahkan sahaja")],
  ];
  const activity: [string, string, string][] = [
    [L("Follow-ups done", "Susulan dibuat"), String(r.followups_done), L(`${r.followups_overdue} overdue`, `${r.followups_overdue} lewat`)],
    [L("Quotations sent", "Sebut harga dihantar"), String(r.quotations.n), fmtRM(r.quotations.cents)],
    [L("Open quotations", "Sebut harga terbuka"), String(r.open_quotations.n), fmtRM(r.open_quotations.cents)],
    [L("Sales tasks", "Tugasan jualan"), L(`${r.tasks.done} done`, `${r.tasks.done} selesai`), L(`${r.tasks.open} open · ${r.tasks.overdue} overdue`, `${r.tasks.open} terbuka · ${r.tasks.overdue} lewat`)],
    ...(r.enquiries !== null ? [[L("Enquiries taken", "Pertanyaan diambil"), String(r.enquiries), L("assigned to you this week", "diberikan minggu ini")] as [string, string, string]] : []),
    [L("New customers", "Pelanggan baharu"), String(r.new_customers), L("added this week", "ditambah minggu ini")],
  ];
  return (
    <div className={css.wrap}>
      <div><p className={css.groupLabel}>{L("Results - depend on payment", "Keputusan - bergantung pada bayaran")}</p>
        <ul className={css.grid}>{results.map(([k, v, s]) => <li key={k}><span>{k}</span><strong>{v}</strong><span>{s}</span></li>)}</ul></div>
      <div><p className={css.groupLabel}>{L("Activity - within the consultant's control", "Aktiviti - dalam kawalan perunding")}</p>
        <ul className={css.grid}>{activity.map(([k, v, s]) => <li key={k}><span>{k}</span><strong>{v}</strong><span>{s}</span></li>)}</ul></div>
    </div>
  );
}

/* ---- the recovery plan: facts first, the consultant's own actions, the review ---- */
interface PlanResp {
  week: { from: string; to: string; today: string }; user: { id: number; name: string }; figures: WeekRow; can_edit: boolean; can_review: boolean;
  plan: { id: number; status: string; actions: { key: string; text: string; task_id?: number }[]; note: string | null; review_note: string | null; reviewer: string | null } | null;
  facts: {
    quotations: { id: number; doc_number: string; company: string | null; total_cents: number; valid_until: string | null; customer_id: number | null }[];
    no_next_action: { id: number; company: string }[];
    overdue_followups: { id: number; customer_id: number; company: string | null; due_on: string; note: string }[];
    open_tasks: { id: number; title: string; deadline: string | null; status: string; priority: string }[];
  };
}
function PlanDrawer({ userId, week, onClose, onSaved }: { userId: number | null; week: string; onClose: () => void; onSaved: () => void }) {
  const key = `${userId}|${week}`;
  const [got, setGot] = useState<{ key: string; d: PlanResp | null; e: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [actions, setActions] = useState<{ key: string; text: string; task_id?: number }[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<Record<number, { on: boolean; deadline: string; priority: string }>>({});
  const [review, setReview] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  useEffect(() => {
    if (userId === null) return;
    const c = new AbortController();
    void api<PlanResp>(`/sales/week/plan?week=${week}&user_id=${userId}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      setGot({ key, d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) });
      if (r.ok && r.data) { setActions(r.data.plan?.actions ?? []); setNote(r.data.plan?.note ?? ""); }
    });
    return () => c.abort();
  }, [userId, week, key, tick]);
  const mine = got?.key === key ? got : null;
  const d = mine?.d ?? null;
  const save = async (submit: boolean) => {
    setBusy(true); setError("");
    const r = await api(`/sales/week/plan?week=${week}`, { method: "PUT", body: JSON.stringify({ actions: actions.filter((a) => a.text.trim()), note, submit }) });
    setBusy(false);
    if (r.ok) { toast(submit ? L("Plan submitted", "Pelan dihantar") : L("Draft saved", "Draf disimpan"), submit ? L("Your manager reviews it next", "Pengurus anda akan menyemaknya") : ""); setTick((t) => t + 1); onSaved(); }
    else setError(message(r));
  };
  const decide = async (decision: "approve" | "return") => {
    if (!d?.plan) return;
    setBusy(true); setError("");
    const tasks = Object.entries(pick).filter(([, v]) => v.on).map(([i, v]) => ({ index: Number(i), deadline: v.deadline || undefined, priority: v.priority }));
    const r = await api<{ tasks?: number[] }>(`/sales/week/plan/${d.plan.id}/review`, { method: "POST", body: JSON.stringify({ decision, note: review, tasks }) });
    setBusy(false);
    if (r.ok) { toast(decision === "approve" ? L("Plan approved", "Pelan diluluskan") : L("Plan returned", "Pelan dikembalikan"), decision === "approve" ? L(`${r.data?.tasks?.length ?? 0} task(s) assigned in Tasks`, `${r.data?.tasks?.length ?? 0} tugasan diberikan dalam Tugasan`) : L("With your note", "Dengan nota anda")); setTick((t) => t + 1); onSaved(); }
    else setError(message(r));
  };
  const f = d?.figures;
  return (
    <SideDrawer open={userId !== null} onClose={onClose} wide title={L("Sales recovery plan", "Pelan pemulihan jualan")} subtitle={d ? `${d.user.name} · ${dmy(d.week.from)} – ${dmy(d.week.to)}` : undefined}>
      {toastNode}
      {mine?.e ? <p role="alert" className={css.error}>{mine.e}</p> : !d || !f ? <SkelRows rows={8} /> : (
        <div className={css.drawerBody}>
          <p className={css.note}>{f.target_cents === null ? L("No weekly target is set, so there is no gap to recover - the plan can still list next steps.", "Tiada sasaran mingguan, jadi tiada baki untuk dipulihkan - pelan masih boleh menyenaraikan langkah seterusnya.")
            : L(`Target ${fmtRM(f.target_cents)} · collected ${fmtRM(f.basis_cents)} · gap ${fmtRM(f.gap_cents ?? 0)}. These are facts from the records; the plan does not promise a sale.`, `Sasaran ${fmtRM(f.target_cents)} · dikutip ${fmtRM(f.basis_cents)} · baki ${fmtRM(f.gap_cents ?? 0)}. Ini fakta daripada rekod; pelan tidak menjanjikan jualan.`)} {statusChip(f.status)}</p>
          <div className={css.two}>
            <div>
              <p className={css.groupLabel}>{L("Open quotations", "Sebut harga terbuka")}</p>
              {d.facts.quotations.length === 0 ? <p className={css.empty}>{L("None open.", "Tiada.")}</p> : (
                <ul className={css.list}>{d.facts.quotations.map((q) => <li key={q.id}><span className={css.listMain}><strong>{q.doc_number} · {q.company ?? "-"}</strong><span>{q.valid_until ? L(`valid to ${dmy(q.valid_until)}`, `sah hingga ${dmy(q.valid_until)}`) : L("no expiry", "tiada tamat")}</span></span><strong>{fmtRM(q.total_cents)}</strong></li>)}</ul>
              )}
            </div>
            <div>
              <p className={css.groupLabel}>{L("Needs a next step", "Perlu langkah seterusnya")}</p>
              <ul className={css.list}>
                {d.facts.overdue_followups.map((x) => <li key={`f${x.id}`}><span className={css.listMain}><strong>{x.company ?? "-"}</strong><span>{L(`follow-up overdue since ${dmy(x.due_on)}`, `susulan lewat sejak ${dmy(x.due_on)}`)} · {x.note}</span></span></li>)}
                {d.facts.no_next_action.map((x) => <li key={`n${x.id}`}><span className={css.listMain}><strong>{x.company}</strong><span>{L("open quotation, no follow-up planned", "sebut harga terbuka, tiada susulan dirancang")}</span></span></li>)}
                {d.facts.open_tasks.map((x) => <li key={`t${x.id}`}><span className={css.listMain}><strong>{x.title}</strong><span>{L("sales task", "tugasan jualan")} · {x.deadline ? dmy(x.deadline) : L("no due date", "tiada tarikh")}</span></span></li>)}
                {d.facts.overdue_followups.length + d.facts.no_next_action.length + d.facts.open_tasks.length === 0 && <li><span className={css.empty}>{L("Nothing outstanding.", "Tiada yang tertunggak.")}</span></li>}
              </ul>
            </div>
          </div>
          {d.plan?.status === "returned" && d.plan.review_note && <p className={`${css.note} ${css.warnNote}`}>{L("Returned", "Dikembalikan")}{d.plan.reviewer ? ` · ${d.plan.reviewer}` : ""}: {d.plan.review_note}</p>}
          <div>
            <p className={css.groupLabel}>{L("Actions", "Tindakan")} {d.plan && <span className={PLAN[d.plan.status]?.[2] ?? chipNeutral}>{L(PLAN[d.plan.status]?.[0] ?? d.plan.status, PLAN[d.plan.status]?.[1] ?? d.plan.status)}</span>}</p>
            {d.can_edit ? (
              <fieldset className={css.form} disabled={busy}>
                {actions.map((a, i) => (
                  <div key={i} className={css.row}>
                    <label><span className={fieldLabel}>{L("Kind", "Jenis")}</span>
                      <select aria-label={L(`Action ${i + 1} kind`, `Jenis tindakan ${i + 1}`)} className={inputClass} value={a.key} onChange={(e) => setActions((xs) => xs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>{ACTIONS.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}</select></label>
                    <label><span className={fieldLabel}>{L("What exactly", "Apa sebenarnya")}</span>
                      <input aria-label={L(`Action ${i + 1}`, `Tindakan ${i + 1}`)} className={inputClass} maxLength={300} value={a.text} placeholder={L("e.g. Call Kedai Satu about QT-10 on Monday", "cth. Hubungi Kedai Satu tentang QT-10 pada Isnin")} onChange={(e) => setActions((xs) => xs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></label>
                  </div>
                ))}
                <div className={css.formRow}><button type="button" className={btnSm} onClick={() => setActions((xs) => [...xs, { key: "quotations", text: "" }])} disabled={actions.length >= 12}><AppIcon name="add" />{L("Add an action", "Tambah tindakan")}</button></div>
                <label>{L("Note for your manager (optional)", "Nota untuk pengurus (pilihan)")}<textarea className={inputClass} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} /></label>
                <div className={css.formRow}>
                  <button type="button" className={btnSm} onClick={() => void save(false)}>{L("Save draft", "Simpan draf")}</button>
                  <button type="button" className={btnClass} disabled={!actions.some((a) => a.text.trim().length >= 3)} onClick={() => void save(true)}><AppIcon name="save" />{L("Submit for review", "Hantar untuk semakan")}</button>
                </div>
                <p className={css.sub}>{L("Nothing is sent to a customer. Your manager approves which actions become tasks.", "Tiada apa dihantar kepada pelanggan. Pengurus anda meluluskan tindakan yang menjadi tugasan.")}</p>
              </fieldset>
            ) : (d.plan?.actions ?? []).length === 0 ? <p className={css.empty}>{L("No plan yet.", "Belum ada pelan.")}</p> : (
              <ul className={css.list}>
                {d.plan!.actions.map((a, i) => (
                  <li key={i}>
                    <span className={css.listMain}><strong>{a.text}</strong><span>{actionWord(a.key)}{a.task_id ? ` · ${L(`task #${a.task_id}`, `tugasan #${a.task_id}`)}` : ""}</span></span>
                    {d.can_review && d.plan!.status === "submitted" && !a.task_id && (
                      <span className={css.formRow}>
                        <label className={css.check}><input type="checkbox" checked={pick[i]?.on ?? false} onChange={(e) => setPick((p) => ({ ...p, [i]: { deadline: p[i]?.deadline ?? addDays(mytToday(), 3), priority: p[i]?.priority ?? "normal", on: e.target.checked } }))} />{L("Make a task", "Jadikan tugasan")}</label>
                        {pick[i]?.on && <input type="date" aria-label={L(`Due date for action ${i + 1}`, `Tarikh akhir tindakan ${i + 1}`)} className={inputClass} value={pick[i].deadline} onChange={(e) => setPick((p) => ({ ...p, [i]: { ...p[i]!, deadline: e.target.value } }))} />}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {d.plan?.note && !d.can_edit && <p className={css.note}>{d.plan.note}</p>}
          </div>
          {d.can_review && d.plan?.status === "submitted" && (
            <fieldset className={css.form} disabled={busy}>
              <label>{L("Your note", "Nota anda")}<textarea aria-label={L("Review note", "Nota semakan")} className={inputClass} value={review} maxLength={1000} onChange={(e) => setReview(e.target.value)} /></label>
              <div className={css.formRow}>
                <button type="button" className={btnClass} onClick={() => void decide("approve")}><AppIcon name="success" />{L("Approve - assign the ticked tasks", "Luluskan - beri tugasan yang ditanda")}</button>
                <button type="button" className={btnSm} disabled={review.trim().length < 8} onClick={() => void decide("return")}>{L("Return with note", "Kembalikan dengan nota")}</button>
              </div>
              <p className={css.sub}>{L("Each ticked action becomes one task in Tasks for this person, linked to this plan. Approving again never duplicates a task.", "Setiap tindakan yang ditanda menjadi satu tugasan dalam Tugasan, dipautkan ke pelan ini. Meluluskan semula tidak menggandakan tugasan.")}</p>
            </fieldset>
          )}
          {error && <p role="alert" className={css.error}>{error}</p>}
        </div>
      )}
    </SideDrawer>
  );
}

/* ---- set targets (CEO, COO, super admin) ---- */
interface TargetsResp { week: { from: string; to: string; start_dow: number }; can_set: boolean; people: { id: number; name: string; role: string; target_cents: number | null; from: string | null; set_by: string | null }[]; company: { target_cents: number | null; from: string | null }; history: { id: number; scope: string; person: string | null; week_from: string; target_cents: number | null; reason: string; set_by_name: string | null; created_at: string }[] }
function TargetsDrawer({ week, onClose, onSaved }: { week: string; onClose: () => void; onSaved: () => void }) {
  const [got, setGot] = useState<{ d: TargetsResp | null; e: string } | null>(null);
  const [tick, setTick] = useState(0);
  const [who, setWho] = useState<string>("company");
  const [amount, setAmount] = useState("");
  const [none, setNone] = useState(false);
  const [from, setFrom] = useState(week);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { show: toast, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    void api<TargetsResp>(`/sales/week/targets?week=${week}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [week, tick]);
  const d = got?.d;
  const save = async () => {
    setBusy(true); setError("");
    const body = { scope: who === "company" ? "company" : "person", user_id: who === "company" ? undefined : Number(who), week_from: from, target_cents: none ? null : Math.round(Number(amount) * 100), reason };
    const r = await api(`/sales/week/targets`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast(L("Target saved", "Sasaran disimpan"), L("From that week on; the previous one stays in the history", "Mulai minggu itu; yang lama kekal dalam sejarah")); setReason(""); setAmount(""); setTick((t) => t + 1); onSaved(); }
    else setError(message(r));
  };
  return (
    <SideDrawer open onClose={onClose} wide title={L("Weekly sales targets", "Sasaran jualan mingguan")} subtitle={L("Set by the CEO, COO or super admin, with a reason. A change applies from the week you choose; earlier weeks keep theirs.", "Ditetapkan oleh CEO, COO atau super admin, dengan sebab. Perubahan berkuat kuasa dari minggu yang dipilih.")}>
      {toastNode}
      {got?.e ? <p role="alert" className={css.error}>{got.e}</p> : !d ? <SkelRows rows={8} /> : (
        <div className={css.drawerBody}>
          <div>
            <p className={css.groupLabel}>{L(`In force for the week of ${dmy(d.week.from)}`, `Berkuat kuasa untuk minggu ${dmy(d.week.from)}`)}</p>
            <div className={css.targetRow}><strong>{L("Company", "Syarikat")}</strong><span>{d.company.target_cents === null ? L("Target not set", "Belum ditetapkan") : fmtRM(d.company.target_cents)}</span><span className={css.sub}>{d.company.from ? dmy(d.company.from) : ""}</span></div>
            {d.people.map((p) => <div key={p.id} className={css.targetRow}><span>{p.name}</span><span>{p.target_cents === null ? L("Target not set", "Belum ditetapkan") : fmtRM(p.target_cents)}</span><span className={css.sub}>{p.from ? dmy(p.from) : ""}</span></div>)}
          </div>
          {d.can_set ? (
            <fieldset className={css.form} disabled={busy}>
              <p className={css.groupLabel}>{L("Set or change a target", "Tetapkan atau ubah sasaran")}</p>
              <div className={css.row}>
                <label>{L("For", "Untuk")}<select aria-label={L("Target for", "Sasaran untuk")} className={inputClass} value={who} onChange={(e) => setWho(e.target.value)}><option value="company">{L("The company", "Syarikat")}</option>{d.people.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}</select></label>
                <label>{L("From the week starting", "Mulai minggu bermula")}<input type="date" aria-label={L("Target from", "Sasaran mulai")} className={inputClass} step={7} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              </div>
              <div className={css.row}>
                <label>{L("Amount (RM)", "Jumlah (RM)")}<input type="number" aria-label={L("Target amount", "Jumlah sasaran")} min="0" step="0.01" className={inputClass} disabled={none} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                <label className={css.check}><input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} />{L("No target from this week (e.g. long leave)", "Tiada sasaran mulai minggu ini (cth. cuti panjang)")}</label>
              </div>
              <label>{L("Reason", "Sebab")}<textarea aria-label={L("Target reason", "Sebab sasaran")} className={inputClass} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <p className={css.sub}>{L("Leave and short weeks are already allowed for: the expectation counts working days, less public holidays and approved leave.", "Cuti dan minggu pendek sudah diambil kira: jangkaan mengira hari bekerja, tolak cuti umum dan cuti diluluskan.")}</p>
              <div className={css.formRow}><button type="button" className={btnClass} disabled={reason.trim().length < 8 || (!none && !(Number(amount) > 0))} onClick={() => void save()}><AppIcon name="save" />{L("Save target", "Simpan sasaran")}</button></div>
              {error && <p role="alert" className={css.error}>{error}</p>}
            </fieldset>
          ) : <p className={css.note}>{L("Only the CEO, COO or super admin sets weekly targets. You can read them here.", "Hanya CEO, COO atau super admin menetapkan sasaran mingguan.")}</p>}
          <div>
            <p className={css.groupLabel}>{L("History", "Sejarah")}</p>
            {d.history.length === 0 ? <p className={css.empty}>{L("No weekly target has been set yet.", "Belum ada sasaran mingguan.")}</p> : (
              <ul className={css.list}>{d.history.map((h) => <li key={h.id}><span className={css.listMain}><strong>{h.scope === "company" ? L("Company", "Syarikat") : h.person ?? "-"} · {h.target_cents === null ? L("not set", "tiada") : fmtRM(h.target_cents)} {L("from", "mulai")} {dmy(h.week_from)}</strong><span>{h.set_by_name ?? "-"} · {dmy(h.created_at.slice(0, 10))} · {h.reason}</span></span></li>)}</ul>
            )}
          </div>
        </div>
      )}
    </SideDrawer>
  );
}

/* ---- assign a sales task through the existing Tasks ---- */
function AssignTask({ person, week, onClose, onSaved }: { person: { id: number; name: string }; week: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const [facts, setFacts] = useState<PlanResp["facts"] | null | undefined>(undefined); // undefined = still loading; null = could not load (a task with no record still works)
  const [title, setTitle] = useState(""), [link, setLink] = useState(""), [deadline, setDeadline] = useState(addDays(mytToday(), 2)), [priority, setPriority] = useState("normal"), [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void api<PlanResp>(`/sales/week/plan?week=${week}&user_id=${person.id}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setFacts(r.ok && r.data ? r.data.facts : null); });
    return () => c.abort();
  }, [person.id, week]);
  const save = async () => {
    setBusy(true); setError("");
    const [kind, id] = link ? link.split(":") : [null, null];
    const r = await api<{ id?: number; existing?: boolean }>(`/tasks`, { method: "POST", body: JSON.stringify({ title, description: desc || undefined, assigned_to: person.id, priority, deadline, ...(kind ? { link_kind: kind, link_id: Number(id) } : {}) }) });
    setBusy(false);
    if (r.ok) onSaved(r.data?.existing ? L(`${person.name} already has an open task for that record (#${r.data.id}) - no duplicate made`, `${person.name} sudah ada tugasan terbuka untuk rekod itu (#${r.data.id})`) : L(`Task assigned to ${person.name} - it is in Tasks`, `Tugasan diberikan kepada ${person.name} - ada dalam Tugasan`));
    else setError(message(r));
  };
  return (
    <SideDrawer open onClose={onClose} title={L("Assign a sales task", "Beri tugasan jualan")} subtitle={L(`${person.name} · it goes into Tasks, linked to the record`, `${person.name} · masuk ke Tugasan, dipautkan ke rekod`)}>
      <fieldset className={css.form} disabled={busy}>
        <label>{L("Task", "Tugasan")}<input aria-label={L("Task title", "Tajuk tugasan")} className={inputClass} maxLength={200} value={title} placeholder={L("e.g. Follow up QT-10 with the owner", "cth. Susuli QT-10 dengan pemilik")} onChange={(e) => setTitle(e.target.value)} /></label>
        {facts === undefined ? <SkelRows rows={1} /> : <label>{L("About", "Berkenaan")}<select aria-label={L("Linked record", "Rekod dipautkan")} className={inputClass} value={link} onChange={(e) => setLink(e.target.value)}>
          <option value="">{L("No specific record (e.g. find new prospects)", "Tiada rekod khusus (cth. cari prospek baharu)")}</option>
          {facts?.quotations.map((q) => <option key={`q${q.id}`} value={`quotation:${q.id}`}>{L("Quotation", "Sebut harga")} {q.doc_number} · {q.company ?? "-"} · {fmtRM(q.total_cents)}</option>)}
          {[...new Map([...(facts?.no_next_action ?? []).map((c) => [c.id, c.company] as const), ...(facts?.overdue_followups ?? []).map((f) => [f.customer_id, f.company ?? "-"] as const)]).entries()].map(([id, name]) => <option key={`c${id}`} value={`customer:${id}`}>{L("Customer", "Pelanggan")} {name}</option>)}
        </select></label>}
        <div className={css.row}>
          <label>{L("Priority", "Keutamaan")}<select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value)}><option value="low">{L("Low", "Rendah")}</option><option value="normal">{L("Normal", "Biasa")}</option><option value="high">{L("High", "Tinggi")}</option><option value="urgent">{L("Urgent", "Segera")}</option></select></label>
          <label>{L("Due", "Tarikh akhir")}<input type="date" className={inputClass} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
        </div>
        <label>{L("Outcome expected", "Hasil dijangka")}<textarea className={inputClass} maxLength={5000} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <div className={css.formRow}><button type="button" className={btnClass} disabled={title.trim().length < 3} onClick={() => void save()}><AppIcon name="save" />{L("Assign task", "Beri tugasan")}</button></div>
        <p className={css.sub}>{L("One open task per person and record: assigning the same record again opens the existing task.", "Satu tugasan terbuka bagi setiap orang dan rekod.")}</p>
        {error && <p role="alert" className={css.error}>{error}</p>}
      </fieldset>
    </SideDrawer>
  );
}

/* ------------------------------------------------------------------ */

export function WeeklySales({ scope, fallback }: { scope: "mine" | "all"; fallback?: ReactNode }) {
  const [week, setWeek] = useState<string>("");
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const key = `${scope}|${week}|${revision}`;
  const [got, setGot] = useState<{ key: string; d: WeekResp | null; status: number; e: string } | null>(null);
  const [plan, setPlan] = useState<number | null>(null);
  const [person, setPerson] = useState<WeekRow | null>(null);
  const [targets, setTargets] = useState(false);
  const [assign, setAssign] = useState<{ id: number; name: string } | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();
  useEffect(() => {
    const c = new AbortController();
    const [s, w] = key.split("|");
    void api<WeekResp>(`/sales/week?scope=${s}${w ? `&week=${w}` : ""}`, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ key, d: r.ok && r.data ? r.data : null, status: r.status, e: r.ok ? "" : message(r) }); });
    return () => c.abort();
  }, [key]);
  const mine = got?.key === key ? got : null;
  /* an older worker without the weekly route: the card it already had */
  if (mine && !mine.d && mine.status === 404) return <>{fallback ?? null}</>;
  const d = mine?.d;
  const w = d?.week;
  const nav = w && (
    <span className={css.weekNav}>
      <button type="button" className={btnSm} aria-label={L("Previous week", "Minggu sebelumnya")} onClick={() => setWeek(addDays(w.from, -7))}><AppIcon name="previous" /></button>
      <span>{dmy(w.from)} – {dmy(w.to)}</span>
      <button type="button" className={btnSm} aria-label={L("Next week", "Minggu seterusnya")} disabled={w.to >= w.today} onClick={() => setWeek(addDays(w.from, 7))}><AppIcon name="next" /></button>
    </span>
  );
  return (
    <section className={card} aria-label={L("This week", "Minggu ini")}>
      {toastNode}
      <div className={css.head}>
        <div>
          <PanelTitle icon="target">{d?.scope === "all" ? L("Weekly sales - the team", "Jualan mingguan - pasukan") : L("My weekly target", "Sasaran mingguan saya")}</PanelTitle>
          {w && <p className={css.sub}>{L(CHECKPOINT[w.checkpoint][0], CHECKPOINT[w.checkpoint][1])} · {L("Collected = invoices paid in full, by closer", "Dikutip = invois dibayar penuh, mengikut penutup")}</p>}
        </div>
        <div className={css.tools}>
          {nav}
          {d?.scope === "all" && <button type="button" className={d.can_set ? btnSmPrimary : btnSm} onClick={() => setTargets(true)}><AppIcon name="target" />{d.can_set ? L("Set targets", "Tetapkan sasaran") : L("Targets", "Sasaran")}</button>}
        </div>
      </div>
      {mine?.e ? <p role="alert" className={css.error}>{mine.e}</p> : !d ? <SkelRows rows={6} /> : d.scope === "mine" && d.me ? (
        <div className={css.wrap}>
          <Progress r={d.me} />
          <Figures r={d.me} />
          <div className={css.formRow}>
            {needsPlan(d.me) ? <button type="button" className={d.me.plan ? btnSm : btnSmPrimary} onClick={() => setPlan(d.me!.user_id)}><AppIcon name="idea" />{d.me.plan ? `${L("Recovery plan", "Pelan pemulihan")} · ${L(PLAN[d.me.plan.status]?.[0] ?? "", PLAN[d.me.plan.status]?.[1] ?? "")}` : L("Prepare a recovery plan", "Sediakan pelan pemulihan")}</button>
              : <span className={css.sub}>{L("A recovery plan opens here if the week falls behind.", "Pelan pemulihan dibuka di sini jika minggu ketinggalan.")}</span>}
            <span className={css.sub}>{L(`Sales tasks: ${d.me.tasks.open} open, ${d.me.tasks.done} done — in Tasks`, `Tugasan jualan: ${d.me.tasks.open} terbuka, ${d.me.tasks.done} selesai — dalam Tugasan`)}</span>
          </div>
        </div>
      ) : d.scope === "all" && d.rows ? (
        <div className={css.wrap}>
          {d.company && (
            <div className={css.target}>
              <div className={css.targetTop}>
                <span><span className={css.big}>{fmtRM(d.company.basis_cents)}</span> <span className={css.of}>{d.company.target_cents === null ? L("· company target not set", "· sasaran syarikat belum ditetapkan") : `/ ${fmtRM(d.company.target_cents)}`}</span></span>
                {d.company.pct !== null && <strong>{d.company.pct}%</strong>}
              </div>
              {d.company.target_cents !== null && <span className={css.bar} role="img" aria-label={L(`${d.company.pct}% of the company target`, `${d.company.pct}% daripada sasaran syarikat`)}><span style={{ width: `${Math.min(100, d.company.pct ?? 0)}%` }} /></span>}
              <span className={css.facts}><span>{L("Confirmed by CEO/COO", "Disahkan CEO/COO")} <strong>{fmtRM(d.company.confirmed_cents)}</strong></span>{d.company.gap_cents !== null && <span>{L("Gap", "Baki")} <strong>{fmtRM(d.company.gap_cents)}</strong></span>}</span>
            </div>
          )}
          {d.rows.length === 0 ? <p className={css.empty}>{L("No sales consultants yet.", "Belum ada perunding jualan.")}</p> : (
            <>
              <div className={`${css.desk} ${css.tableWrap}`}>
                <table className={css.table} aria-label={L("Staff this week", "Staf minggu ini")}>
                  <thead><tr><th>{L("Consultant", "Perunding")}</th><th className={css.num}>{L("Target", "Sasaran")}</th><th className={css.num}>{L("Collected", "Dikutip")}</th><th>{L("Progress", "Kemajuan")}</th><th className={css.num}>{L("Quotations", "Sebut harga")}</th><th className={css.num}>{L("Won", "Dimenangi")}</th><th className={css.num}>{L("Follow-ups", "Susulan")}</th><th>{L("Status", "Status")}</th><th>{L("Plan", "Pelan")}</th></tr></thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.user_id} onClick={() => setPerson(r)}>
                        <td><strong>{r.name}</strong></td>
                        <td className={css.num}>{r.target_cents === null ? "—" : fmtRM(r.target_cents)}</td>
                        <td className={css.num}>{fmtRM(r.basis_cents)}</td>
                        <td>{r.pct === null ? "—" : <>{r.pct}%<span className={css.mini}><span style={{ width: `${Math.min(100, r.pct)}%` }} /></span></>}</td>
                        <td className={css.num}>{r.quotations.n}</td>
                        <td className={css.num}>{r.won.n}</td>
                        <td className={css.num}>{r.followups_done}{r.followups_overdue ? ` · ${r.followups_overdue} ${L("late", "lewat")}` : ""}</td>
                        <td>{statusChip(r.status)}</td>
                        <td>{r.plan ? <span className={PLAN[r.plan.status]?.[2] ?? chipNeutral}>{L(PLAN[r.plan.status]?.[0] ?? "", PLAN[r.plan.status]?.[1] ?? "")}</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className={css.phone} aria-label={L("Staff this week", "Staf minggu ini")}>
                {d.rows.map((r) => (
                  <li key={r.user_id}><button type="button" onClick={() => setPerson(r)}>
                    <span className={css.cardTop}><strong>{r.name}</strong>{statusChip(r.status)}</span>
                    <span className={css.facts}><span>{fmtRM(r.basis_cents)}{r.target_cents !== null ? ` / ${fmtRM(r.target_cents)}` : ""}</span>{r.pct !== null && <strong>{r.pct}%</strong>}<span>{r.quotations.n} {L("quotations", "sebut harga")}</span>{r.plan && <span>{L(PLAN[r.plan.status]?.[0] ?? "", PLAN[r.plan.status]?.[1] ?? "")}</span>}</span>
                  </button></li>
                ))}
              </ul>
            </>
          )}
          <p className={css.sub}>{L("For managers only. A status is a prompt to help, not a judgement; amounts are sales collected, not anyone's pay.", "Untuk pengurus sahaja. Status ialah gesaan untuk membantu, bukan penilaian; jumlah ialah jualan dikutip, bukan gaji sesiapa.")}</p>
        </div>
      ) : null}

      {person && w && (
        <SideDrawer open onClose={() => setPerson(null)} wide title={person.name} subtitle={`${dmy(w.from)} – ${dmy(w.to)}`}
          footer={<div className={css.formRow}>
            <button type="button" className={btnSmPrimary} onClick={() => setAssign({ id: person.user_id, name: person.name })}><AppIcon name="add" />{L("Assign a sales task", "Beri tugasan jualan")}</button>
            <button type="button" className={btnSm} onClick={() => setPlan(person.user_id)}><AppIcon name="idea" />{person.plan ? L("Open the recovery plan", "Buka pelan pemulihan") : L("Recovery plan", "Pelan pemulihan")}</button>
          </div>}>
          <div className={css.drawerBody}><Progress r={person} /><Figures r={person} /></div>
        </SideDrawer>
      )}
      <PlanDrawer userId={plan} week={w?.from ?? ""} onClose={() => setPlan(null)} onSaved={reload} />
      {targets && w && <TargetsDrawer week={w.from} onClose={() => setTargets(false)} onSaved={reload} />}
      {assign && w && <AssignTask person={assign} week={w.from} onClose={() => setAssign(null)} onSaved={(m) => { setAssign(null); toast(L("Sales task", "Tugasan jualan"), m); reload(); }} />}
    </section>
  );
}
