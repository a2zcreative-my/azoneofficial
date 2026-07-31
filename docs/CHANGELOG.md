# Changelog

All notable changes to the AZ ONE OFFICIAL platform.

## [1.4.6] — 2026-07-31 — Admin password reset

### Added
- **Reset password** action per user in /admin → Users, for forgotten passwords. Inline field (10+ characters), uses the existing guarded `PATCH /users/:id` — the server hashes the new password and revokes every session the user had, so the old credential is dead the moment the new one is set. Escalation guards from v1.4.3 apply unchanged: an admin cannot reset a super admin's password
- Guidance shown in the flow: hand the new password over directly (WhatsApp / in person) and have the user change it themselves in Profile after signing in


## [1.4.5] — 2026-07-31 — Admin matches the website; friendly editing

### Added
- **Website tab in /admin** — a labelled editor for the live site's text: hero headline and sub-headline, both About paragraphs, Services and Showcase section headings/intros, footer strapline, and the statistics list. Every field names where it appears on the page, saves individually with a visible "Saved ✓", and an empty field simply means the site shows its built-in default — an editor cannot break the page from here. Content flows through the existing CMS (site_content → Editable), so changes appear on the next page load with no rebuild
- Homepage Services and Showcase section headings/intros are now CMS-backed (previously hardcoded)
- A plain-language purpose line under the tab bar for every admin tab

### Changed
- **Products tab removed from /admin** — the site has no /products routes any more, so that tab edited data nothing rendered; this desync is what made the admin feel disconnected from the webpage. The raw key/value editor is retained as the **Advanced** tab for anything the Website tab does not cover
- Dashboard cards now reflect the real site: the permanent "0 Products" card is replaced by Portfolio items; the summary endpoint counts portfolio_items instead of products
- Tab order regrouped around daily work: Dashboard, Website, Enquiries, Portfolio, Testimonials, Posts, Media, Users, Account, Advanced

### Note
- The screenshot reviewed was v1.4.2 in production — the Account tab (change password), kill switch, and the five staff role modules shipped in v1.4.3/v1.4.4 and appear after this build is deployed


## [1.4.4] — 2026-07-30 — Company role modules

### Added
- **Five business roles with their own portal modules**, assignable from /admin → Users and enforced server-side:
  - **HR & Administrative** (`hr_admin`) — HR tab: attendance verification table for all company accounts with every event flagged against the working shift (10:00am–6:00pm MYT, Mon–Fri: ok / late / early out / weekend); daily/weekly/monthly task reports; staff birthdays. Leave administration in the Leave tab (Annual/Medical/Emergency approve/reject); QT/DO/INV creation in the Sales tab
  - **Sales & Marketing** (`sales_marketing`) — Inventory tab: real-time stock with auto status (in_stock/low/out_of_stock), postage tracking records (preparing→shipped→in_transit→delivered/returned), and a marketing-materials request pipeline
  - **Chief Commercial Officer** (`cco`) — Commercial tab: business development pipeline with the exact statuses requested (open / pending / KIV / closed won / closed lost) plus per-deal strategy and next action
  - **Chief Operation Officer** (`coo`) — Operations tab: daily operational status + daily sales results (one report per day; resubmitting updates it) and operation strategy for sales & marketing
  - **Chief Executive Officer** (`ceo`) — Overview tab: read-only monitoring of the whole company (clocked-in count, pending leave, documents issued, low stock, BD pipeline, latest ops report). Deliberately no edit rights
- All staff roles clock in/out in the existing Attendance tab and apply for Annual/Medical/Emergency leave in the Leave tab
- Migration `0007_role_modules.sql`: inventory_items, postage_records, material_requests, bd_pipeline, ops_reports, task_reports, users.birthday

### Changed
- **Document numbering** now `{TYPE}-AZOO{DDMMYY}-{X}` (e.g. `QT-AZOO300726-1`), running number per type per Malaysian business day. Previously issued numbers are untouched — see DOCUMENT-NUMBERING.md history
- `/attendance/report` annotates each event with Malaysia time and a shift flag so HR verifies at a glance
- Role lists, portal tab gating, and the admin role dropdown extended accordingly

### Deploy
- `npx wrangler d1 migrations apply azoneofficial --remote` (0007) **before** `npx wrangler deploy`, then rebuild the site


## [1.4.3] — 2026-07-30 — Admin control, kill switch, self-service passwords

### Added
- **Kill switch for suspicious accounts.** Two levels in the admin Users panel:
  - *Force logout* — revokes every session for the account server-side, instantly, without deactivating it. The first response to "this login looks odd"
  - *Suspend* — blocks sign-in AND revokes all sessions in one action (with a confirm dialog); a suspended badge shows on the account; *Reinstate* undoes it. Endpoint: `POST /api/v1/users/:id/revoke-sessions`; suspension audit-logged as before, force-logout logged as `user.force_logout` with the session count
- **Change-password interface** for every signed-in user: an **Account** tab in `/admin` and a section inside the portal **Profile**. Requires the current password, enforces the 10+ character minimum, and on success revokes every *other* session — a stolen session dies the moment the password rotates — while re-issuing the current browser's session so the user isn't logged out by their own change. Google-only accounts get a clear explanation instead of a cryptic failure (they manage credentials with Google; letting a hijacked session ADD a password would hand an attacker a permanent way in). Endpoint: `POST /api/v1/auth/change-password`

### Changed
- **`admin` role now has full user management** (previously super-admin-only): view, create, role changes, suspend/reinstate, force logout, admin-set passwords — with escalation guards enforced server-side: an admin can never modify a super admin, create or grant `super_admin`, or change their own role. The Users tab is now visible to admins; super-admin-only options are hidden from their role menus and the API rejects them regardless
- Self-deactivation remains blocked; deactivation and admin password resets still revoke the target's sessions


## [1.4.2] — 2026-07-30

### Fixed
- **`/api/v1/auth/google` 404 in production.** The Worker had no route bound to the domain, so `/api/*` fell through to the static Pages site, which has no such path. `worker/wrangler.toml` now declares `azoneofficial.com/api/*` (and `www.`) routes, so `wrangler deploy` attaches them automatically — the manual dashboard step that was missed can no longer be missed

### Added
- `docs/AUTH-SETUP.md` — the complete path from 404 to working Google login: deploy checklist (migrations → secrets → vars → deploy), exact Google Console origin/redirect values, what happens on first login for `@azoneofficial.com` staff vs customers, verification commands, and the www cookie caution

