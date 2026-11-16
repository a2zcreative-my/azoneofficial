# GATE 1.327.0 — Users & Security: Customers & Agents, Security & Sessions, Audit History; a link lands on the section it names

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** none. Screens only: no route, permission, approval rule, calculation or table changes.
**Sits on:** 1.326.0, which is on the PC and not deployed.

**Authority:** the CEO, 16-11-2026:

> *"Fix A2Z OS → Users & Security, specifically these three tabs, using their respective attached images ... Each tab must have its own functional layout ... Preserve all actual data, backend security rules, role permissions and audit integrity."*

> *"when I click on the error, it doesnt directing to the section that I should go! this observed globally"*

The reference images were marked "UI concept · illustrative data". None of their figures, names or events are used: every number on these tabs is read from the existing routes.

## What changes on the screen

### Shared: the two-pane workspace (`components/ui/workspace-split.tsx`)
- `WorkspaceSplit` puts a register beside the chosen record and holds both to the screen from 1024 px (`FillPanel exact`). Each pane scrolls inside; the page does not.
- `SplitColumn` stacks two panes on one side; `SplitPane` is head, toolbar, body and foot.
- Below 1024 px it is one column and one page scroll.

### Customers & Agents
- **The strip:** Customers, Agents, Active, Suspended.
- **Customer & Agent Directory:** search, All / Customers / Agents / Suspended, 10 a page; the chosen row is marked gold.
- **Account & Access beside it:** type, status, portal access ("Agent workspace (Agents, Profile)", "Customer pages" or "No access - suspended"), staff access none.
- **Grant Agent Access** and the new **Revoke Agent Access** use the same role door (`POST /staff/users/:id/role`): the owner or the Super Admin, a reason and the authenticator code. The server decides.
- Recover sign-in, Manage account, Promote and the account's audit trail are the existing actions.

### Security & Sessions
- **The strip:** 2FA Protection, Recent Sign-ins, Recovery Panel, Security Alerts.
- **Authentication Controls:**
  - 2FA: required, so no switch is drawn;
  - Passkeys: the company's rollout stage, and My passkeys;
  - Executive Recovery Panel: the existing panel, opened in place ("Not shown to you" where the server refuses);
  - Sensitive Security Changes: protected by a reason and a code;
  - Sign-in Methods, for the CEO and the Super Admin.
- **Security Attention:** open recovery requests, active staff without 2FA, warning events.
- **Sign-in Log:** the last 60 account events, by account and by type, paged.
- The company owner, the office location, problem reports and System health are each one part away. The owner part opens first while no owner is verified (as v1.252.1).
- **Not drawn: a company-wide session list.** The server has none. Each person's devices stay in Manage account.

### Audit History
- **The strip:** Audit Events, User Changes, Sign-in Events, Flagged Events. Each narrows the register.
- **Audit Event Register:** search actor / action / target, event type, actor, date range, 10 a page, Export Log (CSV, through `lib/csv.ts`).
- **Selected Event Details:** actor, action, target, the entry and what was recorded. A field named like a token, secret, code, password or key is never drawn.
- It reads the newest 300 events (or 300 of a type, or one account's trail) from the same `GET /api/v1/audit`. Nothing edits or deletes an entry. /admin's audit view is the same panel.

### A link lands on the section it names
- The Dashboard's System health alert opens Users → Security & Sessions → System health, at the card.
- `revealAnchor` re-checks while the page above the target loads and stops the moment the person scrolls.
- Each System health error row opens where it was recorded ("Open Tasks" for a page's own report; a job's module such as ELFIA Store, Payroll or Attendance).
- An error reported by a page of an OLDER version no longer raises the alert. It stays in the log.
- The Business Summary's Claims, Overtime, Unpaid invoices and Live sessions open the section they count.

## Tests run (in the sandbox, against this build)

| Check | Result |
|---|---|
| All guards (`node scripts/run-guards.mjs`) | **209 / 209 pass** |
| Lint | 0 errors, 114 warnings (limit 125) |
| `tests/browser/ui-system.py` | 303 / 303 |
| `tests/browser/users-admin.py` | 60 / 60 |
| `tests/browser/users-outset.py` | 70 / 70 |
| `tests/browser/owner-door.py` | 16 / 16 |
| `tests/browser/agents.py` | 62 / 62 |
| `tests/browser/owner-roles.py` | 28 / 28 |
| `tests/browser/auth-1c.py` | 32 / 32 |
| `tests/browser/auth-2a.py` | 35 / 35 |
| `tests/browser/overflow-sweep.py` | 272 / 272 screens clean (8 role/width runs) |

**Adapted to the CEO's new layout, intent kept:** tab-zones, users-ui, ecc4, users-admin, users-outset, owner-door.

**auth-2a** failed before this release: since v1.279.0 an agent reaches Profile from the name card's menu, and the test still looked for a Profile button in the rail. The test now opens the menu first.

## Known limits

- There is no company-wide session list on the server, so none is drawn.
- The audit API has no date filter or total count. The date range narrows the 300 events read.
- No real iPhone was used; phones are Chromium at 320–430 px.

## Deployment

Nothing reached production. Run `PUSH.bat` when you choose. There is no migration.
