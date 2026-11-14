/* v1.302.0 - FINANCIAL ADVISORY 2.0, PHASE 5: THE AGREEMENT TEMPLATE LIBRARY,
   THE AUTO-FILLED DRAFT AND THE ADVISORY FEE AFTER A RECORDED DISBURSEMENT
   (the CEO, 13-11-2026: "Phase 5 now"; blueprint sections 10-11, decisions
   D-5 A, D-6 and D-7 as recommended; the fee on by his decision without a
   legal review, recorded so).

   The library (fa_templates, fa_template_versions - migration 0192)
     - fa_templates holders (CEO, COO, CCO) add a template (company, service),
       upload its DOCX - the Worker reads the text out of the zip with the
       platform's own decompression, no new library - or type it, edit a
       DRAFT, and submit it for review. The check on submit: every {{field}}
       known, none broken, the client named, a fee rate if the text uses one,
       and no CTOS reporting, blacklisting or penalty clause.
     - fa_templates_publish (the CEO) publishes a version under review -
       never one he drafted (the verified owner account apart) - recording
       the legal basis: reviewed by counsel (reviewer, firm, day, reference),
       or published by the CEO without a legal review (the verified owner
       account only, acknowledged, shown so on the version). The fee rate is
       set on the version; no rate is written in code. Publishing archives
       the version it supersedes. Past draft a version's text, fields, fee
       and source hash never change (trigger); every change is a new version.
   The draft agreement (fa_agreement_drafts)
     - auto-filled from the authoritative records only: the customer, the
       case, the profile's MASKED IC, the issuing company (lib/issuers.ts),
       today, the version's fee rate and a disbursement recorded with the
       bank's evidence. Nothing is invented: a field with no value is listed
       as missing and the draft cannot be prepared.
     - the full IC (D-7): typed for that one document by someone who may
       change the case, checked against the profile's keyed hash, never
       stored, never logged (the audit says only that one was typed).
     - always watermarked DRAFT. Sending and signing stay OFF
       (FA_LEGAL.agreement) - POST /fa/cases/:id/agreement answers legal_gate.
   The advisory fee (fa_fee_bills)
     - only from ONE disbursement decision note carrying the bank's evidence
       and an amount (never an estimate, never a corrected record), with an
       APPROVED template version of the case's company and service that sets
       a fee rate. One fee per disbursement.
     - prepared as the normal Sales quotation (the agent-request handoff:
       source fa_fee) - quotation, invoice and the CEO's payment verification
       are the existing engine. No invoice and no cash row is written here.
     - commission stays OFF (FA_LEGAL.commission): refused unless the fee
       line earns nothing under every commission policy in force (a package
       rule of none) - see commission.ts earnsNothing.
   No CTOS reporting, blacklisting or penalty anywhere. */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { notify } from "./staff";
import { json, err, audit, str } from "./shared";
import { can, rolesFor } from "./permissions";
import { isExecutiveOwner } from "./decision-policy";
import { earnsNothing } from "./commission";
import { todayMyt } from "./fa-registry";
import { resolveIssuer } from "../../lib/issuers";
import type { Case as CaseRow } from "./fa";

interface Ctx {
  caseOf: (env: Env, id: number) => Promise<CaseRow | null>;
  mayOpen: (env: Env, u: StaffUser, c: CaseRow) => Promise<boolean>;
  mayEdit: (u: StaffUser, c: CaseRow) => boolean;
  event: (env: Env, caseId: number, ev: string, actor: number | null, detail?: Record<string, unknown> | null, key?: string | null) => Promise<void>;
  touch: (env: Env, id: number) => Promise<void>;
  icHash: (env: Env, digits: string) => Promise<string>;
  legal: { agreement: boolean; fee: boolean; disclosure: boolean; commission: boolean };
}

