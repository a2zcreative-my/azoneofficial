# Threads workspace for the A2Z portal — implementation plan

Prepared 04-09-2026 for Alīf, CEO, A2Z Creative Marketing. Plan only; nothing has been built.

> **Status, 05-09-2026 (v1.99.0).** Phase 1 (connect + import the account's own posts) shipped on 04-09 and was **withdrawn on 05-09** by the CEO's decision: *"remove library since this is not supposed to view by my staff. the objective for this Threads to make them to find a study case based on the market research and the demand based on the keywords that they want."* The Threads tab is now a **study room** — saved topics, the public posts a keyword search finds for each, and what they add up to (Malaysian or not, asking or selling, how the niche writes) — kept for **seven days** and capped (400 posts per topic, 40 topics). The own-account tables were dropped (migration 0110). Phases 2–5 below (drafting, publishing, autopilot, AI on the account's own history) are **shelved**, not scheduled; they are kept here as the record of what was considered.

## 1. What the video shows

The video is a product walkthrough of **LazyThreads** by @remisiersyazwan — a single-purpose "content operating system" for one social network, Threads (Meta). Every screen is built on the same two ingredients: the account's own post history and metrics pulled from the Threads API, and a layer of rules on top that turns those numbers into advice. The screens, in the order the video shows them:

**Home** — a greeting, a 30-day brief (followers +3.7K, views 2.1M, avg views/post, engagement, followers gained per post, posts published) with a short "why" list under it ("longer posts earned ~2× the median replies", "posts with media earned ~1.9×", "you published more consistently — 361 vs 113"). Beneath that, three "Today we recommend" cards each with a **Do it** button (recycle your top post, lean into longer posts, publish around 1–3 PM), an **Autopilot** toggle (paused, draft mode), today's timeline of published and scheduled posts by time, a recent-activity feed (including a failed sync), and a views-by-post chart.

**Calendar** — day / week / month / queue views with status chips (Scheduled, Published, Failed, Draft, Needs review, Approved) and format filters (Thread, Story, Educational, Community…). Cards carry a Manual / Studio badge for how they were written.

**Content library** — every draft and every imported historical post in one list, with counts as tabs: Drafts 17, Scheduled 33, Published via LazyThreads 124, Imported history 9,604, Recyclable winners 12, Archived 0. Each published card shows views and a "17.7× above baseline" pill, plus Duplicate into draft / Open analytics / Threads↗.

**Analytics** — sub-tabs Overview, Content, Patterns, Topic identity, Keywords, Winners, Compare, Peers, Creator DNA, Recommendations, Outcomes. The Content view sorts posts by views with a baseline multiplier, language and intent tags (Decision / Awareness, English / Malay), and a **"Why this worked"** panel per post with a confidence percentage and checked traits: strong specific-number hook, visual likely raised the stop rate, clear call to action, emotional angle, concise single-idea length, text-only.

**Composer** — a writing form with Goal (Awareness — reach), Writing for (General audience), Language (Bahasa Melayu), a "Use my account analytics as context" checkbox, a tracked link with campaign name that produces a short URL, post numbering, and a row of hook chips: FOMO, Social Proof, Bold Statement, Problem–Solution, Transformation, Relatable Struggle, Controversy Spike, Result First, Negative/Reverse. The AI drafts from those choices; the output is a long Malay post.

**Circle** — a bubble map of the 239 people the account interacted with, clustered into 14 communities, each group summarised by the posts it gathers around.

Also present: an Activity log, a Knowledge page, Settings, and a MY / EN language toggle — the same bilingual pattern the portal already uses.

## 2. Verdict — what is worth taking, and what is not

The valuable core is small and mostly *not* AI: pull your own Threads history and metrics into a place you control, know your baseline, see which posts beat it and by how much, publish on a schedule from one calendar, and get the three or four rules that actually move numbers (best hour, media vs text, length, consistency). That is deterministic, explainable, bilingual by construction, and it fits the portal's existing shape almost exactly — the Content tab already has a pipeline (idea → script → shoot → edit → approval → posted), the TikTok Shop integration already stores and refreshes provider tokens in `integration_tokens`, a 5-minute cron already runs, and the `sales-by-hour-card` is literally "views by hour" with a different data source.

The parts I would not copy, or would defer:

The **Circle** map stores the usernames of every person who replied to you, then clusters them. It is the one screen that tracks other people. It is not the store's OD-20a case (that is anonymous shopper browsing), but the same instinct applies: the portal has so far never kept a per-person record of an outsider's behaviour, and this would be the first. I would leave it out of scope until you decide you want it, and if you do, keep it to counts per community with a short retention window.

The **AI writer** with hook chips is the easiest part to build and the part most likely to disappoint: it needs an LLM binding (a new secret, a new cost line, a new failure mode) and its quality is entirely the model's. I would build it last, as an optional layer over a composer that already works by hand, and I would make "use my analytics as context" mean feeding it the deterministic findings from phase 3 — not a black box.

The **"Why this worked" confidence** in the video is almost certainly an LLM's opinion dressed as a statistic. Ours should be honest arithmetic: a trait gets a tick when the post has it, and the confidence is the share of your own top-decile posts that share the trait. Then the number means something and it can be BM-translated without a model.

**Autopilot** should never post unattended in its first version. The video itself ships it "paused, draft mode". Ours would queue recycled winners into Drafts with a "Needs review" chip and let you approve — every mutation reports (guard #25), and an unattended post to a public account is the mutation you would least want silent.

## 3. Platform facts that shape the design

These are from the current Threads API documentation as summarised by third-party guides (sources at the end); verify against developers.facebook.com/docs/threads before phase 0.

Publishing is a two-step flow — create a media container at `POST /{threads-user-id}/threads`, then `POST /{threads-user-id}/threads_publish` — except that text-only posts up to 500 characters can be published in one call with `auto_publish_text`. Images and video must be given as **public URLs** that Meta fetches; that decides where media lives (section 6, decision C). Carousels are 2–20 items. There is **no native scheduling** — every scheduler, including LazyThreads, runs its own timer and publishes when the moment arrives. Our 5-minute cron is that timer.

Insights come from `/{media-id}/insights` per post (views, likes, replies, reposts, quotes, shares) and `/{threads-user-id}/threads_insights` per account (views, followers count, demographics). History is paged from `/{threads-user-id}/threads`; a 9,000-post import is a few hundred paged calls plus one insights call per post, comfortably inside the call budget (48,000 per 24 h minimum, scaling with impressions). Publishing caps are 250 posts and 1,000 replies per rolling 24 hours.

Tokens: the short-lived token lasts one hour and is exchanged for a **long-lived token of 60 days**, refreshable only between day 24 and day 60. Miss the window and you must re-connect by hand. The cron must own this refresh, exactly as it owns the 7-day TikTok Shop refresh today.

Scopes needed: `threads_basic`, `threads_content_publish`, `threads_manage_insights`; `threads_read_replies` and `threads_manage_replies` only if you later want reply counts per person or the Circle. Each scope needs Meta App Review **only for a public app**. For your own accounts, the app stays in development mode and each account is added as a Threads Tester in the app dashboard — no review, no business verification, no screencasts. This is the single biggest simplifier: A2Z and ELFIA accounts you own can connect on day one.

## 4. Where it lives in the portal

Recommendation: **inside the Content tab, as a section chooser** — the pattern the attendance card uses (Find / Add / Unpaid / Hours). The chooser would read Compose · Calendar · Library · Insights · Connection. The existing TikTok/Reels/Live pipeline stays as the first section, untouched. No new tab means no change to `ALL_TABS`, `TAB_ROLES`, the worker's access list, nav icons or the 🔐 card, and no change to anyone's phone bottom bar (tab order is the product — v1.22.0).

If it grows into something you open daily, promoting it to a `Threads` tab later is one entry in `lib/portal-tabs.ts` plus the worker list, and the parity guard will hold your hand. I would not start there.

Roles: default `marketing`, `sales_marketing`, `editor`, `cco`, `ceo`, `coo`, admin. Connecting an account and approving Autopilot drafts: CEO/COO/admin only (an account connection is a credential).

## 5. Phases

Each phase is one version, shipped and deployed before the next starts, each with its own migration, routes, UI, guard checks and CHANGELOG entry. Numbers assume v1.88.2 is current.

### Phase 0 — access (no code, you do this)

Create a Meta app of type Business at developers.facebook.com, add the Threads use case, and note the app ID and secret. **Do not paste either into chat.** Add each Threads account you want managed as a Threads Tester, and accept the invitation from the Threads app on the phone. Set the OAuth redirect URI to the API worker's callback path. Then set two Wrangler secrets on `azoneofficial-api`: `THREADS_APP_ID` and `THREADS_APP_SECRET`, via `wrangler secret put` in your terminal, the same way the TikTok pair is held.

One brand-guard note: the callback URL and the portal's return URL must be derived at runtime from the request origin and env, never written as literals into committed files.

### Phase 1 — connect and import (v1.89.0)

**Migration 0105_threads.sql** (plain ASCII, `--` comments, no `'` or `;` inside comments):

`threads_accounts` — id, threads_user_id (unique), username, display_label (e.g. "A2Z" / "ELFIA"), connected_by, connected_at, token_expires_at, last_sync_at, sync_error, is_active. The token itself goes into the existing `integration_tokens` table under `provider = 'threads:<threads_user_id>'`, so the refresh cron already has one place to look.

`threads_posts` — id, account_id, media_id (unique), text, media_type (TEXT / IMAGE / VIDEO / CAROUSEL), permalink, published_at, is_reply, root_media_id, source ('imported' / 'portal'), status ('published' for imports; drafts arrive in phase 2), content_item_id nullable (links a post back to a pipeline item when it came from one), language_guess, char_count, has_number_hook, has_question_hook, has_cta — the trait columns are computed at import time by plain rules so the analytics phase is pure SQL.

`threads_post_metrics` — post_id, captured_on, views, likes, replies, reposts, quotes, shares; primary key (post_id, captured_on). Daily snapshots, never overwritten, so "views at day 1 / day 7 / day 30" is answerable later.

`threads_account_metrics` — account_id, captured_on, followers, views; primary key (account_id, captured_on).

Triple bump: `LATEST_MIGRATION = "0105_threads"`, `EXPECTED_MIGRATIONS`, and the health probe checks `threads_posts` exists (this one is not data-only).

**Worker routes** (all under the staff dispatch except the callback):
`GET /staff/threads/connect` → returns the Meta authorization URL with a signed state; `GET /threads/callback` (public) → verifies state, exchanges code for short-lived then long-lived token, upserts the account, redirects to the portal origin from env; `POST /staff/threads/:id/sync` → paged import of history plus per-post insights, idempotent on media_id, audited as `threads.sync`; `GET /staff/threads/posts?account=&from=&to=&status=&q=` → the one list the table and the CSV both read (house rule: one definition of "rows on screen"); `GET /staff/threads/summary?account=&days=30` → the Home brief numbers; `POST /staff/threads/:id/disconnect`.

**Cron additions** to the existing `scheduled()`: every 6 hours, refresh any Threads token older than 24 days; once nightly (Malaysia time), snapshot account metrics and insights for posts published in the last 30 days (older posts change slowly; a full re-snapshot weekly). Failures go to `error_log` with the account label, mirroring `tiktok_token_refresh`.

**UI**: a `ThreadsConnectionCard` modelled on `connection-status-card.tsx` — account chips, last sync, token expiry with an amber state at day 50, Sync now. A `ThreadsLibrary` list — the same `StatTile` row the video uses as tabs (Imported · Published · Scheduled · Drafts · Winners), every tile a filter (`aria-pressed`, guard #31), a month filter, search, and a CSV export. The 30-day brief as a compact tile row on the Content tab header. Skeletons, not "Loading…" (guard #28). `L(en, ms)` throughout.

**Guards**: new `tests/threads-guard.mjs` asserting properties, not implementation — the connect route never returns a token to the client; the callback reads the app secret only from env; every publish/sync/disconnect route calls `audit`; the token lives in `integration_tokens` and nowhere in a `SELECT` that the `/posts` route returns; the library's CSV and table share one query. Extend `bm-coverage.mjs` to the new files. Each check negative-tested before it counts.

### Phase 2 — compose, calendar, publish (v1.90.0)

**Migration 0106_threads_publish.sql**: on `threads_posts` add scheduled_at, published_by, publish_attempts, last_error, approved_by, approved_at; status gains 'draft' / 'needs_review' / 'scheduled' / 'publishing' / 'failed'. A `threads_media` table for attached images (post_id, r2_key, position, public_url).

**Worker**: `POST /staff/threads/posts` (create draft), `PUT /staff/threads/posts/:id`, `POST /staff/threads/posts/:id/schedule`, `POST /staff/threads/posts/:id/publish-now`, `DELETE` for drafts only (a published post is deleted on Threads, not here — deletion is capped at 100/day and is a separate decision). The 5-minute cron picks rows with `status = 'scheduled' AND scheduled_at <= now` under a claim UPDATE (so two cron runs cannot double-post), publishes — one call for short text, container-then-publish for media — writes media_id and permalink back, and on failure increments attempts, records `last_error`, retries at 5, 15, 45 minutes and then parks the row as failed with an error_log entry. Every publish is audited `threads.publish` with the actor (a scheduled post carries the scheduler as actor, the cron as source).

**UI**: the composer, as a plain card first — account, text with a 500-character live count, optional images from R2, scheduled date and time (Malaysia time, stored UTC), Save draft / Schedule / Publish now, each reporting through the toast (guard #25). The calendar reuses `mini-calendar` / `roster-board` pieces: month grid with count dots, a day column with time slots, status chips Scheduled / Published / Failed / Draft, and a Queue view that is simply the library filtered to scheduled and sorted by time. A failed post shows its reason in place, not in a log page.

### Phase 3 — insights that explain themselves (v1.91.0)

No migration if phase 1's trait columns and daily snapshots are in place; otherwise a small data migration to backfill traits.

**Computation, all in the worker, all deterministic**: baseline = median views of the account's previous 30 published posts at the time each post is scored, so "17.7× above baseline" is reproducible. Winners = top decile by multiplier over the window. Best publishing hours = views by publish hour, the `sales-by-hour-card` shape. Format split = text vs media median views. Length buckets = under 120 / 120–300 / 300–500 characters. Consistency = posts per week vs prior window. Language split from `language_guess` (a short BM/EN word list is enough for tagging; nothing fancy).

**"Why this worked"**: a fixed list of traits — specific number in the first line, question in the first line, media attached, call to action present, under 300 characters, published in a best hour, thread (multi-post) — each ticked or crossed from the trait columns, with confidence = share of winners carrying the trait. Rendered as the same tick/cross list the video shows, bilingual by construction.

**"Today we recommend"**: at most three cards from a rule table (best hour drifted → "publish around X"; media multiplier > 1.5 → "add a visual"; a winner older than 30 days with no recycle → "recycle this post"), each with a Do it button that opens the composer pre-filled. The Do it button is the clickable-data rule applied to advice: the recommendation must open the thing it recommends.

**UI**: an Insights section with a tile row (Followers, Views, Avg views/post, Engagement, Posts) where each tile opens the posts behind it, the hour chart, the winners list with multiplier pills, and per-post "why" on expand. Compare (this month vs last) as one toggle, not a separate page. I would skip Topic identity, Keywords, Peers, Creator DNA and Outcomes entirely — they are the LLM-dependent screens, and they are what makes the video's app feel like eleven tabs.

### Phase 4 — assisted writing and Autopilot (v1.92.0, optional)

**Decision needed on the model** (section 6, D). With a Workers AI binding the worker calls a hosted open model with no key to rotate; with an external provider, one more Wrangler secret. Either way the prompt is assembled server-side from goal, audience, language, chosen hooks and the phase-3 findings for that account, and the draft is returned into the composer for editing — never published directly by the model. The hook chips are a static list; "Studio" vs "Manual" badge is stored on the post as `authored_by`.

**Autopilot**: a per-account setting (off / draft mode) that, once a week, takes the top unrecycled winner and creates a `needs_review` draft with a new angle line. Nothing leaves the portal without a person pressing Approve; approvals are audited.

### Phase 5 — tracked links and Circle (v1.93.0, only if you want them)

Tracked links: `POST /staff/threads/links` creates a code, `GET /l/:code` on the API worker redirects and counts — counts only, day-bucketed, with the same daily-rotating anonymous hash the store uses for visitor de-duplication (OD-20a spirit: no per-person record). The link's campaign label appears on the post card with its click count; a click count that opens the post is another clickable figure.

Circle: deferred by default, per section 2. If wanted: reply authors aggregated to community counts with a 90-day retention, `threads_read_replies` scope added, and a written note in the migration header recording the decision, as OD-20a is recorded.

## 6. Decisions I need from you before phase 1

A. **Section inside Content, or a new Threads tab?** I recommend the section; the tab is a one-line promotion later.

B. **Which accounts?** A2Z's, ELFIA's, your personal account, or all three. Each is a Threads Tester in the Meta app, and each shows as a chip so the brief, calendar and library are per account, with an "All" view.

C. **Where images live.** Threads fetches media from a public URL. Options: a public path on the portal's existing R2 bucket via the API worker (`GET /threads-media/:key`, no listing, keys unguessable), or upload to ELFIA's store CDN. I recommend the portal worker path, so the store never learns anything about the portal (brand-isolation stays clean) and the images are served under a domain you already own.

D. **AI provider for phase 4** — Workers AI binding (no secret, pay per token on the Cloudflare bill) or an external key (one more secret to hold and rotate). Or no AI at all for now; phases 1–3 do not need it.

E. **Circle** — in, out, or aggregate-only.

F. **Who may connect accounts and who may publish.** My default: CEO/COO/admin connect and approve; marketing, sales_marketing, editor, cco draft and schedule.

## 7. Effort and order

Phase 1 is the largest single step (OAuth, import, cron, three tables, the library) and the one that de-risks everything after it, because once your history and metrics are in D1 every later phase is reading your own database. Phase 2 is mostly UI plus one careful cron path. Phase 3 is the part that will feel like the video — and it is SQL over phase 1's tables. Phase 4 and 5 are optional and independent of each other.

I would also fold in the standing offer: make the DEPLOY .bat run the guard suite and website typecheck before publishing either API, since phase 2 introduces the first cron path that posts publicly.

## Sources

- [Threads API in 2026: Real Rate Limits + What You Can Build — SocialCrawl](https://www.socialcrawl.dev/blog/threads-api)
- [Threads API Pricing 2026: Free, but Rate-Limited — Blotato](https://www.blotato.com/blog/threads-api-pricing)
- [Threads API: Publishing Posts via the API (2026 Developer Guide)](https://social-api.ai/blog/threads-api-publishing-posts-developer-guide)
- [Threads API Guide: Everything Developers Need to Know (2026) — Replia](https://replia.net/blog/threads-api-guide)
