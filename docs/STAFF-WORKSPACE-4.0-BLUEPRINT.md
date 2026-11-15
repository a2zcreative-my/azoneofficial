# A2Z OS — Staff Workspace 4.0: UI/UX and Employee Data Architecture Blueprint

**Status:** GATE 1 (read-only audit) and GATE 2 (design) complete. **GATE 3: waiting for your approval.** Nothing has been coded, migrated or deployed.
**Authority:** the CEO's directive "A2Z OS — Staff Workspace 4.0", 15-11-2026, with six reference images.
**Sits on:** 1.307.0 (Attendance 4.0, on your PC, not deployed).
**Source audited:**
- `components/staff/staff-directory.tsx` (2,571 lines), `org-chart.tsx`, `responsibilities.tsx`, `offboard-sheet.tsx`, `staff-page.module.css`;
- `components/portal/reporting-line-card.tsx`;
- `app/portal/page.tsx` (the "Staff Details" block);
- `worker/src/staff.ts` (the `/users` routes), `permissions.ts`, `leave-chain.ts`, `lib/org-tree.ts`, `lib/staff-order.ts`.

> The reference images are design targets. Their names, staff IDs, IC number, phone, address, photos, birthdays, tenure, "57 % / +57 pp" and every count are **illustrative**. Nothing from them is copied into the product; every figure comes from the records.

---

## 1. Current implementation audit (what is really there)

**The six tabs already exist** (v1.201 / v1.204): Overview · Directory · Organisation · Team Map · Departments & Roles · Staff Records. They read **one** list, `GET /staff/users`, and every tab is drawn from it. The **tab name in the sidebar is "Staff Details"**, shown to the user as "Staff".

| Tab | What it does today | Gap against the reference |
|---|---|---|
| Overview | 4 KPIs (Staff records, Active, Departments, Roles written); department donut; status + employment-type bars; Needs Attention (roles not written, no full name, not on chart); Quick Links (6) | 4th KPI should be **Profiles Missing Info**. Needs Attention lacks **incomplete records, probation ending soon, staff leaving soon, sign-in blocked**. Donut and status should sit in **one** card (ref 01). Quick Actions become one row. |
| Directory | Search, department, status, sort, list/grid, badge print select; Profile + Record buttons; profile docks beside the list on wide screens; department cards below | Missing **Employment Type column and filter**. The department cards under the list duplicate the Overview and the department filter. Status only covers active / starting / inactive / left (and "Active · leaving"). |
| Organisation | ReportingLineCard + one heading card + OrgChart (tree, tray of unplaced people, assign) + "Who reports to whom" | Needs a **Leadership Summary** (CEO, no supervisor, oversees, direct reports, departments), a **centred tree** (CEO → COO/CCO → their people), and **Reporting lines** as a compact strip. No search, no expand/collapse, no department focus. |
| Team Map | Orbit of faces in company order, CEO centre, caption bar; 3-column grid on phones; birthday chips | Should be grouped by **department sectors**, with **names under faces**, the header figures (Total, Active, Next birthdays, On leave), Departments + Quick View on the left, and Next Birthdays + On Leave on the right. |
| Departments & Roles | Coverage card (% written, bar), Everyone / Not written, a table per department (position, role title, responsibilities, last written, Read / Write) | Matches closely. Add **Written (n)** pill, **department dropdown**, "**n staff · n written · n not written**" per department, and **Add staff to department**. The reference's "+57 pp" has no history behind it, so it is **not** shown. |
| Staff Records | Left picker (search, completeness X/22); right: one long card (Personal / Employment / Bank & statutory field grid, role select, responsibilities, document vault, badge preview, Save / Print / Offboard / Photo) | Needs the **header** (photo, name, ID · position, status, joined, tenure, Print ID / Upload Document / Edit / Save), **six section tabs** (Personal Details · Employment · Role & Access · Bank & Statutory · Documents · Emergency Contact) and **section completeness rows**. Today it is always editable, with no Edit / Cancel; it has no protection against two people saving at once and no change history. |

**The completeness count the reference shows (22) is exactly today's 22 record fields.** Personal (9) + Employment (8) + Bank & statutory (5).

---

## 2. Duplicate-function analysis