/** the fields a template may use - each one filled from a record, never typed into the template */
export const MERGE_FIELDS: Record<string, string> = {
  client_name: "Client name", ic_number: "IC number", client_phone: "Client phone", client_email: "Client email", client_address: "Client address",
  case_ref: "Case reference", service_type: "Service", company_name: "Company", company_registration: "Company registration", company_address: "Company address",
  agreement_date: "Agreement date", fee_rate: "Service fee rate", bank_name: "Bank", disbursed_amount: "Disbursed amount", fee_amount: "Service fee amount",
};
const REQUIRED = ["client_name"];
const FEE_FIELDS = ["fee_rate", "fee_amount"];
/** not built and not allowed in a template (directive 7E) */
const PROHIBITED = /\bCTOS\b|black.?list|senarai hitam|penalt(y|ies)|\bdenda\b/gi;
/** the one line the fee quotation carries - and the name the commission rule of none must match */
export const FEE_LINE = "Financial advisory service fee";
const SERVICES = ["personal_financing", "debt_consolidation", "advisory_only"] as const;
const SERVICE_WORD: Record<string, string> = { personal_financing: "Personal financing advisory", debt_consolidation: "Debt consolidation advisory", advisory_only: "Financial advisory" };
const DOCX_MAX = 2 * 1024 * 1024;
const BODY_MAX = 60_000;
const skew = (e: unknown) => /no such (table|column)/i.test(String(e));
const notReady = () => err("not_ready", "The agreement library opens once the database update (0192) is applied.", 503);
const validDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const PERSON = (a: string) => `COALESCE(NULLIF(TRIM(${a}.full_name), ''), ${a}.name)`;
const rm = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`;
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
/** half up, the same rounding as the commission engine - stated once */
export const feeOf = (baseCents: number, bp: number) => Math.floor((baseCents * bp + 5000) / 10000);

async function sha256(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------ the DOCX text */
async function inflateRaw(data: Uint8Array, max: number): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) throw new Error("too_large");
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let k = 0; for (const p of parts) { out.set(p, k); k += p.length; }
  return out;
}
/** one file out of a zip (the central directory is the truth), or null */
async function unzipOne(zip: Uint8Array, name: string): Promise<Uint8Array | null> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  for (let e = 0; e < count && p + 46 <= zip.length; e++) {
    if (v.getUint32(p, true) !== 0x02014b50) return null;
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const entry = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nl));
    if (entry === name) {
      if (v.getUint32(local, true) !== 0x04034b50) return null;
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = zip.subarray(start, start + csize);
      if (usize > 8 * 1024 * 1024) return null;
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw, 8 * 1024 * 1024);
      return null;
    }
    p += 46 + nl + xl + cl;
  }
  return null;
}
const XML_ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k: string) =>
  k[0] === "#" ? String.fromCodePoint(k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : XML_ENT[k.toLowerCase()] ?? m);
/** The text of a Word document, one paragraph per block; a heading style becomes "# ".
    Runs are joined per paragraph, so a {{field}} split across Word formatting runs is whole again. */
export async function docxText(zip: Uint8Array): Promise<string | null> {
  const xmlBytes = await unzipOne(zip, "word/document.xml");
  if (!xmlBytes) return null;
  const xml = new TextDecoder().decode(xmlBytes);
  const body = xml.slice(Math.max(0, xml.indexOf("<w:body")));
  const out: string[] = [];
  for (const para of body.split(/<\/w:p>/)) {
    const start = para.lastIndexOf("<w:p>") >= 0 ? para.lastIndexOf("<w:p>") : para.search(/<w:p[\s>]/);
    if (start < 0) continue;
    const p = para.slice(start);
    let text = "";
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\s*\/>/g)) text += m[1] !== undefined ? unxml(m[1]) : m[2] === "tab" ? "\t" : "\n";
    text = text.replace(/[ \t]+/g, " ").trim();
    if (!text) continue;
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(p)?.[1] ?? "";
    out.push(/^(heading|title|tajuk)/i.test(style) ? `# ${text}` : text);
  }
  return out.join("\n\n");
}

/* ------------------------------------------------------------ the template text */
export function fieldsIn(body: string): string[] {
  return [...new Set([...body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!))];
}
/** what stops a version going for review */
export function checkTemplate(body: string, feeBp: number | null): { unknown: string[]; broken: boolean; prohibited: string[]; required: string[]; fee_needed: boolean; ok: boolean } {
  const fields = fieldsIn(body);
  const unknown = fields.filter((f) => !(f in MERGE_FIELDS));
  const rest = body.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, "");
  const broken = /\{\{|\}\}/.test(rest);
  const prohibited = [...new Set([...body.matchAll(PROHIBITED)].map((m) => m[0].toLowerCase()))];
  const required = REQUIRED.filter((f) => !fields.includes(f));
  const fee_needed = fields.some((f) => FEE_FIELDS.includes(f)) && !feeBp;
  return { unknown, broken, prohibited, required, fee_needed, ok: !unknown.length && !broken && !prohibited.length && !required.length && !fee_needed && body.trim().length >= 50 };
}
export type Part = { t: string; field?: string; missing?: boolean };
export type Block = { kind: "h" | "p"; parts: Part[] };
/** the merged text as blocks - the preview and the PDF draw the same blocks */
export function mergeBlocks(body: string, values: Record<string, string | null>): { blocks: Block[]; missing: string[] } {
  const missing = new Set<string>();
  const blocks = body.split(/\n\s*\n/).map((raw) => raw.trim()).filter(Boolean).map((raw): Block => {
    const kind = raw.startsWith("# ") ? "h" : "p";
    const text = (kind === "h" ? raw.slice(2) : raw).replace(/\s*\n\s*/g, " ");
    const parts: Part[] = [];
    let last = 0;
    for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
      if (m.index! > last) parts.push({ t: text.slice(last, m.index) });
      const key = m[1]!;
      const v = values[key];
      if (v == null || v === "") { missing.add(key); parts.push({ t: `[${MERGE_FIELDS[key] ?? key}]`, field: key, missing: true }); }
      else parts.push({ t: v, field: key });
      last = m.index! + m[0].length;
    }
    if (last < text.length) parts.push({ t: text.slice(last) });
    return { kind, parts };
  });
  return { blocks, missing: [...missing] };
}
const plain = (blocks: Block[]) => blocks.map((b) => `${b.kind === "h" ? "# " : ""}${b.parts.map((p) => p.t).join("")}`).join("\n\n");

