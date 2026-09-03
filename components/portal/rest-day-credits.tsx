"use client";

/**
 * Rest days worked — credit replacement leave. v1.86.0.
 *
 * CEO, 03-09-2026: *"leave to review should inside the leave and also why
 * looks like Leave applications — whole company like having same function as
 * leave to review? make it minimalist please!"*
 *
 * He is right, and the duplication was mine. This card shipped at v1.78.0
 * with TWO halves, because at the time both were homeless: rest-day work
 * waiting to be credited, and the month's unpaid days as a row of chips.
 *
 * Then v1.83.0 gave the Leave tab a real register — the whole decided
 * history, filtered by month, with Edit and Remove on every row. An unpaid
 * day IS a decided leave record, so from that release the chips were a
 * SECOND view of rows the register already listed, with a second way to
 * delete one. Two lists of the same records is how two screens start
 * disagreeing about what was deducted.
 *
 * So the chips are gone and the register is the one place a leave record
 * lives. What is left here is the half that is NOT a leave record: work that
 * happened and has not become one yet — and it moves to the Leave tab, where
 * the CEO is already standing when he thinks about leave.
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
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
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
/* v1.86.0 - UnpaidDay went with the chips: an unpaid day is a leave
   record, and leave records live in the register on the Leave tab. */

const thisMonth = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);

/** "7h 45m" — the evidence the half-or-full decision is made on. */
const hm = (mins: number | null) =>
  mins === null ? "—" : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;

export function RestDayCreditCard({ role = "" }: { role?: string }) {
  /* Both halves of this card are CEO-only on the server (`leave_entitlement`
     credits, `unpaid_leave` undoes). A button that 403s is worse than no
     button, so the card does not render for anyone else. */
  const canReview = ["ceo", "super_admin"].includes(role);

  const [month, setMonth] = useState(thisMonth);
  const [rest, setRest] = useState<RestDay[] | null>(null);
  const [busy, setBusy] = useState("");
  const { show: showToast, node: toastNode } = useSaveToast();

  const load = useCallback(async () => {
    if (!canReview) return;
    const r = await api<{ staff?: RestDay[] }>(`/rest-day-work?month=${month}`);
    /* Settles to an array even when the request failed, so the skeleton
       always ends. A skeleton that never finishes is worse than a message. */
    setRest(r.data?.staff ?? []);
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

  const loading = rest === null;

  return (
    <div className={card}>
      {toastNode}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{L("Rest days worked — credit replacement leave", "Hari rehat dibekerja — kredit cuti gantian")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "Work on somebody's own rest day, waiting to be credited back as replacement leave. A CEO decision, and audited. Leave records themselves — including unpaid days — are in the register below.",
              "Kerja pada hari rehat seseorang, menunggu untuk dikreditkan sebagai cuti gantian. Keputusan CEO, dan diaudit. Rekod cuti sendiri — termasuk hari tanpa gaji — berada dalam daftar di bawah.",
            )}
          </p>
        </div>
        <label className="shrink-0">
          <span className={fieldLabel}>{L("Month", "Bulan")}</span>
          <input type="month" className={inputClass} value={month}
            onChange={(e) => setMonth(e.target.value || thisMonth())} />
        </label>
      </div>

      {/* One heading, not two: the card is the section now. */}
      <p className="sr-only">
        {L("Worked a rest day", "Bekerja pada hari rehat")}
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

    </div>
  );
}
