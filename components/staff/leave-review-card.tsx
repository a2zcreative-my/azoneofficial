"use client";

/**
 * Leave to review — v1.78.0.
 *
 * CEO, 31-08-2026, two requests that turned out to be the same one:
 *
 *   *"for Staff attendance — corrections & back-entry Unpaid leave should not
 *    appear all the list of during that month which is the record should be
 *    recorded into staff table."*
 *
 *   *"in Staff table should appear a list of replacement leave for the staff
 *    that working on weekend which is for me to credit the replacement leave
 *    either half day or full day depend on their in and out time."*
 *
 * Both are per-person leave facts that were living in the wrong place — one
 * as a chip row buried under a form on the Attendance card, the other
 * nowhere at all. Both are also reviewed the same way: once a month, down a
 * list, across everybody. So they share one card at the top of the Staff
 * tab, and the CEO works down it without expanding a single record.
 *
 * WHY REPLACEMENT LEAVE NEEDED BUILDING. `replacement` has been a leave type
 * since the beginning and could only ever be TAKEN — the entitlement editor
 * refuses it in as many words, "counted as taken, not granted". So somebody
 * who worked a Saturday was owed a day the system had no way to give them.
 * Crediting adds to their replacement balance through the CEO-only
 * entitlement lever, and they then apply for it like any other leave.
 *
 * A REST DAY IS THEIR OWN, not Saturday and Sunday: the worker resolves each
 * date against that person's shift pattern (migration 0099), so somebody
 * rostered to work Saturdays does not appear here, and somebody who rests on
 * Wednesday does.
 */

import { useCallback, useEffect, useState } from "react";

import { makeApi } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { dmy } from "@/lib/format";
import { properName } from "@/lib/names";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { card, chipNeutral, chipWarn, inputClass, fieldLabel, btnSm, btnSmPrimary } from "@/lib/ui-styles";

const api = makeApi("/staff");
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** A rest day somebody worked and has not been credited for yet. */
interface RestDay {
  user_id: number;
  name: string;
  position: string | null;
  date: string;
  in_myt: string | null;
  out_myt: string | null;
  minutes: number | null;
  pattern: string;
  /** The worker's suggestion from the hours clocked — never a decision. */
  suggest: number;
}

/** A day recorded as unpaid, as the Attendance card records them. */
interface UnpaidDay {
  id: number;
  user_id: number;
  name: string;
  full_name: string | null;
  d: string;
  days: number | null;
  reason: string | null;
  /** 1 = recorded by management, so it can be undone here. */
  recorded_direct: number;
}

const thisMonth = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);

/** "7h 45m" — the evidence the half-or-full decision is made on. */
const hm = (mins: number | null) =>
  mins === null ? "—" : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;

