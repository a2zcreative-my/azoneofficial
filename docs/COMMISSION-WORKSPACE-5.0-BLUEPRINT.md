# A2Z OS — Commission Workspace 5.0: audit, architecture and phased plan

**Status:** READ-ONLY AUDIT AND DESIGN. **STOPPED AT THE GATE.**
- Nothing has been coded, migrated, deployed or changed in production.
- No financial rule has been changed.

**Authority:** the CEO's directive "A2Z OS — Commission Workspace 5.0, Strict CEO Directive", 15-11-2026, with six desktop reference images.
**Audited code:** v1.310.0 (sandbox = your PC = live, see §1).

Codes used in every table:

| Code | Meaning |
|---|---|
| **EXISTS** | Built and verified in the code today |
| **UX** | Screen change only |
| **NEW** | New function |
| **DB** | Database change |
| **SEC** | Security rule |
| **CEO** | Needs your decision |

---

## 0. What I received, and what is missing

| Item | Received |
|---|---|
| Six desktop references: Overview, Transactions, Agent Deals, Policy Settings, Payroll Sync, Audit History | **Yes** |
| Six matching mobile PWA references | **No.** Only the six desktop images arrived. |
| `A2Z_OS_Commission_5_0_Claude_Master_Prompt.md` | **No.** It is not in the chat, the project, the uploads or your PC folder. |

This blueprint follows your directive text and the six desktop images. **Decision K-12:** send the Master Prompt and the six phone references, or approve the 4.0 phone pattern already used by Leave, Claims and Staff:
- the view switch replaces the tab row;
- cards replace tables;
- the action stays above the bottom bar.

Nothing will be built until the Master Prompt is read, or you waive it.

---

## 1. Live versus local

| Where | Version | How it was checked |
|---|---|---|
| **Live** (`https://a2zcreative.my/api/v1/health`) | **1.310.0** | Fetched 15-11-2026: `{"ok":true,"db":true,"version":"1.310.0", …}` |
| Your PC (`a2zcreative-official/package.json`) | 1.310.0 | Delivered and hash-checked today |
| Sandbox | 1.310.0 | Same files |

- **There is no code difference.** You deployed 1.307 to 1.310 with PUSH.bat.
- 1.307 to 1.310 changed nothing in Commission. 1.310.0 (Claims) touched `erp.ts`, but only the claims part of the cash back-fill.
- **What I cannot see is the live data:**
  - which policy versions are active;
  - whether payroll sync, agent deals and payment verification are on;
  - what the ledger holds.

  Every finding below that depends on those is marked, and §12 gives six read-only queries for you to run before P1.

---

## 2. What exists today (verified in the code)

Commission is already **one engine**: `worker/src/commission.ts` (1,663 lines). It is fed by Payment Verification 3.0 and feeds Payroll and Finance.

| Piece | Where | What it does |
|---|---|---|
| Policy versions | `commission_policies` (0150, 0152, 0154, 0168) | Versioned and dated. A draft is approved (`commission_approve`) or rejected, and is **never edited** after it is drafted (the code has no update route). A start date can't be in the past. Agent rates (`agent_rate_bp`, `agent_closer_rate_bp`) are optional per version. Package rules are kept per version. **EXISTS** |
| Payment report → verification | `payment-verify.ts`, `invoice_payment_reports`, `invoice_payment_events` (0181) | Sales, COO, CCO and CEO report a payment with proof (`payment_report`). **Only the verified owner verifies it** (`payment_verify` + `is_owner`). When the invoice is fully verified it is marked paid, booked in Finance (`INV-<id>`), and one paid confirmation is written. **EXISTS** |
| Paid confirmation | `invoice_paid_confirmations` | One live confirmation per invoice. Paid in full only, and the amount must equal the total. Revoking it needs a reason. |
| Classification | `classify()` | At confirmation the sale is classified as one of three: **direct**, **partnership** or **review** (held, with reason codes). It writes one `commission_attributions` row, and the evidence is frozen by triggers. **EXISTS** |
| Ledger | `commission_ledger` | One row per entitlement. The `source_key` is UNIQUE (`earn:<conf>`, `agent:<conf>`, `rev:<id>`, `cn:<cn>:<id>`), plus a unique (confirmation, role) index. **Idempotent**: a refresh, replay or retry writes nothing new. **EXISTS** |
| Reversals | `ensureLedger()` | A revoked confirmation **voids** the row before payroll, or sends it to **review** after. A credit note writes a proportional reversal for review. A paid amount is never clawed back automatically. **EXISTS** |
| Payroll | `commissionForPayroll()` / `markCommissionPaid()` | Closer rows only (`recipient_role = 'closer'`). Rows join a month when Payroll saves that person, and each row joins once. A released month takes nothing. Paid is marked only for people the bank run paid. Behind the `commission_sync` switch. **EXISTS** |
| Agent payouts | `agent_payouts` | The CEO or super admin **authorises**. A *different* person **settles**, with the bank reference and date. That writes one cash row `AGT-<id>` in Finance (category `agent_commission`), never in payroll. **EXISTS** |
| Agent privacy | `/agent/commission` | An agent reads only their own rows and rate (7%). Every `/commission/*` route returns 403 to an agent. Notifications to an agent carry only their own amount. **EXISTS** |
| Screens | `commission-panel.tsx` (978), `agent-deals.tsx` (348) | The **six tabs already exist**: Overview, Transactions, Agent deals, Policy Settings, Payroll Sync, Audit History. A salesperson sees one tab, "My commission". |
| Tests | `commission-ledger`, `commission-flow`, `commission-config`, `go-live-n` (82 checks, 11 mutations), `go-live-h`, `payment-verify`, `payroll-commission`; browser `agent-commission.py` | All pass in the 196-guard run of 1.310.0 |