| Duplicate today | Where | Resolution |
|---|---|---|
| Department summary drawn twice | Overview donut **and** Directory's department cards | Keep the Overview's. The Directory keeps only its department **filter**. |
| Reporting lines drawn three times | ReportingLineCard, the chart, "Who reports to whom" | One **Leadership Summary**, one **tree**, one compact **Reporting lines** strip. All three read the same `reports_to`. |
| Record opened two ways | Directory "Record" button and the profile's "Edit profile" | One row press opens the **profile**. "Open record" sits in its footer, and in a ⋯ menu on the row (S-3). |
| Birthdays on three surfaces | cake chips on faces, Team Map chips, record header | Team Map's **Next Birthdays** list plus the record. The cake on faces stays. |
| Probation and leaving | also in HR → Employee Lifecycle | **Not duplicated.** Overview shows the **count** and links to HR → Lifecycle (HR owns the review). |

**No second employee database, department engine, reporting engine or permission engine exists, and none is proposed.**

---

## 3. Employee master-data ownership

| Fact | Owner (authoritative) | Read by |
|---|---|---|
| Identity, personal details, Staff ID, photo | **Staff** (`users` row, `/staff/users`) | Every module, by `users.id` |
| Position, department, employment status / type, join / leave / re-join dates | **Staff** | Payroll (its own month rule), Attendance (headcount by day), Leave, HR |
| Reporting line (`reports_to`) | **Staff → Organisation** (`PUT /users/:id/reports-to`, `org_assign`) | **Leave routing** (approved v1.260), Assets requests, task escalation mail |
| Role title and responsibilities | **Staff → Departments & Roles** (`PUT /users/:id/responsibilities`) | Profile (own), Desk |
| Documents | **Staff** vault (`staff_documents`, R2) | HR checklist |
| Joining / probation / letters / training / leaving | **HR** (reads Staff IDs) | Staff shows links only |
| Login, MFA, passkeys, sessions, system role, sign-in block | **Users & Security** | Staff shows read-only chips and a link |
| Salary, payslips, bank file | **Payroll** (its own staff route) | — |

**Leave and the reporting line (directive §6E).** Since v1.260 (your approved Leave timeline), a leave request is routed to the applicant's **manager on the reporting line**. A pending request keeps the route it was frozen with. Changing a reporting line therefore changes who approves that person's **next** leave request. This is the existing, separately approved configuration. **I propose no change to it** (S-7), but you should know the link exists. Claims, Attendance and Payroll do not read `reports_to`.

---

## 4. Tab designs (desktop, to the references)

Each tab gets its own address (`/portal?tab=Staff Details&view=overview|directory|org|team|roles|records`), with Back/Forward (S-0). Every zone stays mounted and hidden, as today.

