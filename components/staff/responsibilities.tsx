"use client";

/* POSITION & RESPONSIBILITIES - the shared pieces every screen uses.
 *
 * v1.174.0 (the CEO, 21-09-2026): a role title and a list, written by the CEO
 * and the HR tier on the Staff tab, read by the person on their Profile.
 *
 * v1.388.0 (the CEO, 19-11-2026, migration 0215): "Build this as a reusable
 * staff profile data system, not merely a visual table enhancement." Each
 * responsibility is now its own record, in order, with Key (the compact
 * portfolio card shows up to five) and Public (may appear on a public card;
 * off until ticked). Templates per position suggest a list; a person's list is
 * a copy, so customising it never changes the template. The POSITION is the
 * staff record's and is never an access level.
 *
 * ONE set of pieces, every door:
 *   ResponsibilitiesView    read-only list (Profile, the person's drawer)
 *   ResponsibilitiesBlock   Staff Records: the list + Edit responsibilities
 *   ResponsibilitiesDrawer  the editor - Departments & Roles and Staff Records
 *                           open the SAME drawer, so the two can never differ
 *   TemplatesDrawer         the position templates (CEO, Super Admin, COO, CCO)
 *   PortfolioCard / PortfolioDrawer - the staff portfolio from
 *                           GET /staff/portfolio/:id, compact or expanded
 *
 * NEVER OVERWRITTEN WITHOUT CONFIRMATION: the editor saves with the version it
 * loaded; when somebody else saved meanwhile the server refuses (409 changed),
 * the editor says so and reloads - nothing is lost silently. Using a template
 * on a list that already has items asks first. The server decides who may
 * write (responsibilities_edit, responsibility_templates); a screen only hides
 * the buttons. Styling: shared classes + responsibilities.module.css, tokens
 * only (Tailwind is retired). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useSaveToast } from "@/components/ui/save-toast";
import { DrawerFoot, SideDrawer } from "@/components/ui/side-drawer";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmyMYT } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { cleanResponsibility, keyResponsibilities, RESP_LIMITS, type RespItem, type StaffPortfolio } from "@/lib/staff-profile";
import { btnSm, btnSmPrimary, chipGold, chipNeutral, inputClass, selectClassSm } from "@/lib/ui-styles";
import css from "./responsibilities.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

/** The 0137 columns as the list and profile routes return them. Since 0215 the
    `responsibilities` text is built by the server from the records. */
export interface Responsibilities {
  role_title?: string | null;
  responsibilities?: string | null;
  responsibilities_updated_at?: string | null;
  responsibilities_updated_by_name?: string | null;
  /** v1.388.0 - the items with their flags (GET /staff/users) */
  responsibility_items?: RespItem[] | null;
}

/** One responsibility per line; blank lines and leading bullets dropped -
    the server's own rule for the text it builds. */
export function responsibilityLines(text: string | null | undefined): string[] {
  return (text ?? "").split(/\r?\n/).map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
}

/** v1.388.0 - the limits are the server's (worker/src/responsibilities.ts RESP_LIMITS) */
export const RESPONSIBILITY_LIMITS = { title: RESP_LIMITS.title, line: RESP_LIMITS.text, lines: RESP_LIMITS.items, key: RESP_LIMITS.key } as const;

/** The read-only half: role title, numbered list (Key marked), who wrote it. */
export function ResponsibilitiesView({ value, loaded = true, emptyText }: {
  value: Responsibilities;
  loaded?: boolean;
  /** What to say when nothing is written yet (the Profile says something different from the Staff tab). */
  emptyText?: string;
}) {
  if (!loaded) {
    return (
      <div aria-busy="true">
        <Skel className={`erp-mt-2`} h="1rem" w="55%" />
        <Skel className={`erp-mt-2`} h="0.75rem" w="90%" />
        <Skel className={`erp-mt-1`} h="0.75rem" w="80%" />
      </div>
    );
  }
  const items: RespItem[] = value.responsibility_items?.length
    ? value.responsibility_items
    : responsibilityLines(value.responsibilities).map((text) => ({ text, is_key: 0, is_public: 0 }));
  const title = (value.role_title ?? "").trim();
  if (!title && items.length === 0) {
    return <p className={`erp-text-sm erp-muted ${css.empty}`}>{emptyText ?? L("Not written yet.", "Belum ditulis.")}</p>;
  }
  return (
    <>
      {title && <p className={css.title}>{title}</p>}
      {items.length > 0 && (
        <ol className={css.list} aria-label={L("Responsibilities", "Tanggungjawab")}>
          {items.map((it, i) => (
            <li key={`${i}-${it.text}`} className={css.item}>
              {it.text}
              {Boolean(it.is_key) && <span className={`${chipGold} ${css.flag}`}>{L("Key", "Utama")}</span>}
            </li>
          ))}
        </ol>
      )}
      {value.responsibilities_updated_at && (
        <p className={`erp-meta ${css.meta}`}>
          {L("Written", "Ditulis")}{value.responsibilities_updated_by_name ? ` ${L("by", "oleh")} ${value.responsibilities_updated_by_name}` : ""} · {dmyMYT(value.responsibilities_updated_at)}
        </p>
      )}
    </>
  );
}

