# P1 — Application Shell, Routing and Navigation

**Status:** APPROVED IN PRINCIPLE, revision 2. P1.0 and P1.1 are authorised;
P1.2 onward is not.
**Baseline read:** `v1.179.0`.
**Owner decisions, all settled (rev 1):** ELFIA routes stay **flat**; the
sales-document record URL is **deferred to P2**; **no Create stop** on the
phone bar in P1; `/admin` gets a shell variant **last**, `/account` is
untouched. The four **DECIDE** markers below are resolved and kept only as a
record of the reasoning.

### Revision 2 — three owner corrections, applied throughout

1. **Entry is separated from Home.** `/portal` is an **entry resolver only**
   and is never a destination; `/portal/home` is the canonical Dashboard and
   consults nothing. This removes a real navigation bug: with `/portal` as
   both, pressing Home from `/portal/sales` would have let the resolver send
   the person straight back to Sales. §3.3, §4.
2. **The rollback bridge ships BEFORE the routing switch**, as its own
   release (**P1.0b**), so a reverted P1.2 cannot take the bridge with it.
   §26.3.
3. **No stage is ever intentionally red.** The route-directory parity
   assertions are written so they are green with zero route files, green with
   all of them, and red only for a partial set. §26.1.

---

## 0. What the repository actually is today

Four facts, read from the code rather than from the audit, because three of
them change what P1 can do.

**1. The portal is one route and one `useState`.** `app/portal/page.tsx`
(1,917 lines) holds `const [tab, setTab] = useState<TabName>("Dashboard")`
and 33 `activeTab === "…"` branches. There is no `useRouter` anywhere in the
portal; the only `next/navigation` imports in the repository are
`usePathname` in four marketing-site components and `notFound` in two static
pages.

**2. The registry is already correct and already single.**
`lib/portal-tabs.ts` owns `ALL_TABS` (32 names), `TAB_ROLES`,
`ALWAYS_VISIBLE`, `PARKED_TABS`, `canSeeTab`, `accessOf`, `mobileNavStops`.
`side-nav.tsx` `SECTIONS` is a *cut* of that sequence, not a second ordering,
and `tests/registry-parity.mjs` holds them together. **P1 does not need a new
navigation model — it needs a `slug` on the model that exists.**

**3. `output: "export"` is not negotiable, and it decides the record-URL
shape.** Every dynamic segment in this repository — `app/[card]`,
`app/blog/[slug]` — is backed by `generateStaticParams` over a *constant*.
Record IDs live in D1 and cannot be enumerated at build time, so
`/portal/quotations/[id]` cannot be produced by this build. §9 and §15 deal
with this properly rather than proposing a hosting change.

**4. The service worker precaches exactly three documents.**
`public/sw.js` — `SHELL_URLS = ["/portal", "/account", "/login", …]` — and
its offline `fetch` handler returns `Response.error()` for any navigation
that is not in that list. **The day `/portal/sales` exists, an offline
navigation to it is a browser error page.** This is the single largest
non-obvious risk in P1 and it is addressed in §15.3.

Two smaller findings that P1 must not trip over:

- **`/portal` has a fourth entry rule nobody has written down.** After the
  `?tab=` and `sessionStorage` checks, `page.tsx:395` fetches
  `/staff/attendance` and, if `today_shift.entry.launch_shift` is true,
  moves a Dashboard landing to **On Shift**. That is live behaviour for
  people whose shift launches the clock. §9 preserves it in place.
- **`RecordDetail` already pushes its own history entry.**
  `components/ui/record-detail.tsx` does `history.pushState({recordDetail:
  marker})` and closes on `popstate`. The moment a record's identity moves
  into the URL, that becomes a second, competing history entry. §7.3.

---

## 1. Active module inventory

29 active modules. `Threads`, `Stokis` and `Content` are **PARKED** —
`canSeeTab` answers no above the `super_admin` bypass — so they get **no
route**, no navigation entry and no slug. `Reconciliation`, `Ads Fund` and
`Purchasing` are retired and are not in the registry at all.

`ALWAYS` below means `ALWAYS_VISIBLE` — never hidden, never overridable.
`all staff` means the tab is absent from `TAB_ROLES`, i.e. open to every
staff role. Every rule below is what `canSeeTab` computes today; **P1 changes
none of them.**

---

## 2. Module → URL map

| # | Tab id | Label (EN / BM) | Section | Visibility | Canonical URL | Desktop | Mobile | Notes |
|---|---|---|---|---|---|---|---|---|
| — | *(entry resolver)* | — | — | — | **`/portal`** | — | — | **not a destination.** Resolves and `replace`s; §4 |
| 1 | `Dashboard` | Dashboard / Papan Pemuka | Overview | ALWAYS | **`/portal/home`** | rail, Overview | stop 1 (fixed) | Home always shows the Dashboard and consults nothing |
| 2 | `Desk` | Desk / Meja | Overview | ALWAYS | `/portal/desk` | rail | stop 2 for managers | |
| 3 | `Ecommerce` | Ecommerce / E-dagang | Sales | s_admin, admin, ceo, coo, cco, hr_admin, sales_mkt, marketing | `/portal/ecommerce` | rail | More | |
| 4 | `Sales` | Sales / Jualan | Sales | `SALES_ROLES` | `/portal/sales` | rail | stop 2 for sales-led | |
| 5 | `Enquiries` | Enquiries / Pertanyaan | Sales | `ENQUIRY_ROLES` | `/portal/enquiries` | rail | More | **not** nested under Sales — the owner ruled on this at v1.112.0 |
| 6 | `Sales Performance` | Sales Performance / Prestasi Jualan | Sales | s_admin, admin, ceo, coo, cco, sales_mkt, live_host | `/portal/sales-performance` | rail | More | one tab, one page — owner was explicit it is not a sub-tab |
| 7 | `Hankeis` | Hankei's | Sales | s_admin, admin, ceo, coo, cco, hr_admin, sales_mkt, marketing | `/portal/hankeis` | rail | More | record: `?order=` |
| 8 | `Inventory` | Inventory / Inventori | Operations | s_admin, admin, ceo, coo, cco, sales_mkt, marketing, hr_admin | `/portal/inventory` | rail | More | |
| 9 | `Assets` | Assets / Aset | Operations | hr_admin, coo, cco, ceo, s_admin, admin | `/portal/assets` | rail | More | |
| 10 | `Hotels` | Hotels / Hotel | Operations | s_admin, admin, ceo, coo, cco, hr_admin | `/portal/hotels` | rail | More | record: `?hotel=` |
| 11 | `ELFIA Store` | ELFIA Store / Kedai ELFIA | ELFIA | s_admin, admin, ceo, coo, cco, sales_mkt, marketing, hr_admin | `/portal/elfia-store` | rail | More | **DECIDE** §3.4 |
| 12 | `Web Orders` | Web Orders / Pesanan Web | ELFIA | same tier | `/portal/web-orders` | rail | More | **DECIDE** §3.4 |
| 13 | `ELFIA Traffic` | ELFIA Traffic / Trafik ELFIA | ELFIA | same tier | `/portal/elfia-traffic` | rail | More | **DECIDE** §3.4 |
| 14 | `HR` | HR | People | hr_admin, coo, cco, ceo, s_admin, admin | `/portal/hr` | rail | More | |
| 15 | `Attendance` | Attendance / Kehadiran | People | all staff | `/portal/attendance` | rail | More | anchors `#ot-approvals`, `#pending-punches` in use by push |
| 16 | `On Shift` | On Shift / Syif Saya | People | ALWAYS | `/portal/on-shift` | rail | stop 3 | the clock-in destination — offline-critical |
| 17 | `Tasks` | Tasks / Tugasan | People | all staff | `/portal/tasks` | rail | stop 4 | record: `?task=` |
| 18 | `Announcements` | **News** / Berita | People | all staff | **`/portal/news`** | rail | More | the URL matches the word on screen, not the internal id |
| 19 | `Staff Details` | **Staff** / Kakitangan | People | hr_admin, coo, cco, ceo, s_admin, admin | **`/portal/staff`** | rail | More | record: `?staff=` |
| 20 | `Leave` | Leave / Cuti | People | all staff | `/portal/leave` | rail | More | record: `?leave=` |
| 21 | `Claims` | Claims / Tuntutan | People | ceo, coo, cco, hr_admin, sales_mkt, editor, marketing, live_host, s_admin, admin | `/portal/claims` | rail | More | record: `?claim=`; anchor `#claims-pending` |
| 22 | `Payroll` | Payroll / Gaji | People | ceo, coo, s_admin, admin | `/portal/payroll` | rail | More | |
| 23 | `Finance` | Finance / Kewangan | Finance | ceo, coo, s_admin, admin | `/portal/finance` | rail | More | |
| 24 | `Commission` | Commission / Komisen | Finance | s_admin, admin, ceo, coo, cco, hr_admin | `/portal/commission` | rail | More | |
| 25 | `Accounting` | Accounting / Perakaunan | Finance | s_admin, admin, ceo | `/portal/accounting` | rail | More | |
| 26 | `Companies` | Companies / Syarikat | Finance | s_admin, ceo | `/portal/companies` | rail | More | |
| 27 | `Cards` | Cards / Kad | Account | s_admin, ceo, coo, cco | `/portal/cards` | rail | More | |
| 28 | `Profile` | Profile / Profil | Account | ALWAYS | `/portal/profile` | rail | stop 4 on the staff bar | |
| 29 | `Users` | Users / Pengguna | System | s_admin, admin, ceo, coo | `/portal/users` | rail | More | holds the 🔐 access card |

