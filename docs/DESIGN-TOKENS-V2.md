# V2 Design Tokens

**Added:** P0.2, 22 September 2026 (`v1.178.0`).
**Where they live:** `styles/globals.css` (the tokens) · `styles/erp-v3.css` (the classes) · `lib/breakpoints.ts` (the widths).
**Held by:** `tests/interface-v3.mjs` — a new raw font size, a bare `z-index`, an off-scale breakpoint or a CSS/TS breakpoint disagreement fails the build.

---

## Why this exists

The interface audit found **five token groups with no scale at all** — spacing, typography, z-index, motion, breakpoints — and two that were stubs. The visible consequence: `.erp-heading`, `.erp-panel-title` and `.erp-card-title` all resolved to **14px / 600**, so the design system had a heading hierarchy of one and literally could not say *"this is a page"*.

This layer is the source of truth for interface decisions. **Adoption is incremental**: new V2 work reads these, a module still spelling a literal keeps working, and P2 migrates the modules.

**Read this before inventing a value.** If something you need is not here, add it here rather than in a component — that is the whole point.

---

## How to choose

| You are styling | Use |
|---|---|
| any text | a `--type-*` role, via `.erp-type-*` |
| any gap, padding or margin | a `--space-*` step |
| a background | `--surface*`, never `--card` in new code |
| ink | `--text-primary/secondary/muted/inverse` |
| a corner | `--radius-*` — `full` only for chips, segmented controls, avatars |
| a shadow | `--elev-*` — and prefer a border |
| a stacking order | `--z-*` |
| a transition | `--dur-*` + `--ease-*` |
| a width query | a tier from `lib/breakpoints.ts` |
| a page's width | a `--measure-*` |

---

## 1. Typography — roles, not sizes

**Pick the role by what the text IS, never by the size you want.** A card's heading is `card` on every tab at every width. If it should look different, the role changes here, once.

| Role | Class | Size / weight | Use for | Do **not** use for |
|---|---|---|---|---|
| display | `.erp-type-display` | 28 / 650 | a number on a wall, an empty-state headline | ordinary page titles |
| page | `.erp-type-page` | 20 / 600 | the one heading naming the destination | a card |
| section | `.erp-type-section` | 16 / 600 | a group of cards | every card heading |
| card | `.erp-type-card` | 14 / 600 | a card or panel heading | body text in bold |
| body | `.erp-type-body` | 14 / 400 | the sentence a person reads | dense table cells |
| body-sm | `.erp-type-body-sm` | 13 / 400 | a secondary line under a row | a whole paragraph |
| caption | `.erp-type-caption` | 12 / 400 | metadata, timestamps, hints | anything load-bearing |
| label | `.erp-type-label` | 11 / 600 caps | zone captions, field labels | a sentence |
| kpi-lg | `.erp-type-kpi-lg` | 30 / 650 tabular | the figure a dashboard exists for | text |
| kpi-md | `.erp-type-kpi-md` | 20 / 600 tabular | a stat tile's value | text |

**A figure is not a heading.** The KPI roles set `font-variant-numeric: tabular-nums` so a column of money lines up without every caller remembering `.erp-num`.

**Poppins is unchanged.** The scale is a 1.125–1.25 ratio off a **14px** body — a business screen reading at 16px wastes a third of a phone. Poppins is geometric and reads tight small, so small roles open the tracking and display roles close it.

**Grandfathered:** `.erp-text-xs/sm/base/lg` (sizes) and the three 14px/600 heading classes stay. Retyping them is a product-wide visual change — P2's job. Only the shell adopted the scale in P0.2: `.erp-topbar-title` → `page`, `.erp-zone-label` → `label`.

## 2. Spacing

One 4px scale: `--space-half|1|2|3|4|5|6|8|12` = 2, 4, 8, 12, 16, 20, 24, 32, 48px.

4 icon→label · 8 inside a control · 12 between rows · 16 card padding · 24 between zones · 32 between page regions.

**If a gap needs 7px the design is wrong before the CSS is.**

## 3. Colour

**Navy anchors, gold accents.** Gold is **not** the default for anything interactive. A button, a link and a row hover are navy or neutral; gold is kept for the one thing on a screen that is the brand speaking — the primary action, the active figure, the focus glow. *An interface where everything is gold has no accent at all.*

Surfaces: `--surface` · `--surface-raised` (above a card) · `--surface-subtle` (inset strip) · `--surface-hover`.
Ink: `--text-primary` · `--text-secondary` · `--text-muted` · `--text-inverse`.
Lines: `--border` · `--border-subtle` · `--border-strong`.
Brand: `--brand-anchor` · `--brand-accent-ink`. State: `--selected` · `--selected-strong`.
Status keeps the V1 names: `--success|warning|danger|info` and their `-soft` pairs.

These are **aliases onto the V1 palette**, not replacements. `--card` says what it *is*; `--surface` says what it is *for*. Two names for one colour means a future retheme moves one line instead of 128 files, and neither name can drift from the other.

## 4. Dark mode

Not an inversion. Three groups are restated in `.dark` because they cannot be derived:

- **`--surface-hover`** — `--secondary` is *lighter* than `--card` on dark, right for an inset strip and wrong for a hover, which must read as the row **lifting**. It mixes toward white instead.
- **`--elev-*`** — on `#0a1120` a bigger blur is a smudge. What reads as "above" is the 1px of light along the top edge (`--erp-hairline`), so each step gains an inset highlight and keeps its shadow tight. The shadows carry no blue: a blue-black shadow greys the ground it falls on.
- **`--text-secondary`, `--border-strong`, `--selected`** — a 78% mix of white greys faster than 78% of near-black, so secondary ink holds at 82%; "strong" moves toward white, not toward the ink; and `--primary` on dark is near-white, so the selection wash needs its own mix to mean the same thing.

