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

/* v1.94.0 — THE AUTHORISE HOST IS threads.com, NOT threads.net.
 *
 * CEO, 04-09-2026, three attempts, each landing on
 *   threads.com/oauth/authorize/error.json?error_message=An+unknown+error+has+occurred&error_code=1
 *
 * Note WHERE that page is: threads.COM. We sent the browser to threads.NET,
 * so a redirect happened on the way — Threads moved to threads.com in April
 * 2025 and .net forwards. A forward is where a query string goes to die: the
 * hop can drop or re-encode it, and an authorise page with no client_id
 * answers with exactly this error, which names nothing because from its side
 * nothing was asked. Sending the browser straight to the host that serves the
 * page removes the hop and the question.
 *
 * If the next attempt still fails, it fails ON the real page with the real
 * parameters, and /connect?show=1 prints what they were. */
const AUTH_URL = "https://www.threads.com/oauth/authorize";
const GRAPH = "https://graph.threads.net";
/* v1.96.0 — threads_keyword_search joins the list for the study cases. An
   account connected BEFORE this release holds a token without it, and the
   search answers 403 until it is reconnected; the tab says so rather than
   showing an empty result and letting somebody conclude the niche is
   quiet. */
const SCOPES = "threads_basic,threads_content_publish,threads_manage_insights,threads_keyword_search";
/* Meta allows roughly 500 keyword searches per rolling 7 days for the whole
   app. We stop at 450: the last fifty are the difference between a quota
   that runs out on a Tuesday and one that answers when somebody needs it. */
const SEARCH_WEEK_CAP = 450;
const SEARCH_FIELDS = "id,text,username,permalink,timestamp,media_type";
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

/* v1.94.0 — `wrangler secret put` stores exactly what was pasted, and a
   paste out of a browser very often carries a trailing newline or a stray
   space. `client_id=1234%0A` is not an app id, and Meta answers a bad one
   with the same unnamed error as a missing one. Trimmed at every read. */
export const threadsAppId = (env: Env): string => (env.THREADS_APP_ID ?? "").trim();
export const threadsAppSecret = (env: Env): string => (env.THREADS_APP_SECRET ?? "").trim();

export function threadsConfigured(env: Env): boolean {
  return Boolean(threadsAppId(env) && threadsAppSecret(env));
}

/**
 * v1.94.0 — what the worker will send, and whether the stored values look
 * like what Meta expects. Reported ABOUT the secret, never as a copy of it:
 * set or not, and whether a paste left whitespace on the end. Lives HERE
 * because guard #33 holds that exactly one file reads the secret — index.ts
 * asked for these three facts and the guard was right to refuse.
 */
