/* v1.89.0 — THE THREADS WORKSPACE, phase 1: connect and import.
 *
 * CEO, 04-09-2026, after a walkthrough video of a Threads content tool
 * (LazyThreads): *"for Threads I want new tabs all in 1 tabs for the Threads
 * with minimalist interface"*.
 *
 * WHAT THE VIDEO IS, UNDERNEATH. Every screen in it is built on the same two
 * ingredients: the account's own post history and metrics pulled from the
 * Threads API, and a layer of rules on top that turns those numbers into
 * advice. This module is the first ingredient. It connects an account,
 * imports every post it has ever published, and takes a daily snapshot of
 * each post and of the account. Nothing in it is written by a person — that
 * is phase 2.
 *
 * THREE RULES THIS FILE KEEPS.
 *
 *   1. THE TOKEN NEVER LEAVES THE WORKER. It is read by the functions that
 *      call Threads and by nothing else; no route returns it, and the
 *      accounts list carries only its expiry. tests/threads-guard.mjs holds
 *      this shut.
 *
 *   2. WORK IS BUDGETED, NOT UNBOUNDED. A first import of a large account is
 *      thousands of posts and one insights call per post. A Worker has a
 *      subrequest ceiling per invocation, so a sync is a TICK with a budget:
 *      it does what fits, records where it got to (sync_cursor), and the next
 *      tick — the 30-minute cron, or the Sync button — carries on. The same
 *      tick also refreshes tokens that are due and snapshots posts that have
 *      no snapshot for today, so "nightly metrics" is not a separate job that
 *      can fall over on its own: it is whatever the ticks get round to, and
 *      they get round to all of it.
 *
 *   3. A SNAPSHOT IS NEVER OVERWRITTEN. threads_post_metrics is keyed by the
 *      day of capture. The post row carries a denormalised copy of the
 *      newest one so the library sorts without a join, but the history is
 *      the table, and it is append-only.
 *
 * TOKEN LIFETIMES (Meta's rules, not ours): the short-lived token from the
 * authorisation lasts an hour and is exchanged at once for a long-lived one
 * of 60 days. A long-lived token can be refreshed only once it is at least a
 * day old and before it expires. Miss the window and the account must be
 * connected again by hand — so the tick refreshes anything inside its last
 * 35 days, which gives the cron more than a month of chances.
 */

import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit, logError } from "./shared";
import { can } from "./permissions";

const AUTH_URL = "https://threads.net/oauth/authorize";
const GRAPH = "https://graph.threads.net";
const SCOPES = "threads_basic,threads_content_publish,threads_manage_insights";
const PAGE = 100;
/** Fields we ask for on a post. `is_reply` is the newest of these; a server
    that does not know it answers with a field error, and the import falls
    back to BASE_FIELDS rather than failing the whole page. */
const FULL_FIELDS = "id,media_type,permalink,text,timestamp,is_quote_post,is_reply";
const BASE_FIELDS = "id,media_type,permalink,text,timestamp,is_quote_post";
const POST_METRICS = "views,likes,replies,reposts,quotes,shares";

/** What one tick may spend. The default suits the free Workers plan, where
    an invocation may make 50 subrequests and D1 calls count among them;
    THREADS_TICK_BUDGET raises it on a paid plan. */
const DEFAULT_BUDGET = 24;
const PAGES_PER_TICK = 2;

export function threadsConfigured(env: Env): boolean {
  return Boolean(env.THREADS_APP_ID && env.THREADS_APP_SECRET);
}

/* ------------------------------------------------------------------ *
 * The Graph API, normalised
 * ------------------------------------------------------------------ */

type Graph<T> = { ok: true; data: T } | { ok: false; message: string; code: number };

async function graph<T>(url: string): Promise<Graph<T>> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return { ok: false, message: `network: ${e instanceof Error ? e.message : String(e)}`, code: 0 };
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
  if (!res.ok || !body || body.error) {
    return {
      ok: false,
      message: body?.error?.message ?? `HTTP ${res.status}`,
      code: body?.error?.code ?? res.status,
    };
  }
  return { ok: true, data: body };
}

const q = (base: string, params: Record<string, string | number | undefined>): string => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
};

