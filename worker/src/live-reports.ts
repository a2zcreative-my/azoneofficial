/* v1.315.0 - TASKS WORKSPACE 5.0, GATE 4: THE LIVE HOST REPORT (TK-1, TK-14;
 * L2 and L3 of 12-11-2026).
 *
 * v1.368.0 - LIVE REPORTS, REVISION 18-11-2026 (the CEO's directive and
 * picture; claude/LIVE-REPORTS-AUDIT-REV-18NOV.md, decisions C1-C3):
 *
 *   WHO   Any staff member who performed the live - host, co-host, assistant
 *         or salesperson - is a PARTICIPANT (live_participants, 0210) and may
 *         start, fill and submit its ONE report (live_reports.session_id is
 *         UNIQUE: a second participant works on the same report, never a new
 *         one, so a live's GMV is counted once).
 *   WHERE A live not on the roster is reported as an OWN live (the company's
 *         own channel - the company is chosen, A2Z or AZ ONE) or as a live FOR
 *         an ACTIVE PROJECT (v1.385.0, the CEO 18-11-2026: "Project is option
 *         if require"). The server creates the roster entry as unplanned first. If a live of
 *         the same project and platform overlaps that time on that day - or
 *         one the reporter already takes part in - the existing live is used,
 *         never a second one.
 *   WHAT  A report MAY name an active project (client and company then come
 *         from it); without one it names its company itself - never guessed,
 *         a submit with no company is refused. It holds ten figures confirmed
 *         by staff. A screenshot may be
 *         read by Cloudflare Workers AI ONLY (no other provider, no key): the
 *         reading is stored apart (live_report_ai_readings) and staff confirm
 *         or correct every figure. The AI is off until the CEO turns it on,
 *         reserves its budget before every call (ai_budget: a hard daily cap
 *         and a Neuron ceiling under the free 10,000 a day) and never blocks a
 *         report: refused, failed or slow means typing by hand, at once.
 *   WHY   Analysis is RULE-BASED, never AI: GMV/hour, conversion and average
 *         order value against earlier lives of the same host, project and
 *         platform, three flags, fixed suggestions.
 *   CHECK One review by the CEO, COO or CCO (live_report_review) - never by
 *         anyone who took part in that live (L3, now for every participant).
 *
 * REPORTED GMV IS THE STAFF'S OWN FIGURE. It is never verified sales, cash,
 * an invoice paid, commission or payroll: nothing here reads or writes those
 * tables. Versions, screenshots, AI readings and reviews are kept: 0201 and
 * 0210 triggers refuse a rewrite or a delete.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { currentStaffSql, notify } from "./staff";
import { canUser } from "./permissions";
import { audit, err, json, logError, putGuarded } from "./shared";

type Report = {
  id: number; session_id: number; host_user_id: number; company: string | null; state: string; current_version: number;
  draft_gmv_cents: number | null; draft_duration_min: number | null; draft_highlights: string | null; draft_blockers: string | null; draft_next_actions: string | null;
  draft_viewers: number | null; draft_peak_viewers: number | null; draft_avg_watch_sec: number | null; draft_orders: number | null;
  draft_items_sold: number | null; draft_product_clicks: number | null; draft_ctr_bp: number | null; draft_conversion_bp: number | null;
  created_at: string; updated_at: string;
};
type Session = { id: number; session_date: string; start_time: string; end_time: string | null; platform: string; status: string; host_user_id: number; client_name: string | null; project_id: number | null; unplanned: number };
type Participant = { user_id: number; role: string; name: string; photo_key: string | null };

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 4;
const ROLES = ["host", "co_host", "assistant", "sales"] as const;
const PLATFORMS = ["tiktok", "shopee", "other"] as const;
const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

/* the ten figures: [draft column, version column, the request key, unit] */
export const FIGURES = [
  ["draft_gmv_cents", "gmv_cents", "gmv", "rm"],
  ["draft_viewers", "viewers", "viewers", "count"],
  ["draft_peak_viewers", "peak_viewers", "peak_viewers", "count"],
  ["draft_avg_watch_sec", "avg_watch_sec", "avg_watch_sec", "seconds"],
  ["draft_orders", "orders", "orders", "count"],
  ["draft_items_sold", "items_sold", "items_sold", "count"],
  ["draft_product_clicks", "product_clicks", "product_clicks", "count"],
  ["draft_ctr_bp", "ctr_bp", "ctr", "percent"],
  ["draft_conversion_bp", "conversion_bp", "conversion", "percent"],
  ["draft_duration_min", "duration_min", "duration_min", "minutes"],
] as const;

/** A figure from the request, in its stored unit; undefined = not sent, null = cleared, NaN = invalid. */
function figure(v: unknown, unit: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  if (unit === "rm") return n > 100_000_000 ? Number.NaN : Math.round(n * 100);
  if (unit === "percent") return n > 100 ? Number.NaN : Math.round(n * 100); // basis points
  if (unit === "minutes") return n > 24 * 60 ? Number.NaN : Math.round(n);
  if (unit === "seconds") return n > 24 * 3600 ? Number.NaN : Math.round(n);
  return n > 1_000_000_000 ? Number.NaN : Math.round(n);
}

function pending(e: unknown): Response | null {
  return /no such table|no such column/i.test(String(e)) ? err("pending_migration", "Run PUSH.bat so migrations 0201 and 0210 apply, then retry", 409) : null;
}

async function sessionOf(env: Env, id: number): Promise<Session | null> {
  return await env.DB.prepare(`SELECT id, session_date, start_time, end_time, platform, status, host_user_id, client_name, project_id, unplanned FROM live_sessions WHERE id = ?1`).bind(id).first<Session>();
}
async function reportOf(env: Env, id: number): Promise<Report | null> {
  return await env.DB.prepare(`SELECT * FROM live_reports WHERE id = ?1`).bind(id).first<Report>();
}
/** Who took part: the roster host (read from the roster entry, never copied) and every participant row. */
const PART_SQL = `SELECT s.id AS session_id, s.host_user_id AS user_id, 'host' AS role, 0 AS ord FROM live_sessions s
                   WHERE NOT EXISTS (SELECT 1 FROM live_participants x WHERE x.session_id = s.id AND x.user_id = s.host_user_id)
                  UNION ALL SELECT p.session_id, p.user_id, p.role, CASE p.role WHEN 'host' THEN 0 WHEN 'co_host' THEN 1 WHEN 'assistant' THEN 2 ELSE 3 END + p.id FROM live_participants p`;