export function threadsSetupReport(env: Env): {
  client_id: string; client_id_looks_right: boolean; client_id_had_whitespace: boolean;
  secret_set: boolean; secret_had_whitespace: boolean;
} {
  const rawId = env.THREADS_APP_ID ?? "";
  const rawSecret = env.THREADS_APP_SECRET ?? "";
  const id = rawId.trim();
  return {
    client_id: id,
    /* A Threads App ID is a long run of digits. Anything else is very often
       the Meta App ID's neighbour on the dashboard, or the secret. */
    client_id_looks_right: /^\d{8,}$/.test(id),
    client_id_had_whitespace: rawId !== id,
    secret_set: Boolean(rawSecret.trim()),
    secret_had_whitespace: rawSecret !== rawSecret.trim(),
  };
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
  const raw = await res.text().catch(() => "");
  type Body = (T & { error?: { message?: string; code?: number } }) | null;
  let body: Body;
  try { body = JSON.parse(raw) as Body; } catch { body = null; }
  if (!res.ok || !body || body.error) {
    /* v1.96.1 — a 500 from Meta arrives as an HTML page, not JSON, and
       "HTTP 500" alone told the CEO nothing. Keep the first words of what
       came back so the Connection section can show WHAT failed. */
    const glimpse = body ? "" : raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
    return {
      ok: false,
      message: body?.error?.message ?? (glimpse ? `HTTP ${res.status}: ${glimpse}` : `HTTP ${res.status}`),
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
    client_id: threadsAppId(env),
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
    client_id: threadsAppId(env),
    client_secret: threadsAppSecret(env),
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
      client_secret: threadsAppSecret(env),
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
                                     sync_state, sync_cursor, sync_error, is_active, granted_scopes)
       VALUES (?1, ?2, ?3, datetime('now'), datetime('now', '+' || ?4 || ' seconds'), 'importing', NULL, NULL, 1, ?5)
       ON CONFLICT (threads_user_id) DO UPDATE SET
         username = ?2, connected_by = ?3, connected_at = datetime('now'),
         token_expires_at = datetime('now', '+' || ?4 || ' seconds'),
         sync_state = 'importing', sync_cursor = NULL, sync_error = NULL, is_active = 1, granted_scopes = ?5`,
    ).bind(uid, username, actorId, String(expiresIn), SCOPES),
  ]);
  await audit(env, actorId, "threads.connected", "threads_accounts", uid, { username, scopes: SCOPES });
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

/* v1.97.0 — Malay is not Indonesian. The two share yang/dan/untuk, so a
   count of those alone calls half of Jakarta "Malay". These are the words
   that belong to one side only, and they decide. */
const ID_ONLY = /\b(gak|nggak|enggak|banget|aja|gue|gua|elo|udah|bisa|gimana|kalo|sih|dong|deh|yuk|kayak|enak|rupiah|rp|idr|jakarta|bandung|surabaya|jogja|yogyakarta|medan|bali|indonesia|indo|kalian|bikin|dapet|emang|ngga|pengen|lho|kok|makasih|gitu|gini|kapan|diskon|liburan|toko|kerudung|jilbab|nggak|beneran|doang)\b/gi;
const MS_ONLY = /\b(tak|nak|dah|kat|je|korang|awak|dorang|macam|sedap|kedai|ringgit|boleh|jugak|sikit|pasal|weh|wei|meh|lor|akak|makcik|pakcik|tudung|bawal|lepak|mamak|tapau|percutian|bercuti|diskaun|promosi|tempahan|tempah|kompem|confirm|memang|takde|xde|jom|dekat|rumah sewa|kereta sewa)\b/gi;
/* A Malaysian place or price is the strongest single tell: a stranger writing
   in English about a stay in Langkawi at RM 180 a night is a Malaysian post
   by any useful definition. */
const MY_PLACES = /\b(malaysia|malaysian|kuala lumpur|kl|klcc|selangor|shah alam|petaling jaya|pj|subang|puchong|cyberjaya|putrajaya|johor|johor bahru|jb|penang|pulau pinang|georgetown|melaka|malacca|perak|ipoh|kedah|alor setar|langkawi|kelantan|kota bharu|terengganu|kuala terengganu|pahang|kuantan|cameron highlands|genting|negeri sembilan|seremban|perlis|sabah|kota kinabalu|kk|sarawak|kuching|miri|labuan|port dickson|desaru|cherating|redang|perhentian|tioman|bukit bintang|bangsar|damansara|cheras|ampang|klang|kajang|seri kembangan)\b/gi;
const MY_PRICE = /\b(rm\s?\d[\d,.]*|\d[\d,.]*\s?rm|ringgit)\b/gi;
const MY_STRONG = /\b(tudung|bawal|korang|dorang|tapau|mamak|lepak|jom|takde|kompem|diskaun|percutian|tempahan|makcik|pakcik|jugak|sikit|kedai runcit|touch n go|tng|grabfood|shopee malaysia|lazada malaysia|jakim|halal jakim|ptptn|epf|kwsp|myvi|proton|perodua)\b/gi;

/* v1.98.0 — is the writer LOOKING for the thing or OFFERING it. Demand reads
   as a question with an ask in it; supply reads as an offer with a price, a
   stock line or a way to order. The same keyword sits in both, which is why
   a count of the keyword alone was never going to be a demand study. */
const ASK_WORDS = /\b(recommend|recommendation|recommendations|suggest|suggestion|suggestions|anyone|any one|anybody|sesiapa|sape|siapa|ada tak|ada tau|ada yang|mana nak|mana boleh|where to|where can|which one|yang mana|cadang|cadangan|tolong|help me|need help|looking for|nak cari|cari|carik|nak beli|want to buy|how much|berapa|harga berapa|worth it|okay tak|ok tak|bagus tak|elok tak|sedap tak|any idea|apa pendapat|pendapat korang|review|tips|tip)\b/i;
const OFFER_WORDS = /\b(ready stock|readystock|stok ada|in stock|restock|new arrival|koleksi baru|promo|promosi|diskaun|discount|sale|offer|harga|price|rm ?\d|free postage|free shipping|pos percuma|cod|dm|whatsapp|wasap|ws|pm|order|tempah|tempahan|booking|book now|link|shopee|tiktok shop|lazada|beli sekarang|grab now|limited|terhad|open order|preorder|pre-order|ready to ship|checkout)\b/i;

export type Intent = "asking" | "selling" | "other";

export function intentOf(text: string | null | undefined): Intent {
  const t = (text ?? "").toLowerCase();
  if (!t) return "other";
  const asks = (t.match(new RegExp(ASK_WORDS.source, "gi")) ?? []).length;
  const offers = (t.match(new RegExp(OFFER_WORDS.source, "gi")) ?? []).length;
  const question = t.includes("?");
  /* A question with an ask in it is demand even if it names a price ("RM39
     worth it?"). An offer needs either two selling signals or one plus a
     price - one "link" in a sentence is not a shop. */
  if (question && asks >= 1 && asks >= offers - 1) return "asking";
  if (offers >= 2 || (offers >= 1 && /\brm ?\d/.test(t))) return "selling";
  if (asks >= 2) return "asking";
  return "other";
}

export interface MalaysiaSignal { my_signal: number; my_reasons: string | null }

/** What the text itself gives away about being Malaysian - Threads says
    nothing about where a person is, so this is the whole basis. Returned
    with its reasons, in words, so a reader can see what tipped it. */
export function malaysiaSignal(text: string | null | undefined, languageGuess: string | null): MalaysiaSignal {
  const t = (text ?? "").toLowerCase();
  if (!t) return { my_signal: 0, my_reasons: null };
  const reasons: string[] = [];
  let score = 0;
  const places = [...new Set((t.match(MY_PLACES) ?? []).map((p) => p.toLowerCase()))];
  if (places.length) { score += 2; reasons.push(places.slice(0, 2).join(", ")); }
  if (MY_PRICE.test(t)) { score += 2; reasons.push("RM price"); }
  MY_PRICE.lastIndex = 0;
  const msOnly = (t.match(MS_ONLY) ?? []).length;
  const idOnly = (t.match(ID_ONLY) ?? []).length;
  /* Words nobody outside Malaysia writes: one is enough on its own. */
  const strong = [...new Set((t.match(MY_STRONG) ?? []).map((w) => w.toLowerCase()))];
  if (strong.length) { score += 2; reasons.push(`Malaysian word: ${strong.slice(0, 2).join(", ")}`); }
  if (languageGuess === "ms") { score += 2; reasons.push("Malay wording"); }
  else if (msOnly >= 2) { score += 1; reasons.push("Malay words"); }
  if (idOnly > msOnly && idOnly >= 2) { score -= 3; reasons.push("reads Indonesian"); }
  const my_signal = score >= 2 ? 1 : 0;
  return { my_signal, my_reasons: my_signal ? reasons.join(" · ").slice(0, 120) : (reasons.length ? reasons.join(" · ").slice(0, 120) : null) };
}

export function postTraits(text: string | null | undefined, mediaType: string): PostTraits {
  const t = (text ?? "").trim();
  const firstLine = t.split(/\r?\n/)[0]?.slice(0, 160) ?? "";
  const low = t.toLowerCase();
  /* v1.97.0 — three-way. `shared` is the yang/dan/untuk both languages use;
     it says "Malay or Indonesian", and the *_ONLY lists say which. The bar
     is two words, not three: a 13-character post ("BETA - Tudung") was
     "unclear" under the old rule. */
  const shared = (low.match(MS_WORDS) ?? []).length;
  const msOnly = (low.match(MS_ONLY) ?? []).length;
  const idOnly = (low.match(ID_ONLY) ?? []).length;
  const en = (low.match(EN_WORDS) ?? []).length;
  const malayish = shared + msOnly + idOnly;
  let language_guess: string | null = null;
  if (malayish + en >= 2) {
    if (malayish >= en) language_guess = idOnly > msOnly ? "id" : "ms";
    else language_guess = "en";
  }
  return {
    char_count: t.length,
    has_number_hook: /\d/.test(firstLine) ? 1 : 0,
    has_question_hook: firstLine.includes("?") ? 1 : 0,
    has_cta: CTA.test(t) ? 1 : 0,
    has_media: mediaType === "TEXT_POST" || mediaType === "REPOST_FACADE" ? 0 : 1,
    language_guess,
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
  const ask = (fields: string, limit: number) => graph<Page>(q(`${GRAPH}/v1.0/${a.threads_user_id}/threads`, {
    fields, limit, access_token: tok, after: a.sync_cursor ?? undefined,
  }));
  /* v1.96.1 — the first release fell back only on Meta's "unknown field"
     code (100). The A2Z account's first import came back as a bare HTTP 500
     instead, so nothing fell back and the account sat on "history still
     importing" with zero posts. Now every attempt that fails hands over to
     a plainer one: fewer fields, then a smaller page - a 500 on a hundred
     posts is very often fine on twenty-five. Only when the plainest ask
     also fails is the error written up. */
  const attempts: [string, number][] = [[FULL_FIELDS, PAGE], [BASE_FIELDS, PAGE], [BASE_FIELDS, 25]];
  rep.spent++;
  let r = await ask(FULL_FIELDS, PAGE);
  for (let i = 1; !r.ok && i < attempts.length && rep.spent < rep.budget; i++) {
    rep.spent++;
    r = await ask(attempts[i]![0], attempts[i]![1]);
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

/* ------------------------------------------------------------------ *
 * Study cases — what OTHER people post about a subject
 * ------------------------------------------------------------------ */

/* v1.96.2 — whether an account's token can search at all. granted_scopes is
   the scope string asked for when it was connected (0107); a row still NULL
   was connected before the scope existed. Decided here, in SQL, so the
   account list, the topic list and the search route cannot disagree. */
const CAN_SEARCH_SQL = `(a.granted_scopes IS NOT NULL AND instr(a.granted_scopes, 'threads_keyword_search') > 0)`;

/** The account a search asks with: one whose token holds the scope, newest
    first. Null when none does - the caller says "reconnect" and spends
    nothing. */
async function searchAccount(env: Env): Promise<{ threads_user_id: string; username: string } | null> {
  const row = await env.DB.prepare(
    `SELECT a.threads_user_id, a.username FROM threads_accounts a
      WHERE a.is_active = 1 AND ${CAN_SEARCH_SQL} ORDER BY a.connected_at DESC LIMIT 1`,
  ).first<{ threads_user_id: string; username: string }>();
  return row ?? null;
}

/** Searches spent in the last rolling 7 days, and what is left. */
async function searchQuota(env: Env): Promise<{ used: number; left: number; cap: number }> {
  try {
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM threads_searches WHERE ran_at > datetime('now', '-7 days')`,
    ).first<{ n: number }>();
    const used = r?.n ?? 0;
    return { used, left: Math.max(0, SEARCH_WEEK_CAP - used), cap: SEARCH_WEEK_CAP };
  } catch {
    return { used: 0, left: SEARCH_WEEK_CAP, cap: SEARCH_WEEK_CAP };
  }
}

