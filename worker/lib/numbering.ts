/**
 * numbering.ts — generates sales document numbers in the v1.2.7 format:
 *   {TYPE}{YYYYMMDD}-{NN}-AZOO   e.g. DO20260725-01-AZOO
 *
 * Uses a per-(type, day) counter row in D1 so numbers are unique even under
 * concurrent requests. Old-format numbers (QT202600001) remain untouched.
 *
 * One-time migration (add to migrations, do not edit old ones):
 *
 *   CREATE TABLE IF NOT EXISTS doc_counters (
 *     doc_type TEXT NOT NULL,
 *     day TEXT NOT NULL,            -- YYYYMMDD
 *     seq INTEGER NOT NULL DEFAULT 0,
 *     PRIMARY KEY (doc_type, day)
 *   );
 */

export type DocType = "QT" | "DO" | "INV" | "OR" | "CN";

const ISSUER = "AZOO";
const TZ_OFFSET_MINUTES = 8 * 60; // Asia/Kuala_Lumpur (UTC+8, no DST)

function todayKL(): string {
  const now = new Date(Date.now() + TZ_OFFSET_MINUTES * 60_000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Atomically increments the daily counter and returns the next document number.
 * Widens to 3 digits automatically past 99 documents in one day.
 */
export async function nextDocNumber(db: D1Database, type: DocType): Promise<string> {
  const day = todayKL();

  // Upsert + increment in one statement; RETURNING gives us the new value.
  const row = await db
    .prepare(
      `INSERT INTO doc_counters (doc_type, day, seq) VALUES (?1, ?2, 1)
       ON CONFLICT(doc_type, day) DO UPDATE SET seq = seq + 1
       RETURNING seq`
    )
    .bind(type, day)
    .first<{ seq: number }>();

  const seq = row?.seq ?? 1;
  const nn = String(seq).padStart(seq > 99 ? 3 : 2, "0");
  return `${type}${day}-${nn}-${ISSUER}`;
}

/** Accepts both old (QT202600001) and new (QT20260725-01-AZOO) formats. */
export function parseDocNumber(no: string):
  | { format: "v1.2.7"; type: string; date: string; seq: number }
  | { format: "legacy"; type: string; year: string; seq: number }
  | null {
  const modern = /^([A-Z]{2,3})(\d{8})-(\d{2,3})-AZOO$/.exec(no);
  if (modern) {
    return { format: "v1.2.7", type: modern[1], date: modern[2], seq: Number(modern[3]) };
  }
  const legacy = /^([A-Z]{2,3})(\d{4})(\d{5})$/.exec(no);
  if (legacy) {
    return { format: "legacy", type: legacy[1], year: legacy[2], seq: Number(legacy[3]) };
  }
  return null;
}
