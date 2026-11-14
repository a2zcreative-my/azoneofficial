# A2Z OS — Assets Workspace 4.0: Final UI/UX & Asset Lifecycle Blueprint

**Status:** GATE 1 (audit) and GATE 2 (design) only. **STOPPED AT THE GATE for your explicit approval.** Nothing has been coded, migrated, deployed or changed in production.
**Authority:** the CEO's directive "A2Z OS — Assets Workspace 4.0, Strict CEO Implementation Directive", with the reference pack (the five current tabs, five desktop references, five matching phone references and the Assets 4.0 Master Prompt), 14-11-2026.
**Baseline:** v1.302.0, now on your PC (not deployed). This blueprint supersedes the paused `ASSET-REGISTER-BLUEPRINT.md` (12-11-2026) and keeps the decisions you already took there: **A1** keep the existing asset tags, **A3** the COO may edit assets, **A5** an existing asset's company is set by a person and never guessed.
**Migration numbers:** the latest migration is 0192. The numbers 0187 and 0188 were reserved for Report Live and the old Asset Register; both now move after the latest, so Assets 4.0 starts at **0193**.

Codes used in every table: **EXISTS** (built and verified in the code today) · **UX** (screen change only) · **NEW** (new function) · **DB** (database change) · **SEC** (security rule) · **CEO** (needs your decision).

---

## 1. Existing functionality audit (verified in the code, v1.302.0)

| Piece | Where | What it does today |
|---|---|---|
| Asset table | `worker/migrations/0058_assets.sql`, `0126_assets_soft_delete.sql` | One row per asset, holding: `asset_tag` (unique; auto `AZOA-001…` when left empty, otherwise as typed — your screenshots show `ET-0001/2026`), name, category (electronics / furniture / vehicle / studio / other), brand_model, serial_no, purchase_date, `purchase_price_cents` (**NULL when unknown**), vendor, warranty_until, location (free text), `assigned_to` (one staff id), status (in_use / spare / repair / lost / disposed), condition_note, and timestamps. An entry typed by mistake is soft-deleted (audited). |
| Routes | `worker/src/staff.ts` ~8941 (`GET`/`POST /assets`), ~9215 (`PATCH`/`DELETE /assets/:id`) | **Read:** `hr_manage` + `exec_view` (super admin, admin, HR admin, CEO, COO, CCO). **Write:** `hr_manage` only (super admin, admin, HR admin, CEO). **The COO cannot write yet**, although you approved it (A3). Every write is audited, but PATCH stores the request body, not the before and after values. |
| Screen | `components/portal/assets-panel.tsx` (1,126 lines), `assets-page.module.css` (854) | **Already has your five tabs:** Overview, Asset Register, Assignments, Maintenance & Disposal, Reports & Audit. One asset drawer (SideDrawer), list/grid, search, filters, pages, CSV, status change (asks first for Lost and Disposed), Add/Edit only for roles that may write. |
| Overview figure | assets-panel.tsx line 292 | "Total Asset Value" = the sum of purchase prices excluding Lost and Disposed. **An unknown price counts as RM 0 silently** (your screenshot: the RICOH printer shows "—", but the total does not say one price is missing). It is also labelled "value", although it is **purchase cost**, not net book value. |
| Assignments | assets-panel.tsx ~790–840 | Grouped by holder, with an "Unassigned" list. **No custody history.** The screen itself says "Proposed, not built". The previous holder survives only inside audit-log text. |
| Maintenance & Disposal | assets-panel.tsx ~845–870 | Three lists filtered by status (In repair / Lost / Disposed) and a rules card. **No repair, incident or disposal records.** The screen says "Proposed, not built". |
| Reports & Audit | assets-panel.tsx ~870+ | A status summary and a few groupings computed **in the browser** from the register. The audit trail reads `/audit`, which is **`audit_read` = super admin, admin and CEO only**, so the COO, CCO and HR admin see an empty audit tab. |
| Company | — | **An asset carries no company.** A2Z CREATIVE MARKETING and AZ ONE OFFICIAL are not separated. |
| Documents | — | No receipts, invoices, warranty cards or repair bills on an asset. |
| Finance | `worker/src/ledger.ts`, `business.ts` | **Cash-basis books.** There is no fixed-asset account, no accumulated depreciation and no depreciation policy. Equipment is bought as an **expense** (`expenses.category = 'equipment'`). Nothing about assets is posted to the ledger. |
| Who sees the tab | `lib/portal-tabs.ts` ~384 | HR admin, COO, CCO, CEO, super admin, admin. **Ordinary staff cannot see the assets they hold.** |
| Roles | `worker/src/permissions.ts` | The roles are super_admin, admin, editor, marketing, live_host, hr_admin, sales_marketing, ceo, coo, cco, agent. **There is no "HOD" and no "Asset Admin" role.** A head of department can only be derived from `users.reports_to` (0113). |
| Phone | assets-panel.tsx line 440 | One `LineTabs` row with five long labels. **It is cut off on a phone** (the defect you flagged on Ecommerce and Financial Advisory). No view switch, and no address per tab (Back/Forward and links do not open a tab). |

