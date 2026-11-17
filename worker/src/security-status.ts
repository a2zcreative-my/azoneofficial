/* v1.341.0 - SECURITY & SESSIONS, WITH A BOT CHECK IN FRONT OF EVERY SIGN-IN
   (the CEO, 17-11-2026: "make the security session strong to prevent any bot
   or attacker into my system ... before login I can use cloudflare bot
   checking"; his answers: lenient on a Cloudflare outage, a read-only token
   for the WAF figures, an honest file-check status).

   1. botCheck() - Cloudflare Turnstile, verified on the SERVER before any
      password, passkey, Google, registration or set-password work. Off until
      BOTH keys exist (TURNSTILE_SITE_KEY var + TURNSTILE_SECRET secret), so a
      deploy without them locks nobody out. A missing or refused token is
      refused (403 bot_check_failed). When Cloudflare's check itself cannot be
      reached (network error, 5xx, or its own internal-error), the sign-in
      goes on - the owner's "lenient on outage" - and the outage is counted.
      Nothing else changes: the rate limits, 2FA, passkey stages and the
      recovery panel are exactly what they were.

   2. securityStatus() - ONE read for the Overview and System health strips.
      Every figure comes from something that exists: the sessions table, the
      bot-check counters below, Cloudflare's own analytics (only with a
      read-only token, CF_API_TOKEN + CF_ZONE_ID), the upload rules in
      shared.ts, and the newest backup. A source that is not there says
      "not connected"; nothing is assumed to be on.

   Counters are one system_meta row per day (bot_refused:YYYY-MM-DD,
   bot_outage:YYYY-MM-DD, MYT), not an audit row per bot - an attack must not
   be able to fill the audit log. */

import type { Env } from "./index";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const CF_GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

export const botCheckOn = (env: Env): boolean => Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);
/** what the sign-in page needs to draw the check: the PUBLIC site key, or nothing */
export const botCheckPublic = (env: Env): { site_key: string } | null => (botCheckOn(env) ? { site_key: env.TURNSTILE_SITE_KEY! } : null);

const mytDay = (offsetDays = 0): string => new Date(Date.now() + 8 * 3600_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);