**Parked — no route is emitted:** `Threads`, `Stokis`, `Content`.
A slug for a parked tab would be a URL that resolves to a 404 for everyone
including `super_admin`, which is worse than no URL. Un-parking stays exactly
what it is today: delete one name from `PARKED_TABS` — and, from P1 on, add
its route file, which the parity guard will demand.

---

## 3. Route hierarchy

### 3.1 The rule

**One segment per module. No nesting.** `/portal/<slug>`.

The owner's instruction — *"Do not nest URLs just because modules appear in
the same menu section"* — removes the only argument for nesting that this
product actually has. Checked against real product relationships:

- **Enquiries under Sales?** No. v1.112.0 made Enquiries its own tab because
  customer enquiries are staff work in their own right; `ENQUIRY_ROLES` is
  not `SALES_ROLES` (marketing has Enquiries and not Sales). A URL that
  implies containment would contradict the permission model.
- **Sales Performance under Sales?** No — and this one is on record: *"not a
  sub-tab of Sales and not a page of sub-tabs"*. A `live_host` has Sales
  Performance and **not** Sales; `/portal/sales/performance` would be a path
  whose parent segment that person may not open.
- **Commission / Accounting under Finance?** No. `Finance` is ceo+coo;
  `Commission` includes cco and hr_admin; `Accounting` is ceo-only. Three
  different audiences, one menu heading. Nesting would encode the heading,
  not the product.
- **Payroll under HR?** No. HR is the document and leave-admin desk; Payroll
  is money, gated to four roles. They are neighbours in a menu and nothing
  else.

### 3.2 Slug rules

Lowercase, kebab-case, ASCII, derived once and then **frozen** — a slug is a
public identifier the moment somebody bookmarks it. Two slugs deliberately
do not match their tab id: `Announcements → news` and `Staff Details →
staff`, because those are the words on the screen in EN and a URL a person
reads aloud should match the label they are looking at. `Hankeis → hankeis`
keeps the id (the label carries an apostrophe).

### 3.3 Entry is not Home — `/portal` resolves, `/portal/home` shows

Revision 1 made `/portal` both the Dashboard and the entry resolver. That is
a navigation bug, and the owner found it:

```
  person is at /portal/sales          sessionStorage remembers "Sales"
        │
        ▼  presses Home  ──▶  /portal
                                 │
                                 ▼  entry resolver runs
                          remembered tab = Sales
                                 │
                                 ▼
                           back to /portal/sales     ← Home did nothing
```

The same trap exists with `launch_shift`: a person who deliberately leaves On
Shift and presses Home is put back on On Shift.

So the two jobs are two URLs:

| URL | Job | Consults |
|---|---|---|
| **`/portal`** | entry resolver **only**. Never rendered as a destination, never linked to by the product. | `?tab=`, `sessionStorage`, `launch_shift` |
| **`/portal/home`** | the canonical Dashboard | **nothing** |

Everything that means "take me home" points at `/portal/home`: the rail's
Dashboard item, the phone bar's Home stop, the palette's Dashboard row, the
logo, and `app/portal/error.tsx`'s recovery redirect. `?tab=Dashboard`
resolves to `/portal/home`.

There is no duplicate URL, because `/portal` is no longer a Dashboard
destination. `Dashboard` carries `{ slug: "home", context: "rail" }` like any
other module — it is not a special case in `pathOf()`.

### 3.4 **DECIDE** — the one place nesting is defensible

`ELFIA Store`, `Web Orders` and `ELFIA Traffic` are not merely a menu
heading: they are three views of **one external system**, the client store at
`elfiaofficialstore.my`, and they share a permission tier almost exactly.
Nesting them is the one proposal here that is about the product and not
about the menu:

```
A (recommended)              B (nested)
/portal/elfia-store          /portal/elfia/store
/portal/web-orders           /portal/elfia/orders
/portal/elfia-traffic        /portal/elfia/traffic
```

I recommend **A**, for one reason: the ELFIA bridge work is coming, the shape
of that workspace is not settled, and a nested URL is the expensive kind to
change later. Flat costs nothing now and can become nested in P2 with three
redirects if the bridge work proves the grouping. **Say which you want.**

---

## 4. `/portal` — the entry resolver

```
   /portal/<slug>  ─────────────────────────────────────────────────┐
   (any canonical URL, including /portal/home)                      │
        the URL wins outright: render that module, clamp by         │
        canSeeTab, consult NOTHING else                             │
                                                                    ▼
   /portal  ───▶ ┌──────────────────────────────────────────┐   render
                 │ 1. ?tab=<name> present and RESOLVABLE?    │──▶ replace → /portal/<slug>
                 │ 2. sessionStorage azone-tab:{id} valid    │──▶ replace → /portal/<slug>
                 │    AND still permitted right now?         │
                 │ 3. today_shift.entry.launch_shift?        │──▶ replace → /portal/on-shift
                 │ 4. otherwise                              │──▶ replace → /portal/home
                 └──────────────────────────────────────────┘
                 while resolving, the page renders PortalSkeleton —
                 it is a doorway, not a screen
```

**The order is today's order, unchanged.** `?tab=` already beats the
remembered tab, and the remembered tab already beats the `launch_shift`
fetch (`page.tsx:203–239`). Reordering it would change who lands where on a
shift morning, which is a product change wearing a routing costume. The only
change is step 4's destination: it `replace`s to `/portal/home` instead of
rendering in place.

Three properties this gives us that the current page does not have:

- **The URL is the source of truth.** Every branch ends in
  `router.replace(...)`, so the address bar names the module before the
  person has done anything. `sessionStorage` never decides what is *rendered*;
  it only decides where a bare `/portal` *goes*.
- **`replace`, never `push`.** Landing on `/portal` and being sent to
  `/portal/on-shift` must not leave a Back step that bounces you forward
  again. After the redirect, `/portal` is not in the history at all.
- **Home is honest.** `/portal/home` is a destination with no logic behind
  it, so pressing Home from anywhere lands on the Dashboard — every time,
  for every role, in every session state.

`resolveEntry()` is a pure function of four inputs (`legacyTab`,
`remembered`, `launchShift`, `permitted`) and is tested as one. It never
reads storage itself; the page reads storage and hands it in.

---

## 5. `sessionStorage` — demoted to a hint

Keep the key exactly as it is: `azone-tab:{userId}`, session-scoped, written
on every module change. The owner's v1.24.0 rule — *refresh keeps the tab,
closing the browser goes back to Dashboard* — is preserved because
`sessionStorage` is still the thing with those semantics.

What changes is its authority. Precedence, highest first:

1. **An explicit canonical path.** `/portal/leave` renders Leave. Always.
   **`/portal/home` is one of these** — Home consults nothing, which is the
   whole point of Correction 1.
2. **A legacy `?tab=` on `/portal`.** §6.
3. **The remembered route**, only on a bare `/portal`, and only after
   `canSeeTab` says it is still permitted **now**.
4. **`launch_shift`**, only on a bare `/portal`.
5. **`/portal/home`.**

**Discarding safely.** If the stored value names a tab that is parked,
retired, unknown, or no longer permitted for this person, the entry is
**deleted** and the resolver falls through. It is never rewritten to
Dashboard and then stored — that would silently overwrite a perfectly good
memory because of one revoked permission.