The ladder, dark: ground `#0a1120` → card `#16213a` → raised `#1d2b47`.

## 5. Radius

`--radius-xs` 4 · `--radius-sm` 8 · `--radius-control` 10 · `--radius-card-v2` 14 · `--radius-overlay` 18 · `--radius-full`.

**`full` is only for:** status chips, filter chips, segmented controls, avatars, icon buttons. **Not cards. Not inputs.** Equal rounded weight everywhere is why the interface read as flat.

## 6. Elevation

`--elev-none|subtle|raised|overlay`.

**Borders before shadows.** A dashboard where every card floats has no hierarchy. `subtle` is a resting card; `raised` is one under the pointer or a figure that matters; **`overlay` means the surface is genuinely above the page** — dropdown, drawer, modal, toast.

## 7. Z-index

`--z-base` 0 · `--z-raised` 1 · `--z-sticky` 10 · `--z-nav` 30 · `--z-topbar` 40 · `--z-dropdown` 50 · `--z-drawer` 60 · `--z-modal` 70 · `--z-toast` 80.

The order answers *"what may cover what"*: a drawer covers the navigation, a modal covers the drawer, a toast is seen over everything because it reports what just happened. Gaps of 10 leave room to sit just above a neighbour without a new layer. **A guard asserts the ordering**, so an overlay cannot end up beneath the bottom bar.

*Known:* `components/ui/offline-banner.tsx` is a legacy `z-50` and covers the topbar **by position**, not by layer — P3.

## 8. Motion

`--dur-fast` 120ms (a press answering the thumb) · `--dur-base` 200ms (a panel arriving) · `--dur-slow` 320ms (entering from off-screen). `--ease-out` for arriving, `--ease-in` for leaving.

Animate `transform` and `opacity` only — anything that costs a layout on press does not ship, because staff clock in on old phones. Everything sits behind `prefers-reduced-motion`.

## 9. Breakpoints

**`lib/breakpoints.ts` is the source of truth.** `globals.css` states the same numbers as `--bp-*` and a guard fails the build if they disagree. Custom properties cannot be used inside `@media`, so the numbers are necessarily written twice — the guard is what makes that safe.

| Tier | Width | The interface becomes |
|---|---|---|
| — | <640 | bottom bar, one column, sheets, record cards |
| `sm` | ≥640 | still the phone shell; two things side by side |
| `md` | ≥768 | side rail replaces the bottom bar; drawers; two-up zones |
| `lg` | ≥1024 | tables, module toolbars, three-up zones |
| `xl` | ≥1280 | **context panel, right rail, master-detail, content measures** — P1 |
| `xxl` | ≥1600 | same shape, wider gutters, full workspace measure |

**A breakpoint is a change of shape, not a number.** Use `up("md")`, `atLeast("xl")`, `onBreakpoint()` — never a literal in TypeScript.

*Grandfathered:* one 400px query on the bottom-nav label, pre-dating the scale.

## 10. Density

`comfortable` (default) and `compact`, via `[data-density="compact"]` on a **container** — never globally, never on a phone. Compact is for a management surface read with a mouse: DataTable rows, an admin list.

**A touch device reverts compact to the 44px floor.** The accessibility rule outranks the density, and the media query enforcing it is not negotiable. No user-facing setting exists yet.

## 11. Focus and state

`--focus-ring-width` 2px · `--focus-ring-offset` 2px · `--focus-ring-color` (`--ring`) · `--focus-glow` · `--disabled-opacity` 0.55.

**The 2px outline is the accessibility contract and always stays.** The gold glow sits *behind* it, never instead of it. Never remove focus without a visible replacement.

## 12. Content measure

`--measure-prose` 68ch · `--measure-standard` 56rem · `--measure-wide` 90rem · `--measure-full` 100rem, with classes `.erp-measure-*`.

**Not one max-width for everything.** A form is read in a column; a roster needs the glass. `.erp-page` is still uncapped — P1's `PageHeader`/`AppShell` chooses the measure per page, which is what finally fixes a settings form spanning a 2560px monitor.

---

## The development specimen

```
pnpm build && node tests/browser/serve.mjs out 4177 &
open http://127.0.0.1:4177/__tokens
```

`tests/browser/tokens.html`, served from the **built** stylesheet so a specimen that looks right there looks right in the product. It is not a route — nothing was added under `app/`, so no production build contains it.

A token scale is the one kind of change that is invisible in a diff and obvious on a page. Five minutes here catches a heading role reading the same as the one above it, a hover that sinks instead of lifting, and a focus ring that vanishes on the dark ground.

---

## What the guards enforce

1. Every type role has a class **and** a token quartet, and no role hard-codes its size.
2. Raw `font-size` in `erp-v3.css` **may not increase** (budget 52, falls only).
3. **No raw `z-index`** in the V3 sheet, and the layers are ordered so an overlay always covers the navigation.
4. Breakpoints: CSS and TypeScript agree, and V3 media queries stay on the scale (one grandfathered exception).
5. All eleven groups exist, dark restates what it must, and compact reverts to 44px on touch.

**They stop new drift; they do not demand the existing sheet be migrated.** That is the point of doing the foundation first.