interface Version {
  id: number; template_id: number; version: number; format: string; source_name: string | null; source_r2_key: string | null; source_sha256: string | null;
  body: string; fields_json: string; fee_bp: number | null; state: string; created_by: number; submitted_by: number | null;
}
interface Template { id: number; name: string; issuer_code: string; service_type: string }
async function versionOf(env: Env, id: number): Promise<(Version & { name: string; issuer_code: string; service_type: string }) | null> {
  return env.DB.prepare(`SELECT v.*, t.name, t.issuer_code, t.service_type FROM fa_template_versions v JOIN fa_templates t ON t.id = v.template_id WHERE v.id = ?1`).bind(id).first();
}
const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const feeBpOf = (v: unknown): number | null | "bad" => (v === null || v === undefined || v === "" ? null : typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10000 ? v : "bad");

/** the disbursement a fee may follow: a decision note 'disbursed' with the bank's evidence and an amount, never corrected */
async function disbursements(env: Env, caseId: number) {
  return (await env.DB.prepare(
    `SELECT n.id, n.bank, n.approved_cents, n.evidence_id, n.created_at,
            EXISTS (SELECT 1 FROM fa_notes x WHERE x.corrects_id = n.id) AS corrected
       FROM fa_notes n WHERE n.case_id = ?1 AND n.note_type = 'decision' AND n.status_value = 'disbursed' AND n.corrects_id IS NULL ORDER BY n.id DESC`,
  ).bind(caseId).all<{ id: number; bank: string | null; approved_cents: number | null; evidence_id: number | null; created_at: string; corrected: number }>()).results ?? [];
}
const usable = (d: { approved_cents: number | null; evidence_id: number | null; corrected: number }) => !!d.evidence_id && Number(d.approved_cents ?? 0) > 0 && !Number(d.corrected);

export async function handleFaTemplates(env: Env, path: string, method: string, b: Record<string, unknown>, user: StaffUser, ctx: Ctx): Promise<Response | null> {
  try {
    return await route(env, path, method, b, user, ctx);
  } catch (e) {
    if (skew(e)) return notReady();
    throw e;
  }
}

