/* v1.371.0 - ONE REFERENCE FOR THE PUBLIC FORMS (the CEO, 18-11-2026: "number
   rujukan bagi /apply/business dan /apply/partner mestilah menggunakan
   A2Z-DDMM Running Number, contoh A2Z-181101").

   A2Z- + the Malaysia day and month + the running number of that day, two
   digits (01, 02 ... 99, then 100). ONE counter for both forms (migration 0212,
   public_ref_counters), so a Business Growth Check and a partner application
   never carry the same reference. The number is taken in one conditional write
   (an upsert that returns the new value), so two submissions at the same
   instant get two numbers. A number is used up even if the save after it
   fails, so a day may skip a number; it never repeats one.

   Records saved before this keep their reference (BG-, AGT-APP-, PIA-). */
import type { Env } from "./index";

/** "A2Z-181101" for the first reference of 18 November (Malaysia time) */
export const formatPublicRef = (mytDay: string, n: number) => `A2Z-${mytDay.slice(8, 10)}${mytDay.slice(5, 7)}${String(n).padStart(2, "0")}`;

/** The next reference, or null while migration 0212 is not applied (the caller keeps its old numbering) */
export async function nextPublicRef(env: Env): Promise<string | null> {
  const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const r = await env.DB.prepare(
      `INSERT INTO public_ref_counters (day, n) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1 RETURNING n`,
    ).bind(day).first<{ n: number }>();
    return r ? formatPublicRef(day, Number(r.n)) : null;
  } catch (e) {
    if (/no such table/i.test(String(e))) return null;
    throw e;
  }
}
