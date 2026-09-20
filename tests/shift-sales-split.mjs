/* v1.25.6 — proves the shift-attribution rules on the REAL worker code
   (worker/src/shift-sales.ts imported directly, not a copy), so the test
   cannot drift from what ships.
   Run: node --experimental-strip-types tests/shift-sales-split.mjs */
import { shiftSalesSplit, pairShifts, mytDayEndUtc, clipToDuty, inAnyLive } from "../worker/src/shift-sales.ts";

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

/* ===================================================================
   v1.171.0 — THE CEO, 20-09-2026, on two real orders (17-09, 18:53 and
   19:30) credited to a person whose sales duty ended at 18:00 and who was
   still clocked in: *"Sales performance is incorrect ... the other staff
   that was clock out late she was the one make the sales!"*.
   His rule: the live host owns an order that lands inside their live, and
   outside a live a person earns only inside their PLANNED selling hours.
   =================================================================== */

/* His two orders, to the minute. NUR NASUHA = 9, sales duty 10:00–18:00 MYT,
   clocked in 09:58 and out at 20:05 (late). A live host runs 17:00–19:00. */
const HER_PUNCHES = [
  { user_id: 9, type: "clock_in", created_at: "2026-09-17 01:58:00" },  // 09:58 MYT
  { user_id: 9, type: "clock_out", created_at: "2026-09-17 12:05:00" }, // 20:05 MYT
];
const HER_DUTY = [{ user_id: 9, date: "2026-09-17", start: "10:00", end: "18:00" }];
const THE_LIVE = [{ date: "2026-09-17", start: "17:00", end: "19:00" }];
const ORDER_1853 = { created_at: "2026-09-17 10:53:00", cents: 1300 }; // 18:53 MYT
const ORDER_1930 = { created_at: "2026-09-17 11:30:00", cents: 1250 }; // 19:30 MYT
const NOW17 = "2026-09-17 16:00:00";

eq("[his case] the 18:53 order is inside the live — the floor gets nothing, the host owns it",
  asObj(shiftSalesSplit(HER_PUNCHES, [ORDER_1853], NOW17, { duties: HER_DUTY, lives: THE_LIVE })), {});

eq("[his case] the 19:30 order is past her 18:00 duty and past the live — nobody",
  asObj(shiftSalesSplit(HER_PUNCHES, [ORDER_1930], NOW17, { duties: HER_DUTY, lives: THE_LIVE })), {});

eq("[the bug] without the new rule BOTH orders were hers — which is what he saw",
  asObj(shiftSalesSplit(HER_PUNCHES, [ORDER_1853, ORDER_1930], NOW17)), { 9: 2550 });

eq("an order inside her duty is still fully hers",
  asObj(shiftSalesSplit(HER_PUNCHES, [{ created_at: "2026-09-17 06:30:00", cents: 5000 }], NOW17,
    { duties: HER_DUTY, lives: THE_LIVE })), { 9: 5000 });

eq("clocking in EARLY earns nothing before the planned start",
  asObj(shiftSalesSplit(
    [{ user_id: 9, type: "clock_in", created_at: "2026-09-17 00:30:00" },   // 08:30 MYT
     { user_id: 9, type: "clock_out", created_at: "2026-09-17 10:00:00" }],
    [{ created_at: "2026-09-17 01:15:00", cents: 900 }], NOW17,             // 09:15 MYT
    { duties: HER_DUTY })), {});

eq("the duty's end minute is inclusive (18:00:30 counts, 18:01 does not)",
  [asObj(shiftSalesSplit(HER_PUNCHES, [{ created_at: "2026-09-17 10:00:30", cents: 100 }], NOW17, { duties: HER_DUTY })),
   asObj(shiftSalesSplit(HER_PUNCHES, [{ created_at: "2026-09-17 10:01:00", cents: 100 }], NOW17, { duties: HER_DUTY }))],
  [{ 9: 100 }, {}]);

eq("two people on duty at once still split equally",
  asObj(shiftSalesSplit(
    [...HER_PUNCHES,
     { user_id: 4, type: "clock_in", created_at: "2026-09-17 02:00:00" },
     { user_id: 4, type: "clock_out", created_at: "2026-09-17 09:00:00" }],
    [{ created_at: "2026-09-17 06:00:00", cents: 999 }], NOW17,             // 14:00 MYT
    { duties: [...HER_DUTY, { user_id: 4, date: "2026-09-17", start: "10:00", end: "18:00" }] })),
  { 4: 500, 9: 499 });

eq("a day with a duty but NO punch credits nobody (a plan is not attendance)",
  asObj(shiftSalesSplit([], [{ created_at: "2026-09-17 06:00:00", cents: 800 }], NOW17, { duties: HER_DUTY })), {});

eq("an EMPTY duty list credits nobody; omitting duties keeps the old rule",
  [asObj(shiftSalesSplit(HER_PUNCHES, [{ created_at: "2026-09-17 06:00:00", cents: 800 }], NOW17, { duties: [] })),
   asObj(shiftSalesSplit(HER_PUNCHES, [{ created_at: "2026-09-17 06:00:00", cents: 800 }], NOW17))],
  [{}, { 9: 800 }]);

eq("clipToDuty intersects the punched hours with the planned ones",
  clipToDuty([{ uid: 9, from: "2026-09-17 01:58:00", to: "2026-09-17 12:05:00" }], HER_DUTY),
  [{ uid: 9, from: "2026-09-17 02:00:00", to: "2026-09-17 10:00:59" }]);

eq("inAnyLive reads MYT wall clock, inclusive at both ends",
  [inAnyLive("2026-09-17 09:00:00", THE_LIVE),   // 17:00 MYT
   inAnyLive("2026-09-17 11:00:00", THE_LIVE),   // 19:00 MYT
   inAnyLive("2026-09-17 11:01:00", THE_LIVE),   // 19:01 MYT
   inAnyLive("2026-09-16 10:00:00", THE_LIVE)],  // the day before
  [true, true, false, false]);

if (failed) { console.log(`\nFAIL — ${failed} scenario(s) wrong`); process.exit(1); }
console.log("\nPASS — shift attribution behaves exactly as decided (the live host owns his live's orders, planned selling hours cap the punched ones, equal split, forgotten clock-outs capped)");