/* ================================================================== editor rows */
type Row = { k: number; text: string; is_key: boolean; is_public: boolean; template_position_id: number | null };
let rowSeq = 0;
const toRow = (i: { text: string; is_key?: number | boolean; is_public?: number | boolean; template_position_id?: number | null }): Row =>
  ({ k: ++rowSeq, text: i.text, is_key: Boolean(i.is_key), is_public: Boolean(i.is_public), template_position_id: i.template_position_id ?? null });
const sameRows = (a: Row[], b: Row[]) => JSON.stringify(a.map(({ k: _k, ...r }) => r)) === JSON.stringify(b.map(({ k: _k, ...r }) => r));

/** The list editor - shared by a person's list (with Key / Public) and a template (text only). */
function RowsEditor({ rows, setRows, flags, testid }: { rows: Row[]; setRows: (next: Row[]) => void; flags: boolean; testid: string }) {
  const keyCount = rows.filter((r) => r.is_key).length;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRows(next);
  };
  const patch = (i: number, p: Partial<Row>) => setRows(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));
  return (
    <div data-testid={testid}>
      {rows.length === 0 && <p className={`erp-meta ${css.empty}`}>{L("No responsibilities yet - add the first one below.", "Tiada tanggungjawab lagi - tambah yang pertama di bawah.")}</p>}
      <ol className={css.rows}>
        {rows.map((r, i) => {
          const long = r.text.length > RESP_LIMITS.text;
          return (
            <li key={r.k} className={css.row} data-testid="resp-row">
              <span className={css.num} aria-hidden>{i + 1}</span>
              <span className={css.rowMain}>
                <input className={inputClass} value={r.text} maxLength={RESP_LIMITS.text + 20}
                  aria-label={L(`Responsibility ${i + 1}`, `Tanggungjawab ${i + 1}`)} aria-invalid={long || undefined}
                  placeholder={L("e.g. Answer every enquiry within 24 hours", "cth. Jawab setiap pertanyaan dalam 24 jam")}
                  onChange={(e) => patch(i, { text: e.target.value })} />
                {flags && (
                  <span className={css.flags}>
                    <label className={css.flagLabel} title={L("Shown on the compact portfolio card (up to five)", "Dipaparkan pada kad portfolio ringkas (sehingga lima)")}>
                      <input type="checkbox" className="erp-check" checked={r.is_key} data-testid="resp-key"
                        disabled={!r.is_key && keyCount >= RESP_LIMITS.key}
                        onChange={(e) => patch(i, { is_key: e.target.checked })} />
                      {L("Key", "Utama")}
                    </label>
                    <label className={css.flagLabel} title={L("May appear on a public portfolio card", "Boleh dipaparkan pada kad portfolio awam")}>
                      <input type="checkbox" className="erp-check" checked={r.is_public} data-testid="resp-public"
                        onChange={(e) => patch(i, { is_public: e.target.checked })} />
                      {L("Public", "Awam")}
                    </label>
                    {r.template_position_id && <span className={`${chipNeutral} ${css.flag}`}>{L("From template", "Daripada templat")}</span>}
                  </span>
                )}
                {long && <span className="erp-help erp-danger">{L(`At most ${RESP_LIMITS.text} characters`, `Maksimum ${RESP_LIMITS.text} aksara`)}</span>}
              </span>
              <span className={css.rowBtns}>
                <button type="button" className="erp-icon-button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={L("Move up", "Naikkan")}><AppIcon name="expand" className={css.flip} /></button>
                <button type="button" className="erp-icon-button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={L("Move down", "Turunkan")}><AppIcon name="expand" /></button>
                <button type="button" className="erp-icon-button" onClick={() => setRows(rows.filter((_, n) => n !== i))} aria-label={L("Remove", "Buang")} data-testid="resp-remove"><AppIcon name="close" /></button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className={css.addRow}>
        <button type="button" className={btnSm} disabled={rows.length >= RESP_LIMITS.items} onClick={() => setRows([...rows, toRow({ text: "" })])} data-testid="resp-add">
          <AppIcon name="add" />{L("Add responsibility", "Tambah tanggungjawab")}
        </button>
        <span className={`erp-meta ${css.count}`}>
          {rows.length}/{RESP_LIMITS.items}{flags ? ` · ${L("Key", "Utama")} ${keyCount}/${RESP_LIMITS.key}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ================================================================== a person's list */
type PersonList = {
  user_id: number; position: string | null; position_id: number | null; department: string | null; role_title: string | null;
  items: (RespItem & { id: number })[]; version: string;
  template: { position_id: number; position: string | null; items: { id: number; text: string }[] } | null;
  updated_at: string | null; updated_by_name: string | null; can_edit: boolean;
};
export type SavedResponsibilities = Required<Pick<Responsibilities, "role_title" | "responsibilities" | "responsibility_items">> & { responsibilities_updated_at: string; responsibilities_updated_by_name: string | null };

/** The editor, in a drawer. Departments & Roles and Staff Records open this same one. */
export function ResponsibilitiesDrawer({ open, userId, personName, onClose, onSaved }: {
  open: boolean; userId: number | null; personName: string; onClose: () => void;
  /** the saved record, so the list shows it at once */
  onSaved?: (userId: number, next: SavedResponsibilities) => void;
}) {
  const [data, setData] = useState<PersonList | null>(null);
  const [failed, setFailed] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [start, setStart] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();

  const load = useCallback(async (id: number) => {
    setFailed("");
    const r = await api<PersonList & { error?: { message?: string } }>(`/staff/users/${id}/responsibilities`);
    if (!r.ok || !r.data) { setData(null); setFailed(r.data?.error?.message ?? L("The responsibilities could not be loaded.", "Tanggungjawab tidak dapat dimuatkan.")); return; }
    const loaded = r.data.items.map(toRow);
    setData(r.data); setRows(loaded); setStart(loaded); setTitle((r.data.role_title ?? "").trim());
  }, []);
  useEffect(() => {
    if (!open || userId === null) return;
    setData(null); setRows([]); setStart([]);
    void load(userId);
  }, [open, userId, load]);

  const dirty = data !== null && (!sameRows(rows, start) || title !== (data.role_title ?? "").trim());
  const cleaned = rows.map((r) => ({ ...r, text: cleanResponsibility(r.text) })).filter((r) => r.text);
  const invalid = cleaned.length > RESP_LIMITS.items || cleaned.some((r) => r.text.length > RESP_LIMITS.text) || cleaned.filter((r) => r.is_key).length > RESP_LIMITS.key;
  const tpl = data?.template?.items ?? [];
  const missing = tpl.filter((t) => !rows.some((r) => cleanResponsibility(r.text).toLowerCase() === t.text.toLowerCase()));

  const applyTemplate = async (mode: "add" | "replace") => {
    if (!data?.template) return;
    const fromTpl = (list: { text: string }[], keyFrom: number) => list.map((t, i) => toRow({ text: t.text, is_key: keyFrom + i < RESP_LIMITS.key, is_public: false, template_position_id: data.template!.position_id }));
    if (mode === "replace") {
      if (rows.some((r) => r.text.trim()) && !(await confirm({
        title: L("Replace this list with the template?", "Gantikan senarai ini dengan templat?"),
        message: L(`${rows.length} responsibilit${rows.length === 1 ? "y" : "ies"} on ${personName}'s list will be replaced by the ${tpl.length} in the ${data.template.position ?? ""} template. Nothing is saved until you press Save.`,
          `${rows.length} tanggungjawab dalam senarai ${personName} akan digantikan dengan ${tpl.length} dalam templat ${data.template.position ?? ""}. Tiada apa disimpan sehingga anda tekan Simpan.`),
        confirmLabel: L("Replace", "Gantikan"), variant: "danger",
      }))) return;
      setRows(fromTpl(tpl, 0));
    } else {
      setRows([...rows, ...fromTpl(missing, rows.filter((r) => r.is_key).length)].slice(0, RESP_LIMITS.items));
    }
  };

  const save = async () => {
    if (!data || userId === null || invalid) return;
    setSaving(true);
    const r = await api<{ ok?: boolean; items?: (RespItem & { id: number })[]; version?: string; role_title?: string | null; updated_by_name?: string | null; error?: { code?: string; message?: string } }>(
      `/staff/users/${userId}/responsibilities`,
      { method: "PUT", body: JSON.stringify({ role_title: title.trim(), version: data.version, items: cleaned.map(({ text, is_key, is_public, template_position_id }) => ({ text, is_key, is_public, template_position_id })) }) },
    );
    setSaving(false);
    if (!r.ok) {
      if (r.data?.error?.code === "changed") {
        toast(L("Changed by somebody else", "Diubah oleh orang lain"), L("These responsibilities were saved by somebody else since you opened them. They have been reloaded - check them and make your change again.", "Tanggungjawab ini telah disimpan oleh orang lain sejak anda membukanya. Ia telah dimuat semula - semak dan buat perubahan anda sekali lagi."), "notice");
        await load(userId);
        return;
      }
      toast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    const items = r.data?.items ?? [];
    onSaved?.(userId, {
      role_title: r.data?.role_title ?? null,
      responsibilities: items.map((i) => i.text).join("\n") || null,
      responsibility_items: items,
      responsibilities_updated_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "),
      responsibilities_updated_by_name: r.data?.updated_by_name ?? null,
    });
    toast(L("Saved", "Disimpan"), L(`Responsibilities - ${personName}`, `Tanggungjawab - ${personName}`));
    onClose();
  };

  return (
    <SideDrawer open={open} onClose={onClose} icon="target" dirty={dirty}
      title={L("Edit responsibilities", "Sunting tanggungjawab")}
      subtitle={data ? [personName, data.position, data.department].filter(Boolean).join(" · ") : personName}
      footer={data?.can_edit ? (
        <DrawerFoot testid="resp-foot">
          <button type="button" className={btnSm} disabled={saving} onClick={onClose}>{L("Cancel", "Batal")}</button>
          <button type="button" className={btnSmPrimary} disabled={saving || invalid || !dirty} onClick={() => void save()} data-testid="resp-save">
            {saving ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}
          </button>
        </DrawerFoot>
      ) : undefined}>
      {toastNode}{confirmNode}
      {failed ? <p className="erp-help erp-danger">{failed}</p> : !data ? <SkelRows rows={5} /> : (
        <div className={css.editor} data-testid="resp-editor">
          <div className={css.facts}>
            <span className="erp-label">{L("Position", "Jawatan")}</span>
            <span className={css.position}>{data.position || <span className="erp-muted">{L("No position on the record", "Tiada jawatan pada rekod")}</span>}</span>
            <span className="erp-meta">{L("The position comes from the staff record (Staff Records > Employment) and never changes system access.", "Jawatan datang daripada rekod kakitangan (Rekod Kakitangan > Pekerjaan) dan tidak pernah mengubah akses sistem.")}</span>
          </div>
          {data.template && tpl.length > 0 && data.can_edit && (
            <div className={css.template} data-testid="resp-template">
              <span><AppIcon name="idea" />{L(`Suggested for ${data.template.position}: ${tpl.length} responsibilit${tpl.length === 1 ? "y" : "ies"}`, `Dicadangkan untuk ${data.template.position}: ${tpl.length} tanggungjawab`)}</span>
              <span className={css.rowBtns}>
                <button type="button" className={btnSm} disabled={missing.length === 0} onClick={() => void applyTemplate("add")} data-testid="resp-template-add">
                  {missing.length ? L(`Add ${missing.length} missing`, `Tambah ${missing.length} yang tiada`) : L("All added", "Semua ditambah")}
                </button>
                <button type="button" className={btnSm} onClick={() => void applyTemplate("replace")} data-testid="resp-template-replace">{L("Replace with template", "Ganti dengan templat")}</button>
              </span>
            </div>
          )}
          {data.position && !data.template && data.can_edit && (
            <p className="erp-meta">{L("No template for this position yet. The CEO, the Super Admin, the COO and the CCO keep templates in Departments & Roles.", "Tiada templat untuk jawatan ini lagi. CEO, Super Admin, COO dan CCO menyimpan templat di Jabatan & Peranan.")}</p>
          )}
          {data.can_edit ? (
            <>
              <RowsEditor rows={rows} setRows={setRows} flags testid="resp-rows" />
              <label className="erp-field">
                <span className="erp-label">{L("Role title (optional, shown under the position)", "Tajuk peranan (pilihan, di bawah jawatan)")}</span>
                <input className={inputClass} value={title} maxLength={RESP_LIMITS.title} onChange={(e) => setTitle(e.target.value)}
                  placeholder={L("e.g. ELFIA accounts", "cth. akaun ELFIA")} />
              </label>
              <p className="erp-meta">{L("Key: shown on the compact portfolio card (up to five). Public: may appear on a public card - nothing is published until it is ticked. Saved whole, with your name; the person reads it on their Profile.", "Utama: dipaparkan pada kad portfolio ringkas (sehingga lima). Awam: boleh dipaparkan pada kad awam - tiada yang diterbitkan sehingga ditanda. Disimpan sepenuhnya, dengan nama anda; orang itu membacanya di Profil mereka.")}</p>
            </>
          ) : (
            <ResponsibilitiesView value={{ role_title: data.role_title, responsibility_items: data.items, responsibilities_updated_at: data.updated_at, responsibilities_updated_by_name: data.updated_by_name }} />
          )}
        </div>
      )}
    </SideDrawer>
  );
}

