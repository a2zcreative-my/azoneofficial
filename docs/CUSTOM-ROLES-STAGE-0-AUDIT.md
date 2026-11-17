# Custom roles: Stage 0 audit (for the owner's approval)

**Asked:** the CEO, 17-11-2026, in the Roles & Permissions brief: a working **Create Custom Role** button, plus **Edit**, **Duplicate**, **Assign Users** and **Disable Role**.

**Also asked:** *"If backend/schema changes are required, report them for approval instead of improvising security changes."*

**Status:** nothing built. **Every decision below waits for the owner.**

## 1. What is fixed today

A role is a fixed name. Seven places in the code and database assume that.

| Where | What it fixes |
|---|---|
| `users.role` (migration 0164) | A `CHECK (role IN (...))` lists 12 values. A new name cannot be written at all. SQLite cannot widen a CHECK; the table must be rebuilt, as 0164 did. |
| `worker/src/permissions.ts` | `type Role` is a fixed union. `PERMS` gives each capability its role list. `POLICY_ROLES` lists 11 roles. |
| Approval chains | Leave (`leave-chain.ts`), claims (`claim-chain.ts`), payroll population, OT and payments name roles directly (`ceo`, `coo`, `hr_admin` ...). About 240 role literals sit in the worker. |
| Tab visibility | `lib/portal-tabs.ts` `canSeeTab` and the worker's `TAB_READ` decide by role name. |
| The role door | `roleChangeRule` decides who may give which role. |
| Headcounts | Staff, payroll and access counts use `role IN (...)` lists in SQL. |
| The owner | `is_owner` requires the role `ceo`. |

**What already works without a change**, and what 1.331.0 uses:
- Each role's permission cells are editable on the server (`system_meta.role_permissions`).
- Those edits are enforced by `can()` and audited.
- Locked cells cannot be granted.

So you can already **edit** any role, **set it from another role** (the template), and **assign people** to it. **Create, duplicate, disable and delete** need the change below.

## 2. Options

### A. An access profile on a base role (recommended)

A custom role is a named set of permission cells **on top of one system role**. Its base role keeps every hard-coded business rule: approval chains, payroll population, tab rules and headcounts. That leaves the 240 literals untouched.

**Migration:** additive only. Nothing is rebuilt, deleted or rewritten.
- A new table: `custom_roles(id, key UNIQUE, name, base_role, caps_json, disabled_at, created_by, created_at, updated_by, updated_at)`.
- One nullable column: `users.custom_role_id`.

**Worker:**
- `getSessionUser` loads the profile.
- `allows()` / `can()` check the profile's caps when a person has one, and the base role otherwise.
- The `LOCKED_CELLS` and `OWNER_GRANTS` rules apply to a profile exactly as to a role.
- `GET`/`POST /staff/access/policy` gain the profiles.
- New audited actions: `role.create`, `role.duplicate`, `role.rename`, `role.disable`, `role.enable`, `role.delete`, `role.assign`.

**Screen:** the profiles join the Role Directory under a "Custom" chip, and the five controls become real.

**Tests:**
- extend matrix-edit, owner-coverage and access-policy;
- a new guard that a profile can never hold a locked cell;
- a new guard that a disabled profile falls back at once.

### B. True new role names

Rebuild `users` to widen the CHECK, then review all 240 role literals and every chain.

**Not recommended:**
- It is high risk.
- It is a destructive-style migration (a table rebuild).
- A typo in one chain can open or close money approvals.

## 3. Decisions for the owner

| # | Decision | Recommended |
|---|---|---|
| CR-1 | Model | **A**, an access profile on a base role |
| CR-2 | Who creates, edits, duplicates, disables or deletes | The verified company owner and the super admin, each change with a reason and the authenticator code (the same door as the matrix) |
| CR-3 | Locked cells | Never grantable to a profile. The owner, the backup, and the Super Admin / CEO roles stay protected. |
| CR-4 | Disable | The people in it fall back to the base role at once. The profile and its history stay, and it can be enabled again. |
| CR-5 | Delete | Only for a profile nobody was ever assigned. Otherwise disable. Audit history is never deleted. |
| CR-6 | Tabs | A profile sees its base role's tabs. Per-user exceptions still apply. |
| CR-7 | Approval chains | A profile never joins a chain on its own. It takes its base role's place, so "one CEO final approval" is unchanged. |

## 4. CEO and Super Admin today (read from the code, 1.331.0)

In the defaults, the Super Admin holds nine capabilities the CEO role does not.

| Group | Capabilities | Who holds them |
|---|---|---|
| **Six owner grants** | `exec_accounts`, `role_any`, `tech_admin_grant`, `account_email`, `account_recovery`, `role_top` | The CEO holds them automatically once a super admin names the CEO the **verified company owner** (role CEO, active, 2FA on). Each use needs the authenticator code. |
| **Two protected by design** | `owner_designate` (naming the owner is the recovery procedure) and `backup_download` (the backup holds password hashes and 2FA secrets) | Locked to the Super Admin |
| **One technical** | `content_manage` (the /admin website editor and media library) | Not on the matrix |

`content_manage` can be given to the CEO only by adding it to the catalogue, a small server change. **Approve it if you want it.**

So, with a verified owner, the CEO equals the Super Admin except for the two protected cells and the website editor. The Roles & Permissions strip shows this live:
- **"Equivalent"** when there is no gap;
- **"n gap(s) · Owner not verified"** when the owner is not named or 2FA is off.

The sandbox cannot see whether production has a verified owner. Open the strip to check.

Nothing in section 4 was changed. The CEO still holds more business powers than the Super Admin (for example Confirm Paid and payment verification), as before.
