/**
 * SALES PACKAGES — v1.231.0.
 *
 * The owner, 30-10-2026 (claude/SALES-PACKAGES-AUDIT.md): "ONE PACKAGES
 * LIBRARY. ONE EXISTING QUOTATION ENGINE. SELECT PACKAGE → AUTO-FILL
 * QUOTATION → CUSTOMIZE IF NEEDED → SAVE → PRINT." Answers: managers CEO,
 * COO, CCO and super admin; service lines only; prices editable on the
 * quotation and flagged customized; "Build it".
 *
 * WHAT A PACKAGE IS: a named list of quotation lines - the SAME shape a
 * document stores in sales_documents.items (name, qty, unit_price_cents,
 * uom, disc_cents, sub) - with an optional discount, the issuers it may be
 * quoted under, and a status. Applying one copies its lines into the
 * existing Create form; the quotation keeps its own copy, so nothing here is
 * ever read when a saved document prints, converts or pays.
 *
 * VERSIONS ARE NEVER EDITED. Saving different lines, prices or discount
 * writes version N+1 (UNIQUE package_id + version, and the pointer moves
 * only if it still points at N - two managers saving at once cannot both
 * win). A quotation records the package and version it came from.
 *
 * NOT HERE: no commission rate, no pricing formula of its own beyond the
 * document's line arithmetic (qty x unit - line discount), no tax (a
 * document field), no numbering, no customer, no company record - the
 * issuers are the two codes of lib/issuers.ts.
 */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { can } from "./permissions";
import { audit, err, json, str } from "./shared";

export const PACKAGE_ISSUERS = ["a2z", "azoo"] as const;
export const PACKAGE_STATUSES = ["draft", "active", "archived"] as const;
const MAX_LINES = 60;
const MAX_CENTS = 1_000_000_000; // RM 10 million, the cents() ceiling in shared.ts

export interface PkgLine { name: string; qty: number; unit_price_cents: number; uom?: string; disc_cents?: number; sub?: string[] }

/** A service line exactly as POST /docs keeps it (staff.ts lineExtras):
    name to 200, qty > 0, unit >= 0 in cents, UOM to 12 upper case, the line
    discount capped at the line, up to 10 inclusions of 160. A service line
    carries no SKU. Lines that fail are dropped, as the document route does. */
export function normalizeLines(raw: unknown): PkgLine[] {
  if (!Array.isArray(raw)) return [];
  const out: PkgLine[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || !str(r.name, 200) || typeof r.qty !== "number" || !(r.qty > 0) || typeof r.unit_price_cents !== "number" || r.unit_price_cents < 0) continue;
    const qty = r.qty;
    const unit = Math.round(r.unit_price_cents);
    if (unit > MAX_CENTS || qty > 1_000_000) continue;
    const l: PkgLine = { name: String(r.name).trim(), qty, unit_price_cents: unit };
    if (str(r.uom, 12)) l.uom = String(r.uom).slice(0, 12).toUpperCase();
    if (typeof r.disc_cents === "number" && r.disc_cents > 0) l.disc_cents = Math.min(Math.round(r.disc_cents), Math.round(qty * unit));
    if (Array.isArray(r.sub)) {
      const s = (r.sub as unknown[]).filter((x) => str(x, 160)).slice(0, 10).map((x) => String(x).slice(0, 160));
      if (s.length) l.sub = s;
    }
    out.push(l);
  }
  return out;
}

/** The document's own line arithmetic (staff.ts POST /docs): qty x unit -
    line discount, summed. Integer cents. */
export const linesSubtotal = (lines: PkgLine[]): number =>
  lines.reduce((s, l) => s + Math.round(l.qty * l.unit_price_cents) - Math.min(l.disc_cents ?? 0, Math.round(l.qty * l.unit_price_cents)), 0);

/** One comparable form of a line, for "is this quotation still the package?" */
const lineKey = (l: PkgLine) => JSON.stringify([l.name.trim(), l.qty, l.unit_price_cents, l.uom ?? "", l.disc_cents ?? 0, l.sub ?? []]);

/** Whether a document's lines and discount differ from a package version. */
export function isCustomized(docLines: unknown, docDiscount: number, version: { items: string; discount_cents: number }): boolean {
  let v: PkgLine[] = [];
  try { v = normalizeLines(JSON.parse(version.items)); } catch { return true; }
  const d = normalizeLines(docLines);
  if (d.length !== v.length) return true;
  if ((docDiscount || 0) !== (version.discount_cents || 0)) return true;
  return d.some((l, i) => lineKey(l) !== lineKey(v[i]!));
}

