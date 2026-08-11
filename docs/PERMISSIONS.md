# AZ ONE OFFICIAL — Role Permission Matrix

Generated 11-08-2026 (v1.4.282) **from the live `PERMS` table in worker/src/staff.ts** — auditor pick 2.
Regenerate whenever PERMS changes; this file documents, the code decides.

## Capability matrix

| Capability | super admin | admin | ceo | coo | cco | hr admin | sales marketing | marketing | editor | live host | customer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hr_manage | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · | · |
| team_manage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |
| events_manage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |
| claims_submit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| claims_decide | ✓ | · | ✓ | · | · | · | · | · | · | · | · |
| revenue_view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · |
| expenses | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| sales | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| finance | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · |
| task_reports | ✓ | ✓ | · | ✓ | ✓ | ✓ | · | · | · | · | · |
| inventory | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · |
| task_view | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · | · | · |
| payroll_export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · |
| exec_view | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |

## Beyond the PERMS table (route-level rules)

- **Role changes**: `POST /users/:id/role` — SUPER ADMIN ONLY (v1.4.157). Admin-tier roles unassignable/untouchable; no self-change; personal-email accounts forced part_time for staff roles.
- **Admin creation**: creating an `admin` account requires super_admin (2026-08-11 security fixes).
- **HR staff creation**: hr_manage roles can onboard staff-level roles ONLY — not executives (ceo/coo/cco), not admin tier, not customers (2026-08-11 security fixes).
- **Offboarding**: `POST /users/:id/offboard` — admin tier + CEO; cannot target admin-tier accounts or yourself (v1.4.282).
- **Leave chain**: staff → HR review → COO/CCO pre-approve → CEO final; no self-review; reject terminal.
- **Claim chain**: mirrors leave; ALL decisions CEO (super_admin recovery only); CEO override with audit `chain_override` (v1.4.107).
- **Payroll processors**: ceo/coo/admin tier; staff read released payslips only (release 5th 10:00 MYT rule).
- **Tab access**: `TAB_ROLES` + per-tab overrides via 🔐 Tab access card (system_meta `tab_access`); super_admin escape hatch (v1.4.219–221).
- **/admin**: super_admin + admin only; admins hidden from staff lists.
- **Public (no session)**: contact form, /doc share-token view, /report client-report token view, /packages published rates, GET /api/v1/health.

## Privilege-creep review rule

Any PR/release that edits `PERMS`, a role array literal at a route, or `TAB_ROLES` must update this file in the same release and name the change in the CHANGELOG. If this table and the code disagree, the code is the truth and this file is the bug.
