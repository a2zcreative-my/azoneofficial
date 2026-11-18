# Staff Chat (12-hour auto-delete): stage 0 audit

**Date:** 18-11-2026. **Status:** read-only audit, waiting for CEO approval. No code, migration or deploy.
**Brief:** "A2Z OS - Internal Staff Chat (12H auto-delete)" plus two reference pictures.

## 1. What exists today

| Area | Finding | Source |
|---|---|---|
| Chat | **None.** `threads.ts` is the Meta Threads (social media) integration, not messaging. | worker/src |
| Durable Objects | **None bound.** `wrangler.toml` has D1 `DB`, R2 `MEDIA`, R2 `BACKUPS`, six cron schedules, no `[[durable_objects]]`. | worker/wrangler.toml |
| Real-time | `GET /staff/notifications/stream` is an SSE stream that **queries D1 every 5 s** for each open portal tab and closes after 20 s (the browser reconnects). It carries the bell and the live-card versions. | staff.ts ~20600 |
| Notifications | `notify()` **writes the message text** into the D1 `notifications` table (the bell keeps 7 days), sends it as the **push body**, and relays it to `NOTIFY_WEBHOOK` if one is set. `pushToUser()` already skips leavers. | staff.ts 1909, 96 |
| Sign-in | `getSessionUser` (index.ts 1480): session cookie, then SHA-256, then `sessions` joined to `users`, `is_active = 1`, the 2FA flag and the custom role. Staff routes refuse `customer`; `agent` reaches only `AGENT_STAFF_PATHS`. | index.ts 1480, 5044-5049 |
| Who is staff today | `currentStaffSql()`: no past `left_on` and not resigned/terminated, or rejoined. **A leaver keeps `is_active = 1`** for the final payroll, so `is_active` alone is not enough for chat. | staff.ts 439 |
| R2 media | **Everything in `MEDIA` is copied to `BACKUPS/media/current/` within 30 minutes. A deleted object is kept under `deleted/<day>/` for 90 days** (`MEDIA_KEEP_DAYS = 90`). | backup-store.ts 130, 34 |
| D1 backups | Nightly paged export of every D1 table. D1 also keeps 30 days of Time Travel. | index.ts, release-backup |
| Service worker | Never caches `/api/*`. A push shows title and body. | public/sw.js |
| CSP | `connect-src 'self' https://static.cloudflareinsights.com`. A same-origin `wss://` is covered by `'self'` in current browsers; to be added explicitly for older Safari. | public/_headers |
| Header | `.erp-topbar` in portal-shell.tsx has search, the bell (badge, drop panel) and avatar. Phone bottom bar per role. | portal-shell.tsx 276-520 |
| Shared UI | `SideDrawer`, `LineTabs`/`PillSwitch`, `Avatar` + photo book, `useFeedback`, `FillPanel`. | components/ui |
| Plan | Six cron schedules are configured; the Workers Free plan allows five, so the account is **probably Workers Paid**. Owner to confirm on the billing page. Durable Objects with SQLite work on either plan. | wrangler.toml |

## 2. Two findings that decide the design

1. **Chat files must NOT go into the `MEDIA` bucket.** The 30-minute media backup would copy them to `BACKUPS` and keep them 90 days after deletion. That breaks the 12-hour rule. Chat files go in a **new private bucket `a2z-chat-temp`** that the backup never reads, with an R2 lifecycle rule "delete after 1 day" as a backstop.
2. **Chat must NOT use `notify()` or the `notifications` table.** Both would put message text into D1, which is kept 7 days in the bell, exported nightly and kept 30 days by Time Travel, and into the push body. Chat keeps its own unread counts and sends a **generic push** ("New message on A2Z Chat") with no text and no preview, and only when the person has no chat open.

## 3. Proposed architecture

```
Browser (header icon / drawer / PWA screen)
   |  one WebSocket per open portal tab (hibernating)   + HTTPS for history & files
   v
Worker  /api/v1/staff/chat/*   <- auth here: getSessionUser + chat eligibility
   |  forwards with a server-set user header (any client copy is stripped)
   v
Durable Object ChatHub (one instance, SQLite storage)
   tables: conversations, members, messages (expires_at), attachments, read_cursors, sweep_log
   alarm -> deletes expired rows + R2 objects -> tells open sockets
   |
R2 a2z-chat-temp (private; lifecycle 1 day; not backed up)
```

- **Why one hub DO:** about 30 staff, at most 8 per group. One object holds every socket, unread count and expiry in one consistent place. One Durable Object handles far more than this team sends. Splitting per conversation adds cost and complexity for no gain.
- **Eligibility, decided in the Worker on every HTTP call and every socket connect:**
  - signed in;
  - role not `customer` or `agent`;
  - `is_active = 1`;
  - `currentStaffSql` (not a leaver);
  - 2FA done;
  - capability `chat_use` (a new matrix row, default on for every staff role, so Users & Security can turn it off per role).
  - Applicants have no account, so they are excluded already.
- **Revocation:**
  - (a) Offboarding, deactivation, role change to customer/agent, "sign out everywhere" and logout call the hub's `revoke(userId)`, which closes that person's sockets at once.
  - (b) Backstop: while anyone is connected, the hub re-checks every connected person's session and eligibility in D1 every 5 minutes and closes the ones that fail.
  - (c) Every HTTP call is re-authorised anyway.
- **12-hour rule:**
  - `created_at` and `expires_at = created_at + 12 h` are set by the server only.
  - Reading, delivering or anything else never changes `expires_at`.
  - **Every read filters `expires_at > now`**, so an expired message is unreadable through the API, the socket and file download the same second, even before it is physically deleted.
  - The hub alarm is set to the next expiry (batched to at most once a minute).
  - Each run deletes the rows, deletes the R2 objects and broadcasts `expired` ids.
  - Retries: Cloudflare retries a failed alarm automatically; the existing 5-minute cron also calls `sweep` as recovery.
  - Each run writes a counter (deleted, failed, oldest overdue) that System health can show.
