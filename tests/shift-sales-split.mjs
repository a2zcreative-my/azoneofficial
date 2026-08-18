/* v1.25.6 — proves the shift-attribution rules on the REAL worker code
   (worker/src/shift-sales.ts imported directly, not a copy), so the test
   cannot drift from what ships.
   Run: node --experimental-strip-types tests/shift-sales-split.mjs */
import { shiftSalesSplit, pairShifts, mytDayEndUtc } from "../worker/src/shift-sales.ts";

let failed = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log(`ok   ${label}`);
  else { console.log(`FAIL ${label}\n     got  ${g}\n     want ${w}`); failed++; }
};
const asObj = (m) => Object.fromEntries([...m.entries()].sort((a, b) => a[0] - b[0]));

// NUR NASUHA = 9. All timestamps UTC (MYT = UTC+8): 01:00 UTC = 09:00 MYT.
const NOW = "2026-08-18 08:00:00"; // 16:00 MYT today

// 1. Her exact case: clocked in 09:00–18:00 MYT, an order lands 14:30 MYT → all hers.
eq("order during her shift is fully hers",
  asObj(shiftSalesSplit(
    [{ user_id: 9, type: "clock_in", created_at: "2026-08-17 01:00:00" },
     { user_id: 9, type: "clock_out", created_at: "2026-08-17 10:00:00" }],
    [{ created_at: "2026-08-17 06:30:00", cents: 5000 }], NOW)),
  { 9: 5000 });

// 2. Order at 20:00 MYT, after she clocked out → nobody credited.
eq("order after clock-out credits nobody",
  asObj(shiftSalesSplit(
    [{ user_id: 9, type: "clock_in", created_at: "2026-08-17 01:00:00" },
     { user_id: 9, type: "clock_out", created_at: "2026-08-17 10:00:00" }],
    [{ created_at: "2026-08-17 12:00:00", cents: 5000 }], NOW)),
  {});

// 3. Two sales_marketing people on shift → split, odd cent to the first, total preserved.
eq("two on shift split equally, no cent lost",
  asObj(shiftSalesSplit(
    [{ user_id: 9, type: "clock_in", created_at: "2026-08-17 01:00:00" },
     { user_id: 9, type: "clock_out", created_at: "2026-08-17 10:00:00" },
     { user_id: 12, type: "clock_in", created_at: "2026-08-17 02:00:00" },
     { user_id: 12, type: "clock_out", created_at: "2026-08-17 09:00:00" }],
    [{ created_at: "2026-08-17 05:00:00", cents: 1001 }], NOW)),
  { 9: 501, 12: 500 });

// 4. Still clocked in right now (no clock_out yet) → today's orders count up to now.
eq("open shift today counts orders up to now",
  asObj(shiftSalesSplit(
    [{ user_id: 9, type: "clock_in", created_at: "2026-08-18 01:00:00" }],
    [{ created_at: "2026-08-18 05:00:00", cents: 2500 },
     { created_at: "2026-08-18 09:00:00", cents: 999 }], NOW)), // 2nd is after NOW
  { 9: 2500 });

// 5. Forgotten clock-out YESTERDAY must not hoover up today's orders:
//    the shift is capped at 23:59:59 MYT of the day it started.
eq("forgotten clock-out is capped at its own day",
  asObj(shiftSalesSplit(
    [{ user_id: 9, type: "clock_in", created_at: "2026-08-16 01:00:00" }], // 16th, never out
    [{ created_at: "2026-08-16 08:00:00", cents: 700 },   // 16th 16:00 MYT — hers
     { created_at: "2026-08-17 03:00:00", cents: 40000 }], // 17th — NOT hers
    NOW)),
  { 9: 700 });

// 6. A GENUINE overnight shift (real clock-out after midnight) is honoured.
eq("real overnight shift keeps its after-midnight orders",
  asObj(shiftSalesSplit(
    [{ user_id: 9, type: "clock_in", created_at: "2026-08-16 12:00:00" },   // 20:00 MYT
     { user_id: 9, type: "clock_out", created_at: "2026-08-16 18:00:00" }], // 02:00 MYT on the 17th
    [{ created_at: "2026-08-16 17:00:00", cents: 1200 }], NOW)),            // 01:00 MYT on the 17th
  { 9: 1200 });

// 7. Clock-in while a shift is still open supersedes: the stale shift ends there.
eq("second clock_in supersedes the unclosed one",
  pairShifts(
    [{ user_id: 9, type: "clock_in", created_at: "2026-08-16 01:00:00" },
     { user_id: 9, type: "clock_in", created_at: "2026-08-17 01:00:00" },
     { user_id: 9, type: "clock_out", created_at: "2026-08-17 10:00:00" }], NOW),
  [{ uid: 9, from: "2026-08-16 01:00:00", to: "2026-08-16 15:59:59" },
   { uid: 9, from: "2026-08-17 01:00:00", to: "2026-08-17 10:00:00" }]);

// 8. Day-end helper: 16:00 MYT on the 16th → 23:59:59 MYT the 16th = 15:59:59 UTC.
eq("mytDayEndUtc", mytDayEndUtc("2026-08-16 08:00:00"), "2026-08-16 15:59:59");

// 9. Zero / null order amounts are ignored.
eq("null and zero amounts ignored",
  asObj(shiftSalesSplit(
    [{ user_id: 9, type: "clock_in", created_at: "2026-08-17 01:00:00" },
     { user_id: 9, type: "clock_out", created_at: "2026-08-17 10:00:00" }],
    [{ created_at: "2026-08-17 05:00:00", cents: null },
     { created_at: "2026-08-17 05:00:00", cents: 0 }], NOW)),
  {});

if (failed) { console.log(`\nFAIL — ${failed} scenario(s) wrong`); process.exit(1); }
console.log("\nPASS — shift attribution behaves exactly as decided (all orders during shift, equal split, forgotten clock-outs capped)");
