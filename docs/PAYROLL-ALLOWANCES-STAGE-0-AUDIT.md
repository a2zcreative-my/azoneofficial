# Payroll allowances - Stage 0 audit and plan

The CEO's request (21-11-2026): on Payroll → Settings & Audit → *Base salaries (fixed monthly
basic)*, add named allowance TYPES he sets up himself (parking, transport, ...) and a fixed
monthly amount of each type per staff member, shown beside the basic and carried into the
monthly payroll row's Allowance.

Status: **audit only. Nothing is built until the CEO answers the decisions in section 3.**

## 1. What exists today (read from the code at 1.408.0, `22fcc79`)

### Basic salary
- Stored on the person: `users.base_salary_cents`. No history table; each change is one audit
  row `payroll.base_update` (`worker/src/staff.ts`, `POST /payroll/base`).
- Read: `GET /payroll/base` (cap `payroll_process` = super_admin, admin, ceo, coo), filtered by
  `payrollBaseStaffSql()`.
- Written: `POST /payroll/base`, same cap, one person per call.
- Screen: `components/portal/payroll-panel.tsx`, card `#payroll-base` (list) + `SideDrawer` editor.
  On Save the editor also **carries the new base into the open month**: present month only, never
  a past month, never a released month; every row of that month whose Basic differs is re-saved
  through `POST /payroll` with its net recomputed (v1.97.1 / v1.159.2 / v1.159.3).
- Monthly pre-fill: a person with no saved row for the month gets `basic_cents = base[id]`
  (`entry()`, `load()`); the pristine snapshot is taken from the same pre-fill, so an unsaved
  pre-filled row is not "dirty". A saved row always wins.

### Allowance today
- ONE free number per person per month: `payroll_entries.allowance_cents`. Typed in the
  processing grid (`["basic_cents", "allowance_cents"]` inputs) or the row drawer. Pre-fill is 0.
- Net (browser `netFor` and server Recompute / Save, term for term - `tests/payroll-module.mjs`):
  - monthly: `basic + phWorked + commission + allowance + ot - deduction - unpaidLeave - incomplete - advance`
  - hourly (part-time live host): `hourly + phWorked + commission + allowance - deduction - advance`
- The allowance is **not** prorated: the incomplete-month adjustment (`incompleteCents`) is on
  `basic_cents` only; unpaid leave is on `base_salary_cents || basic_cents`.
- The allowance is **not** in ORP: OT is `basic ÷ 26 ÷ 8 × 1.5`, public holiday worked is on
  `base_salary_cents || basic_cents`.
- Payslip (`payslipData`): one earnings line `ALLOWANCE` when > 0. The PDF twin draws the same data.
- M2E bank file / payment file: net only (`net_cents`, legacy fallback adds allowance). CSV and
  `/expenses` read the stored `net_cents`. No export itemises earnings.

### Locks
- `releasedMonthBlock` refuses Save / Recompute / OT edits on a released month (row OR the
  automatic 5th), unless forced with `payroll_release` (audited `payroll.force_released`).
- A paid month is never changed (go-live C).
- `/payroll` POST refuses anyone not on the month's payroll (`payrollMonthStaffSql`).

### Migrations
- Last migration in the repo: `0230_sales_playbook.sql`; `backups/release-backup.log` shows 1.408.0
  as the last release. The next free number is **0231** - to be re-checked at build time, because
  another session (Leads) may land a migration first.

## 2. Plan (additive - no payroll figure of a saved, released or paid month changes)

**Data (migration 0231, additive only)**
- `payroll_allowance_types` - id, code (unique), name_en, name_ms, active, sort, version,
  created_by/at. Never deleted (trigger): a type is retired by `active = 0`.
- `payroll_allowance_amounts` - (user_id, type_id) unique, amount_cents (monthly), version,
  updated_by/at. The current fixed amount.
