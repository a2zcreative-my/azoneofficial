/* v1.248.0 - SIGNATURES & STAMPS PER PERSON AND PER COMPANY (the owner's
   brief of 01-11-2026, claude/SIGNATURES-AUDIT.md, and his answers: the
   person confirms their own signature AND the owner approves it, both with
   an authenticator code; no approval rule until the owner sets one (his
   quotation approval limit, the one approval system); the stamp prints beside an authorised preparer's verified
   signature when the company's policy allows it; sales documents only).

   WHAT IT BUILDS ON. The 0118 vault (signature_assets, private R2,
   append-only, versioned) keeps every role chop it holds and keeps signing
   leave and claim forms. A company switches its quotations, invoices and
   delivery orders to personal signing by turning `personal` on in its
   policy; until then every document prints exactly as before (the v1.4.233
   role rule), so nothing moves on the day this deploys.

   THE RULES, once a company is personal:
   - Prepared by: the person who created the document, with their own active
     signature, IF they hold a `prepare` authority for that company and that
     document type. Otherwise their name over an ink line.
   - Approved by: a second block, only when the quotation's approval exists.
     There is ONE approval system - the CEO's approval limit (business.ts,
     quotation_approvals, since v1.181.17). Once a company signs personally,
     approving there also SIGNS: it needs an `approve` authority for that
     company, an active signature, a live authenticator code, and is never
     one's own document; the signature used is kept on the approval row.
   - Stamp: the company's own active stamp, only on the types its policy
     lists, only beside a verified signature, and - when an approval is
     required - only once approved. Never the other company's.
   - Issued: the first share or print of a revision fixes the assets in
     document_issuances (append-only, a trigger refuses edits). A signature
     replaced tomorrow never changes what was issued today.
   - Raw files: a stamp or a signature is served only for a document the
     caller may open, or to the owner managing them, or a signature to its
     own person. Every serve is audited.

   A scanned signature is a visual mark, not a cryptographic signature; the
   screens say so. */
import type { Env } from "./index";
import { totpVerifyOnce } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit } from "./shared";
import { can } from "./permissions";

export const ISSUERS = ["a2z", "azoo"] as const;
export type IssuerCode = (typeof ISSUERS)[number];
export const ISSUER_NAMES: Record<IssuerCode, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" }; // lib/issuers.ts is the source; the Worker cannot import it
const DOC_TYPES = ["QT", "INV", "DO"] as const;
const entityOf = (code: string | null | undefined): IssuerCode => (code === "a2z" ? "a2z" : "azoo"); // NULL = legacy = AZ ONE (0073)
const missing = (e: unknown) => /no such table|no such column/i.test(String(e));
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** The people who manage signatures and stamps: the CEO and the super admin (recovery). */
export const signAdmin = (u: { role: string }) => u.role === "ceo" || u.role === "super_admin";

/** A live authenticator code, ALWAYS - a person without 2FA cannot sign anything here. */
export async function requireTotp(env: Env, user: { id: number }, code: unknown, what: string): Promise<Response | null> {
  const row = await env.DB.prepare(`SELECT totp_secret, totp_enabled FROM users WHERE id = ?1`).bind(user.id).first<{ totp_secret: string | null; totp_enabled: number }>().catch(() => null);
  if (!row?.totp_secret || !row.totp_enabled) return err("totp_setup_required", "Turn on two-factor sign-in (Profile > Security) before you can " + what, 403);
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return err("totp_required", `Enter your 6-digit authenticator code to ${what}`, 401);
  if (!(await totpVerifyOnce(env, user.id, row.totp_secret, code.trim()))) return err("totp_invalid", "That code is not valid (or has already been used) - open your authenticator and try the current one", 401);
  return null;
}

/* ---------------------------------------------------------------- policy */

export interface Policy { issuer_code: IssuerCode; personal: boolean; stamp_on: string[]; updated_at: string | null; updated_by_name?: string | null }
export async function readPolicy(env: Env, issuer: IssuerCode): Promise<Policy> {
  try {
    const r = await env.DB.prepare(`SELECT p.*, ${PERSON("u")} AS updated_by_name FROM signing_policies p LEFT JOIN users u ON u.id = p.updated_by WHERE p.issuer_code = ?1`).bind(issuer)
      .first<{ personal: number; stamp_on: string; updated_at: string | null; updated_by_name: string | null }>();
    if (r) return { issuer_code: issuer, personal: !!r.personal, stamp_on: r.stamp_on.split(",").filter(Boolean), updated_at: r.updated_at, updated_by_name: r.updated_by_name };
  } catch (e) { if (!missing(e)) throw e; }
  return { issuer_code: issuer, personal: false, stamp_on: [], updated_at: null };
}