/* ------------------------------------------------------------------ *
 * OAuth — start and finish. The routes live in index.ts (they are not
 * under /staff: the callback is a browser redirect from Meta); the logic
 * lives here so the secret is read in exactly one file.
 * ------------------------------------------------------------------ */

export function threadsAuthUrl(env: Env, redirectUri: string, state: string): string {
  return q(AUTH_URL, {
    client_id: env.THREADS_APP_ID,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: "code",
    state,
  });
}

/** Code → short-lived token → long-lived token → profile → account row.
    Returns the username on success, a reason on failure. Never the token. */
export async function threadsCompleteAuth(
  env: Env, code: string, redirectUri: string, actorId: number,
): Promise<{ ok: true; username: string } | { ok: false; reason: string }> {
  if (!threadsConfigured(env)) return { ok: false, reason: "Threads app credentials are not set" };
  const form = new URLSearchParams({
    client_id: env.THREADS_APP_ID!,
    client_secret: env.THREADS_APP_SECRET!,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  type ShortTok = { access_token?: string; user_id?: string | number };
  let shortTok: ShortTok | null = null;
  try {
    const r = await fetch(`${GRAPH}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    shortTok = (await r.json().catch(() => null)) as ShortTok | null;
  } catch (e) {
    return { ok: false, reason: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!shortTok?.access_token) return { ok: false, reason: "Threads did not return an access token" };

  const longR = await graph<{ access_token: string; expires_in: number }>(
    q(`${GRAPH}/access_token`, {
      grant_type: "th_exchange_token",
      client_secret: env.THREADS_APP_SECRET,
      access_token: shortTok.access_token,
    }),
  );
  if (!longR.ok) return { ok: false, reason: `long-lived token: ${longR.message}` };
  const token = longR.data.access_token;
  const expiresIn = Number(longR.data.expires_in) > 0 ? Number(longR.data.expires_in) : 5184000;

  const me = await graph<{ id: string; username: string; name?: string }>(
    q(`${GRAPH}/v1.0/me`, { fields: "id,username,name", access_token: token }),
  );
  if (!me.ok) return { ok: false, reason: `profile: ${me.message}` };
  const uid = String(me.data.id ?? shortTok.user_id ?? "");
  if (!uid) return { ok: false, reason: "Threads did not say which account this is" };
  const username = String(me.data.username ?? uid);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO integration_tokens (provider, access_token, refresh_token, expires_at, updated_at)
       VALUES (?1, ?2, NULL, datetime('now', '+' || ?3 || ' seconds'), datetime('now'))
       ON CONFLICT (provider) DO UPDATE SET
         access_token = ?2, refresh_token = NULL,
         expires_at = datetime('now', '+' || ?3 || ' seconds'), updated_at = datetime('now')`,
    ).bind(`threads:${uid}`, token, String(expiresIn)),
    env.DB.prepare(
      `INSERT INTO threads_accounts (threads_user_id, username, connected_by, connected_at, token_expires_at,
                                     sync_state, sync_cursor, sync_error, is_active)
       VALUES (?1, ?2, ?3, datetime('now'), datetime('now', '+' || ?4 || ' seconds'), 'importing', NULL, NULL, 1)
       ON CONFLICT (threads_user_id) DO UPDATE SET
         username = ?2, connected_by = ?3, connected_at = datetime('now'),
         token_expires_at = datetime('now', '+' || ?4 || ' seconds'),
         sync_state = 'importing', sync_cursor = NULL, sync_error = NULL, is_active = 1`,
    ).bind(uid, username, actorId, String(expiresIn)),
  ]);
  await audit(env, actorId, "threads.connected", "threads_accounts", uid, { username });
  return { ok: true, username };
}

/* ------------------------------------------------------------------ *
 * Traits — plain rules, computed once at import so phase 3 is SQL.
 * ------------------------------------------------------------------ */

const MS_WORDS = /\b(yang|dan|untuk|dengan|tak|tidak|ni|tu|aku|saya|kita|korang|dah|sudah|nak|boleh|ada|dalam|ini|itu|macam|sebab|kalau|jangan|bukan|lagi|orang|buat|kena|pun|je|ke)\b/gi;
const EN_WORDS = /\b(the|and|you|is|are|this|that|with|for|have|was|not|but|your|from|they|will|what|when|about|just|like)\b/gi;
const CTA = /\b(save|repost|share|comment|reply|follow|dm|link|click|tap|bookmark|daftar|kongsi|simpan|balas|ikut|klik|whatsapp|beli|order|tekan)\b/i;

export interface PostTraits {
  char_count: number;
  has_number_hook: number;
  has_question_hook: number;
  has_cta: number;
  has_media: number;
  language_guess: string | null;
}

export function postTraits(text: string | null | undefined, mediaType: string): PostTraits {
  const t = (text ?? "").trim();
  const firstLine = t.split(/\r?\n/)[0]?.slice(0, 160) ?? "";
  const ms = (t.match(MS_WORDS) ?? []).length;
  const en = (t.match(EN_WORDS) ?? []).length;
  return {
    char_count: t.length,
    has_number_hook: /\d/.test(firstLine) ? 1 : 0,
    has_question_hook: firstLine.includes("?") ? 1 : 0,
    has_cta: CTA.test(t) ? 1 : 0,
    has_media: mediaType === "TEXT_POST" || mediaType === "REPOST_FACADE" ? 0 : 1,
    language_guess: ms + en < 3 ? null : ms >= en ? "ms" : "en",
  };
}

/* ------------------------------------------------------------------ *
 * The tick
 * ------------------------------------------------------------------ */

interface AccountRow {
  id: number;
  threads_user_id: string;
  username: string;
  sync_state: string;
  sync_cursor: string | null;
  token_expires_at: string | null;
}

interface ThreadsMedia {
  id: string;
  media_type?: string;
  permalink?: string;
  text?: string;
  timestamp?: string;
  is_quote_post?: boolean;
  is_reply?: boolean;
}

export interface TickReport {
  refreshed: number;
  imported: number;
  snapshots: number;
  spent: number;
  budget: number;
  errors: string[];
}

async function tokenFor(env: Env, uid: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT access_token FROM integration_tokens WHERE provider = ?1`,
  ).bind(`threads:${uid}`).first<{ access_token: string }>();
  return row?.access_token ?? null;
}

/** Today in Malaysia, the day a snapshot is filed under. */
const todayMyt = (): string => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

/** Refresh every long-lived token inside its last 35 days, at most once a
    day. Costs one subrequest per refresh. */
async function refreshDueTokens(env: Env, rep: TickReport, onlyAccount?: number): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.threads_user_id, a.username
       FROM threads_accounts a JOIN integration_tokens t ON t.provider = 'threads:' || a.threads_user_id
      WHERE a.is_active = 1
        AND t.expires_at < datetime('now', '+35 days')
        AND t.expires_at > datetime('now')
        AND t.updated_at < datetime('now', '-1 day')
        ${onlyAccount ? "AND a.id = ?1" : ""}`,
  ).bind(...(onlyAccount ? [onlyAccount] : [])).all<{ id: number; threads_user_id: string; username: string }>();
  for (const a of results) {
    if (rep.spent >= rep.budget) return;
    const tok = await tokenFor(env, a.threads_user_id);
    if (!tok) continue;
    rep.spent++;
    const r = await graph<{ access_token: string; expires_in: number }>(
      q(`${GRAPH}/refresh_access_token`, { grant_type: "th_refresh_token", access_token: tok }),
    );
    if (!r.ok) {
      rep.errors.push(`@${a.username}: refresh ${r.message}`);
      await logError(env, "threads_refresh", `@${a.username}: ${r.message}`);
      continue;
    }
    const secs = Number(r.data.expires_in) > 0 ? Number(r.data.expires_in) : 5184000;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE integration_tokens SET access_token = ?1,
                expires_at = datetime('now', '+' || ?2 || ' seconds'), updated_at = datetime('now')
          WHERE provider = ?3`,
      ).bind(r.data.access_token, String(secs), `threads:${a.threads_user_id}`),
      env.DB.prepare(
        `UPDATE threads_accounts SET token_expires_at = datetime('now', '+' || ?1 || ' seconds') WHERE id = ?2`,
      ).bind(String(secs), a.id),
    ]);
    rep.refreshed++;
  }
}

/** One page of history for one account. Returns how many posts landed. */
async function importPage(env: Env, a: AccountRow, tok: string, rep: TickReport): Promise<boolean> {
  type Page = { data?: ThreadsMedia[]; paging?: { cursors?: { after?: string }; next?: string } };
  const ask = (fields: string) => graph<Page>(q(`${GRAPH}/v1.0/${a.threads_user_id}/threads`, {
    fields, limit: PAGE, access_token: tok, after: a.sync_cursor ?? undefined,
  }));
  rep.spent++;
  let r = await ask(FULL_FIELDS);
  if (!r.ok && r.code === 100 && rep.spent < rep.budget) {
    /* A field this server does not know — ask for the ones every server knows. */
    rep.spent++;
    r = await ask(BASE_FIELDS);
  }
  if (!r.ok) {
    rep.errors.push(`@${a.username}: import ${r.message}`);
    await env.DB.prepare(`UPDATE threads_accounts SET sync_error = ?1 WHERE id = ?2`).bind(r.message.slice(0, 300), a.id).run();
    await logError(env, "threads_import", `@${a.username}: ${r.message}`);
    return false;
  }
  const posts = r.data.data ?? [];
  const stmts = posts
    .filter((p) => p.id && p.timestamp)
    .map((p) => {
      const mt = p.media_type ?? "TEXT_POST";
      const tr = postTraits(p.text, mt);
      return env.DB.prepare(
        `INSERT INTO threads_posts (account_id, media_id, text, media_type, permalink, published_at, is_reply, is_quote,
                                    source, status, language_guess, char_count, has_number_hook, has_question_hook, has_cta, has_media)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'imported', 'published', ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT (media_id) DO UPDATE SET
           text = ?3, media_type = ?4, permalink = ?5, is_reply = ?7, is_quote = ?8,
           language_guess = ?9, char_count = ?10, has_number_hook = ?11, has_question_hook = ?12, has_cta = ?13, has_media = ?14`,
      ).bind(
        a.id, String(p.id), p.text ?? null, mt, p.permalink ?? null,
        new Date(p.timestamp!).toISOString().slice(0, 19).replace("T", " "),
        p.is_reply ? 1 : 0, p.is_quote_post ? 1 : 0,
        tr.language_guess, tr.char_count, tr.has_number_hook, tr.has_question_hook, tr.has_cta, tr.has_media,
      );
    });
  const after = r.data.paging?.cursors?.after ?? null;
  const more = Boolean(after && r.data.paging?.next && posts.length > 0);
  stmts.push(
    env.DB.prepare(
      `UPDATE threads_accounts SET sync_cursor = ?1, sync_state = ?2, sync_error = NULL, last_sync_at = datetime('now') WHERE id = ?3`,
    ).bind(more ? after : null, more ? "importing" : "done", a.id),
  );
  await env.DB.batch(stmts);
  rep.imported += posts.length;
  a.sync_cursor = more ? after : null;
  a.sync_state = more ? "importing" : "done";
  return more;
}

interface Snap { views: number | null; likes: number | null; replies: number | null; reposts: number | null; quotes: number | null; shares: number | null }

/** One post's insights → today's snapshot + the denormalised copy. A post
    Threads refuses insights for (reposts, very old posts) is stamped anyway
    so it is not asked again tomorrow morning and every morning after. */
async function snapshotPost(env: Env, post: { id: number; media_id: string }, tok: string, rep: TickReport, label: string): Promise<void> {
  rep.spent++;
  const r = await graph<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
    q(`${GRAPH}/v1.0/${post.media_id}/insights`, { metric: POST_METRICS, access_token: tok }),
  );
  const s: Snap = { views: null, likes: null, replies: null, reposts: null, quotes: null, shares: null };
  if (r.ok) {
    for (const m of r.data.data ?? []) {
      const v = m.total_value?.value ?? m.values?.[0]?.value;
      if (typeof v === "number" && m.name in s) (s as unknown as Record<string, number>)[m.name] = v;
    }
  } else if (r.code !== 10 && r.code !== 100) {
    /* 10 / 100 are "no insights for this one" — expected for reposts and for
       posts older than the insights window. Anything else is worth a line. */
    rep.errors.push(`${label}: insights ${r.message}`);
  }
  const day = todayMyt();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO threads_post_metrics (post_id, captured_on, views, likes, replies, reposts, quotes, shares)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (post_id, captured_on) DO UPDATE SET
         views = ?3, likes = ?4, replies = ?5, reposts = ?6, quotes = ?7, shares = ?8`,
    ).bind(post.id, day, s.views, s.likes, s.replies, s.reposts, s.quotes, s.shares),
    env.DB.prepare(
      `UPDATE threads_posts SET views = COALESCE(?1, views), likes = COALESCE(?2, likes), replies = COALESCE(?3, replies),
              reposts = COALESCE(?4, reposts), quotes = COALESCE(?5, quotes), shares = COALESCE(?6, shares),
              metrics_at = datetime('now')
        WHERE id = ?7`,
    ).bind(s.views, s.likes, s.replies, s.reposts, s.quotes, s.shares, post.id),
  ]);
  rep.snapshots++;
}