/** "user ?N took part in live s" - the one test used by every route */
const tookPart = (n: number, s = "s") => `(${s}.host_user_id = ?${n} OR EXISTS (SELECT 1 FROM live_participants pp WHERE pp.session_id = ${s}.id AND pp.user_id = ?${n}))`;
async function participantsOf(env: Env, sessionId: number): Promise<Participant[]> {
  return ((await env.DB.prepare(
    `SELECT a.user_id, a.role, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.photo_key
       FROM (${PART_SQL}) a JOIN users u ON u.id = a.user_id WHERE a.session_id = ?1 ORDER BY a.ord`,
  ).bind(sessionId).all<Participant>()).results ?? []);
}
async function isParticipant(env: Env, sessionId: number, userId: number): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT 1 AS ok FROM live_sessions s WHERE s.id = ?2 AND ${tookPart(1)}`).bind(userId, sessionId).first());
}
/** a staff member who may take part in a live: on staff today, never a customer or an agent */
async function staffOk(env: Env, userId: number): Promise<{ name: string } | null> {
  return await env.DB.prepare(
    `SELECT COALESCE(NULLIF(TRIM(full_name), ''), name) AS name FROM users u
      WHERE u.id = ?1 AND u.is_active = 1 AND u.role NOT IN ('customer', 'agent', 'super_admin', 'admin') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0) AND ${currentStaffSql("u.")}`,
  ).bind(userId).first<{ name: string }>();
}
/** an ACTIVE project and what follows from it: the client and the company (the quotation's issuer) */
/** v1.369.0 - the project's sales document, for the tag staff check before they report: the live
    invoice of its quotation when there is one (never a voided one), else the quotation itself. */
const DOC_COLS = (pj: string) => `(SELECT q.doc_number FROM sales_documents q WHERE q.id = ${pj}.quotation_id) AS qt_number,
  (SELECT i.doc_number FROM sales_documents i WHERE i.doc_type = 'INV' AND i.converted_from = ${pj}.quotation_id AND COALESCE(i.payment_status, '') != 'void' ORDER BY i.id DESC LIMIT 1) AS inv_number`;
type DocNums = { qt_number: string | null; inv_number: string | null };
async function projectOf(env: Env, id: number): Promise<({ id: number; title: string; client: string | null; company: "a2z" | "azoo"; status: string } & DocNums) | null> {
  const p = await env.DB.prepare(
    `SELECT p.id, p.title, p.status, c.company AS client, d.issuer_code, ${DOC_COLS("p")}
       FROM projects p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN sales_documents d ON d.id = p.quotation_id
      WHERE p.id = ?1`,
  ).bind(id).first<{ id: number; title: string; status: string; client: string | null; issuer_code: string | null } & DocNums>();
  if (!p) return null;
  /* 0073: a NULL issuer is a legacy document of AZ ONE OFFICIAL */
  return { id: p.id, title: p.title, client: p.client, status: p.status, company: p.issuer_code === "a2z" ? "a2z" : "azoo", qt_number: p.qt_number, inv_number: p.inv_number };
}
const ACTIVE_PROJECT = ["draft", "ready", "in_progress", "waiting_client", "on_hold"];
/** The reviewers to tell: the CEO, COO and CCO on staff who did NOT take part. */
async function reviewers(env: Env, sessionId: number): Promise<number[]> {
  const rows = (await env.DB.prepare(
    `SELECT id FROM users u WHERE u.is_active = 1 AND u.role IN ('ceo', 'coo', 'cco') AND ${currentStaffSql("u.")}
        AND NOT EXISTS (SELECT 1 FROM live_sessions s WHERE s.id = ?1 AND (s.host_user_id = u.id OR EXISTS (SELECT 1 FROM live_participants p WHERE p.session_id = s.id AND p.user_id = u.id)))`,
  ).bind(sessionId).all<{ id: number }>()).results ?? [];
  return rows.map((r) => r.id);
}

/* ======================================================================= */
/* Rule-based analysis - no AI                                             */
/* ======================================================================= */

type Live = { report_id: number; session_id: number; session_date: string; start_time: string; platform: string; project_id: number | null; host_user_id: number;
  gmv_cents: number; viewers: number | null; orders: number | null; duration_min: number | null; avg_watch_sec: number | null; peak_viewers: number | null };
export type Flag = { key: "viewers_high_orders_low" | "conversion_below_project" | "gmv_down_three"; title: string; detail: string; tips: string[] };

export const derived = (l: Pick<Live, "gmv_cents" | "viewers" | "orders" | "duration_min">) => ({
  gmv_per_hour_cents: l.duration_min ? Math.round(l.gmv_cents / (l.duration_min / 60)) : null,
  conversion: l.viewers ? (l.orders ?? 0) / l.viewers : null,
  aov_cents: l.orders ? Math.round(l.gmv_cents / l.orders) : null,
});
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/** The fixed suggestions, one set per flag (the CEO's directive 4). */
export const TIPS: Record<Flag["key"], string[]> = {
  viewers_high_orders_low: ["Strengthen the call-to-action every 5-10 minutes.", "Highlight the key offer and a limited-time deal.", "Show the product benefits with real use or a demo."],
  conversion_below_project: ["Pin the best-selling product and repeat its price and offer.", "Answer buying questions in the comments live.", "Use a bundle or a free gift to lift orders per viewer."],
  gmv_down_three: ["Review the last three lives with the host before the next one.", "Change the opening hook and the product order.", "Check the schedule: day, time and length against better lives."],
};

/** Flags for one live against the earlier confirmed lives of the same host, project and platform. */
export function flagsFor(l: Live, earlier: Live[]): { flags: Flag[]; baseline: Record<string, unknown> } {
  const me = derived(l);
  const sameProject = earlier.filter((e) => l.project_id !== null && e.project_id === l.project_id);
  const sameHost = earlier.filter((e) => e.host_user_id === l.host_user_id);
  const samePlatform = earlier.filter((e) => e.platform === l.platform);
  const conv = (xs: Live[]) => avg(xs.map((e) => derived(e).conversion));
  const base = {
    host: { lives: sameHost.length, avg_gmv_cents: avg(sameHost.map((e) => e.gmv_cents)), avg_viewers: avg(sameHost.map((e) => e.viewers)), avg_conversion: conv(sameHost), avg_gmv_per_hour_cents: avg(sameHost.map((e) => derived(e).gmv_per_hour_cents)) },
    project: { lives: sameProject.length, avg_gmv_cents: avg(sameProject.map((e) => e.gmv_cents)), avg_viewers: avg(sameProject.map((e) => e.viewers)), avg_conversion: conv(sameProject), avg_gmv_per_hour_cents: avg(sameProject.map((e) => derived(e).gmv_per_hour_cents)) },
    platform: { lives: samePlatform.length, avg_gmv_cents: avg(samePlatform.map((e) => e.gmv_cents)), avg_viewers: avg(samePlatform.map((e) => e.viewers)), avg_conversion: conv(samePlatform), avg_gmv_per_hour_cents: avg(samePlatform.map((e) => derived(e).gmv_per_hour_cents)) },
  };
  const flags: Flag[] = [];
  /* F-1: viewers above the usual level, conversion clearly below it */
  const refViewers = base.project.avg_viewers ?? base.host.avg_viewers;
  const refConv = base.project.avg_conversion ?? base.host.avg_conversion;
  if (l.viewers !== null && me.conversion !== null && refViewers !== null && refConv !== null
    && l.viewers >= refViewers * 1.2 && me.conversion < refConv * 0.8) {
    flags.push({ key: "viewers_high_orders_low", title: "Viewers high, orders low",
      detail: `Viewers ${l.viewers.toLocaleString("en-MY")} (${Math.round((l.viewers / refViewers - 1) * 100)}% above usual) but conversion ${pct(me.conversion)} (usual ${pct(refConv)}).`, tips: TIPS.viewers_high_orders_low });
  }
  /* F-2: conversion below the project's average (needs two earlier lives of the project) */
  if (me.conversion !== null && sameProject.length >= 2 && base.project.avg_conversion !== null && me.conversion < base.project.avg_conversion * 0.9) {
    flags.push({ key: "conversion_below_project", title: "Conversion below project average",
      detail: `Conversion ${pct(me.conversion)} against the project's ${pct(base.project.avg_conversion)} over ${sameProject.length} earlier lives.`, tips: TIPS.conversion_below_project });
  }
  /* F-3: GMV fell three lives running on the project (this live and the two before) */
  const last = [...sameProject].sort((a, b) => `${b.session_date} ${b.start_time}`.localeCompare(`${a.session_date} ${a.start_time}`));
  if (last.length >= 2 && l.gmv_cents < last[0]!.gmv_cents && last[0]!.gmv_cents < last[1]!.gmv_cents) {
    flags.push({ key: "gmv_down_three", title: "GMV declining for three consecutive lives",
      detail: `RM ${(last[1]!.gmv_cents / 100).toFixed(2)} → RM ${(last[0]!.gmv_cents / 100).toFixed(2)} → RM ${(l.gmv_cents / 100).toFixed(2)} on this project.`, tips: TIPS.gmv_down_three });
  }
  return { flags, baseline: base };
}

/** The confirmed (submitted) lives, newest first - the analysis only ever reads these. */
async function confirmedLives(env: Env, where = "1 = 1", binds: unknown[] = []): Promise<Live[]> {
  return ((await env.DB.prepare(
    `SELECT r.id AS report_id, s.id AS session_id, s.session_date, s.start_time, s.platform, s.project_id, s.host_user_id,
            v.gmv_cents, v.viewers, v.orders, v.duration_min, v.avg_watch_sec, v.peak_viewers
       FROM live_reports r JOIN live_sessions s ON s.id = r.session_id
       JOIN live_report_versions v ON v.report_id = r.id AND v.version = r.current_version
      WHERE r.state IN ('submitted', 'reviewed', 'accepted') AND ${where}
      ORDER BY s.session_date DESC, s.start_time DESC LIMIT 500`,
  ).bind(...binds).all<Live>()).results ?? []);
}
async function analysisOf(env: Env, reportId: number) {
  const all = await confirmedLives(env);
  const me = all.find((l) => l.report_id === reportId);
  if (!me) return null;
  const earlier = all.filter((l) => `${l.session_date} ${l.start_time}` < `${me.session_date} ${me.start_time}`);
  return { ...derived(me), ...flagsFor(me, earlier.slice(0, 200)) };
}

/* ======================================================================= */
/* Cloudflare Workers AI - figures only, free daily allocation only        */
/* ======================================================================= */