async function route(env: Env, path: string, method: string, b: Record<string, unknown>, user: StaffUser, ctx: Ctx): Promise<Response | null> {
  const drafter = can(user.role, "fa_templates"), publisher = can(user.role, "fa_templates_publish");

  /* ---- the library: everyone in Financial Advisory sees it (an approved version is what they use) ---- */
  if (path === "/fa/templates" && method === "GET") {
    const templates = (await env.DB.prepare(`SELECT t.*, ${PERSON("u")} AS created_by_name FROM fa_templates t LEFT JOIN users u ON u.id = t.created_by ORDER BY t.name, t.id`).all()).results ?? [];
    const versions = ((await env.DB.prepare(
      `SELECT v.id, v.template_id, v.version, v.format, v.source_name, v.source_sha256, v.body, v.fields_json, v.fee_bp, v.state, v.created_by, v.created_at,
              v.submitted_at, v.legal_basis, v.legal_reviewer, v.legal_firm, v.legal_reviewed_on, v.legal_reference, v.published_at, v.archived_at, v.archived_reason,
              ${PERSON("cu")} AS created_by_name, ${PERSON("su")} AS submitted_by_name, ${PERSON("pu")} AS published_by_name, ${PERSON("au")} AS archived_by_name
         FROM fa_template_versions v LEFT JOIN users cu ON cu.id = v.created_by LEFT JOIN users su ON su.id = v.submitted_by
         LEFT JOIN users pu ON pu.id = v.published_by LEFT JOIN users au ON au.id = v.archived_by ORDER BY v.template_id, v.version DESC`,
    ).all<Record<string, unknown>>()).results ?? []).map((v): Record<string, unknown> => ({ ...v, check: checkTemplate(String(v.body ?? ""), (v.fee_bp as number | null) ?? null) }));
    /* someone who only uses the library sees approved versions; drafts are for the drafters */
    const shown = drafter || publisher ? versions : versions.filter((v) => v.state === "approved");
    return json({ templates, versions: shown, fields: MERGE_FIELDS, me: user.id, owner: isExecutiveOwner(user), can: { draft: drafter, publish: publisher }, legal: ctx.legal });
  }

  if (path === "/fa/templates" && method === "POST") {
    if (!drafter) return err("forbidden", "Only management drafts agreement templates", 403);
    const name = str(b.name, 120) ? String(b.name).trim() : "";
    if (name.length < 3) return err("invalid_input", "Name the template.", 400);
    const issuer = b.issuer_code === "a2z" || b.issuer_code === "azoo" ? b.issuer_code : null;
    if (!issuer) return err("invalid_input", "Choose the company that issues it (a2z or azoo).", 400);
    const service = String(b.service_type ?? "");
    if (!(SERVICES as readonly string[]).includes(service)) return err("invalid_input", `service_type is one of ${SERVICES.join(", ")}`, 400);
    const row = await env.DB.prepare(`INSERT INTO fa_templates (name, issuer_code, service_type, created_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`).bind(name, issuer, service, user.id).first<{ id: number }>();
    await audit(env, user.id, "fa.template_add", "fa_templates", String(row?.id), { name, issuer, service });
    return json({ ok: true, id: row?.id }, 201);
  }

  /* ---- a new version: a DOCX (base64), typed text, or a copy of an earlier version ---- */
  const mV = path.match(/^\/fa\/templates\/(\d+)\/versions$/);
  if (mV && method === "POST") {
    if (!drafter) return err("forbidden", "Only management drafts agreement templates", 403);
    const t = await env.DB.prepare(`SELECT * FROM fa_templates WHERE id = ?1`).bind(Number(mV[1])).first<Template>();
    if (!t) return err("not_found", "Template not found", 404);
    const fee = feeBpOf(b.fee_bp);
    if (fee === "bad") return err("invalid_input", "The fee rate is in basis points: a whole number from 1 to 10000 (1500 = 15.00%), or empty.", 400);
    let format: "docx" | "text" = "text", body = "", sourceName: string | null = null, key: string | null = null, hash: string | null = null;
    if (typeof b.docx_base64 === "string") {
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(b.docx_base64), (ch) => ch.charCodeAt(0)); } catch { return err("invalid_input", "The file could not be read.", 400); }
      if (bytes.length > DOCX_MAX) return err("too_large", "A template file is at most 2 MB.", 413);
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return err("invalid_input", "That is not a Word (.docx) file. A PDF that is not a fillable form goes through typing the text instead.", 400);
      let text: string | null;
      try { text = await docxText(bytes); } catch { text = null; }
      if (!text) return err("invalid_input", "No text could be read from this Word file (word/document.xml).", 400);
      format = "docx"; body = text; hash = await sha256(bytes);
      sourceName = str(b.file_name, 160) ? String(b.file_name).trim() : "template.docx";
      key = `fa/templates/${t.id}/${Date.now()}-${hash.slice(0, 12)}.docx`;
      await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } });
    } else if (num(b.from_version_id)) {
      const from = await versionOf(env, num(b.from_version_id)!);
      if (!from || from.template_id !== t.id) return err("invalid_input", "That version is not of this template.", 400);
      format = from.format === "docx" ? "docx" : "text"; body = from.body; sourceName = from.source_name; key = from.source_r2_key; hash = from.source_sha256;
    } else {
      body = str(b.body, BODY_MAX) ? String(b.body).replace(/\r\n/g, "\n").trim() : "";
      if (body.length < 50) return err("invalid_input", "Type the agreement text (at least 50 characters), or upload the Word file.", 400);
    }
    if (body.length > BODY_MAX) return err("too_large", "The agreement text is too long.", 413);
    const next = Number((await env.DB.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS n FROM fa_template_versions WHERE template_id = ?1`).bind(t.id).first<{ n: number }>())?.n ?? 1);
    const feeFrom = fee ?? (num(b.from_version_id) ? (await versionOf(env, num(b.from_version_id)!))?.fee_bp ?? null : null);
    const row = await env.DB.prepare(`INSERT INTO fa_template_versions (template_id, version, format, source_name, source_r2_key, source_sha256, body, fields_json, fee_bp, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`)
      .bind(t.id, next, format, sourceName, key, hash, body, JSON.stringify(fieldsIn(body)), feeFrom, user.id).first<{ id: number }>();
    await audit(env, user.id, "fa.template_version_add", "fa_template_versions", String(row?.id), { template: t.id, version: next, format, sha256: hash, from: num(b.from_version_id), fee_bp: feeFrom });
    return json({ ok: true, id: row?.id, version: next, check: checkTemplate(body, feeFrom) }, 201);
  }

  const mOne = path.match(/^\/fa\/templates\/versions\/(\d+)(?:\/(submit|publish|archive|source))?$/);
  if (mOne) {
    const v = await versionOf(env, Number(mOne[1]));
    if (!v) return err("not_found", "Template version not found", 404);
    const sub = mOne[2] ?? "";

    if (sub === "source" && method === "GET") {
      if (!drafter && !publisher) return err("forbidden", "Only management opens a template's source file", 403);
      if (!v.source_r2_key) return err("not_found", "This version was typed - there is no uploaded file.", 404);
      const obj = await env.MEDIA.get(v.source_r2_key);
      if (!obj) return err("not_found", "The file is not in storage.", 404);
      return new Response(obj.body, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${(v.source_name ?? "template.docx").replace(/[^\w.\- ]/g, "_")}"`, "Cache-Control": "no-store" } });
    }

    /* edit a DRAFT only - past draft the text is locked (and the trigger says so too) */
    if (sub === "" && method === "PUT") {
      if (!drafter) return err("forbidden", "Only management drafts agreement templates", 403);
      if (v.state !== "draft") return err("invalid_state", "Only a draft is edited. Make a new version from this one instead.", 409);
      const body = b.body === undefined ? v.body : str(b.body, BODY_MAX) ? String(b.body).replace(/\r\n/g, "\n").trim() : "";
      if (body.length < 50) return err("invalid_input", "The agreement text is at least 50 characters.", 400);
      const fee = b.fee_bp === undefined ? v.fee_bp : feeBpOf(b.fee_bp);
      if (fee === "bad") return err("invalid_input", "The fee rate is in basis points: a whole number from 1 to 10000 (1500 = 15.00%), or empty.", 400);
      await env.DB.prepare(`UPDATE fa_template_versions SET body = ?1, fields_json = ?2, fee_bp = ?3 WHERE id = ?4 AND state = 'draft'`).bind(body, JSON.stringify(fieldsIn(body)), fee, v.id).run();
      await audit(env, user.id, "fa.template_version_edit", "fa_template_versions", String(v.id), { version: v.version, fee_bp: fee, text_changed: body !== v.body });
      return json({ ok: true, check: checkTemplate(body, fee) });
    }

    if (sub === "submit" && method === "POST") {
      if (!drafter) return err("forbidden", "Only management submits a template for review", 403);
      if (v.state !== "draft") return err("invalid_state", "Only a draft is submitted.", 409);
      const chk = checkTemplate(v.body, v.fee_bp);
      if (!chk.ok) return json({ error: { code: "template_check", message: "The template is not ready: fix what is listed, then submit again.", check: chk } }, 422);
      const r = await env.DB.prepare(`UPDATE fa_template_versions SET state = 'review', submitted_by = ?1, submitted_at = datetime('now') WHERE id = ?2 AND state = 'draft'`).bind(user.id, v.id).run();
      if (!Number(r.meta?.changes ?? 0)) return err("invalid_state", "This version was already submitted.", 409);
      await audit(env, user.id, "fa.template_submitted", "fa_template_versions", String(v.id), { template: v.template_id, version: v.version });
      for (const id of await publishers(env)) if (id !== user.id) await notify(env, id, "fa", `An agreement template version is waiting for publishing (v${v.version}).`, `fa_tpl_submit:${v.id}`, { once: true });
      return json({ ok: true });
    }

    if (sub === "publish" && method === "POST") {
      if (!publisher) return err("forbidden", "Only the CEO publishes an agreement template", 403);
      if (v.state !== "review") return err("invalid_state", "Only a version submitted for review is published.", 409);
      if (v.created_by === user.id && !isExecutiveOwner(user)) {
        await audit(env, user.id, "auth.self_approval_refused", "fa_template_versions", String(v.id), { action: "fa.template_publish" });
        return err("self_approval", "You drafted this version - it is published by someone else.", 403);
      }
      const chk = checkTemplate(v.body, v.fee_bp);
      if (!chk.ok) return json({ error: { code: "template_check", message: "The template no longer passes its check.", check: chk } }, 422);
      const basis = String(b.legal_basis ?? "");
      let reviewer: string | null = null, firm: string | null = null, day: string | null = null, ref: string | null = null;
      if (basis === "counsel_reviewed") {
        reviewer = str(b.legal_reviewer, 120) ? String(b.legal_reviewer).trim() : "";
        firm = str(b.legal_firm, 160) ? String(b.legal_firm).trim() : "";
        ref = str(b.legal_reference, 160) ? String(b.legal_reference).trim() : "";
        if (reviewer.length < 3 || firm.length < 3 || ref.length < 3) return err("invalid_input", "Record the reviewing lawyer, the firm and the letter or reference of their review.", 400);
        if (!validDay(b.legal_reviewed_on) || b.legal_reviewed_on > todayMyt()) return err("invalid_input", "The day of the legal review is today or earlier.", 400);
        day = b.legal_reviewed_on;
      } else if (basis === "ceo_without_review") {
        if (!isExecutiveOwner(user)) return err("forbidden", "Only the verified owner account publishes without a legal review.", 403);
        if (b.acknowledge !== true) return err("invalid_input", "Confirm that this version is published without a legal review.", 400);
      } else return err("invalid_input", "legal_basis is counsel_reviewed or ceo_without_review", 400);
      const r = await env.DB.prepare(`UPDATE fa_template_versions SET state = 'approved', legal_basis = ?1, legal_reviewer = ?2, legal_firm = ?3, legal_reviewed_on = ?4, legal_reference = ?5, published_by = ?6, published_at = datetime('now') WHERE id = ?7 AND state = 'review'`)
        .bind(basis, reviewer, firm, day, ref, user.id, v.id).run();
      if (!Number(r.meta?.changes ?? 0)) return err("invalid_state", "This version was already decided.", 409);
      const old = await env.DB.prepare(`UPDATE fa_template_versions SET state = 'archived', archived_by = ?1, archived_at = datetime('now'), archived_reason = ?2 WHERE template_id = ?3 AND state = 'approved' AND id != ?4`)
        .bind(user.id, `Superseded by version ${v.version}`, v.template_id, v.id).run();
      await audit(env, user.id, "fa.template_published", "fa_template_versions", String(v.id), { template: v.template_id, version: v.version, legal_basis: basis, fee_bp: v.fee_bp, superseded: Number(old.meta?.changes ?? 0) });
      if (v.created_by !== user.id) await notify(env, v.created_by, "fa", `Your agreement template version v${v.version} is published.`, `fa_tpl_pub:${v.id}`, { once: true });
      return json({ ok: true, superseded: Number(old.meta?.changes ?? 0) });
    }

    if (sub === "archive" && method === "POST") {
      if (v.state === "archived") return err("invalid_state", "Already archived.", 409);
      if (v.state === "approved" ? !publisher : !drafter) return err("forbidden", v.state === "approved" ? "Only the CEO archives a published version" : "Only management archives a template version", 403);
      const reason = str(b.reason, 300) ? String(b.reason).trim() : "";
      if (reason.length < 5) return err("invalid_input", "Give the reason (at least 5 characters).", 400);
      await env.DB.prepare(`UPDATE fa_template_versions SET state = 'archived', archived_by = ?1, archived_at = datetime('now'), archived_reason = ?2 WHERE id = ?3 AND state != 'archived'`).bind(user.id, reason, v.id).run();
      await audit(env, user.id, "fa.template_archived", "fa_template_versions", String(v.id), { template: v.template_id, version: v.version, from: v.state, reason });
      return json({ ok: true });
    }
    return null;
  }

  /* ---- the fees the viewer may prepare: disbursements recorded with evidence, in their scope ---- */
  if (path === "/fa/fees" && method === "GET") {
    const all = can(user.role, "fa_decide");
    const { results } = await env.DB.prepare(
      `SELECT n.id AS note_id, n.case_id, n.bank, n.approved_cents, n.evidence_id IS NOT NULL AS has_evidence, n.created_at AS recorded_at,
              EXISTS (SELECT 1 FROM fa_notes x WHERE x.corrects_id = n.id) AS corrected,
              c.case_ref, c.product, c.issuer_code, c.owner_id, cu.company AS client,
              f.id AS bill_id, f.fee_bp, f.base_cents, f.fee_cents, f.reference, f.created_at AS prepared_at, ${PERSON("fu")} AS prepared_by
         FROM fa_notes n JOIN fa_cases c ON c.id = n.case_id LEFT JOIN customers cu ON cu.id = c.customer_id
         LEFT JOIN fa_fee_bills f ON f.decision_note_id = n.id LEFT JOIN users fu ON fu.id = f.created_by
        WHERE n.note_type = 'decision' AND n.status_value = 'disbursed' AND n.corrects_id IS NULL
          ${all ? "" : "AND (c.owner_id = ?1 OR EXISTS (SELECT 1 FROM fa_case_members m WHERE m.case_id = c.id AND m.user_id = ?1))"}
        ORDER BY n.id DESC LIMIT 200`,
    ).bind(...(all ? [] : [user.id])).all<Record<string, unknown>>();
    return json({ fees: (results ?? []).map((r) => ({ ...r, billable: !!r.has_evidence && Number(r.approved_cents ?? 0) > 0 && !Number(r.corrected) })), fee_line: FEE_LINE, legal: ctx.legal });
  }

  /* ---- one case: the agreement draft, its history, the fee ---- */
  const mC = path.match(/^\/fa\/cases\/(\d+)\/(agreement|agreement\/preview|fee)$/);
  if (!mC) return null;
  const c = await ctx.caseOf(env, Number(mC[1]));
  if (!c || !(await ctx.mayOpen(env, user, c))) return err("not_found", "Case not found", 404);
  const sub = mC[2]!;

  if (sub === "agreement" && method === "GET") {
    const drafts = (await env.DB.prepare(
      `SELECT d.id, d.version_id, d.text_sha256, d.full_ic, d.created_at, v.version, t.name AS template, ${PERSON("u")} AS by_name
         FROM fa_agreement_drafts d JOIN fa_template_versions v ON v.id = d.version_id JOIN fa_templates t ON t.id = v.template_id LEFT JOIN users u ON u.id = d.created_by
        WHERE d.case_id = ?1 ORDER BY d.id DESC LIMIT 50`,
    ).bind(c.id).all()).results ?? [];
    const bills = (await env.DB.prepare(`SELECT id, decision_note_id, version_id, fee_bp, base_cents, fee_cents, reference, created_at FROM fa_fee_bills WHERE case_id = ?1 ORDER BY id DESC`).bind(c.id).all()).results ?? [];
    return json({ drafts, bills, disbursements: (await disbursements(env, c.id)).map((d) => ({ ...d, billable: usable(d) })), can: { edit: ctx.mayEdit(user, c) }, legal: ctx.legal });
  }

  if (sub === "agreement/preview" && method === "POST") {
    const v = num(b.version_id) ? await versionOf(env, num(b.version_id)!) : null;
    if (v?.state === "archived") return err("invalid_state", "That version is archived - choose the published one.", 409);
    if (!v || (v.state !== "approved" && !(drafter || publisher))) return err("invalid_input", "Choose a published template version.", 400);
    if (v.issuer_code !== c.issuer_code) return err("invalid_input", "That template is for the other company than this case.", 400);
    if (v.service_type !== c.product) return err("invalid_input", "That template is for another service than this case.", 400);
    const record = b.record === true;
    let fullIc: string | null = null;
    if (b.full_ic !== undefined && b.full_ic !== null && b.full_ic !== "") {
      if (!ctx.mayEdit(user, c)) return err("forbidden", "Only someone who may change this case types the full IC.", 403);
      const digits = String(b.full_ic).replace(/\D/g, "");
      if (!/^\d{12}$/.test(digits)) return err("invalid_input", "A MyKad number has 12 digits.", 400);
      const p = await env.DB.prepare(`SELECT ic_hash FROM fa_profiles WHERE case_id = ?1 AND ic_hash IS NOT NULL ORDER BY version DESC LIMIT 1`).bind(c.id).first<{ ic_hash: string }>();
      if (!p) return err("invalid_input", "Record the client's IC on the profile first - the typed IC is checked against it.", 400);
      if ((await ctx.icHash(env, digits)) !== p.ic_hash) return err("ic_mismatch", "That IC is not the one on the client's profile. Check it against the client's IC copy.", 400);
      fullIc = `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
    }
    const values = await valuesOf(env, c, v);
    const masked = mergeBlocks(v.body, values);
    const shown = fullIc ? mergeBlocks(v.body, { ...values, ic_number: fullIc }) : masked;
    const fields = fieldsIn(v.body).map((k) => ({ key: k, label: MERGE_FIELDS[k] ?? k, value: k === "ic_number" && fullIc ? fullIc : values[k] ?? null, masked: k === "ic_number" && !fullIc && !!values[k], missing: !values[k] }));
    const ready = v.state === "approved" && masked.missing.length === 0;
    let draftId: number | null = null, hash: string | null = null;
    if (record) {
      if (!ctx.mayEdit(user, c)) return err("forbidden", "Only someone who may change this case prepares its draft agreement.", 403);
      if (v.state !== "approved") return err("invalid_state", "A draft agreement is prepared only from a published version.", 409);
      if (masked.missing.length) return json({ error: { code: "fields_missing", message: "Some fields have no value - complete the records, then prepare the draft.", missing: masked.missing } }, 422);
      hash = await sha256(plain(masked.blocks)); // the hash of the text with the IC MASKED: a typed IC is never kept, not even as a hash
      const row = await env.DB.prepare(`INSERT INTO fa_agreement_drafts (case_id, version_id, text_sha256, full_ic, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`).bind(c.id, v.id, hash, fullIc ? 1 : 0, user.id).first<{ id: number }>();
      draftId = row?.id ?? null;
      await ctx.event(env, c.id, "agreement_draft", user.id, { version: v.id, draft: draftId });
      await audit(env, user.id, "fa.agreement_draft", "fa_agreement_drafts", String(draftId), { case: c.case_ref, version: v.id, template: v.template_id, full_ic_typed: !!fullIc, sha256: hash });
    }
    return json({
      blocks: shown.blocks, fields, missing: masked.missing, ready, draft: true, draft_id: draftId, sha256: hash,
      version: { id: v.id, version: v.version, name: v.name, state: v.state, fee_bp: v.fee_bp, issuer_code: v.issuer_code },
      company: { name: resolveIssuer(c.issuer_code).name, registration: resolveIssuer(c.issuer_code).registration },
      case_ref: c.case_ref, legal: ctx.legal,
    });
  }

  if (sub === "fee" && method === "POST") {
    if (!ctx.mayEdit(user, c)) return err("forbidden", "Only the case owner or management prepares the fee", 403);
    if (!ctx.legal.fee) return err("legal_gate", "The advisory fee is switched off.", 409);
    const list = await disbursements(env, c.id);
    const want = num(b.decision_note_id);
    const d = want ? list.find((x) => x.id === want) : list.find(usable);
    if (!d || !usable(d)) {
      return err("fee_after_disbursement", d && Number(d.corrected)
        ? "That disbursement record was corrected - management records the disbursement again with the bank's evidence and the amount. Nothing was billed."
        : "The advisory fee is billed only after a disbursement is recorded with the bank's evidence and the disbursed amount, through a Sales quotation and invoice. Nothing was billed.", 409);
    }
    const prior = await env.DB.prepare(`SELECT * FROM fa_fee_bills WHERE decision_note_id = ?1`).bind(d.id).first<{ id: number; version_id: number; fee_bp: number; base_cents: number; fee_cents: number; reference: string; created_at: string }>();
    let bill = prior;
    let v = prior ? await versionOf(env, prior.version_id) : null;
    if (!prior) {
      v = num(b.version_id) ? await versionOf(env, num(b.version_id)!) : null;
      if (!v || v.state !== "approved") return err("invalid_input", "Choose the published agreement template version - its fee rate is the one billed.", 400);
      if (v.issuer_code !== c.issuer_code || v.service_type !== c.product) return err("invalid_input", "That template is for another company or service than this case.", 400);
      if (!v.fee_bp) return err("invalid_input", "That published version sets no fee rate - the CEO sets it on a new version.", 400);
      const comm = await earnsNothing(env, FEE_LINE, todayMyt());
      if (!comm.ok) {
        return json({ error: { code: "commission_rule_missing", message: `Commission on the advisory fee stays off. Add a package rule of "none" for "${FEE_LINE}" to the commission policy${comm.missing.length ? ` (version ${comm.missing.join(", ")})` : ""}, then prepare the fee again. Nothing was billed.`, line: FEE_LINE, missing: comm.missing } }, 409);
      }
      const base = Number(d.approved_cents);
      const fee = feeOf(base, v.fee_bp);
      if (fee <= 0) return err("invalid_input", "The fee works out at RM 0.00 - nothing to bill.", 400);
      const reference = `FA-FEE ${c.case_ref}`;
      try {
        await env.DB.prepare(`INSERT INTO fa_fee_bills (case_id, decision_note_id, version_id, fee_bp, base_cents, fee_cents, reference, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
          .bind(c.id, d.id, v.id, v.fee_bp, base, fee, reference, user.id).run();
      } catch (e) { if (!/UNIQUE/i.test(String(e))) throw e; }
      bill = await env.DB.prepare(`SELECT * FROM fa_fee_bills WHERE decision_note_id = ?1`).bind(d.id).first();
      await env.DB.prepare(`UPDATE fa_cases SET stage = 'fee', updated_at = datetime('now') WHERE id = ?1 AND stage = 'disbursed'`).bind(c.id).run();
      await ctx.event(env, c.id, "fee_prepared", user.id, { note: d.id, version: v.id });
      await audit(env, user.id, "fa.fee_prepared", "fa_fee_bills", String(bill?.id), { case: c.case_ref, note: d.id, version: v.id, fee_bp: v.fee_bp, base_cents: base, fee_cents: fee });
    }
    if (!bill || !v) return err("invalid_state", "The fee could not be prepared.", 409);
    const cu = await env.DB.prepare(`SELECT company, contact_person, phone, email FROM customers WHERE id = ?1`).bind(c.customer_id).first<{ company: string; contact_person: string | null; phone: string | null; email: string | null }>();
    return json({
      ok: true, again: !!prior, bill,
      prefill: {
        source: "fa_fee", company: cu?.company ?? "", contact_person: cu?.contact_person ?? "", phone: cu?.phone ?? "", email: cu?.email ?? "",
        reference: bill.reference, doc_type: "QT", issuer: c.issuer_code, salesperson_id: c.owner_id,
        items: [{ name: FEE_LINE, qty: 1, unit_price_cents: bill.fee_cents, sub: [
          `Case ${c.case_ref} - ${d.bank ?? "bank"} disbursement of ${rm(bill.base_cents)} recorded ${dmy(d.created_at.slice(0, 10))}`,
          `${pct(bill.fee_bp)} per agreement template ${v.name} v${v.version}`,
        ] }],
      },
    }, prior ? 200 : 201);
  }
  return null;
}