const issuersOf = (v: unknown): string[] | null => {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : null;
  if (!list) return null;
  const clean = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
  if (clean.length === 0 || clean.some((x) => !(PACKAGE_ISSUERS as readonly string[]).includes(x))) return null;
  return PACKAGE_ISSUERS.filter((x) => clean.includes(x));
};

type PkgRow = { id: number; name: string; category: string | null; description: string | null; notes: string | null; kind: string; issuers: string; status: string; current_version: number; created_at: string; updated_at: string };
type VerRow = { id: number; package_id: number; version: number; items: string; discount_cents: number; subtotal_cents: number; total_cents: number; created_at: string };

/** The package and version a document may be made from, for POST /docs and
    /docs/:id/edit. `keepId` = the package the document already carries (an
    edit may keep an archived package; a NEW reference must be active).
    Returns null when no package is asked for. */
export async function packageForDoc(
  env: Env,
  body: Record<string, unknown> | null,
  ctx: { docType: string; kind: string; issuer: string; items: unknown; discount_cents: number; keepId?: number | null },
): Promise<{ id: number; version: number; customized: boolean } | Response | null> {
  const pid = body?.package_id;
  if (pid === undefined || pid === null) return null;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return err("invalid_input", "package_id must be a package number", 400);
  if (ctx.docType !== "QT") return err("invalid_input", "A package is applied to a quotation only", 400);
  if (ctx.kind !== "service") return err("invalid_input", "A package carries service lines - choose Service for this quotation", 400);
  let pkg: PkgRow | null;
  try {
    pkg = await env.DB.prepare(`SELECT * FROM sales_packages WHERE id = ?1`).bind(pid).first<PkgRow>();
  } catch { return err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0153_sales_packages)", 500); }
  if (!pkg) return err("not_found", "That package does not exist", 404);
  /* a NEW link must be to an active package offered under this issuer; the
     link a quotation already carries is history and stays, whatever the
     package has become since (archived, offered elsewhere) */
  if (pkg.id !== ctx.keepId) {
    if (pkg.status !== "active") return err("package_unavailable", `${pkg.name} is ${pkg.status} - choose an active package, or continue without one`, 400);
    if (!pkg.issuers.split(",").includes(ctx.issuer)) return err("package_issuer", `${pkg.name} is not offered under this issuing company`, 400);
  }
  const pv = body?.package_version;
  const vNo = typeof pv === "number" && Number.isInteger(pv) && pv > 0 ? pv : pkg.current_version;
  const ver = await env.DB.prepare(`SELECT items, discount_cents FROM sales_package_versions WHERE package_id = ?1 AND version = ?2`).bind(pkg.id, vNo).first<{ items: string; discount_cents: number }>();
  if (!ver) return err("not_found", `${pkg.name} has no version ${vNo}`, 404);
  return { id: pkg.id, version: vNo, customized: isCustomized(ctx.items, ctx.discount_cents, ver) };
}

/** The package link written on a document after its row exists. Never
    fatal: a pre-0153 database keeps the quotation and loses only the link. */
export async function stampPackage(env: Env, docId: number | null | undefined, p: { id: number; version: number; customized: boolean } | null): Promise<void> {
  if (!docId) return;
  try {
    await env.DB.prepare(`UPDATE sales_documents SET package_id = ?1, package_version = ?2, package_customized = ?3 WHERE id = ?4`)
      .bind(p?.id ?? null, p?.version ?? null, p ? (p.customized ? 1 : 0) : null, docId).run();
  } catch { /* pre-0153: the document is saved; the package link is not */ }
}