---

## 3. Findings

| # | Finding | Effect | Code |
|---|---|---|---|
| **F-1** | **The Agent Deals switch conflicts with policy v1** (see §4). | The screen says agent deals are **On** and "paid by the approved version's rates". Under v1 every agent sale is held instead. | UX + CEO |
| **F-2** | The Overview figures add **agent and salesperson rows together**: eligible, included and review. An agent payout that is authorised sets the agent rows to `included`. | **"To Payroll" would count agent money that never goes to payroll**, and "Paid" counts payroll months only. | NEW (server) |
| **F-3** | Reference 5 (Payroll Sync) lists an agent, *AGT-003 Syarif Agency, RM 4,200*, inside "Commission Ready for Payroll". | The reference itself conflicts with your rule that agents are settled through Finance. The engine already blocks agents from payroll; **the screen must show agents separately**. | UX |
| **F-4** | `commission_policies` and `commission_ledger` have **no database guard**. Code alone keeps an approved version and a written entitlement unchanged. Attributions, payouts and disputes already have triggers. | A future bug or a manual SQL could rewrite an approved rate or an amount. | DB + SEC (P3) |
| **F-5** | **The Super Admin holds `commission_approve`, `commission_settle` and `commission_decide`.** It can approve policies, decide reviews, flip switches and authorise or settle agent payouts. | Your directive says the CEO decides. This matches C-2 (claims) and L-12 (leave). | SEC + CEO |
| **F-6** | Payment verification is a **setting** (`payment_verification`). While it is off, the COO can confirm an invoice paid (`confirm_paid: ceo, coo`). That makes commission eligible **without the CEO's verification**. | Unknown live state (§12). It must be permanently on. | SEC + CEO |
| **F-7** | The CEO may confirm **his own sale** (`SELF_CONFIRM_ROLES = ["ceo"]`). | If the CEO is ever a closer, he verifies his own commission. That is the opposite of the C-1 claims rule. | CEO |
| **F-8** | **Payroll Sync is implicit.** Commission joins a month when Payroll saves or recomputes it (if the switch is on). The Payroll Sync tab shows the switch and the cutoff, not the three steps of reference 5. | No duplicate amount is possible today (each row joins once). The screen does not show what Payroll will carry. | UX |
| **F-9** | **There is no company split.** A ledger row has no company; the invoice's issuer (A2Z / AZ ONE) is only shown. Payroll pays by each person's employer. | A report per company is not possible today. It is possible from the invoice issuer without a DB change. | UX + CEO |
| **F-10** | Reference 3 names agents **"AGT-003"**. In the system, **`AGT-<n>` is the agent payout reference**. Agents have no code. | Reusing AGT for agents would confuse a payout with a person. | CEO |
| **F-11** | Reference 3 has **"Add Agent"** and **"New Deal"**. Agents are created in **Agents** and deals are quotations in **Sales**. | Building them in Commission would duplicate two modules. They must be links. | UX |
| **F-12** | Reference 1 shows **Sales Target (Monthly)**. Targets are kept by Sales and the Dashboard. | Commission must read the same target, never keep a second one. | UX |
| **F-13** | The Audit History route returns the last 300 events with **no filters**, and **misses payment-verification events** and the payroll sync. | Reference 6 needs action, user and date-range filters, and pages. | NEW (server) |
| **F-14** | The Commission page **predates the 4.0 shell**. The view is not in the address, there is no phone view switch, and no fallback for a view a person does not have. | Same fix as Leave, Claims and Staff. | UX |
| **F-15** | **Dual control on payouts needs two people with `commission_settle`** (the CEO and the super admin). If F-5 removes the super admin, the CEO cannot settle alone. | The second person must come from **Finance** (see K-5). | CEO |