async function publishers(env: Env): Promise<number[]> {
  const roles = rolesFor("fa_templates_publish") as readonly string[];
  return ((await env.DB.prepare(`SELECT id, role FROM users WHERE is_active = 1`).all<{ id: number; role: string }>()).results ?? []).filter((u) => roles.includes(u.role)).map((u) => u.id);
}

/** every merge value, from the records only - a missing record is a missing value, never a guess */
async function valuesOf(env: Env, c: CaseRow, v: { fee_bp: number | null }): Promise<Record<string, string | null>> {
  const cu = await env.DB.prepare(`SELECT company, phone, email, address FROM customers WHERE id = ?1`).bind(c.customer_id).first<{ company: string | null; phone: string | null; email: string | null; address: string | null }>();
  const p = await env.DB.prepare(`SELECT ic_masked FROM fa_profiles WHERE case_id = ?1 ORDER BY version DESC LIMIT 1`).bind(c.id).first<{ ic_masked: string | null }>();
  const issuer = resolveIssuer(c.issuer_code);
  const d = (await disbursements(env, c.id)).find(usable);
  const t = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  return {
    client_name: t(cu?.company), ic_number: t(p?.ic_masked), client_phone: t(cu?.phone), client_email: t(cu?.email), client_address: t(cu?.address),
    case_ref: t(c.case_ref), service_type: SERVICE_WORD[c.product] ?? null,
    company_name: issuer.name, company_registration: issuer.registration, company_address: issuer.address,
    agreement_date: dmy(todayMyt()), fee_rate: v.fee_bp ? pct(v.fee_bp) : null,
    bank_name: t(d?.bank), disbursed_amount: d ? rm(Number(d.approved_cents)) : null,
    fee_amount: d && v.fee_bp ? rm(feeOf(Number(d.approved_cents), v.fee_bp)) : null,
  };
}