It stores the **tab id**, not the slug, so an old entry written by v1.179.0
still resolves after the upgrade and a future slug change does not strand it.

---

## 6. `?tab=` compatibility resolver

This is the piece that decides whether an existing bookmark, an email link or
a push notification still lands. It lives in one function, is used by the
`/portal` page and by nothing else, and is guarded.

```ts
// lib/portal-routes.ts
export type LegacyResolution =
  | { kind: "route"; tab: TabName; href: string }   // replace the address with this
  | { kind: "home";  href: "/portal/home" }         // Dashboard, silently
;

export function resolveLegacyTab(
  raw: string | null,
  permitted: readonly TabName[],
): LegacyResolution
```

| Input | Example | Resolution | Why |
|---|---|---|---|
| valid + authorized | `?tab=Leave`, staff | `route /portal/leave` | the link does what it says |
| **`?tab=Dashboard`** | a v1.105.0 push payload | `route /portal/home` | Dashboard is an ordinary module with an ordinary slug |
| valid + **un**authorized | `?tab=Payroll`, live_host | `home` | identical to today's clamp; the worker 403s the data regardless |
| **parked** | `?tab=Threads` | `home` | parked sits above the `super_admin` bypass and must keep sitting above a URL |
| **retired** | `?tab=Purchasing` | `home` | not in `ALL_TABS`; indistinguishable from a typo, and should be |
| unknown / junk | `?tab=<script>` | `home` | never interpolated into a path; the slug comes from the registry, never from the URL |
| absent | `/portal` | fall through to §4 | |

Three properties that are not negotiable:

- **The resolver takes the already-permission-filtered list.** It cannot be
  called in a way that bypasses `canSeeTab`, because it has no access to the
  unfiltered registry.
- **It is not authorization.** Every module still renders under the same
  render-time clamp (`activeTab`) and every byte still comes from an endpoint
  the worker gates. Routing decides *what is drawn*. §23.
- **The query parameter is removed on resolution**, exactly as v1.105.0 does
  today, so a reload does not drag the person back.

`app/portal/error.tsx` currently does
`window.location.replace("/portal?tab=Dashboard")` — it becomes
**`/portal/home`**. A crash-recovery redirect must land somewhere
unconditional; sending it through the resolver could put the person back on
the module that just crashed.

---

## 7. Browser history

### 7.1 What becomes real

```
  Dashboard ──▶ Sales ──▶ Hotels ──▶ (hotel 88) ──▶ Tasks
  /portal/     /portal/   /portal/   /portal/        /portal/
  home         sales      hotels     hotels?hotel=88 tasks

  Back ×4 walks that line backwards. Forward walks it again.
  Refresh at any point re-renders that exact screen.
```

Every navigation is `next/link` or `router.push`. **No `history.pushState`
anywhere in the shell**, and no state machine imitating a stack.

### 7.2 push vs replace

| Action | Call | Reason |
|---|---|---|
| choosing a module (rail, bar, More, palette) | `push` | it is a place you can come back from |
| opening a record | `push` | Back closes the record — which is what Back means on a phone |
| a filter, a range, a sub-view inside a module | `replace` | ten Backs to leave one screen is a trap |
| `/portal` → resolved landing | `replace` | §4 |
| `?tab=` → canonical | `replace` | the legacy URL must not be a history step |

### 7.3 The `RecordDetail` conflict — must be fixed in the same step

`components/ui/record-detail.tsx` pushes its own history entry and closes on
`popstate`. That was the right answer when there were no routes. Once a
record's identity is in the query string, a record opened through a route
would create **two** entries — the router's and the dialog's — and one Back
would close the dialog while leaving `?hotel=88` in the address.

The fix is not to delete the mechanism: `RecordDetail` is also used for
records that are **not** routed (P2 will route more of them, not all). It
takes a new prop, `history: "own" | "route"`, defaulting to `"own"` so every
current caller is untouched. The seven routed record views pass `"route"`,
and the dialog then skips its `pushState`/`popstate` entirely and is closed
by the URL changing. This is P1.4 and it lands with the record URLs, not
before them.

---

## 8. Static export — what works, what does not

| Thing | Under `output: export` | Verdict |
|---|---|---|
| `/portal/sales` (static segment) | emits `out/portal/sales.html` | ✅ works |
| 29 such routes | 29 HTML documents, ~33 KB raw / ~6 KB gzip each | ✅ works |
| per-route `<title>` in the HTML | `export const metadata` in a server `page.tsx` | ✅ **a real gain** — today every portal page is `Staff Portal` |
| client-side navigation between them | Next app-router, no reload | ✅ works |
| `/portal/quotations/[id]` | needs `generateStaticParams` over D1 ids | ❌ **impossible without changing hosting** |
| catch-all `[...slug]` for records | same problem, plus every unknown path 404s | ❌ |
| middleware / rewrites | not available in a static export | ❌ |
| Cloudflare `_redirects` SPA fallback | would work, but it changes the deployment contract and defeats the service worker's per-document cache | ❌ **not proposed** |

**Conclusion: record identity goes in the query string, on a static route.**
`/portal/hotels?hotel=88` is canonical, bookmarkable, refreshable,
shareable, back-button-correct and precacheable. `/portal/hotels/88` is
none of those things in this deployment. This is a constraint of the
architecture the owner chose, not a compromise in the routing design, and
the repository already uses exactly this shape for its public document
viewer (`/doc?t=…`, `/report?t=…`).

---

## 9. Record routes

### 9.1 READY NOW (P1.4) — seven

Each one has a stable id, a GET endpoint that retrieves it, backend
authorization already enforced, and a real reason to link to it directly.

| Module | URL | Endpoint that already exists | Who links to it |
|---|---|---|---|
| Hankei's order | `/portal/hankeis?order=1043` | `GET /staff/hankeis/orders/{id}` | the verification queue, the Desk |
| Hotel | `/portal/hotels?hotel=88` | `GET /staff/hotels/{id}/pipeline` | the palette, a call note |
| Task | `/portal/tasks?task=12` | `GET /staff/tasks/{id}` | push `kind: task`, the Desk |
| Enquiry | `/portal/enquiries?enquiry=57` | `GET /enquiries/{id}` | push `kind: enquiry` |
| Leave request | `/portal/leave?leave=203` | `GET /staff/leave/{id}` | push `kind: leave`, the Desk |
| Claim | `/portal/claims?claim=99` | `GET /staff/claims/{id}` | push `kind: claim`, the Desk |
| Staff record | `/portal/staff?staff=9002` | `GET /staff/users/{id}` | the palette, the org chart |

### 9.2 DEFER to P2 — and why each one

| Module | Missing |
|---|---|
| **Sales document** (`QT-10342`) | **no staff GET-by-id exists.** The worker has `/erp/documents` list routes and the public `/doc?t=<share_token>` viewer; there is no `GET /staff/erp/documents/{id}`. Writing one is a new API, which P1 is told not to do. This is the record the owner named in the brief, and it is the one that is not ready. |
| Payroll run | the panel is a month view, not a record; no stable per-run id |
| Roster session | `live-sessions/{id}` exists, but the board is a week grid — a URL would open a grid, not a record |
| Inventory item | `sku` is stable but the panel has no record view to open |
| Web order | id exists; the list has no drill-down worth linking to yet |
| Asset | id exists; same |
| Event | `/events/{id}` exists; the calendar is the product, not the record |
| Commission rule / accounting entry | administrative rows; direct linking has no audience |

**DECIDE:** the Sales document URL the brief asked for
(`/portal/quotations/QT-10342`) needs one new read endpoint. That is a
P2 item unless you want it pulled forward as an explicit exception.

---

## 10. Desktop navigation

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌──────────────────────────────────────────────────────────┐│
│ │  A2Z     │ │ Sales                            ⌘K  🔍   🔔3  ☾  EN  AF ││ TopBar 56px
│ │ ──────── │ ├──────────────────────────────────────────────────────────┤│
│ │ OVERVIEW │ │ SALES                                                    ││
│ │ ▸ Dash   │ │ Sales                             [ New quotation ]  ⋯   ││ PageHeader
│ │ ▸ Desk   │ ├──────────────────────────────────────────────────────────┤│
│ │ SALES    │ │                                                          ││
│ │ ▸ Ecomm  │ │   module content — the panel, unchanged                  ││
│ │ ▪ Sales  │ │                                                          ││ #shell-scroll
│ │ ▸ Enq  2 │ │                                                          ││
│ │ ▸ Perf   │ │                                                          ││
│ │ ▸ Hank   │ │                                                          ││
│ │ OPERATI… │ │                                                          ││
│ │ …        │ │                                                          ││
│ │ ──────── │ │                                                          ││
│ │ Alif · CEO│ │                                                         ││
│ │ ⎋ Sign out│ └──────────────────────────────────────────────────────────┘│
│ └──────────┘                                                              │
└──────────────────────────────────────────────────────────────────────────┘
   SideNav 248px / 56px collapsed