---

## 4. The Agent Deals switch versus policy v1 (investigated)

**What the code does**
1. `agentContext()` reads `business_settings.agent_partnership`. **Anything but "off" counts as on, including no row at all.**
2. `classify()`: an agent-linked sale is held for review when:
   - the switch is off (`agent_partnership_off`); **or**
   - the version in force on the paid day has no agent rates (`agent_policy_missing`).
3. **v1 has no agent rates.** Per the last live backup (03-11-2026), v1 is 10%, net of SST and delivery, from 01-11-2026, with `agent_rate_bp` NULL. Unless a v2 with 7% + 3% has since been approved, **every agent-linked sale is held**, whatever the switch says.
4. The Agent Deals tile reads **"On — Paid by the approved version's rates"** whenever the switch is not off.

**The conflict**
- **Two controls decide one thing.** The switch can only *add* a hold; it can never make an agent sale pay. Only an approved version with agent rates does that.
- With v1 in force, the screen says "On" while nothing is paid. With a v2 in force, turning the switch off holds sales that the approved policy says to pay.
- **Nothing is paid wrongly** (a held sale is never paid at 10%). But the screen states something untrue, and the policy's authority is split.

**Recommendation (K-1)**
- **The policy is the only authority.** Agent Deals shows the truth from the version in force:
  - "Agent rates: none in v1 — agent sales are held for your review"; or
  - "v2: agent 7% + salesperson 3%, from dd-mm-yyyy".
- The switch becomes an emergency **"Hold new agent sales"**: off by default, a reason required, logged. It is shown only while it is holding.
- Its stored state is kept, and nothing already written changes.
- To start paying agents, you approve a **v2** = v1's direct terms unchanged + agent 7% + salesperson 3%, effective today or later (the engine refuses a back-date). v1 is never edited.

---

## 5. Architecture: one engine, three channels

```
Sales (quotation → invoice) ──► Payment report (Sales / COO / CCO, with proof)
                                         │
                                         ▼
                          CEO owner verifies every payment  (payment_verify, is_owner)
                                         │  invoice paid in full + verified
                                         ▼
                          ONE paid confirmation per invoice
                                         │
                                         ▼
          classify() at the version in force on the paid day — written ONCE
          ┌──────────────────────────┬──────────────────────────┬─────────────────────┐
          │ DIRECT                   │ PARTNERSHIP              │ REVIEW (held)       │
          │ earn: salesperson 10%    │ agent: 7%  + earn: 3%    │ RM 0 hold, reasons  │
          └────────────┬─────────────┴────────────┬─────────────┴──────────┬──────────┘
                       │ commission_ledger (UNIQUE keys, idempotent)        │ CEO decides once
          ┌────────────┴────────────┐   ┌─────────┴──────────┐            (partnership / direct / none)
          ▼                         ▼   ▼                    │
   PAYROLL (employees only)      FINANCE (agents only)       │
   commissionForPayroll:          payout authorised (CEO) ────┘
   joins a month once,            settled by Finance (bank ref + date)
   paid with the bank run         → one cash row AGT-<id>
```

- **The Commission Workspace stays a view and a control panel over this one engine.** It never calculates a second figure, and never creates agents, quotations, invoices, payroll rows or cash rows of its own.
- **Reversals:**
  - a revoked confirmation, or a credit note, writes a reversal row;
  - after payroll, a paid amount goes to review, never clawed back automatically;
  - a settled payout is never cancelled (a correction is a reversal for review).