### Notes
- No application code changed. Staff auto-provisioning already worked as designed: company-domain Google logins create active staff accounts (role `marketing`, admin-elevatable); other emails create customer accounts


## [1.4.1] — 2026-07-29 — Shopee Live added to the live showcase

### Added
- **Shopee channel panel** in the homepage live showcase, alongside the TikTok embed. Shows the shop handle (`shopee.com.my/azoneoff`), what a Shopee session includes, and a "Watch on Shopee Live" CTA. `LIVE_SHOWCASE.shopeeLiveUrl` set; leaving it `""` hides the panel and the TikTok embed spans the section
- Section restructured into two equal-height channel panels (`items-stretch` + `h-full`), each carrying its own full-width CTA at the base so the two columns align

### Notes — why Shopee is a card and not an embed
- Shopee sends `X-Frame-Options` / `frame-ancestors` headers that block its shop and live pages from being framed by another site, and publishes no embed or oEmbed API. An `<iframe>` would render blank or refuse to load, so the panel is a branded card that links straight to the shop, where the live badge appears during a session
- TikTok's official creator embed is used on its side because TikTok does publish one — the asymmetry is a platform limitation, not a design choice
- Neither platform exposes a public "live now?" API, so both CTAs are written to read correctly whether or not a session is running. The constraint is documented in `LIVE_SHOWCASE` so it isn't re-litigated later
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.4.0] — 2026-07-29 — Live embed, problems section, ELFIA into Portfolio

### Added
- **TikTok embedded on the homepage.** The live showcase now embeds the official TikTok **creator widget** for @azoneofficialhq — the account with its latest videos, always current, no manual updates. Platform constraint stated in-code: a LIVE stream itself cannot play inside another website (TikTok blocks the /live page in iframes) and no public live-status API exists; the gold "Watch us live on TikTok" CTA carries that job via the self-routing /live URL. `LIVE_SHOWCASE.videoUrl` still overrides the widget with one specific video if ever wanted
- **"The problems we solve, live"** (`components/home/problems.tsx`) — four equal-weight pain→solution cards between About and Services: nobody bought / no team or time / views without conversion / content dies after the stream. Copy in `PROBLEMS` (`constants/content.ts`)
- **Client logo strip in the hero** — "Brands we run live for" with a generated temporary ELFIA serif wordmark (`public/clients/elfia-wordmark.svg`, gold underline accent) linking to elfiaofficialstore.com. Swap the SVG for the official logo when supplied; no code change needed

### Changed
- **Navbar CTA:** "Book a consultation" → **"Get a free live audit"** (`CTA_LABEL`); the matching FAQ answer updated
- **Hero subheadline** no longer names ELFIA in text — the clause "featured client ELFIA, a premium hijab label" is replaced by the logo strip
- **ELFIA folded into Portfolio.** The standalone `/portfolio/elfia` page is removed (301 → `/portfolio`); the ELFIA portfolio card is now clickable and opens **elfiaofficialstore.com**. The "ELFIA" navbar item is removed (nav: About, Services, Packages, Portfolio, Blog, Contact). `/products` legacy redirects retargeted to `/portfolio`. The challenge/approach/result write-up remains available on `/case-studies`
- `PortfolioItem` gained an optional `href`; cards render as external links when set

### Notes
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.3] — 2026-07-29 — Live showcase section on the homepage

### Added
- **`components/home/live-showcase.tsx`** — new dark section between the session showcase and the process steps: "See a live session, live". Gold CTA "Watch us live on TikTok" points at `tiktok.com/@azoneofficialhq/live`, which TikTok itself routes to the live room during a session and to the profile otherwise — correct in both states with no status detection. Optional Shopee Live button appears when `LIVE_SHOWCASE.shopeeLiveUrl` is set
- **Process video slot** using TikTok's official video embed (blockquote + embed.js). Configured by `LIVE_SHOWCASE.videoUrl` in `constants/content.ts`; while it is unset (current state) or while the embed is still loading, a styled preview card renders instead — the section never shows a broken player
- `LIVE_SHOWCASE` constant block documenting the platform constraint: TikTok/Shopee LIVE streams cannot be embedded on external sites and there is no public live-status API a static export could poll — the /live URL carries that job

### Action needed
- Set `LIVE_SHOWCASE.videoUrl` to the TikTok video that best shows the AZ ONE process (session highlight / behind-the-scenes); optionally set `shopeeLiveUrl`

### Notes
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.2] — 2026-07-29 — ELFIA removed from the landing page

### Changed
- **Homepage no longer carries the ELFIA showcase section** (dark section with slogan and product gallery). A full brand section with product imagery on the agency's own landing page still read as a house line; a prospective client should meet ELFIA as *proof*, not as a product. The homepage now runs Hero → About → Services → Packages → Showcase → Process → FAQ → CTA
- ELFIA remains presented as the existing successful client everywhere it counts: the hero subheadline mention, the "Operators, not observers" trust signal, the FAQ answer, the nav item, /portfolio, /case-studies, and the full case study at `/portfolio/elfia` (which keeps the work gallery — showing client work in a case study is the point)
- **ELFIA's own landing page is elfiaofficialstore.com** — the case-study outbound link and the customer-area "ELFIA drops" card now point there (previously elfia.com.my)
- `components/home/elfia.tsx` deleted (no longer referenced)

### Notes
- `/products` 301s and the `ELFIA` nav → `/portfolio/elfia` routing from v1.3.0 are unchanged
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.1] — 2026-07-29 — ESLint build errors fixed

### Fixed
Cloudflare Pages runs ESLint as part of `next build`; 14 rule violations caused the build to fail with exit code 1. All fixes are semantically equivalent — no copy, layout, or logic changed.

- `react/no-unescaped-entities`: apostrophes and quotation marks in JSX text replaced with HTML entities (`&apos;`, `&ldquo;`, `&rdquo;`) in `app/careers/page.tsx`, `app/portal/page.tsx`, `app/portfolio/page.tsx`, `app/privacy/page.tsx`, `app/services/page.tsx`, `app/terms/page.tsx`, `components/home/showcase.tsx`
- `@next/next/no-html-link-for-pages`: `<a href="/">` in `app/login/page.tsx` replaced with `<Link href="/">` (Next.js `next/link`); import added
- `@typescript-eslint/no-unused-vars`: `goTo` function in `components/ui/packages-carousel.tsx` prefixed `_goTo` (dots navigation was dropped in v1.2.22; the function was left in but never called)