export const AI_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
/** Workers AI gives every account 10,000 Neurons a day free; the ceiling stays
    under it with a margin, and the reservation is the worst case of one read. */
export const FREE_NEURONS_A_DAY = 10_000;
export const NEURON_CEILING_MAX = 8_000;
export const RESERVE_NEURONS = 400;
const AI_TIMEOUT_MS = 25_000;
type AiSettings = { enabled: boolean; cap: number; ceiling: number; accepted_by?: number | null; accepted_at?: string | null };
const AI_DEFAULT: AiSettings = { enabled: false, cap: 30, ceiling: NEURON_CEILING_MAX };

export async function aiSettings(env: Env): Promise<AiSettings> {
  const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'live_ai_settings'`).first<{ value: string }>().catch(() => null);
  try { return { ...AI_DEFAULT, ...(row?.value ? JSON.parse(row.value) as Partial<AiSettings> : {}) }; } catch { return AI_DEFAULT; }
}
export async function aiUsageToday(env: Env) {
  const s = await aiSettings(env);
  const u = await env.DB.prepare(`SELECT calls, neurons, refused, failed FROM ai_budget WHERE day = ?1`).bind(mytToday()).first<{ calls: number; neurons: number; refused: number; failed: number }>().catch(() => null);
  const bound = Boolean((env as unknown as { AI?: unknown }).AI);
  const calls = u?.calls ?? 0, neurons = u?.neurons ?? 0;
  const fallback = !bound ? "not_bound" : !s.enabled ? "off" : calls >= s.cap ? "cap_reached" : neurons + RESERVE_NEURONS > s.ceiling ? "ceiling_reached" : null;
  return { day: mytToday(), model: AI_MODEL, enabled: s.enabled, bound, cap: s.cap, ceiling: s.ceiling, free_neurons_a_day: FREE_NEURONS_A_DAY,
    screenshots: calls, neurons, refused: u?.refused ?? 0, failed: u?.failed ?? 0, fallback, manual_entry: fallback !== null };
}

/** The local test server may stand in a fixed reading - only on a 127.0.0.1 origin, never on a2zcreative.my. */
function testFake(env: Env): string | null {
  const v = (env as unknown as { LIVE_AI_TEST_FAKE?: string }).LIVE_AI_TEST_FAKE ?? "";
  const local = /^http:\/\/127\.0\.0\.1:\d+$/.test(((env as unknown as { ALLOWED_ORIGINS?: string }).ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN ?? "").split(",")[0]!.trim());
  return local && v ? v : null;
}

const PROMPT = `You read the summary screen of a live-selling session (TikTok LIVE, Shopee Live or similar). Reply with ONE JSON object and nothing else, with these keys, each a number or null when it is not visible:
{"gmv": ringgit amount, "viewers": total viewers, "peak_viewers": peak concurrent viewers, "avg_watch_sec": average watch time in seconds, "orders": orders, "items_sold": items sold, "product_clicks": product clicks, "ctr": click-through rate in percent, "conversion": conversion rate in percent, "duration_min": live duration in minutes}
Read only what is printed. Never guess or calculate a figure that is not shown.`;

/** Clean what the model returned into the ten figures (numbers only; nonsense is dropped). */
export function parseReading(raw: string): Record<string, number | null> | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    if (typeof v === "string") {
      const t = v.trim();
      if (/^\d{1,2}:\d{2}:\d{2}$/.test(t)) { const [h, mi, s] = t.split(":").map(Number); return h! * 3600 + mi! * 60 + s!; }
      if (/^\d{1,3}:\d{2}$/.test(t)) { const [mi, s] = t.split(":").map(Number); return mi! * 60 + s!; }
      const n = Number(t.replace(/^RM\s*/i, "").replace(/[,%\s]/g, "").replace(/k$/i, "e3"));
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    return null;
  };
  const out: Record<string, number | null> = {};
  let any = false;
  for (const [, , key] of FIGURES) { const v = num(o[key]); out[key] = v; if (v !== null) any = true; }
  /* a duration given as "01:28:40" arrives in seconds - the field is minutes */
  if (typeof o.duration_min === "string" && /:/.test(o.duration_min) && out.duration_min !== null) out.duration_min = Math.round(out.duration_min! / 60);
  if (out.ctr !== null && out.ctr! > 100) out.ctr = null;
  if (out.conversion !== null && out.conversion! > 100) out.conversion = null;
  return any ? out : null;
}

/** One read: reserve first (a conditional update - concurrent reads cannot pass the cap or the ceiling),
    call with a timeout, settle the Neurons used. Every refusal or failure means manual entry. */
/** v1.370.0 - the image goes to Workers AI as a base64 data URL, the form Cloudflare's own Llama 3.2
    Vision tutorial uses. 1.368.0 sent it as an array of numbers, which for a phone screenshot is
    millions of entries and was refused ("The AI failed" on 18-11-2026). */
function dataUrl(bytes: Uint8Array, type: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type || "image/png"};base64,${btoa(bin)}`;
}
async function readScreenshot(env: Env, bytes: Uint8Array, type = "image/png"): Promise<{ ok: true; figures: Record<string, number | null> | null; neurons: number; model: string } | { ok: false; reason: string; detail?: string }> {
  const s = await aiSettings(env);
  const ai = (env as unknown as { AI?: { run: (m: string, i: unknown) => Promise<unknown> } }).AI;
  const fake = testFake(env);
  if (!ai && !fake) return { ok: false, reason: "not_bound" };
  if (!s.enabled) return { ok: false, reason: "off" };
  const day = mytToday();
  const ceiling = Math.min(s.ceiling, NEURON_CEILING_MAX);
  await env.DB.prepare(`INSERT INTO ai_budget (day) VALUES (?1) ON CONFLICT(day) DO NOTHING`).bind(day).run();
  const got = await env.DB.prepare(
    `UPDATE ai_budget SET calls = calls + 1, neurons = neurons + ?2 WHERE day = ?1 AND calls < ?3 AND neurons + ?2 <= ?4 RETURNING calls`,
  ).bind(day, RESERVE_NEURONS, s.cap, ceiling).first<{ calls: number }>();
  if (!got) {
    await env.DB.prepare(`UPDATE ai_budget SET refused = refused + 1 WHERE day = ?1`).bind(day).run();
    const u = await env.DB.prepare(`SELECT calls FROM ai_budget WHERE day = ?1`).bind(day).first<{ calls: number }>();
    return { ok: false, reason: (u?.calls ?? 0) >= s.cap ? "cap_reached" : "ceiling_reached" };
  }
  const settle = async (used: number, failed: boolean) => {
    await env.DB.prepare(`UPDATE ai_budget SET neurons = MAX(0, neurons - ?2 + ?3), failed = failed + ?4 WHERE day = ?1`).bind(day, RESERVE_NEURONS, used, failed ? 1 : 0).run();
  };
  try {
    let raw: string; let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (fake) {
      if (fake === "fail") throw new Error("test failure");
      raw = fake; usage = { prompt_tokens: 2000, completion_tokens: 120 };
    } else {
      const image = dataUrl(bytes, type);
      /* v1.372.0 - Cloudflare refused 1.370.0's request with 3030 "Unable to add image when there are no
         user-supplied nor system-supplied messages" (System health, 18-11-2026 18:25): the image went
         without any messages.
         v1.374.0 - the FIRST layout is now the one Cloudflare's own Llama 3.2 Vision tutorial uses:
         `messages` plus `image` as a data URL. "prompt+image" is gone - it is exactly the request that
         3030 refuses. The OpenAI-style content parts stay as the fallback, tried only when Cloudflare
         refuses the input itself; a layout that is accepted but drops the image would read a screen it
         never saw, so the documented layout goes first. */
      const SYSTEM = "You read live-selling summary screens and reply with JSON only.";
      const layouts: { name: string; input: Record<string, unknown> }[] = [
        { name: "messages+image", input: { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: PROMPT }], image, max_tokens: 300, temperature: 0 } },
        { name: "content-parts", input: { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: image } }] }], max_tokens: 300, temperature: 0 } },
      ];
      const call = (input: Record<string, unknown>) => Promise.race([
        ai!.run(AI_MODEL, input),
        new Promise((_, no) => setTimeout(() => no(new Error("timeout")), AI_TIMEOUT_MS)),
      ]) as Promise<{ response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } }>;
      const refusedInput = (e: unknown) => /\b(3\d{3}|5006)\b|unable to add image|invalid input|required properties/i.test(String((e as Error)?.message ?? e));
      let res: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null = null;
      const tried: string[] = [];
      let agreed = false;
      for (let i = 0; i < layouts.length && !res; i++) {
        try { res = await call(layouts[i]!.input); }
        catch (e) {
          const m = String((e as Error)?.message ?? e);
          if (!agreed && /agree|licen[cs]e|5016/i.test(m)) { agreed = true; await ai!.run(AI_MODEL, { prompt: "agree" }); i--; continue; }
          tried.push(`${layouts[i]!.name}: ${m.slice(0, 120)}`);
          if (!refusedInput(e) || i === layouts.length - 1) throw new Error(tried.join(" | "));
        }
      }
      /* a model may answer with an object rather than text (JSON mode) */
      const out = res?.response;
      raw = typeof out === "string" ? out : out == null ? "" : JSON.stringify(out); usage = res?.usage;
    }
    /* Neurons from the model's published rates ($0.049 per M input, $0.676 per M output; $0.011 per 1,000 Neurons);
       no usage reported = the reservation stands */
    const used = usage ? Math.ceil((usage.prompt_tokens ?? 0) * 0.00446 + (usage.completion_tokens ?? 0) * 0.0615) : RESERVE_NEURONS;
    await settle(used, false);
    return { ok: true, figures: parseReading(raw), neurons: used, model: fake ? `${AI_MODEL} (test)` : AI_MODEL };
  } catch (e) {
    await settle(RESERVE_NEURONS, true);
    const detail = String((e as Error)?.message ?? e).slice(0, 300);
    /* the real reason goes to System health's error log, so a failure is never a mystery again */
    await logError(env, "live_ai", `Live report screenshot AI failed (${bytes.length} bytes, ${type}): ${detail}`, "/staff/live-reports/files/read").catch(() => {});
    return { ok: false, reason: detail.includes("timeout") ? "timeout" : "failed", detail };
  }
}