```

**It is the rail that exists, with `href` instead of `onClick`.**
`components/layout/side-nav.tsx` already has the section grouping, the
collapse with its remembered `NAV_COLLAPSED_KEY`, the hover/focus tooltips
for the collapsed state, and roving Up/Down keyboard focus across section
boundaries. None of that is rebuilt. Three changes:

1. `onSelect(name)` → `<Link href={pathOf(name)}>` on each item, so the
   Overview section's Dashboard item points at **`/portal/home`** and never
   at the resolver. The active state stops being a prop and becomes
   `usePathname() === href`, which is what makes a refresh and a Back keep
   the highlight correct. The logo is the same link.
2. `SECTIONS` keeps its titles but its `tabs` arrays are **validated against
   `ALL_TABS` by the parity guard** as they are today — no second list.
3. An optional numeric badge per item, fed from the same counts the Desk
   already computes. **Not in P1.1–P1.3**: a badge that is wrong is worse
   than no badge, and the count source is a Desk concern.

**TopBar** keeps what it has (search field, ⌘K, bell + notification centre,
theme, language, identity, sign out) and gains one thing: the **route name**,
so the bar says where you are even while a lazy chunk is still arriving.

**No second menu system.** The rail, the bottom bar, the More sheet and the
palette all read `ALL_TABS` → `canSeeTab` → `TAB_ROUTE`. §20.

**Settings** is not a new destination. It is `Profile` and `Users` (which
holds the 🔐 access card) — inventing a Settings page in P1 would be a
module, and P1 does not add modules.

---

## 11. Large-desktop workspace

The P0.2 tiers, now used for the first time. Nothing in the codebase responds
to width above 1024px today, so a 1440px window and a 2560px monitor render
identically.

| Tier | Width | The shell becomes |
|---|---|---|
| `lg` | 1024–1279 | rail expanded with labels, real tables, module toolbars, single workspace column |
| `xl` | 1280–1599 | **context panel** may appear (opt-in per route), master-detail replaces the covering drawer, content takes a `--measure-*` |
| `xxl` | 1600–1919 | same shape, wider gutters, `--measure-full` for roster and payroll |
| — | ≥1920 | **still the `xxl` shape.** The workspace is capped by its measure and the extra width becomes gutter. A payroll table spanning 2560px is not a feature |

**Three columns are opt-in, per route, and most routes decline.**

```
route declares            xl layout
────────────────────────  ─────────────────────────────────────────
context: none  (default)  [ rail ][ workspace (measure-wide)       ]
context: "detail"         [ rail ][ workspace ][ detail 380px      ]   Hotels, Staff, Hankei's
context: "rail"           [ rail ][ workspace ][ right rail 292px  ]   Dashboard only
```

- **`detail`** is for a module whose record view is currently a drawer that
  covers the list. On a 1280px screen a covering drawer is a waste of a
  monitor; side-by-side is the whole point of the tier. The seven routed
  records in §9.1 are exactly the candidates.
- **`rail`** is the Dashboard's existing `RightRail`/`ContextPanel`
  (`components/portal/side-columns.tsx`), which the `AppShell` already
  supports and which today only the Dashboard passes.
- **Everything else gets one column with a measure.** Payroll, Accounting,
  Finance and the ELFIA panels are dense grids; a third column would take
  width from the thing the page exists for.
- **Sticky module actions** (`PageHeader`'s primary action pinned while the
  list scrolls) apply at `lg` and up, where there is vertical room for a
  sticky bar that is not eating a phone's screen.

---

## 12. Mobile / PWA navigation

### 12.1 The bar stays exactly as it is

`mobileNavStops()` already does everything the brief asks for: four stops
plus More, permission-filtered by the caller, pinned modules first, role
defaults second, back-filled so the bar is never short, and — the important
part — **it reads no counts**, so a stop cannot move because four claims
arrived overnight. It is muscle memory and it is correct.

| Stop | Destination | Permission | Badge | If the person cannot access it |
|---|---|---|---|---|
| 1 Home | **`/portal/home`** | ALWAYS | none | cannot happen |
| 2 Desk *(managers)* | `/portal/desk` | ALWAYS | none | cannot happen |
| 2 Sales *(sales-led)* | `/portal/sales` | `SALES_ROLES` | none | the slot is skipped; the bar back-fills |
| 3 On Shift | `/portal/on-shift` | ALWAYS | none | cannot happen |
| 4 Tasks | `/portal/tasks` | all staff | none | back-fill |
| 4 Profile *(staff bar)* | `/portal/profile` | ALWAYS | none | cannot happen |
| — More | opens the sheet | always rendered | **bell count only, on More** | — |
| *pins* | the person's up-to-6 pinned modules | already clamped to `tabs` | none | a revoked pin is dropped by the existing filter |

Each stop becomes a `<Link>`. The one stop that is **not** a route is the
manager's Desk anchor variant (`MobileStop.anchor`) — and it no longer needs
to be, because Desk has been a real page since v1.176.0. `anchor` stays in
the type for any future in-page stop, unused.

### 12.2 No desktop sidebar on mobile, ever

The rail is `md`-and-up only today and stays that way. The `AppShell`
renders the rail and the bottom bar from the same permitted list but never
both.

### 12.3 **DECIDE** — the "Create" stop

The brief floats `Home · Sales · Create · Tasks · More`. I recommend **not
in P1**, for two reasons:

1. **It costs a stop.** Five stops plus More is six targets on a 375px
   screen; four plus More is the layout that passes the 44px floor today. A
   Create stop displaces `On Shift` or `Tasks` — one of which is how people
   clock in.
2. **There is nothing behind it yet.** A permission-aware quick-create needs
   a create flow per module (quotation, task, leave, claim, Hankei's order),
   and those flows live inside the modules P2 modernises. A Create button
   that opens a menu of five links is a worse More sheet.

The routing work makes it *easy* later: a create action is a route with a
query (`/portal/sales?new=quotation`). **Say if you want it in P1 anyway.**

---

## 13. More — architecture

```
┌─────────────────────────────────────┐
│  ═══                            ✕   │
│                                     │
│  Search modules…            ⌘K  ▸   │  ← opens the palette; not a second search
│                                     │
│  PINNED — 3/6                       │
│  [Sales] [Leave] [Hotels]           │  pin/unpin in place (v1.175.0, unchanged)
│                                     │
│  SALES                              │
│  [Ecommerce] [Enquiries] [Perf]     │
│  [Hankei's]                         │
│                                     │
│  OPERATIONS                         │
│  [Inventory] [Assets] [Hotels]      │
│  …                                  │
│                                     │
│  ACCOUNT                            │
│  [Cards] [Profile]                  │
│                                     │
│  PREFERENCES                        │
│  sound · push · language · theme    │
└─────────────────────────────────────┘
```

- **Sections come from `SECTIONS`**, the same cut the desktop rail uses, so
  the two surfaces group identically. This is already how the sheet works
  (`mobileGroups` in `page.tsx:833`); P1 moves it into its own component and
  changes nothing about it.
- **Ordering inside a section is `ALL_TABS` order** — the owner's own
  sequence — never alphabetical and never by frequency. A menu that
  re-sorts itself is a menu you cannot learn.
- **Pinned leads**, and pinned modules leave the grouped lists below, which
  is where they are unpinned. Already true; keep.
- **Search is the palette.** One row at the top that opens ⌘K rather than a
  second filter with its own behaviour. The palette already has recents,
  icons, grouping and the permission-scoped server search.
- **Account and Preferences stay at the bottom.** Preferences renders
  unconditionally because a role trimmed to four tabs would otherwise lose
  sound, push, language and theme entirely — that is a v1.10.0 fix and it
  must survive the rewrite.
- **It scales because it is grouped and ordered, not because it is short.**
  29 modules in eight labelled sections is a list; 29 icons in a grid is the
  icon wall the brief wants to leave.

---

## 14. Tablet

Two tiers, two different intentions.

**768–1023 (`md`) — a small desktop, not a big phone.**
- Side rail **collapsed to icons** by default (the remembered
  `NAV_COLLAPSED_KEY` still wins if the person expanded it), with the
  existing hover/focus name tooltips so it is not a memory test.
- Bottom bar **off**; More sheet **off**. The rail reaches everything.
- Records open in a **right drawer**, not a bottom sheet.
- Tables stay **record cards** — 768px is not enough for the roster or a
  payroll row, and shredding a column is the failure this repo has a probe
  for.
- One workspace column, `--measure-standard`.

**1024–1279 (`lg`) — a desktop that has not earned a third column.**
- Rail **expanded with labels**.
- **Real tables**, module toolbars, three-up zones.
- Records still in a drawer — the context panel starts at `xl`.
- Workspace `--measure-wide`.

The transition is a change of shape at exactly one width (768) and a change
of density at exactly one more (1024), which is what makes it explainable.

---

## 15. `app/portal/layout.tsx` — what moves in

### 15.1 The tree

```
app/portal/layout.tsx                        "use client"
└── <PortalProvider>                          ← the one context; see 15.2
     ├── auth (/auth/me), cache + outbox scope
     ├── tab overrides + per-person access  → permitted: TabName[]
     ├── lang, theme, dark, sound, push
     ├── notifications + SSE/version stream
     └── <AppShell context={route.context}>
          ├── <SideNav/>            md+   SECTIONS × permitted → <Link>
          ├── <TopBar/>             search · ⌘K · bell · theme · lang · identity
          ├── <main id="shell-scroll">
          │     └── {children}      ← the route's page.tsx
          ├── <ContextPanel/>       xl, opt-in
          ├── <RightRail/>          xl, Dashboard only
          ├── <BottomNav/>          <md   mobileNavStops → <Link>
          ├── <MoreSheet/>          <md
          ├── <NotificationCenter/>
          ├── <CommandPalette/>     tabs → routes
          ├── <OfflineBanner/> <InstallCoach/> <SaveToast/>
          └── <PortalSkeleton/>     while /auth/me is in flight
```

```
app/portal/sales/page.tsx                    server component, 8 lines
  export const metadata = { title: "Sales" }
  export default () => <SalesRoute/>

app/portal/sales/sales-route.tsx             client, 6 lines
  "use client"
  export function SalesRoute() {
    return <><PageHeader …/><Sales …/></>
  }
```

The server/client pair exists for one reason: `metadata` cannot be exported
from a client component, and `next/dynamic` with `ssr: false` cannot be used
in a server component. Two tiny files buy a real `<title>` in the static
HTML for all 29 routes. §17.

### 15.2 One context, not a prop drill

`page.tsx` currently computes `user`, `tabs`, `canOpen`, `favourites`,
`lang`, `dark`, `notifs` and passes them down through the switch. A route
page cannot receive props from a layout, so those become **one** context
(`PortalProvider`) exposing exactly what modules already receive:

```ts
interface PortalContext {
  user: User;
  permitted: readonly TabName[];   // canSeeTab applied
  canOpen(tab: string): boolean;   // v1.159.9 — unchanged semantics
  lang: Lang;
  go(tab: TabName, query?: Record<string,string>): void;  // router.push wrapper
}
```

`go()` replaces the `go={(t) => setTab(t)}` prop that `DeskPage`,
`SalesPerformancePanel` and the dashboard cards already take — **same
signature**, so those call sites do not change; only what the function does
underneath.

### 15.3 The service worker — the hidden blocker

Today: `SHELL_URLS = ["/portal", "/account", "/login", …]`, and an offline
navigation to anything else returns `Response.error()`. **`/portal/sales`
offline would be a browser error page**, in a PWA whose entire point is that
a clock-in works in a lift.

Proposed, in P1.2, in the same release as the routes:

1. `SHELL` cache key bumped (`v34` → `v35`) — every installed shell must
   pick up the new handler, and the existing `activate` eviction already
   deletes the old key.
2. `shellPage` widens from a list membership test to
   `url.pathname === "/portal" || url.pathname.startsWith("/portal/")`, so
   **every portal route document is cached on its first successful visit**
   (network-first, exactly as now — no new caching policy).
3. Four documents join `SHELL_URLS` at install because they are the
   offline-critical destinations: **`/portal/home`**, `/portal/on-shift`,
   `/portal/tasks`, `/portal/desk`. ~24 KB gzipped for all four.
   **`/portal` itself is NOT one of them** — see the next point.
4. Offline navigation fallback: the exact cached path → else the cached
   **`/portal/home`** document.

   **This is Correction 1 reaching the service worker, and it matters.** The
   obvious fallback is `/portal`, and it is the wrong one: `/portal` is a
   resolver, so serving it offline would run the resolver, which would read
   `sessionStorage`, decide on `/portal/sales`, and navigate to a document
   that is very likely not in the cache — turning one offline miss into a
   second one, on a screen the person did not ask for. `/portal/home`
   consults nothing and renders. A cached resolver is a loaded gun.
5. **To be verified against the build, not assumed:** Next 16 emits RSC
   payload files (`out/portal/__next.*.txt`) that the client router fetches
   on a route change. Whether an offline client-side navigation needs those
   cached too is a question the build output answers, and P1.2 answers it by
   looking — not by reasoning about it.

---

## 16. `PageHeader`

```
┌────────────────────────────────────────────────────────────────┐
│ SALES                                            ← erp-type-label
│ Sales                             [ New quotation ]   ⋯        │
│ 28 open quotations · RM 48,620 this month        ← erp-type-caption
└────────────────────────────────────────────────────────────────┘
      ↑ erp-type-page                ↑ .erp-button  ↑ .erp-icon-button
```

```ts
interface PageHeaderProps {
  /** the destination's own name. Defaults to the registry label. */
  title?: string;
  /** the section, from SECTIONS. "SALES". Omitted on Dashboard. */
  eyebrow?: string;
  /** one line of context: a count, a total, a period. Never a sentence. */
  subtitle?: ReactNode;
  /** only when a record is open: [{label, href}] back to the list */
  breadcrumb?: { label: string; href?: string }[];
  /** at most ONE. Gold. If a page has three primaries it has none. */
  primary?: { label: string; onClick?: () => void; href?: string; icon?: string };
  /** the rest, quiet */
  actions?: { label: string; onClick: () => void; icon?: string }[];
}
```

- **Tokens only.** `--type-page`, `--type-label`, `--type-caption`,
  `--space-*`, `.erp-button` / `.erp-icon-button`. No new shape, no new
  class family, no utility.
- **The header must name the destination.** This is the owner's rule from
  v1.176.0 — *"The page header must match the selected destination. Desk must
  say Desk."* It is now structural rather than a convention: the title comes
  from the registry entry the route resolved to.
- **Breadcrumb only for records.** `Hotels / Grand Hyatt Kuala Lumpur`. A
  two-level product does not need a breadcrumb for its top level, and a
  breadcrumb that always reads `Portal / Sales` is decoration.
- **It does not touch module headings.** Every panel keeps its internal
  `TabPage` / `TabZone` / card titles. Those are P2's.

---

## 17. Browser titles

Today every portal screen is `Staff Portal — A2Z CREATIVE MARKETING`, because
there is one route. With 29 routes, each `page.tsx` exports static metadata
and the root template does the rest:

```
/portal/home              Dashboard — A2Z CREATIVE MARKETING
/portal/sales             Sales — A2Z CREATIVE MARKETING
/portal/hankeis           Hankei's — A2Z CREATIVE MARKETING
/portal/payroll           Payroll — A2Z CREATIVE MARKETING

/portal                   Staff Portal — A2Z CREATIVE MARKETING
                          ↑ the resolver. It is on screen for one frame and
                            is never a place, so it keeps the generic title
                            rather than claiming to be a module.
```

- **English in the static metadata**, because it is baked into the HTML at
  build time and the language switch is a client preference. The BM speaker
  gets the BM title via a three-line `useDocumentTitle` in the shell that
  re-sets `document.title` from the registry label when `lang === "ms"`.
  That is a chrome string, not content.
- **Record titles only where the record is already loaded** —
  `Grand Hyatt Kuala Lumpur — Hotels — A2Z…` set client-side once the panel
  has the record in hand. Never fetched to produce a title, and never
  guessed from the id.
- **No figures in a title.** A tab that reads `RM 48,620` is a number on a
  taskbar in an open-plan office.

---

## 18. Command palette

**Kept. Not replaced.** `components/layout/command-palette.tsx` already has
recents (device-local, re-filtered against current permissions), icons,
grouping, a real listbox for screen readers, keyboard hints, and the
v1.107.0 server search over eight tables where **each source is gated by the
permission its own tab is gated by**. That is the hard part and it is done.

Three changes, all small:

1. `onTab(name)` becomes a navigation to `pathOf(name)` — so the palette's
   Dashboard row is **`/portal/home`**, like every other destination. Rows
   become links,
   so ⌘-click and middle-click open a module in a new browser tab — which is
   a genuine new capability for a person comparing two modules on a monitor.
2. Server hits already carry a `tab` field (`interface Hit { …; tab: string }`).
   A hit whose module is in §9.1 navigates to the **record URL**
   (`/portal/hotels?hotel=88`); every other hit navigates to its module, as
   today. This is the whole "search results navigate to canonical URLs"
   requirement, and it is about six lines.
3. Grouping and permission scoping already exist. **No search rewrite.**

---

## 19. Push and deep links

Today the worker builds the URL:
`worker/src/staff.ts:1574` → `/portal?tab=<TabName>` (or `/portal`), from
`PUSH_TAB`, and `public/sw.js` navigates an open window to it.

```
   PHASE 1 (P1.2)            PHASE 2 (a later, separate release)
   ───────────────           ──────────────────────────────────
   worker still emits        worker emits /portal/<slug> directly
   /portal?tab=Leave         from the same PUSH_TAB map
          │                            │
          ▼                            ▼
   resolver §6 replaces      lands directly
   → /portal/leave
```

- **P1 changes the worker not at all.** Every push already in flight, every
  notification sitting on a lock screen, and every `?tab=` link in an email
  keeps working through the resolver. The compatibility layer is the
  resolver; there is no second mechanism.
- **Phase 2 is one line in the worker** plus a slug map that must agree with
  `lib/portal-tabs.ts`. Because the worker is a separate deployable, that
  map gets the same treatment `TAB_ACCESS_TABS` gets today:
  `tests/registry-parity.mjs` holds it to the portal's registry.
- **Anchors survive.** `NOTIF_WHERE` in `page.tsx` routes an in-app
  notification to a tab *and an element id*
  (`ot-approvals`, `pending-punches`, `claims-pending`). Those become real
  URL fragments: `/portal/attendance#ot-approvals`. A fragment is free in a
  static export and it is what fragments are for.
- **Nothing is migrated in one uncontrolled change.** Phase 2 only happens
  after the routes have been live through at least one release.

---

## 20. Single source of truth

```
                     lib/portal-tabs.ts
                    ┌───────────────────┐
                    │ ALL_TABS          │
                    │ TAB_ROLES         │
                    │ ALWAYS_VISIBLE    │
                    │ PARKED_TABS       │
                    │ canSeeTab()       │
                    │ accessOf()        │
                    │ mobileNavStops()  │
                    │ ── new in P1 ──   │
                    │ TAB_ROUTE         │
                    │ pathOf()          │
                    │ tabOfPath()       │
                    └─────────┬─────────┘
          ┌───────────┬───────┼────────┬───────────┬──────────────┐
          ▼           ▼       ▼        ▼           ▼              ▼
     route files   SideNav  BottomNav  More    CommandPalette  🔐 access card
     (generated-   (SECTIONS          (SECTIONS  (tabs+hits)    (accessOf)
      shaped,       cut)               cut)
      guarded)
```

The registry extension, in full:

```ts
/** P1 — the URL half of the registry. A tab without an entry has no route,
    which is how a PARKED tab stays unreachable by address as well as by
    menu. Dashboard is NOT a special case: its slug is "home", and /portal
    is not a destination at all. */
export interface TabRoute {
  slug: string;
  /** the query key that addresses one record inside this module, if any */
  record?: string;
  /** which xl layout this destination asks for */
  context?: "none" | "detail" | "rail";
}

export const TAB_ROUTE: Partial<Record<TabName, TabRoute>> = {
  Dashboard: { slug: "home", context: "rail" },
  Desk:      { slug: "desk" },
  Sales:     { slug: "sales" },
  Hotels:    { slug: "hotels", record: "hotel", context: "detail" },
  Announcements: { slug: "news" },
  "Staff Details": { slug: "staff", record: "staff", context: "detail" },
  // …29 entries, three parked tabs deliberately absent
};

// lib/portal-routes.ts — policy over that data, no special cases
export const pathOf = (tab: TabName): string | null => { … }   // "/portal/home"
export const tabOfPath = (pathname: string): TabName | null => { … }
```

**New guard assertions** (`tests/registry-parity.mjs`, which already refuses
a drifting registry):

1. every non-parked tab in `ALL_TABS` has a `TAB_ROUTE` entry, and every
   parked tab has none;
2. slugs are unique among themselves, lowercase kebab, `^[a-z][a-z0-9-]*$`,
   and name nothing Next reserves inside a segment (`_next`, `api`). They sit
   under `/portal/`, so they cannot collide with a top-level route or a
   printed business-card slug — and `tests/business-cards.mjs` already
   reserves `news`, `cards`, `store`, `search`, `home` and `people` at the
   top level, which is what makes those safe to use here;
3. `app/portal/<slug>/page.tsx` exists for every entry, **and there is no
   route directory without a registry entry** — the half that catches a
   forgotten deletion;
4. `SECTIONS` still reads out as `ALL_TABS` in order (existing assertion);
5. the worker's `PUSH_TAB` names only tabs that exist (new; needed before
   push phase 2).