/** The account's own number for today: followers. One subrequest, once a
    day. (Account-level views take a since/until window that followers_count
    refuses in the same call; the brief sums post views instead, which is
    the figure the library already holds.) */
async function snapshotAccount(env: Env, a: AccountRow, tok: string, rep: TickReport): Promise<void> {
  const day = todayMyt();
  const have = await env.DB.prepare(
    `SELECT 1 AS x FROM threads_account_metrics WHERE account_id = ?1 AND captured_on = ?2 AND followers IS NOT NULL`,
  ).bind(a.id, day).first();
  if (have) return;
  rep.spent++;
  const r = await graph<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
    q(`${GRAPH}/v1.0/${a.threads_user_id}/threads_insights`, { metric: "followers_count", access_token: tok }),
  );
  let followers: number | null = null;
  if (r.ok) {
    for (const m of r.data.data ?? []) {
      if (m.name === "followers_count") followers = m.total_value?.value ?? m.values?.[0]?.value ?? null;
    }
  } else {
    rep.errors.push(`@${a.username}: account insights ${r.message}`);
    return; // nothing to file; try again next tick rather than filing a blank day
  }
  await env.DB.prepare(
    `INSERT INTO threads_account_metrics (account_id, captured_on, followers, views) VALUES (?1, ?2, ?3, NULL)
     ON CONFLICT (account_id, captured_on) DO UPDATE SET followers = ?3`,
  ).bind(a.id, day, followers).run();
}

