# Roles v2 - roles the owner creates and removes (plan, 17-11-2026)

**Asked:** the CEO, 17-11-2026, after 1.350.0: *"permission roles that for me to create by myself or super admin without hardcoded ... I need to make sure that I can add or remove the roles based on the operation needed!"*

**Status:** Stage 1 BUILT in 1.355.0, stage 2 BUILT in 1.356.0 (neither deployed). Stages 3-4 not started. Supersedes the "base role" model of `docs/CUSTOM-ROLES-STAGE-0-AUDIT.md` (option A, 1.350.0).

## The CEO's decisions (17-11-2026)

| # | Decision | Answer |
|---|---|---|
| R-1 | Protected roles (never deleted; their name and place stay) | **Super Admin, CEO, COO, CCO, Agent, Customer** |
| R-2 | Every other role | Fully the owner's: create from nothing, rename, set permissions, delete. **HR Admin, Sales & Marketing, Marketing, Editor and Live Host become ordinary roles** of this kind. |
| R-3 | Approvals (leave, claims, overtime) for a non-protected role | **The person's manager in the Organisation chart (reports-to), up to the CEO** |
| R-4 | Counts as company staff (payroll, headcount, attendance, rosters) | **A switch on each role, on by default** |
| R-5 | Pages (sidebar tabs) | **Picked per role** (a list of tabs on the role) |
| R-6 | Who manages roles | Unchanged from 1.350.0: the CEO and the Super Admin, each change with a reason and the authenticator code, audited |

## What is hard-coded today (counted 17-11-2026, PC tree)

- `users.role` has a CHECK of 12 names (migration 0164). A new name cannot be stored. It needs a table rebuild (as 0164 did), done once.
- The five roles to free are named in about 200 places in the worker: permissions.ts 92 (mostly defaults, which stay as data), staff.ts 64, index.ts 14, claim-chain.ts 12, desk.ts 6, positions.ts 5, and fewer elsewhere. There are also about 65 SQL role lists (staff.ts 40), and `lib/portal-tabs.ts` names them 23 times.
- HR Admin is an **approver stage** in today's leave and claim chains, so "HR Admin may be deleted" (R-2) and "approvals follow the Organisation chart" (R-3) must land together. The HR step becomes a permission (for example "HR review of leave"), never a role name.

## Model

- **A `roles` table** (key, name, description, protected, counts_as_staff, tabs, created/updated by and at). It is seeded with today's 12 roles; R-1 sets protected = 1. A role's permission cells stay in the one matrix (`system_meta.role_permissions`, a column per role), so `canUser` does not change shape.
- **`users.role` rebuilt without the CHECK.** A trigger refuses a role that is not in `roles`. Before the rebuild, PUSH.bat's own export backs everything up.
- **1.350.0's custom roles (cr_ on a base role) become ordinary roles.** Each one turns into a role, its holders move to it, and `custom_role_id` is cleared. Nothing is lost.
- **Deleting a role** is allowed only when nobody holds it (as 1.350.0). The audit history stays.

## Stages (each one released and tested before the next)

1. **Foundation.** *Built in 1.355.0.* The users rebuild and moving the cr_ roles in were moved to the stage that unlocks assigning (stage 3): with nobody able to hold an own role yet, rebuilding every account in stage 1 would carry the risk with none of the benefit. Stage 1 ships additive only (`0208_roles`).
   - Migration: the `roles` table (and, moved to stage 3, the `users` rebuild and moving the cr_ roles in).
   - `/staff/access/roles` (create, rename, switches, tabs, delete).
   - Roles & Permissions gets a Create Role with **no base role**: name, description, counts-as-staff, pages, and permissions starting blank or copied from any role.
   - Guard: no protected role can be deleted, renamed away or granted a locked cell.
2. **Pages and staff counts.** *Built in 1.356.0* for the owner's own roles; the six code roles keep their code rules until stage 4 frees them. Also added: 2FA for every own role, so stage 3 cannot open a way round it.
   - `canSeeTab` and the worker's `TAB_READ` read the role's tab list for a non-protected role.
   - Every "who is staff" SQL list reads `counts_as_staff`.
   - Guard: one source for each.
3. **Approvals.**
   - Leave, claims and overtime for non-protected roles route by reports-to up to the CEO.
   - The HR stage becomes a permission.
   - COO/CCO pre-approvals and the CEO's final approval are unchanged (protected roles).
   - Guard: race and chain tests like go-live-l/k/v.
4. **The remaining literals.**
   - Notifications, Desk, positions, watchers and every "who to tell" check read permissions instead of role names.
   - Guard: no literal names a non-protected role outside the seed.

## Risks and how they are held

- **A wrong approval chain can open or close money approvals.** Stage 3 ships alone, with the chain guards extended first.
- **The users rebuild touches every account.** It runs inside one migration with `PRAGMA defer_foreign_keys`, as 0164 did. The release backup is taken first, and the row count is checked equal after.
- **Another session is working in the same core files.** Each stage re-reads the PC tree and merges; nothing is overwritten.
