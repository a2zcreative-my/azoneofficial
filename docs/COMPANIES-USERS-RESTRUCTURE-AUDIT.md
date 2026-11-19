# Companies & Users & Security restructuring: audit and proposal

Status: **approved and built (local, not deployed).** The CEO approved D1-D5 as recommended on 18-11-2026; it was built on 19-11-2026 with no migration and no permission change (see CHANGELOG, Unreleased). The audit below is kept as written. It was written on 18-11-2026 from the source on the owner's PC (local main, version after 1.375).

The rule this follows comes from the brief: **Companies manages legal entities. Users & Security manages access. HR manages employment. Finance manages financial ownership.**

Wireframes are in `docs/companies-users-wireframes/`:
- `01-companies-overview.png` is the first reference.
- `02-users-security.png` is the second reference.
- `03-company-access.png` follows the current Staff Access screen and the second reference's table.
- `04-company-access-drawer.png` shows the review drawer, with employer and access saved separately.
- Phone versions are the `-phone.png` files. The source is `wireframes.html` (open it with `?s=1` to `?s=4`).

Every figure in a wireframe is marked as sample data. None of it is production data.

---

## A. Architecture audit

### A1. What exists today

| Surface | File | Who sees it (from `lib/portal-tabs.ts` / server) | What it does |
|---|---|---|---|
| Companies → Ownership Review | `components/portal/companies-panel.tsx` (`CompaniesReview`) | super_admin and ceo (`company_review`) | Reviews which company each record belongs to, across 9 registers. Today it proposes or defers only. |
| Companies → Staff Access | same file | super_admin and ceo (`company_review`) | Proposes each person's employer and A2Z / AZ ONE membership (read / write), with a version, a reason and a history. |
| Companies → Audit & History | same file | super_admin and ceo | Shows `company_review_events`, filtered by ownership or staff. The table cannot be changed (triggers). |
| Companies → Document & Signing | `signing-panel.tsx` (`SigningPanel`) | super_admin, ceo, coo, cco. Writes need `signAdmin` (ceo or super_admin). | Signing policy, signing authorities per company, signatures and stamps. |
| Companies KPI strip and readiness checklist | same file | super_admin and ceo | Counts not reviewed and reviewed but not settled, plus readiness steps (n of 9). |
| Users → Overview | `users-overview.tsx` | super_admin, admin, ceo, coo | Tiles, sign-in and access tables, pending items, quick actions. |
| Users → Staff Accounts | `users-panel.tsx`, `email-move.tsx`, `account-sheet.tsx` | the same | The account register, the account drawer, inviting a user, and the move to @a2zcreative.my. |
| Users → Customers & Agents | `customers-agents.tsx` | the same | Customer and agent accounts, and granting or revoking agent access. |
| Users → Roles & Permissions | `roles-permissions.tsx`, `access-policy.tsx` | the same. Edits need ceo or super_admin plus a code. | The role matrix (`/staff/access/policy`) and per-user exceptions. |
| Users → Security & Sessions | `security-sessions.tsx`, `security-status.tsx`, `owner-card.tsx`, `geofence-card.tsx`, `support-card.tsx` | the same | Five parts: Overview, Company owner, Office location, Problem reports, System health. |
| Users → Audit History | `users-panel.tsx` | ceo, admin, super_admin (`audit_read`) | The full `audit_log`. |
| HR / Staff | `components/staff/staff-directory.tsx`, `people-panel.tsx` | HR roles | Department, `role_title`, `reports_to`, employment status, `joined_on`, `rejoined_on`, `left_on`. |

Server routes (none of them change in this proposal):

- **Company review**, under `/staff/companies/*` in `worker/src/company-review.ts`, behind `canUser(user, "company_review")`:
  - `GET /summary`
  - `GET /records`
  - `GET` and `PUT /records/:kind/:id`
  - `PUT /records/bulk` (with `dry_run`)
  - `GET /staff`
  - `PUT /staff/:id`
  - `PUT /staff/bulk`
  - `GET /events`
- **Signing**, under `/staff/signing/*` in `worker/src/signing.ts`.
- **Accounts**, under `/users*`, `/staff/accounts/*`, `/staff/access/policy`, `/staff/owner` and `/staff/recovery`.