- **Client copies:**
  - Messages live in memory only: no localStorage, no IndexedDB, no service-worker cache.
  - Each message carries `expires_at`, and the client removes it on a timer even while offline.
  - Files are served with `Cache-Control: no-store, private`.
- **Attachments:**
  1. The client compresses images first (canvas to WebP/JPEG).
  2. Upload: the Worker refuses anything over 2 MB by header and by streamed count before any write, checks the type, checks the **file signature** (JPG `FFD8FF`, PNG `89504E47`, WebP `RIFF....WEBP`, PDF `%PDF-`), then stores it under `pending/`.
  3. Sending claims up to 3 of your own pending files, 5 MB in total.
  4. Unclaimed files are deleted after 15 minutes.
  5. Download goes through the Worker after a membership check (an authorised proxy, not a public link).
- **Limits:**
  - 1,500 characters a message;
  - 30 messages a minute a person;
  - 20 uploads per 10 minutes;
  - groups of 2-8 staff.
- **Online status:** a connected socket means online. No last-seen history is stored.
- **Never the official record:** a fixed line under the composer reads "Chat is not for approvals, payments, HR decisions or instructions - use the module." Nothing in chat feeds any other module.

## 4. Storage and cost estimate (30 staff, 150 messages each a day, 300 files a day)

| Item | Month | Included free | Expected extra cost |
|---|---|---|---|
| DO requests (connects, HTTP, alarms; socket messages billed 20:1) | ~150k | 1M on Paid, or 100k a day on Free | RM 0 |
| DO SQLite rows written (insert + delete) | ~0.6M | 50M on Paid | RM 0 |
| DO storage at any moment (12 h of text) | < 10 MB | 5 GB | RM 0 |
| DO duration | small, because sockets hibernate | 400k GB-s | RM 0 |
| R2 stored at any moment | < 300 MB | 10 GB | RM 0 |
| R2 writes / reads | ~9k / ~30k | 1M / 10M | RM 0 |
| D1 | **no chat tables**; one auth read per connect/call + one check every 5 min while online | | ~RM 0 |

These are estimates, not measurements. As the brief requires, the plan is to **measure in a pilot** (management only, one week) from the Cloudflare dashboard before turning it on for all staff.

## 5. Files affected (proposed)

| Change | Files |
|---|---|
| New | `worker/src/chat.ts` (ChatHub class, routes, sweep); `components/portal/chat/` (drawer, inbox, conversation, composer, `.module.css`); `lib/chat-client.ts` (socket, memory store, expiry timers); `tests/chat-*.mjs` (guard + mutations); `tests/browser/chat.py` |
| Changed | `worker/wrangler.toml` (DO binding, `new_sqlite_classes` migration, R2 `CHAT_FILES`); `worker/src/index.ts` (export class, route, socket upgrade, revoke hooks at logout / sign-out-everywhere); `worker/src/staff.ts` (revoke hooks at offboard / deactivate / role door; 5-min cron sweep call); `worker/src/permissions.ts` (`chat_use`); `components/portal/portal-shell.tsx` (header icon + badge); `public/_headers` (`wss://a2zcreative.my`); `scripts/release-backup.mjs` (check the new bucket exists); System health card (sweep counters); docs |
| Not touched | D1 schema (**no migration**), the `notifications` table, `notify()`, the SSE stream, backups of D1 and `MEDIA` |

**Owner steps before the first release:**

```
npx wrangler r2 bucket create a2z-chat-temp
npx wrangler r2 bucket lifecycle add a2z-chat-temp ...   # delete after 1 day
```

## 6. Security risks and limits to be honest about

1. **Malware scanning:** there is no scanner in this system, and Cloudflare offers none for R2 on a normal plan (upload scanning is a WAF Enterprise feature). Type and signature checks stop disguised executables. They do **not** detect a malicious PDF. **CEO decision needed.**
2. **Provider backups:** Durable Object SQLite keeps 30 days of point-in-time recovery inside Cloudflare, which the app cannot purge. Lock-screen pushes already shown stay on the phone, but they carry no text. Screenshots and downloaded files are outside the system.
3. **No investigation after 12 hours:** misuse cannot be reviewed once messages expire. Only counts (sent and deleted per day) are kept, never content or who-to-whom.
4. **One hub DO:** if it fails, chat is down and the rest of the portal is unaffected. Messages are never written anywhere else.
5. **Revocation window:** an instant hook covers every path the system knows about. A change made directly in the database is caught by the 5-minute check.

## 7. The pictures vs the brief: conflicts to decide

| Picture shows | Brief says | Proposal |
|---|---|---|
| Chat item in the sidebar and in the phone bottom bar (with a count) | Header icon only; no new sidebar or top-level module | **Header icon only.** A count on the phone bar also breaks v1.175.0 ("the phone bar never reads a count"). |
| 10 MB per file; Word, Excel, PowerPoint, MP4 video | JPG, PNG, WebP, PDF; 2 MB; 3 per message; 5 MB total | **Follow the brief.** |
| Phone and video call buttons, emoji button | No calls; no stickers or extras | **Leave out** (emoji still type from the phone keyboard). |
| Chat as a full page on desktop | Right-side drawer on web | **Drawer** (list and conversation side by side from 1024 px; one pane at a time below); full screen on the PWA. |
| Three images promised (01-03) | Two attached; the PWA conversation screen is not among them | Draw it from the conversation pane of image 01. |