---

## 21. Code splitting — measured, not claimed

### 21.1 Today, from `out/` (`v1.179.0` build)

```
/portal first load      17 chunks   1,440 KB raw   434 KB gzipped
all emitted chunks      72 chunks   4,076 KB raw
```

`components/portal/lazy-panels.tsx` already defers 32 panels. What it cannot
defer is what `app/portal/page.tsx` imports **statically**, because those
modules are part of the one route's entry graph:

| statically imported by page.tsx | source |
|---|---|
| `sales.tsx` | 160 KB |
| `dashboard.tsx` | 108 KB |
| `leave.tsx` | 80 KB |
| `trading-desk.tsx` | 48 KB |
| `commission.tsx` | 32 KB |
| `users-panel.tsx` | 28 KB |
| `live-cards.tsx` | 28 KB |
| `tiktok-cards.tsx` | 24 KB |
| `tasks.tsx` | 24 KB |
| `attendance.tsx` | 24 KB |
| `one-desk.tsx`, `side-columns.tsx`, `ops-map.tsx`, `dashboard-cards.tsx`, `company-monitor.tsx`, `announcements.tsx`, `profile.tsx`, `desk-page.tsx` | 96 KB |
| **`app/portal/page.tsx` itself** | 92 KB |

**≈ 396 KB of source for modules that are not the Dashboard is downloaded by
every person on first paint, whichever tab they open.** A live host who
clocks in and closes the app has paid for Sales, Leave, Commission, the
users panel and the TikTok cards.