### 4.1 Overview (ref 01)
- **4 tiles:** Total Staff · Active Staff (% of total) · Departments (named) · **Profiles Missing Info** (active records with fewer than the required fields — S-5).
- **One card: Staff Distribution by Department.** The donut and legend (count and %) on top. Below them, two halves: **Staff Status** (Active / Inactive / Left, plus Starting and On notice when present) and **Employment Type** (current staff only).
- **Needs Attention (one list).** Each row opens the right place, and is shown only when its count is above 0:
  - Roles not written → Departments & Roles (Not written);
  - Incomplete staff records → Staff Records (filtered to incomplete);
  - Probation ending soon (≤30 days, HR's open probation reviews) → **HR → Employee Lifecycle**;
  - Staff leaving soon (a departure status with a last day within 60 days) → Directory (On notice);
  - Sign-in blocked (resigned or terminated with the account still on, for the final month's pay) → Directory (Left).
  - Not on the organisation chart stays as a sixth row.
- **Quick Actions row:** Staff Directory · Organisation · Team Map · Add Staff (only where allowed) · Staff Records.
- Nothing from Leave, Attendance, Payroll or Tasks queues appears. No IC, bank or statutory data.

### 4.2 Directory (ref 02)
- Header "Staff Directory · n staff records", with a **List / Grid** switch.
- Filters: **Find staff · All departments · All statuses · All employment types**, plus a Sort menu (rank, A–Z, Z–A, Staff ID, department).
- Columns: **Staff** (photo, name, system-role line) · **Staff ID** · **Position** · **Department** · **Employment Type** chip · **Status** chip (and **Sign-in blocked** beside Resigned).
- **Status vocabulary** (S-4), derived from today's fields:
  - **Active**;
  - **On probation** (`employment_status = probation`);
  - **On notice** (resigned or terminated with a last day still ahead);
  - **Resigned** / **Terminated** (last day passed);
  - **Starting** (joins later);
  - **Inactive** (the account is switched off in Users & Security).
  - It is never today's attendance or leave.
- **Resigned staff stay listed**, shaded, and are never deleted.
- Row actions (S-3): either **the reference** (Profile · Record buttons) or **the directive** (press the row = profile, ⋯ = Open record, Print badge). Badge printing stays as "Select for printing".
- The department cards below the list are **removed** (duplicate, §2).

### 4.3 Organisation (ref 03)
- **Leadership Summary:** the CEO card (photo, title, name, department), then "No Direct Supervisor" (the CEO reports to nobody — already enforced, `ceo_top`) and "Oversees the Company", then **Direct Reports (n)** and **Departments (n)** buttons.
- **Organisation tree:** CEO at the top, COO / CCO (and anyone else reporting to the CEO) on level 2, and their people below. Each node shows photo, name, position, department and a direct-report count. Nodes **expand / collapse**. Above the tree: **Search person** and **Focus department**. The tray of people not yet placed stays under the tree, for the assigners.
- **Reporting lines strip:** "X (CEO) — Reports to: no one (highest authority)", then each manager with "n direct reports", and **View Full Organisation**.
- **Changing a line** (CEO, COO, CCO — `org_assign`, unchanged). It is the same route, still refusing loops, self-reporting, a parent for the CEO and a leaver as manager. **New (S-8):** an optional **reason** and **effective date** are written to the audit entry (`staff.reports_to` already stores from / to by name). A future effective date is **not** scheduled; the date is recorded only, unless you choose the migration option in S-8.

### 4.4 Team Map (ref 04)
- Header: **Total Staff · Active Staff** ("Active Today" in the reference is relabelled, because it means employment, not attendance — S-4) · **Next Birthdays (7 days)** · **On Leave today** (from Leave's calendar: names only, never type or reason).
- **Left:** Departments (n), each with a colour and count (pressing one filters the map), and Quick View (Organisation · Directory · Departments & Roles).
- **Centre:** the CEO in the middle and **department sectors** around (one colour each, a label chip per sector), with **names under faces**. The layout grows ring by ring so faces never overlap. With more than ~18 people a sector shows "+n", which opens that department in the Directory.
- **Right:** **Next Birthdays** (day and month only, never the year or age) and **On Leave**, each with "View all".
- Filters: department and status. **Company (A2Z / AZ ONE): not offered** — staff are one workforce (Attendance A-10); proposed as no (S-10).
- **Read-only.** Membership comes from the same `/staff/users` IDs, not a separate list.

### 4.5 Departments & Roles (ref 05)
- **Coverage card:** "n of m working staff completed" · % · bar. **No "+pp" delta** (no history behind it).
- Pills: **Everyone (n) · Not written yet (n) · Written (n)**; then **All departments ▾**.
- **One card per department** with "n staff · n written · n not written" and **Add staff to department**, which picks a person and sets their department. This is the same PATCH, with the same lock: HR fills an empty department, and the CEO / admin amend. Table: Staff (photo, name, ID) · Position · Role title · Responsibilities chip (**Written / Not written / Left**) · Last updated · **Read / Write**.
- **Write** opens the existing responsibilities editor in a drawer (`responsibilities_edit`: CEO, HR tier — unchanged). Directive §8 also names the COO, CCO and HODs (S-6).
- **Draft → Published, Awaiting Review and staff acknowledgement do not exist today.** They are **not shown** unless you approve P3 (S-9).
- **Employment role ≠ system access.** The system role is shown read-only, with a link to Users & Security.

### 4.6 Staff Records (ref 06)
- **Left:** Staff Records search, a filter icon (status, incomplete only), the list (photo, name, ID · position, **n/22**), and the completeness note.
- **Right header:** photo, full name, ID · position, **status chip**, **Joined dd Mon yyyy**, **tenure** (worked out), then **Print ID · Upload Document · Edit · Save**. **Edit** turns the form editable and **Cancel** appears; Save is active only with changes. Offboard and role change stay as they are, inside Employment / Role & Access, for the same people.
- **Section tabs:**
  1. **Personal Details:** photo (Change Photo), Full Name, Staff ID, NRIC (**masked**, shown in full only on Edit to those allowed — S-1), Date of Birth, Blood type, Mobile, Work email (read-only, from Users), Address.
  2. **Employment:** Joined, Employment type / status, Department, Position, ID issued, Last day, Re-joined; Probation shown read-only from HR, with a link.
  3. **Role & Access:** Role title + responsibilities (the editor), reporting supervisor (read-only, with a link to Organisation), system role (read-only for most; the existing role control for the CEO / COO).
  4. **Bank & Statutory:** bank, account, EPF, SOCSO, tax. **Only for the allowed tier** (S-1); everyone else sees "Restricted".
  5. **Documents:** the existing vault (upload, kinds, download).
  6. **Emergency Contact:** name, phone, relationship.
  - Under the open section, one collapsed row per other section with its **completeness** (✓ when complete).
- **Fields in the reference that are not on the record: Nationality, Religion, Gender, Marital Status.** They are **not added** (S-11). Religion and marital status are sensitive personal data under PDPA and have no current business use.
- **Change history** (new, S-12): "View change history" lists that person's audited changes. Sensitive fields show "changed by X on date", never the values.
- **Two people editing at once:** Save sends the values it started from. The server refuses with "changed by someone else — reload" if any of those fields moved meanwhile. This needs no migration.
- **One section never erases another:** PATCH already writes only the fields sent. Kept.

---

## 5. Mobile PWA (all six tabs, 320–1440 px)

| Tab | Phone layout (< 768 px) |
|---|---|
| All | The Dashboard's **view switch** replaces the tab row; **Add staff** moves into the switch bar. Bottom navigation is unchanged. No sideways page. 44 px targets. Safe areas respected. |
| Overview | Tiles 2 × 2; donut above the legend; Status and Type stacked; Needs Attention as a short list (max 5 rows); Quick Actions as a 2-column grid |
| Directory | Search full width; filters in one **Filters** sheet; each person a card (photo, name, ID · position, department, type, status); press = profile **full-screen sheet** |
| Organisation | Leadership summary stacked; tree as an **indented, expandable list** (not a shrunken chart); reporting lines as a list |
| Team Map | Department **chips** to choose a cluster; faces in a 3-column grid with names; Birthdays and On Leave below (an accessible list fallback) |
| Departments & Roles | Coverage card; pills scroll horizontally inside their own row; **department selector**; each person a card with the responsibilities chip and Read / Write |
| Staff Records | List first; choosing a person opens the record **full screen** with a back arrow; section tabs as a horizontally scrolling segmented control; Edit / Save / Cancel **sticky at the bottom** above the keyboard |

---

## 6. Access permission matrix

| Who | Tab | Directory and profile | NRIC / bank / statutory / address / emergency | Edit record | Reporting lines | Responsibilities | Role (system) |
|---|---|---|---|---|---|---|---|
| CEO | ✓ | all | **✓** | ✓ (amend saved) | ✓ | ✓ | ✓ (working roles) |
| super_admin / admin | ✓ | all | **✓** | ✓ (amend saved) | — | ✓ | — |
| HR admin | ✓ | all | **✓** | fill empty fields | — | ✓ | — |
| COO | ✓ | all | **today ✓ → proposed ✗ (S-1)** | read-only | ✓ | — (S-6) | ✓ |
| CCO | ✓ | all | **today ✓ → proposed ✗ (S-1)** | read-only | ✓ | — (S-6) | — |
| HOD / staff | ✗ (no Staff tab, unchanged) | own Profile only | own only | — | — | read own | — |

All checks stay on the server (`hr_manage`, `exec_view`, `org_assign`, `responsibilities_edit`, `role_assign`). **Users & Security is not touched.**

---

## 7. Data privacy assessment

1. **Finding (today):** `GET /staff/users` sends NRIC, bank account, EPF / SOCSO / tax numbers, home address and emergency contact for **everyone** to the COO, CCO and admin, as well as the HR tier. The browser holds them even on the Directory. The directive asks for stricter access (§9D) and IC masking in lists.
   **Proposal (S-1):**
   - the list route returns **no** sensitive fields;
   - a new **`GET /staff/users/:id/private`** returns them for one person, to `hr_manage` only (CEO, HR admin, super_admin, admin);
   - the read is audited (`staff.private_view`, no values logged);
   - lists show NRIC as `******-**-5673` at most.
   - This removes the COO's and CCO's sight of those fields. Payroll is unaffected (its own route).
2. Birthdays show **day and month** in lists and on the Team Map; the year and age only on the record.
3. On Leave shows **names only** (Leave's own PDPA rule).
4. Change history shows **who / when** for sensitive fields, never before / after values.
5. No sensitive value is written to error logs (already true); the new audit details carry field names only.
6. Mockup data (IC, phone, address, photos) is not copied anywhere.

---

## 8. Data integrity and audit strategy

| Change | Today | Proposed |
|---|---|---|
| Record fields (PATCH) | `staff.hr_update` with **field names** | Same; **plus before / after for non-sensitive fields** (position, department, employment status, dates) — S-12 |
| Reporting line | `staff.reports_to` from / to by name; loop, self, CEO and leaver checks | **+ reason, + effective date** (recorded) — S-8 |
| Role title / responsibilities | `staff.responsibilities_update` before / after | unchanged |
| System role | `staff.role_change` | unchanged |
| Documents | upload / delete audited | unchanged |
| Offboarding | one audited call (status, last day, sessions, 2FA) | unchanged; the sheet already lists held assets |
| Concurrent edit | last write wins | **refuse if the field changed since it was opened** (409) |
| Leavers | records kept, `left_on` | kept; never deleted |

---

## 9. Existing API reuse plan

| Need | Route | Change |
|---|---|---|
| The list | `GET /staff/users` | drop sensitive columns (S-1) |
| One person's private block | **new** `GET /staff/users/:id/private` | hr_manage; audited read |
| Save a section | `PATCH /staff/users/:id` | + optional `expect` (concurrency); + before / after in audit (S-12) |
| Change history | **new** `GET /staff/users/:id/history` | audit rows for that person (staff.* actions only); values masked for sensitive fields; hr_manage or exec_view |
| Reporting line | `PUT /staff/users/:id/reports-to` | + optional `reason`, `effective_on` in audit |
| Responsibilities | `PUT /staff/users/:id/responsibilities` | unchanged |
| Role | `POST /staff/users/:id/role` | unchanged |
| Photo / documents / onboarding | existing | unchanged |
| Probation and leaving counts | `GET /staff/people/overview` (HR) | read only, for the Overview count |
| On leave today | `GET /staff/leave/calendar` | unchanged |
| Offboard | `POST /api/v1/users/:id/offboard` | unchanged |

**No duplicate route, module or database.**

---

## 10. Proposed database changes

**Phase 1 and 2: none.** Everything above runs on today's columns.

**Only if you choose them (P3, one additive migration, next free number):**
- `users.employment_type`, so a leaver keeps "Contract / Permanent" (today offboarding overwrites the type with "resigned", which is why the reference's resigned row shows a type the database no longer has);
- `users.contract_end_on`, which "contract ending within 60 days" needs;
- a `departments` table (name, leader), which "department leadership" and "no duplicate departments" need (today a department is free text on the record);
- `staff_role_publications` for Draft → Published and staff acknowledgement.

Each is additive (ADD COLUMN / CREATE TABLE IF NOT EXISTS). There is no backfill without your approval.

---

## 11. Regression testing plan (all 30 directive checks)

- **New `tests/staff4.mjs`** (whole worker on SQLite, by direct request, with mutations), covering:
  - one Staff ID across list, record, history and documents;
  - the CEO cannot be given a supervisor; loops and self-reporting are refused;
  - a COO / CCO / sales request to `/private` gets 403, while the HR tier and CEO get 200;
  - the list carries no NRIC / bank / statutory / address;
  - a concurrent save gets 409;
  - responsibilities by a non-editor get 403 and grant no permission;
  - a resigned person stays in the list;
  - employment status ≠ attendance;
  - no permission entry changed except as approved;
  - Leave routing is untouched (the leave-chain test);
  - assets and task assignments still resolve by ID.
- **Browser `tests/browser/staff4.py`:**
  - the six views in the address, Back/Forward;
  - each tab against its reference;
  - CEO vs COO (no private block);
  - empty, loading and error states;
  - the eight widths with no sideways page;
  - the phone view switch and full-screen record;
  - search and filters.
- **Existing guards kept green:** `org-chart`, `role-assign`, `staff-headcount`, `staff-order`, `staff-responsibilities`, `hr4`, `attendance4`, `api-routes`, `tab-zones`, `lazy-panels`, the full 193-guard run with mutations.

---

## 12. Implementation phases

| Phase | Content | Migration |
|---|---|---|
| **P1 — the six tabs to the references** | Address and phone switch; Overview (1 card + attention list + quick actions); Directory (type column / filter, status vocabulary, row actions per S-3, cards removed); Organisation (summary, centred tree with search / expand / focus, lines strip); Team Map (department sectors, names, side panels); Departments & Roles (pills, dropdown, Add to department); Staff Records (header, Edit / Cancel / Save, six section tabs, completeness rows) | none |
| **P2 — privacy and integrity** | S-1 private split and masking; concurrency guard; change history; reporting-line reason / date; before / after for non-sensitive fields | none (permission change only) |
| **P3 — optional** | employment_type, contract_end_on, departments, publish / acknowledge | one additive migration |

**Rollback:** P1 and P2 are code only. Re-run PUSH.bat from the 1.307.0 files; no data is changed by any phase. P3's migration is additive and can be left in place harmlessly if its code is rolled back.

---

## 13. Classification of every change

| Change | Reuse | UI/UX | New function | Business logic | Permission | Database | CEO approval |
|---|---|---|---|---|---|---|---|
| Six tabs to references, address, phone switch | ✓ | ✓ | | | | | S-0 |
| Overview attention rows (probation, leaving, sign-in, incomplete) | ✓ | ✓ | | | | | S-2 |
| Directory status vocabulary (derived) | ✓ | ✓ | | ✓ (display) | | | S-4 |
| Row actions | | ✓ | | | | | S-3 |
| Profiles-missing-info definition | | ✓ | | ✓ | | | S-5 |
| Private block to hr_manage only | | | ✓ | | **✓** | | **S-1** |
| Responsibilities editors | | | | | ✓ (if widened) | | S-6 |
| Leave keeps following reporting lines | ✓ | | | | | | S-7 |
| Reporting-line reason / effective date | ✓ | | ✓ | | | (P3 option) | S-8 |
| Draft / publish / acknowledge | | | ✓ | ✓ | | ✓ | S-9 |
| No company filter | | | | | | | S-10 |
| No nationality / religion / gender / marital fields | | | | | | | S-11 |
| Change history + before / after audit | ✓ | | ✓ | | | | S-12 |
| employment_type / contract_end / departments | | | ✓ | ✓ | | ✓ | S-13 |

---

## 14. Decisions for you (GATE 3)

| # | Decision | My recommendation |
|---|---|---|
| **S-0** | Build the six tabs to the six references, each with its own address and the phone view switch | **Yes** |
| **S-1** | NRIC, bank, statutory, address and emergency contact are sent only for one person at a time, to the **HR tier and CEO** (hr_manage); the **COO and CCO stop seeing them**; NRIC is masked in every list | **Yes** — the one privacy gap the audit found |
| **S-2** | Overview attention: roles not written · incomplete records · probation ending ≤30 days (count, opens HR) · leaving ≤60 days · sign-in blocked · not on chart | **Yes** |
| **S-3** | Directory row actions: **(a)** the reference's two buttons, Profile · Record, or **(b)** the directive's single row press + ⋯ menu | **(b)** on phones; **(a)** on desktop, as the photo shows |
| **S-4** | Status vocabulary: Active · On probation · On notice · Resigned · Terminated · Starting · Inactive (no "Contract ended", no "Suspended" — neither exists in the data); Team Map's "Active Today" relabelled "Active Staff" | **Yes** |
| **S-5** | "Profiles Missing Info" = an active record missing any of: full name, NRIC, birth date, phone, Staff ID, position, department, joined date, bank, account, emergency name + phone | **Yes** (12 required of the 22) |
| **S-6** | Who writes responsibilities: keep the **CEO + HR tier**, or add the **COO and CCO** as the directive says | **Keep** (widen only if you want it) |
| **S-7** | Leave keeps routing to the reporting-line manager (approved v1.260); nothing in Staff changes any approval engine | **Keep** |
| **S-8** | A reporting-line change asks for a **reason** and an **effective date**, recorded in the audit; the line changes on save (no scheduling) | **Yes**, record only |
| **S-9** | Draft → Published and staff acknowledgement of responsibilities | **Not now** (P3, needs a table) |
| **S-10** | Company filter on the Team Map | **No** (one workforce) |
| **S-11** | Add Nationality, Religion, Gender, Marital Status (shown in reference 06) | **No** — PDPA-sensitive, no business use |
| **S-12** | Change history per person; before / after kept for non-sensitive fields only | **Yes** |
| **S-13** | P3 migration: employment_type, contract_end_on, departments table | **Later**, separate approval |
| **S-14** | Order: P1 then P2 in one release (1.308.0), P3 separate | **Yes** |

**ONE EMPLOYEE MASTER RECORD · ONE ORGANISATION STRUCTURE · ONE DEPARTMENT AND POSITION SOURCE · ONE DIRECTORY.** Nothing is coded until you approve.
