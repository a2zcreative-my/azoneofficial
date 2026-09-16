# Modest UI/UX Implementation Plan

**Status:** responsive shell and Dashboard/One Desk/Inventory pilot implemented in v1.164.0; broader rollout remains open
**Reviewed:** 16 September 2026
**Target:** the portal, admin, account, and document related screens

## Card-order rollout - local

The approved work-first card-order plan is tracked in
[CARD-ORDER-IMPLEMENTATION.md](CARD-ORDER-IMPLEMENTATION.md). Dashboard, Ecommerce,
Inventory, Sales, Attendance and Users were accepted by the user. The approved
extension changes 15 further tabs and retains eight already-correct layouts.
Publishing through PUSH.bat remains a separate step. See the linked record for
verification results and remaining device/production-data acceptance.

## Video reference implementation - 16 September 2026

The source-backed review, implementation record, and remaining phases are in
[INTERFACE-VIDEO-IMPLEMENTATION-PLAN.md](INTERFACE-VIDEO-IMPLEMENTATION-PLAN.md).
The v1.164.0 implementation adds labeled desktop navigation, a collapsed tablet
rail, scoped 8px shared surfaces, compact metrics, phone controls and Inventory
record details. Mocked-data browser checks cover 360-1920px plus Malay/dark mode.
Company isolation, verified-signing events, Sales/Claims detail adoption and actual
installed PWA/WebView acceptance remain separate, incomplete phases.

## Goal

Make the system feel like a calm, dependable ERP used every day by a team. A user
should understand where they are, what needs attention, which company a record
belongs to, and what will happen after pressing an action. The interface should
stay useful when data is dense, names are long, the screen is small, or a request
fails.

"Modest" means restrained visual emphasis: a neutral work surface, one primary
action per context, limited accent color, compact repeated data, and no marketing
style hero sections inside operational screens.

## Existing foundation to keep

The code already provides a useful base: shared tokens in `styles/globals.css`,
surface variants in `lib/ui-styles.ts`, Lucide icons through
`components/ui/app-icon.tsx`, a desktop rail and mobile navigation, bilingual
display helpers, `OneDesk`, cached/live refresh, and issuer-aware document/signature
data. The redesign should consolidate usage around those foundations rather than
create a second design system.

## Global design rules

| Area | Standard | Reason |
|---|---|---|
| Page structure | Page title and context first, toolbar second, content third, feedback near the action | Gives every module the same scanning order |
| Width | Use the existing outer portal width; cards fill their grid column | Prevents panels from becoming unrelated islands |
| Surfaces | One page card, compact card for dense widgets, inset box only for content inside a card | Stops nested card competition |
| Radius | Page surfaces use the existing house radius; compact rows use a smaller radius; do not invent a new radius per panel | Makes cards look related without making every box identical |
| Spacing | Use the existing 4/8 spacing rhythm; section gaps are larger than row gaps | Separates work areas while keeping tables dense |
| Color | Navy for primary actions, gold for selected/identity emphasis, semantic success/warning/danger/info tokens for state | Color communicates meaning instead of decoration |
| Typography | Normal sentence case for labels; compact uppercase only for small metadata; use tabular numerals for money/counts | Improves scanning and reduces visual noise |
| Motion | Use animation only for live status or a meaningful transition; never pulse ordinary content | Keeps alerts noticeable and the interface quiet |
| Icons | Lucide/AppIcon with one stroke weight; decorative icons are hidden from assistive technology | Avoids platform-dependent emoji and inconsistent glyphs |
| Content | English/BM at the display point; printed legal documents remain English | Preserves the existing language and document rules |

## Component vocabulary

Use these named patterns consistently. A component may have a compact or mobile
variant, but its purpose must remain clear.

- **Page header:** title, short context, optional company/period label, then one
  primary action and secondary actions.
- **Filter bar:** search, company, period, status, and category controls in that
  order when present. Filters should be removable and reflected in the result count.
- **Action feedback:** every save, approval, payment, upload, delete, and retry
  reports success or failure beside the action and preserves input after failure.
- **Status chip:** one semantic token plus readable text. Do not use color alone.
- **Data table:** sticky or clearly visible headings, left-aligned text, right-aligned
  money/counts, row actions at the end, and a mobile list or horizontal scroll when
  a table cannot fit.
- **Approval panel:** evidence and amount first, current state second, decision
  controls third, reason field for return/reject, and history last.
- **Empty/error/loading state:** empty means a successful zero result; error means
  the system could not answer; skeleton means the first request is still pending.
  Never substitute one state for another.
- **Expandable detail:** place it inside its parent card under a divider. Promote it
  to a grid cell only when it is a separate work area.

## Layout changes by priority

### P0 - normalize the shared shell

1. Audit portal, admin, and account pages against the shared card, button, input,
   select, chip, table, header, and row patterns.
2. Replace remaining hand-written visual variants only when they have no distinct
   purpose. Give intentional density variants a named token.