interface FoundPost {
  id: string; text?: string; username?: string; permalink?: string;
  timestamp?: string; media_type?: string;
}

/**
 * One keyword search, stored. Returns how many posts were NEW.
 *
 * The token belongs to a connected account — any of them; the search is not
 * about that account, it only needs a credential to ask with. A 403 here is
 * almost always the missing threads_keyword_search scope on a token minted
 * before v1.96.0, so that reason is passed through verbatim rather than
 * flattened into "search failed".
 */
/* v1.96.1 — Meta names its two parameters the other way round from how the
   first release read them. `search_type` is the ORDER of the answer, TOP or
   RECENT, and nothing else is accepted ("Param search_type must be one of
   {RECENT, TOP}" was the CEO's first result). Whether the words are matched
   in the post or as a topic tag is `search_mode`, KEYWORD or TAG. */
const SEARCH_ORDERS = ["TOP", "RECENT"] as const;
type SearchOrder = (typeof SEARCH_ORDERS)[number];

async function runTopicSearch(
  env: Env, topic: { id: number; query: string; search_type: string }, tok: string, actorId: number,
  /** How many of the two orders to spend a search on. TOP alone when the
      weekly allowance is nearly gone; TOP and RECENT otherwise, so a topic
      re-run next week holds fresh posts as well as the ones that lasted. */
  passes: 1 | 2 = 2,
): Promise<{ ok: true; found: number; scanned: number; note: string | null } | { ok: false; reason: string; needs_reconnect: boolean }> {
  const mode = topic.search_type === "tag" ? "TAG" : "KEYWORD";
  const ask = (order: SearchOrder, withMode: boolean) => graph<{ data?: FoundPost[] }>(
    q(`${GRAPH}/v1.0/keyword_search`, {
      q: topic.query,
      search_type: order,
      search_mode: withMode ? mode : undefined,
      fields: SEARCH_FIELDS,
      access_token: tok,
    }),
  );
  const seen = new Map<string, FoundPost>();
  let note: string | null = null;
  let withMode = true;
  for (const order of SEARCH_ORDERS.slice(0, passes)) {
    let r = await ask(order, withMode);
    if (!r.ok && withMode && r.code === 100 && /search_mode/i.test(r.message)) {
      /* A server that does not know search_mode yet: run it as a plain
         keyword search and say so, rather than fail the topic. */
      withMode = false;
      note = "Topic-tag search is not available on this app yet; the words were searched as keywords instead.";
      r = await ask(order, false);
    }
    if (!r.ok) {
      const needs = /permission|scope|oauth|access/i.test(r.message) || r.code === 10 || r.code === 190 || r.code === 200;
      /* v1.96.2 — Meta's code 1 is its answer to almost everything it will
         not explain, and on this endpoint it nearly always means the APP
         may not search: threads_keyword_search not added to the Threads
         use case in the Meta dashboard. The token here already holds the
         scope (searchAccount saw to that), so the dashboard is the place to
         look, and the message says so instead of "unknown". */
      const reason = r.code === 1
        ? `${r.message} (Meta code 1). The token is fine; this is usually the app itself. In the Meta dashboard open Use cases > Threads API > Customize and add threads_keyword_search, then reconnect the account once and try again.`
        : `${r.message} (Meta code ${r.code})`;
      await env.DB.prepare(
        `INSERT INTO threads_searches (topic_id, ran_by, found, ok) VALUES (?1, ?2, 0, 0)`,
      ).bind(topic.id, actorId).run();
      await env.DB.prepare(`UPDATE threads_topics SET last_run_at = datetime('now'), last_error = ?1 WHERE id = ?2`)
        .bind(reason.slice(0, 300), topic.id).run();
      return { ok: false, reason, needs_reconnect: needs };
    }
    for (const p of r.data.data ?? []) if (p.id && !seen.has(String(p.id))) seen.set(String(p.id), p);
    /* One row per call to Meta - that is what the weekly allowance counts. */
    await env.DB.prepare(`INSERT INTO threads_searches (topic_id, ran_by, found, ok) VALUES (?1, ?2, ?3, 1)`)
      .bind(topic.id, actorId, (r.data.data ?? []).length).run();
  }
  const posts = [...seen.values()];
  /* v1.98.0 — the one observation worth making about a harvest: when every
     post that came back belongs to an account connected to THIS app, Meta is
     answering in Development mode, which only sees the app's own testers.
     Said on the topic in plain words, not red, so nobody concludes the niche
     is one person. */
  let lastNote: string | null = null;
  if (posts.length) {
    const { results: ours } = await env.DB.prepare(`SELECT lower(username) AS u FROM threads_accounts WHERE is_active = 1`).all<{ u: string }>();
    const mine = new Set(ours.map((r) => r.u));
    if (posts.every((p) => p.username && mine.has(p.username.toLowerCase()))) {
      lastNote = `All ${posts.length} post${posts.length === 1 ? "" : "s"} returned belong to accounts connected to this app. That is what a Meta app in Development mode returns - it only sees its own testers. Switch the app to Live in the Meta dashboard (App Mode, top of the page) to search everyone.`;
    }
  }
  const stmts = posts.map((p) => {
    const mt = p.media_type ?? "TEXT_POST";
    const tr = postTraits(p.text, mt);
    /* my_reasons is written as "" rather than NULL when nothing was found:
       NULL is reserved for "not scored yet" (rows from before 0108). */
    const my = malaysiaSignal(p.text, tr.language_guess);
    return env.DB.prepare(
      `INSERT INTO threads_topic_posts (topic_id, media_id, username, text, permalink, media_type, published_at,
                                        char_count, has_number_hook, has_question_hook, has_cta, has_media, language_guess,
                                        my_signal, my_reasons, intent)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
       ON CONFLICT (topic_id, media_id) DO NOTHING`,
    ).bind(
      topic.id, String(p.id), p.username ?? null, p.text ?? null, p.permalink ?? null, mt,
      p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 19).replace("T", " ") : null,
      tr.char_count, tr.has_number_hook, tr.has_question_hook, tr.has_cta, tr.has_media, tr.language_guess,
      my.my_signal, my.my_reasons ?? "", intentOf(p.text),
    );
  });
  stmts.push(
    env.DB.prepare(`UPDATE threads_topics SET last_run_at = datetime('now'), last_error = ?2, last_note = ?3 WHERE id = ?1`)
      .bind(topic.id, note, lastNote),
  );
  const results = await env.DB.batch(stmts);
  /* New = rows the INSERTs actually wrote; a post seen last week is skipped
     by ON CONFLICT and counts as scanned, not found. */
  const found = results.slice(0, posts.length).reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  return { ok: true, found, scanned: posts.length, note };
}