**Bottom line:** the five-tab shell and the register exist and work. Custody history, maintenance, lost/disposal records, documents, company separation, honest cost labelling and a staff view do **not** exist.

## 2. Each current tab against its references

| Tab | Current screenshot | Desktop reference | Phone reference | Gap → class |
|---|---|---|---|---|
| **1 Overview** | 6 status tiles, a "Total Asset Value" card, an Asset-by-Status donut and Recent Activities (as separate cards) | One page: status strip (Total · In Use · Spare · In Repair · Lost · Disposed with % of total); donut with legend; Recent Activities with "View all"; **quick actions** (Register · Assign · Report maintenance · Dispose · View reports); compact previews of the Register, Assignments, Maintenance and Reports with an **Asset Detail** panel | 2×2 status grid, total, then "Total Asset Value" bar; tab switch | Rename the value to **"Recorded purchase cost"** with "n without a price" (UX). Quick actions (UX). Recent activity from custody/maintenance events once they exist (NEW, P2). **Not built:** the reference's mini copies of every tab on the Overview. The directive says "Do not combine all five reference screens into one page", so the Overview gets the strip, the donut, activities and quick actions, and each preview links to its own tab. |
| **2 Asset Register** | Table: Tag · Item · Brand · Location · Status · Value · actions; pager | Search; Category · Location · Status filters; list/grid; table with **Assigned To**; pager "Showing 1–10 of 25"; **Asset Detail** panel (photo, tag, status, Brand, Category, Serial, Location, Assigned to, Purchase date and value, Warranty) with tabs **History · Assignment · Maintenance · Documents** | Card list (icon, item, tag, location, status chip) | Add Assigned To / Company columns and filters (UX + DB company). Turn the drawer into the Asset Detail with four tabs (UX; the tab contents need P2–P4 records). Cost shown as "—" with "No price recorded", never RM 0 (UX). |
| **3 Assignments** | Holder rows (name, count, RM); unassigned count | Search staff or asset; status and location filters; a row per person (avatar, role, n assets, RM) → their assets | Person cards | **Custody workflow** Assign → Acknowledge → Transfer/Return, with history (NEW + DB, §5). **Shared-use** custodian (NEW + DB). |
| **4 Maintenance & Disposal** | Three tiles (In Repair / Lost / Disposed), sub-tabs, "No maintenance record", + New Maintenance | Sub-tabs **In Repair · Lost · Disposed · Service History**; empty state "No assets in repair"; **Report Maintenance** | Three counts and + New Maintenance | **Requires separate approval (NEW):** repair records, expenses, service history, lost incidents, disposal requests and approval (§6). Until approved, the tab keeps today's status lists honestly labelled. |
| **5 Reports & Audit** | Report list (Status Summary, Category, Location, Assignment Summary, Maintenance History, Lost & Disposal, Audit Trail) beside an Asset Status Summary with a donut | **One report selector** + month picker; Asset Summary (Status · Assets · Share · Purchase Value); Assets by Category bar chart | Report list → report | One selector, one figure source (§7). Export CSV (opens in Excel) and PDF (UX, reuse). Audit trail visible to the roles you decide (CEO D-7). |