## [1.3.0] — 2026-07-29 — ELFIA repositioned as client; catalogue removed

Applied directly on the stable v1.2.29 build. **No layout, section sizing,
spacing, animation, or component structure was touched** — this release is
copy, links, data, and one additive page. (The abandoned v1.4/v1.5 workspace
branch attempted the same repositioning with a repo restructure that broke the
deployed layout; this release supersedes that branch from the v1.2.29 base.)

### Changed — business positioning
- **ELFIA is a client of AZ ONE OFFICIAL, not a product.** The agency needs to pitch brands that compete with its clients (including other hijab labels), so nothing on this site may read as AZ ONE selling hijabs itself
- Site description: "Home of ELFIA, our premium hijab brand" → "Featured client: ELFIA"
- Hero subheadline: "home of ELFIA, our premium hijab brand" → "featured client ELFIA, a premium hijab label" (same length band, no layout shift)
- About copy: "We are also a brand owner ourselves" → operator framing (we built and run the client's channel end to end)
- Trust signal "Brand owners, not just an agency" → "Operators, not observers"
- Homepage ELFIA section: eyebrow "Our house brand" → "Featured client"; body rewritten as a channel we built and run; gold CTA now "View the ELFIA case study" → `/portfolio/elfia`. **Markup, grid, gallery, animation, and sizing are byte-identical**
- FAQ "What is ELFIA?" reframed as a client engagement and featured case study
- `SITE_CONFIG.brand.hijab` → `SITE_CONFIG.featuredClient` (the agency owns no product line)

### Added
- **`/portfolio/elfia`** — featured case study (the brand, challenge, approach, result, the work, CTA), built entirely from existing design-system pieces: `PageShell`, `Button`, `ButtonGroup`, `ElfiaGallery`
- **`PORTFOLIO_ITEMS` and `CASE_STUDIES` populated** with the ELFIA engagement — `/portfolio` and `/case-studies` move from "in preparation" empty states to real client work with **zero changes to their page code**

### Removed
- **`/products` and `/products/[slug]`** — an agency site cannot credibly host a product catalogue in a client's category. All catalogue URLs (including the pre-v1.2.11 slugs, via chained redirects) 301 to `/portfolio/elfia` in `public/_redirects`
- Catalogue routes removed from the sitemap; `/portfolio/elfia` added
- Nav item "ELFIA" now points at `/portfolio/elfia` (label and position unchanged)
- ELFIA gallery centre card links to the case study instead of product pages (same markup); customer-area "ELFIA drops" card now links out to elfia.com.my
- `ELFIA_DROP_STEPS` kept in constants but unused — reserved for hand-off to the standalone ELFIA site

### Notes
- Case study copy is deliberately qualitative; publish figures only with the client's approval
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.2.29] — 2026-07-27

### Changed
- **Footer strapline now centres under the logo.** The logo and "LIVE . CONNECT . GROW." were separate block elements in a left-aligned column, so the strapline aligned to the column's left edge rather than to the mark above it. They're now wrapped in an `inline-block` lockup that shrinks to the logo's width, with the strapline centred inside it — so it sits centred beneath the logo regardless of either element's width. The rest of the footer column (slogan, address, CTA) stays left-aligned as before

## [1.2.28] — 2026-07-27

### Fixed
- **`/about` "Why brands choose us" left a third of the frame empty.** `PageShell` carried a blanket `[&_section>ul]:max-w-3xl` rule, added in v1.2.13 to keep bullet lists readable — but it also caught *card grids*, capping them at 768px inside the 1152px frame. The rule now excludes lists that are themselves layouts (`:not([class*=grid]):not([class*=flex])`), so prose lists stay readable while grids use the full width. Cards go from ~243px to ~355px each. Same fix applies anywhere a grid list sits directly inside a section

### Changed
- **Footer strapline is now clearly subordinate to the logo.** "LIVE . CONNECT . GROW." rendered at `text-xs` with `0.35em` tracking — roughly 256px wide against a logo drawing only ~107px, so the strapline dominated the mark. The logo is now `h-12` (~161px wide) and the strapline `9px` at `0.08em` tracking (~150px), so it sits narrower than the logo above it, matching the lockup used in the OG banner

## [1.2.27] — 2026-07-26

### Fixed
- **Refresh a product page, then press Back → landed on the wrong homepage section.** v1.2.23's scroll memory only restored on in-app `popstate` events. But once a product page has been *reloaded*, the client router cache is gone, so Back becomes a **full document load** (`navigation.type === "back_forward"`), not an in-app navigation — the restore never ran, and the browser's own restoration clamped to a shorter, still-loading document, dropping the visitor at About instead of ELFIA.
  Both halves now handle that case: the inline script takes over restoration on `back_forward` loads *only when a stored offset exists for that path*, and `ScrollMemory` treats a `back_forward` document load the same as a popstate, applying the offset once the page is genuinely tall enough. Control is handed back to the browser (`scrollRestoration = "auto"`) as soon as the restore completes, so ordinary navigation is unaffected
- Layout-settle window widened from ~1s to ~1.5s for slower connections

### Changed
- **Product breadcrumb given a proper position.** It sat inside the main content block below ~96px of top padding, floating in empty space. It now has its own compact strip directly under the navbar, separated by a hairline rule, using a semantic `<ol>` with a chevron separator, `aria-current="page"`, and truncation so long product names don't wrap on mobile. Content padding reduced accordingly (`py-16/24` → `py-12/16`)

## [1.2.26] — 2026-07-26

### Changed
- **ELFIA English strapline** is now *At First Sight. Forever in Your Heart.* (was "Premium hijabs, born live"). It reads as the meaning of the Malay slogan rather than a competing line, so the two are presented as a pair: *Dekat Di Mata, Menarik Di Hati* leads in gold, with the English beneath it. Restyled from uppercase label to italic sentence case, since it's now a sentence, not a tag
- `/products` meta description carries both lines

### Added — ELFIA buying experience
- **"How an ELFIA drop works"** on `/products`: a four-step sequence — drop announced, fabric styled live on camera with comments answered, price revealed in-session, checkout through the pinned link. Buying live is unfamiliar to many shoppers, and not knowing what happens if they show up is what stops them joining a session at all
- **Drop alerts via WhatsApp** — "Get drop alerts on WhatsApp" replaces the generic "Ask about ELFIA" CTA, capturing interest between drops with no email service required
- **Product CTAs now prefill context**: `whatsappUrl()` accepts an optional message, so "Ask about this piece" arrives naming the exact product and asking when the next drop is — the enquiry lands qualified instead of as a bare "hi"