- **Company:** each entitlement carries its invoice's issuer, read through the invoice (no DB change). Reports filter by company. Payroll still pays per employer (K-8).

---

## 6. Screenshot-by-screenshot comparison

**The figures in the references are mock-ups and are never used.** Two examples:
- RM 124,000 confirmed sales with RM 9,340 commission.
- "Direct Sales (10%) RM 40.00 = 0.4%", while the same picture lists a direct sale of RM 40,000 earning RM 4,000.

Every figure is the server's.

### Ref 1 — Overview
| Reference element | Today | Plan | Code |
|---|---|---|---|
| Header, month picker, **+ New Deal** | Tab row with the month | New Deal **opens Sales → New quotation** (a link, F-11) | UX |
| **Confirmed Sales** (n invoices) | Not a figure | Sum of **verified paid** invoices of the month (the paid confirmations) | NEW (read) |
| **Commission Payable — Eligible (Paid invoices only)** | "Eligible", agent and salesperson mixed | Eligible, **split by recipient** (F-2) | NEW (read) |
| **Pending — n invoices (awaiting Paid)** | "Estimated" | Estimates on invoices not yet verified, **never payable**. Partly paid ones are counted here. | EXISTS + UX |
| **To Payroll — ready for payroll sync** | "Included" (mixed) | **Employee rows only** (F-2) | NEW (read) |
| **Commission by Role** donut: Agent 7% / Salesperson 3% / Direct 10% | No donut | From the ledger by deal and recipient, this month. Management only. | UX |
| **Sales & Commission Performance**: target, actual, achievement, estimated commission | Not in Commission | The target **read from Sales** (F-12); actual = verified paid sales; estimate from the engine | UX |
| **Recent Commission (Paid Invoices)**: invoice, client, closer, type, sales, commission, status | Entries table | Last verified invoices, with **Type** = Direct / With Agent / Held | UX |
| **Needs Attention** | Part of the flow view | Payments waiting for the CEO's verification · deals held for review (with reasons) · rows ready for payroll · agent payouts to authorise or settle | UX |

### Ref 2 — Transactions
| Reference | Plan | Code |
|---|---|---|
| Search; filters for status, type and staff; month; **Export** | Server filters (status, deal type, staff, month, company), pages, and CSV export. **An export never carries the 3% to anyone outside management**; an agent has no access at all. | UX + NEW (filters) |
| Columns: invoice no., date, client, closer, agent, sales, **split 7% / 3%**, commission, status | Management sees the split. A salesperson sees only **their own row** (10% or 3%) — never the agent's amount (F1, existing). | EXISTS + UX |
| Pages 1 2 3 | Server pages | NEW |

### Ref 3 — Agent Deals
| Reference | Plan | Code |
|---|---|---|
| Total Agents · Active Agents · Deals (this month) · Agent Commission | Read from the Agents accounts and the ledger | UX |
| Table: agent, **salesperson (owner)** = the standing assignment, deals, sales, agent commission 7%, status | Built from the existing data: `agent_assignments`, attributions and ledger | UX |
| **Add Agent / New Deal** | **Links** to Agents → Add agent and Sales → New quotation (F-11) | UX |
| "AGT-003" agent codes | **No new code.** The name is shown; `AGT-` stays the payout reference (F-10, K-9) | CEO |
| (not in the ref) Review queue, payouts, disputes | **Kept**, below the table: held deals with their reasons, then payouts to authorise or settle, then disputes | EXISTS |
| (not in the ref) the switch | Replaced by the policy's truth (§4, K-1) | UX + CEO |

### Ref 4 — Policy Settings
| Reference | Plan | Code |
|---|---|---|
| Direct Sales (no agent) 10% · With Agent – Agent 7% · With Agent – Salesperson 3% | **Read from the version in force.** Under v1 the two agent cards say "Not in force — agent sales held". | UX |
| **Edit Policy** | "**New version**" (a draft). **An approved version is never edited** (it is kept, and F-4 adds a DB guard). | EXISTS + UX |
| Rules & Control (6 ticks) | Each tick is a real rule with its source: paid invoices only · CEO final verification · partial payments tracked, nothing payable · auto attribution to the verified closer · payroll after the CEO's verification · 3% hidden from agents | UX |
| (not in the ref) version history, package rules, preview | Kept, below | EXISTS |

