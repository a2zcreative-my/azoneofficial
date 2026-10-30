"use client";

/* SALES PACKAGES — v1.231.0 (the owner, 30-10-2026; claude/SALES-PACKAGES-AUDIT.md).
 *
 * Two pieces, both reading worker/src/packages.ts:
 *   PackagesPanel  the Documents tab's Packages pill: the library (search,
 *                  issuer, status, category) and, for the CEO, COO, CCO and
 *                  super admin, the editor in a drawer.
 *   PackagePicker  the Create form's "Package (optional)" field: the active
 *                  packages offered under the issuer chosen in the form. It
 *                  hands the lines to the form; the form owns them.
 *
 * A package line is a quotation line (DocItem) and its figures come from
 * lib/doc-totals.ts - the arithmetic the form and the paper use. Nothing
 * here prices, numbers, saves or prints a document. */
import { useMemo, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { L } from "@/components/portal/page-shared";
import { api } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import type { DocItem } from "@/lib/doc-template";
import { docSubtotal, lineAmount } from "@/lib/doc-totals";
import { dmy, rm } from "@/lib/format";
import { resolveIssuer } from "@/lib/issuers";
import { PACKAGE_MANAGE_ROLES, type PackageRef, type PackageRow, type PackageStatus } from "@/lib/packages";
import { btnSm, btnSmPrimary, card, chipInfo, chipNeutral, chipSuccess, chipWarn, inputClass, selectClassSm, textareaClass } from "@/lib/ui-styles";
import css from "./packages.module.css";

const ISSUERS = [["a2z", resolveIssuer("a2z").name], ["azoo", resolveIssuer("azoo").name]] as const;
const statusChip = (s: PackageStatus) => (s === "active" ? chipSuccess : s === "draft" ? chipWarn : chipNeutral);
const statusLabel = (s: PackageStatus) => (s === "active" ? L("Active", "Aktif") : s === "draft" ? L("Draft", "Draf") : L("Archived", "Diarkibkan"));
const toCents = (v: string) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0; };
const MAX_SUB = 10; // the worker keeps up to 10 inclusions a line

/* ================================ library ================================ */