## [1.2.25] — 2026-07-26

### Changed
- **Package carousel progress bar now spans the full width of the section** (was capped at 220px and sharing a row with a counter, so it sat oddly to the left)
- **Counter removed** — the bar alone communicates position
- The bar now reflects the carousel's **actual scroll position and visible fraction** rather than the snapped card index: the thumb's width equals the proportion of the track on screen (75% of the bar when 3 of 4 cards are visible, 25% on mobile where one shows), and it moves continuously while dragging instead of jumping between steps. Recalculated on resize so it stays correct across breakpoints

## [1.2.24] — 2026-07-26

### Fixed
- **Product gallery frame no longer mismatches the photo.** `aspect-[4/5]` set the frame ratio, but the `max-h-[62vh]` added alongside it clamped the frame's *height* while its *width* stayed at the column width. The frame stopped being 4:5 and became landscape, so the portrait photo could not fill it — leaving a band of empty navy beside the image.
  The frame now has a single source of truth: one fixed `aspect-[4/5]` box sized by `max-width` alone (360px mobile / 400px tablet / 420px desktop), with no height cap. Frame ratio and image ratio can no longer diverge, and the gallery is a predictable fixed size at every breakpoint — roughly 48–58% of viewport height across phone, tablet, laptop, and wide desktop
- Main images given explicit `block` + `object-center` alongside `object-cover` so they always fill the frame regardless of intrinsic dimensions
- Audited every other `aspect-[…]` box in the codebase for the same width/height conflict — none found

## [1.2.23] — 2026-07-26

### Fixed
- **Back from an ELFIA product no longer lands at the top of `/products`.** Root cause: the App Router restores scroll from its own cache, but it does so before the returning page has finished laying out — the saved offset is taller than the document at that instant, so the scroll silently clamps to 0. New `components/ui/scroll-memory.tsx` records the offset per path and, on popstate navigations only, retries across animation frames until the document is genuinely tall enough to honour it. Forward navigation still starts at the top, and reload still starts at the top (unchanged inline script)
- **Product gallery was oversized.** The 3:4 main image filled a half-page column, running taller than the viewport on laptops and pushing the price/CTA block below the fold. Now 4:5, capped at `62vh`, with the gallery constrained to 380px (440px at desktop) — roughly half the viewport height on a phone and ~60% on a laptop

### Changed
- **Package carousel affordance replaced.** The "Swipe or drag to see all 4" sentence was instructional and read awkwardly on desktop, where nobody swipes. Replaced with self-evident cues: a right-edge fade that shows only while more cards remain, a progress bar, and a plain "2 of 4" counter. Card width at desktop widened the peek so a sliver of the next tier is always visible
- Carousel track is now keyboard-focusable (`tabIndex={0}` with a descriptive label), since removing the arrows left keyboard users without a way to move it

## [1.2.22] — 2026-07-26

### Added
- **ELFIA brand slogan** — *Dekat Di Mata, Menarik Di Hati* — added as `ELFIA.slogan` and displayed on the homepage ELFIA section and `/products`, leading above the English tagline. Also carried into the "What is ELFIA?" FAQ answer and the `/products` meta description
- **Professional product gallery** (`components/ui/product-gallery.tsx`) on ELFIA product pages: one large main image with a thumbnail strip, swipe on mobile, image counter, neighbour preloading. Replaces the 2-column grid, which showed every angle at once and left none of them large enough to judge fabric drape