### 21.2 After P1

Each route is its own entry, so `sales.tsx`, `leave.tsx`, `tasks.tsx`,
`attendance.tsx`, `announcements.tsx`, `profile.tsx`, `commission.tsx` and
`users-panel.tsx` become route chunks. The Dashboard route keeps
`dashboard.tsx`, `dashboard-cards`, `side-columns`, `ops-map`,
`company-monitor`, `one-desk` and `trading-desk` — deliberately, because
deferring the first screen adds a round trip to the moment that matters most.

**Honest estimate: the `/portal` first load drops from ~434 KB gzipped to
roughly 300–330 KB.** That is an estimate, not a measurement, and the
implementation report will carry the measured number from `out/` — the same
way this section carries today's.

### 21.3 `role-panels.tsx` — proven, and not fixable in P1

`lazy-panels.tsx` exports six lazy components from one module:
`AttendanceAdminPanel`, `HrPanel`, `InventoryPanel`, `ClaimsPanel`,
`ExpensesPanel`, `TikTokOrdersCard`. Six `dynamic()` calls into one file is
**one chunk**, and the build output says so:

```
$ grep -l "Quantity to move for" out/_next/static/chunks/*.js
  out/_next/static/chunks/1403f5xb8mnk2.js      236 KB

$ in that same chunk:  "claims-pending" ✓   "Stock in" ✓   "Expenses" ✓
```