export async function handlePackages(
  env: Env, path: string, method: string, body: Record<string, unknown> | null, user: StaffUser, params: URLSearchParams,
): Promise<Response | null> {
  if (path !== "/packages" && !path.startsWith("/packages/")) return null;
  if (!can(user.role, "sales")) return err("forbidden", "Sales access required", 403);
  const manage = can(user.role, "packages_manage");
  const skew = (e: unknown) => e instanceof Error && /no such (table|column)/.test(e.message);
  const migrationMissing = () => err("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0153_sales_packages)", 500);

  /* the library: managers see every status, everybody else the active ones */
  if (path === "/packages" && method === "GET") {
    try {
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.name, p.category, p.description, p.kind, p.issuers, p.status, p.current_version, p.updated_at,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS updated_by_name,
                v.items, v.discount_cents, v.subtotal_cents, v.total_cents,
                (SELECT COUNT(*) FROM sales_documents d WHERE d.package_id = p.id) AS used_by
           FROM sales_packages p
           LEFT JOIN sales_package_versions v ON v.package_id = p.id AND v.version = p.current_version
           LEFT JOIN users u ON u.id = p.updated_by
          ${manage ? "" : "WHERE p.status = 'active'"}
          ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, p.name COLLATE NOCASE`,
      ).all<Record<string, unknown>>();
      const issuer = params.get("issuer");
      const rows = (results ?? [])
        .filter((r) => !issuer || String(r.issuers).split(",").includes(issuer))
        .map((r) => {
          let items: PkgLine[] = [];
          try { items = normalizeLines(JSON.parse(String(r.items ?? "[]"))); } catch { items = []; }
          return { ...r, issuers: String(r.issuers).split(","), items, item_count: items.length };
        });
      return json({ packages: rows, can_manage: manage });
    } catch (e) {
      if (skew(e)) return json({ packages: [], can_manage: manage, pending_migration: true });
      throw e;
    }
  }

  const one = path.match(/^\/packages\/(\d+)$/);
  if (one && method === "GET") {
    try {
      const p = await env.DB.prepare(`SELECT * FROM sales_packages WHERE id = ?1`).bind(Number(one[1])).first<PkgRow>();
      /* a salesperson may read the version a quotation was made from even
         once the package is archived (?version=); the library itself shows
         them active packages only */
      const want = Number(params.get("version") ?? 0);
      if (!p || (!manage && p.status !== "active" && !want)) return err("not_found", "Package not found", 404);
      const { results: vers } = await env.DB.prepare(
        `SELECT v.version, v.items, v.discount_cents, v.subtotal_cents, v.total_cents, v.created_at,
                COALESCE(NULLIF(TRIM(u.full_name), ''), u.name) AS created_by_name
           FROM sales_package_versions v LEFT JOIN users u ON u.id = v.created_by
          WHERE v.package_id = ?1 ORDER BY v.version DESC`,
      ).bind(p.id).all<VerRow & { created_by_name: string | null }>();
      const list = (vers ?? []).map((v) => { let items: PkgLine[] = []; try { items = normalizeLines(JSON.parse(v.items)); } catch { items = []; } return { ...v, items }; });
      const pick = list.find((v) => v.version === (want || p.current_version)) ?? null;
      if (want && !pick) return err("not_found", `Version ${want} not found`, 404);
      const used = await env.DB.prepare(`SELECT COUNT(*) AS c FROM sales_documents WHERE package_id = ?1`).bind(p.id).first<{ c: number }>();
      return json({
        package: { ...p, issuers: p.issuers.split(",") },
        version: pick,
        versions: manage ? list.map(({ items: _i, ...v }) => ({ ...v, item_count: _i.length })) : [],
        used_by: used?.c ?? 0, can_manage: manage,
      });
    } catch (e) { if (skew(e)) return migrationMissing(); throw e; }
  }

  /* ---- writes: CEO, COO, CCO, super admin ---- */
  if (method !== "GET" && !manage) return err("forbidden", "Only the CEO, COO, CCO or super admin manage packages", 403);

  const identity = (b: Record<string, unknown> | null, cur?: PkgRow) => {
    const name = b?.name !== undefined ? (str(b.name, 120) ? String(b.name).trim() : null) : cur?.name ?? null;
    if (!name) return { error: "Name the package (up to 120 characters)" } as const;
    const text = (k: string, max: number, curV: string | null | undefined) =>
      b && k in b ? (b[k] === null || b[k] === "" ? null : str(b[k], max) ? String(b[k]).trim() : undefined) : (curV ?? null);
    const category = text("category", 60, cur?.category);
    const description = text("description", 1000, cur?.description);
    const notes = text("notes", 1000, cur?.notes);
    if (category === undefined || description === undefined || notes === undefined) return { error: "Category is up to 60 characters; description and notes up to 1000" } as const;
    const issuers = b?.issuers !== undefined ? issuersOf(b.issuers) : cur ? cur.issuers.split(",") : null;
    if (!issuers) return { error: "Choose the issuing companies it may be quoted under (A2Z CREATIVE MARKETING, AZ ONE OFFICIAL)" } as const;
    const status = b?.status !== undefined ? String(b.status) : cur?.status ?? "draft";
    if (!(PACKAGE_STATUSES as readonly string[]).includes(status)) return { error: "Status is draft, active or archived" } as const;
    return { name, category, description, notes, issuers: issuers.join(","), status } as const;
  };
  const linesOf = (b: Record<string, unknown> | null) => {
    const items = normalizeLines(b?.items);
    if (items.length === 0) return { error: "Add at least one service line - a name, a quantity above 0 and a price" } as const;
    if (items.length > MAX_LINES) return { error: `A package holds up to ${MAX_LINES} lines` } as const;
    if (Array.isArray(b?.items) && items.length !== (b!.items as unknown[]).length) return { error: "Every line needs a name, a quantity above 0 and a price of 0 or more" } as const;
    const subtotal = linesSubtotal(items);
    const d = b?.discount_cents;
    const discount = d === undefined || d === null ? 0 : typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= subtotal ? d : -1;
    if (discount < 0) return { error: "The discount is in sen, from 0 up to the subtotal" } as const;
    return { items, subtotal, discount, total: subtotal - discount } as const;
  };

  if (path === "/packages" && method === "POST") {
    const idn = identity(body);
    if ("error" in idn) return err("invalid_input", idn.error!, 400);
    const ln = linesOf(body);
    if ("error" in ln) return err("invalid_input", ln.error!, 400);
    if (idn.status === "archived") return err("invalid_input", "A new package is a draft or active", 400);
    try {
      const row = await env.DB.prepare(
        `INSERT INTO sales_packages (name, category, description, notes, kind, issuers, status, current_version, created_by, updated_by)
         VALUES (?1, ?2, ?3, ?4, 'service', ?5, ?6, 1, ?7, ?7) RETURNING id`,
      ).bind(idn.name, idn.category, idn.description, idn.notes, idn.issuers, idn.status, user.id).first<{ id: number }>();
      if (!row) return err("server_error", "The package was not saved", 500);
      await env.DB.prepare(
        `INSERT INTO sales_package_versions (package_id, version, items, discount_cents, subtotal_cents, total_cents, created_by) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(row.id, JSON.stringify(ln.items), ln.discount, ln.subtotal, ln.total, user.id).run();
      await audit(env, user.id, "package.create", "sales_packages", String(row.id), { name: idn.name, status: idn.status, issuers: idn.issuers, version: 1, total_cents: ln.total, lines: ln.items.length });
      return json({ ok: true, id: row.id, version: 1 }, 201);
    } catch (e) { if (skew(e)) return migrationMissing(); throw e; }
  }

  if (one && method === "PUT") {
    try {
      const cur = await env.DB.prepare(`SELECT * FROM sales_packages WHERE id = ?1`).bind(Number(one[1])).first<PkgRow>();
      if (!cur) return err("not_found", "Package not found", 404);
      const idn = identity(body, cur);
      if ("error" in idn) return err("invalid_input", idn.error!, 400);
      const ver = await env.DB.prepare(`SELECT * FROM sales_package_versions WHERE package_id = ?1 AND version = ?2`).bind(cur.id, cur.current_version).first<VerRow>();
      /* the lines change only when the request sends them; different lines,
         prices or discount write the next version - never an edit of this one */
      let next: number | null = null;
      let ln: { items: PkgLine[]; subtotal: number; discount: number; total: number } | null = null;
      if (body && ("items" in body || "discount_cents" in body)) {
        const l = linesOf({ items: "items" in body ? body.items : JSON.parse(ver?.items ?? "[]"), discount_cents: "discount_cents" in body ? body.discount_cents : ver?.discount_cents ?? 0 });
        if ("error" in l) return err("invalid_input", l.error!, 400);
        ln = l;
        const same = ver && JSON.stringify(normalizeLines(JSON.parse(ver.items))) === JSON.stringify(l.items) && (ver.discount_cents ?? 0) === l.discount;
        if (!same) next = cur.current_version + 1;
      }
      if (next !== null && ln) {
        /* one version per number (UNIQUE), and the pointer moves only from
           the version this manager was looking at */
        const base = typeof body?.base_version === "number" ? body.base_version : cur.current_version;
        if (base !== cur.current_version) return err("stale", `Someone saved version ${cur.current_version} while you were editing - reopen the package and make the change again`, 409);
        try {
          await env.DB.prepare(
            `INSERT INTO sales_package_versions (package_id, version, items, discount_cents, subtotal_cents, total_cents, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          ).bind(cur.id, next, JSON.stringify(ln.items), ln.discount, ln.subtotal, ln.total, user.id).run();
        } catch (e) {
          if (e instanceof Error && /UNIQUE/i.test(e.message)) return err("stale", "Someone saved this package a moment ago - reopen it and make the change again", 409);
          throw e;
        }
      }
      const upd = await env.DB.prepare(
        `UPDATE sales_packages SET name = ?1, category = ?2, description = ?3, notes = ?4, issuers = ?5, status = ?6,
                current_version = ?7, updated_by = ?8, updated_at = datetime('now')
          WHERE id = ?9 AND current_version = ?10`,
      ).bind(idn.name, idn.category, idn.description, idn.notes, idn.issuers, idn.status, next ?? cur.current_version, user.id, cur.id, cur.current_version).run();
      if (!(upd.meta?.changes ?? 0)) return err("stale", "Someone saved this package a moment ago - reopen it and make the change again", 409);
      const changed = (["name", "category", "description", "notes", "issuers", "status"] as const).filter((k) => String(cur[k] ?? "") !== String(idn[k] ?? ""));
      await audit(env, user.id, next ? "package.version" : "package.update", "sales_packages", String(cur.id), {
        name: idn.name, changed, ...(next ? { from_version: cur.current_version, version: next, total_before_cents: ver?.total_cents ?? null, total_cents: ln?.total ?? null } : {}),
      });
      return json({ ok: true, id: cur.id, version: next ?? cur.current_version, new_version: next !== null });
    } catch (e) { if (skew(e)) return migrationMissing(); throw e; }
  }

  const st = path.match(/^\/packages\/(\d+)\/status$/);
  if (st && method === "POST") {
    const to = String(body?.status ?? "");
    if (!(PACKAGE_STATUSES as readonly string[]).includes(to)) return err("invalid_input", "Status is draft, active or archived", 400);
    try {
      const cur = await env.DB.prepare(`SELECT id, name, status FROM sales_packages WHERE id = ?1`).bind(Number(st[1])).first<{ id: number; name: string; status: string }>();
      if (!cur) return err("not_found", "Package not found", 404);
      if (cur.status === to) return json({ ok: true, status: to });
      await env.DB.prepare(`UPDATE sales_packages SET status = ?1, updated_by = ?2, updated_at = datetime('now') WHERE id = ?3`).bind(to, user.id, cur.id).run();
      await audit(env, user.id, "package.status", "sales_packages", String(cur.id), { name: cur.name, from: cur.status, to });
      return json({ ok: true, status: to });
    } catch (e) { if (skew(e)) return migrationMissing(); throw e; }
  }

  /* delete: a package no document was made from. Anything a quotation
     names is archived instead - its history must stay answerable. */
  if (one && method === "DELETE") {
    try {
      const cur = await env.DB.prepare(`SELECT id, name FROM sales_packages WHERE id = ?1`).bind(Number(one[1])).first<{ id: number; name: string }>();
      if (!cur) return err("not_found", "Package not found", 404);
      const used = await env.DB.prepare(`SELECT COUNT(*) AS c FROM sales_documents WHERE package_id = ?1`).bind(cur.id).first<{ c: number }>();
      if ((used?.c ?? 0) > 0) return err("package_in_use", `${cur.name} is on ${used!.c} document(s) - archive it instead, so those documents can still name it`, 409);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM sales_package_versions WHERE package_id = ?1 AND NOT EXISTS (SELECT 1 FROM sales_documents WHERE package_id = ?1)`).bind(cur.id),
        env.DB.prepare(`DELETE FROM sales_packages WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM sales_documents WHERE package_id = ?1)`).bind(cur.id),
      ]);
      await audit(env, user.id, "package.delete", "sales_packages", String(cur.id), { name: cur.name });
      return json({ ok: true });
    } catch (e) { if (skew(e)) return migrationMissing(); throw e; }
  }

  return err("not_found", "Unknown package route", 404);
}