/**
 * One tick of Threads work, within a budget of subrequests. Order matters:
 * a token about to expire is worth more than any page of history, and a
 * page of history is worth more than a fresher number on a post we already
 * hold. Called by the 30-minute cron for every account, and by the Sync
 * button for one.
 */
export async function threadsTick(env: Env, budget?: number, onlyAccount?: number): Promise<TickReport> {
  const rep: TickReport = {
    refreshed: 0, imported: 0, snapshots: 0, spent: 0,
    budget: budget ?? (Number(env.THREADS_TICK_BUDGET) > 0 ? Number(env.THREADS_TICK_BUDGET) : DEFAULT_BUDGET),
    errors: [],
  };
  if (!threadsConfigured(env)) return rep;
  let accounts: AccountRow[];
  try {
    const r = await env.DB.prepare(
      `SELECT id, threads_user_id, username, sync_state, sync_cursor, token_expires_at
         FROM threads_accounts WHERE is_active = 1 ${onlyAccount ? "AND id = ?1" : ""} ORDER BY id`,
    ).bind(...(onlyAccount ? [onlyAccount] : [])).all<AccountRow>();
    accounts = r.results;
  } catch {
    return rep; // pre-0105 — nothing to do and nothing to say
  }
  if (accounts.length === 0) return rep;

  await refreshDueTokens(env, rep, onlyAccount);

  for (const a of accounts) {
    const tok = await tokenFor(env, a.threads_user_id);
    if (!tok) { rep.errors.push(`@${a.username}: no token — connect the account again`); continue; }

    /* 1. history still to fetch */
    let pages = 0;
    while (a.sync_state === "importing" && pages < PAGES_PER_TICK && rep.spent < rep.budget) {
      pages++;
      const more = await importPage(env, a, tok, rep);
      if (!more) break;
    }

    /* 2. the account's own numbers, once a day */
    if (rep.spent < rep.budget) await snapshotAccount(env, a, tok, rep);

    /* 3. posts with no snapshot for today: the last 30 days daily, older
          posts weekly, newest first — the numbers still moving come first. */
    const room = rep.budget - rep.spent;
    if (room <= 0) continue;
    const { results: due } = await env.DB.prepare(
      `SELECT id, media_id FROM threads_posts
        WHERE account_id = ?1 AND is_reply = 0 AND media_type != 'REPOST_FACADE'
          AND (metrics_at IS NULL
               OR (published_at >= datetime('now', '-30 days') AND metrics_at < datetime('now', '-20 hours'))
               OR metrics_at < datetime('now', '-7 days'))
        ORDER BY metrics_at IS NOT NULL, published_at DESC
        LIMIT ?2`,
    ).bind(a.id, room).all<{ id: number; media_id: string }>();
    for (const p of due) {
      if (rep.spent >= rep.budget) break;
      await snapshotPost(env, p, tok, rep, `@${a.username} ${p.media_id}`);
    }
  }
  return rep;
}