### Ref 5 — Payroll Sync
| Reference | Plan | Code |
|---|---|---|
| Steps: Select Period → Review Commission → Sync to Payroll | The same three steps over **Payroll's own function** (K-6) | UX |
| Table "Commission Ready for Payroll", including **AGT-003 Syarif Agency** | **Employees only.** A second card, "**Agent settlements (Finance)**", lists the agents' eligible amounts with a link to authorise the payout. Agents never appear in the payroll total (F-3). | UX |
| Total to Sync | Server total of employee rows that will join that month | NEW (read) |

### Ref 6 — Audit History
| Reference | Plan | Code |
|---|---|---|
| Filters: all actions, all users, date range; pages | Server filters and pages (F-13) | NEW |
| Events: Commission Verified, Invoice Marked Paid, Agent Deal Updated, Policy Changed | Adds the **payment-verification events** and the payroll join. **Read-only**: nothing is ever edited or deleted. | NEW (read) |

### Phone (all six)
Pending K-12. The plan is the 4.0 pattern:
- the view switch, with **New Deal** beside it;
- the figures two per row;
- tables become cards;
- Transactions filters go in a sheet;
- the Payroll Sync steps stack;
- no sideways page at 320–430 px;
- 44 px touch targets.

---

## 7. Permission matrix (proposed; changes in **bold**)

| Action | CEO (owner) | COO | CCO | HR admin | Sales (closer) | Super Admin | Agent |
|---|---|---|---|---|---|---|---|
| Report a payment (proof) | ✓ | ✓ | ✓ | – | ✓ own invoices | – | – |
| **Verify a payment / confirm paid** (makes commission eligible) | **✓ only** | **✗** (F-6) | ✗ | ✗ | ✗ | ✗ | ✗ |
| See all commission | ✓ | ✓ | ✓ read | ✓ read (payroll) | own rows only | ✓ read | ✗ (own 7% in the agent portal) |
| See the 3% / the split | ✓ | ✓ | ✓ | ✓ | own 3% only | ✓ read | **never** (API, notifications, exports) |
| Draft a policy version | ✓ | ✓ | ✗ | ✗ | ✗ | **✗** (F-5) | ✗ |
| Approve / reject a version | **✓ only** | ✗ | ✗ | ✗ | ✗ | **✗** | ✗ |
| Decide a held deal / review row | **✓ only** (never his own entitlement) | ✗ | ✗ | ✗ | ✗ | **✗** | ✗ |
| Correct a closer | **✓ only** | ✗ | ✗ | ✗ | ✗ | **✗** | ✗ |
| Payroll sync switch / run | ✓ | per K-6 | ✗ | ✗ | ✗ | **✗** | ✗ |
| Authorise an agent payout | **✓ only** | ✗ | ✗ | ✗ | ✗ | **✗** | ✗ |
| Settle an agent payout (bank ref) | ✗ (authoriser) | **✓ Finance** (K-5) | ✗ | ✗ | ✗ | **✗** | ✗ |
| Flag / clear a dispute | flag ✓ / clear ✓ | flag ✓ | ✗ (today; unchanged) | ✗ | ✗ | **✗** | ✗ |

All of this is enforced on the server, by direct request. A role or ID sent by the page is never trusted.

---

## 8. State machines

**Invoice → entitlement**
```
UNPAID ─(payment reported)─► PART-PAID ─► PAID-REPORTED ─(CEO verifies every payment)─► PAID + CONFIRMED
  │ estimate only, never payable ─────────────────────────────────────────────┘         │
  └─ void / credit note ──────────────────────────────────────────────────────► reversal (§2)
```

**Ledger row** (one per recipient; the `source_key` makes it once)
```
                ┌──────────── review ───(CEO decides once)──┐
                │                                           ▼
written ──► eligible ──(employee: Payroll joins the month)──► included ──(bank run paid them)──► paid
   │            └─(agent: CEO authorises payout)──► included ──(Finance settles, bank ref)──► paid
   │
   └─ confirmation revoked before payroll ─► void
      after payroll / paid ─► reversal row in review (never clawed back automatically)
```

**Attribution:** direct | partnership | review. A review is decided **once** (partnership with a chosen version / direct / none), and its evidence never changes (DB triggers).

**Policy version:** draft → active (CEO approves, from today or later) | rejected. **Never edited, never deleted** (K-2 adds the DB guard).

---

## 9. Business-rule verification (your directive, line by line)