/** Staff Records: the list, and Edit responsibilities for the CEO / HR tier. */
export function ResponsibilitiesBlock({ userId, personName, value, canEdit, onSaved }: {
  userId: number;
  personName: string;
  value: Responsibilities;
  /** Mirrors PERMS.responsibilities_edit - the worker refuses what this hides. */
  canEdit: boolean;
  /** The saved record, so the directory shows it without a refetch. */
  onSaved?: (next: Responsibilities) => void;
}) {
  const [editing, setEditing] = useState(false);
  const has = Boolean(value.role_title || value.responsibilities || value.responsibility_items?.length);
  return (
    <div className={css.block} data-testid="responsibilities">
      <div className={css.head}>
        <p className={css.eyebrow}><AppIcon name="target" className="erp-icon-sm" />{L("Roles and responsibilities", "Peranan dan tanggungjawab")}</p>
        {canEdit && !editing && (
          <button type="button" className={btnSm} onClick={() => setEditing(true)} data-testid="resp-edit"
            title={L("Write or change this person's responsibilities - recorded with your name", "Tulis atau ubah tanggungjawab orang ini - direkodkan dengan nama anda")}>
            <AppIcon name="edit" />{has ? L("Edit responsibilities", "Sunting tanggungjawab") : L("Write responsibilities", "Tulis tanggungjawab")}
          </button>
        )}
      </div>
      <ResponsibilitiesView value={value}
        emptyText={canEdit
          ? L("Not written yet - press Write responsibilities to list what this person is answerable for.", "Belum ditulis - tekan Tulis tanggungjawab untuk menyenaraikan tanggungjawab orang ini.")
          : L("Not written yet.", "Belum ditulis.")} />
      <ResponsibilitiesDrawer open={editing} userId={userId} personName={personName} onClose={() => setEditing(false)}
        onSaved={(_id, next) => onSaved?.(next)} />
    </div>
  );
}

