# A2Z OS — handoff for the next Claude account (21-11-2026, 16:30 MYT)

Read this first, then `CLAUDE.md`, `AGENTS.md` and `docs/PROJECT-STATE.md` in the repository on the CEO's PC
(`C:\Users\Alif\Desktop\a2zcreative-official`). The PC copy is the source of truth; this note only tells you where
things stand and how the work has been done.

## Where things stand

- **Local version on the PC: 1.404.0. Nothing below 1.404.0 is deployed unless docs/PROJECT-STATE.md says so.**
  Deploying is ONLY `PUSH.bat` and ONLY after the CEO's separate go-ahead. It will apply migrations 0226–0230.
- **The Sales Command Center programme (7 phases) is fully built locally:**

| Phase | Version | Migration | What |
|---|---|---|---|
| 1 | 1.397.0 | — | My Sales Action Center (`worker/src/sales-today.ts`, `GET /staff/sales/today`) |
| 2 | 1.398.0 | 0226_crm_leads | Leads & CRM (`worker/src/crm.ts`) |
| 3 | 1.399.0 | 0227_sales_pipeline | Sales Pipeline (`worker/src/deals.ts` at `/staff/deals/*` — NOT `/pipeline`, which stays retired) |
| 4 | 1.400.0 | 0228_quotation_deal_link | Quotations & Invoices (deal link on save, `/docs/more`, `lib/quote-state.ts`) |
| 5 | 1.401.0 | — | Collections tab in Payments (`worker/src/collections.ts`, pure read) |
| 6 | 1.403.0 | — | Reports: Team Performance, Pipeline, Win/Loss, Lead Sources (`worker/src/sales-reports.ts`) |
| 7 | 1.404.0 | 0230_sales_playbook | Sales Playbook (`worker/src/playbook.ts`, `lib/playbook.ts`, `components/portal/sales-playbook.tsx`) |

- **1.402.0 is NOT ours:** another contributor built "Quotation & Invoice policies" (migration
  `0229_document_policy_version`, `quote_validity` permission, 14-day validity). Phases 6 and 7 were renumbered around
  it on 21-11-2026 (Phase 6 1.402.0→1.403.0; Phase 7 1.403.0→1.404.0 and its migration 0229→0230). Both are merged on
  the PC.
- Phase 7 was approved "As recommended" on nine decisions: readers = anyone with `sales` (never agent/customer);
  writers = new permission `playbook_manage` (CEO, COO, CCO — not super admin); staff see ONLY the published
  version; publish needs a note and notifies the other two; every version kept (append-only), restore via draft;
  archive with a reason, never delete; NO PRICE typed in (`priceProblem` refuses ringgit amounts, packages linked
  and shown at their live Packages-library price, must be active to publish); entry may be tagged with a pipeline
  stage → deal drawer "Playbook for this stage"; SOP files PDF/Word/image ≤10 MB, ≤5, private (`private/playbook/`);
  no quizzes; starts empty (no sample words from the CEO's picture); search inside only.
- Also in 1.404.0: the phone gold TabAction is 44 px (`components/ui/line-tabs.module.css`); `tests/browser/sales4.py`
  now finds the gold button under Turbopack class names (it had silently passed with 0 found).

## The seven programme decisions (CEO, 21-11-2026)

1. A persistent opportunity pipeline, kept apart from quotations, invoices, payment verification and closed sales.
2. Visibility option A: existing permissions; CRM opens on **Mine**; only managers reassign; audited.
3. The customer record is the CRM identity (owner, source, services); relationship ≠ opportunity status.
4. Won only on a linked quotation's acceptance or a linked invoice, or a manager override with a written reason.
   Lost needs a reason. Won is never revenue, payment confirmation or commission.
5. The full Daily Action Center only in Sales → Overview; Desk/Dashboard show counts and links.
6. Eight Sales views: Overview, Leads & CRM, Sales Pipeline, Quotations & Invoices, Payments, Closed Sales, Reports
   (Team Performance inside), Sales Playbook.
7. CEO, COO, CCO manage the Playbook with version history; pricing only from the Packages library.

Also: every active lead/deal has an owner and a next action; activity is kept apart from results; never use the
sample figures/names from his reference pictures.

## How the CEO works with Claude

- Phase by phase. For each: present a short plan with numbered decisions and a recommendation for each → he replies
  "As recommended" (or changes numbers) → build and test locally → save to the PC → short summary with screenshots.
- **Never deploy** and never start the next phase without his separate approval. Do not modify production data.
- He writes in English; the portal is bilingual EN/BM (`L("en", "ms")`).

## How to save to the PC safely (device bridge)

1. `device_stage_files` the PC files you will change → note each `mtimeMs`.
2. Other contributors work on the same tree. Compare the PC copy with your last committed copy; three-way merge
   (`git merge-file -p mine base theirs`) — never overwrite their work. CHANGELOG, CLAUDE.md, PROJECT-STATE,
   AGENTS, run-guards: only ADD entries.
3. Check migration numbers and the package version on the PC before naming yours (they can be taken while you work).
4. `SendUserFile` (display "attach") to get `file_uuid`s, then `device_commit_files` with `expectedMtimeMs` for every
   file that already exists. A rejected file means it changed — re-stage and merge.
5. The bridge drops sometimes: retry once, then tell the CEO and keep the ready files.

## House rules most often hit (full list in CLAUDE.md)

- New migration: additive; add `LATEST_MIGRATION`, the `EXPECTED_MIGRATIONS` entry and a health probe in
  `worker/src/index.ts`; name it in `docs/ERP-ROADMAP.md` and `AGENTS.md`. Never edit an applied migration.
- Every staff SQL list carries the own-role `counts_as_staff` clause (guard roles-v2 #15).
- UI: tokens only, CSS Modules, no utility classes; skeletons, never "Loading…" text; figures only as `KpiRow`;
  section rows only `LineTabs`/`PillSwitch`; forms in `SideDrawer`; a saving control shows feedback (`useFeedback`).
- Guards may only be tightened. Add the new guard to `scripts/run-guards.mjs`.
- Known pre-existing guard failures (not ours): action-feedback (attendance-correct.tsx), design-tokens
  (share-portfolio dialog), business-joins (tool pointers/GEMINI), in-app-viewer (target=_blank links),
  registry-parity (Digital Cards icon), interface-v3 (guard files missing in a sandbox copy).

## Tests for this programme

Server guards (whole worker on SQLite with every migration, plus mutation passes): `tests/sales-today.mjs`,
`crm-leads.mjs`, `pipeline.mjs`, `quotations.mjs`, `collections.mjs`, `sales-reports.mjs`, `playbook.mjs` (60 checks,
10 mutations), `sales4.mjs`, `sales2.mjs`.
Browser (Playwright on `tests/browser/serve.mjs out <port>` with `ROLE=`): `sales-today.py`, `crm.py`, `pipeline.py`,
`quotations.py`, `sales-collections.py`, `sales-reports.py`, `sales-playbook.py` (46/46), `sales4.py` (432/432), `sales2.py`.
Ports used: 4177 ceo, 4178/4179 coo, 4180 live_host, 4182 sales_marketing, 4183 marketing, 4184 super_admin.

## Open next steps (all need the CEO)

- Deploy 1.397.0–1.404.0 with `PUSH.bat` (applies 0226–0230) — only on his go-ahead.
- After deploy: CEO/COO/CCO write and publish the first Playbook entries (it starts empty by decision).
- Other active work in the project: Digital Card Template Studio / AZ ONE storefront, staff portfolios, ELFIA bridge
  (paused). See the `claude/` audit and gate docs.