| Directive | Verdict | Where |
|---|---|---|
| One authoritative commission engine | **EXISTS**. `commission.ts` is the only writer; Payroll, the agent portal, Sales and Finance read it. | §2 |
| Direct sales: 10% to the salesperson | **EXISTS**, *if* v1 is still 10% (§12 Q1) | v1 |
| Agent: 7% agent + 3% internal salesperson, only under an approved effective policy | **EXISTS, inactive until a v2 is approved** (§4). Without one, agent sales are held, never paid 10%. | `classify`, `agentSplit` |
| Never reveal the 3% to an agent (portal, API, notifications, exports) | **EXISTS** for the portal, API and notifications. **To verify** for the new exports and the audit (management only). | `agentCommission`, 403 on `/commission/*` |
| Sales, COO, CCO report payments | **EXISTS** (`payment_report`) | `payment-verify.ts` |
| CEO owner performs final verification | **EXISTS while verification is on.** **Gap while it is off** (F-6). | K-3 |
| Unverified or partly paid invoices never payable | **EXISTS** (paid in full + confirmation; amount = total) | `confirm-paid`, `ensureLedger` |
| Agent Deals switch versus policy v1 | **Conflict found** | §4, K-1 |
| Policy versions and entitlements immutable | **EXISTS in code**; **no DB guard** (F-4) | K-2 |
| One idempotent entitlement ledger | **EXISTS** (UNIQUE keys + unique index; retry-safe) | 0150, 0168 |
| Employee commission into Payroll, no duplicates | **EXISTS** (joins once, closer rows only, released month locked) | `commissionForPayroll` |
| Agents settled separately through Finance | **EXISTS** (one cash row `AGT-<id>`, never payroll); the settler role changes with K-5 | payouts |
| Company segregation, security, reversals, audit | Reversals and audit **EXIST**; company **report filter NEW** (F-9); security F-5 to F-7 | — |
| No duplicate Sales, Agents, Payroll or Finance functions | Plan uses **links and reads only** (F-11, F-12, K-6) | §6 |

---

## 10. Tests (to be written with each phase)

**New `tests/commission5.mjs`** — the whole worker against SQLite, by direct request as each role, plus mutations:
- **Direct sale:** RM 1,000 → salesperson RM 100. Nothing before the CEO's verification; a part-paid invoice gives an estimate only.
- **With a v2 at 7% + 3%:** agent RM 70 + salesperson RM 30. With v1 only, the sale is held with `agent_policy_missing`, never 10%.
- **The hold switch (K-1):** holding a sale never pays it; releasing it pays per the version in force; the screen's statement matches the engine.
- **Idempotency:** confirm, refresh, replay, sync and retry ×N give the same rows. Two people pressing at once make one entitlement.
- **Payroll:** employee rows join once, never into a released month. An agent row never enters payroll. The "To Payroll" total equals what Payroll carries (F-2).
- **Agent payout:** the CEO authorises, Finance settles (K-5); one cash row; a retry books nothing; the authoriser cannot settle.
- **Privacy:** an agent gets 403 on every `/commission/*` route and on every export; their own portal has no 3% and no closer row. A salesperson never reads the agent's amount or another person's row.
- **Permissions:**
  - the Super Admin gets 403 on approve, decide, settle and payouts (K-4);
  - the COO cannot confirm paid while verification is permanent (K-3);
  - the CEO cannot decide his own entitlement.
- **Immutability (P3):** an `UPDATE` of an approved version or of an entitlement's amount is refused by the database. A `DELETE` is refused.
- **Reversals:** revoke before payroll → void. Revoke after → reversal in review. Credit note → proportional reversal.
- **Reports:** by company; the Audit History filters return payment-verification events too.
- **History:** the hash of the existing rows is unchanged.

**Browser `tests/browser/commission5.py`** — CEO, COO, CCO, salesperson and agent:
- all six views from the address, with Back and Forward;
- each reference element;
- the agent portal never showing 3%;
- 320 to 1440 px with no sideways page.

**Existing guards stay green, updated only where an approved rule changes:** `commission-ledger`, `commission-flow`, `commission-config`, `go-live-n`, `go-live-h`, `payment-verify`, `payroll-commission`, `agent-commission.py`.

---

## 11. Phased plan (each phase stops for your approval)