/* ================================================================== templates */
type Template = { position_id: number; position: string; department: string | null; items: { id: number; text: string }[]; version: string };

/** The position templates: read by everyone on staff, kept by the CEO, the
    Super Admin, the COO and the CCO (responsibility_templates). */
export function TemplatesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [list, setList] = useState<Template[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [failed, setFailed] = useState("");
  const [pid, setPid] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [start, setStart] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const { show: toast, node: toastNode } = useSaveToast();
  const { confirm, node: confirmNode } = useConfirm();
  const pidRef = useRef<number | null>(null);

  const pick = (all: Template[], id: number | null) => {
    const t = all.find((x) => x.position_id === id) ?? all[0] ?? null;
    const r = (t?.items ?? []).map((i) => toRow({ text: i.text }));
    pidRef.current = t?.position_id ?? null;
    setPid(t?.position_id ?? null); setRows(r); setStart(r);
  };
  const load = useCallback(async () => {
    setFailed("");
    const r = await api<{ templates: Template[]; can_manage: boolean; error?: { message?: string } }>("/staff/responsibilities/templates");
    if (!r.ok || !r.data) { setFailed(r.data?.error?.message ?? L("The templates could not be loaded.", "Templat tidak dapat dimuatkan.")); return; }
    setList(r.data.templates); setCanManage(r.data.can_manage);
    pick(r.data.templates, pidRef.current);
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const current = list?.find((t) => t.position_id === pid) ?? null;
  const dirty = !sameRows(rows, start);
  const cleaned = rows.map((r) => cleanResponsibility(r.text)).filter(Boolean);
  const invalid = cleaned.length > RESP_LIMITS.items || cleaned.some((t) => t.length > RESP_LIMITS.text);

  const choose = async (id: number) => {
    if (dirty && !(await confirm({ title: L("Discard your changes?", "Buang perubahan anda?"), message: L("The changes to this template are not saved.", "Perubahan pada templat ini belum disimpan."), confirmLabel: L("Discard", "Buang"), variant: "danger" }))) return;
    if (list) pick(list, id);
  };
  const save = async () => {
    if (!current || invalid) return;
    setSaving(true);
    const r = await api<{ ok?: boolean; error?: { code?: string; message?: string } }>(`/staff/responsibilities/templates/${current.position_id}`,
      { method: "PUT", body: JSON.stringify({ items: cleaned, version: current.version }) });
    setSaving(false);
    if (!r.ok) {
      toast(r.data?.error?.code === "changed" ? L("Changed by somebody else", "Diubah oleh orang lain") : L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      if (r.data?.error?.code === "changed") await load();
      return;
    }
    toast(L("Template saved", "Templat disimpan"), L(`${current.position} - nobody's own list changed`, `${current.position} - senarai sesiapa tidak berubah`));
    await load();
  };

  return (
    <SideDrawer open={open} onClose={onClose} icon="document" dirty={dirty}
      title={L("Responsibility templates", "Templat tanggungjawab")}
      subtitle={L("The default list suggested for each position. A person's list is a copy: changing a template never changes anybody's list.", "Senarai lalai yang dicadangkan untuk setiap jawatan. Senarai seseorang ialah salinan: mengubah templat tidak pernah mengubah senarai sesiapa.")}
      footer={canManage && current ? (
        <DrawerFoot testid="tpl-foot">
          <button type="button" className={btnSm} disabled={saving} onClick={onClose}>{L("Close", "Tutup")}</button>
          <button type="button" className={btnSmPrimary} disabled={saving || invalid || !dirty} onClick={() => void save()} data-testid="tpl-save">
            {saving ? L("Saving…", "Menyimpan…") : L("Save template", "Simpan templat")}
          </button>
        </DrawerFoot>
      ) : undefined}>
      {toastNode}{confirmNode}
      {failed ? <p className="erp-help erp-danger">{failed}</p> : !list ? <SkelRows rows={5} /> : list.length === 0 ? (
        <p className="erp-meta">{L("There are no positions on the list yet. Add positions in Departments & Roles first.", "Belum ada jawatan dalam senarai. Tambah jawatan di Jabatan & Peranan dahulu.")}</p>
      ) : (
        <div className={css.editor} data-testid="tpl-editor">
          <label className="erp-field">
            <span className="erp-label">{L("Position", "Jawatan")}</span>
            <select className={selectClassSm} value={pid ?? ""} onChange={(e) => void choose(Number(e.target.value))} data-testid="tpl-position">
              {list.map((t) => <option key={t.position_id} value={t.position_id}>{t.position}{t.items.length ? ` (${t.items.length})` : ""}</option>)}
            </select>
          </label>
          {current?.department && <p className="erp-meta">{L(`Department: ${current.department}`, `Jabatan: ${current.department}`)}</p>}
          {canManage ? <RowsEditor rows={rows} setRows={setRows} flags={false} testid="tpl-rows" /> : (
            current?.items.length ? <ol className={css.list}>{current.items.map((i) => <li key={i.id} className={css.item}>{i.text}</li>)}</ol>
              : <p className="erp-meta">{L("No template for this position yet.", "Tiada templat untuk jawatan ini lagi.")}</p>
          )}
        </div>
      )}
    </SideDrawer>
  );
}

/* ================================================================== the portfolio */
/** A staff portfolio, from GET /staff/portfolio/:id - photo, name, the
    position as the professional title, department, staff ID and the key
    responsibilities; the full list when expanded. */
export function PortfolioCard({ userId, expanded: expandedIn = false, reloadKey = 0 }: { userId: number; expanded?: boolean; reloadKey?: number }) {
  const [p, setP] = useState<StaffPortfolio | null>(null);
  const [failed, setFailed] = useState("");
  const [expanded, setExpanded] = useState(expandedIn);
  useEffect(() => {
    const c = new AbortController();
    setP(null); setFailed("");
    void api<{ portfolio?: StaffPortfolio; error?: { message?: string } }>(`/staff/portfolio/${userId}`, { signal: c.signal }).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok && r.data?.portfolio) setP(r.data.portfolio); else setFailed(r.data?.error?.message ?? L("The portfolio could not be loaded.", "Portfolio tidak dapat dimuatkan."));
    });
    return () => c.abort();
  }, [userId, reloadKey]);
  const pub = useMemo(() => new Set(p?.public ?? []), [p]);
  if (failed) return <p className="erp-help erp-danger">{failed}</p>;
  if (!p) return <SkelRows rows={4} />;
  const more = p.responsibilities.length - p.key.length;
  return (
    <section className={`erp-card ${css.portfolio}`} aria-label={L(`Portfolio of ${p.name}`, `Portfolio ${p.name}`)} data-testid="portfolio-card">
      <div className={css.pfHead}>
        <Avatar name={p.full_name || p.name} photoKey={p.photo_key} size="lg" />
        <div className={css.pfWho}>
          <strong className={css.pfName}>{p.full_name || p.name}</strong>
          <span className={css.pfTitle} data-testid="portfolio-title">{p.title || L("No position on the record", "Tiada jawatan pada rekod")}</span>
          <span className="erp-meta">{[p.department, p.staff_id].filter(Boolean).join(" · ") || "—"}</span>
          {p.role_title && p.position && <span className="erp-meta">{p.role_title}</span>}
        </div>
      </div>
      {p.responsibilities.length === 0 ? <p className={`erp-meta ${css.empty}`}>{L("No responsibilities written yet.", "Belum ada tanggungjawab ditulis.")}</p> : (
        <>
          <p className={css.eyebrow}>{expanded ? L("Responsibilities", "Tanggungjawab") : L("Key responsibilities", "Tanggungjawab utama")}</p>
          <ol className={css.list} data-testid={expanded ? "portfolio-all" : "portfolio-key"}>
            {(expanded ? p.responsibilities : p.key).map((t, i) => (
              <li key={`${i}-${t}`} className={css.item}>{t}{expanded && pub.has(t) && <span className={`${chipNeutral} ${css.flag}`}>{L("Public", "Awam")}</span>}</li>
            ))}
          </ol>
          {(more > 0 || expanded) && (
            <button type="button" className={btnSm} onClick={() => setExpanded((v) => !v)} data-testid="portfolio-more">
              <AppIcon name="expand" className={expanded ? css.flip : undefined} />{expanded ? L("Show key only", "Utama sahaja") : L(`View all ${p.responsibilities.length}`, `Lihat semua ${p.responsibilities.length}`)}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** The portfolio in a drawer - the eye on Departments & Roles, and View more. */
export function PortfolioDrawer({ userId, expanded, onClose, onEdit }: { userId: number | null; expanded?: boolean; onClose: () => void; onEdit?: () => void }) {
  return (
    <SideDrawer open={userId !== null} onClose={onClose} icon="person" title={L("Staff portfolio", "Portfolio kakitangan")}
      subtitle={L("Read from the staff record - change the record and this follows.", "Dibaca daripada rekod kakitangan - ubah rekod dan ini akan mengikut.")}
      footer={onEdit ? (
        <DrawerFoot>
          <button type="button" className={btnSm} onClick={onClose}>{L("Close", "Tutup")}</button>
          <button type="button" className={btnSmPrimary} onClick={onEdit} data-testid="portfolio-edit"><AppIcon name="edit" />{L("Edit responsibilities", "Sunting tanggungjawab")}</button>
        </DrawerFoot>
      ) : undefined}>
      {userId !== null && <PortfolioCard key={`${userId}-${expanded ? 1 : 0}`} userId={userId} expanded={expanded} />}
    </SideDrawer>
  );
}

/** the key responsibilities of a row in a list, as one line (Departments & Roles) */
export function keySummary(v: Responsibilities): { line: string; total: number } {
  const items: RespItem[] = v.responsibility_items?.length ? v.responsibility_items : responsibilityLines(v.responsibilities).map((text) => ({ text, is_key: 0, is_public: 0 }));
  return { line: keyResponsibilities(items).join(", "), total: items.length };
}