/* ------------------------------------------------------------------ *
 * Reading — the routes under /staff/threads
 * ------------------------------------------------------------------ */

interface PostRow {
  id: number; account_id: number; media_id: string; text: string | null; media_type: string;
  permalink: string | null; published_at: string; is_reply: number; is_quote: number;
  language_guess: string | null; char_count: number; has_media: number;
  views: number | null; likes: number | null; replies: number | null; reposts: number | null;
  quotes: number | null; shares: number | null; metrics_at: string | null;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

/**
 * "17.7× above baseline" — a post against the median views of the 30 posts
 * published before it on the same account. Computed over the whole list in
 * order, so every post is judged against what the account was doing at the
 * time, not against a later, bigger audience. Returns the multiplier per
 * post id, or null where there is no baseline yet or no views.
 */
export function baselines(posts: { id: number; published_at: string; views: number | null }[]): Map<number, { baseline: number | null; multiplier: number | null }> {
  const out = new Map<number, { baseline: number | null; multiplier: number | null }>();
  const asc = [...posts].sort((a, b) => a.published_at.localeCompare(b.published_at));
  const window: number[] = [];
  for (const p of asc) {
    const base = window.length >= 5 ? median(window) : null;
    const mult = base && base > 0 && p.views != null ? Math.round((p.views / base) * 10) / 10 : null;
    out.set(p.id, { baseline: base, multiplier: mult });
    if (p.views != null) {
      window.push(p.views);
      if (window.length > 30) window.shift();
    }
  }
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

export async function handleThreads(
  env: Env,
  path: string, // stripped of /threads, starts with / (or is empty)
  method: string,
  body: Record<string, unknown> | null,
  user: StaffUser,
  params: URLSearchParams,
): Promise<Response | null> {
  if (!can(user.role, "threads_view")) return err("forbidden", "No access to Threads", 403);
  const manage = can(user.role, "threads_manage");

  try {
    /* ---- accounts: what is connected, how healthy, never the token ---- */
    if ((path === "/accounts" || path === "") && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.username, a.display_label, a.connected_at, a.token_expires_at, a.last_sync_at,
                a.sync_error, a.sync_state, a.is_active, u.name AS connected_by_name,
                (SELECT COUNT(*) FROM threads_posts p WHERE p.account_id = a.id) AS posts,
                (SELECT MAX(captured_on) FROM threads_account_metrics m WHERE m.account_id = a.id) AS metrics_on
           FROM threads_accounts a LEFT JOIN users u ON u.id = a.connected_by
          WHERE a.is_active = 1 ORDER BY a.id`,
      ).all();
      return json({ accounts: results ?? [], configured: threadsConfigured(env), can_manage: manage });
    }

    /* ---- sync now: one tick for one account, a bigger budget than the cron ---- */
    {
      const m = path.match(/^\/accounts\/(\d+)\/sync$/);
      if (m && method === "POST") {
        if (!manage) return err("forbidden", "Only management syncs a Threads account", 403);
        const id = Number(m[1]);
        const rep = await threadsTick(env, Math.max(DEFAULT_BUDGET, 40), id);
        await audit(env, user.id, "threads.sync", "threads_accounts", String(id), {
          imported: rep.imported, snapshots: rep.snapshots, refreshed: rep.refreshed, errors: rep.errors.length,
        });
        const acc = await env.DB.prepare(`SELECT sync_state, sync_error FROM threads_accounts WHERE id = ?1`).bind(id).first<{ sync_state: string; sync_error: string | null }>();
        return json({ ok: true, report: rep, sync_state: acc?.sync_state ?? null, sync_error: acc?.sync_error ?? null });
      }
    }

    /* ---- disconnect: the row stays (its posts are history), the token goes ---- */
    {
      const m = path.match(/^\/accounts\/(\d+)\/disconnect$/);
      if (m && method === "POST") {
        if (!manage) return err("forbidden", "Only management disconnects a Threads account", 403);
        const id = Number(m[1]);
        const acc = await env.DB.prepare(`SELECT threads_user_id, username FROM threads_accounts WHERE id = ?1`).bind(id).first<{ threads_user_id: string; username: string }>();
        if (!acc) return err("not_found", "No such Threads account", 404);
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM integration_tokens WHERE provider = ?1`).bind(`threads:${acc.threads_user_id}`),
          env.DB.prepare(`UPDATE threads_accounts SET is_active = 0, token_expires_at = NULL WHERE id = ?1`).bind(id),
        ]);
        await audit(env, user.id, "threads.disconnected", "threads_accounts", String(id), { username: acc.username });
        return json({ ok: true });
      }
    }

    /* ---- the label on the chip ---- */
    {
      const m = path.match(/^\/accounts\/(\d+)$/);
      if (m && method === "PUT") {
        if (!manage) return err("forbidden", "Only management renames a Threads account", 403);
        const label = typeof body?.display_label === "string" ? body.display_label.trim().slice(0, 40) : "";
        await env.DB.prepare(`UPDATE threads_accounts SET display_label = ?1 WHERE id = ?2`).bind(label || null, Number(m[1])).run();
        await audit(env, user.id, "threads.relabel", "threads_accounts", m[1], { display_label: label || null });
        return json({ ok: true });
      }
    }

    /* ---- posts: the ONE list the library table and its CSV both read ---- */
    if (path === "/posts" && method === "GET") {
      const account = Number(params.get("account") ?? 0) || null;
      const month = params.get("month") ?? ""; // YYYY-MM or empty
      if (month && !/^\d{4}-\d{2}$/.test(month)) return err("invalid_input", "month must be YYYY-MM", 400);
      const filter = params.get("filter") ?? "all"; // all | recent | winners | media | text
      const qtext = (params.get("q") ?? "").trim().toLowerCase().slice(0, 80);
      const sort = params.get("sort") === "views" ? "views" : "date";
      const limit = Math.min(Math.max(Number(params.get("limit") ?? 300) || 300, 1), 1000);

      const { results } = await env.DB.prepare(
        `SELECT p.id, p.account_id, p.media_id, p.text, p.media_type, p.permalink, p.published_at, p.is_reply, p.is_quote,
                p.language_guess, p.char_count, p.has_media, p.views, p.likes, p.replies, p.reposts, p.quotes, p.shares, p.metrics_at
           FROM threads_posts p JOIN threads_accounts a ON a.id = p.account_id
          WHERE a.is_active = 1 AND p.is_reply = 0 ${account ? "AND p.account_id = ?1" : ""}
          ORDER BY p.published_at DESC`,
      ).bind(...(account ? [account] : [])).all<PostRow>();
      /* Baselines need the whole history in order — a post is judged against
         the thirty before it, which the month filter would otherwise hide. */
      const base = baselines(results);
      const since30 = iso(new Date(Date.now() - 30 * 86400 * 1000));
      let rows = results.filter((p) => {
        if (month && !p.published_at.startsWith(month)) return false;
        if (filter === "recent" && p.published_at < since30) return false;
        if (filter === "winners" && !((base.get(p.id)?.multiplier ?? 0) >= 2)) return false;
        if (filter === "media" && !p.has_media) return false;
        if (filter === "text" && p.has_media) return false;
        if (qtext && !(p.text ?? "").toLowerCase().includes(qtext)) return false;
        return true;
      });
      if (sort === "views") rows = [...rows].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
      const total = rows.length;
      rows = rows.slice(0, limit);
      return json({
        posts: rows.map((p) => ({ ...p, ...base.get(p.id) })),
        total,
        months: [...new Set(results.map((p) => p.published_at.slice(0, 7)))].sort().reverse(),
      });
    }

    /* ---- summary: the brief at the top of the tab ---- */
    if (path === "/summary" && method === "GET") {
      const account = Number(params.get("account") ?? 0) || null;
      const days = Math.min(Math.max(Number(params.get("days") ?? 30) || 30, 7), 365);
      const now = Date.now();
      const from = iso(new Date(now - days * 86400 * 1000));
      const prevFrom = iso(new Date(now - 2 * days * 86400 * 1000));
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.text, p.permalink, p.published_at, p.has_media, p.char_count, p.views, p.likes, p.replies, p.reposts, p.quotes
           FROM threads_posts p JOIN threads_accounts a ON a.id = p.account_id
          WHERE a.is_active = 1 AND p.is_reply = 0 AND p.published_at >= ?1 ${account ? "AND p.account_id = ?2" : ""}
          ORDER BY p.published_at DESC`,
      ).bind(...(account ? [prevFrom, account] : [prevFrom])).all<{
        id: number; text: string | null; permalink: string | null; published_at: string; has_media: number; char_count: number;
        views: number | null; likes: number | null; replies: number | null; reposts: number | null; quotes: number | null;
      }>();
      const cur = results.filter((p) => p.published_at >= from);
      const prev = results.filter((p) => p.published_at < from);
      const sum = (xs: typeof results, k: "views" | "likes" | "replies" | "reposts" | "quotes") => xs.reduce((n, p) => n + (p[k] ?? 0), 0);
      const period = (xs: typeof results) => {
        const views = sum(xs, "views");
        const inter = sum(xs, "likes") + sum(xs, "replies") + sum(xs, "reposts") + sum(xs, "quotes");
        const measured = xs.filter((p) => p.views != null).length;
        return {
          posts: xs.length,
          views,
          likes: sum(xs, "likes"),
          replies: sum(xs, "replies"),
          avg_views: measured ? Math.round(views / measured) : null,
          /* per mille, an integer — money-style, no floats in the API */
          engagement_pm: views > 0 ? Math.round((inter / views) * 1000) : null,
        };
      };
      /* followers: the newest snapshot vs the one nearest the window's start */
      const { results: fol } = await env.DB.prepare(
        `SELECT captured_on, SUM(followers) AS followers FROM threads_account_metrics m JOIN threads_accounts a ON a.id = m.account_id
          WHERE a.is_active = 1 AND followers IS NOT NULL ${account ? "AND m.account_id = ?1" : ""}
          GROUP BY captured_on ORDER BY captured_on DESC LIMIT 400`,
      ).bind(...(account ? [account] : [])).all<{ captured_on: string; followers: number }>();
      const startDay = from.slice(0, 10);
      const nowF = fol[0] ?? null;
      const startF = fol.find((f) => f.captured_on <= startDay) ?? fol[fol.length - 1] ?? null;
      /* what the account is doing by hour of publishing (MYT) — where the
         video's "publish around 1-3 PM" comes from */
      const hours = new Map<number, { views: number; posts: number }>();
      for (const p of cur) {
        if (p.views == null) continue;
        const h = (new Date(p.published_at.replace(" ", "T") + "Z").getUTCHours() + 8) % 24;
        const e = hours.get(h) ?? { views: 0, posts: 0 };
        e.views += p.views; e.posts++;
        hours.set(h, e);
      }
      const base = baselines(results);
      const top = [...cur].filter((p) => p.views != null).sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5)
        .map((p) => ({ id: p.id, text: (p.text ?? "").slice(0, 200), permalink: p.permalink, published_at: p.published_at,
                       views: p.views, likes: p.likes, replies: p.replies, multiplier: base.get(p.id)?.multiplier ?? null }));
      const mediaMed = median(cur.filter((p) => p.has_media && p.views != null).map((p) => p.views!));
      const textMed = median(cur.filter((p) => !p.has_media && p.views != null).map((p) => p.views!));
      return json({
        days, from: from.slice(0, 10),
        this: period(cur), prev: period(prev),
        followers: { now: nowF?.followers ?? null, start: startF?.followers ?? null, as_of: nowF?.captured_on ?? null },
        by_hour: [...hours.entries()].map(([hour, e]) => ({ hour, views: e.views, posts: e.posts, avg: Math.round(e.views / e.posts) })).sort((a, b) => a.hour - b.hour),
        media_median: mediaMed, text_median: textMed,
        top,
      });
    }

    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no such table: threads_/.test(msg)) {
      return json({ accounts: [], posts: [], pending_migration: true, migration: "0105_threads" });
    }
    await logError(env, "threads_route", msg, path);
    return err("server_error", msg, 500);
  }
}