- `payroll_allowance_events` - append-only (triggers refuse UPDATE/DELETE): type created / renamed /
  retired, amount set / changed / cleared, with old and new values, who, when, reason.
- `payroll_entries.allowance_items` TEXT NULL - the breakdown `[{type_id, name, cents}]` frozen on
  the row when it is SAVED, so a payslip can itemise what was actually paid even after the setup
  changes. NULL on every existing row (they keep printing one ALLOWANCE line).

**Server (`worker/src/payroll-allowances.ts`, one door in staff.ts)**
- `GET /payroll/allowances` - types + every person's amounts (cap `payroll_process`).
- `POST/PATCH /payroll/allowance-types` - new cap `payroll_allowance_types` (D1).
- `PUT /payroll/allowances/:user_id` - that person's amounts per type, with `version`
  (stale = 409), audited.
- `POST /payroll` accepts an optional `allowance_items`; stored only when its sum equals
  `allowance_cents` (otherwise NULL). `allowance_cents` stays the one figure in net.
- **The net formula does not change**: `netFor` and Recompute keep `e.allowance_cents` term for
  term. Recompute never re-reads the setup (it would change saved months).

**Screen (payroll-panel.tsx, Settings & Audit)**
- The Base salaries list shows, per person: Basic · each allowance · monthly total.
- The editor drawer gets an allowance column per active type beside the basic.
- A CEO-only "Allowance types" drawer: add, rename, reorder, retire.
- Monthly pre-fill: a person with **no saved row** for the month gets
  `allowance_cents = sum of their active amounts` (exactly as Basic pre-fills from the base), and
  the pristine snapshot uses the same figure - so nothing reads as changed and nothing is saved
  until someone presses Save. **A saved row is never touched.**
- The row drawer shows the breakdown and any one-off difference ("Other allowance").
- Payslip: itemised lines when `allowance_items` sums to `allowance_cents`, else the single line (D3).

**Guards**
- New `tests/payroll-allowances.mjs`: migration additive + triggers; the types route refuses every
  role but the D1 roles; amounts carry version; netFor / Recompute / Save terms unchanged; the
  pre-fill applies only to a person with no saved row; a released month is never written by a
  setup change; payslip itemises only when the items add up.
- `tests/payroll-module.mjs` stays as it is (allowance is still one term).

## 3. Decisions for the CEO (asked before building)

| # | Question | Recommendation |
|---|---|---|
| D1 | Who may create / rename / retire allowance TYPES? | CEO only (plus super admin as the technical account) - new cap `payroll_allowance_types`. |
| D2 | Who may set each person's AMOUNTS? | Same people as the basic (`payroll_process`: CEO, COO, admin, super admin) - or CEO only if he prefers. |
| D3 | Payslip: one ALLOWANCE line, or each type itemised (PARKING ALLOWANCE, TRANSPORT ALLOWANCE)? | Itemised, from the breakdown saved on the row. |
| D4 | Part month (joiner / leaver): full allowance or prorated like the basic? | Full amount pre-filled, the processor adjusts the row by hand - the net formula stays as it is. (Proration would be computed only in the pre-fill, never inside net.) |
| D5 | Does an allowance count for OT / holiday pay (ORP) or unpaid-leave deduction? | **No** - ORP and unpaid leave stay basic-only, as today. |
| D6 | Part-time hourly live hosts - can they have fixed allowances? | Yes if he sets an amount; none by default. |
| D7 | When an amount changes, does it carry into the current month already saved (as a base change does)? | Present month only, never released/past, and only rows whose saved allowance still equals the old setup total; a hand-typed figure is flagged, not overwritten. |
| D8 | Statutory (KWSP/SOCSO/EIS) treatment per type? | Not now (statutory is still pending); add a flag per type when statutory is built. |

## 4. Out of scope
The payroll staff-list filter (another session), statutory deductions, any change to how net,
OT, ORP, unpaid leave or proration is calculated, deployment.