export function PackagesPanel({ role }: { role: string }) {
  const list = useCachedApi<{ packages?: PackageRow[]; can_manage?: boolean; pending_migration?: boolean }>("/staff/packages", true, []);
  const canManage = list.data?.can_manage ?? PACKAGE_MANAGE_ROLES.includes(role);
  const rows = useMemo(() => list.data?.packages ?? [], [list.data]);
  const [q, setQ] = useState("");
  const [issuer, setIssuer] = useState("");
  const [status, setStatus] = useState<"" | PackageStatus>("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<PackageRow | "new" | null>(null);
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const categories = [...new Set(rows.map((r) => (r.category ?? "").trim()).filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!issuer || r.issuers.includes(issuer as "a2z"))
    && (!status || r.status === status) && (!cat || (r.category ?? "") === cat)
    && (!needle || [r.name, r.category, r.description, ...r.items.map((i) => i.name)].some((x) => (x ?? "").toLowerCase().includes(needle))));

  const setStatusOf = async (p: PackageRow, to: PackageStatus) => {
    const r = await api<{ error?: { message?: string } }>(`/staff/packages/${p.id}/status`, { method: "POST", body: JSON.stringify({ status: to }) });
    if (!r.ok) { toast(L("Not changed", "Tidak diubah"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice"); return; }
    toast(L("Saved", "Disimpan"), to === "archived" ? L(`${p.name} archived - quotations already made from it are unchanged`, `${p.name} diarkibkan - sebut harga sedia ada tidak berubah`) : L(`${p.name} is ${to}`, `${p.name} kini ${statusLabel(to).toLowerCase()}`));
    list.refresh();
  };
  const remove = async (p: PackageRow) => {
    if (!(await confirm({ title: L(`Delete ${p.name}?`, `Padam ${p.name}?`), message: L("No document was made from it, so it can be deleted. This cannot be undone.", "Tiada dokumen dibuat daripadanya, jadi ia boleh dipadam. Tindakan ini tidak boleh dibatalkan."), confirmLabel: L("Delete", "Padam"), variant: "danger" }))) return;
    const r = await api<{ error?: { message?: string } }>(`/staff/packages/${p.id}`, { method: "DELETE" });
    if (!r.ok) { toast(L("Not deleted", "Tidak dipadam"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "notice"); return; }
    toast(L("Deleted", "Dipadam"), p.name);
    list.refresh();
  };

  return (
    <section className={`${card} ${css.panel}`} aria-label={L("Packages library", "Pustaka pakej")}>
      {toastNode}{confirmNode}
      <div className={css.head}>
        <span className={css.headIcon} aria-hidden><AppIcon name="package" /></span>
        <div className={css.headText}>
          <h3 className={css.title}>{L("Packages", "Pakej")}</h3>
          <p className="erp-meta">{L("Ready-made service packages for quotations. Choosing one fills the quotation's lines; the quotation keeps its own copy. Not the public website rate card.", "Pakej perkhidmatan sedia untuk sebut harga. Memilih satu mengisi baris sebut harga; sebut harga menyimpan salinannya sendiri. Bukan kad harga laman web awam.")}</p>
        </div>
        {canManage && <button type="button" className={btnSmPrimary} onClick={() => setEditing("new")}><AppIcon name="add" />{L("Create package", "Cipta pakej")}</button>}
      </div>

      <div className={css.filters}>
        <label className={css.search}>
          <AppIcon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search package name, description or items", "Cari nama pakej, keterangan atau item")} aria-label={L("Search packages", "Cari pakej")} />
        </label>
        <select className={selectClassSm} value={issuer} onChange={(e) => setIssuer(e.target.value)} aria-label={L("Issuing company", "Syarikat pengeluar")}>
          <option value="">{L("All issuers", "Semua pengeluar")}</option>
          {ISSUERS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        {canManage && (
          <select className={selectClassSm} value={status} onChange={(e) => setStatus(e.target.value as "" | PackageStatus)} aria-label={L("Status", "Status")}>
            <option value="">{L("All statuses", "Semua status")}</option>
            {(["active", "draft", "archived"] as const).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        )}
        {categories.length > 0 && (
          <select className={selectClassSm} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={L("Category", "Kategori")}>
            <option value="">{L("All categories", "Semua kategori")}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {(q || issuer || status || cat) && <button type="button" className={btnSm} onClick={() => { setQ(""); setIssuer(""); setStatus(""); setCat(""); }}>{L("Reset", "Set semula")}</button>}
      </div>

      {list.loading ? <SkelRows rows={4} /> : list.data?.pending_migration ? (
        <p className="erp-note erp-note-warning">{L("Packages need migration 0153 on the database. Run the pending migrations, then refresh.", "Pakej memerlukan migrasi 0153 pada pangkalan data. Jalankan migrasi tertunda, kemudian muat semula.")}</p>
      ) : shown.length === 0 ? (
        <p className={css.empty}><AppIcon name="document" />{rows.length === 0
          ? (canManage ? L("No packages yet. Create one, and it can be chosen on any quotation for its issuer.", "Belum ada pakej. Cipta satu, dan ia boleh dipilih pada mana-mana sebut harga untuk pengeluarnya.") : L("No active packages yet - quotations are written line by line as before.", "Belum ada pakej aktif - sebut harga ditulis baris demi baris seperti biasa."))
          : L("No package matches these filters.", "Tiada pakej sepadan dengan penapis ini.")}</p>
      ) : (
        <div className={`erp-table-scroll ${css.tableWrap}`}>
          <table className={css.table} aria-label={L("Packages", "Pakej")}>
            <thead><tr>
              <th>{L("Package", "Pakej")}</th>
              <th>{L("Issuer", "Pengeluar")}</th>
              <th>{L("Description", "Keterangan")}</th>
              <th className={css.num}>{L("Items", "Item")}</th>
              <th className={css.num}>{L("Total (RM)", "Jumlah (RM)")}</th>
              <th>{L("Status", "Status")}</th>
              <th>{L("Last updated", "Kemas kini terakhir")}</th>
              <th><span className={css.srOnly}>{L("Actions", "Tindakan")}</span></th>
            </tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td className={css.nameCell}>
                    <strong>{p.name}</strong>
                    <span className={css.sub}>{p.category ? <span className={chipInfo}>{p.category}</span> : null}<span className={css.ver}>v{p.current_version}</span></span>
                  </td>
                  <td data-label={L("Issuer", "Pengeluar")}>{p.issuers.map((k) => resolveIssuer(k).name).join(" · ")}</td>
                  <td data-label={L("Description", "Keterangan")} className={`${css.desc} ${css.preLine}`}>{p.description || <span className={css.muted}>—</span>}</td>
                  <td data-label={L("Items", "Item")} className={css.num}>{p.item_count}</td>
                  <td data-label={L("Total (RM)", "Jumlah (RM)")} className={`${css.num} ${css.money}`}>{rm(p.total_cents)}</td>
                  <td data-label={L("Status", "Status")}><span className={statusChip(p.status)}>{statusLabel(p.status)}</span></td>
                  <td data-label={L("Last updated", "Kemas kini terakhir")} className={css.when}>{dmy(p.updated_at.slice(0, 10))}{p.updated_by_name ? <span className={css.muted}> · {p.updated_by_name}</span> : null}</td>
                  <td className={css.actCell}>
                    <span className={css.actions}>
                      <button type="button" className={btnSm} onClick={() => setEditing(p)}><AppIcon name={canManage ? "edit" : "document"} />{canManage ? L("Edit", "Sunting") : L("View", "Lihat")}</button>
                      {canManage && p.status !== "active" && <button type="button" className={btnSm} onClick={() => void setStatusOf(p, "active")}>{L("Activate", "Aktifkan")}</button>}
                      {canManage && p.status === "active" && <button type="button" className={btnSm} onClick={() => void setStatusOf(p, "archived")}>{L("Archive", "Arkib")}</button>}
                      {canManage && p.used_by === 0 && p.status !== "active" && <button type="button" className={btnSm} onClick={() => void remove(p)} aria-label={L(`Delete ${p.name}`, `Padam ${p.name}`)}>{L("Delete", "Padam")}</button>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={css.foot}>{L(`Showing ${shown.length} of ${rows.length} packages`, `Memaparkan ${shown.length} daripada ${rows.length} pakej`)}{canManage ? "" : L(" · active packages only", " · pakej aktif sahaja")}</p>
        </div>
      )}

      {editing && (
        <PackageEditor pkg={editing === "new" ? null : editing} canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { toast(L("Saved", "Disimpan"), msg); setEditing(null); list.refresh(); }} />
      )}
    </section>
  );
}

/* ================================= editor ================================= */

type Draft = { name: string; category: string; description: string; notes: string; issuers: string[]; status: PackageStatus; items: DocItem[]; discount_cents: number };
const blankLine = (): DocItem => ({ name: "", qty: 1, unit_price_cents: 0 });

function PackageEditor({ pkg, canManage, onClose, onSaved }: { pkg: PackageRow | null; canManage: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const [d, setD] = useState<Draft>(() => pkg
    ? { name: pkg.name, category: pkg.category ?? "", description: pkg.description ?? "", notes: "", issuers: [...pkg.issuers], status: pkg.status, items: pkg.items.map((i) => ({ ...i })), discount_cents: pkg.discount_cents }
    : { name: "", category: "", description: "", notes: "", issuers: ["a2z"], status: "draft", items: [blankLine()], discount_cents: 0 });
  /* the notes are not in the list answer - read them with the package */
  const detail = useCachedApi<{ package?: { notes?: string | null } }>(pkg ? `/staff/packages/${pkg.id}` : null, Boolean(pkg), []);
  const [notesLoaded, setNotesLoaded] = useState(false);
  if (pkg && !notesLoaded && detail.data?.package) { setNotesLoaded(true); setD((x) => ({ ...x, notes: detail.data?.package?.notes ?? "" })); }
  const [tab, setTab] = useState<"details" | "items">("details");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const ro = !canManage;
  const subtotal = docSubtotal(d.items);
  const total = Math.max(0, subtotal - d.discount_cents);
  const setLine = (i: number, patch: Partial<DocItem>) => setD((x) => ({ ...x, items: x.items.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  const move = (i: number, by: -1 | 1) => setD((x) => {
    const j = i + by; if (j < 0 || j >= x.items.length) return x;
    const items = [...x.items]; [items[i], items[j]] = [items[j]!, items[i]!]; return { ...x, items };
  });

  const save = async () => {
    setMsg("");
    if (!d.name.trim()) { setTab("details"); setMsg(L("Name the package.", "Namakan pakej.")); return; }
    if (d.issuers.length === 0) { setTab("details"); setMsg(L("Choose at least one issuing company.", "Pilih sekurang-kurangnya satu syarikat pengeluar.")); return; }
    const items = d.items.map((i) => ({ ...i, name: i.name.trim(), sub: (i.sub ?? []).map((s) => s.trim()).filter(Boolean).slice(0, MAX_SUB) }))
      .map((i) => (i.sub.length ? i : { ...i, sub: undefined }));
    if (items.length === 0 || items.some((i) => !i.name || !(i.qty > 0))) { setTab("items"); setMsg(L("Every line needs a description and a quantity above 0.", "Setiap baris perlu keterangan dan kuantiti melebihi 0.")); return; }
    if (d.discount_cents > subtotal) { setTab("items"); setMsg(L("The discount is more than the subtotal.", "Diskaun melebihi subjumlah.")); return; }
    setBusy(true);
    const body = { name: d.name, category: d.category || null, description: d.description || null, notes: d.notes || null, issuers: d.issuers, status: d.status, items, discount_cents: d.discount_cents, ...(pkg ? { base_version: pkg.current_version } : {}) };
    const r = await api<{ version?: number; new_version?: boolean; error?: { message?: string } }>(pkg ? `/staff/packages/${pkg.id}` : "/staff/packages", { method: pkg ? "PUT" : "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setMsg(r.data?.error?.message ?? L("Not saved - try again.", "Tidak disimpan - cuba lagi.")); return; }
    onSaved(pkg
      ? (r.data?.new_version ? L(`${d.name} saved as version ${r.data.version}. Quotations already made keep their own lines.`, `${d.name} disimpan sebagai versi ${r.data.version}. Sebut harga sedia ada kekal dengan baris sendiri.`) : L(`${d.name} saved`, `${d.name} disimpan`))
      : L(`${d.name} created`, `${d.name} dicipta`));
  };

  return (
    <SideDrawer open onClose={onClose} wide
      title={pkg ? (ro ? pkg.name : L("Edit package", "Sunting pakej")) : L("Create package", "Cipta pakej")}
      subtitle={pkg ? L(`Version ${pkg.current_version}${pkg.used_by ? ` · on ${pkg.used_by} document(s)` : ""}`, `Versi ${pkg.current_version}${pkg.used_by ? ` · pada ${pkg.used_by} dokumen` : ""}`) : L("A draft until you make it active", "Draf sehingga anda aktifkan")}
      footer={ro ? <button type="button" className={btnSm} onClick={onClose}>{L("Close", "Tutup")}</button> : (
        <span className={css.footBtns}>
          <button type="button" className={btnSm} onClick={onClose}>{L("Cancel", "Batal")}</button>
          <button type="button" className={btnSmPrimary} disabled={busy} onClick={() => void save()}>{busy ? L("Saving…", "Menyimpan…") : L("Save package", "Simpan pakej")}</button>
        </span>
      )}>
      <div className={css.editor}>
        <div role="tablist" className={css.edTabs}>
          {([["details", L("Package details", "Butiran pakej")], ["items", L(`Package items (${d.items.length})`, `Item pakej (${d.items.length})`)]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? css.edTabOn : css.edTab} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        {msg && <p className="erp-note erp-note-warning" role="alert">{msg}</p>}

        {tab === "details" && (
          <div className={css.fields}>
            <label className={css.field}><span>{L("Package name", "Nama pakej")} *</span>
              <input className={inputClass} value={d.name} maxLength={120} readOnly={ro} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
            <label className={css.field}><span>{L("Category", "Kategori")}</span>
              <input className={inputClass} value={d.category} maxLength={60} readOnly={ro} placeholder={L("e.g. Marketing, Design, Web", "cth. Pemasaran, Reka bentuk, Web")} onChange={(e) => setD({ ...d, category: e.target.value })} /></label>
            <label className={css.field}><span>{L("Description", "Keterangan")}</span>
              <textarea className={textareaClass} rows={3} value={d.description} maxLength={1000} readOnly={ro} onChange={(e) => setD({ ...d, description: e.target.value })} /></label>
            <fieldset className={css.field}>
              <legend>{L("May be quoted under", "Boleh disebut harga di bawah")} *</legend>
              <span className={css.checks}>
                {ISSUERS.map(([k, n]) => (
                  <label key={k} className={css.check}>
                    <input type="checkbox" disabled={ro} checked={d.issuers.includes(k)} onChange={(e) => setD({ ...d, issuers: e.target.checked ? [...d.issuers, k] : d.issuers.filter((x) => x !== k) })} />{n}
                  </label>
                ))}
              </span>
              <span className={css.hint}>{L("A quotation shows only the packages offered under its issuing company. AZ ONE OFFICIAL quotes services only.", "Sebut harga hanya memaparkan pakej yang ditawarkan di bawah syarikat pengeluarnya. AZ ONE OFFICIAL hanya menyebut harga perkhidmatan.")}</span>
            </fieldset>
            <label className={css.field}><span>{L("Status", "Status")}</span>
              <select className={selectClassSm} value={d.status} disabled={ro} onChange={(e) => setD({ ...d, status: e.target.value as PackageStatus })}>
                <option value="draft">{statusLabel("draft")}</option>
                <option value="active">{statusLabel("active")}</option>
                {pkg && <option value="archived">{statusLabel("archived")}</option>}
              </select>
              <span className={css.hint}>{L("Only active packages can be chosen on a new quotation. Archived ones stay on the quotations made from them.", "Hanya pakej aktif boleh dipilih pada sebut harga baharu. Pakej diarkibkan kekal pada sebut harga yang dibuat daripadanya.")}</span>
            </label>
            {!ro && (
              <label className={css.field}><span>{L("Internal notes (optional)", "Nota dalaman (pilihan)")}</span>
                <textarea className={textareaClass} rows={2} value={d.notes} maxLength={1000} onChange={(e) => setD({ ...d, notes: e.target.value })} /></label>
            )}
          </div>
        )}

        {tab === "items" && (
          <div className={css.items}>
            <ol className={css.lines}>
              {d.items.map((l, i) => (
                <li key={i} className={css.line}>
                  <span className={css.lineNo} aria-hidden>{i + 1}</span>
                  <div className={css.lineBody}>
                    <input className={inputClass} value={l.name} maxLength={200} readOnly={ro} placeholder={L("Service description", "Keterangan perkhidmatan")} aria-label={L(`Line ${i + 1} description`, `Keterangan baris ${i + 1}`)} onChange={(e) => setLine(i, { name: e.target.value })} />
                    <div className={css.lineNums}>
                      <label><span>{L("Qty", "Kuantiti")}</span><input className={inputClass} type="number" min={0.01} step="any" value={l.qty} readOnly={ro} onChange={(e) => setLine(i, { qty: Math.max(0, Number(e.target.value) || 0) })} /></label>
                      <label><span>{L("UOM", "Unit")}</span><input className={inputClass} value={l.uom ?? ""} maxLength={12} readOnly={ro} placeholder="UNIT" onChange={(e) => setLine(i, { uom: e.target.value || undefined })} /></label>
                      <label><span>{L("Unit price (RM)", "Harga seunit (RM)")}</span><input className={inputClass} type="number" min={0} step="0.01" value={l.unit_price_cents / 100} readOnly={ro} onChange={(e) => setLine(i, { unit_price_cents: toCents(e.target.value) })} /></label>
                      <label><span>{L("Discount (RM)", "Diskaun (RM)")}</span><input className={inputClass} type="number" min={0} step="0.01" value={(l.disc_cents ?? 0) / 100} readOnly={ro} onChange={(e) => setLine(i, { disc_cents: toCents(e.target.value) || undefined })} /></label>
                      <span className={css.lineAmt}>RM {rm(lineAmount(l))}</span>
                    </div>
                    <textarea className={textareaClass} rows={2} readOnly={ro} value={(l.sub ?? []).join("\n")} placeholder={L("Inclusions, one per line (up to 10)", "Termasuk, satu setiap baris (sehingga 10)")}
                      aria-label={L(`Line ${i + 1} inclusions`, `Termasuk baris ${i + 1}`)} onChange={(e) => setLine(i, { sub: e.target.value.split("\n").slice(0, MAX_SUB) })} />
                  </div>
                  {!ro && (
                    <span className={css.lineBtns}>
                      <button type="button" className={btnSm} disabled={i === 0} onClick={() => move(i, -1)} aria-label={L("Move up", "Naik")}>↑</button>
                      <button type="button" className={btnSm} disabled={i === d.items.length - 1} onClick={() => move(i, 1)} aria-label={L("Move down", "Turun")}>↓</button>
                      <button type="button" className={btnSm} disabled={d.items.length === 1} onClick={() => setD({ ...d, items: d.items.filter((_, k) => k !== i) })} aria-label={L(`Remove line ${i + 1}`, `Buang baris ${i + 1}`)}>✕</button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {!ro && <button type="button" className={btnSm} onClick={() => setD({ ...d, items: [...d.items, blankLine()] })}><AppIcon name="add" />{L("Add item", "Tambah item")}</button>}
            <dl className={css.totals}>
              <div><dt>{L("Subtotal", "Subjumlah")}</dt><dd>RM {rm(subtotal)}</dd></div>
              <div><dt>{L("Discount (optional)", "Diskaun (pilihan)")}</dt><dd>{ro ? `RM ${rm(d.discount_cents)}` : (
                <input className={`${inputClass} ${css.discIn}`} type="number" min={0} step="0.01" value={d.discount_cents / 100} aria-label={L("Package discount (RM)", "Diskaun pakej (RM)")} onChange={(e) => setD({ ...d, discount_cents: toCents(e.target.value) })} />
              )}</dd></div>
              <div className={css.grand}><dt>{L("Total (RM)", "Jumlah (RM)")}</dt><dd>RM {rm(total)}</dd></div>
            </dl>
            <p className={css.hint}>{L("Tax and delivery are set on each quotation. Saving changed lines or prices makes a new version - quotations already made keep theirs.", "Cukai dan penghantaran ditetapkan pada setiap sebut harga. Menyimpan baris atau harga yang berubah menghasilkan versi baharu - sebut harga sedia ada kekal.")}</p>
          </div>
        )}
      </div>
    </SideDrawer>
  );
}

/* ================================= picker ================================= */

/** The Create form's "Package (optional)": active packages offered under the
    form's issuer. `onApply` gets the package and how to place its lines when
    the form already has some; the form does the rest with its own state. */
export function PackagePicker({ issuer, applied, hasLines, canAdd = true, onApply, onClear }: {
  issuer: string;
  applied: PackageRef | null;
  hasLines: number;
  /** false when the form holds Inventory lines - a service package replaces them */
  canAdd?: boolean;
  onApply: (p: PackageRow, mode: "replace" | "add") => void;
  onClear: () => void;
}) {
  const list = useCachedApi<{ packages?: PackageRow[] }>("/staff/packages", true, []);
  const offered = (list.data?.packages ?? []).filter((p) => p.status === "active" && p.issuers.includes(issuer as "a2z"));
  const [pending, setPending] = useState<PackageRow | null>(null);
  const [details, setDetails] = useState(false);
  const shownPkg = pending ?? offered.find((p) => p.id === applied?.id) ?? null;
  const choose = (id: number) => {
    const p = offered.find((x) => x.id === id);
    if (!p) return;
    setDetails(false);
    if (hasLines > 0) setPending(p); else onApply(p, "replace");
  };
  return (
    <div className={css.picker}>
      <span className={css.pickLabel}>{L("Package (optional)", "Pakej (pilihan)")}</span>
      <div className={css.pickRow}>
        <select className={`${inputClass} ${css.pickSelect}`} aria-label={L("Package (optional)", "Pakej (pilihan)")}
          value={pending?.id ?? applied?.id ?? ""} onChange={(e) => (e.target.value ? choose(Number(e.target.value)) : (setPending(null), onClear()))}>
          <option value="">{L("No package — custom quotation", "Tiada pakej — sebut harga tersuai")}</option>
          {offered.map((p) => (
            <option key={p.id} value={p.id}>{`${p.name} — RM ${rm(p.total_cents)} (${p.item_count} ${p.item_count === 1 ? L("item", "item") : L("items", "item")})`}</option>
          ))}
          {applied && !offered.some((p) => p.id === applied.id) && <option value={applied.id}>{`${applied.name} · v${applied.version}`}</option>}
        </select>
        <button type="button" className={btnSm} disabled={!shownPkg} onClick={() => setDetails((x) => !x)}>{details ? L("Hide details", "Sembunyi butiran") : L("View details", "Lihat butiran")}</button>
      </div>
      {!list.loading && offered.length === 0 && !applied && (
        <span className={css.hint}>{L("No active package for this issuer - write the lines below as usual.", "Tiada pakej aktif untuk pengeluar ini - tulis baris di bawah seperti biasa.")}</span>
      )}
      {pending && (
        <div className={css.pending} role="group" aria-label={L("Place the package lines", "Letak baris pakej")}>
          <span>{L(`This quotation already has ${hasLines} line(s). ${pending.name} has ${pending.item_count}.`, `Sebut harga ini sudah ada ${hasLines} baris. ${pending.name} ada ${pending.item_count}.`)}</span>
          <span className={css.pendingBtns}>
            <button type="button" className={btnSmPrimary} onClick={() => { onApply(pending, "replace"); setPending(null); }}>{L("Replace the lines", "Ganti baris")}</button>
            {canAdd && <button type="button" className={btnSm} onClick={() => { onApply(pending, "add"); setPending(null); }}>{L("Add after them", "Tambah selepasnya")}</button>}
            <button type="button" className={btnSm} onClick={() => setPending(null)}>{L("Cancel", "Batal")}</button>
          </span>
        </div>
      )}
      {details && shownPkg && (
        <div className={css.details}>
          {shownPkg.description && <p className={`erp-meta ${css.preLine}`}>{shownPkg.description}</p>}
          <ul className={css.detailLines}>
            {shownPkg.items.map((l, i) => <li key={i}><span>{l.name}</span><span className={css.muted}>{l.qty} × RM {rm(l.unit_price_cents)}</span><strong>RM {rm(lineAmount(l))}</strong></li>)}
          </ul>
          <p className={css.detailTotal}>{shownPkg.discount_cents ? L(`Package discount RM ${rm(shownPkg.discount_cents)} · `, `Diskaun pakej RM ${rm(shownPkg.discount_cents)} · `) : ""}{L("Total", "Jumlah")} <strong>RM {rm(shownPkg.total_cents)}</strong></p>
        </div>
      )}
      {applied && !pending && (
        <p className={css.applied} role="status">
          <AppIcon name="success" />
          <span><strong>{L(`Package applied: ${applied.name} · v${applied.version}`, `Pakej digunakan: ${applied.name} · v${applied.version}`)}</strong>{" "}
            {L("Its lines are now this quotation's own - edit, add or remove them freely; the package itself is not changed.", "Barisnya kini milik sebut harga ini - sunting, tambah atau buang dengan bebas; pakej itu sendiri tidak berubah.")}</span>
          <button type="button" className={btnSm} onClick={onClear}>{L("Clear selection", "Kosongkan pilihan")}</button>
        </p>
      )}
    </div>
  );
}