export function LeaveReviewCard({ role = "" }: { role?: string }) {
  /* Both halves of this card are CEO-only on the server (`leave_entitlement`
     credits, `unpaid_leave` undoes). A button that 403s is worse than no
     button, so the card does not render for anyone else. */
  const canReview = ["ceo", "super_admin"].includes(role);

  const [month, setMonth] = useState(thisMonth);
  const [rest, setRest] = useState<RestDay[] | null>(null);
  const [unpaid, setUnpaid] = useState<UnpaidDay[] | null>(null);
  const [busy, setBusy] = useState("");
  const { show: showToast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();

  const load = useCallback(async () => {
    if (!canReview) return;
    const [r, u] = await Promise.all([
      api<{ staff?: RestDay[] }>(`/rest-day-work?month=${month}`),
      api<{ days?: UnpaidDay[]; unpaid?: UnpaidDay[] }>(`/attendance/unpaid?month=${month}`),
    ]);
    /* Both settle to an array even when the request failed, so the skeleton
       always ends. A skeleton that never finishes is worse than a message. */
    setRest(r.data?.staff ?? []);
    setUnpaid(u.data?.days ?? u.data?.unpaid ?? []);
  }, [month, canReview]);

  useEffect(() => { void load(); }, [load]);

  if (!canReview) return null;

  const credit = async (r: RestDay, days: number) => {
    setBusy(`${r.user_id}|${r.date}`);
    const res = await api<{ error?: { message?: string } }>(`/replacement-credit`, {
      method: "POST",
      body: JSON.stringify({ user_id: r.user_id, date: r.date, days }),
    });
    setBusy("");
    showToast(
      res.ok ? L("Credited", "Dikreditkan") : L("Not credited", "Tidak dikreditkan"),
      res.ok
        ? L(`${properName(r.name)} — ${days === 1 ? "a full day" : "half a day"} of replacement leave for ${dmy(r.date)}. They have been notified.`,
            `${properName(r.name)} — ${days === 1 ? "sehari penuh" : "setengah hari"} cuti gantian bagi ${dmy(r.date)}. Mereka telah dimaklumkan.`)
        : (res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya")),
      res.ok ? undefined : "notice",
    );
    if (res.ok) void load();
  };

  const undoUnpaid = async (u: UnpaidDay) => {
    const who = properName(u.full_name || u.name);
    if (!(await confirm({
      title: L(`Undo the unpaid day for ${who}?`, `Batalkan hari tanpa gaji untuk ${who}?`),
      message: L(
        `${dmy(u.d)} stops being deducted from their pay, and they are told. Press Recompute nets on the Payroll tab afterwards so a saved payslip picks it up.`,
        `${dmy(u.d)} tidak lagi dipotong daripada gaji mereka, dan mereka dimaklumkan. Tekan Kira semula bersih pada tab Gaji selepas ini supaya slip gaji yang disimpan mengambilnya.`,
      ),
      confirmLabel: L("Undo", "Buat asal"), variant: "danger",
    }))) return;
    const res = await api<{ error?: { message?: string } }>(`/attendance/unpaid?id=${u.id}`, { method: "DELETE" });
    showToast(
      res.ok ? L("Undone", "Dibatalkan") : L("Not undone", "Tidak dibatalkan"),
      res.ok
        ? L(`${dmy(u.d)} is paid again for ${who}.`, `${dmy(u.d)} dibayar semula untuk ${who}.`)
        : (res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya")),
      res.ok ? undefined : "notice",
    );
    if (res.ok) void load();
  };

  const loading = rest === null || unpaid === null;

  return (
    <div className={card}>
      {toastNode}{confirmNode}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{L("Leave to review", "Cuti untuk semakan")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "Weekend and rest-day work waiting to be credited back as replacement leave, and the unpaid days recorded this month. Both are CEO decisions and both are audited.",
              "Kerja hujung minggu dan hari rehat yang menunggu untuk dikreditkan sebagai cuti gantian, dan hari tanpa gaji yang direkodkan bulan ini. Kedua-duanya keputusan CEO dan kedua-duanya diaudit.",
            )}
          </p>
        </div>
        <label className="shrink-0">
          <span className={fieldLabel}>{L("Month", "Bulan")}</span>
          <input type="month" className={inputClass} value={month}
            onChange={(e) => setMonth(e.target.value || thisMonth())} />
        </label>
      </div>

      {/* ---------- replacement leave ---------- */}
      <p className="text-muted-foreground mt-4 text-[11px] font-semibold tracking-wide uppercase">
        {L("Worked a rest day — credit replacement leave", "Bekerja pada hari rehat — kredit cuti gantian")}
      </p>

      {/* v1.78.0 — skeleton until the first fetch lands. */}
      {loading ? (
        <SkelRows rows={2} className="mt-1" />
      ) : rest.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {L("Nobody worked a rest day this month that is still waiting.", "Tiada sesiapa bekerja pada hari rehat bulan ini yang masih menunggu.")}
        </p>
      ) : (
        <div className="mt-1 space-y-2">
          {rest.map((r) => {
            const k = `${r.user_id}|${r.date}`;
            return (
              <div key={k} className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{properName(r.name)}</span>
                  <span className="text-muted-foreground block text-xs">
                    {dmy(r.date)}
                    {r.position ? ` · ${r.position}` : ""}
                    {" · "}
                    {/* The in and out time, which is what the CEO said the
                        half-or-full decision depends on. */}
                    {r.in_myt ?? "—"}–{r.out_myt ?? L("no clock-out", "tiada daftar keluar")}
                    {" · "}{hm(r.minutes)}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[11px]">
                    {L(`Rest day on ${r.pattern}`, `Hari rehat pada ${r.pattern}`)}
                  </span>
                </span>
                <span className={r.suggest === 1 ? chipNeutral : chipWarn}>
                  {r.suggest === 1
                    ? L("a full day suggested", "sehari penuh dicadangkan")
                    : L("half a day suggested", "setengah hari dicadangkan")}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button type="button" className={btnSm} disabled={busy === k}
                    onClick={() => void credit(r, 0.5)}>
                    {L("Half day", "Setengah hari")}
                  </button>
                  <button type="button" className={btnSmPrimary} disabled={busy === k}
                    onClick={() => void credit(r, 1)}>
                    {L("Full day", "Sehari penuh")}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- unpaid days ---------- */}
      <p className="text-muted-foreground mt-5 text-[11px] font-semibold tracking-wide uppercase">
        {L("Unpaid days recorded this month", "Hari tanpa gaji direkodkan bulan ini")}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {L(
          "Recorded on the Attendance tab. Each one deducts a day at the statutory rate. Undo returns it to paid.",
          "Direkodkan pada tab Kehadiran. Setiap satu memotong sehari pada kadar statutori. Buat asal mengembalikannya kepada berbayar.",
        )}
      </p>

      {loading ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {Array.from({ length: 3 }, (_, i) => <Skel key={i} className="h-7 w-40 rounded-full" />)}
        </div>
      ) : unpaid.length === 0 ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {L("No unpaid days recorded this month.", "Tiada hari tanpa gaji direkodkan bulan ini.")}
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-2">
          {unpaid.map((u) => (
            <span key={u.id} className="border-border inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
              <span className="font-medium">{properName(u.full_name || u.name)}</span>
              <span className="text-muted-foreground">
                {dmy(u.d)}{u.days && u.days !== 1 ? ` · ${u.days}${L(" day", " hari")}` : ""}
              </span>
              {u.recorded_direct === 1 ? (
                <button type="button"
                  className="text-muted-foreground hover:text-danger leading-none"
                  title={L("Undo — this day stops being deducted", "Buat asal — hari ini tidak lagi dipotong")}
                  aria-label={L("Undo unpaid leave", "Buat asal cuti tanpa gaji")}
                  onClick={() => void undoUnpaid(u)}>
                  ×
                </button>
              ) : (
                /* Applied for by the staff member and approved through the
                   chain. It still deducts, but it is their record, not a
                   management entry, so it is not undone from here. */
                <span className="text-muted-foreground"
                  title={L("Applied for and approved through the leave chain — manage it on the Leave tab", "Dipohon dan diluluskan melalui rantaian cuti — uruskan pada tab Cuti")}>
                  {L("applied", "dipohon")}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