### Changed
- **ELFIA aligned as a hijab brand everywhere.** Audited every file: "our premium fashion brand" → "our premium hijab brand" (hero + site description), "premium fashion label" → "premium hijab label" (About copy), `SITE_CONFIG.brand.fashion` → `brand.hijab`, keyword "ELFIA fashion" → "ELFIA hijab", `/about` meta description, and README
- **Package carousel is now scroll-only** — the `< >` arrows are gone. Swipe on touch, and pointer drag-to-scroll on desktop (mice can't swipe, and with no arrows they need a way to move the track), with clickable dots and a "Swipe or drag" hint
- **Button widths fully standardised.** `Button` now renders a real `<button>` when `href` is omitted, so the contact form submit — the last hand-rolled CTA, at `h-11` with no minimum width — uses the shared metrics. Both ELFIA pages' CTA pairs moved to `ButtonGroup` for equal widths. Audit confirms no hand-rolled button-like elements remain on public pages
- **`/about` rebuilt to remove dead space.** It was a single narrow column inside the 6xl frame, leaving the right half empty. Now the story runs left with a "short version" facts panel alongside, "Why brands choose us" is a 3-column grid at desktop, and the closing text link became a proper CTA pair

## [1.2.21] — 2026-07-26

### Changed
- **Package tiers are now a carousel** (`components/ui/packages-carousel.tsx`) on both the homepage and `/packages` — one card at a time on mobile, two on tablet, three on desktop, with arrows and dots. Replaces the four-across grid, which was a long stack on phones and a dense wall on desktop. Built on native scroll-snap rather than the ELFIA coverflow transform: these cards are text, and scaled/partial neighbours would hurt readability. Deliberately not autoplaying — package details need reading time
- The `/packages` comparison matrix is unchanged and still desktop-only

### Fixed
- **Refreshing no longer restores the old scroll position.** Browsers restore scroll on reload, so a refresh mid-page left visitors where they were instead of at the top. A pre-paint script in `app/layout.tsx` now sets `history.scrollRestoration = "manual"` for reloads only, jumps to the top on load, then immediately hands control back to the browser
- **Back navigation still returns you to where you were** — critically, that means tapping an ELFIA product and pressing back lands on the ELFIA section, not the top of the page. `scrollRestoration` is a property of the history *entry*, so leaving it on `"manual"` would have disabled that; it's reset to `"auto"` straight after the reload jump
- URLs with a `#anchor` are left alone, so in-page links (e.g. `#packages`) still work
- Reload jump is instant rather than animated: `html { scroll-behavior: smooth }` was making the correction visibly scroll. A `data-scroll-reset` attribute disables smooth scrolling for that one moment

## [1.2.20] — 2026-07-26

### Changed — information architecture
- **Packages moved to a dedicated `/packages` page.** They were appended to `/services`, which mixed two different questions: "what can you do for me?" (capability) and "what do I get and what does it cost?" (commercial). Separating them means each page answers one question, and a prospect can be sent a direct link to `/packages` from WhatsApp — the primary sales channel
- **`/services` now ends with a short "How we package this" strip** linking to `/packages`, instead of duplicating the tier cards
- **Homepage packages section** now leads to `/packages` ("Compare packages") rather than repeating the detail
- **Navigation**: `Packages` added; `FAQ` moved out of the primary nav to keep it at seven items. FAQ remains reachable from the homepage FAQ section link and is now an explicit footer link
- FAQ content split by intent: homepage shows the five general questions, `/packages` shows the six cost/logistics questions, `/faq` still shows all twelve

### Added
- `PACKAGE_MATRIX` + comparison table on `/packages`: sessions, hours, host, reporting, creative, consultation, on-site, WhatsApp support across all four tiers. Desktop only — the tier cards already carry the same information on mobile, where a five-column table is unusable
- `FaqList` gained an `offset` prop so a page can render a specific slice of the FAQ set
- `/packages` added to the sitemap

## [1.2.19] — 2026-07-26

### Changed
- **Carousel photos are now tappable.** Side cards were `pointer-events: none`, so only the centre image responded. Tapping a side photo now brings it to centre; tapping the centre photo opens its product page (with an `aria-label` and pointer cursor so it reads as interactive). Position dots became real buttons that jump straight to a product, instead of decoration
- **Paired CTAs render at equal width** (`components/ui/button-group.tsx`). `min-w-[180px]` was only a floor, so "Get a free live audit" and "See packages" came out different sizes. `ButtonGroup` lays them out in equal-fraction columns — every button matches the widest in the group. Applied to hero, closing CTA, and the packages section
- **Floating buttons aligned.** The back-to-top button was 44px and the WhatsApp button 48px at the same right offset, so their centres didn't line up; back-to-top is now 48px and both share the same right offset at every breakpoint, with the WhatsApp button exactly one button + 12px gap above
- **Homepage FAQ shortened to 5 questions** with a "See all questions" link to `/faq`. With the six new cost FAQs the list had grown to 12 accordions — a long scroll on a phone for a section near the bottom of the page. `/faq` still shows all 12; `FaqList` takes an optional `limit`
- FAQ accordions now start fully collapsed (the first item was open by default), so the section occupies less of a mobile screen on arrival
- **Homepage testimonials trimmed to 3** of 7, for the same reason

## [1.2.18] — 2026-07-26

### Fixed — credibility (highest priority)
- **Homepage no longer renders "0+ / 0 / 0x".** The About counters animated up from 0 toward placeholder targets (500+ sessions, 12 hosts, 3x GMV) that were never real; on the live site they displayed as zeroes, reading as "an agency with zero experience". `STATISTICS` is now an empty array and `About` falls back to `TRUST_SIGNALS` — SSM registration (202603168673 / JM1046169-H), brand owners via ELFIA, Johor Bahru based team, BM/English hosts. All true on day one, no numbers invented. When real figures exist, repopulate `STATISTICS` and the counters return automatically

### Added
- **Packages published** (`PACKAGES` in `constants/content.ts`, `components/home/packages.tsx`): Starter / Growth / Scale / Enterprise, each with cadence plus hours, live host, reporting, creative, and consultation lines. Shown on the homepage and `/services`. No prices — quotes stay per brand, but visitors can now see scope. ⚠️ Session counts and inclusions are a first draft and need confirming against the real package sheet before launch
- **Floating WhatsApp button** (`components/ui/whatsapp-fab.tsx`), mounted site-wide. Stacks above the back-to-top button and hides over the footer where contact links already exist
- **Six cost/logistics FAQs**: how much, session length and time to results, using your own host, studio, on-site sessions, and whether sales are guaranteed (answered honestly — no guarantee, with what is committed instead)

### Changed
- **Stronger CTAs.** Hero: "Book free consultation" → "Get a free live audit", secondary now "See packages" (anchors to the new section). Closing CTA: single button → "Get a free live audit" + "Book a strategy call", plus an inline "WhatsApp us now" link. `CTA_LABEL` still drives the navbar button

## [1.2.17] — 2026-07-25
### Fixed
- **Carousel autoplay never ran on phones.** The v1.2.16 pause logic was written for desktop input and left the carousel permanently paused on touch devices. Four separate causes:
  1. `touchcancel` was not handled — when the browser converts a touch that starts on the carousel into a page scroll (very common, since the carousel is full-width on mobile) it fires `touchcancel`, not `touchend`, so the pause set in `touchstart` was never cleared
  2. `onMouseEnter` fired from the emulated mouse events touch devices send on tap, while `onMouseLeave` frequently never fired — one tap paused playback for good. Hover pause now applies only to `pointerType === "mouse"`
  3. `onFocusCapture` paused on any focus; Android Chrome focuses the arrow buttons on tap and keeps that focus, so tapping an arrow stopped autoplay permanently. Focus pause now requires `:focus-visible` (keyboard focus), wrapped in a try/catch for browsers without support
  4. Touch pause used the same `paused` flag as hover, so a stuck value from any of the above could not be recovered — swiping now has its own `swiping` state
- Added a 6s watchdog: if paused/swiping somehow persists with no further interaction, playback resumes anyway, so no future event bug can freeze the carousel indefinitely

## [1.2.16] — 2026-07-25
### Added
- **ELFIA carousel autoplay** — advances every 3.5s by default (`autoPlay` / `interval` props on `ElfiaGallery`). Manual arrows, dots, swipe, and keyboard all still work exactly as before and reset the timer on use. Autoplay pauses on hover, on keyboard focus, while swiping, when the browser tab is hidden, and when the carousel is scrolled off screen; it is disabled entirely for `prefers-reduced-motion`. The screen-reader live region switches to `off` during autoplay so it doesn't announce a new product every 3.5s
### Changed
- **Service icons redesigned** for a consistent professional set: 24px grid, 1.5px stroke, round caps, optically centred, geometric — nothing glyph- or emoji-like
  - **TikTok strategy** icon replaced: the target-plus-diagonal-arrow read as a ♂ symbol; it is now concentric rings with a solid centre dot (positioning/targeting, fully symmetric)
  - **Business consultation** changed from a briefcase-with-trend-line to a conversation bubble — the trend line duplicated the bars in the Live commerce management icon
  - Microphone, dashboard, pen nib, and clapperboard redrawn on the same grid with matched proportions
- Icon chips refined to `rounded-xl` at 48px with 22px icons on both the home services section and `/services`, tuned for the lighter 1.5px stroke

## [1.2.15] — 2026-07-25
### Fixed (mobile)
- **iOS input zoom**: contact form fields were `text-sm` (14px); Safari auto-zooms the whole page on focus below 16px. Now `text-base` on mobile, `sm:text-sm` on desktop
- **Footer email overflow**: `admin@azoneofficial.com` (~150px) did not fit the 2-column footer grid on 320–390px screens. Column gap reduced to `gap-6` on mobile, `min-w-0` added, and the address now wraps via `[overflow-wrap:anywhere]`
- **Mobile menu could exceed the viewport** with no way to reach the last items — now `max-h-[calc(100svh-4rem)] overflow-y-auto`
- **ELFIA gallery caption clipped** between ~430px and the `sm` breakpoint (card grew to 400px inside a 420px stage). Stage is now `h-[440px] sm:h-[500px]` and the mobile card caps at `max-w-[260px]`; verified to fit at 320/390/430/600/640/768px
- **Vertical scrolling while swiping the gallery** — added `touch-pan-y` so a vertical drag scrolls the page instead of being captured by the carousel
- **Buttons sat ~16px from overflowing at 320px** — mobile padding reduced to `px-6` (`sm:px-8` unchanged)
- **Back-to-top button** now respects the iOS home indicator via `bottom-[max(1.25rem,env(safe-area-inset-bottom))]`
### Added
- Explicit `viewport` export in `app/layout.tsx`: `viewport-fit=cover` (notched phones) and `theme-color: #1a2946`, so the browser chrome matches the brand on Android/iOS
- `overflow-x: hidden` on `body` as a safety net against stray horizontal scroll (no sticky positioning in use, so no side effects)

## [1.2.14] — 2026-07-25
### Added
- **Back-to-top button** (`components/ui/scroll-to-top.tsx`, mounted site-wide in `app/layout.tsx`) — fades in after ~500px of scroll, hides while the footer is on screen so it never covers footer links, and reappears once the footer scrolls out of view. Footer detection via IntersectionObserver on `#site-footer`; smooth scroll respects `prefers-reduced-motion`; removed from the tab order while hidden
### Changed
- **FAQ**: the accordion was capped at `max-w-3xl` inside the 6xl frame, leaving a large dead area on the right. It now spans the full container width on both the home section and `/faq`; answer text stays capped at `max-w-3xl` for readability
- **Footer spacing tightened**: `py-16` → `py-12`, column gap `12` → `8/10`, CTA `mt-6` → `mt-5`, bottom bar `mt-12` → `mt-10`
- **Footer layout rebalanced**: the brand block and link columns used `md:justify-between`, which pushed them to opposite edges and left a dead centre gap. Now an even 4-column grid (brand spans 2, Explore + Follow us span 2)
- Footer legal links wrap gracefully (`flex-wrap`) instead of overflowing on narrow screens

## [1.2.13] — 2026-07-25
### Changed
- **Page width standardised across the site.** `PageShell` rebuilt on the `/products` frame — `main pt-16` → `mx-auto max-w-6xl px-6 py-16 sm:py-24` → header → content. Every inner page now shares one width and vertical rhythm: /about, /services, /portfolio, /products, /blog (+ posts), /faq, /contact, /careers, /case-studies, /privacy, /terms (was `max-w-3xl` with different top padding)
- Running text is capped at `max-w-3xl` inside the wide frame, so line length stays readable — wide frame, readable measure
- `PageShell` gained `intro` (lead paragraph under the h1) and `dark` (navy background) props; header markup is now identical on every page
- **/faq** rebuilt on `PageShell` — it previously had no page header at all and reused the home section, which double-padded the layout. Accordion extracted to `components/ui/faq-list.tsx` and shared by the home section and the page, so both render identical markup
- **/services**: lead line promoted to `intro`; service cards now a 2-column grid in the wider frame
- **/blog**: post cards now a 2-column grid with equal-height cards; `intro` added
- **/portfolio**: `intro` added
- **/contact**: message form and location map now sit side by side on large screens instead of stacking
- Icon chips standardised to navy + gold (`bg-brand text-gold`) on /services and /about, matching the home services section (were `bg-gold-soft` + black icons)
### Note
- `/products` keeps its bespoke ELFIA header typography; its frame values already match `PageShell` exactly, so the two stay visually in sync

## [1.2.12] — 2026-07-25
### Changed
- `public/og.png` rebuilt from the master OG artwork at exactly 1200×630, alpha flattened onto the cream background (transparency can render as black in some scrapers), no horizontal stretching — 37px of empty cream trimmed from the top so the gold/navy curves stay fully intact
### Diagnosis note
- The small-thumbnail WhatsApp preview was NOT a broken og.png: the live site still runs pre-1.2.9 metadata, which declares both `og.png` and `og-square.png`, and WhatsApp was picking the square — rendering it as a cropped small-thumbnail card. The landscape-only fix from [1.2.9] resolves it and takes effect on deploy.

## [1.2.11] — 2026-07-25
### Changed
- ELFIA product names updated in `constants/content.ts`:
  - "The Signature Shawl — Taupe" → **"The Signature Shawl — Mocha"** (slug `signature-shawl-taupe` → `signature-shawl-mocha`)
  - "The Signature Shawl — Grey" → **"The Signature Shawl — Soft Grey"** (slug `signature-shawl-grey` → `signature-shawl-soft-grey`)
  - "Corporate Series — Blush" → **"Corporate Series — Khaki"** (slug `corporate-blush` → `corporate-khaki`)
  - "The Signature Shawl — Beige" unchanged; Active Hijab and Neutral Collection unchanged
- Alt text and product descriptions reworded to match the new colour names; The Neutral Collection copy now reads "black, mocha, beige, and soft grey"
### Added
- `public/_redirects` — 301s from the three old product URLs to the new slugs, so any link already shared keeps working
### Note
- Image filenames in `/public/elfia/` unchanged (`shawl-taupe.jpg`, `corporate.jpg`, …) — internal references only, not visible to visitors. Swap the photos if the new colours are different fabric, not a rename.

## [1.2.10] — 2026-07-25
### Changed
- Hero: "We sell live" pill badge replaced with the transparent company logo (`/logo.png`, no pill background, h-16/h-20 responsive) — hero now opens logo → "LIVE . CONNECT . GROW." eyebrow → headline, mirroring the OG banner layout. Logo has no tagline baked in, so the eyebrow is kept (no duplication)

## [1.2.9] — 2026-07-25
### Fixed
- WhatsApp link preview inconsistency: openGraph now declares only the landscape `og.png` (1200×630). With both landscape and square variants listed, WhatsApp sometimes picked `og-square.png` and rendered the compact small-thumbnail layout instead of the large banner card. `og-square.png` stays in `/public` (unreferenced) in case it's wanted later.
### Note
- WhatsApp caches previews per exact URL (with/without trailing slash are separate entries) for up to ~30 days — after deploy, re-scrape via Facebook Sharing Debugger and/or share the link once with `?v=2` to force a fresh fetch

## [1.2.8] — 2026-07-25
### Deployed
- azoneofficial.com live — v0.1 under-construction page retired
### Changed
- `/products`: grid replaced by the coverflow gallery; "Explore the range" link list added beneath it (all six detail pages remain one tap away); "Where to buy" CTAs migrated to shared Button

## [1.2.7] — 2026-07-25
### Changed
- Sales document numbering: new format `{TYPE}{YYYYMMDD}-{NN}-AZOO` (e.g. `DO20260725-01-AZOO`) — date-readable, daily sequence (KL time), issuer code. Legacy numbers (`QT202600001`) remain valid, never renumbered. Spec: `DOCUMENT-NUMBERING.md`
### Added
- Migration `0005_doc_numbering_daily.sql` — `doc_counters_daily` table; old `doc_counters` kept untouched
- `DOCUMENT-NUMBERING.md` — format spec, rationale, migration rules, future doc types (OR/CN/PO)
- `FEATURE-SUGGESTIONS.md` — 15 candidate features with sequencing (Live Session module, host commission, ELFIA live-stock, MyInvois e-Invoice readiness, SST, payments/OR, CN, WhatsApp enquiry alerts, D1 backup, 2FA, more)
### Policy
- Docs are append-only for history: version entries are never removed

## [1.2.6] — 2026-07-25
### Changed
- ELFIA gallery: grid replaced by coverflow carousel (`components/ui/elfia-gallery.tsx`) on the home ELFIA section — centre card full size and linked to its detail page, neighbours peek behind, infinite wrap, touch-swipe + keyboard + aria-live, motion-reduce respected, zero dependencies
- Service icons: all six cards now use one professional icon family (`components/ui/service-icons.tsx`, 1.6px stroke, 24px grid) on navy chips with gold strokes (was mixed lucide icons on gold-soft chips)
- Buttons standardised via `components/ui/button.tsx` (h-12, rounded-lg, min-w-[180px] on ≥sm, full-width stacked on mobile) — migrated hero, home CTA, ELFIA, /products, product detail, and contact page (which was drifting with rounded-full)
### Added
- `REVIEW.md` — improvement suggestions for client site, staff portal, customer area, with priority order

## [1.2.5] — 2026-07-24
### Added
- Official brand tagline "Live . Connect . Grow." — in constants/site.ts as SITE_CONFIG.brandTagline, displayed as gold uppercase eyebrow above the hero headline and beneath the footer logo; used in OG image alt text
- OG share images replaced with the official corporate design (cream + navy + gold curves) — landscape 1200×630 (public/og.png) and square 1080×1080 for WhatsApp (public/og-square.png)
### Note
- The descriptive tagline "Malaysia's Premium Live Commerce Agency" remains as the primary SEO/meta description; the brand tagline is used for identity moments (hero eyebrow, footer, share preview)

## [1.2.4] — 2026-07-24
### Changed
- /login: mode switcher moved to a persistent top-of-form Sign in / Create account tab pair (was a text link buried under the submit button). Both modes visible from arrival — clearer wayfinding, no more "New here?" line

## [1.2.3] — 2026-07-24
### Added
- `public/og.png` (1200×630) redesigned — logo enlarged, cleaner corporate layout, navy tagline, gold accent band
- `public/og-square.png` (1080×1080) new — square variant for WhatsApp centre-crop on mobile chat lists
- `MILESTONES.md` — comprehensive milestone log recording every version, asset, and decision from inception
- After deploy: use Facebook Sharing Debugger or WhatsApp's link cache reset (add ?v=2 once) to force social platforms to re-fetch

## [1.2.2] — 2026-07-24
### Changed
- Configuration discipline: no credentials or IDs in source. `wrangler.toml` now lists only variable names with instructions; all values (including GOOGLE_CLIENT_ID as a plaintext variable) live in the Cloudflare dashboard or as secrets. Added `.dev.vars.example` for local dev; `.dev.vars` is git-ignored.

## [1.2.1] — 2026-07-24
### Fixed
- Login/register error handling: 400s now show the API's real reason (was hidden as a misleading "password needs 10+ characters" for every failure); network/route-missing errors now say so plainly, so users can tell "not deployed yet" apart from "check your input"
- Password minimum harmonised to 10 characters everywhere (setup was inconsistently 12)
### Added
- Show/hide password eye toggle on login/register + live character counter with progress feedback (X of 10 — Y more needed) when registering
- Live length feedback on the admin Create User form

## [1.2.0] — 2026-07-24 — Security audit & hardening
### Added
- One-time super admin bootstrap: POST /auth/setup guarded by SETUP_TOKEN secret + timing-safe compare; self-disables once a super admin exists (no hardcoded credentials anywhere)
- Static security headers (public/_headers): nosniff, X-Frame-Options DENY, strict referrer, permissions policy
### Security
- Sessions stored as SHA-256 hashes (leak-resistant) with opportunistic expiry purge
- /account/enquiries: unverified accounts limited to post-registration enquiries (email-squatting history leak closed)
- R2 `private/` prefix requires staff auth
Full audit report in SECURITY.md.

## [1.1.1] — 2026-07-24
### Changed
- Official social handles confirmed and applied site-wide: TikTok/Instagram/Facebook → @azoneofficialhq (footer, contact page, ELFIA "Watch the next drop live" buttons)

## [1.1.0] — 2026-07-24 — General login & role-routed access
### Added
- General /login (one door for everyone) with role-based routing after sign-in: customer → /account, staff-only roles → /portal, CMS roles → /admin; Google callback routes the same way
- Customer role (migration 0004) + /account page: own details and enquiry history (matched by email); GET /api/v1/account/enquiries
- Public registration now creates an ACTIVE customer account and signs the person in immediately (safe: customers see only their own data; staff/admin roles are assigned only by super admins)
### Changed
- Navbar/footer point to /login; /admin and /portal redirect unauthenticated visitors to /login and customers to /account; customers blocked from all /staff API routes
### Removed
- Pending-approval registration flow (replaced by customer accounts); embedded login screen inside /admin

## [1.0.0] — 2026-07-24 — Staff Portal (BMS) v1
### Added
- Migration 0003: full BMS schema — expanded 10-role users (+staff profile fields), attendance, leave (+balances), announcements (+acks), tasks (+comments), customers, sales_documents with per-year auto numbering (QT/DO/INV 202600001), notifications
- Staff API (`/api/v1/staff/*`, worker/src/staff.ts) with module-level RBAC: profile, staff directory (HR), attendance clock in/out/break (IP+device captured) + monthly history + team report, leave apply/cancel/approve/reject with notifications and balance tracking, announcements + acknowledgements, tasks assign/progress/comments, CRM customers, QT/DO/INV creation with auto numbering + delivery/payment status, in-app notifications
- Staff Portal UI at /portal (noindexed, robots-blocked): personalized dashboard (quick actions clock in/out, pending leave, tasks, announcements), Attendance, Leave (balances, apply, approvals), Tasks, Announcements, Sales (customers + document builder with live RM total), Profile; notification bell; light/dark mode
### Security
- New roles ranked into existing CMS RBAC (live_host lowest — no CMS/finance/admin access); all staff routes require auth; every mutating action audited

## [0.9.0] — 2026-07-24
### Added
- No-code content editing is live end-to-end: public `/content-public` endpoint (60s cache) + `<Editable>` component; hero headline/subheadline, About paragraphs, CTA heading, footer slogan, and Contact intro now read D1 overrides with static fallback
- Visitor analytics: Cloudflare Web Analytics beacon, token-gated in `constants/site.ts` (inert until token set)

## [0.8.0] — 2026-07-24
### Changed — UI/UX redesign pass (premium corporate principles)
- WCAG 2.1 AA contrast: new deep-gold token (#7D6027, 5.0:1) for accent text on light backgrounds; footer text raised from 40% to 60% white; navy focus-visible outlines site-wide
- Consistent radius system: pill buttons replaced with 8px-radius buttons; cards on the same scale; only true dots remain circular
- 8px spacing grid: all section/page paddings normalized to multiples of 8
- Subtle shadows only (shadow-sm on hover)
- Every page ends with a clear next step: About and FAQ pages gained consultation CTAs

## [0.7.0] — 2026-07-24
### Added
- Google OAuth sign-in for /admin (state-cookie CSRF protection, verified-email requirement); company-domain Google accounts auto-activate
- Self-registration on /admin (rate-limited): any valid email, created pending until super-admin approval
- Login screen: Continue with Google, register mode, pending/oauth notices
### Changed
- Contact email: hello@ → admin@azoneofficial.com

## [0.6.0] — 2026-07-24
### Added
- User management: API (super_admin only — create, role change, activate/deactivate with session revocation, password reset) + admin Users tab
- Admin Media tab: upload to R2, image previews, copy-URL, delete
- Admin Content tab: key-value site content editor (dot-notation keys, JSON or text values)
- Dashboard: posts/testimonials counts + recent-activity feed from audit log
- ELFIA individual product pages (/products/[slug]) with descriptions, galleries (grey shawl: 4 angles), "price announced live" panel, cross-links; added to sitemap
- Public D1 reads: /portfolio and homepage testimonials render published D1 items at runtime with graceful static fallback
### Changed
- Product cards on homepage and /products now link to detail pages

## [0.5.0] — 2026-07-24
### Added
- Rate limiting (D1 fixed-window): login 10/15min, enquiries 5/hour per IP (migration 0002)
- Full CRUD API: products, posts, portfolio, testimonials (editor+ write, admin+ delete, public reads filtered to published/visible)
- Site content API: GET public, PUT editor+ (upsert with audit)
- Media API: R2 upload (editor+), public cached serving, delete
- Contact form on /contact posting to /api/v1/enquiries with WhatsApp fallback on failure
- Admin UI at /admin (noindexed): login, dashboard, enquiry management with status workflow, CRUD panels for products/posts/portfolio/testimonials
### Security
- /admin disallowed in robots.txt and noindexed; all admin API writes audited

## [0.4.0] — 2026-07-24
### Added
- ELFIA product photos (9, web-optimized) wired into homepage + /products; brand copy corrected to premium chiffon hijabs/shawls
- Phase 3 architecture DECIDED: static site + separate admin/API Worker (`/worker`)
- Worker scaffold: wrangler.toml with real D1/R2 bindings, migration 0001 (full schema), API v0 — auth (PBKDF2 sessions), public enquiries endpoint, enquiry management, dashboard summary, audit logging
### Security
- PBKDF2-SHA256 310k iterations + pepper (argon2 deviation documented in SECURITY.md); origin checks on mutations; HttpOnly/Secure/SameSite cookies

## [0.3.0] — 2026-07-24
### Added
- Full public website (Phase 2): `/about`, `/services`, `/portfolio`, `/case-studies`, `/products` (ELFIA), `/blog` (+2 starter posts), `/careers`, `/faq`, `/contact`, `/privacy`, `/terms`
- SEO: sitemap.xml, robots.txt, JSON-LD Organization schema, Open Graph + Twitter card images
- Brand assets: OG share image (`public/og.png`), favicon/app icon
- Mandatory documentation set (this file and 11 siblings)
### Changed
- Navigation switched from homepage anchors to dedicated pages
- Footer: legal links, Case Studies, Careers added

## [0.2.0] — 2026-07-24
### Added
- Full landing page: Hero, About + stats, Services, Showcase, ELFIA, Process, FAQ, CTA, Navbar, Footer
- Real contact data from Master Project Prompt: WhatsApp +60 12-383 4821, official slogan, Setia Tropika address
- Services aligned to master list (6 services)
### Changed
- Hero copy per master prompt ("Grow your sales through live commerce")

## [0.1.0] — baseline
- Next.js 15 scaffold with design tokens, coming-soon page, Cloudflare static deploy
