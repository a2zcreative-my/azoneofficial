"use client";

/**
 * v1.181.17 - TEAM LEAVE CALENDAR (ERP roadmap, phase 5), on Leave.
 *
 * One month, one row per person on leave, one column per day: approved
 * leave filled, pending leave outlined. The bottom row counts who is away
 * each day and marks a day when two or more people of the same department
 * are away, so a manager sees the clash before approving. A read of
 * leave_requests for team_manage - the roles that decide leave. For anyone
 * else it renders nothing.
 */

import { useEffect, useMemo, useState } from "react";

import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { btnSm, card } from "@/lib/ui-styles";

import css from "./business.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

interface Leave { id: number; user_id: number; name: string; department: string | null; type: string; start_date: string; end_date: string; days: number; status: "approved" | "pending" }
interface Cal { month: string; first: string; last: string; leave: Leave[] }

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MS = ["Januari", "Februari", "Mac", "April", "Mei", "Jun", "Julai", "Ogos", "September", "Oktober", "November", "Disember"];
const shift = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

export function LeaveCalendar() {
  const [month, setMonth] = useState(mytToday().slice(0, 7));
  const [cal, setCal] = useState<Cal | null>(null);
  const [forbidden, setForbidden] = useState(false);
  useEffect(() => {
    let live = true;
    void api<Cal>(`/staff/people/leave-calendar?month=${month}`).then((r) => {
      if (!live) return;
      if (r.status === 403) { setForbidden(true); return; }
      if (r.ok && r.data) setCal(r.data);
    });
    return () => { live = false; };
  }, [month]);

  const grid = useMemo(() => {
    if (!cal || cal.month !== month) return null;
    const n = Number(cal.last.slice(8, 10));
    const days = Array.from({ length: n }, (_, i) => `${cal.month}-${String(i + 1).padStart(2, "0")}`);
    const people = new Map<number, { name: string; department: string | null; spans: Leave[] }>();
    for (const l of cal.leave) {
      const p = people.get(l.user_id) ?? { name: l.name, department: l.department, spans: [] };
      p.spans.push(l); people.set(l.user_id, p);
    }
    const rows = [...people.entries()].map(([id, p]) => ({ id, ...p, cells: days.map((d) => p.spans.find((s) => s.start_date <= d && s.end_date >= d) ?? null) }));
    const away = days.map((_, i) => rows.filter((r) => r.cells[i]).length);
    const clash = days.map((_, i) => {
      const depts = rows.filter((r) => r.cells[i]).map((r) => r.department ?? "");
      return depts.some((dpt, j) => depts.indexOf(dpt) !== j);
    });
    return { days, rows, away, clash };
  }, [cal, month]);

  if (forbidden) return null;
  const name = `${(getLang() === "ms" ? MONTHS_MS : MONTHS_EN)[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  return (
    <div className={card}>
      <div className={css.monthHead}>
        <span className={css.whatTitle}>{L("Team leave", "Cuti pasukan")} · {name}</span>
        <span className={css.monthActions}>
          <button type="button" className={btnSm} aria-label={L("Previous month", "Bulan sebelumnya")} onClick={() => setMonth((m) => shift(m, -1))}>‹</button>
          <button type="button" className={btnSm} aria-label={L("Next month", "Bulan seterusnya")} onClick={() => setMonth((m) => shift(m, 1))}>›</button>
        </span>
      </div>
      <p className={css.hiddenNote}>{L("Filled: approved. Outlined: waiting for a decision. A marked day has two or more people from the same department away.",
        "Berisi: diluluskan. Bergaris: menunggu keputusan. Hari bertanda ada dua atau lebih orang dari jabatan yang sama bercuti.")}</p>
      {!grid ? <SkelRows rows={4} /> : grid.rows.length === 0 ? <p className={css.empty}>{L("Nobody is on leave this month.", "Tiada sesiapa bercuti bulan ini.")}</p> : (
        <div className={css.calWrap}>
          <table className={css.cal}>
            <thead>
              <tr>
                <th scope="col" className={css.calName}>{L("Who", "Siapa")}</th>
                {grid.days.map((d) => <th key={d} scope="col" className={css.calDay}>{Number(d.slice(8, 10))}</th>)}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className={css.calName}>{r.name}{r.department ? <span className={css.whatDetail}>{r.department}</span> : null}</th>
                  {r.cells.map((c, i) => (
                    <td key={i} className={`${css.calCell} ${c ? (c.status === "approved" ? css.calOn : css.calPending) : ""}`}
                      title={c ? `${r.name} · ${c.type} · ${c.status}` : undefined} />
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className={css.calName}>{L("Away", "Bercuti")}</th>
                {grid.away.map((n, i) => <td key={i} className={`${css.calCount} ${grid.clash[i] ? css.calClash : ""}`}>{n || ""}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
