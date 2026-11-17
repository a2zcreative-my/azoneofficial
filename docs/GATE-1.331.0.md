# GATE 1.331.0 — Users & Security → Roles & Permissions: a role at a time

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only. No route, permission, rule or table changes.
**Sits on:** 1.330.0 (another session's Sales → Payment History fix), which is on the PC and not deployed. Renumbered from 1.330.0 so both releases keep their own number.

**Authority:** the CEO, 17-11-2026:
- *"A2Z OS — REPLACE LEGACY ROLES & PERMISSIONS UI ... DO NOT reuse or restyle this old layout. REPLACE its React UI structure on the actual Users & Security → Roles & Permissions route."*
- *"If backend/schema changes are required, report them for approval instead of improvising security changes."*
- *"Do not deploy without my approval."*

## What was replaced

The component that drew the old screen is gone. It was `AccessPolicyCard` in `components/portal/access-policy.tsx`, with its `ModuleRows`, `EditCell` and `Cell`. It drew:
- the "Access policy matrix" (every role across every module);
- the "Who sees each tab" fold under it;
- the "Exceptions and accounts" zone below that.

`components/portal/roles-permissions.tsx` replaces it **on the same route**. There is no second page or copy.

| Part | What it is |
|---|---|
| Strip | One connected KpiRow: Total Roles · Assigned Users · Modules Controlled · Edited Permissions · CEO Access, all read from `/staff/access/policy` |
| Role Directory (35%) | Every server role, with search and a group filter, a "System" chip, its active headcount and how many actions it may do |
| Editor (65%) | The chosen role only. Tabs: **Permissions** (module × View/Create/Edit/Approve/Delete/Export/Manage switches; a module opens to its single actions) · **Assigned Users** · **Role Details** (edits with reason, protected cells, CEO vs Super Admin) · **Access Preview** (the tabs it sees) |
| Drawers | Save review · Per-user exceptions · Tab visibility · Access review |

The split is held to one screen from 1024px, and the panes scroll inside. Phones get one column with each verb's word beside its switch.

## Persisted and enforced, not simulated

- **A permission change** is saved through POST `/staff/access/policy`, the route the matrix always used:
  - the review lists who gains and who loses;
  - it needs a reason of 10 or more characters and the authenticator code;
  - the server enforces the saved cells in `can()` from the next request and audits each cell (`tests/matrix-edit.mjs` proves this end to end);
  - the screen then re-reads `/auth/me` and the policy.
- **Assign a user** goes through the existing role door, POST `/staff/users/:id/role`, with a reason and the code. The server's `roleChangeRule` decides.
- **A locked cell** (naming the owner, the backup, the Super Admin / CEO roles) has no switch, and the server refuses it anyway.

## CEO and Super Admin

The strip's CEO Access figure is worked out from the published cells. It counts what the Super Admin may do that the CEO may not, beyond the verified owner's grants and the protected cells.

**From the code, the CEO equals the Super Admin** once a super admin names the CEO the verified company owner, with two exceptions:
- the two protected cells (`owner_designate`, `backup_download`);
- the /admin website editor (`content_manage`), which is not on the matrix.

The details are in docs/CUSTOM-ROLES-STAGE-0-AUDIT.md §4.

Nothing was granted or changed by this release. The owner makes any change himself, with his code.

## Not built: waiting for your approval

**Create / Duplicate / Disable / Delete role** needs a server change. The roles are a fixed set:
- the `users.role` CHECK in migration 0164;
- the `Role` type;
- about 240 role literals in the chains.

The plan and decisions CR-1 to CR-7 are in **docs/CUSTOM-ROLES-STAGE-0-AUDIT.md**. The recommended option is an access profile on a base role, with an additive migration only.

Until you approve, no such control is drawn, because a button that does nothing would be a misleading control.

What works today without that change:
- edit any role;
- set it from another role ("Set from template");
- return it to its defaults;
- assign people to it.

## Files

**New:**
- components/portal/roles-permissions.tsx
- components/portal/roles-permissions.module.css
- tests/roles-permissions.mjs
- tests/browser/roles-permissions.py
- docs/CUSTOM-ROLES-STAGE-0-AUDIT.md
- docs/GATE-1.331.0.md

**Changed:**
- components/portal/access-policy.tsx (the matrix removed; `actionStatus` and the types kept; `ExceptionsCard bare`)
- components/portal/access-policy.module.css (the matrix's styles removed, including three off-system breakpoints)
- components/portal/users-panel.tsx (the roles view; `assignRole`; `rolesOn`)
- components/portal/users-panel.module.css (the fold's styles removed)
- components/ui/workspace-split.tsx and .module.css (the 35-65 ratio)
- components/ui/switch.tsx and ui3.module.css (the shared Switch: `mixed`, `title`, `testid`)
- tests/design-tokens.mjs
- tests/access-policy.mjs
- tests/tab-zones.mjs
- tests/browser/users-admin.py
- tests/browser/release-b.py
- tests/browser/fixture.mjs (four catalogue rows)
- tests/browser/serve.mjs (ROLESX servers keep saves; `/__rolesx-reset`)
- scripts/run-guards.mjs
- CHANGELOG.md
- CLAUDE.md
- AGENTS.md
- package.json (1.331.0)

## Tests run (in the sandbox, against this build)

| Check | Result |
|---|---|
| All guards (`node scripts/run-guards.mjs`, with 1.332.0) | **212 / 212 pass** |
| Lint | 0 errors, 115 warnings (limit 125) |
| `tests/roles-permissions.mjs` (new) | 17 checks, 13 mutations caught |
| `tests/browser/roles-permissions.py` (new) | **44 / 44** |
| `tests/browser/users-admin.py` | 61 / 61 |
| `tests/browser/ui-system.py` | 348 / 348 |
| `tests/browser/overflow-sweep.py` | 272 / 272 screens clean |
| `tests/browser/owner-roles.py` | 28 / 28 |
| `tests/browser/release-b.py` | 24 / 25, and its locked-cell checks pass |

**What roles-permissions.py proves:**
- the old matrix, fold and stacked exceptions are absent;
- the strip has its five figures;
- the split is 35:65, with no page scroll at 1440 × 900;
- choosing a role updates the editor;
- search and filter work;
- locked cells have no switch;
- a switch, then Save, then the reason and code send ONE POST with the whole role list, and the change is still there after a fresh load;
- Set from template and Reset work;
- Assign sends the role door request, and the person is in the role after a fresh load;
- both drawers open;
- 390 px has no overflow;
- a CEO who is not the owner gets no switch, and CEO Access shows the gap;
- the super admin has the switches.

**Known failure, not from this release:** release-b's "the quotation now reads Invoiced" check. The Sales row now says "Partly invoiced ... → Invoice balance" (the deposit-billing wording) because the fixture's converted quotation carries no billed amount. No Sales file changed in 1.331.0 or 1.332.0.

**Adapted, intent kept:**
- `tests/access-policy.mjs`: exceptions in Roles & Permissions, the matrix gone;
- `tests/tab-zones.mjs`: the card order;
- `tests/design-tokens.mjs`: the shared Switch may announce "mixed";
- browser `users-admin.py`: the tab editor is a drawer;
- browser `release-b.py`: locked cells read in the role editor.

**Fixed along the way:** the editor's switches first had their own track. The ui-system guard ("private switch styles may only fall") caught it. They are now the shared `Switch` (components/ui/switch.tsx), which gains a `mixed` state, a title and a test id.

**Screenshots:** the actual route at 1440 and 390 px, in the conversation.