Opening **Inventory** downloads Claims, Expenses, the HR panel and the
attendance admin panel. Routes do not change this: five route entry points
will resolve to the same 236 KB chunk. **Splitting `role-panels.tsx` (401 KB
of source) into its own modules is the single largest remaining bundle win
and it is P2.2**, where it belongs — it is module decomposition, not routing.

The same is true, less dramatically, of `payroll-panel.tsx` (123 KB, two
lazy exports: `PayrollPanel` and `MyPayslip`).

---

## 22. `/admin` and `/account` — **DECIDE**

These are not two more portal surfaces. They are two different products.

| | `/admin` | `/account` |
|---|---|---|
| audience | **staff** (super_admin, admin + some) | **customers** |
| navigation source | its own hard-coded `TABS` array (`page.tsx:967`) | three customer sections |
| shell today | `AppShell` + legacy `SidebarNav` icon rail | `AppShell` + legacy `SidebarNav` icon rail |
| relation to `ALL_TABS` | none — Users, Staff, Audit, Site, Signatures | none |

**Recommendation:**

- **`/admin` — a shell variant, in P1.8, last.** It is a staff surface and it
  should look like the staff product. It moves onto the extracted `AppShell`
  and `PageHeader`, but keeps **its own navigation source**: merging its tab
  list into `ALL_TABS` would put Audit and Signatures into the portal's
  permission registry, which is a permission change dressed as a refactor.
  Its routes (`/admin/users`, `/admin/audit`, …) are a natural follow-on and
  are **not** proposed for P1 — one routing migration at a time.
- **`/account` — leave it alone in P1.** It is the **customer** portal. Giving
  it the staff shell would give a customer the staff product's chrome, and
  the only thing it currently shares is a component neither surface should
  keep. Revisit in P3 with its own brief.
- **`components/layout/sidebar-nav.tsx`** (the legacy icon rail, 69 lines)
  stays until both are moved. It is used only by these two pages. Retiring it
  is the last step of P1.8, not the first.

No business logic in either surface is touched.

---

## 23. Permissions — what P1 does and does not do

```
   URL  ──▶ tabOfPath() ──▶ canSeeTab(role, tab, overrides, person)
                                   │
                            false ─┴─▶ replace → /portal/home   (silently, as today)
                                   │
                             true ─┴─▶ render the module
                                            │
                                            ▼
                                   every byte still comes from
                                   the worker, which enforces
                                   its own matrix per endpoint
```

- **Routing is not authorization** and is not treated as any part of it.
  A person typing `/portal/payroll` gets the clamp *and* would get 403s on
  every payroll endpoint if the clamp were ever wrong. Both survive.
- **The render-time clamp survives.** v1.4.232's rule — an out-of-scope
  module must never mount, *not even for one frame* — becomes a layout-level
  guard that runs before `children` is rendered, which is strictly stronger
  than the current post-render effect plus `activeTab` expression.
- **`canSeeTab`, `accessOf`, `TAB_ROLES`, `PARKED_TABS`, `ALWAYS_VISIBLE`,
  `/staff/tabs/access/person` and the worker's matrix are not touched.**
- **A permission that changes mid-session** (the 🔐 card, a role change)
  already re-filters `tabs`; with routes it additionally must kick a person
  off a module they are standing on. That is one effect: if the current
  route's tab leaves `permitted`, `router.replace("/portal/home")` — Home,
  not the resolver, so a revoked permission cannot bounce them somewhere
  else again.

---

## 24. What P1 does not touch

Restating the owner's list as an implementation constraint, plus what I would
add from reading the code:

- No D1 schema, no migration, no business calculation, no financial logic.
- No CRM states. No new API. **One clarification:** §9.2 identifies that the
  sales-document record URL the brief asked for *needs* a new read endpoint —
  so it is deferred rather than quietly implemented.
- No module internals: Sales, Hankei's, Inventory, HR, Payroll, Attendance
  render exactly as they render today, inside a new frame. **If a module
  looks different after P1, that is a bug, not a feature.**
- No `DataTable` replacement, no Tailwind, no second token migration.
- No P0 revisiting.
- **No new module and no new count.** Badges, the Create stop and a Settings
  page are all deferred with reasons (§10, §12.3).

---

## 25. Implementation order

Ordered by **dependency**, not by the brief's numbering. Three stages differ
from the suggested order and all three differences are deliberate.

```
P1.0  REGISTRY + RESOLVER + GREEN GUARDS         no UI change, no route file
      TAB_ROUTE in portal-tabs.ts · lib/portal-routes.ts ·
      tests/portal-routes.mjs — green with ZERO route files (§26.1)
                    │
P1.1  SHELL EXTRACTION                           still one route, still useState
      PortalProvider + layout.tsx own the shell; page.tsx keeps the
      module switch and the tab state it has today
      ── the riskiest step, and it ships ALONE, with the old navigation
         still driving it, so any regression is isolated from routing
                    │
P1.0b ROLLBACK BRIDGE                            its own release
      app/portal/[section]/ → /portal?tab=<Tab>
      ships while the OLD portal is still live, and is NOT part of the
      P1.2 commit, so reverting P1.2 cannot take it away (§26.3)
                    │
P1.2  ROUTES + ENTRY RESOLVER                    the switch is thrown
      29 route pairs (incl. /portal/home) · /portal becomes the resolver ·
      ?tab= resolver · service worker (§15.3) · error.tsx → /portal/home
                    │
P1.3  PAGE IDENTITY                              PageHeader + titles
                    │
P1.4  RECORD URLS                                the 7 of §9.1
      + RecordDetail history reconciliation (§7.3) — same release, always
                    │
      ┌─────────────┴─────────────┐              independent of each other
P1.5  DESKTOP xl WORKSPACE     P1.6  MOBILE + MORE
      └─────────────┬─────────────┘
                    │
P1.7  COMMAND PALETTE → ROUTES
                    │
P1.8  /admin ALIGNMENT                           shell variant; /account untouched
                    │
                 ── STOP ── report, measure the bundle, wait
```

**Why P1.0b exists at all.** Revision 1 put the compatibility fallback inside
P1.2 and then proposed reverting P1.2 as the rollback — which would delete
the fallback at the exact moment somebody's `/portal/sales` bookmark needed
it. Shipping it first, alone, makes the rollback safe by construction. §26.3.

**Why P1.1 before P1.2.** Extracting a 1,917-line page into a layout plus a
provider is the change most likely to break something subtle — a hook order,
an effect that assumed it ran once, the SSE stream, the outbox scope. Doing
it *while the old navigation still works* means a regression there is
provably not a routing bug. Doing both at once means a week of not knowing
which half broke.

**Why P1.4 is not last.** The record URLs are what make Back mean something
to a person using the product, and they carry the `RecordDetail` history
conflict, which is a correctness issue rather than a polish item.

---

## 26. Tests and rollback

### 26.1 Guards — and why no stage is ever red

**The rule (Correction 3): a guard must be green at every commit that ships.**
Revision 1 put route-directory parity in P1.0, where it could not pass until
P1.2 created the files — which would have left P1.1 shipping into a knowingly
red gate. That is how a team learns to ignore a red build.

The fix is not to delay the assertion. It is to write it as a **conditional
parity** check, which is a stronger statement than either half:

```
  route directories found under app/portal/          verdict
  ───────────────────────────────────────────────    ────────────────────
  none                                               PASS  (P1.0, P1.1)
  all 29, and nothing else                           PASS  (P1.2 onward)
  some                                               FAIL  ← the real bug
```

A partial set is the only genuinely broken state — a module with no route, or
a route with no module — and it is exactly the state the old formulation
could not distinguish from "not yet". `[section]` (the P1.0b bridge) is
excluded from the count by name, because it is not a canonical route.