**Not built from the photos, because the directive's own rules forbid it:**
- the label "Total Asset Value" on a purchase-cost sum;
- a stock photo of a laptop (an asset shows its own photo, from Documents, or an icon);
- a depreciation or "book value" figure;
- the new tag style "ET-0001/2026" applied to the AZOA assets (all tags stay exactly as stored);
- the reference's sample people and figures, unless they are the real register rows.

## 3. React components and APIs to reuse (no new design system)

| Need | Reuse | Where |
|---|---|---|
| Tab row (desktop) | `LineTabs`, `TabAside`, `TabAction` | `components/ui/line-tabs.tsx` (already used) |
| Phone view switch | `ViewSwitch` (the Dashboard's "CEO View" control, already used by Financial Advisory, Ecommerce, Desk and Sales) | `components/portal/executive-cards.tsx` |
| Address per tab | `useTabViewAddress("Assets", view, setView, allowed)` | `lib/tab-view.ts` |
| Status strip | `KpiRow`, `KpiTile` | `components/ui/kpi-tile.tsx` (already used) |
| Donut | `Donut` | `components/ui/donut.tsx` (already used) |
| Asset Detail | `SideDrawer` on phone/tablet; a right-hand panel from 1280 px | `components/ui/side-drawer.tsx` |
| Loading | `SkelRows`, `Skel`, `StaleHint` | `components/ui/skeleton.tsx` |
| Toasts, confirms | `useSaveToast`, `useConfirm` | already used |
| Cached register | `useCachedApi("/staff/assets")` with the "assets" topic | `lib/cached-api.ts` (already used) |
| People picker | `/staff/staff-list` | already used |
| CSV export | `downloadCsv` | `lib/csv.ts` |
| PDF report | `Canvas`, `assemblePdf` (several pages since 1.302.0) | `lib/doc-pdf.ts` |
| File upload (documents, photos) | `putGuarded` (type sniffed, size cap, private R2, served only after a permission check) | `worker/src/shared.ts` (as FA documents) |
| Notifications | `notify()` (no figures, no client names) | `worker/src/staff.ts` |
| Tasks for follow-up (e.g. a repair due back) | the Tasks module (`link_kind`) | as FA follow-ups (no second follow-up engine) |
| Audit | `audit()` | `worker/src/shared.ts` |
| Self-approval rule | `isExecutiveOwner` | `worker/src/decision-policy.ts` |
| Company identity | `resolveIssuer` (A2Z CREATIVE MARKETING / AZ ONE OFFICIAL) | `lib/issuers.ts` |

## 4. Asset Register and Asset Detail design

**One authoritative identity:** the `assets` row (id + tag) is the asset. Nothing is re-created or renumbered; every new record points to `asset_id`.

**The fields the directive asks to keep separate**, and where each one lives:

| Field | Stored | Today → Proposed |
|---|---|---|
| Lifecycle status | `assets.status` | EXISTS (in use / spare / in repair / lost / disposed) — unchanged |
| Assigned staff | `assets.assigned_to` | EXISTS; from P2 it changes only through the custody workflow (§5) |
| **Shared custodian** | `asset_profile.custody` = `person` / `shared` / `store` + `shared_label` (e.g. "Studio team", "Reception") | **NEW + DB.** A shared asset can be In Use with nobody named, and is no longer listed as "Unassigned". |
| Physical location | `assets.location` (free text) | EXISTS; Location filter built from the distinct values. A managed location list is **not** proposed (no second Locations module). |
| Owning company | `asset_profile.issuer_code` = `a2z` / `azoo` / NULL | **NEW + DB.** Existing assets show **"Company not set"** until a person sets it (A5). |
| Purchase cost | `assets.purchase_price_cents` | EXISTS; NULL = "No price recorded", **never RM 0** |
| Accounting valuation | — | **Not built.** A cash-basis system has no book value (§8). |

**Register (desktop):**
- search (tag, item, brand, serial);
- filters: Company · Category · Location · Status · Custody;
- list/grid;
- table: ☐ · Tag · Item · Brand · Company · Location · Assigned to (person, or the shared label in grey) · Status chip · **Purchase cost** · Actions (Edit · ⋯);
- pager "Showing 1–10 of N";
- bulk select **only** for export. There is no bulk status change and no bulk delete.

**Asset Detail** (the right-hand panel at 1280 px and wider, the drawer below that):
- **Header:** the asset's own photo if one is uploaded, otherwise an icon; item name; tag; status chip; company chip.
- **Facts:** Brand · Category · Serial · Location · Assigned to / Shared · Purchase date · Purchase cost ("No price recorded" when empty) · Vendor · Warranty until (with "expired" / "expires in n days").
- **Tabs:**
  - **History:** every event, newest first. Records written before 4.0 come from the audit log, marked "From the audit log (before 4.0)" and never converted into custody rows.
  - **Assignment:** custody events (P2).
  - **Maintenance:** repairs and incidents (P3).
  - **Documents:** receipts, warranty cards, repair bills and photos (P4).
- **Actions** (by permission): Edit · Assign/Transfer/Return · Report issue · Report lost · Request disposal · ⋯ (Remove an entry typed by mistake: the existing soft delete, management only).

**Edit rule (SEC):** PATCH stores **before and after** in the audit row (today it stores only the request). `assigned_to` and `status` can no longer be changed by a plain edit once P2/P3 exist. They change only through custody and maintenance actions, so nothing is overwritten without a record.

## 5. Custody workflow (Assign → Acknowledge → Transfer / Return → Audit history) — NEW + DB (P2)

```
                ┌────────── Transfer (to another person, with reason) ─────────┐
 Spare/Store ──Assign──► Issued (waiting) ──Acknowledge──► Held ──Return──► Spare/Store
                            │  (by the holder)                │   (condition noted)
                            └──Cancel (by the issuer)          └──Report lost → §6
```

- **`asset_custody`** (append-only) holds one row per event: `assign` / `acknowledge` / `transfer` / `return` / `cancel` / `shared` (set to shared use). Each row records `asset_id`, from-holder, to-holder or shared label, location, reason, condition at hand-over, actor, actor role and time.
- `assets.assigned_to` is updated **in the same request** as the event row (one `DB.batch`), so the register and the history can never disagree.
- **Acknowledge:**
  - The new holder confirms receipt from their own account (a new "My assets" view, CEO D-4).
  - Until then the register shows **"Waiting for acknowledgement"**.
  - Nobody can acknowledge for someone else.
  - An unacknowledged hand-over after 3 days goes to the issuer as an ordinary Task (no second engine).
- **Transfer** needs a reason (at least 10 characters) and records the previous holder. The previous holder is notified (no figures).
- **Return** records the condition; the asset goes to Spare (or In repair if the condition is "damaged").
- **No overwrite:** a plain PATCH of `assigned_to` is refused once P2 is live (409 `use_custody`).
- **Before-4.0 holders:**
  - The current holder in the register becomes the starting point.
  - **No historic assignment row is invented.**
  - Earlier holders appear only as audit-log history.
- **Cross-company transfer** (from an A2Z asset to AZ ONE) is a company change, not a custody move: CEO or COO only, with a reason, and audited (SEC).

## 6. Maintenance and disposal — NEW functionality, requires separate CEO approval (P3)

The audit is clear: **no repair tracking exists today.** Everything below is NEW.

| Record | Table (append-only) | Flow | Rules |
|---|---|---|---|
| **Issue report** | `asset_issues` | Any holder or manager reports: what is wrong, since when, a photo (optional) | The issue is not a status change. Management decides to send it for repair. |
| **Repair record** | `asset_repairs` | Sent on · repairer · reference · expected back (→ a Task) · returned on · outcome (fixed / not repairable) | Sending sets In repair; returning sets Spare or back to the holder. Each step is an event row. |
| **Repair expense** | `asset_repairs.cost_cents` (**a note**) + optional `expense_id` link | The real bill goes through **Finance → Expenses** as today | **No expense is created or posted here.** The link is read-only. |
| **Service history** | read from repairs and issues | Sub-tab "Service History" | — |
| **Lost incident** | `asset_incidents` | Reported by · last seen (where, when) · circumstances · police report ref (optional) · found again (closes it) | Sets Lost. **The asset row is never deleted.** Found again sets Spare, with an event. |
| **Disposal request and approval** | `asset_disposals` | Request (method: sold / scrapped / donated / returned to vendor / written off · reason · proceeds as a note) → **Approve or Reject** by the CEO or COO, **never the requester** (verified owner apart) | Approval sets Disposed. **No write-off is posted; proceeds are not recorded as income.** Finance records any sale proceeds in its own module. |
| **Permanent history** | all of the above | — | Update and delete triggers on every table. The asset row stays forever (the existing soft delete is only for an entry typed by mistake, never for Lost or Disposed). |

## 7. Reports and Audit — one selector, one figure source

- **One selector** (left list on desktop; a list on the phone that opens the report).
- **One figure source:** a single pure module `lib/asset-figures.ts` computes everything from the register rows: counts by status, share, recorded purchase cost, missing price, by category, location, company and custody. **Both the Overview and Reports use it.** Today they compute separately inside the panel; that is removed, so there are no duplicate calculations.
- **Reports:**

| Report | Source |
|---|---|
| Asset status summary | register |
| By category | register |
| By location | register |
| By company (A2Z / AZ ONE / Company not set) | register + `asset_profile` |
| Assignment summary (by person, by shared label) | register + `asset_profile` |
| **Missing information** (no price, no serial, no company, no purchase date, warranty expired) | register |
| Maintenance history | `asset_repairs` + `asset_issues` (P3) |
| Lost & disposal history | `asset_incidents` + `asset_disposals` (P3) |
| Audit trail | audit log (asset actions) + custody events |

- **Labels:**
  - "Purchase cost (recorded)" with "n assets without a recorded price — not counted".
  - Lost and Disposed are shown, but excluded from the active cost (as today).
  - **Never "net book value".**
- **Company separation:**
  - Every report has a company filter; the server applies it.
  - **Totals are never mixed:** with "Both companies" selected, each company gets its own line plus a "Company not set" line.
- **Export:**
  - CSV, which opens in Excel (reusing `lib/csv.ts`).
  - PDF, drawn in the browser with `lib/doc-pdf.ts`.
  - A true .xlsx file needs a new library: **CEO D-9**, recommended no.
- **Month picker** (reference): filters event-based reports (activity, maintenance, disposals) by month. A status summary is "as of today". A past-date snapshot is **not** proposed, because it would need history the system never stored.

## 8. Purchase cost and Finance integration review

| Question | Finding | Proposal |
|---|---|---|
| Is "Total Asset Value" a book value? | No. It is the sum of purchase prices typed in the register. | Rename it to **Recorded purchase cost**, with the note "Not a book value. A2Z OS keeps cash-basis books with no depreciation." |
| Missing prices | They count as RM 0 today, silently. | Shown as "No price recorded"; counted in the **Missing information** report; excluded from totals with "n not counted". |
| Fixed-asset accounting | Not in the system (cash basis; equipment is an expense). | **Not built.** A depreciation policy or fixed-asset ledger needs your accountant and is a separate scope (**CEO D-8**, recommended not now). |
| Link to the purchase | None | Optional **read-only link** from an asset to the existing expense that paid for it. Nothing is created or changed in Finance (previous decision A6, recommendation stands). |
| Repair costs | — | A note on the repair, plus an optional link to the expense. Finance pays and records it as today. |
| Disposal proceeds and write-offs | — | A note only. **No automatic write-off, no journal, no income row.** |

**Guards (tests):** the row counts of `expenses`, `journal_entries`, `journal_lines`, `cashflow_entries`, `invoice_payments` and `commission_ledger` are unchanged by every asset action.

## 9. Permissions matrix (server-enforced; the screen only reflects it)

There is no HOD role and no Asset Admin role today. Below is the mapping onto real roles (**CEO D-1, D-2**). "Self" = the custodian of that asset. "Team" = staff whose `reports_to` is the manager.

| Action | CEO | COO | CCO | HR admin ("asset admin" today) | Super admin / admin | Manager of a team (reports_to) | Staff | Agent |
|---|---|---|---|---|---|---|---|---|
| See the Assets workspace (all assets) | ✓ | ✓ | ✓ | ✓ | ✓ | team's assets only (D-2) | — | — |
| **My assets** (own, read) + Acknowledge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (D-4) | — |
| Add / edit an asset | ✓ | ✓ (A3) | — (D-1) | ✓ | ✓ | — | — | — |
| Assign / transfer / return | ✓ | ✓ | — | ✓ | ✓ | request only (D-2) | return own | — |
| Report an issue / report lost | ✓ | ✓ | ✓ | ✓ | ✓ | team | own | — |
| Repair records | ✓ | ✓ | — | ✓ | ✓ | — | — | — |
| **Approve disposal** | ✓ | ✓ | — | — | — | — | — | — |
| Change the company (cross-company) | ✓ | ✓ | — | — | — | — | — | — |
| Remove an entry typed by mistake (soft) | ✓ | ✓ | — | ✓ | ✓ | — | — | — |
| Reports + export | ✓ | ✓ | ✓ | ✓ | ✓ | team | — | — |
| Asset audit trail | ✓ | ✓ | ✓ | ✓ | ✓ (D-7) | — | — | — |
| Financial write-off | **nobody — not built** | | | | | | | |

**SEC rules:**
- Every route checks the cap **and** the row (company, custodian, team).
- Frontend role, owner or company values are never trusted.
- No self-approval: a requester never approves their own disposal (verified owner apart).
- No unconditional CEO allow-all and no email bypass.
- New caps: `asset_view`, `asset_manage`, `asset_dispose_approve`, `asset_company_change`, `asset_self`.
- The old `hr_manage` check on `/assets` is replaced by these caps with the **same people** plus the COO (A3).

## 10. Mobile PWA design (photos, bottom row)

- **Header:**
  - The page title "Assets ▾" is the **view switch** (the Dashboard's control, as in your phone references): Overview · Register · Assignments · Maintenance & Disposal · Reports & Audit.
  - **+ Add** sits beside it.
  - Never a cut-off tab row.
- **Overview:**
  - 2×3 status grid (Total · In Use · Spare · In Repair · Lost · Disposed).
  - Recorded purchase cost bar with "n without a price".
  - Recent activity.
- **Register:**
  - Search + "Filter ▾" sheet.
  - Cards: icon · item · tag · location · status chip, opening the Asset Detail as a full-height sheet with the four tabs as a segmented control.
- **Assignments:** person cards (avatar · name · n assets · cost) → their assets. **My assets** shows Acknowledge as a sticky button above the bottom navigation.
- **Maintenance:** three counts; segmented In Repair / Lost / Disposed / History; sticky "+ Report issue".
- **Reports:** a list of reports; a report opens full-screen with Export.
- **Rules:**
  - 44 px targets;
  - sticky bars sit above the bottom navigation (safe area);
  - no horizontal page scroll at 320–430 px;
  - tables become cards below 768 px;
  - breakpoints only 640 / 768 / 1024 / 1280.

## 11. Database / migration requirements (all additive; no ALTER of `assets`, no data rewrite)

| Migration | Phase | Contents |
|---|---|---|
| **0193_asset_profile** | P1 | `asset_profile(asset_id PK, issuer_code a2z/azoo/NULL, custody person/shared/store, shared_label, updated_by, updated_at)`. No row = "Company not set", custody worked out from `assigned_to` as today. |
| **0194_asset_custody** | P2 | `asset_custody` (events, append-only triggers) |
| **0195_asset_care** | P3 | `asset_issues`, `asset_repairs`, `asset_incidents`, `asset_disposals` (append-only; one CREATE per table, IF NOT EXISTS) |
| **0196_asset_documents** | P4 | `asset_documents` (kind, version, supersedes, R2 key, SHA-256, access, uploaded by; private R2 via `putGuarded`; no delete) |

Each migration is registered in `index.ts` (latest migration, expected list, health probe), `AGENTS.md` and `docs/ERP-ROADMAP.md`, as every migration is. ASCII comments only.

Before a migration is applied, the related screens fall back to today's behaviour and the new routes answer 503 `not_ready`. There is never a broken page.

## 12. Exact source files affected

| File | Change | Phase |
|---|---|---|
| `components/portal/assets-panel.tsx` | Split into panel + views; view switch + address; Overview strip, quick actions, honest cost | P1 |
| `components/portal/asset-register.tsx` (new) | Register table/grid + filters | P1 |
| `components/portal/asset-detail.tsx` (new) | The Asset Detail panel/sheet with four tabs | P1 (tabs fill in P2–P4) |
| `components/portal/asset-custody.tsx` (new) | Assignments, My assets, the custody forms | P2 |
| `components/portal/asset-care.tsx` (new) | Maintenance & Disposal | P3 |
| `components/portal/asset-reports.tsx` (new) | One selector, reports, export | P1 (P3 adds the history reports) |
| `lib/asset-figures.ts` (new) | The one figure source | P1 |
| `components/portal/assets-page.module.css` (+ module per new file) | Tokens only | all |
| `worker/src/assets.ts` (new) | `/assets` routes moved out of staff.ts **behind the same paths** (no duplicate API); profile, custody, care, documents, report data | P1–P4 |
| `worker/src/staff.ts` | Dispatch to assets.ts; the old asset block removed (moved, not copied) | P1 |
| `worker/src/permissions.ts` | The new asset caps (§9) | P1–P3 |
| `lib/portal-tabs.ts` | "My assets" for staff (D-4) | P2 |
| `worker/src/index.ts`, `AGENTS.md`, `docs/ERP-ROADMAP.md`, `CHANGELOG.md` | Migrations and records | each phase |
| `tests/assets4.mjs`, `tests/asset-custody.mjs`, `tests/asset-care.mjs`, `tests/browser/assets4.py`, fixture | Tests (§13) | each phase |

## 13. Tests

**Regression (kept and run every phase):**
- the current assets guards and browser checks;
- the full guard run with the mutation pass;
- lint ≤ 125; typecheck (app and worker); build;
- Finance, commission and payments guards unchanged.

**New, by direct request (with mutations):**
1. An HR, staff, agent or admin request outside their permission gets 403/404, for every new route.
2. The COO can edit (A3); the CCO cannot.
3. A missing price is never counted as RM 0; "n without a price" is correct.
4. Lost and Disposed are excluded from the active cost; In repair is included.
5. The company filter is applied by the server; Both = separate lines, never a mixed total.
6. A plain PATCH of `assigned_to` is refused after P2; assign/transfer/return write one event and update the register in one batch.
7. Only the new holder acknowledges; nobody acknowledges for another person.
8. A transfer needs a reason; the previous holder stays in the history.
9. A disposal is approved only by the CEO or COO, never by the requester.
10. Lost or Disposed never deletes the row.
11. Custody, issue, repair, incident, disposal and document tables are append-only (the database refuses update and delete).
12. Edit audit rows carry before and after.
13. No row is written to expenses, journals, cash, payments or commission by any asset action.
14. Existing tags, ids, prices and holders are unchanged by every migration.
15. Documents: wrong type, oversize and renamed files are refused; served only after login and permission; never a public link.

**Browser** (1440 / 1280 / 1024 / 768 / 430 / 390 / 360 / 320):
- every tab from its address; Back/Forward;
- the phone view switch; no sideways page; 44 px targets; nothing under the bottom bar;
- Asset Detail tabs;
- Acknowledge from My assets;
- the reports and both exports.

## 14. Implementation phases and rollback

| Phase | Scope | Migration | Rollback |
|---|---|---|---|
| **P1 — Layout, honesty, company** | View switch + addresses; Overview strip, donut, activity, quick actions; Register with Assigned To / Company; Asset Detail (History from the audit log); **Recorded purchase cost** + missing prices; one report selector with the register-based reports; CSV/PDF export; routes moved into assets.ts behind the same paths; edit audit with before/after; COO may edit (A3); company and shared custody on the profile | 0193 | Revert the files. `asset_profile` stays (never dropped); without it every asset reads "Company not set". |
| **P2 — Custody** | Assign → Acknowledge → Transfer / Return; My assets for staff; manager team view (D-2); unacknowledged follow-up as a Task | 0194 | Revert. Custody rows stay; `assigned_to` remains the truth. |
| **P3 — Maintenance & disposal** *(NEW, separate approval)* | Issues, repairs (cost note + expense link), lost incidents, disposal request and approval, Service History, history reports | 0195 | Revert. Records stay; statuses remain on the asset. |
| **P4 — Documents and photos** | Receipts, invoices, warranty cards, repair bills, asset photo | 0196 | Revert. Files stay in private R2. |

**Each phase:**
1. Build in the sandbox.
2. Run the full tests (guards with mutations, browser at 8 widths, direct-API permission checks).
3. Write the files to your PC.
4. **Your separate approval before PUSH.bat.** Nothing is deployed by Claude.

## CEO decisions needed

| # | Decision | Recommendation |
|---|---|---|
| **D-0** | Approve this blueprint and the phase order P1 → P4 (P3 is NEW maintenance/disposal functionality, approved separately) | **Yes; start P1** |
| D-1 | "Asset Admin" = HR admin (today's keeper of the register) plus the COO (A3) — no new role. Should the CCO also edit? | HR admin + COO; CCO reads |
| D-2 | "HOD" = a manager by `reports_to`: may see their team's assets and **request** an assignment or transfer; management approves | Yes |
| D-3 | Shared-use assets: custody "Shared" with a label (team / place) instead of a person | Yes |
| D-4 | Every staff member sees **My assets** (their own only) and acknowledges a hand-over | Yes |
| D-5 | After P2, the holder changes only through the custody workflow (plain edits of the holder refused) | Yes |
| D-6 | Disposal approved by the CEO or COO, never the requester (verified owner apart) | Yes |
| D-7 | The asset audit trail visible to CEO, COO, CCO, HR admin, admin (today only super admin, admin and CEO via the system audit log) | Yes — asset events only, not the whole system log |
| D-8 | Depreciation / book value | **Not now.** Recorded purchase cost only, needs your accountant |
| D-9 | Export: CSV (opens in Excel) and PDF; no new spreadsheet library | Yes |
| D-10 | Migrations 0193–0196 (additive), one per phase, each to Gate 6 | Yes |

---
Mockups: your two reference images are the design. They are not redrawn here. The deviations from them, all required by the directive's own rules, are listed in §2.