/** The CEO's quotation approval limit (business.ts /quotes/approval, v1.181.17) - the one rule. */
export async function approvalLimit(env: Env): Promise<{ limit_cents: number; since: string } | null> {
  const row = await env.DB.prepare(`SELECT value FROM business_settings WHERE key = 'quote_approval'`).first<{ value: string | null }>().catch(() => null);
  try { const v = row?.value ? JSON.parse(row.value) as { limit_cents: number; since: string } : null; return v && v.limit_cents > 0 ? v : null; } catch { return null; }
}
/** Same test as the Sales list and the Desk: a quotation over the limit, made or revised since it was set. */
export function overLimit(d: { doc_type: string; total_cents: number; created_at: string; revised_at?: string | null }, lim: { limit_cents: number; since: string } | null, total = d.total_cents): boolean {
  if (!lim || d.doc_type !== "QT" || !(total > lim.limit_cents)) return false;
  const when = d.revised_at ? new Date(Date.parse(d.revised_at.replace(" ", "T") + "Z") - 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") : d.created_at;
  return when >= lim.since;
}

/* ---------------------------------------------------------------- assets */

export interface Asset { id: number; issuer_code: string; role: string; version: number; r2_key: string; sha256: string | null; user_id: number | null; kind: string | null; status: string | null; consented_at: string | null; approved_by: number | null; approved_at: string | null; uploaded_at: string; uploaded_by: number | null; retired_at: string | null; note: string | null }

/** A person's active signature (one signature serves both companies; the authority is per company). */
export async function activeSignature(env: Env, userId: number | null | undefined): Promise<Asset | null> {
  if (!userId) return null;
  return env.DB.prepare(`SELECT * FROM signature_assets WHERE user_id = ?1 AND kind = 'signature' AND status = 'active' ORDER BY id DESC LIMIT 1`).bind(userId).first<Asset>().catch(() => null);
}
/** A company's active stamp - never the other company's. */
export async function activeStamp(env: Env, issuer: IssuerCode): Promise<Asset | null> {
  return env.DB.prepare(`SELECT * FROM signature_assets WHERE kind = 'stamp' AND issuer_code = ?1 AND status = 'active' ORDER BY id DESC LIMIT 1`).bind(issuer).first<Asset>().catch(() => null);
}
export async function hasAuthority(env: Env, userId: number | null | undefined, issuer: IssuerCode, capacity: "prepare" | "approve", docType: string): Promise<boolean> {
  if (!userId) return false;
  /* a person who has left (is_active = 0) signs nothing new - their old documents keep their issuance */
  const rows = await env.DB.prepare(`SELECT g.doc_types FROM signing_authorities g JOIN users u ON u.id = g.user_id AND u.is_active = 1 WHERE g.user_id = ?1 AND g.issuer_code = ?2 AND g.capacity = ?3 AND g.revoked_at IS NULL`).bind(userId, issuer, capacity).all<{ doc_types: string }>().catch(() => ({ results: [] as { doc_types: string }[] }));
  return (rows.results ?? []).some((r) => r.doc_types.split(",").includes(docType));
}

/* ---------------------------------------------------------------- the plan */

interface DocRow { id: number; doc_type: string; issuer_code: string | null; created_by: number | null; total_cents: number; revision: number | null; created_at: string; revised_at?: string | null; payment_status?: string | null; items?: string; discount_cents?: number; tax_percent?: number; delivery_cents?: number; customer_id?: number }
export interface SignPlan {
  mode: "legacy" | "personal";
  issuer: IssuerCode;
  prepared: { user_id: number | null; name: string | null; position: string | null; asset_id: number | null } | null;
  approved: { user_id: number; name: string | null; position: string | null; asset_id: number | null; at: string } | null;
  stamp_asset_id: number | null;
  needs_approval: boolean;
  blocked: string | null;
  notice: string | null;
  issued: { at: string; by: number | null } | null;
}

async function person(env: Env, id: number | null | undefined): Promise<{ name: string | null; position: string | null }> {
  if (!id) return { name: null, position: null };
  const u = await env.DB.prepare(`SELECT ${PERSON("u")} AS name, u.position FROM users u WHERE u.id = ?1`).bind(id).first<{ name: string; position: string | null }>().catch(() => null);
  return { name: u?.name ?? null, position: u?.position ?? null };
}

export async function loadDocForSigning(env: Env, docId: number | string): Promise<DocRow | null> {
  return env.DB.prepare(`SELECT id, doc_type, issuer_code, created_by, total_cents, COALESCE(revision, 0) AS revision, created_at, revised_at, payment_status, items, discount_cents, tax_percent, delivery_cents, customer_id FROM sales_documents WHERE id = ?1`).bind(docId).first<DocRow>().catch(() => null);
}

/** What signs this document - from its issuance when it was issued, else as it stands. */
export async function signPlan(env: Env, d: DocRow): Promise<SignPlan> {
  const issuer = entityOf(d.issuer_code);
  const pol = await readPolicy(env, issuer);
  const base: SignPlan = { mode: "legacy", issuer, prepared: null, approved: null, stamp_asset_id: null, needs_approval: false, blocked: null, notice: null, issued: null };
  if (!pol.personal) return base;
  const rev = Number(d.revision ?? 0);
  const needs = overLimit(d, await approvalLimit(env));
  const iss = await env.DB.prepare(`SELECT * FROM document_issuances WHERE doc_id = ?1 AND revision = ?2`).bind(d.id, rev)
    .first<{ preparer_id: number | null; preparer_asset_id: number | null; approver_id: number | null; approver_asset_id: number | null; stamp_asset_id: number | null; issued_at: string; issued_by: number | null }>().catch(() => null);
  const appr = await env.DB.prepare(`SELECT approved_by AS approver_id, signature_asset_id, approved_at FROM quotation_approvals WHERE doc_id = ?1 AND revision = ?2`).bind(d.id, rev)
    .first<{ approver_id: number; signature_asset_id: number | null; approved_at: string }>().catch(() => null);
  if (iss) {
    const p = await person(env, iss.preparer_id), a = iss.approver_id ? await person(env, iss.approver_id) : null;
    return { mode: "personal", issuer, needs_approval: needs, blocked: null, notice: null, issued: { at: iss.issued_at, by: iss.issued_by },
      prepared: { user_id: iss.preparer_id, ...p, asset_id: iss.preparer_asset_id },
      approved: iss.approver_id && a ? { user_id: iss.approver_id, ...a, asset_id: iss.approver_asset_id, at: appr?.approved_at ?? iss.issued_at } : null,
      stamp_asset_id: iss.stamp_asset_id };
  }
  const p = await person(env, d.created_by);
  const sig = (await hasAuthority(env, d.created_by, issuer, "prepare", d.doc_type)) ? await activeSignature(env, d.created_by) : null;
  const approved = appr ? { user_id: appr.approver_id, ...(await person(env, appr.approver_id)), asset_id: appr.signature_asset_id, at: appr.approved_at } : null;
  const stamp = pol.stamp_on.includes(d.doc_type) && (sig || approved) && (!needs || approved) ? await activeStamp(env, issuer) : null;
  const blocked = needs && !approved ? "Waiting for management approval - this quotation is a draft until a signatory approves it" : null;
  const notice = !sig ? (await hasAuthority(env, d.created_by, issuer, "prepare", d.doc_type)
    ? "The preparer's signature is not active yet - it prints with an ink line"
    : "The preparer has no signing authority for this company - it prints with an ink line") : null;
  return { mode: "personal", issuer, prepared: { user_id: d.created_by, ...p, asset_id: sig?.id ?? null }, approved, stamp_asset_id: stamp?.id ?? null, needs_approval: needs, blocked, notice, issued: null };
}

/** The canonical content of a revision, hashed into its issuance. */
async function contentHash(d: DocRow): Promise<string> {
  const canon = JSON.stringify([d.id, d.doc_type, d.issuer_code, d.revision ?? 0, d.customer_id, d.items, d.discount_cents, d.tax_percent, d.delivery_cents, d.total_cents]);
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fix the plan at the first share or print. Once per revision; refused while approval is outstanding. */
export async function issueDoc(env: Env, d: DocRow, byUser: number): Promise<{ ok: true; plan: SignPlan } | { ok: false; res: Response }> {
  const plan = await signPlan(env, d);
  if (plan.mode !== "personal" || plan.issued) return { ok: true, plan };
  if (plan.blocked) return { ok: false, res: err("approval_required", plan.blocked, 409) };
  await env.DB.prepare(
    `INSERT INTO document_issuances (doc_id, revision, issuer_code, preparer_id, preparer_asset_id, approver_id, approver_asset_id, stamp_asset_id, content_sha256, issued_by, issued_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(doc_id, revision) DO NOTHING`,
  ).bind(d.id, Number(d.revision ?? 0), plan.issuer, plan.prepared?.user_id ?? null, plan.prepared?.asset_id ?? null, plan.approved?.user_id ?? null, plan.approved?.asset_id ?? null, plan.stamp_asset_id, await contentHash(d), byUser, now()).run();
  await audit(env, byUser, "doc.issue", "sales_documents", String(d.id), { revision: d.revision ?? 0, preparer_asset: plan.prepared?.asset_id ?? null, approver_asset: plan.approved?.asset_id ?? null, stamp_asset: plan.stamp_asset_id });
  return { ok: true, plan: await signPlan(env, d) };
}

/** The asset a document shows in one block ("prepared" / "approved" / "stamp"), personal mode only. */
export async function assetForDoc(env: Env, d: DocRow, which: string): Promise<Asset | null> {
  const plan = await signPlan(env, d);
  if (plan.mode !== "personal") return null;
  const id = which === "prepared" ? plan.prepared?.asset_id : which === "approved" ? plan.approved?.asset_id : which === "stamp" ? plan.stamp_asset_id : null;
  if (!id) return null;
  return env.DB.prepare(`SELECT * FROM signature_assets WHERE id = ?1`).bind(id).first<Asset>().catch(() => null);
}

/* ---------------------------------------------------------------- routes */

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

export type LegacyKey = (issuer: string | null, role: string, at: string | null) => Promise<string | null>;
/** The v1.4.233 role rule: an officer's own document carries that officer's chop, anyone else's invoice the CEO's, the rest ink. */
export const legacyRole = (creatorRole: string | null | undefined, docType: string): string | null =>
  ["ceo", "coo", "cco"].includes(creatorRole ?? "") ? creatorRole! : docType === "INV" ? "ceo" : null;

export async function handleSigning(env: Env, request: Request, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, legacyKey: LegacyKey): Promise<Response | null> {
  const admin = signAdmin(user);
  const url = new URL(request.url);
  try {
    /* ---- the management view ---- */
    if (path === "/signing/overview" && method === "GET") {
      if (!admin && !["coo", "cco"].includes(user.role)) return err("forbidden", "Signatures and stamps are managed by the CEO", 403);
      const policies = await Promise.all(ISSUERS.map((i) => readPolicy(env, i)));
      const stamps = (await env.DB.prepare(`SELECT s.id, s.issuer_code, s.version, s.status, s.uploaded_at, s.sha256, s.retired_at, ${PERSON("u")} AS uploaded_by_name FROM signature_assets s LEFT JOIN users u ON u.id = s.uploaded_by WHERE s.kind = 'stamp' ORDER BY s.id DESC`).all()).results;
      const sigs = (await env.DB.prepare(
        `SELECT s.id, s.user_id, s.version, s.status, s.uploaded_at, s.consented_at, s.approved_at, s.retired_at, s.note, ${PERSON("u")} AS uploaded_by_name, ${PERSON("a")} AS approved_by_name
           FROM signature_assets s LEFT JOIN users u ON u.id = s.uploaded_by LEFT JOIN users a ON a.id = s.approved_by WHERE s.kind = 'signature' ORDER BY s.id DESC`).all()).results;
      const auths = (await env.DB.prepare(
        `SELECT g.id, g.user_id, g.issuer_code, g.capacity, g.doc_types, g.granted_at, g.reason, ${PERSON("u")} AS granted_by_name FROM signing_authorities g LEFT JOIN users u ON u.id = g.granted_by WHERE g.revoked_at IS NULL ORDER BY g.id`).all()).results;
      const ids = [...new Set([...sigs.map((s) => (s as { user_id: number }).user_id), ...auths.map((a) => (a as { user_id: number }).user_id)])];
      const people = ids.length ? (await env.DB.prepare(
        `SELECT u.id, ${PERSON("u")} AS name, u.role, u.position, u.department, u.employee_id, u.photo_key, u.is_active, u.left_on, u.employment_status FROM users u WHERE u.id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results : [];
      return json({ can_manage: admin, approval_limit: await approvalLimit(env), issuers: ISSUERS.map((c) => ({ code: c, name: ISSUER_NAMES[c] })), policies, stamps, signatures: sigs, authorities: auths, people });
    }

    if (path === "/signing/me" && method === "GET") {
      const mine = (await env.DB.prepare(`SELECT id, version, status, uploaded_at, consented_at, approved_at, retired_at, uploaded_by FROM signature_assets WHERE user_id = ?1 AND kind = 'signature' ORDER BY id DESC LIMIT 10`).bind(user.id).all()).results;
      const auths = (await env.DB.prepare(`SELECT issuer_code, capacity, doc_types FROM signing_authorities WHERE user_id = ?1 AND revoked_at IS NULL`).bind(user.id).all()).results;
      return json({ signatures: mine, authorities: auths });
    }

    /* ---- the company policy (owner, authenticator) ---- */
    const pol = path.match(/^\/signing\/policy\/(a2z|azoo)$/);
    if (pol && method === "PUT") {
      if (!admin) return err("forbidden", "Only the CEO sets a company's signing policy", 403);
      const no = await requireTotp(env, user, body?.totp, "change a company's signing policy"); if (no) return no;
      const issuer = pol[1] as IssuerCode;
      const cur = await readPolicy(env, issuer);
      const personal = typeof body?.personal === "boolean" ? body.personal : cur.personal;
      const stampOn = Array.isArray(body?.stamp_on) ? [...new Set((body!.stamp_on as unknown[]).filter((x): x is string => typeof x === "string" && (DOC_TYPES as readonly string[]).includes(x)))] : cur.stamp_on;
      await env.DB.prepare(
        `INSERT INTO signing_policies (issuer_code, personal, stamp_on, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(issuer_code) DO UPDATE SET personal = ?2, stamp_on = ?3, updated_by = ?4, updated_at = ?5`,
      ).bind(issuer, personal ? 1 : 0, stampOn.join(","), user.id, now()).run();
      await audit(env, user.id, "signing.policy", "signing_policies", issuer, { from: cur, to: { personal, stamp_on: stampOn } });
      return json({ ok: true, policy: await readPolicy(env, issuer) });
    }

    /* ---- upload a signature (a person's) or a stamp (a company's) ---- */
    if (path === "/signing/assets" && method === "POST") {
      const kind = url.searchParams.get("kind");
      if (kind !== "signature" && kind !== "stamp") return err("invalid_input", "kind is signature or stamp", 400);
      const totp = request.headers.get("X-Totp") ?? "";
      const forUser = kind === "signature" ? Number(url.searchParams.get("user") ?? user.id) : null;
      const issuer = kind === "stamp" ? url.searchParams.get("issuer") : null;
      if (kind === "stamp" && !(ISSUERS as readonly string[]).includes(issuer ?? "")) return err("invalid_input", "Choose the company the stamp belongs to", 400);
      const self = kind === "signature" && forUser === user.id;
      if (!self && !admin) return err("forbidden", kind === "stamp" ? "Only the CEO uploads a company stamp" : "You can upload only your own signature - the CEO registers others", 403);
      if (kind === "signature" && forUser !== user.id) {
        const t = await env.DB.prepare(`SELECT id, role, is_active FROM users WHERE id = ?1`).bind(forUser).first<{ id: number; role: string; is_active: number }>();
        if (!t || t.role === "customer" || !t.is_active) return err("invalid_input", "Signatures are for current staff only", 400);
      }
      const no = await requireTotp(env, user, totp, kind === "stamp" ? "upload a company stamp" : "register a signature"); if (no) return no;
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!isPng(bytes)) return err("invalid_input", "Upload a PNG (a transparent background works best)", 400);
      if (bytes.byteLength > 1024 * 1024) return err("too_large", "Keep it under 1 MB", 413);
      const dig = await crypto.subtle.digest("SHA-256", bytes);
      const sha = [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const ent = kind === "stamp" ? issuer! : "all";
      const role = kind === "stamp" ? "stamp" : `user:${forUser}`;
      const last = await env.DB.prepare(`SELECT MAX(version) AS v FROM signature_assets WHERE issuer_code = ?1 AND role = ?2`).bind(ent, role).first<{ v: number | null }>();
      const version = Number(last?.v ?? 0) + 1;
      const key = kind === "stamp" ? `private/signatures/stamps/${ent}-v${version}.png` : `private/signatures/people/${forUser}-v${version}.png`;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
      /* a stamp is a company asset: the owner's upload is its approval, and it replaces the active one.
         a signature waits for BOTH the person's confirmation and the owner's approval */
      const t0 = now();
      const consented = self ? t0 : null;
      const approvedBy = admin ? user.id : null;
      const active = kind === "stamp" || (consented && approvedBy);
      if (active) {
        if (kind === "stamp") await env.DB.prepare(`UPDATE signature_assets SET status = 'retired', retired_at = ?2 WHERE kind = 'stamp' AND issuer_code = ?1 AND status = 'active'`).bind(ent, t0).run();
        else await env.DB.prepare(`UPDATE signature_assets SET status = 'retired', retired_at = ?2 WHERE kind = 'signature' AND user_id = ?1 AND status = 'active'`).bind(forUser, t0).run();
      }
      const ins = await env.DB.prepare(
        `INSERT INTO signature_assets (issuer_code, role, version, r2_key, sha256, uploaded_by, uploaded_at, user_id, kind, status, consented_at, approved_by, approved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) RETURNING id`,
      ).bind(ent, role, version, key, sha, user.id, t0, forUser, kind, active ? "active" : "pending", consented, approvedBy, approvedBy ? t0 : null).first<{ id: number }>();
      await audit(env, user.id, `signing.${kind}_upload`, "signature_assets", String(ins?.id), { for_user: forUser, issuer: issuer, version, sha256: sha, status: active ? "active" : "pending" });
      return json({ ok: true, id: ins?.id, status: active ? "active" : "pending", waiting_for: active ? null : consented ? "owner approval" : "the person's confirmation" }, 201);
    }

    const act = path.match(/^\/signing\/assets\/(\d+)\/(consent|approve|retire|image)$/);
    if (act) {
      const a = await env.DB.prepare(`SELECT * FROM signature_assets WHERE id = ?1 AND kind IS NOT NULL`).bind(act[1]).first<Asset>();
      if (!a) return err("not_found", "Signature or stamp not found", 404);
      if (act[2] === "image" && method === "GET") {
        const mine = a.kind === "signature" && a.user_id === user.id;
        if (!admin && !mine) return err("forbidden", "A signature is shown to its own person and the CEO; a stamp to the CEO", 403);
        const obj = await env.MEDIA.get(a.r2_key);
        if (!obj) return err("not_found", "The file is not in the vault", 404);
        await audit(env, user.id, "signature.serve", "signature_assets", String(a.id), { context: "manage" });
        return new Response(obj.body, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store, private" } });
      }
      if (method !== "POST") return null;
      if (act[2] === "consent") {
        if (a.kind !== "signature" || a.user_id !== user.id) return err("forbidden", "Only the person whose signature it is confirms it", 403);
        if (a.status !== "pending") return err("invalid_state", "This signature is not waiting for your confirmation", 409);
        const no = await requireTotp(env, user, body?.totp, "confirm this is your signature"); if (no) return no;
        return finish(env, a, { consented_at: now() }, user.id, "signing.consent");
      }
      if (act[2] === "approve") {
        if (!admin) return err("forbidden", "Only the CEO approves a signature", 403);
        if (a.kind !== "signature" || a.status !== "pending") return err("invalid_state", "This signature is not waiting for approval", 409);
        const no = await requireTotp(env, user, body?.totp, "approve this signature"); if (no) return no;
        return finish(env, a, { approved_by: user.id, approved_at: now() }, user.id, "signing.approve");
      }
      if (act[2] === "retire") {
        if (!admin && !(a.kind === "signature" && a.user_id === user.id)) return err("forbidden", "Only the CEO, or the person for their own signature, retires it", 403);
        const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
        if (reason.length < 5) return err("invalid_input", "Say why (at least 5 characters) - it is kept in the history", 400);
        const no = await requireTotp(env, user, body?.totp, "retire a signature or stamp"); if (no) return no;
        await env.DB.prepare(`UPDATE signature_assets SET status = 'retired', retired_at = ?2, note = ?3 WHERE id = ?1 AND kind IS NOT NULL AND status != 'retired'`).bind(a.id, now(), reason.slice(0, 300)).run();
        await audit(env, user.id, "signing.retire", "signature_assets", String(a.id), { reason, kind: a.kind });
        return json({ ok: true });
      }
    }

    /* ---- signing authority per company and document type ---- */
    if (path === "/signing/authorities" && method === "POST") {
      if (!admin) return err("forbidden", "Only the CEO grants signing authority", 403);
      const uid = Number(body?.user_id), issuer = String(body?.issuer_code ?? ""), cap = String(body?.capacity ?? "");
      const types = Array.isArray(body?.doc_types) ? [...new Set((body!.doc_types as unknown[]).filter((x): x is string => typeof x === "string" && (DOC_TYPES as readonly string[]).includes(x)))] : [];
      if (!(ISSUERS as readonly string[]).includes(issuer) || !["prepare", "approve"].includes(cap) || !types.length) return err("invalid_input", "Choose the company, prepare or approve, and at least one document type", 400);
      const t = await env.DB.prepare(`SELECT id, role, is_active FROM users WHERE id = ?1`).bind(uid).first<{ id: number; role: string; is_active: number }>();
      if (!t || t.role === "customer" || !t.is_active) return err("invalid_input", "Signing authority is for current staff only", 400);
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 5) return err("invalid_input", "Say why (at least 5 characters) - it is kept in the history", 400);
      const no = await requireTotp(env, user, body?.totp, "grant signing authority"); if (no) return no;
      /* one live grant per person, company and capacity: a new grant replaces the old one */
      await env.DB.prepare(`UPDATE signing_authorities SET revoked_at = ?4, revoked_by = ?5 WHERE user_id = ?1 AND issuer_code = ?2 AND capacity = ?3 AND revoked_at IS NULL`).bind(uid, issuer, cap, now(), user.id).run();
      const ins = await env.DB.prepare(`INSERT INTO signing_authorities (user_id, issuer_code, capacity, doc_types, granted_by, granted_at, reason) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`)
        .bind(uid, issuer, cap, types.join(","), user.id, now(), reason.slice(0, 300)).first<{ id: number }>();
      await audit(env, user.id, "signing.grant", "signing_authorities", String(ins?.id), { user_id: uid, issuer, capacity: cap, doc_types: types, reason });
      return json({ ok: true, id: ins?.id }, 201);
    }
    const rev = path.match(/^\/signing\/authorities\/(\d+)\/revoke$/);
    if (rev && method === "POST") {
      if (!admin) return err("forbidden", "Only the CEO revokes signing authority", 403);
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 5) return err("invalid_input", "Say why (at least 5 characters)", 400);
      const no = await requireTotp(env, user, body?.totp, "revoke signing authority"); if (no) return no;
      const r = await env.DB.prepare(`UPDATE signing_authorities SET revoked_at = ?2, revoked_by = ?3 WHERE id = ?1 AND revoked_at IS NULL`).bind(rev[1], now(), user.id).run();
      if (!Number((r as { meta?: { changes?: number } }).meta?.changes ?? 0)) return err("not_found", "No live authority with that id", 404);
      await audit(env, user.id, "signing.revoke", "signing_authorities", rev[1]!, { reason });
      return json({ ok: true });
    }

    /* ---- what a document under preparation would carry (the Create form preview) ---- */
    if (path === "/signing/my-plan" && method === "GET") {
      const issuer = entityOf(url.searchParams.get("issuer"));
      const docType = url.searchParams.get("doc_type") ?? "QT";
      const total = Number(url.searchParams.get("total") ?? 0);
      const p = await readPolicy(env, issuer);
      if (!p.personal) {
        /* the same signer the saved document will name (staff.ts GET /docs/:id, v1.4.233) */
        const role = legacyRole(user.role, docType);
        const who = role
          ? await env.DB.prepare(`SELECT ${PERSON("u")} AS name, u.position FROM users u WHERE u.role = ?1 AND u.is_active = 1 ORDER BY u.id LIMIT 1`).bind(role).first<{ name: string; position: string | null }>().catch(() => null)
          : await person(env, user.id);
        return json({ mode: "legacy", signer_role: role, signer_name: who?.name ?? null, signer_position: who?.position ?? null });
      }
      const auth = await hasAuthority(env, user.id, issuer, "prepare", docType);
      const sig = auth ? await activeSignature(env, user.id) : null;
      const needs = overLimit({ doc_type: docType, total_cents: total, created_at: now() }, await approvalLimit(env));
      const stamp = !needs && sig && p.stamp_on.includes(docType) ? await activeStamp(env, issuer) : null;
      const me = await person(env, user.id);
      return json({ mode: "personal", prepared: { ...me, has_signature: !!sig }, stamp: !!stamp, needs_approval: needs,
        notice: !auth ? "You have no signing authority for this company - the document prints with your name and an ink line" : !sig ? "Your signature is not registered or not yet approved - it prints with an ink line" : needs ? "This quotation needs a management approval before it is issued" : null });
    }
    if (path === "/signing/my-preview" && method === "GET") {
      /* the preparer's OWN signature (and the company stamp beside it, when the policy allows) for the live preview */
      const which = url.searchParams.get("which") ?? "prepared";
      const issuer = entityOf(url.searchParams.get("issuer"));
      const docType = url.searchParams.get("doc_type") ?? "QT";
      if (!can(user.role, "sales") && !(docType === "INV" && can(user.role, "finance"))) return err("forbidden", "Insufficient rights for this document type", 403);
      const p = await readPolicy(env, issuer);
      let r2: string | null = null;
      if (!p.personal) {
        /* audit D3: the preview shows exactly what the saved document will print - the creator's
           own officer chop, the CEO's on an invoice, or nothing (ink) - never the CEO's for everyone */
        const role = which === "prepared" ? legacyRole(user.role, docType) : null;
        r2 = role ? await legacyKey(issuer, role, null) : null;
      } else if (await hasAuthority(env, user.id, issuer, "prepare", docType)) {
        const sig = await activeSignature(env, user.id);
        const needs = overLimit({ doc_type: docType, total_cents: Number(url.searchParams.get("total") ?? 0), created_at: now() }, await approvalLimit(env));
        const asset = which === "stamp" ? (sig && !needs && p.stamp_on.includes(docType) ? await activeStamp(env, issuer) : null) : which === "prepared" ? sig : null;
        r2 = asset?.r2_key ?? null;
      }
      if (!r2) return err("not_found", "No signature for this preview", 404);
      const obj = await env.MEDIA.get(r2);
      if (!obj) return err("not_found", "Not in the vault", 404);
      return new Response(obj.body, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store, private" } });
    }
    return null;
  } catch (e) {
    if (missing(e)) return err("migration_missing", "Run the database migrations first (0162) - PUSH.bat does this", 503);
    throw e;
  }
}

async function finish(env: Env, a: Asset, set: { consented_at?: string; approved_by?: number; approved_at?: string }, by: number, action: string): Promise<Response> {
  const consented = set.consented_at ?? a.consented_at;
  const approved = set.approved_at ?? a.approved_at;
  const active = !!(consented && approved);
  if (active) await env.DB.prepare(`UPDATE signature_assets SET status = 'retired', retired_at = ?2 WHERE kind = 'signature' AND user_id = ?1 AND status = 'active'`).bind(a.user_id, now()).run();
  await env.DB.prepare(`UPDATE signature_assets SET consented_at = ?2, approved_by = COALESCE(?3, approved_by), approved_at = ?4, status = ?5 WHERE id = ?1 AND kind = 'signature'`)
    .bind(a.id, consented, set.approved_by ?? null, approved, active ? "active" : "pending").run();
  await audit(env, by, action, "signature_assets", String(a.id), { user_id: a.user_id, active });
  return json({ ok: true, status: active ? "active" : "pending" });
}

/* ---------------------------------------------------------------- document routes (staff) */

/** The quotation approval (business.ts POST /docs/:id/approve) once the company signs
    personally: approving SIGNS. Null = the company still signs with the role chops,
    and the CEO-only approval of v1.181.17 answers as before. */
export async function personalApprove(env: Env, docId: number, body: Record<string, unknown> | null, user: StaffUser): Promise<Response | null> {
  try {
    const d = await loadDocForSigning(env, docId);
    if (!d || d.doc_type !== "QT") return null;
    const issuer = entityOf(d.issuer_code);
    if (!(await readPolicy(env, issuer)).personal) return null;
    if (d.created_by === user.id) return err("forbidden", "Nobody approves their own quotation", 403);
    if (!(await hasAuthority(env, user.id, issuer, "approve", d.doc_type))) return err("forbidden", `You have no approval authority for ${ISSUER_NAMES[issuer]} quotations - the CEO grants it in Users > Signatures & Stamps`, 403);
    const sig = await activeSignature(env, user.id);
    if (!sig) return err("invalid_state", "Your signature is not active yet - register and confirm it first (Profile > Security > Document signature)", 409);
    const no = await requireTotp(env, user, body?.totp, "approve and sign this quotation"); if (no) return no;
    const ins = await env.DB.prepare(`INSERT INTO quotation_approvals (doc_id, revision, approved_by, approved_at, note, signature_asset_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(doc_id, revision) DO NOTHING`)
      .bind(d.id, Number(d.revision ?? 0), user.id, now(), typeof body?.note === "string" ? body.note.trim().slice(0, 300) || null : null, sig.id).run();
    if (!Number((ins as { meta?: { changes?: number } }).meta?.changes ?? 0)) return err("already_approved", "This revision is already approved", 409);
    await audit(env, user.id, "sales.quote_approve", "sales_documents", String(d.id), { revision: d.revision ?? 0, signature_asset: sig.id, personal: true });
    return json({ ok: true, revision: d.revision ?? 0, sign: await signPlan(env, d) }, 201);
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/** POST /docs/:id/issue, GET /docs/:id/sign-image, GET /docs/:id/sign-plan */
export async function handleDocSigning(env: Env, request: Request, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser,
  legacyKey: LegacyKey): Promise<Response | null> {
  const m = path.match(/^\/docs\/(\d+)\/(issue|sign-image|sign-plan)$/);
  if (!m) return null;
  const d0 = await loadDocForSigning(env, m[1]!);
  if (!d0) return err("not_found", "Document not found", 404);
  /* an earlier revision (printed from History) reads ITS OWN issuance - never a later one */
  const qRev = new URL(request.url).searchParams.get("revision");
  const d: DocRow = qRev !== null && /^\d+$/.test(qRev) && Number(qRev) <= Number(d0.revision ?? 0) && method === "GET" ? { ...d0, revision: Number(qRev) } : d0;
  const readable = d.doc_type === "INV" ? can(user.role, "sales") || can(user.role, "finance") : can(user.role, "sales");
  if (!readable) return err("forbidden", "Insufficient rights for this document", 403);
  try {
    if (m[2] === "sign-plan" && method === "GET") {
      const plan = await signPlan(env, d);
      const issuer = entityOf(d.issuer_code);
      const can_approve = plan.mode === "personal" && !plan.approved && !plan.issued && d.payment_status !== "void" && d.created_by !== user.id
        && Number(d.revision ?? 0) === Number(d0.revision ?? 0)
        && (await hasAuthority(env, user.id, issuer, "approve", d.doc_type)) && !!(await activeSignature(env, user.id));
      return json({ sign: plan, can_approve });
    }
    if (m[2] === "issue" && method === "POST") {
      const r = await issueDoc(env, d, user.id);
      return r.ok ? json({ ok: true, sign: r.plan }) : r.res;
    }
    if (m[2] === "sign-image" && method === "GET") {
      const which = new URL(request.url).searchParams.get("which") ?? "prepared";
      const plan = await signPlan(env, d);
      let key: string | null = null;
      if (plan.mode === "personal") key = (await assetForDoc(env, d, which))?.r2_key ?? null;
      else if (which === "prepared") {
        /* the v1.4.233 role rule, at the version current on the document's own date */
        const cbRole = d.created_by ? (await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(d.created_by).first<{ role: string }>().catch(() => null))?.role ?? "" : "";
        const role = legacyRole(cbRole, d.doc_type);
        key = role ? await legacyKey(d.issuer_code, role, d.created_at) : null;
      }
      if (!key) return err("not_found", "No signature in this block", 404);
      const obj = await env.MEDIA.get(key);
      if (!obj) return err("not_found", "Signature not on file", 404);
      await audit(env, user.id, "signature.serve", "r2", key, { context: `doc:${d.id}:${which}` });
      return new Response(obj.body, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store, private" } });
    }
  } catch (e) {
    if (missing(e)) return err("migration_missing", "Run the database migrations first (0162) - PUSH.bat does this", 503);
    throw e;
  }
  return null;
}