| # | Assertion | Live from |
|---|---|---|
| 1 | every active tab has a `TAB_ROUTE`; every parked tab has none | **P1.0** |
| 2 | `TAB_ROUTE` schema valid: `slug` present, `record`/`context` of the right shape | **P1.0** |
| 3 | slugs unique, `^[a-z][a-z0-9-]*$`, kebab, no reserved segment | **P1.0** |
| 4 | `Dashboard` slug is `home`, and no entry has an empty slug | **P1.0** |
| 5 | `pathOf`/`tabOfPath` round-trip for all 29 | **P1.0** |
| 6 | `tabOfPath` returns null for `/portal`, `/portal/`, an unknown slug, a parked slug, and a two-segment path | **P1.0** |
| 7 | `resolveLegacyTab` — **run, not read** — over valid+authorized, valid+unauthorized, parked, retired, unknown, junk, absent, `Dashboard`, for eight roles | **P1.0** |
| 8 | `resolveLegacyTab` can never return a tab outside the permitted list (property test, 500 random permitted subsets) | **P1.0** |
| 9 | `resolveEntry` precedence is the v1.179.0 order: `?tab=` › remembered › `launch_shift` › `/portal/home` | **P1.0** |
| 10 | a remembered tab that is no longer permitted is discarded and falls through | **P1.0** |
| 11 | the worker's `PUSH_TAB` names only tabs that exist | **P1.0** |
| 12 | `SECTIONS` still reads out as `ALL_TABS` (existing) | today |
| 13 | **conditional route parity** (the table above) | **P1.0**, meaningful from P1.2 |
| 14 | the P1.0b bridge maps only known slugs and interpolates no user input | P1.0b |
| 15 | no `history.pushState` in the shell; `RecordDetail` keeps its `"own"` default | P1.4 |
| 16 | every route page exports `metadata` with a title, and no two titles are equal | P1.2 |
| 17 | `sw.js` `SHELL` key changed, `shellPage` covers `/portal/*`, the four offline-critical documents are in `SHELL_URLS`, and the offline fallback is `/portal/home` — **not** `/portal` | P1.2 |

### 26.2 Browser probes (`tests/browser/`)

A new `route-walk.py` alongside the four existing probes, driving real
WebKit — the engine the PWA runs on:

| Scenario | Expected |
|---|---|
| bare `/portal`, nothing remembered | **replaced** with `/portal/home`; `/portal` not left in history |
| bare `/portal` with a remembered route | **replaced** with that canonical URL |
| **`/portal/home` with Sales remembered** | Dashboard. Home consults nothing — Correction 1's regression test |
| **Home pressed while on `/portal/sales`** | `/portal/home`, and it stays there |
| `/portal/sales` direct | Sales, rail item active, header says Sales, title says Sales |
| **F5 on `/portal/hotels?hotel=88`** | same record, same scroll container, no flash of Dashboard |
| `/portal?tab=Leave` | replaced with `/portal/leave`, one history entry |
| `/portal?tab=Dashboard` | replaced with `/portal/home` |
| `/portal?tab=Payroll` as `live_host` | `/portal/home`, no payroll chunk requested |
| `/portal?tab=Threads` (parked) | `/portal/home` |
| `/portal?tab=Purchasing` (retired) | `/portal/home` |
| `/portal/nonsense` | 404 page → redirect to `/portal` (§26.3), which then resolves |
| Back/Forward across 4 modules | the exact sequence, both directions |
| record open → Back | record closes, list intact, `?hotel=` gone, **one** Back |
| permission revoked while standing on the module | replaced to `/portal/home` |
| legacy push URL through `sw.js` | window navigates, resolver replaces |
| canonical deep link through `sw.js` | window navigates, no replace |
| desktop rail at 1280 | every permitted item a real link; ⌘-click opens a tab |
| mobile bar at 402 | four stops + More, same stops as v1.179.0 for each of 8 roles |
| tablet at 768 and 1024 | rail collapsed / expanded, no bottom bar |
| ⌘K → a module, and ⌘K → a hotel hit | canonical URL in both cases |
| **offline**, `/portal/on-shift` | renders from cache |
| **offline**, an unvisited route | falls back to the cached `/portal/home`, not a browser error and not the resolver |

`a11y-audit.py` and `ui-audit.py` are re-run per route rather than per tab —
the probes take a tab list today and will take a route list.

### 26.3 Rollback — the bridge ships first, and separately

**Revision 1 had this wrong.** It put the `/portal/*` fallback inside P1.2 and
then proposed `git revert P1.2` as the rollback. That deletes the fallback at
precisely the moment it is needed: after a rollback, the canonical URLs people
bookmarked during the release would 404, and the thing that would have caught
them went out with the same commit.

**P1.0b — the forward-compatibility bridge, shipped before the switch.**

```
  app/portal/[section]/page.tsx        generateStaticParams over the 29 slugs
                                       dynamicParams = false
        │
        ▼
  BEFORE canonical routes exist          AFTER P1.2 ships
  ─────────────────────────────          ─────────────────────────────
  /portal/sales                          /portal/sales
    → replace /portal?tab=Sales            → app/portal/sales/page.tsx
       (the legacy portal, which             (a static segment beats a
        clamps permissions as always)         dynamic one in Next's
                                              route resolution)
        │
        ▼
  IF P1.2 IS REVERTED
  ─────────────────────────────
  the static segments disappear; [section] is still there and takes over
  again; /portal/sales lands on the legacy portal's Sales tab
```

Properties the bridge must have, and the guard that holds each:

- **A static slug → `TabName` map**, read from `TAB_ROUTE`. The bridge never
  interpolates the URL into anything; an unknown `section` cannot reach
  `generateStaticParams` at all, because `dynamicParams = false` makes it a
  plain 404, and the 404 page sends `/portal/*` to `/portal`.
- **Permission-neutral.** It redirects and nothing else. The legacy portal's
  `canSeeTab` clamp is untouched and still decides what the person sees.
- **It is NOT in the P1.2 commit**, and `PUSH.bat` releases it on its own.
  That is the whole point.
- **It costs 29 tiny HTML documents** and no behaviour, because nothing links
  to `/portal/<slug>` until P1.2.

**The commit and release boundary, explicitly:**

| Release | Contains | Reverting it |
|---|---|---|
| `v1.180.0` — **P1.0** | `TAB_ROUTE`, `lib/portal-routes.ts`, `tests/portal-routes.mjs`, registration | harmless: dead code, no UI |
| `v1.181.0` — **P1.0b** | `app/portal/[section]/`, 404 fallback, `SHELL` bump → `v35` | would remove the bridge — **do not revert this to fix a routing problem** |
| `v1.182.0` — **P1.1** | `layout.tsx`, `PortalProvider`, shell components; `page.tsx` shrinks | harmless to routing: no URL changes meaning |
| `v1.183.0` — **P1.2** | the 29 canonical routes, the entry resolver, `sw.js` `v36` | **this is the revert target.** The bridge survives it |

**Rollback procedure, in order:**

1. `git revert` the P1.2 commit only.
2. Bump `SHELL` again (`v36` → `v37`) in the same revert commit. An installed
   PWA holds cached documents for routes the build no longer emits; without
   the bump it would keep serving them.
3. `PUSH.bat`.
4. Nothing else. The bridge, the registry and the extracted shell all stay,
   and every canonical bookmark reaches the legacy portal through `[section]`.

**Residual risks, named:**

| Risk | Severity | Mitigation |
|---|---|---|
| offline navigation to an unvisited route | **high** — PWA on the move | §15.3; fallback is `/portal/home`, never the resolver |
| RSC payload files not cached for offline client navigation | medium | verified against build output in P1.2, not assumed |
| `RecordDetail` double history entry | medium | §7.3, same release as record URLs |
| the shell extraction breaks an effect (SSE, outbox, versions) | medium | P1.1 ships alone, with routing unchanged |
| a bookmark made between release and rollback | **low** | P1.0b, which survives the revert |
| bundle grows because the shell is duplicated per route | low | measured, not assumed; the layout is shared by construction |

---

## Summary — decisions, all settled

| § | Decision | Owner's ruling |
|---|---|---|
| 3.4 | ELFIA trio flat or nested | **FLAT** in P1. No `/portal/elfia/*` |
| 9.2 | sales-document record URL | **Deferred to P2.** No new staff GET-by-id in P1 |
| 12.3 | a Create stop on the phone bar | **Not in P1.** Four stops + More, unchanged |
| 22 | `/admin` and `/account` | `/admin` a shell variant, **last**; `/account` untouched |
| — | entry vs home | **`/portal` resolves, `/portal/home` shows** (Correction 1) |
| — | rollback bridge | **P1.0b, its own release, before P1.2** (Correction 2) |
| — | guard staging | **No intentionally red stage** (Correction 3) |

**Authorised to implement:** P1.0, then P1.1, then stop and report.
**Not authorised:** P1.0b, P1.2 and everything after.