/** Words worth counting: everything that is not scaffolding in either
    language. Deliberately a plain list — a topic model would be an opinion,
    and what the CEO asked for is what the niche SAYS. */
const STOP = new Set(("the a an and or but if of to in on for with at by from as is are was were be been this that these those it its "
  + "you your we our they their he she i me my not no yes do does did so than then there here what which who how why when "
  + "yang dan atau untuk dengan pada di ke dari ini itu saya kita kami anda mereka dia tak tidak ada adalah akan sudah dah "
  + "nak boleh kalau sebab macam pun je lah kan lagi satu dua orang buat kena bila apa siapa mana bagi oleh juga saja").split(" "));

export interface StudyFindings {
  posts: number;
  /* v1.98.0 — demand vs supply, and the words the ASKING posts use */
  intents: { asking: number; selling: number; other: number };
  ask_words: { word: string; n: number }[];
  accounts: number;
  with_media: number;
  median_chars: number | null;
  languages: { code: string; n: number }[];
  lengths: { bucket: string; n: number }[];
  hours: { hour: number; n: number }[];
  traits: { number_hook: number; question_hook: number; cta: number };
  words: { word: string; n: number }[];
}

export function studyFindings(rows: {
  username: string | null; text: string | null; media_type: string | null; published_at: string | null;
  char_count: number; has_number_hook: number; has_question_hook: number; has_cta: number;
  has_media: number; language_guess: string | null; intent?: Intent | null;
}[]): StudyFindings {
  const n = rows.length;
  const intents = { asking: 0, selling: 0, other: 0 };
  const askWords = new Map<string, number>();
  const chars = rows.map((r) => r.char_count).filter((c) => c > 0).sort((a, b) => a - b);
  const lang = new Map<string, number>();
  const hours = new Map<number, number>();
  const words = new Map<string, number>();
  const buckets = { "under 120": 0, "120-300": 0, "300-500": 0, "over 500": 0 } as Record<string, number>;
  for (const r of rows) {
    const it = r.intent ?? "other";
    intents[it]++;
    if (it === "asking") {
      for (const w of (r.text ?? "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
        if (STOP.has(w)) continue;
        askWords.set(w, (askWords.get(w) ?? 0) + 1);
      }
    }
    lang.set(r.language_guess ?? "?", (lang.get(r.language_guess ?? "?") ?? 0) + 1);
    if (r.published_at) {
      const h = (new Date(r.published_at.replace(" ", "T") + "Z").getUTCHours() + 8) % 24;
      if (!Number.isNaN(h)) hours.set(h, (hours.get(h) ?? 0) + 1);
    }
    const c = r.char_count;
    buckets[c < 120 ? "under 120" : c < 300 ? "120-300" : c <= 500 ? "300-500" : "over 500"]!++;
    for (const w of (r.text ?? "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
      if (STOP.has(w)) continue;
      words.set(w, (words.get(w) ?? 0) + 1);
    }
  }
  return {
    posts: n,
    intents,
    ask_words: [...askWords.entries()].map(([word, k]) => ({ word, n: k })).sort((a, b) => b.n - a.n).slice(0, 20),
    accounts: new Set(rows.map((r) => r.username).filter(Boolean)).size,
    with_media: rows.filter((r) => r.has_media).length,
    median_chars: chars.length ? chars[Math.floor(chars.length / 2)]! : null,
    languages: [...lang.entries()].map(([code, k]) => ({ code, n: k })).sort((a, b) => b.n - a.n),
    lengths: Object.entries(buckets).map(([bucket, k]) => ({ bucket, n: k })),
    hours: [...hours.entries()].map(([hour, k]) => ({ hour, n: k })).sort((a, b) => a.hour - b.hour),
    traits: {
      number_hook: rows.filter((r) => r.has_number_hook).length,
      question_hook: rows.filter((r) => r.has_question_hook).length,
      cta: rows.filter((r) => r.has_cta).length,
    },
    words: [...words.entries()].filter(([, k]) => k > 1).map(([word, k]) => ({ word, n: k }))
      .sort((a, b) => b.n - a.n).slice(0, 30),
  };
}

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
                ${CAN_SEARCH_SQL} AS can_search,
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

    /* ================= study cases ================= *
     * Reading a harvest is threads_view - the whole marketing floor should
     * be able to look. SPENDING a search, and creating or removing a topic,
     * is threads_manage: the quota is one shared allowance for the app, and
     * an allowance anyone can empty is an allowance nobody can rely on.
     * ============================================================= */

    if (path === "/topics" && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT t.id, t.label, t.query, t.search_type, t.last_run_at, t.last_error, t.last_note, t.created_at,
                u.name AS created_by_name,
                (SELECT COUNT(*) FROM threads_topic_posts p WHERE p.topic_id = t.id) AS posts,
                (SELECT COUNT(DISTINCT p.username) FROM threads_topic_posts p WHERE p.topic_id = t.id) AS accounts,
                (SELECT COUNT(*) FROM threads_topic_posts p WHERE p.topic_id = t.id AND p.my_signal = 1) AS my_posts,
                (SELECT COUNT(*) FROM threads_topic_posts p WHERE p.topic_id = t.id AND p.intent = 'asking') AS asking_posts
           FROM threads_topics t LEFT JOIN users u ON u.id = t.created_by
          WHERE t.is_active = 1 ORDER BY t.label`,
      ).all();
      /* Whether a search can be spent at all, told BEFORE the button is
         pressed: no connected account, or none whose token holds the
         search scope (connected before v1.96.0 - reconnect once). */
      const anyAccount = await env.DB.prepare(`SELECT 1 AS one FROM threads_accounts WHERE is_active = 1 LIMIT 1`).first();
      const searcher = anyAccount ? await searchAccount(env) : null;
      const search_blocker = !anyAccount ? "no_account" : !searcher ? "needs_reconnect" : null;
      return json({
        topics: results ?? [], quota: await searchQuota(env), can_manage: manage,
        search_ready: !search_blocker, search_blocker, search_account: searcher?.username ?? null,
      });
    }

    if (path === "/topics" && method === "POST") {
      if (!manage) return err("forbidden", "Only management adds a study topic", 403);
      const label = typeof body?.label === "string" ? body.label.trim().slice(0, 60) : "";
      const query = typeof body?.query === "string" ? body.query.trim().slice(0, 100) : "";
      const type = body?.search_type === "tag" ? "tag" : "keyword";
      if (!label || !query) return err("invalid_input", "A name and something to search for are both required", 400);
      const row = await env.DB.prepare(
        `INSERT INTO threads_topics (label, query, search_type, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
      ).bind(label, query, type, user.id).first<{ id: number }>();
      await audit(env, user.id, "threads.topic_add", "threads_topics", String(row?.id), { label, query, search_type: type });
      return json({ ok: true, id: row?.id }, 201);
    }

    {
      const m = path.match(/^\/topics\/(\d+)$/);
      if (m && method === "DELETE") {
        if (!manage) return err("forbidden", "Only management removes a study topic", 403);
        const id = Number(m[1]);
        const t = await env.DB.prepare(`SELECT label FROM threads_topics WHERE id = ?1`).bind(id).first<{ label: string }>();
        if (!t) return err("not_found", "No such topic", 404);
        /* The harvest goes with it: a topic nobody is studying is a table of
           strangers' posts kept for no reason. */
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM threads_topic_posts WHERE topic_id = ?1`).bind(id),
          env.DB.prepare(`UPDATE threads_topics SET is_active = 0 WHERE id = ?1`).bind(id),
        ]);
        await audit(env, user.id, "threads.topic_remove", "threads_topics", String(id), { label: t.label });
        return json({ ok: true });
      }
    }

    {
      const m = path.match(/^\/topics\/(\d+)\/search$/);
      if (m && method === "POST") {
        if (!manage) return err("forbidden", "Only management spends a search - the weekly quota is shared", 403);
        const id = Number(m[1]);
        const topic = await env.DB.prepare(
          `SELECT id, label, query, search_type FROM threads_topics WHERE id = ?1 AND is_active = 1`,
        ).bind(id).first<{ id: number; label: string; query: string; search_type: string }>();
        if (!topic) return err("not_found", "No such topic", 404);
        const quota = await searchQuota(env);
        if (quota.left <= 0) {
          return err("rate_limited", `The weekly search allowance is spent (${quota.used} of ${quota.cap}). It refills as searches older than 7 days fall out.`, 429);
        }
        /* Any connected account's token can ask; the search is not about
           that account. Newest connection first - most likely to hold the
           keyword-search scope. */
        const anyAccount = await env.DB.prepare(`SELECT 1 AS one FROM threads_accounts WHERE is_active = 1 LIMIT 1`).first();
        if (!anyAccount) return err("not_configured", "Connect a Threads account first - a search needs a credential to ask with", 400);
        const acc = await searchAccount(env);
        if (!acc) {
          /* v1.96.2 — refused HERE, spending nothing. Meta answers a token
             without the scope with "An unknown error occurred", which is
             what the CEO saw and nobody could have read as "reconnect". */
          return json({
            ok: false, needs_reconnect: true,
            reason: "The connected account was authorised before search was added, so its token cannot search. Reconnect it once on the Connection section.",
            quota: await searchQuota(env),
          }, 200);
        }
        const tok = await tokenFor(env, acc.threads_user_id);
        if (!tok) return err("not_configured", "That account has no token - connect it again", 400);
        /* Two calls (top posts, then the newest) while the week has room for
           them; the top posts alone when it is nearly spent. */
        const res = await runTopicSearch(env, topic, tok, user.id, quota.left >= 2 ? 2 : 1);
        await audit(env, user.id, "threads.topic_search", "threads_topics", String(id), {
          label: topic.label, query: topic.query, ok: res.ok, found: res.ok ? res.found : 0, scanned: res.ok ? res.scanned : 0,
        });
        if (!res.ok) {
          await logError(env, "threads_search", `${topic.label}: ${res.reason}`);
          return json({
            ok: false, reason: res.reason, needs_reconnect: res.needs_reconnect,
            quota: await searchQuota(env),
          }, 200);
        }
        return json({ ok: true, found: res.found, scanned: res.scanned, note: res.note, quota: await searchQuota(env) });
      }
    }

    /* The harvest for one topic, and what it adds up to. */
    if (path === "/study" && method === "GET") {
      const topicId = Number(params.get("topic") ?? 0) || null;
      if (!topicId) return err("invalid_input", "topic is required", 400);
      const qtext = (params.get("q") ?? "").trim().toLowerCase().slice(0, 80);
      /* v1.97.0 — ?my=1 keeps only posts the text itself marks as Malaysian
         (Malay wording, RM prices, a Malaysian place). Threads carries no
         country, so this is the whole basis, and the reasons travel with
         each row. */
      const onlyMy = params.get("my") === "1";
      const intentQ = params.get("intent");
      const wantIntent: Intent | null = intentQ === "asking" || intentQ === "selling" || intentQ === "other" ? intentQ : null;
      const { results } = await env.DB.prepare(
        `SELECT id, media_id, username, text, permalink, media_type, published_at, char_count,
                has_number_hook, has_question_hook, has_cta, has_media, language_guess, found_at,
                my_signal, my_reasons, intent
           FROM threads_topic_posts WHERE topic_id = ?1
          ORDER BY published_at DESC NULLS LAST, found_at DESC LIMIT 500`,
      ).bind(topicId).all<{
        id: number; media_id: string; username: string | null; text: string | null; permalink: string | null;
        media_type: string | null; published_at: string | null; char_count: number;
        has_number_hook: number; has_question_hook: number; has_cta: number; has_media: number;
        language_guess: string | null; found_at: string; my_signal: number; my_reasons: string | null; intent: Intent | null;
      }>();
      /* Rows harvested before 0108 (my_reasons NULL) are scored now, once,
         and the score is written back so the next open reads it. */
      const unscored = results.filter((r) => r.my_reasons === null || r.intent === null);
      if (unscored.length) {
        const fixes = unscored.slice(0, 100).map((r) => {
          const tr = postTraits(r.text, r.media_type ?? "TEXT_POST");
          const my = malaysiaSignal(r.text, tr.language_guess);
          r.language_guess = tr.language_guess; r.my_signal = my.my_signal; r.my_reasons = my.my_reasons ?? "";
          r.intent = intentOf(r.text);
          return env.DB.prepare(`UPDATE threads_topic_posts SET my_signal = ?1, my_reasons = ?2, language_guess = ?3, intent = ?5 WHERE id = ?4`)
            .bind(r.my_signal, r.my_reasons, r.language_guess, r.id, r.intent);
        });
        await env.DB.batch(fixes);
      }
      const my_total = results.filter((r) => r.my_signal).length;
      const scopedMy = onlyMy ? results.filter((r) => r.my_signal) : results;
      /* The intent counts are of the Malaysia-scoped set, so the chips add up
         to what is on screen before the intent chip narrows it further. */
      const intents = { asking: 0, selling: 0, other: 0 } as Record<Intent, number>;
      for (const r of scopedMy) intents[r.intent ?? "other"]++;
      const scoped = wantIntent ? scopedMy.filter((r) => (r.intent ?? "other") === wantIntent) : scopedMy;
      const rows = qtext ? scoped.filter((r) => (r.text ?? "").toLowerCase().includes(qtext)) : scoped;
      return json({ posts: rows, findings: studyFindings(rows), total: results.length, my_total, only_my: onlyMy, intents, intent: wantIntent });
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