async function bump(env: Env, kind: "bot_refused" | "bot_outage"): Promise<void> {
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES (?1, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`).bind(`${kind}:${mytDay()}`),
      /* keep thirty days of counters, never more */
      env.DB.prepare(`DELETE FROM system_meta WHERE key LIKE ?1 AND key < ?2`).bind(`${kind}:%`, `${kind}:${mytDay(30)}`),
    ]);
  } catch { /* a counter never blocks a sign-in */ }
}

export type BotVerdict = { ok: true; mode: "off" | "passed" | "outage" } | { ok: false; code: "bot_check_required" | "bot_check_failed" };

type Siteverify = { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };

/** Ask Cloudflare. null = Cloudflare's check could not be reached (network, 5xx, its own internal-error). */
async function siteverify(env: Env, request: Request, token: string): Promise<Siteverify | null> {
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET!);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  form.append("idempotency_key", crypto.randomUUID());
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    if (res.status >= 500) return null;
    const out = (await res.json().catch(() => null)) as Siteverify | null;
    if (!out || (out["error-codes"] ?? []).includes("internal-error")) return null;
    return out;
  } catch { return null; }
}

/** Verify one Turnstile token for one door. `action` is the widget's action
    ("signin" on the sign-in page for password, Google and passkey; "set_password";
    "register"). Never throws. */
export async function botCheck(env: Env, request: Request, token: unknown, action: string): Promise<BotVerdict> {
  if (!botCheckOn(env)) return { ok: true, mode: "off" };
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    /* No token. The page could not get one only if Cloudflare's challenge was
       unreachable for the browser too - so ask Cloudflare: if it cannot be
       reached from here either, this is an outage (the owner's lenient rule);
       if it answers, the missing token is refused. */
    const probe = await siteverify(env, request, "probe-no-token");
    if (probe === null) { await bump(env, "bot_outage"); return { ok: true, mode: "outage" }; }
    await bump(env, "bot_refused");
    return { ok: false, code: "bot_check_required" };
  }
  const out = await siteverify(env, request, token);
  if (out === null) { await bump(env, "bot_outage"); return { ok: true, mode: "outage" }; }
  /* a token made for another door (or another site) is not this one's */
  const hostOk = !out.hostname || allowedHosts(env).has(out.hostname);
  if (out.success === true && (!out.action || out.action === action) && hostOk) return { ok: true, mode: "passed" };
  await bump(env, "bot_refused");
  return { ok: false, code: "bot_check_failed" };
}

function allowedHosts(env: Env): Set<string> {
  const list = [env.ALLOWED_ORIGIN, ...(env.ALLOWED_ORIGINS ?? "").split(",")].map((s) => s.trim()).filter(Boolean);
  const hosts = new Set<string>();
  for (const o of list) { try { const h = new URL(o).hostname; hosts.add(h); hosts.add(h.startsWith("www.") ? h.slice(4) : `www.${h}`); } catch { /* not a URL */ } }
  return hosts;
}

export const BOT_REFUSED_MESSAGE = "Please complete the security check and try again.";

/* ------------------------------------------------------------------ */

/* v1.341.2 - the two figures are asked for SEPARATELY. On 17-11-2026 one
   combined query came back "zone ... does not have access to the path" - one
   dataset refused (a plan or a token limit) - and that one refusal hid the
   other figure too. Now each dataset is its own request: what the zone and the
   token allow is shown, and what Cloudflare refuses is named with its reason. */
type Part<T> = { ok: true; value: T } | { ok: false; error: string };
type CfFigures =
  | { connected: false }
  | { connected: true; traffic: Part<{ requests_24h: number; threats_24h: number }>; firewall: Part<{ total_24h: number; by_action: { action: string; count: number }[] }> };

async function cfQuery(env: Env, query: string, variables: Record<string, unknown>): Promise<Part<Record<string, unknown>>> {
  try {
    const r = await fetch(CF_GRAPHQL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { zone: env.CF_ZONE_ID, ...variables } }),
      signal: AbortSignal.timeout(6000),
    });
    const j = (await r.json().catch(() => null)) as { data?: { viewer?: { zones?: Record<string, unknown>[] } }; errors?: { message?: string }[] | null } | null;
    if (!r.ok || !j) return { ok: false, error: `Cloudflare answered ${r.status}` };
    if (j.errors?.length) return { ok: false, error: String(j.errors[0]?.message ?? "Cloudflare refused the read").slice(0, 200) };
    const z = j.data?.viewer?.zones?.[0];
    return z ? { ok: true, value: z } : { ok: false, error: "The zone was not found for this token" };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/** Cloudflare's own analytics for the zone, last 24 hours - only with a read-only token */
export async function cloudflareFigures(env: Env): Promise<CfFigures> {
  if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return { connected: false };
  const until = new Date();
  const since = new Date(until.getTime() - 24 * 3600_000);
  const hour = (d: Date) => new Date(Math.floor(d.getTime() / 3600_000) * 3600_000).toISOString();
  const [http, fw] = await Promise.all([
    cfQuery(env, `query($zone: String!, $since: Time!, $until: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
      http: httpRequests1hGroups(limit: 25, filter: { datetime_geq: $since, datetime_lt: $until }) { sum { requests threats } } } } }`,
      { since: hour(since), until: hour(until) }),
    cfQuery(env, `query($zone: String!, $since: Time!, $until: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
      fw: firewallEventsAdaptiveGroups(limit: 20, filter: { datetime_geq: $since, datetime_leq: $until }) { count dimensions { action } } } } }`,
      { since: since.toISOString(), until: until.toISOString() }),
  ]);
  const traffic: Part<{ requests_24h: number; threats_24h: number }> = http.ok
    ? { ok: true, value: ((http.value.http ?? []) as { sum: { requests: number; threats: number } }[]).reduce((a, g) => ({ requests_24h: a.requests_24h + Number(g.sum.requests || 0), threats_24h: a.threats_24h + Number(g.sum.threats || 0) }), { requests_24h: 0, threats_24h: 0 }) }
    : http;
  let firewall: Part<{ total_24h: number; by_action: { action: string; count: number }[] }>;
  if (fw.ok) {
    const byAction = new Map<string, number>();
    for (const g of (fw.value.fw ?? []) as { count: number; dimensions: { action: string } }[]) byAction.set(g.dimensions.action, (byAction.get(g.dimensions.action) ?? 0) + Number(g.count || 0));
    firewall = { ok: true, value: { total_24h: [...byAction.values()].reduce((a, n) => a + n, 0), by_action: [...byAction].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count) } };
  } else firewall = fw;
  return { connected: true, traffic, firewall };
}

/** The upload rules as they are in shared.ts (MAGIC + the per-route size caps) - no antivirus */
export const FILE_CHECKS = {
  antivirus: false,
  type_signature: true,
  size_cap: true,
  note: "Every upload is checked for its size limit and that its first bytes match its declared type. Files are not scanned for viruses.",
} as const;

export interface SessionRow { user_id: number; name: string; role: string; user_agent: string | null; last_seen_at: string | null; created_at: string | null; expires_at: string }

export async function securityStatus(env: Env, newestBackup: () => Promise<{ key: string; size: number; uploaded: string } | null>): Promise<Record<string, unknown>> {
  /* active sessions: unexpired, staff accounts that are on */
  let sessions: SessionRow[] = [];
  let sessionsError: string | null = null;
  const staffWhere = `s.expires_at > datetime('now') AND u.is_active = 1 AND u.role NOT IN ('customer', 'agent')`;
  try {
    sessions = (await env.DB.prepare(
      `SELECT s.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role, s.user_agent, s.last_seen_at, s.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE ${staffWhere}
        ORDER BY COALESCE(s.last_seen_at, s.created_at) DESC LIMIT 200`,
    ).all<SessionRow>()).results;
  } catch {
    try {
      sessions = (await env.DB.prepare(
        `SELECT s.user_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.role, NULL AS user_agent, NULL AS last_seen_at, NULL AS created_at, s.expires_at
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE ${staffWhere} LIMIT 200`,
      ).all<SessionRow>()).results;
    } catch (e) { sessionsError = String(e).slice(0, 120); }
  }
  /* active in the last 30 minutes = last_seen_at, which is written at most every ten */
  const recentCut = new Date(Date.now() - 30 * 60_000).toISOString().replace("T", " ").slice(0, 19);
  const activeNow = sessions.filter((s) => (s.last_seen_at ?? "") >= recentCut).length;

  const counter = async (kind: string): Promise<{ today: number; yesterday: number }> => {
    try {
      const rows = (await env.DB.prepare(`SELECT key, value FROM system_meta WHERE key IN (?1, ?2)`).bind(`${kind}:${mytDay()}`, `${kind}:${mytDay(1)}`).all<{ key: string; value: string }>()).results;
      const get = (d: string) => Number(rows.find((r) => r.key === `${kind}:${d}`)?.value ?? 0) || 0;
      return { today: get(mytDay()), yesterday: get(mytDay(1)) };
    } catch { return { today: 0, yesterday: 0 }; }
  };

  let errors24h = 0;
  try { errors24h = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM error_log WHERE created_at >= datetime('now', '-1 day')`).first<{ n: number }>())?.n ?? 0); } catch { /* pre-0024 */ }

  let backup: { uploaded: string; size: number } | null = null;
  try { const b = await newestBackup(); if (b) backup = { uploaded: b.uploaded, size: b.size }; } catch { /* null */ }
  let offsite: string | null = null;
  try { offsite = (await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'last_offsite_export'`).first<{ value: string }>())?.value ?? null; } catch { /* none */ }

  return {
    as_of: new Date().toISOString(),
    sessions: { count: sessions.length, active_30m: activeNow, people: new Set(sessions.map((s) => s.user_id)).size, rows: sessions, error: sessionsError },
    bot_check: { enabled: botCheckOn(env), refused: await counter("bot_refused"), outage: await counter("bot_outage"), on_outage: "allow" },
    cloudflare: await cloudflareFigures(env),
    files: FILE_CHECKS,
    platform: { errors_24h: errors24h },
    backup: { last: backup, retention_runs: 30, offsite_last: offsite, bucket_bound: !!env.BACKUPS },
  };
}