Tables (none of them change):

- **Company review** (migration 0134): `company_review_decisions`, `company_staff_setup`, `company_memberships` and `company_review_events` (append-only).
- **Signing:** `signing_authorities`, `signing_assets` and `signing_policies`.

### A2. Where each relevant field really comes from

| Field | Single source today | Owner after the split |
|---|---|---|
| Legal name, registration, address, bank, descriptor, email | `lib/issuers.ts` (`AZ_ONE`, `A2Z_CREATIVE`), held by `tests/document-issuer-guard.mjs`. It is code, not a database row, so it changes only by release. | Companies (read-only) |
| Which company issued a document | the `issuer_code` stamped on each document. NULL means a legacy AZ ONE OFFICIAL document. | Finance / Sales (unchanged) |
| Payslip employer of record | `payslip_releases.issuer_code` per month (0073 / 0104) | Payroll (unchanged) |
| A person's legal employer | **No HR field exists.** The only per-person value is `company_staff_setup.employer_code`, a reconciliation proposal. The evidence beside it is the employer on the person's last released payslip. | HR, once a field exists (decision D2) |
| A person's company access, **effective** | **Their role.** Company restrictions are not active (`enforcement: "not_active"`), so every person sees both companies' records as their role allows. | Users & Security |
| A person's company access, **proposed** | `company_memberships` (read / write per company) | Users & Security → Company Access |
| Record ownership, proposed | `company_review_decisions` across 9 registers: expenses, purchase orders, bank accounts, cash-flow entries, reconciliations, inventory items, manual stock-outs, stock ledger, journal entries | Users & Security → Company Access (decision D1) |
| Company owner | `system_meta.company_owner`, verified in `getSessionUser` as `is_owner` | Companies (read) and Users & Security (designated in Security, as today) |
| Authorised signatories | `signing_authorities` (person, company, capacity prepare / approve, document types) | Companies → Ownership & Directors (read) and Documents & Signing (edit, unchanged) |
| Directors and management appointments | **Not stored anywhere** | Companies, once approved (decision D4) |
| Roles and permissions | `PERMS` defaults plus saved cells in `system_meta.role_permissions` | Users & Security (unchanged) |
| Money In / Money Out per company | `GET /staff/erp/cashbook?company=` (bank account company, verified receipts only) | Finance (read here, not copied) |
| Invoices, sales and outstanding per company | **No read splits these by issuer today.** `/docs/summary` covers the whole table. | Finance (decision D3) |

### A3. Wrong or duplicated responsibilities

1. **Access work lives in Companies.** Staff Access (membership read / write per company) is access control, so it belongs in Users & Security. Users & Security has the roles but not the company plan, so a reviewer needs two modules to answer one question: what can this person reach?
2. **Employment and access are mixed in one form.** The Staff Access form edits the proposed employer and the company memberships together, with one reason and one version. The brief says these must stay separate: changing an employer must not change access, payslips or financial records. Today a reviewer sets both at once.
3. **Companies does not manage the companies.** None of its four tabs shows the legal entities themselves: registration, address, bank, who owns them or who may sign. That data is only in `lib/issuers.ts` and the printed documents.
4. **There are two audit surfaces for one module.** Companies → Audit & History holds the review events, and Users → Audit History holds the `audit_log`. That is acceptable, because they are different tables, but each needs a clear purpose (see B).
5. **Users → Overview repeats the other tabs.** Its figures repeat the Staff register, and its quick actions repeat the tab buttons. The brief's five tabs have no Overview.
6. **The readiness checklist (n of 9) looks like progress toward enforcement**, but 5 of its 9 steps are build steps that need a separate approved release. Moving it must keep the words "Not active".

### A4. Risks

