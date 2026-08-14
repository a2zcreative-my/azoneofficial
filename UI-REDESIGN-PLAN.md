# AZ ONE — UI/UX Uplift Implementation Plan

**Goal:** make `/portal`, `/admin` and `/account` look and feel like the reference design (CL mobile application screenshots) — polished app shell, calendar-first scheduling view, stat-tile dashboard, and a native-app-quality mobile experience — **without changing a single flow, permission, API call, or the navy/gold brand palette.**

**Status:** PLAN ONLY — nothing has been changed yet. Approve (or adjust) this document first.

---

## 0. Non-negotiables (locked before we start)

| Rule | Meaning in practice |
|---|---|
| System flow unchanged | Every tab, card, approval chain, punch rule, role gate, and API call stays exactly as it is. This is a re-skin + layout upgrade, not a rebuild. |
| Main colors unchanged | Navy `#1a2946` stays the primary; gold `#C8A96A` / deep gold `#7D6027` / solid gold `#C9A227` stay the accents. The reference's maroon/pink is **translated**, never adopted. |
| Static export stays | Everything remains client-side React in the existing pages; no server runtime, no new deployment shape. |
| No heavy libraries | Charts stay pure-div/inline-SVG (the codebase's stated rule). No chart library, no calendar library, no map library. Framer Motion (already installed) is the only animation dependency. |
| Dark mode + WCAG AA | Every new component must work in both themes and keep the existing contrast standards. |
| Ship in phases | Each phase leaves the portal fully working. No big-bang rewrite of the 4,800-line portal page. |

---

## 1. What the reference design is actually made of

Deconstructing the three screenshots into reusable patterns:

### Screen anatomy

```
┌─ dark backdrop band ──────────────────────────────────────────────┐
│ ┌──────┐ ┌───────────────────────────────────────────────────┐   │
│ │ icon │ │  rounded "canvas" (the app surface, radius ~24px) │   │
│ │ rail │ │ ┌──────────┐ ┌──────────────────────┐ ┌─────────┐ │   │
│ │(brand│ │ │ context  │ │ main work area       │ │ right   │ │   │
│ │color)│ │ │ panel:   │ │ · KPI stat strip     │ │ rail:   │ │   │
│ │      │ │ │ mini     │ │ · calendar week grid │ │ queues, │ │   │
│ │      │ │ │ calendar │ │   OR chart + table   │ │ "avail- │ │   │
│ │      │ │ │ + today's│ │ · hover tooltips     │ │  able   │ │   │
│ │      │ │ │ list     │ │ · filter chip row    │ │  now"   │ │   │
│ │      │ │ └──────────┘ └──────────────────────┘ └─────────┘ │   │
│ └──────┘ └───────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### The 12 visual patterns to reproduce

1. **Icon rail** — slim, brand-colored, icon-only vertical nav with rounded outer corners; active item gets a lighter "inset card" highlight; settings/sign-out pinned at the bottom.
2. **Rounded canvas** — the whole app sits on a dark band as a large rounded surface; content breathes inside it.
3. **Context panel (left)** — mini month calendar + "today at a glance" cards (time-ranged items with avatar, package chip, status chip).
4. **KPI stat strip** — 4 compact tiles in a row: big number, small label, icon in a soft-tinted squircle (42 Scheduled / 18 Available / 7 On leave / 3 Conflicts).
5. **Week time-grid calendar** — hours down the side, days across the top, assignment blocks with name/time/avatar, soft tinted fills, "today" column highlighted, hover tooltip card with full details + status chip, zoom and location/status filters, primary "New assignment" button.
6. **Right rail queues** — "Unassigned requests" (with urgency chips + inline action link) and "Available now" (avatar list with online dots).
7. **Hero stat tiles** — dashboard top row: oversized numerals ("10:00—12:30", "247 +13%", "4.9 ★"), tiny trend/progress underline.
8. **Bar chart with tooltip** — monthly bars, two-tone (total vs completed), one hoverable value bubble.
9. **Donut/ring stat** — "Attendance today: 247 scheduled" ring split into on-time / late / not-clocked-in with a legend.
10. **Status table** — compact table with entity chip (initials), colored package/status chips, confirmation column with ✓/○ icons.
11. **Map card** — regional totals as count bubbles on a map (nice-to-have; see Open Decisions).
12. **Mobile "Today" screen** — greeting + date, **Next Assignment** hero card (brand-colored, time/location/countdown chip), **Ready to clock in** action card (GPS verified line + requirements + one big button), a 2-column checklist of today's items with progress ("2 of 4 completed"), fixed bottom tab bar (Today / Schedule / Reports / Profile), top bar with sync status dot + notification bell.

### Typography & spacing rhythm

Large friendly greeting (28–32px semibold), 12–13px muted labels, big tabular numerals for stats, generous 20–24px card padding, 12–16px card radius, soft shadows only.

---

## 2. Color translation (reference → AZ ONE)

The reference is maroon/rose. We keep our tokens and map **roles**, not hues:

| Role in reference | Reference color | AZ ONE token to use |
|---|---|---|
| Icon rail / hero card fill | Deep maroon | `--brand-primary` navy `#1a2946` |
| Rail active highlight | Lighter maroon inset | navy +12% lightness (`#243759` — new token `--brand-primary-soft`) |
| Soft pink card tints / calendar block fills | Rose tints | `--brand-accent-soft` `#e6d7b8` at low opacity, or navy at 6–8% opacity (new `--tint-gold` / `--tint-navy`) |
| Accent numbers / progress | Maroon | `--gold-deep` `#7d6027` on light, `--gold` `#c8a96a` on navy |
| Success dots / confirmed chips | Green | existing `--success` / `--success-soft` |
| Warning (pending, conflicts) | Amber | existing `--warning` / `--warning-soft` |
| Dark backdrop band | Near-black plum | navy-black `#0d1526` (new `--shell-backdrop`) — doubles as the dark-mode base |
| Chart bars (light/full) | Pink pair | `--tint-gold` for the background series, `--gold-solid` for the emphasis series |

> One caution: our design mandate (ARCHITECTURE.md) says *avoid gradients and overly rounded elements*. The reference leans on both. The plan uses **flat tints instead of gradients** and caps radius at 16px for cards / 24px for the shell — modern but still inside the brand's "premium corporate" line. Flagged in Open Decisions if you want it softer/rounder than that.

---

## 3. Gap analysis — current vs target

| Area | Today | Target | Gap size |
|---|---|---|---|
| App shell | Plain page: header row + pill tab grid (desktop) / bottom nav (mobile) | Icon rail + rounded canvas + context panel | **Large** (new shell component, but wraps existing content) |
| Dashboard | Stack of cards (`StatCard`, summaries, punch card) | Hero stat tiles + chart row + donut + table grid layout | Medium (re-arrange + 2 new viz components) |
| Scheduling | `LiveScheduleCard` (list-style) + `EventsCalendar` | Week time-grid roster with blocks, tooltips, filters, right-rail queues | **Large** (new WeekGrid component; data already exists: live sessions, events, leave) |
| Attendance monitor | Table/list ("who punched today") | Donut ring + legend + same list | Small |
| Stat tiles | `StatCard` + `MiniBar` exist | Bigger numerals, icon squircle, trend underline | Small (upgrade in place) |
| Tables | Consistent `th/td` classes | Add entity chips, avatar initials, icon confirmation column | Small |
| Mobile Today | Dashboard tab already has punch buttons, pending items | Dedicated "Today" composition: greeting, Next Assignment hero, clock-in action card, today checklist, progress | Medium (composition of existing data, new presentation) |
| Mini calendar | None (events calendar is month-grid in a card) | Reusable `MiniCalendar` for the context panel | Small |
| Avatars | Photos in staff directory only | `Avatar` (photo → initials fallback) used everywhere | Small |
| Map card | None | Optional Malaysia SVG with count bubbles | Medium (optional) |

**Reuse the good news:** role/tab gating, SSE bell, dark mode, PWA + bottom nav, `ui-styles.ts` consolidation, and semantic status tokens already exist — the reference look is mostly a **presentation layer** on top of what's already fetched.

---

## 4. Foundations — new design tokens & primitives (Phase 0)

All in `styles/globals.css` + `lib/ui-styles.ts`. No component behavior changes.

```css
/* additions — nothing existing is renamed */
--shell-backdrop: #0d1526;        /* dark band behind the canvas */
--brand-primary-soft: #243759;    /* rail active highlight, on-navy hover */
--tint-navy: rgba(26,41,70,.06);  /* soft fills, calendar blocks */
--tint-gold: rgba(200,169,106,.16);
--radius-card: 16px;              /* cards step up from 12px */
--radius-shell: 24px;             /* the canvas + rail outer corners */
--shadow-soft: 0 1px 2px rgba(13,21,38,.05), 0 8px 24px rgba(13,21,38,.06);
```

New `ui-styles.ts` strings: `tile` (stat tile), `heroNum` (oversized tabular numeral), `iconSquircle`, `railBtn`/`railBtnActive`, `panelCard`, `chipUrgent`.

New primitives in `components/ui/`:

| Component | File | Notes |
|---|---|---|
| `Avatar` | `avatar.tsx` | photo url → colored-initials fallback (navy bg, gold text); sizes sm/md/lg; optional online dot |
| `StatTile` | upgrade `stat-card.tsx` | icon squircle slot, trend prop (`+13% last month`), progress underline — keep old API working |
| `DonutStat` | `donut-stat.tsx` | pure SVG ring, N segments from semantic tokens, center number, legend rows |
| `BarChart` | `bar-chart.tsx` | pure-div two-series bars + one active tooltip bubble (generalize `sales-by-hour-card` internals) |
| `MiniCalendar` | `mini-calendar.tsx` | month grid, dot markers for days with items, controlled selected-day |
| `SegmentedTabs` | `segmented-tabs.tsx` | the pill filter row (`Today · < > · Week of…`, `Status ▾`) |
| `Tooltip card` | `hover-card.tsx` | positioned hover/tap detail card used by WeekGrid + charts |

*(Verification step: render all primitives on a temporary `/portal` dev-only "Styleguide" card in both themes before any screen uses them.)*

---

## 5. The app shell (Phase 1) — biggest visible win

New `components/layout/app-shell.tsx`, used by `/portal`, `/admin`, `/account` (one shell, three configs).

**Desktop (≥ md):**
- Dark `--shell-backdrop` page background; content inside a `--radius-shell` white/dark-card canvas.
- **Icon rail** (left, navy): logo top; one icon per existing tab (the *same* `tabs` array, same gating, same `tabOverrides` — the rail is purely a re-render of today's pill nav); overflow tabs collapse into a "⋯ More" popover; theme toggle, settings, sign-out pinned bottom. Tooltip labels on hover; `aria-label` on every icon.
- **Context panel** (optional per screen): `MiniCalendar` + "today" list; collapsible; only rendered on tabs where a date context makes sense (Dashboard, Attendance, Leave, Sales/Live schedule, Events).
- **Header row** inside the canvas: greeting ("Good morning, {firstName}" — time-of-day aware, `lib/names.ts` already gives us `firstName`), search field where the tab already has search, language stub (see Open Decisions), bell (existing SSE logic moves in unchanged), avatar menu.

**Mobile (< md):**
- Keep the existing bottom nav + More sheet (already app-grade) — restyle only: active tab gets a filled navy pill like the reference's "Today", icons above labels (icons are new; today it's text-only).
- The rail is hidden; the canvas becomes full-bleed (no dark band on phones — matches the reference's phone frame).
- Top bar: logo mark, **sync status dot** ("Data synced" = last successful fetch/SSE heartbeat, turns amber when `offline-banner` state trips), bell with unread badge (exists).

**Migration mechanics (the safe path for a 4,800-line page):** `app/portal/page.tsx` keeps ALL state and logic; we only replace the outer JSX (header + two navs + More sheet) with `<AppShell tabs={tabs} tab={tab} onTab={setTab} …>{content}</AppShell>`. Admin and account follow after portal proves the shell. Zero data-flow edits.

---

## 6. Screen-by-screen application

### 6.1 Portal Dashboard → the reference "Hello, Sarah!" screen (Phase 2)

Same data, new arrangement (desktop 3-column grid, mobile single column):

| Reference element | AZ ONE source (exists today) |
|---|---|
| Peak activity time tile | `sales-by-hour-card` data → top hour range |
| Total CLs tile w/ trend | GMV / revenue month tile (`/gmv`, `/revenue`) with the +% vs last month it already computes |
| Avg rating tile | No rating system → use "Attendance streak" or "Docs outstanding" tile instead (**no new flow invented**) |
| Active CLs bar chart | `BarChart` over monthly revenue or live-session counts (both endpoints exist) |
| Attendance today donut | `DonutStat` over `/attendance/monitor` (on-time / late / not clocked in — flags already computed server-side) |
| Assignments table | Today's live sessions (`/live-sessions`) with host `Avatar`, package chip, Confirmed/Pending chips |
| Left roster list | Context panel "today" list: sessions + events + who's on leave |
| Operations map | Optional Phase 6 (buyer-city + session data exists) |

Role note: every element keeps its existing role gate — e.g. revenue tiles render only for `revenue_view`, exactly as now. Users lacking a card simply see a tighter grid (no locked placeholder needed on the dashboard).

### 6.2 Live Schedule → the reference "Schedule & Roster" screen (Phase 3)

The flagship new component: **`components/portal/week-grid.tsx`**, rendered inside the existing Sales/Live area (and reused by Events).

- KPI strip: Scheduled (sessions this week) · Available hosts (active `live_host`s minus booked/leave) · On leave (approved leave overlapping the week) · Conflicts (overlapping sessions per host — computed client-side from the already-fetched list).
- Grid: hours × Mon–Sun, blocks from `/live-sessions` (`session_date`, `start_time`, `end_time`, host, client, platform). Soft `--tint-gold` fills, navy left-edge bar, "today" column tinted. Hover/tap → `HoverCard` with client, host avatar, slot, location, status chip.
- Right rail: **Unassigned/pending** (sessions without a host, or pending leave requests for approvers — both exist) + **Available now** (hosts with no session at this hour).
- Toolbar: Today / ‹ › week pager / week label, status + platform filters (`SegmentedTabs`), **+ New session** button opening the *existing* create form in a slide-over instead of an inline card.
- Permissions unchanged: management sees all + can create; hosts see their own sessions only (the API already enforces this — the grid just renders fewer blocks).
- Mobile: the grid becomes a **day view** (one column, swipe/arrow between days) — a week grid is unusable at 390px; the reference itself never shows one on the phone.

### 6.3 Mobile "Today" experience (Phase 4) — the phone screenshot

This is a re-composition of the Dashboard tab **on mobile only** (desktop keeps the grid):

1. Greeting block: `Selasa, 4 Ogos`-style date (Malay day names — `lib/format.ts` gains `dmyMS()`), "Good morning, {firstName}".
2. **Next Assignment hero card** (navy, gold accents): the user's next live session (hosts), next event, or next approval waiting (approvers) — whichever exists first; time, location/platform, "Starts in 45 minutes" chip (client-side countdown).
3. **Clock-in action card**: today's punch state re-skinned — "Ready to clock in" + one full-width navy button; after 18:00 the OT buttons take the slot (existing logic, existing rules, GPS line shows only if the punch already captures GPS — it does, optionally). *No selfie feature — that line is dropped, not faked.*
4. **Today checklist with progress** ("2 of 4 completed"): the user's open tasks due/created today + unacknowledged announcements + pending claims/leaves awaiting *their* action — all existing queries, presented as tick cards.
5. Bottom nav relabel (mobile only): first slot renders as **Today** (it's the Dashboard tab under a friendlier name), then the user's next tabs as now.

### 6.4 Admin + Account (Phase 5)

- `/admin` adopts `AppShell` (icon rail from its existing TABS, same role filters), Dashboard tab gets `StatTile` row + activity feed styling; CRUD panels/tables restyled with `Avatar` + chips. No functional change.
- `/account` gets the mobile-first card treatment (hero card = latest order/doc status), same three tabs.
- `/login` gets the canvas treatment (navy backdrop, centered rounded card) — 30-minute cosmetic job, big first impression.

### 6.5 Operations map (Phase 6 — optional)

Inline Malaysia SVG (public asset, ~15KB) + absolutely-positioned count bubbles per state from `buyer_city` on postage records / customer data. Read-only, hover totals. Only if you want it — everything else stands without it.

---

## 7. Phase plan & estimates

| Phase | Scope | Est. effort | Ships alone? |
|---|---|---|---|
| **0. Foundations** | Tokens, `Avatar`, `StatTile` upgrade, `DonutStat`, `BarChart`, `MiniCalendar`, `SegmentedTabs`, `HoverCard`, dev styleguide card | 1.5–2 days | Yes (invisible) |
| **1. App shell** | `AppShell` + icon rail + canvas + greeting header; portal first, restyled bottom nav | 2–3 days | Yes — biggest visual jump |
| **2. Dashboard** | Grid layout, tiles, donut, bar chart, sessions table, context panel | 2 days | Yes |
| **3. Week grid** | `WeekGrid` + KPI strip + right rail + slide-over create; mobile day view | 3–4 days (the hard one) | Yes |
| **4. Mobile Today** | Hero card, clock-in card, checklist, Malay dates, nav polish | 1.5–2 days | Yes |
| **5. Admin + Account + Login** | Shell adoption + table/chip restyle | 2 days | Yes |
| **6. Map (optional)** | Malaysia SVG ops map | 1–1.5 days | Yes |
| **QA pass per phase** | Both themes, 390px/768px/1440px, role sweep (host vs HR vs CEO vs admin), Lighthouse a11y | included above | — |

Total: **~12–15 working days** across 6 independent releases. Each phase ends with `pnpm typecheck && pnpm lint && pnpm build` and a role-by-role visual sweep before the next begins.

---

## 8. Risks & guardrails

| Risk | Guardrail |
|---|---|
| Touching the 4,800-line portal page destabilizes logic | Shell swap replaces **outer JSX only**; state, effects, gating untouched. One tab at a time thereafter. |
| Icon rail hides tab names → discoverability drop | Tooltips + first-run labels-visible state; mobile keeps text labels. |
| Week grid conflicts with API pagination/shape | Grid consumes the exact list the current schedule card already fetches — no endpoint changes. |
| Rounded/tinted look drifts off-brand | Radius caps (16/24px), flat tints only, gold reserved for accents — reviewed against ARCHITECTURE.md design principles at each phase. |
| Dark mode regressions | Every new token gets a `.dark` value in the same commit; styleguide card renders both themes side by side. |
| CEO's "equal-width tabs" directive (v1.4.159/187) | That directive governed the pill grid; the rail replaces it. Flag for CEO sign-off explicitly (it's his recorded standard). |
| Bundle growth | No new deps; pure SVG/div viz; Malaysia SVG lazy-loaded. |

---

## 9. Acceptance checklist (definition of "looks like the reference")

- [ ] Desktop portal shows dark band → rounded canvas → navy icon rail → greeting header.
- [ ] Dashboard: ≥3 stat tiles with oversized numerals, one bar chart with tooltip, attendance donut with legend, today's-sessions table with avatars + status chips.
- [ ] Schedule: week time-grid with tinted blocks, hover detail card, KPI strip, unassigned/available rails, day-view on mobile.
- [ ] Mobile: greeting + Next Assignment hero + clock-in card + today checklist + styled bottom nav, installable PWA unchanged.
- [ ] Zero changes to: API calls, role gates, tab access overrides, approval chains, punch rules, doc flows.
- [ ] Navy/gold everywhere the reference used maroon/pink; AA contrast in both themes.
- [ ] `pnpm typecheck`, `lint`, `build` clean; no new dependencies.

---

## 10. Open decisions (need your call before Phase 0)

1. **Rounding & tints** — the plan caps at 16px cards / 24px shell with flat tints (no gradients), honoring the documented design mandate. Want it exactly as soft/round as the reference instead? Say so and I'll note the mandate exception.
2. **Icon rail vs. keeping top tabs on desktop** — plan says rail (it *is* the reference look). Keeping the pill grid and doing everything else is also viable and cheaper.
3. **Language selector** — the reference header has one (English ▾). The system is English-only today; building real BM translations is a separate project. Plan: omit it (recommended) or show a disabled stub?
4. **Operations map** — include Phase 6 or drop?
5. **"Average care rating" tile** — no rating flow exists; plan substitutes an existing metric. OK, or do you want a client-rating feature scoped separately later?
6. **Scope order** — plan does portal → mobile → admin. If your priority is mobile first (your team lives on phones), Phases 4 can jump ahead of 2–3.

---

*Prepared 13 Aug 2026 against codebase v1.7.x. Companion doc: WORKFLOW.md (system flows — all of which this plan preserves).*
