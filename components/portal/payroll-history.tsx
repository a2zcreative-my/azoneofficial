"use client";

/* v1.207.0 - PAYROLL HISTORY, READ FROM THE RECORD THAT EXISTS.

   The owner's Payroll brief (25-10-2026) and its mockup show "payroll runs".
   This system has no run record: a month IS its saved payroll entries, plus a
   payslip release. So the history reads exactly that - GET /staff/payroll?
   month=YYYY-MM, the route the Processing table already reads, once per
   month - and shows what each month holds: how many people were saved, the
   SAVED net total (never a recomputed one), whether its payslips are out,
   and how many saved rows carry no saved net (the rows the M2E file and the
   CSV would price with their older fallback formula - finding 3 of the
   audit, reported and warned about, not changed).

   Nothing is written, nothing is cached on the device, nothing is computed
   that the record does not already hold. Read only when the Reports tab or a
   salary drawer is opened (`enabled`). */

import { useEffect, useRef, useState } from "react";
import { makeApi } from "@/lib/api";

const api = makeApi("/staff");

export interface PayrollMonth {
  month: string;
  /** people with a saved entry */
  saved: number;
  /** the sum of the SAVED nets (rows with no saved net are not counted) */
  net: number;
  /** saved rows with no saved net - the bank file would use its fallback */
  noNet: number;
  /** a release ROW exists (somebody pressed Release) */
  released: boolean;
  /** v1.339.0 - the server's own answer (payslipsOutFor): a release row OR
      the automatic moment has passed - what staff can actually open */
  out: boolean;
  /** the automatic moment, "YYYY-MM-DD HH:MM" MYT; "" when not read */
  availableFrom: string;
  /** each person's saved net, null when the row has none */
  byUser: Record<number, number | null>;
  failed: boolean;
}

export const monthsBack = (from: string, n: number): string[] => {
  const [y, m] = from.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
};

export function usePayrollHistory(month: string, enabled: boolean, count = 12, nonce = 0): { rows: PayrollMonth[]; loading: boolean } {
  /* v1.339.0 - nonce re-reads after a release from the table */
  const key = enabled ? `${month}|${count}|${nonce}` : "";
  const [state, setState] = useState<{ key: string; rows: PayrollMonth[] }>({ key: "", rows: [] });
  const seq = useRef(0);
  useEffect(() => {
    if (!key) return;
    const mine = ++seq.current;
    void Promise.all(monthsBack(month, count).map(async (m): Promise<PayrollMonth> => {
      const r = await api<{ entries?: { user_id: number; net_cents?: number | null }[]; release?: { released?: unknown; available_from?: string }; population?: { payslips_out?: boolean } }>(`/payroll?month=${m}`);
      const entries = r.ok ? r.data?.entries ?? [] : [];
      const byUser: Record<number, number | null> = {};
      for (const e of entries) byUser[e.user_id] = typeof e.net_cents === "number" ? e.net_cents : null;
      return {
        month: m,
        saved: entries.length,
        net: entries.reduce((a, e) => a + (typeof e.net_cents === "number" ? e.net_cents : 0), 0),
        noNet: entries.filter((e) => typeof e.net_cents !== "number").length,
        released: Boolean(r.data?.release?.released),
        out: Boolean(r.data?.release?.released) || r.data?.population?.payslips_out === true,
        availableFrom: r.data?.release?.available_from ?? "",
        byUser,
        failed: !r.ok,
      };
    })).then((rows) => { if (seq.current === mine) setState({ key, rows }); });
  }, [key, month, count, nonce]);
  return { rows: state.key === key ? state.rows : [], loading: Boolean(key) && state.key !== key };
}