| Risk | Guard in this plan |
|---|---|
| Moving Company Access is read as switching on restrictions | The "Reconciliation only - company access restrictions are not active" notice moves with it. The server keeps answering `enforcement: "not_active"`. Effective access and proposed access are separate columns. |
| COO gains the company review by being in Users | The Company Access tab is drawn only for holders of `company_review` (ceo, super_admin), and every route still refuses everyone else (403). The COO sees exactly what they see today. |
| CCO loses Document & Signing | The CCO keeps Companies (read) and Documents & Signing (read). `signing.ts` still decides writes. |
| Old links (`Companies` + `review` / `staff`) stop working | The start words map to Users & Security → Company Access. `?view=overview` on Users maps to Users. |
| A figure is invented to fill the reference layout | Every tile reads an existing route. Controls the system cannot perform are left out, never drawn dead (the owner's v1.191.0 rule). |
| History is lost in the move | Nothing moves in the database. Only the screen that draws `company_review_events` changes place, and the table stays immutable. |
| Financial records are reassigned | No write route is added. Company Access proposals never write to a source table (that guarantee is already tested in `companies-v2` / `company-review`). |

---

## B. Proposed structure

### B1. Navigation map

**Before**
```
System
├─ Companies            Ownership Review · Staff Access · Audit & History · Document & Signing
│                       (COO / CCO: Document & Signing only)
└─ Users                Overview · Staff Accounts · Customers & Agents · Roles & Permissions
                        · Security & Sessions (Overview · Company owner · Office location ·
                          Problem reports · System health) · Audit History
People
└─ HR / Staff           records, department, position, reporting line, dates (no employer field)
```

**After**
```
System
├─ Companies            Company Overview · Corporate Details · Ownership & Directors
│                       · Documents & Signing · Audit & History · Access Summary (read-only)
└─ Users & Security     Users  [Staff | Customers & Agents]
                        · Roles & Permissions
                        · Company Access  [Staff access | Record ownership]   (CEO / Super Admin only)
                        · Security & MFA  (the same five parts)
                        · Audit Logs
People
└─ HR / Staff           unchanged; legal employer added only if D2 is approved
```

There are no new modules. The rail keeps "Users", worded "Users & Security" as in the reference. Companies keeps its place in System.

### B2. Who sees what (unchanged permissions)

| Tab | super_admin | ceo | coo | cco | admin |
|---|---|---|---|---|---|
| Companies (all six tabs) | ✓ | ✓ | read | read | - |
| Companies → Documents & Signing, changes | ✓ | ✓ | - | - | - |
| Companies → Access Summary, review figures | ✓ | ✓ | words only | words only | - |
| Users & Security → Users, Roles, Security, as today | ✓ | ✓ | ✓ | - | ✓ |
| Users & Security → Company Access | ✓ | ✓ | - | - | - |
| Users & Security → Audit Logs (`audit_read`) | ✓ | ✓ | - | - | ✓ |

The CEO's authority over both companies is unchanged: the owner grants (`OWNER_GRANTS`) and `company_review` stay where they are.

### B3. One home for each function

| Function | Home | Everywhere else |
|---|---|---|
| Legal-entity identity | Companies → Corporate Details | Printed documents only |
| Signatories, signatures, stamps, signing policy | Companies → Documents & Signing | The Ownership & Directors tab lists signatories read-only, with a link |
| Company owner designation | Users & Security → Security & MFA → Company owner (as today) | Companies → Ownership & Directors shows it read-only |
| Accounts, login identity, MFA, sessions | Users & Security | - |
| Roles and permissions | Users & Security → Roles & Permissions | - |
| Company access plan and record-ownership reconciliation | Users & Security → Company Access | Companies → Access Summary gives counts, the state and a link |
| Employment (employer, department, position, dates) | HR / Staff | Company Access shows the employer as evidence, read-only |
| Financial figures per company | Finance | Companies → Overview gives a read-only glance and a link |

### B4. Audit, with two purposes
- **Companies → Audit & History** shows corporate changes: `signing.*` and `owner.*` rows of `audit_log`, plus record-ownership review events.
- **Users & Security → Audit Logs** shows everything else about accounts, unchanged. Staff-access review events sit next to the matrix (the person's History in the drawer) and in Audit Logs filtered to `subject_kind = staff`.

---

## C. UI design (wireframes)

All three screens use the existing system only:
- `LineTabs` for tabs and `PillSwitch` for the in-tab switches.
- `KpiRow` / `KpiTile` as one connected strip.
- `SideDrawer` for details and forms.
- `PaginationControls` with 10 rows a page.
- `FillPanel` from 1024px.
- Tokens: navy `--foreground`, gold `--accent`, white `--card` on `--secondary`.

No new tab exists beyond the brief's list. No horizontal page scroll: a wide table scrolls inside `.erp-table-scroll` and its first column is pinned.

1. **Companies → Company Overview** (`01-companies-overview.png`), from the first reference:
   - **Company cards:** two, one per company, read from `lib/issuers.ts`. Each shows the logo, legal name, registration and a status chip: "Operating issuer" for A2Z and "Legacy issuer" for AZ ONE. Underneath are four facts:
     - Issuing since or until (the 19-08-2026 switch)
     - Business type (descriptor)
     - Bank accounts (count of `bank_accounts` by company)
     - Proposed members (from Company Access, labelled as proposed)
   - **Company at a Glance:** per-company figures from Finance, behind the existing revenue permission, with a link to Finance (D3).
   - **Quick Actions:** only actions that exist.
     - Manage signatories → Documents & Signing
     - View access summary
     - Open Company Access
     - Open HR / Staff
   - **Two link cards:** Company Access & Roles, and Employment & Staff.
   - **Important Notes:** the four responsibility lines from the brief.
2. **Users & Security → Users** (`02-users-security.png`), from the second reference:
   - **Strip:**
     - Active users, of the total
     - Roles in use
     - Companies: 2, with "Restrictions not active"
     - MFA x / y with a percentage
   - **User Accounts card:**
     - Actions: Export CSV, and Add User for those who can invite.
     - Filters: search, Status, Role, Company (proposed plan).
     - Columns: User, Role, Company Access (effective; proposed shown dashed), Permissions (the role's verbs from the matrix), MFA, Last login, Status, ⋮
     - The ⋮ menu opens the existing account drawer.
   - **Switch:** Staff / Customers & Agents is a switch inside the tab.
3. **Users & Security → Company Access** (`03-company-access.png`):
   - **Notice:** the existing one, word for word.
   - **Strip** (from `/summary`, never hard-coded):
     - Companies
     - Not yet reviewed
     - Reviewed, not settled
     - Readiness n of 9
   - **Switch:** Staff access / Record ownership.
   - **Staff access matrix columns:** Staff, Role, Legal employer (proposed, with the payslip evidence), A2Z, AZ ONE, Current effective access, Proposed access, Review status, History.
   - **Row actions:** opening a row opens the review drawer with the same form, reason, version and history as today. Selecting rows opens the existing bulk preview (`dry_run`).
   - **Record ownership:** the existing 9-register review, unchanged.

---

## D. Functional requirements

**User actions** (all existing):
- Accounts:
  - invite a user
  - edit an account
  - reset 2FA or send a set-password link
  - suspend or offboard
  - sign out devices
  - change login email (pending until verified)
  - grant or revoke agent access
  - export the shown list as CSV (no secrets, no tokens)
- Roles: edit a role cell with a reason and an authenticator code.
- Company access: propose, with a reason, a person's company plan, singly or in bulk with a preview.
- Record ownership: propose or defer a record's company, with a reason, singly or in bulk.
- Companies:
  - manage signing (CEO or Super Admin)
  - read corporate details
  - read the owner and signatories

**Company scope:**
- Effective access is decided by role only, until a separate approved release turns enforcement on.
- That release needs the five build steps already on the checklist: ownership columns, scoped queries, job scope, pilot and rollback switch, all enforced on the server, never only in the interface.

**Audit and review:**
- Every proposal writes one guarded `company_review_events` row and an `audit_log` row (as today). The history is immutable.
- A record that changed after review shows "Changed" and must be reviewed again (as today).
- Changing an employer proposal never changes a membership, and the reverse is also true. From this release they are saved as two separate actions in the drawer, through the same `PUT /staff/:id` with the other half sent unchanged, so no server change is needed. Each save still needs its own reason of 8 characters or more.

**Never touched:** invoice ownership, transactions, Paid or receipt verification, commission, payroll, payslips, MFA, passkeys and recovery.

---

## E. Implementation plan (after approval)

**Files** (interface only, with no worker change unless D3 is approved):
- `components/portal/companies-panel.tsx`, rebuilt as the six Companies tabs. Its review code moves out unchanged.
- `components/portal/company-access.tsx` (new), holding the moved `CompaniesReview` staff and records workspaces. Same calls, same forms, same drawers.
- `components/portal/companies.module.css`, split into `companies.module.css` (corporate) and `company-access.module.css`.
- `components/portal/users-panel.tsx`:
  - tabs become Users, Roles & Permissions, Company Access, Security & MFA, Audit Logs;
  - the Overview figures move into the Users strip;
  - Customers & Agents moves behind a switch;
  - Company Access mounts lazily, and only for `company_review` holders.
- `components/portal/users-overview.tsx`, retired. It is kept in the repository for rollback, like `access-review-card.tsx`.
- `lib/portal-tabs.ts` and `lib/record-focus.ts`: tab hints, the "Users & Security" label, and old start words mapped as follows:
  - `Companies` + `review` / `staff` → Users + `company-access`
  - `overview` → `users`
- Optional, D3 only: a read-only `?issuer=` on `GET /staff/docs/summary`.

**Migration:** none. No table, column or permission changes. It is an interface release.

**Tests:**
- Update: `companies-v2`, `company-review`, `tab-concept`, `users-ui`, `navigation`, `go-live-i`, `ui-system`, `kpi-strip-only`.
- Browser: `kpi-strip-sweep.py`, `overflow-sweep.py`, `users-outset.py`, `owner-door.py`.
- New guard, `tests/companies-users-split.mjs`, which checks that:
  - Company Access is drawn only for `company_review`, and the server still answers 403 to coo, cco and admin;
  - the "not active" notice is present;
  - `/summary` still says `enforcement: "not_active"`;
  - no Companies file calls a permission or role write;
  - every tile value comes from a fetched field (no number literals);
  - employer and membership saves are separate requests;
  - each old start word lands on the new tab.
- Browser: each tab at 1440, 1024, 820 and 390, for CEO, COO, CCO and admin, with zero overflow.

**Rollback:** the release is only the interface. Revert the listed files (or redeploy the previous build). No data or route changes, so the old screens work against the same database immediately.

---

## Decisions for the owner

- **D1. Where the 9 record-ownership registers go.**
  - The brief places all of the reconciliation under Users & Security → Company Access. They are about which company owns financial records, not about access.
  - **Recommended:** move them with the staff matrix, as a "Record ownership" switch, so the whole reconciliation, its readiness checklist and its history stay together in one place.
  - Alternative: keep them in Companies.
- **D2. Legal employer.**
  - HR has no employer field today, only the reconciliation proposal.
  - **Recommended:** label it "Proposed employer (reconciliation)" now. Add an HR-owned employer field later, as a separate approved release with a migration.
- **D3. Invoices, sales and outstanding per company on the Companies Overview.**
  - Money In / Money Out per company exists.
  - The invoice figures need a read-only issuer filter on `/docs/summary`, a small server change.
  - **Recommended:** add the read-only filter, shown only to roles that already see revenue.
  - Alternative: show only Money In / Out.
- **D4. Reference controls that do not exist and will be left out:**
  - "Update Company Details": identity is legal data in code, held by the issuer guard.
  - "Upload Documents": there is no corporate document store.
  - The "Access Requests" tab: there is no such feature, and the brief forbids extra tabs.
  - "Bulk Actions" beyond the existing Move to @a2zcreative.my.
  - A directors register.
  - "Established" date: not stored. The issuing switch date is shown instead.
  - Each of these can be a later approved feature.
- **D5.** Remove the Users → Overview tab, as the brief's five tabs imply. Its figures move into the Users strip.

**Live figures:**
- Your screenshot shows:
  - 195 not reviewed
  - 53 reviewed but not settled
  - readiness 0 of 9
- This session cannot read production. The new screens read the same `GET /api/v1/staff/companies/summary`, so they will show whatever production holds.
- To check now, open that address while signed in as CEO, or sign in to the built-in browser pane and I will read it.