3. Align title rows, toolbar height, field height, icon size, and action feedback.
4. Remove visible emoji used as interface decoration. Keep emoji only when it is
   actual user content or exported/printed content that requires it.
5. Retain the current tab registry and ordering until the team approves a navigation
   change. Improve grouping and labels through the registry, not per-panel guesses.

### P1 - make daily work scannable

1. Put One Desk and actionable alerts at the beginning of the Dashboard flow.
2. Give every long list the same search/filter/result-count treatment.
3. Keep management summaries compact; place detail tables behind a deliberate action
   or expandable region.
4. Make primary actions visually distinct and keep destructive actions separated,
   confirmed, and followed by visible outcome feedback.
5. Show loading, stale, failed, empty, and permission states with the same language
   and layout across modules.

### P1 - make both companies visible and safe

1. Add an active-company context to operational screens once company membership is
   implemented. It must show the legal name, not only `a2z` or `azoo`.
2. Show `Issued by A2Z CREATIVE MARKETING` or `Issued by AZ ONE OFFICIAL` near
   document actions, with the correct bank/entity context where relevant.
3. Make company filtering explicit in lists and reports. A consolidated view must
   be labeled as consolidated and show its source company in each drill-down.
4. Do not use a customer's free-text `company` field as the internal company filter.

### P1 - make approval and signing understandable

Use a consistent visual sequence:

```text
Draft -> Submitted -> Checked -> Awaiting signature -> Signed/Approved -> Released/Posted
```

The screen should show who owns the current step, what evidence was checked, the
company, amount or affected record, and the next allowed action. Signing should
open a focused confirmation area containing signer identity, company, document
revision, verification status, and final confirmation. The signature image is a
result of the event, not the only evidence.

### P2 - responsive and accessible behavior

- Design at 390px, 768px, 1024px, and 1440px. Do not rely on desktop overflow to
  solve a mobile layout.
- Keep touch targets at least 44px where staff tap them repeatedly. Dense desktop
  tables may use smaller visual rows if the mobile control remains usable.
- Preserve keyboard focus, visible focus rings, logical tab order, labels, and
  status announcements for saves, errors, and live updates.
- Test long staff names, long customer names, large amounts, empty data, slow
  networks, denied permissions, and BM text before accepting a layout.
- Maintain light and dark theme contrast using semantic tokens. Do not introduce a
  new color directly in a component when a token expresses the meaning.

## Rollout order

| Release slice | Screens | Completion evidence |
|---|---|---|
| 1. Shared primitives | `lib/ui-styles.ts`, AppIcon, shell, common dialogs/feedback | Token inventory complete; no unexplained duplicate control style |
| 2. Portal pilot | Dashboard, One Desk, Inventory, Sales | 390px/1440px screenshots and state matrix approved by daily users |
| 3. People workflows | HR, Staff Details, Attendance, Leave, Claims, Payroll | Approval ownership and bilingual error/empty/loading states verified |
| 4. Money workflows | Finance, Reconciliation, Purchasing, Accounting, documents | Company, totals, and action outcomes visible in each workflow |
| 5. Admin/account | Admin CMS, Users, customer account, settings | Same shell and control language without exposing staff-only concepts |
| 6. Cleanup | Remove obsolete style literals, dead icon/emoji maps, stale docs | Guard passes, no unexplained exceptions, updated screenshots and guides |

## Pilot implementation record

The first visual slice now routes Dashboard quick actions through `btnQuick` and
`btnQuickPrimary`, uses `PanelTitle` for repeated work-area headings, uses the
shared chip vocabulary for One Desk and Inventory status controls, and replaces
the remaining decorative text arrows in these surfaces with AppIcon chevrons.
The card and data behavior is unchanged. The next review gate is rendered
validation at 390px and 1440px, followed by the Sales screen before this slice
is considered complete.

## Acceptance checklist

- A new staff member can identify the current module, company, period, status, and
  next action without opening multiple panels.
- The same control has the same height, icon treatment, focus state, and feedback
  behavior across portal, admin, and account screens.
- A card expanded with detail remains visually one card and keeps its sibling aligned.
- A failed request never looks like an empty result or completed action.
- A document action always shows its issuing company; a signing action shows signer,
  revision, verification, and result.
- Light/dark, EN/BM, keyboard, mobile, and long-content checks pass for every slice.
- `npm run ci` and relevant browser scenarios pass. Browser screenshots are retained
  with the release review; source inspection alone is not visual acceptance.

## Decisions before visual implementation

1. Confirm whether the desktop rail and current tab ordering remain unchanged.
2. Confirm the preferred density for payroll, attendance, and inventory tables.
3. Confirm whether the active company selector is global or shown only on company-owned
   modules.
4. Confirm the signing verification method and the wording used for a final approval.
5. Select one daily user from HR, Finance, and Operations for the pilot review.