| Phase | What | DB? | Changes a rule? |
|---|---|---|---|
| **P0** | You run the 6 read-only queries (§12). You send the Master Prompt and the phone references, or waive them (K-12). | No | No |
| **P1 — the workspace** | The six views to the references (4.0 shell: address, phone switch, fallback). Server reads: Overview split by recipient (F-2); Transactions filters, pages and export; Audit filters and payment events (F-13); company filter (F-9). Agent Deals shows the policy's truth (§4) and links instead of copies (F-11). Payroll Sync shows employees and agents apart (F-3). | **No** | **No** |
| **P2 — authority** | Each item needs its own approval: K-1 (switch → hold), K-3 (verification permanent), K-4 (Super Admin out), K-5 (Finance settles), K-6 (sync button), K-7 (the CEO's own sale). | No | **Yes**, each as decided |
| **P3 — guards** | Migration **0196**: triggers that refuse an UPDATE of a non-draft policy's terms, any DELETE of a policy, an UPDATE of a ledger row's amount, basis, rate, recipient or key, and any DELETE of a ledger row. Additive; no row is changed. | **Yes** (additive) | No |
| **P4 — v2** | You draft and approve v2 (direct 10% unchanged + agent 7% + salesperson 3%) **in the screen**, effective today or later. Claude never approves a policy. | No | Your approval in the app |

---

## 12. Read-only production queries (P0)

Run each with `npx wrangler d1 execute azoneofficial --remote --command "<query>"` and paste the results back. Nothing is written.

1. `SELECT version, name, status, effective_from, rate_kind, rate_bp, basis, agent_rate_bp, agent_closer_rate_bp FROM commission_policies ORDER BY version`
2. `SELECT key, value, updated_at FROM business_settings WHERE key IN ('commission_sync','agent_partnership','payment_verification')`
3. `SELECT recipient_role, kind, status, COUNT(*) AS n, SUM(amount_cents) AS cents FROM commission_ledger GROUP BY 1,2,3`
4. `SELECT classification, reasons, decision, COUNT(*) AS n FROM commission_attributions GROUP BY 1,2,3`
5. `SELECT status, COUNT(*) AS n, SUM(amount_cents) AS cents FROM agent_payouts GROUP BY 1`
6. `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 3`

---

## 13. CEO decisions needed

| # | Decision | Recommendation |
|---|---|---|
| **K-0** | Approve this audit, the six tabs and **P1** (no migration, no rule change) | **Yes** |
| K-1 | Agent Deals: the policy is the only authority; the switch becomes "Hold new agent sales" (off by default, reason, logged) | **Yes** |
| K-2 | Database guard on policy versions and entitlements (P3, migration 0196) | **Yes** |
| K-3 | Payment verification is permanent: only the CEO owner confirms paid; the COO's confirm-paid route is retired | **Yes** |
| K-4 | The Super Admin loses approve, decide, settle, switches and payouts (keeps read) | **Yes** (as C-2 / L-12) |
| K-5 | Agent payout: the CEO authorises in Commission; **the COO settles in Finance** with the bank reference (dual control kept) | **Yes** |
| K-6 | Payroll Sync button: it runs **Payroll's own** recompute for the month and the people listed (no second calculation). Allowed for the CEO only, or for the CEO and the COO. | **Button, CEO + COO** |
| K-7 | The CEO's own sale: confirmed by the CEO (today), or never earns commission | **Never earns** (the CEO is not a commissioned closer), unless you say otherwise |
| K-8 | Company: commission is reported by the invoice's company. Payroll still pays by employer (no data change). | **Yes** |
| K-9 | Agent codes: no new code; agents shown by name; `AGT-` stays the payout reference | **Yes** |
| K-10 | Add Agent / New Deal in Commission are links to Agents and Sales | **Yes** |
| K-11 | Overview target = the Sales monthly target (read only) | **Yes** |
| K-12 | Send the Master Prompt and the six phone references, or approve the 4.0 phone pattern | **Send them**, or approve the pattern |
| K-13 | After P1: draft and approve v2 (10% direct unchanged + 7% agent + 3% salesperson) yourself in Policy Settings | **When you are ready to pay agents** |

---
**ONE COMMISSION ENGINE · ONE LEDGER · ONE VERIFICATION · EMPLOYEES THROUGH PAYROLL · AGENTS THROUGH FINANCE.** Nothing is coded, migrated or changed until you approve a phase.