/* ======================================================================= */
/* Routes                                                                  */
/* ======================================================================= */

export async function handleLiveReports(env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams, request: Request): Promise<Response | null> {
  if (path !== "/live-reports" && !path.startsWith("/live-reports/")) return null;
  const reviewer = canUser(user, "live_report_review");
  try {
    /* ---------------- the AI usage of today and the CEO's settings ---------------- */
    if (path === "/live-reports/ai" && method === "GET") {
      if (!reviewer && !canUser(user, "live_ai_settings")) return err("forbidden", "Management only", 403);
      return json({ ...(await aiUsageToday(env)), can_set: canUser(user, "live_ai_settings") });
    }
    if (path === "/live-reports/ai" && method === "PUT") {
      if (!canUser(user, "live_ai_settings")) return err("forbidden", "Only the CEO sets the screenshot AI", 403);
      const cur = await aiSettings(env);
      const enabled = typeof body?.enabled === "boolean" ? body.enabled : cur.enabled;
      const cap = body?.cap === undefined ? cur.cap : Math.round(Number(body.cap));
      if (!Number.isInteger(cap) || cap < 0 || cap > 200) return err("invalid_input", "The daily cap is 0 to 200 screenshots", 400);
      const ceiling = body?.ceiling === undefined ? cur.ceiling : Math.round(Number(body.ceiling));
      if (!Number.isInteger(ceiling) || ceiling < 0 || ceiling > NEURON_CEILING_MAX) return err("invalid_input", `The Neuron ceiling is 0 to ${NEURON_CEILING_MAX} (under the free ${FREE_NEURONS_A_DAY} a day)`, 400);
      /* turning it on is the CEO's acceptance of the model's licence (Meta Llama 3.2), recorded once */
      if (enabled && !cur.enabled && body?.accept_licence !== true) return err("licence_required", "Turning the screenshot AI on accepts the Meta Llama 3.2 licence of the Workers AI model - confirm it", 400);
      const next: AiSettings = { enabled, cap, ceiling, accepted_by: enabled && !cur.enabled ? user.id : cur.accepted_by ?? null, accepted_at: enabled && !cur.enabled ? new Date().toISOString() : cur.accepted_at ?? null };
      await env.DB.prepare(`INSERT INTO system_meta (key, value) VALUES ('live_ai_settings', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(next)).run();
      if (enabled && !cur.enabled) {
        const ai = (env as unknown as { AI?: { run: (m: string, i: unknown) => Promise<unknown> } }).AI;
        if (ai) { try { await ai.run(AI_MODEL, { prompt: "agree" }); } catch { /* accepted already, or unavailable: reads will fall back */ } }
      }
      await audit(env, user.id, "live_report.ai_settings", "system_meta", "live_ai_settings", { from: cur, to: next });
      return json({ ok: true, settings: next });
    }

    /* ---------------- pickers: active projects, staff who may take part ---------------- */
    if (path === "/live-reports/projects" && method === "GET") {
      const rows = (await env.DB.prepare(
        `SELECT p.id, p.title, p.status, c.company AS client, d.issuer_code, ${DOC_COLS("p")}
           FROM projects p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN sales_documents d ON d.id = p.quotation_id
          WHERE p.status IN (${ACTIVE_PROJECT.map((s) => `'${s}'`).join(", ")}) ORDER BY p.title COLLATE NOCASE LIMIT 300`,
      ).all<{ id: number; title: string; status: string; client: string | null; issuer_code: string | null } & DocNums>()).results ?? [];
      return json({ projects: rows.map((p) => ({ id: p.id, title: p.title, status: p.status, client: p.client, company: p.issuer_code === "a2z" ? "a2z" : "azoo", qt_number: p.qt_number, inv_number: p.inv_number })) });
    }
    if (path === "/live-reports/people" && method === "GET") {
      const rows = (await env.DB.prepare(
        `SELECT u.id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.photo_key, u.position FROM users u
          WHERE u.is_active = 1 AND u.role NOT IN ('customer', 'agent', 'super_admin', 'admin') AND u.role NOT IN (SELECT key FROM roles WHERE kind = 'own' AND counts_as_staff = 0) AND ${currentStaffSql("u.")} ORDER BY name COLLATE NOCASE`,
      ).all()).results ?? [];
      return json({ people: rows });
    }

    /* the roster's recent lives you are NOT listed on (last 30 days, not cancelled) - so a co-host,
       assistant or salesperson who took part can add themselves (the roster read shows staff only their own) */
    if (path === "/live-reports/recent-lives" && method === "GET") {
      const rows = (await env.DB.prepare(
        `SELECT s.id, s.session_date, s.start_time, s.end_time, s.platform, s.client_name, s.unplanned, s.project_id, pj.title AS project_title, ${DOC_COLS("pj")},
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS host_name
           FROM live_sessions s JOIN users u ON u.id = s.host_user_id LEFT JOIN projects pj ON pj.id = s.project_id
          WHERE s.status != 'cancelled' AND s.session_date <= ?2 AND s.session_date >= date(?2, '-30 days')
            AND NOT ${tookPart(1)}
          ORDER BY s.session_date DESC, s.start_time DESC LIMIT 60`,
      ).bind(user.id, mytToday()).all()).results ?? [];
      return json({ sessions: rows });
    }

    /* ---------------- the overview: the month's figures, the latest live, its analysis ---------------- */
    if (path === "/live-reports/overview" && method === "GET") {
      const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : mytToday().slice(0, 7);
      const prevD = new Date(`${month}-01T00:00:00Z`); prevD.setUTCMonth(prevD.getUTCMonth() - 1);
      const prev = prevD.toISOString().slice(0, 7);
      /* a reviewer sees the company; everyone else the lives they took part in */
      const scope = reviewer ? "?1 = ?1" : tookPart(1);
      const sums = async (m: string) => {
        const lives = await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_sessions s WHERE s.status != 'cancelled' AND substr(s.session_date, 1, 7) = ?2 AND ${scope}`).bind(user.id, m).first<{ n: number }>();
        const f = await env.DB.prepare(
          `SELECT COUNT(*) AS reported, SUM(v.gmv_cents) AS gmv, SUM(v.viewers) AS viewers, SUM(v.orders) AS orders,
                  SUM(CASE WHEN v.viewers IS NOT NULL AND v.orders IS NOT NULL THEN v.viewers END) AS conv_viewers,
                  SUM(CASE WHEN v.viewers IS NOT NULL AND v.orders IS NOT NULL THEN v.orders END) AS conv_orders,
                  AVG(v.avg_watch_sec) AS watch
             FROM live_reports r JOIN live_sessions s ON s.id = r.session_id JOIN live_report_versions v ON v.report_id = r.id AND v.version = r.current_version
            WHERE r.state IN ('submitted', 'reviewed', 'accepted') AND substr(s.session_date, 1, 7) = ?2 AND ${scope}`,
        ).bind(user.id, m).first<{ reported: number; gmv: number | null; viewers: number | null; orders: number | null; conv_viewers: number | null; conv_orders: number | null; watch: number | null }>();
        return { lives: lives?.n ?? 0, reported: f?.reported ?? 0, gmv_cents: f?.gmv ?? null, viewers: f?.viewers ?? null, orders: f?.orders ?? null,
          conversion: f?.conv_viewers ? (f.conv_orders ?? 0) / f.conv_viewers : null, avg_watch_sec: f?.watch !== null && f?.watch !== undefined ? Math.round(f.watch) : null };
      };
      const [now, before] = [await sums(month), await sums(prev)];
      const latest = await env.DB.prepare(
        `SELECT r.id FROM live_reports r JOIN live_sessions s ON s.id = r.session_id
          WHERE r.state IN ('submitted', 'reviewed', 'accepted') AND ${scope} ORDER BY s.session_date DESC, s.start_time DESC LIMIT 1`,
      ).bind(user.id).first<{ id: number }>();
      const waiting = reviewer ? (await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_reports WHERE state = 'submitted'`).first<{ n: number }>())?.n ?? 0 : null;
      return json({ month, prev_month: prev, figures: now, previous: before, latest_report_id: latest?.id ?? null,
        latest_analysis: latest ? await analysisOf(env, latest.id) : null, waiting_review: waiting, can_review: reviewer });
    }

    /* ---------------- the list: the lives you took part in, or every report for a reviewer ---------------- */
    if (path === "/live-reports" && method === "GET") {
      const mine = params.get("mine") === "1" || !reviewer;
      const reports = (await env.DB.prepare(
        `SELECT r.*, s.session_date, s.start_time, s.end_time, s.platform, s.client_name, s.project_id, s.unplanned,
                COALESCE(NULLIF(TRIM(h.full_name), ''), h.name) AS host_name,
                pj.title AS project_title, cu.company AS project_client, ${DOC_COLS("pj")},
                v.gmv_cents, v.duration_min, v.viewers, v.orders, v.highlights, v.blockers, v.next_actions, v.submitted_at,
                (SELECT COUNT(*) FROM live_report_files f WHERE f.report_id = r.id AND (f.version = r.current_version OR (f.version IS NULL AND r.state IN ('draft', 'returned')))) AS file_count,
                (SELECT MIN(f.id) FROM live_report_files f WHERE f.report_id = r.id) AS thumb_file_id
           FROM live_reports r JOIN live_sessions s ON s.id = r.session_id JOIN users h ON h.id = r.host_user_id
           LEFT JOIN projects pj ON pj.id = s.project_id LEFT JOIN customers cu ON cu.id = pj.customer_id
           LEFT JOIN live_report_versions v ON v.report_id = r.id AND v.version = r.current_version
          ${mine ? `WHERE ${tookPart(1)}` : "WHERE ?1 = ?1"}
          ORDER BY s.session_date DESC, s.start_time DESC LIMIT 200`,
      ).bind(user.id).all<Record<string, unknown> & { session_id: number; project_id: number | null }>()).results ?? [];
      const people: Record<number, Participant[]> = {};
      if (reports.length) {
        const ids = reports.map((r) => r.session_id);
        const rows = (await env.DB.prepare(
          `SELECT a.session_id, a.user_id, a.role, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS name, u.photo_key
             FROM (${PART_SQL}) a JOIN users u ON u.id = a.user_id WHERE a.session_id IN (${ids.map(() => "?").join(",")}) ORDER BY a.session_id, a.ord`,
        ).bind(...ids).all<Participant & { session_id: number }>()).results ?? [];
        for (const r of rows) (people[r.session_id] ??= []).push({ user_id: r.user_id, role: r.role, name: r.name, photo_key: r.photo_key });
      }
      /* the lives you took part in (last 30 days, not cancelled) that have no report yet */
      const open = (await env.DB.prepare(
        `SELECT s.id, s.session_date, s.start_time, s.end_time, s.platform, s.client_name, s.status, s.project_id, s.unplanned, pj.title AS project_title, ${DOC_COLS("pj")}
           FROM live_sessions s LEFT JOIN projects pj ON pj.id = s.project_id
          WHERE s.status != 'cancelled' AND s.session_date <= ?2 AND s.session_date >= date(?2, '-30 days')
            AND ${tookPart(1)}
            AND NOT EXISTS (SELECT 1 FROM live_reports r WHERE r.session_id = s.id)
          ORDER BY s.session_date DESC, s.start_time DESC LIMIT 30`,
      ).bind(user.id, mytToday()).all()).results ?? [];
      return json({ reports: reports.map((r) => ({ ...r, participants: people[r.session_id] ?? [] })), sessions_to_report: open, can_review: reviewer, me: user.id });
    }

    /* ---------------- one report: participants, project, figures, screenshots, AI readings, analysis, trail ---------------- */
    const one = /^\/live-reports\/(\d+)$/.exec(path);
    if (one && method === "GET") {
      const r = await reportOf(env, Number(one[1]));
      if (!r) return err("not_found", "Report not found", 404);
      const part = await isParticipant(env, r.session_id, user.id);
      if (!part && !reviewer) return err("forbidden", "Not a live you took part in", 403);
      const s = await sessionOf(env, r.session_id);
      const project = s?.project_id ? await projectOf(env, s.project_id) : null;
      const participants = await participantsOf(env, r.session_id);
      const versions = (await env.DB.prepare(`SELECT v.*, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS by_name FROM live_report_versions v LEFT JOIN users u ON u.id = v.submitted_by WHERE v.report_id = ?1 ORDER BY v.version DESC`).bind(r.id).all()).results ?? [];
      const files = (await env.DB.prepare(`SELECT id, version, file_name, content_type, size_bytes, created_at FROM live_report_files WHERE report_id = ?1 ORDER BY id`).bind(r.id).all()).results ?? [];
      const readings = (await env.DB.prepare(`SELECT id, file_id, figures, model, neurons, outcome, created_at FROM live_report_ai_readings WHERE report_id = ?1 ORDER BY id DESC`).bind(r.id).all()).results ?? [];
      const reviews = (await env.DB.prepare(`SELECT w.id, w.version, w.action, w.note, w.actor_role, w.created_at, COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS by_name FROM live_report_reviews w LEFT JOIN users u ON u.id = w.actor_id WHERE w.report_id = ?1 ORDER BY w.id DESC`).bind(r.id).all()).results ?? [];
      const editable = part && ["draft", "returned"].includes(r.state);
      return json({
        report: r, session: s, project, participants, versions, files, readings, reviews,
        analysis: ["submitted", "reviewed", "accepted"].includes(r.state) ? await analysisOf(env, r.id) : null,
        ai: editable ? await aiUsageToday(env) : null,
        can: { edit: editable, participate: part, review: reviewer && !part },
      });
    }

    /* ---------------- a participant starts the report of a live on the roster ---------------- */
    if (path === "/live-reports" && method === "POST") {
      const sid = Number(body?.session_id);
      if (!Number.isInteger(sid) || sid <= 0) return err("invalid_input", "Choose the live session on the roster", 400);
      const s = await sessionOf(env, sid);
      if (!s) return err("not_found", "That live session is not on the roster", 404);
      if (!(await isParticipant(env, sid, user.id))) return err("forbidden", "Only someone who took part in this live reports it - add yourself as a participant first", 403);
      if (s.status === "cancelled") return err("invalid_state", "This live was cancelled", 409);
      if (s.session_date > mytToday()) return err("invalid_state", "This live has not happened yet", 409);
      /* ONE report per live (live_reports.session_id is UNIQUE): an existing one is returned, never a second */
      const row = await env.DB.prepare(`INSERT INTO live_reports (session_id, host_user_id) VALUES (?1, ?2) ON CONFLICT(session_id) DO NOTHING RETURNING id`).bind(sid, s.host_user_id).first<{ id: number }>();
      if (!row) { const had = await env.DB.prepare(`SELECT id FROM live_reports WHERE session_id = ?1`).bind(sid).first<{ id: number }>(); return json({ id: had?.id, existing: true }); }
      await audit(env, user.id, "live_report.start", "live_reports", String(row.id), { session_id: sid });
      return json({ id: row.id }, 201);
    }

    /* ---------------- a live that was not on the roster: project first, the roster entry made unplanned ---------------- */
    if (path === "/live-reports/unplanned" && method === "POST") {
      /* v1.385.0 - a live FOR a project (the project sets client and company), or an OWN live
         (no project: the company is chosen - A2Z or AZ ONE - never inferred) */
      const own = body?.project_id === undefined || body?.project_id === null || body?.project_id === "" || Number(body?.project_id) === 0;
      const pid = own ? 0 : Number(body?.project_id);
      const p = own ? null : Number.isInteger(pid) && pid > 0 ? await projectOf(env, pid) : null;
      if (!own && (!p || !ACTIVE_PROJECT.includes(p.status))) return err("project_required", "Choose an active project, or report it as an own live", 400);
      const ownCompany = own ? (["a2z", "azoo"].includes(String(body?.company)) ? String(body?.company) as "a2z" | "azoo" : null) : null;
      if (own && !ownCompany) return err("company_required", "Choose the company of this own live: A2Z Creative Marketing or AZ ONE Official", 400);
      const company = p ? p.company : ownCompany!;
      const d = typeof body?.session_date === "string" ? body.session_date : "";
      const st = typeof body?.start_time === "string" ? body.start_time : "";
      const et = typeof body?.end_time === "string" ? body.end_time : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(st) || !/^\d{2}:\d{2}$/.test(et)) return err("invalid_input", "The date, the start and the end time of the live are required", 400);
      if (d > mytToday()) return err("invalid_state", "A live is reported after it has happened", 409);
      if (d < (() => { const x = new Date(`${mytToday()}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 30); return x.toISOString().slice(0, 10); })()) return err("invalid_input", "Report a live within 30 days", 400);
      if (et <= st) return err("invalid_input", "The end time is after the start time", 400);
      const platform = (PLATFORMS as readonly string[]).includes(String(body?.platform)) ? String(body?.platform) : null;
      if (!platform) return err("invalid_input", "Choose the platform: TikTok, Shopee or other", 400);
      const role = (ROLES as readonly string[]).includes(String(body?.role)) ? String(body?.role) : "host";
      const me = await staffOk(env, user.id);
      if (!me) return err("forbidden", "Only current staff report a live", 403);
      /* the same live already exists: same day and platform, overlapping time, and the same project
         (an own live: no project and the same company) or with me in it */
      const sameLive = (n: number, c: number) => `(s.project_id = ?${n} OR (?${n} IS NULL AND s.project_id IS NULL AND COALESCE((SELECT lr.company FROM live_reports lr WHERE lr.session_id = s.id), ?${c}) = ?${c}))`;
      const dup = await env.DB.prepare(
        `SELECT s.id FROM live_sessions s
          WHERE s.status != 'cancelled' AND s.session_date = ?1 AND s.platform = ?2 AND s.start_time < ?4 AND COALESCE(s.end_time, '23:59') > ?3
            AND (${sameLive(5, 7)} OR ${tookPart(6)})
          ORDER BY s.id LIMIT 1`,
      ).bind(d, platform, st, et, p?.id ?? null, user.id, company).first<{ id: number }>();
      if (dup) {
        const rep = await env.DB.prepare(`SELECT id FROM live_reports WHERE session_id = ?1`).bind(dup.id).first<{ id: number }>();
        return json({ existing: true, session_id: dup.id, id: rep?.id ?? null, message: "This live is already recorded - join it instead of adding another" }, 409);
      }
      /* one guarded batch: the roster entry (unplanned), me as a participant, the report.
         The NOT EXISTS repeats the duplicate check inside the write, so two reporters at once make one live. */
      const marker = `unplanned:${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO live_sessions (session_date, start_time, end_time, platform, client_id, client_name, host_user_id, notes, status, created_by, project_id, unplanned)
           SELECT ?1, ?2, ?3, ?4, (SELECT pj.customer_id FROM projects pj WHERE pj.id = ?8), ?5, ?6, ?7, 'completed', ?6, ?8, 1
            WHERE (?8 IS NULL OR EXISTS (SELECT 1 FROM projects pj WHERE pj.id = ?8))
              AND NOT EXISTS (SELECT 1 FROM live_sessions s WHERE s.status != 'cancelled' AND s.session_date = ?1 AND s.platform = ?4 AND s.start_time < ?3 AND COALESCE(s.end_time, '23:59') > ?2 AND ${sameLive(8, 9)})`,
        ).bind(d, st, et, platform, p?.client ?? null, user.id, marker, p?.id ?? null, company),
        /* the reporter is the roster host of an unplanned live; a different role of theirs is kept as a participant row */
        env.DB.prepare(`INSERT INTO live_participants (session_id, user_id, role, added_by) SELECT id, ?1, ?2, ?1 FROM live_sessions WHERE notes = ?3 AND ?2 != 'host'`).bind(user.id, role, marker),
        env.DB.prepare(`INSERT INTO live_reports (session_id, host_user_id, company) SELECT id, ?1, ?2 FROM live_sessions WHERE notes = ?3`).bind(user.id, company, marker),
        env.DB.prepare(`UPDATE live_sessions SET notes = NULL WHERE notes = ?1`).bind(marker),
      ]);
      const made = await env.DB.prepare(
        `SELECT s.id AS session_id, r.id FROM live_sessions s JOIN live_reports r ON r.session_id = s.id
          WHERE s.created_by = ?1 AND s.unplanned = 1 AND s.session_date = ?2 AND s.start_time = ?3 AND s.project_id IS ?4 AND r.company = ?5 ORDER BY s.id DESC LIMIT 1`,
      ).bind(user.id, d, st, p?.id ?? null, company).first<{ session_id: number; id: number }>();
      if (!made) return err("conflict", "Someone recorded this live at the same moment - reload and join it", 409);
      await audit(env, user.id, "live_report.unplanned", "live_sessions", String(made.session_id), { project_id: p?.id ?? null, own, company, session_date: d, start_time: st, end_time: et, platform, report_id: made.id });
      return json({ id: made.id, session_id: made.session_id }, 201);
    }

    /* ---------------- participants: join a live you took part in, or add a colleague ---------------- */
    const jn = /^\/live-reports\/sessions\/(\d+)\/participants$/.exec(path);
    const pa = /^\/live-reports\/(\d+)\/participants$/.exec(path);
    if ((jn || pa) && method === "POST") {
      let sid: number; let r: Report | null = null;
      if (pa) { r = await reportOf(env, Number(pa[1])); if (!r) return err("not_found", "Report not found", 404); sid = r.session_id; }
      else sid = Number(jn![1]);
      const s = await sessionOf(env, sid);
      if (!s || s.status === "cancelled") return err("not_found", "That live is not on the roster", 404);
      r ??= await env.DB.prepare(`SELECT * FROM live_reports WHERE session_id = ?1`).bind(sid).first<Report>();
      if (r && !["draft", "returned"].includes(r.state)) return err("invalid_state", `The report is ${r.state} - who took part is kept as submitted`, 409);
      const target = body?.user_id === undefined ? user.id : Number(body.user_id);
      const role = String(body?.role ?? "");
      if (!(ROLES as readonly string[]).includes(role) || role === "host") return err("invalid_input", "The role is co-host, assistant or salesperson", 400);
      if (!Number.isInteger(target) || target <= 0) return err("invalid_input", "Choose the staff member", 400);
      /* yourself: any current staff who performed it; somebody else: only someone already in the live, or a roster manager */
      const iAmIn = await isParticipant(env, sid, user.id);
      const rosterManager = ["ceo", "coo", "cco", "hr_admin"].includes(user.role);
      if (target !== user.id && !iAmIn && !rosterManager) return err("forbidden", "Only someone who took part adds a colleague", 403);
      if (s.session_date > mytToday() || s.session_date < (() => { const x = new Date(`${mytToday()}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - 30); return x.toISOString().slice(0, 10); })()) return err("invalid_state", "Participants are recorded within 30 days of the live", 409);
      const who = await staffOk(env, target);
      if (!who) return err("not_available", "Only current staff take part in a live", 409);
      if (s.host_user_id === target) return err("already", `${who.name} is the host of this live`, 409);
      const row = await env.DB.prepare(`INSERT INTO live_participants (session_id, user_id, role, added_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(session_id, user_id) DO NOTHING RETURNING id`).bind(sid, target, role, user.id).first<{ id: number }>();
      if (!row) return err("already", `${who.name} is already in this live`, 409);
      await audit(env, user.id, "live_report.participant_add", "live_sessions", String(sid), { user_id: target, role, self: target === user.id });
      return json({ ok: true, participants: await participantsOf(env, sid) }, 201);
    }
    const pr = /^\/live-reports\/(\d+)\/participants\/(\d+)\/remove$/.exec(path);
    if (pr && method === "POST") {
      const r = await reportOf(env, Number(pr[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (!["draft", "returned"].includes(r.state)) return err("invalid_state", `The report is ${r.state} - who took part is kept as submitted`, 409);
      if (!(await isParticipant(env, r.session_id, user.id))) return err("forbidden", "Only someone who took part changes the list", 403);
      const target = Number(pr[2]);
      const s0 = await sessionOf(env, r.session_id);
      if (s0?.host_user_id === target) return err("invalid_state", "The host stays on the live (change the roster to change the host)", 409);
      const row = await env.DB.prepare(`SELECT role FROM live_participants WHERE session_id = ?1 AND user_id = ?2`).bind(r.session_id, target).first<{ role: string }>();
      if (!row) return err("not_found", "Not in this live", 404);
      /* live_participants keeps no history of its own; the audit row is the record of the removal */
      await env.DB.prepare(`DELETE FROM live_participants WHERE session_id = ?1 AND user_id = ?2 AND role != 'host'`).bind(r.session_id, target).run();
      await audit(env, user.id, "live_report.participant_remove", "live_sessions", String(r.session_id), { user_id: target, role: row.role });
      return json({ ok: true, participants: await participantsOf(env, r.session_id) });
    }

    /* ---------------- a participant keeps the draft: project, figures, notes ---------------- */
    const dr = /^\/live-reports\/(\d+)\/draft$/.exec(path);
    if (dr && method === "PUT") {
      const r = await reportOf(env, Number(dr[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (!(await isParticipant(env, r.session_id, user.id))) return err("forbidden", "Only someone who took part edits this report", 403);
      if (!["draft", "returned"].includes(r.state)) return err("invalid_state", `This report is ${r.state} - it is kept as submitted`, 409);
      const sets: string[] = []; const vals: unknown[] = [];
      /* the figures (old clients send gmv and duration_min only - both still work) */
      for (const [col, , key, unit] of FIGURES) {
        const v = figure(body?.[key], unit);
        if (v === undefined) continue;
        if (Number.isNaN(v)) return err("invalid_input", `${key.replace(/_/g, " ")} is not a valid figure`, 400);
        sets.push(`${col} = ?`); vals.push(v);
      }
      for (const k of ["highlights", "blockers", "next_actions"] as const) if (body && k in body) { sets.push(`draft_${k} = ?`); vals.push(text(body[k], 2000)); }
      /* the project: an active one; client and company follow from it.
         v1.385.0 - null takes the project off (an own live); the company stays as it was until staff choose it */
      if (body?.project_id === null || body?.project_id === "" || body?.project_id === 0) {
        await env.DB.prepare(`UPDATE live_sessions SET project_id = NULL WHERE id = ?1`).bind(r.session_id).run();
        if (body?.company !== undefined) {
          const company = body.company === null || body.company === "" ? null : String(body.company);
          if (company !== null && !["a2z", "azoo"].includes(company)) return err("invalid_input", "The company is A2Z Creative Marketing or AZ ONE Official", 400);
          sets.push("company = ?"); vals.push(company);
        }
      } else if (body?.project_id !== undefined) {
        const p = await projectOf(env, Number(body.project_id));
        if (!p || !ACTIVE_PROJECT.includes(p.status)) return err("project_required", "Choose an active project", 400);
        await env.DB.prepare(`UPDATE live_sessions SET project_id = ?1, client_name = COALESCE(?2, client_name) WHERE id = ?3`).bind(p.id, p.client, r.session_id).run();
        sets.push("company = ?"); vals.push(p.company);
      } else if (body?.company !== undefined) {
        /* an own live (no project) names its company itself */
        const s = await sessionOf(env, r.session_id);
        const company = body.company === null || body.company === "" ? null : String(body.company);
        if (s?.project_id) return err("invalid_input", "The company comes from the project", 400);
        if (company !== null && !["a2z", "azoo"].includes(company)) return err("invalid_input", "The company is A2Z Creative Marketing or AZ ONE Official", 400);
        sets.push("company = ?"); vals.push(company);
      }
      if (sets.length) await env.DB.prepare(`UPDATE live_reports SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...vals, r.id).run();
      return json({ ok: true });
    }

    /* ---------------- a participant attaches a GMV screenshot ---------------- */
    const up = /^\/live-reports\/(\d+)\/files$/.exec(path);
    if (up && method === "POST") {
      const r = await reportOf(env, Number(up[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (!(await isParticipant(env, r.session_id, user.id))) return err("forbidden", "Only someone who took part attaches the screenshots", 403);
      if (!["draft", "returned"].includes(r.state)) return err("invalid_state", `This report is ${r.state} - its screenshots are kept as submitted`, 409);
      const ct = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
      if (!IMAGE_TYPES.includes(ct)) return err("invalid_input", "A screenshot is a JPEG, PNG or WebP image", 400);
      if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return err("too_large", "A screenshot is at most 8 MB", 413);
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_report_files WHERE report_id = ?1 AND version IS NULL`).bind(r.id).first<{ n: number }>();
      if (Number(n?.n ?? 0) >= MAX_FILES) return err("too_many", `Up to ${MAX_FILES} screenshots a submission`, 409);
      if (!request.body) return err("invalid_input", "The screenshot is required", 400);
      const key = `live-reports/${r.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rejected = await putGuarded(env.MEDIA, key, request, { max: MAX_BYTES, contentType: ct });
      if (rejected) return rejected;
      const name = (request.headers.get("x-file-name") ?? "").replace(/[^\w.\- ]+/g, "").slice(0, 120) || null;
      const size = Number(request.headers.get("content-length") ?? 0) || null;
      const row = await env.DB.prepare(`INSERT INTO live_report_files (report_id, version, r2_key, file_name, content_type, size_bytes, uploaded_by) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6) RETURNING id`)
        .bind(r.id, key, name, ct, size, user.id).first<{ id: number }>();
      await audit(env, user.id, "live_report.file", "live_reports", String(r.id), { file_id: row?.id });
      return json({ id: row?.id }, 201);
    }

    /* ---------------- a screenshot, to the participants and the reviewers only ---------------- */
    const fl = /^\/live-reports\/(\d+)\/files\/(\d+)$/.exec(path);
    if (fl && method === "GET") {
      const r = await reportOf(env, Number(fl[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (!reviewer && !(await isParticipant(env, r.session_id, user.id))) return err("forbidden", "Not a live you took part in", 403);
      const f = await env.DB.prepare(`SELECT r2_key, content_type FROM live_report_files WHERE id = ?1 AND report_id = ?2`).bind(Number(fl[2]), r.id).first<{ r2_key: string; content_type: string }>();
      if (!f) return err("not_found", "Screenshot not found", 404);
      const obj = await env.MEDIA.get(f.r2_key);
      if (!obj) return err("not_found", "Screenshot not found", 404);
      return new Response(obj.body, { headers: { "Content-Type": f.content_type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
    }

    /* ---------------- the screenshot AI: figures only, staff confirm them ---------------- */
    const rd = /^\/live-reports\/(\d+)\/files\/(\d+)\/read$/.exec(path);
    if (rd && method === "POST") {
      const r = await reportOf(env, Number(rd[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (!(await isParticipant(env, r.session_id, user.id))) return err("forbidden", "Only someone who took part reads the screenshots", 403);
      if (!["draft", "returned"].includes(r.state)) return err("invalid_state", `This report is ${r.state}`, 409);
      const f = await env.DB.prepare(`SELECT id, r2_key, content_type FROM live_report_files WHERE id = ?1 AND report_id = ?2`).bind(Number(rd[2]), r.id).first<{ id: number; r2_key: string; content_type: string | null }>();
      if (!f) return err("not_found", "Screenshot not found", 404);
      const obj = await env.MEDIA.get(f.r2_key);
      if (!obj) return err("not_found", "Screenshot not found", 404);
      const res = await readScreenshot(env, new Uint8Array(await obj.arrayBuffer()), f.content_type ?? "image/png");
      if (!res.ok) {
        /* a refusal or a failure is not an error of the report: type the figures */
        return json({ manual: true, reason: res.reason, detail: "detail" in res ? res.detail ?? null : null, usage: await aiUsageToday(env) });
      }
      const outcome = res.figures ? "read" : "unreadable";
      const row = await env.DB.prepare(`INSERT INTO live_report_ai_readings (report_id, file_id, figures, model, neurons, outcome, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`)
        .bind(r.id, f.id, res.figures ? JSON.stringify(res.figures) : null, res.model, res.neurons, outcome, user.id).first<{ id: number }>();
      await audit(env, user.id, "live_report.ai_read", "live_reports", String(r.id), { file_id: f.id, reading_id: row?.id, outcome, neurons: res.neurons });
      /* v1.386.0 - the CEO (18-11-2026): "AI should filled the textbox instead!" - what the AI read goes into the
         DRAFT boxes that are still empty (never over a figure a person typed). It stays a draft: staff check it
         and the figures freeze only when they submit. */
      let filled = 0;
      if (res.figures) {
        const sets: string[] = []; const vals: unknown[] = [];
        for (const [dcol, , key, unit] of FIGURES) {
          const v = figure(res.figures[key], unit);
          if (typeof v === "number" && Number.isFinite(v)) { vals.push(v); sets.push(`${dcol} = COALESCE(${dcol}, ?${vals.length})`); }
        }
        if (sets.length) {
          vals.push(r.id);
          await env.DB.prepare(`UPDATE live_reports SET ${sets.join(", ")} WHERE id = ?${vals.length} AND state IN ('draft', 'returned')`).bind(...vals).run();
          filled = sets.length;
        }
      }
      return json({ manual: outcome !== "read", reason: outcome === "read" ? null : "unreadable", reading_id: row?.id, figures: res.figures, filled, usage: await aiUsageToday(env) });
    }

    /* ---------------- a participant submits: the figures freeze as a new version ---------------- */
    const sb = /^\/live-reports\/(\d+)\/submit$/.exec(path);
    if (sb && method === "POST") {
      const r = await reportOf(env, Number(sb[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (!(await isParticipant(env, r.session_id, user.id))) return err("forbidden", "Only someone who took part submits this report", 403);
      if (!["draft", "returned"].includes(r.state)) return err("invalid_state", `This report is already ${r.state}`, 409);
      const s = await sessionOf(env, r.session_id);
      if (!s) return err("not_found", "That live is not on the roster", 404);
      if (r.draft_gmv_cents == null) return err("invalid_input", "Enter the GMV reported (RM) first", 400);
      /* v1.385.0 - the project is optional; the company never is (a project sets it, an own live chooses it) */
      if (!r.company) return err("company_required", s.project_id ? "Choose the project again (it sets the company)" : "Choose the company of this own live: A2Z or AZ ONE", 400);
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_report_files WHERE report_id = ?1 AND version IS NULL`).bind(r.id).first<{ n: number }>();
      if (!Number(n?.n ?? 0)) return err("evidence_required", "Attach at least one screenshot of the GMV", 400);
      const people = await participantsOf(env, r.session_id);
      const v = r.current_version + 1;
      await env.DB.batch([
        env.DB.prepare(`UPDATE live_reports SET state = 'submitted', current_version = ?1, updated_at = datetime('now') WHERE id = ?2 AND current_version = ?3 AND state IN ('draft', 'returned')`).bind(v, r.id, r.current_version),
        env.DB.prepare(`INSERT INTO live_report_versions (report_id, version, company, gmv_cents, duration_min, highlights, blockers, next_actions, submitted_by,
                          viewers, peak_viewers, avg_watch_sec, orders, items_sold, product_clicks, ctr_bp, conversion_bp, project_id, participants)
                        SELECT id, ?1, company, draft_gmv_cents, draft_duration_min, draft_highlights, draft_blockers, draft_next_actions, ?2,
                          draft_viewers, draft_peak_viewers, draft_avg_watch_sec, draft_orders, draft_items_sold, draft_product_clicks, draft_ctr_bp, draft_conversion_bp, ?4, ?5
                          FROM live_reports WHERE id = ?3 AND current_version = ?1`).bind(v, user.id, r.id, s.project_id, JSON.stringify(people.map((p) => ({ user_id: p.user_id, role: p.role })))),
        env.DB.prepare(`UPDATE live_report_files SET version = ?1 WHERE report_id = ?2 AND version IS NULL AND EXISTS (SELECT 1 FROM live_reports WHERE id = ?2 AND current_version = ?1)`).bind(v, r.id),
      ]);
      const now = await env.DB.prepare(`SELECT state, current_version FROM live_reports WHERE id = ?1`).bind(r.id).first<{ state: string; current_version: number }>();
      const mine = await env.DB.prepare(`SELECT submitted_by FROM live_report_versions WHERE report_id = ?1 AND version = ?2`).bind(r.id, v).first<{ submitted_by: number }>();
      if (now?.state !== "submitted" || now.current_version !== v || mine?.submitted_by !== user.id) return err("conflict", "It changed while you were submitting it - reload", 409);
      await audit(env, user.id, "live_report.submit", "live_reports", String(r.id), { version: v, gmv_cents: r.draft_gmv_cents, project_id: s.project_id });
      for (const id of await reviewers(env, r.session_id)) {
        try { await notify(env, id, "task", `📺 Live report to review: ${user.name} (v${v})`, `live_report:${r.id}:v${v}`, { once: true }); } catch { /* a bell never blocks the work */ }
      }
      return json({ ok: true, state: "submitted", version: v });
    }

    /* ---------------- management: review, accept, return, reopen - never by anyone who took part ---------------- */
    const rv = /^\/live-reports\/(\d+)\/review$/.exec(path);
    if (rv && method === "POST") {
      if (!reviewer) return err("forbidden", "Only the CEO, COO or CCO reviews a live report", 403);
      const r = await reportOf(env, Number(rv[1]));
      if (!r) return err("not_found", "Report not found", 404);
      if (await isParticipant(env, r.session_id, user.id)) return err("self_approval", "A live report is never reviewed by someone who took part in that live", 403);
      const action = String(body?.action ?? "");
      const note = typeof body?.note === "string" ? body.note.trim().slice(0, 1000) : "";
      const MOVE: Record<string, { from: string[]; to: string; need: number }> = {
        review: { from: ["submitted"], to: "reviewed", need: 0 },
        accept: { from: ["submitted", "reviewed"], to: "accepted", need: 0 },
        return: { from: ["submitted", "reviewed"], to: "returned", need: 10 },
        reopen: { from: ["accepted"], to: "returned", need: 10 },
      };
      const m = MOVE[action];
      if (!m) return err("invalid_input", "The action is review, accept, return or reopen", 400);
      if (!m.from.includes(r.state)) return err("invalid_state", `A ${r.state} report cannot be ${action === "return" ? "returned" : action === "reopen" ? "reopened" : `${action}ed`}`, 409);
      if (note.length < m.need) return err("invalid_input", action === "return" ? "Say what to correct (at least 10 characters)" : "Say why it is reopened (at least 10 characters)", 400);
      const seen = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_report_reviews WHERE report_id = ?1`).bind(r.id).first<{ n: number }>())?.n ?? 0);
      await env.DB.batch([
        env.DB.prepare(`UPDATE live_reports SET state = ?1, updated_at = datetime('now') WHERE id = ?2 AND state = ?3`).bind(m.to, r.id, r.state),
        env.DB.prepare(`INSERT INTO live_report_reviews (report_id, version, action, note, actor_id, actor_role) SELECT id, current_version, ?1, ?2, ?3, ?4 FROM live_reports WHERE id = ?5 AND state = ?6`).bind(action, note || null, user.id, user.role, r.id, m.to),
      ]);
      const done = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_report_reviews WHERE report_id = ?1`).bind(r.id).first<{ n: number }>())?.n ?? 0);
      if (done !== seen + 1) return err("conflict", "It changed while you were reviewing it - reload", 409);
      await audit(env, user.id, `live_report.${action}`, "live_reports", String(r.id), { version: r.current_version, ...(note ? { note } : {}) });
      const word = action === "accept" ? "accepted" : action === "review" ? "reviewed" : "returned for correction";
      for (const p of await participantsOf(env, r.session_id)) {
        try { await notify(env, p.user_id, "task", `📺 Your live report was ${word}${note ? `: ${note.slice(0, 80)}` : ""}`, `live_report:${r.id}:${action}:${r.current_version}`, { once: true }); } catch { /* a bell never blocks the work */ }
      }
      return json({ ok: true, state: m.to });
    }
    return null;
  } catch (e) {
    const p = pending(e);
    if (p) return p;
    throw e;
  }
}
