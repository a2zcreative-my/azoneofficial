"use client";

/* v1.391.0 - DIGITAL CARDS, Stage 2 (the CEO 20-11-2026, the Digital Card Template Studio
   brief; Stage 0 audit decisions D1-D9). Two views over GET /staff/card-rules:

   - Guidelines: the canvas of each format drawn to scale with its safe area and margins,
     the technical requirements, a blank layout to download (made in the browser from the
     same numbers, at the full canvas size), the pages per category, and correct vs
     incorrect artwork. Every figure is read from the rules - nothing is typed here.
   - Card Rules: the formats and categories themselves, edited in a drawer by
     card_format_admin (the CEO and the super admin). A save names a reason and the version
     it started from; a stale save is refused by the server, never overwritten.

   lib/card-rules.ts is the one copy of the arithmetic and the checks: the safe area drawn
   here is the safe area the server will enforce on every uploaded page. Digital cards are
   for screens, so DPI is never a rule (D9). Templates, review and publishing are later
   stages; this tab is drawn only for card_format_admin until then (lib/portal-tabs.ts). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { PillSwitch } from "@/components/ui/panel";
import { AppIcon } from "@/components/ui/app-icon";
import { DrawerFoot, DrawerForm, DrawerPanel, SideDrawer } from "@/components/ui/side-drawer";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { useCachedApi } from "@/lib/cached-api";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { api, type ApiResult } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { dmyMYT } from "@/lib/format";
import { btnClass, btnGhost, btnSm, card, chipSmDanger, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClass, inputClassSm, selectClass, selectClassSm, td, th, tdR2, thR2 } from "@/lib/ui-styles";
import { LANGUAGES, PACKAGES, TEMPLATE_LIMITS, checkTemplateInfo, type TemplateLanguage, type TemplatePackage, type TemplateState } from "@/lib/card-templates";
import {
  CARD_TYPES, LIMITS, TYPE_LABEL, aspectLabel, checkCategory, checkFormat, orientationOf, requiredCount, safeArea, sizeLabel,
  type CardCategory, type CardFormat, type CardPage, type CardType, type Problems,
} from "@/lib/card-rules";
import css from "./digital-cards.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const nameOf = (r: { name: string; name_ms: string | null }) => (getLang() === "ms" && r.name_ms ? r.name_ms : r.name);
const pageTitle = (p: CardPage) => (getLang() === "ms" && p.title_ms ? p.title_ms : p.title);

interface Rules { formats: CardFormat[]; categories: CardCategory[]; can_edit: boolean }
type View = "templates" | "mine" | "review" | "published" | "guidelines" | "rules";
const VIEWS: readonly View[] = ["templates", "mine", "review", "published", "guidelines", "rules"];

/** the rules, read once and re-read after a save; the server's own message on a refusal */
function useRules() {
  const [data, setData] = useState<Rules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Rules & { error?: { message?: string } }>("/staff/card-rules");
    if (r.ok && r.data) { setData(r.data); setError(null); }
    else setError(r.data?.error?.message ?? (r.status === 0 ? L("No connection - try again.", "Tiada sambungan - cuba lagi.") : L("The card rules could not be read.", "Peraturan kad tidak dapat dibaca.")));
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load, setData };
}

/* v1.392.0 - Stage 3: the template master records (worker/src/card-templates.ts, 0222) */
interface Template {
  id: number; code: string; name: string; description: string | null; category_id: number; format_id: number;
  language: TemplateLanguage; packages: TemplatePackage[]; state: TemplateState; version: number; published_version: number | null;
  designer_id: number; designer_name: string | null; created_at: string; updated_at: string;
  category_name: string | null; category_name_ms: string | null; format_name: string | null; format_name_ms: string | null;
  width_px: number | null; height_px: number | null; mine: boolean; can_edit: boolean;
}
interface Summary { total: number; drafts: number; in_review: number; published: number; mine: number; can_create: boolean }
const STATE_LABEL: Record<TemplateState, () => string> = {
  draft: () => L("Draft", "Draf"), in_review: () => L("Pending review", "Menunggu semakan"), returned: () => L("Returned", "Dikembalikan"),
  published: () => L("Published", "Diterbitkan"), unpublished: () => L("Unpublished", "Ditarik balik"), archived: () => L("Archived", "Diarkib"),
};
const STATE_CHIP: Record<TemplateState, string> = {
  draft: chipSmNeutral, in_review: chipSmWarn, returned: chipSmDanger, published: chipSmSuccess, unpublished: chipSmNeutral, archived: chipSmNeutral,
};
const PACKAGE_LABEL: Record<TemplatePackage, string> = { silver: "Silver", gold: "Gold", diamond: "Diamond" };
const LANG_LABEL: Record<TemplateLanguage, () => string> = { en: () => "English", ms: () => "Bahasa Melayu", both: () => L("English and BM", "Inggeris dan BM") };
const catName = (t: Template) => (getLang() === "ms" && t.category_name_ms ? t.category_name_ms : t.category_name) ?? "—";
const fmtName = (t: Template) => `${(getLang() === "ms" && t.format_name_ms ? t.format_name_ms : t.format_name) ?? "—"}${t.width_px ? ` · ${t.width_px} × ${t.height_px}` : ""}`;

export function DigitalCardsPage({ initialView }: { role: string; initialView?: string }) {
  const rules = useRules();
  const [view, setView] = useState<View>((VIEWS as readonly string[]).includes(initialView ?? "") ? (initialView as View) : "templates");
  const [seen, setSeen] = useState<Record<string, boolean>>({ [view]: true });
  const open = (v: View) => { setView(v); setSeen((s) => (s[v] ? s : { ...s, [v]: true })); };
  const [editing, setEditing] = useState<{ kind: "format"; row: CardFormat | null } | { kind: "category"; row: CardCategory | null } | null>(null);
  const [history, setHistory] = useState<{ entity: "format" | "category"; id: number; name: string } | null>(null);
  const [stateFilter, setStateFilter] = useState<"" | "draft">("");
  const [info, setInfo] = useState<{ row: Template | null } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [stamp, setStamp] = useState(0);
  const bump = () => setStamp((n) => n + 1);
  const summary = useCachedApi<Summary>("/staff/card-templates/summary");
  const { refresh: refreshSummary } = summary;
  useEffect(() => { if (stamp) refreshSummary(); }, [stamp, refreshSummary]);
  const toast = useSaveToast();
  const canEdit = rules.data?.can_edit === true;
  const canCreate = summary.data?.can_create === true;
  const s = summary.data;

  const views: (readonly [View, string] | readonly [View, string, number | null | undefined])[] = [
    ["templates", L("Templates", "Templat")],
    ["mine", L("My Drafts", "Draf Saya"), s?.mine || null],
    ["review", L("Pending Review", "Menunggu Semakan"), s?.in_review || null],
    ["published", L("Published", "Diterbitkan")],
    ["guidelines", L("Guidelines", "Garis Panduan")],
    ...(canEdit ? [["rules", L("Card Rules", "Peraturan Kad")] as const] : []),
  ];
  const go = (v: View, f: "" | "draft" = "") => { setStateFilter(f); open(v); };
  return (
    <TabPage>
      <LineTabs value={view} onChange={(v) => go(v)} label={L("Digital Cards views", "Paparan Kad Digital")} testid="dc-view" tabs={views}
        aside={canCreate || (canEdit && view === "rules") ? (
          <TabAside>
            {canEdit && view === "rules"
              ? <TabAction icon="add" onClick={() => setEditing({ kind: "format", row: null })}>{L("Add format", "Tambah format")}</TabAction>
              : <TabAction icon="add" onClick={() => setInfo({ row: null })}>{L("New Template", "Templat Baharu")}</TabAction>}
          </TabAside>
        ) : undefined} />

      <TabZone label={L("Templates at a glance", "Ringkasan templat")}>
        {/* v1.392.0 - THE ONE KPI STRIP (KpiRow / KpiTile), real counts from GET /staff/card-templates/summary;
            each figure opens the list it counts */}
        <KpiRow label={L("Digital card templates", "Templat kad digital")} testid="dc-kpis">
          <KpiTile cell="total" icon="documents" tone="navy" label={L("Total Templates", "Jumlah Templat")} value={s?.total ?? 0} busy={!s}
            onClick={() => go("templates")} pressed={view === "templates" && !stateFilter} />
          <KpiTile cell="drafts" icon="edit" tone="blue" label={L("Drafts", "Draf")} value={s?.drafts ?? 0} busy={!s}
            sub={L("draft or returned", "draf atau dikembalikan")} onClick={() => go("templates", "draft")} pressed={view === "templates" && stateFilter === "draft"} />
          <KpiTile cell="review" icon="pending" tone="gold" label={L("Pending Review", "Menunggu Semakan")} value={s?.in_review ?? 0} busy={!s}
            onClick={() => go("review")} pressed={view === "review"} />
          <KpiTile cell="published" icon="success" tone="green" label={L("Published", "Diterbitkan")} value={s?.published ?? 0} busy={!s}
            sub={L("live on AZ ONE only once confirmed", "di AZ ONE hanya selepas disahkan")} onClick={() => go("published")} pressed={view === "published"} />
        </KpiRow>
        {summary.failed && !s && <p className="erp-error" role="alert">{L("The template figures could not be read.", "Angka templat tidak dapat dibaca.")}</p>}
      </TabZone>

      {(["templates", "mine", "review", "published"] as const).map((v) => (
        <div key={v} hidden={view !== v}>
          {seen[v] && <TemplateList which={v} stamp={stamp} stateFilter={v === "templates" ? stateFilter : ""} onClearFilter={() => setStateFilter("")}
            categories={rules.data?.categories ?? []} onOpen={setOpenId} canCreate={canCreate} onCreate={() => setInfo({ row: null })} />}
        </div>
      ))}

      {(view === "guidelines" || view === "rules") && !rules.data ? (
        rules.error ? (
          <section className={`${card} ${css.card}`} role="alert" data-testid="dc-error">
            <p className={css.lead}><AppIcon name="warning" /> {rules.error}</p>
            <button type="button" className={btnSm} onClick={() => void rules.load()}><AppIcon name="refresh" /> {L("Try again", "Cuba lagi")}</button>
          </section>
        ) : <section className={`${card} ${css.card}`}><SkelRows rows={5} /></section>
      ) : rules.data && (
        <>
          <div hidden={view !== "guidelines"}>{seen.guidelines && <Guidelines rules={rules.data} />}</div>
          {canEdit && <div hidden={view !== "rules"}>{seen.rules && <RulesView rules={rules.data} onEdit={setEditing} onHistory={setHistory} />}</div>}
        </>
      )}

      {editing?.kind === "format" && (
        <FormatDrawer row={editing.row} onClose={() => setEditing(null)}
          onSaved={(r, msg) => { rules.setData(r); setEditing(null); toast.show(msg); }} />
      )}
      {editing?.kind === "category" && (
        <CategoryDrawer row={editing.row} onClose={() => setEditing(null)}
          onSaved={(r, msg) => { rules.setData(r); setEditing(null); toast.show(msg); }} />
      )}
      {history && <HistoryDrawer target={history} onClose={() => setHistory(null)} />}
      {info && rules.data && (
        <TemplateInfoDrawer row={info.row} rules={rules.data} onClose={() => setInfo(null)}
          onSaved={(t, created) => { setInfo(null); bump(); toast.show(created ? L(`${t.name} saved as a draft`, `${t.name} disimpan sebagai draf`) : L(`${t.name} saved`, `${t.name} disimpan`)); if (created) { setOpenId(t.id); go("mine"); } }} />
      )}
      {openId != null && (
        <TemplateDrawer id={openId} stamp={stamp} onClose={() => setOpenId(null)} onEdit={(t) => setInfo({ row: t })}
          onChanged={(msg) => { bump(); toast.show(msg); }} />
      )}
      {toast.node}
    </TabPage>
  );
}

/* ============================== TEMPLATE LISTS ============================== */

function TemplateList({ which, stamp, stateFilter, onClearFilter, categories, onOpen, canCreate, onCreate }: {
  which: "templates" | "mine" | "review" | "published"; stamp: number; stateFilter: "" | "draft"; onClearFilter: () => void;
  categories: CardCategory[]; onOpen: (id: number) => void; canCreate: boolean; onCreate: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [archived, setArchived] = useState(false);
  const apiView = which === "templates" ? "all" : which === "mine" && archived ? "archived" : which;
  const path = `/staff/card-templates?view=${apiView}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}${cat ? `&category=${cat}` : ""}`;
  const list = useCachedApi<{ templates: Template[] }>(path);
  const { refresh } = list;
  useEffect(() => { if (stamp) refresh(); }, [stamp, refresh]);
  const rows = (list.data?.templates ?? []).filter((t) => !stateFilter || t.state === "draft" || t.state === "returned");
  const empty: Record<typeof which, string> = {
    templates: L("No templates yet.", "Belum ada templat."),
    mine: archived ? L("You have no archived drafts.", "Anda tiada draf yang diarkib.") : L("You have no drafts. Start one with New Template.", "Anda tiada draf. Mulakan dengan Templat Baharu."),
    review: L("Nothing is waiting for review.", "Tiada yang menunggu semakan."),
    published: L("No template is published yet.", "Belum ada templat yang diterbitkan."),
  };
  const zone = { templates: L("All templates", "Semua templat"), mine: L("My drafts", "Draf saya"), review: L("Waiting for review", "Menunggu semakan"), published: L("Published templates", "Templat diterbitkan") }[which];
  return (
    <TabZone label={zone}>
      <section className={`${card} ${css.card}`} data-testid={`dc-list-${which}`}>
        <div className={css.toolbar}>
          {which === "templates" && (
            <>
              <input type="search" className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search templates…", "Cari templat…")} aria-label={L("Search templates", "Cari templat")} data-testid="dc-search" />
              <select className={selectClassSm} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={L("Category", "Kategori")} data-testid="dc-filter-category">
                <option value="">{L("All categories", "Semua kategori")}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{nameOf(c)}</option>)}
              </select>
              {stateFilter && <button type="button" className={btnSm} onClick={onClearFilter}>{L("Drafts only", "Draf sahaja")} <AppIcon name="close" /></button>}
            </>
          )}
          {which === "mine" && (
            <PillSwitch value={archived ? "archived" : "open"} onChange={(k) => setArchived(k === "archived")} label={L("Show", "Tunjuk")} testid="dc-mine-switch"
              options={[["open", L("Drafts", "Draf")], ["archived", L("Archived", "Diarkib")]] as const} />
          )}
        </div>
        {!list.data ? (list.failed ? <p className="erp-error" role="alert">{L("The templates could not be read.", "Templat tidak dapat dibaca.")}</p> : <SkelRows rows={4} />)
          : rows.length === 0 ? (
            <div className={css.empty}>
              <p>{empty[which]}</p>
              {canCreate && (which === "mine" || which === "templates") && !archived && <button type="button" className={btnSm} onClick={onCreate}><AppIcon name="add" /> {L("New Template", "Templat Baharu")}</button>}
            </div>
          ) : (
            <>
            <ul className={css.cardList} data-testid="dc-cards">
              {rows.map((t) => (
                <li key={t.id} className={css.cardItem}>
                  <button type="button" className={css.cardBtn} onClick={() => onOpen(t.id)} data-testid={`dc-card-${t.id}`}>
                    <span className={css.thumb} aria-hidden><AppIcon name="document" /></span>
                    <span className={css.tText}>
                      <strong>{t.name}</strong>
                      <small className={css.muted}>{catName(t)} · <span className="erp-nowrap">{fmtName(t)}</span></small>
                      <small className={css.muted}>{t.designer_name ?? "—"}{t.mine ? ` · ${L("you", "anda")}` : ""} · v{t.version}</small>
                    </span>
                    <span className={STATE_CHIP[t.state]}>{STATE_LABEL[t.state]()}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={`erp-table-scroll ${css.tableWrap} ${css.deskTable}`}>
              <table className={css.table}>
                <thead><tr>
                  <th className={th}>{L("Template", "Templat")}</th>
                  <th className={`${th} ${css.cWide}`}>{L("Category", "Kategori")}</th>
                  <th className={`${th} ${css.cWide}`}>{L("Format", "Format")}</th>
                  <th className={`${th} ${css.cWide}`}>{L("Designer", "Pereka")}</th>
                  <th className={th}>{L("Status", "Status")}</th>
                  <th className={`${th} ${css.cWide}`}>{L("Updated", "Dikemas kini")}</th>
                  <th className={th}><span className="erp-sr-only">{L("Open", "Buka")}</span></th>
                </tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} data-testid={`dc-row-${t.id}`}>
                      <td className={td}>
                        <span className={css.tName}><span className={css.thumb} aria-hidden><AppIcon name="document" /></span>
                          <span className={css.tText}><strong>{t.name}</strong><small className={css.muted}>{t.code} · v{t.version}</small></span></span>
                      </td>
                      <td className={`${td} ${css.cWide}`}>{catName(t)}</td>
                      <td className={`${td} ${css.cWide}`}><span className="erp-nowrap">{fmtName(t)}</span></td>
                      <td className={`${td} ${css.cWide}`}>{t.designer_name ?? "—"}{t.mine && <small className={css.muted}> · {L("you", "anda")}</small>}</td>
                      <td className={td}><span className={STATE_CHIP[t.state]}>{STATE_LABEL[t.state]()}</span></td>
                      <td className={`${td} ${css.cWide}`}><small className={css.muted}>{dmyMYT(t.updated_at)}</small></td>
                      <td className={td}><button type="button" className={btnSm} onClick={() => onOpen(t.id)} data-testid={`dc-open-${t.id}`}>{L("Open", "Buka")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
      </section>
    </TabZone>
  );
}

/** one template: its information and its history; the designer edits or archives a draft here */
function TemplateDrawer({ id, stamp, onClose, onEdit, onChanged }: { id: number; stamp: number; onClose: () => void; onEdit: (t: Template) => void; onChanged: (msg: string) => void }) {
  const one = useCachedApi<{ template: Template; events: { id: number; version: number; kind: string; note: string | null; created_at: string; actor_name: string | null }[] }>(`/staff/card-templates/${id}`);
  const { refresh } = one;
  useEffect(() => { if (stamp) refresh(); }, [stamp, refresh]);
  const { prompt, node: promptNode } = usePrompt();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = one.data?.template;
  const act = async (kind: "archive" | "restore") => {
    if (!t) return;
    let reason = "";
    if (kind === "archive") {
      const r = await prompt({ title: L(`Archive ${t.name}?`, `Arkibkan ${t.name}?`), message: L("It leaves your drafts and the figures. Nothing is deleted - you can bring it back from My Drafts → Archived.", "Ia keluar dari draf dan angka anda. Tiada yang dipadam - anda boleh kembalikannya dari Draf Saya → Diarkib."),
        label: L("Why?", "Kenapa?"), required: true, confirmLabel: L("Archive", "Arkibkan"), variant: "danger" });
      if (!r) return;
      reason = r.value;
    }
    setBusy(true); setError(null);
    const r = kind === "archive"
      ? await api<{ template?: Template; error?: { message?: string } }>(`/staff/card-templates/${t.id}/archive`, { method: "POST", body: JSON.stringify({ version: t.version, reason }) })
      : await api<{ template?: Template; error?: { message?: string } }>(`/staff/card-templates/${t.id}/restore`, { method: "POST", body: JSON.stringify({ version: t.version }) });
    setBusy(false);
    if (r.ok) { refresh(); onChanged(kind === "archive" ? L(`${t.name} archived`, `${t.name} diarkibkan`) : L(`${t.name} is a draft again`, `${t.name} menjadi draf semula`)); }
    else setError(r.data?.error?.message ?? L("Not saved - try again.", "Tidak disimpan - cuba lagi."));
  };
  const eventText = (k: string) => ({ created: L("Created", "Dicipta"), edited: L("Information changed", "Maklumat diubah"), archived: L("Archived", "Diarkibkan"), restored: L("Brought back as a draft", "Dikembalikan sebagai draf") }[k] ?? k);
  return (
    <SideDrawer open onClose={onClose} title={t?.name ?? L("Template", "Templat")} subtitle={t ? `${t.code} · v${t.version}` : undefined}
      footer={t && (t.can_edit || (t.mine && t.state === "archived")) ? (
        <div className={css.rowActions}>
          {t.can_edit && <button type="button" className={btnClass} onClick={() => onEdit(t)} disabled={busy} data-testid="dc-t-edit"><AppIcon name="edit" /> {L("Edit information", "Sunting maklumat")}</button>}
          {t.can_edit && <button type="button" className={btnGhost} onClick={() => void act("archive")} disabled={busy} data-testid="dc-t-archive">{L("Archive", "Arkibkan")}</button>}
          {t.mine && t.state === "archived" && <button type="button" className={btnClass} onClick={() => void act("restore")} disabled={busy} data-testid="dc-t-restore">{L("Bring back as a draft", "Kembalikan sebagai draf")}</button>}
        </div>
      ) : undefined}>
      {!one.data ? (one.failed ? <p className="erp-error" role="alert">{L("The template could not be read.", "Templat tidak dapat dibaca.")}</p> : <SkelRows rows={5} />) : t && (
        <div className={css.drawerBody} data-testid="dc-template">
          <p><span className={STATE_CHIP[t.state]}>{STATE_LABEL[t.state]()}</span></p>
          <dl className={css.facts}>
            <div><dt>{L("Category", "Kategori")}</dt><dd>{catName(t)}</dd></div>
            <div><dt>{L("Format", "Format")}</dt><dd>{fmtName(t)}</dd></div>
            <div><dt>{L("Language", "Bahasa")}</dt><dd>{LANG_LABEL[t.language]()}</dd></div>
            <div><dt>{L("Packages", "Pakej")}</dt><dd>{t.packages.map((p) => PACKAGE_LABEL[p]).join(", ")}</dd></div>
            <div><dt>{L("Designer", "Pereka")}</dt><dd>{t.designer_name ?? "—"}</dd></div>
            <div><dt>{L("Description", "Penerangan")}</dt><dd>{t.description ?? <span className={css.muted}>—</span>}</dd></div>
          </dl>
          {error && <p className="erp-error" role="alert">{error}</p>}
          <h3 className={css.subhead}>{L("History", "Sejarah")}</h3>
          <ol className={css.history}>
            {one.data.events.map((e) => (
              <li key={e.id}><strong>{eventText(e.kind)}</strong> <small className={css.muted}>v{e.version} · {dmyMYT(e.created_at)}{e.actor_name ? ` · ${e.actor_name}` : ""}</small>
                {e.note && <p className={css.reason}>“{e.note}”</p>}</li>
            ))}
          </ol>
        </div>
      )}
      {promptNode}
    </SideDrawer>
  );
}

/** New Template / Edit information: the template's information, checked by lib/card-templates.ts as the server checks it */
function TemplateInfoDrawer({ row, rules, onClose, onSaved }: { row: Template | null; rules: Rules; onClose: () => void; onSaved: (t: Template, created: boolean) => void }) {
  const cats = rules.categories.filter((c) => c.active || c.id === row?.category_id);
  const fmts = rules.formats.filter((f) => f.active || f.id === row?.format_id);
  const [f, setF] = useState({
    name: row?.name ?? "", description: row?.description ?? "",
    category_id: String(row?.category_id ?? cats.find((c) => c.active)?.id ?? ""), format_id: String(row?.format_id ?? fmts.find((x) => x.active)?.id ?? ""),
    language: (row?.language ?? "both") as TemplateLanguage, packages: (row?.packages ?? [...PACKAGES]) as TemplatePackage[],
  });
  const [server, setServer] = useState<{ error: string | null; fields: Record<string, string> }>({ error: null, fields: {} });
  const [busy, setBusy] = useState(false);
  const active = { categories: rules.categories.filter((c) => c.active).map((c) => c.id), formats: rules.formats.filter((x) => x.active).map((x) => x.id) };
  const local = checkTemplateInfo(f, active).problems;
  const problems = { ...local, ...server.fields };
  const fmt = rules.formats.find((x) => String(x.id) === f.format_id);
  const cat = rules.categories.find((c) => String(c.id) === f.category_id);
  const save = async () => {
    setBusy(true);
    const payload = JSON.stringify({ ...f, category_id: Number(f.category_id), format_id: Number(f.format_id), version: row?.version });
    const r = row
      ? await api<{ template?: Template; error?: { message?: string; fields?: Record<string, string> } }>(`/staff/card-templates/${row.id}`, { method: "PUT", body: payload })
      : await api<{ template?: Template; error?: { message?: string; fields?: Record<string, string> } }>("/staff/card-templates", { method: "POST", body: payload });
    setBusy(false);
    if (r.ok && r.data?.template) onSaved(r.data.template, !row);
    else setServer({ error: r.data?.error?.message ?? L("Not saved - check your connection and try again.", "Tidak disimpan - semak sambungan dan cuba lagi."), fields: r.data?.error?.fields ?? {} });
  };
  const ready = !Object.keys(local).length && !busy;
  return (
    <SideDrawer open onClose={onClose} form icon="document" dirty="auto"
      title={row ? L(`Edit information: ${row.name}`, `Sunting maklumat: ${row.name}`) : L("New Template", "Templat Baharu")}
      subtitle={row ? L(`Version ${row.version}`, `Versi ${row.version}`) : L("Template information - saved as your draft", "Maklumat templat - disimpan sebagai draf anda")}>
      <DrawerForm testid="dc-info-form" aside={fmt || cat ? (
        <DrawerPanel icon="info" title={L("What this design needs", "Keperluan reka bentuk ini")} sub={L("From Guidelines", "Dari Garis Panduan")}>
          <dl className={css.facts}>
            {fmt && <div><dt>{L("Canvas", "Kanvas")}</dt><dd>{fmt.width_px} × {fmt.height_px} px · {aspectLabel(fmt.width_px, fmt.height_px)}</dd></div>}
            {fmt && <div><dt>{L("Safe area", "Kawasan selamat")}</dt><dd>{safeArea(fmt).w} × {safeArea(fmt).h} px</dd></div>}
            {fmt && <div><dt>{L("Files", "Fail")}</dt><dd>{fmt.accepted_types.map((x) => TYPE_LABEL[x]).join(", ")} · {sizeLabel(fmt.max_bytes)}</dd></div>}
            {cat && <div><dt>{L("Pages", "Halaman")}</dt><dd>{cat.min_pages}–{cat.max_pages}</dd></div>}
          </dl>
          {cat && <PageChips pages={cat.pages} />}
        </DrawerPanel>
      ) : undefined}>
        <label className="erp-field"><span className="erp-label" data-required="">{L("Template name", "Nama templat")}</span>
          <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={TEMPLATE_LIMITS.name} data-testid="dc-i-name"
            placeholder={L("e.g. Elegant Navy Wedding", "cth. Perkahwinan Biru Laut Elegan")} /><Err p={problems} k="name" /></label>
        <label className="erp-field"><span className="erp-label">{L("Description", "Penerangan")}</span>
          <textarea className="erp-input erp-textarea" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={TEMPLATE_LIMITS.description} data-testid="dc-i-desc" />
          <Err p={problems} k="description" /></label>
        <div className="erp-field-row">
          <label className="erp-field"><span className="erp-label" data-required="">{L("Category", "Kategori")}</span>
            <select className={selectClass} value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })} data-testid="dc-i-category">
              {cats.map((c) => <option key={c.id} value={c.id} disabled={!c.active}>{nameOf(c)}</option>)}
            </select><Err p={problems} k="category_id" /></label>
          <label className="erp-field"><span className="erp-label" data-required="">{L("Format", "Format")}</span>
            <select className={selectClass} value={f.format_id} onChange={(e) => setF({ ...f, format_id: e.target.value })} data-testid="dc-i-format">
              {fmts.map((x) => <option key={x.id} value={x.id} disabled={!x.active}>{nameOf(x)} · {x.width_px} × {x.height_px}</option>)}
            </select><Err p={problems} k="format_id" /></label>
        </div>
        <label className="erp-field"><span className="erp-label" data-required="">{L("Language on the card", "Bahasa pada kad")}</span>
          <select className={selectClass} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as TemplateLanguage })} data-testid="dc-i-language">
            {LANGUAGES.map((x) => <option key={x} value={x}>{LANG_LABEL[x]()}</option>)}
          </select><Err p={problems} k="language" /></label>
        <fieldset className={`erp-field ${css.fieldset}`}>
          <legend className="erp-label" data-required="">{L("Offered under the AZ ONE packages", "Ditawarkan di bawah pakej AZ ONE")}</legend>
          <div className={css.checks}>
            {PACKAGES.map((x) => (
              <label key={x} className="erp-flex"><input type="checkbox" className="erp-check" checked={f.packages.includes(x)} data-testid={`dc-i-pkg-${x}`}
                onChange={(e) => setF({ ...f, packages: e.target.checked ? [...f.packages, x] : f.packages.filter((y) => y !== x) })} /> {PACKAGE_LABEL[x]}</label>
            ))}
          </div>
          <Err p={problems} k="packages" />
        </fieldset>
        <p className="erp-help">{L(`Designer: you. ${row ? "" : "The template is saved as your draft; only you can change it."}`, `Pereka: anda. ${row ? "" : "Templat disimpan sebagai draf anda; hanya anda boleh mengubahnya."}`)}</p>
        {server.error && <p className="erp-error" role="alert" data-testid="dc-info-error">{server.error}</p>}
        <DrawerFoot testid="dc-info-actions">
          <button type="button" className={btnGhost} onClick={onClose}>{L("Cancel", "Batal")}</button>
          <button type="button" className={btnClass} disabled={!ready} onClick={() => void save()} data-testid="dc-info-save">{busy ? L("Saving…", "Menyimpan…") : row ? L("Save", "Simpan") : L("Save draft", "Simpan draf")}</button>
        </DrawerFoot>
      </DrawerForm>
    </SideDrawer>
  );
}

/* ================================ GUIDELINES ================================ */

function Guidelines({ rules }: { rules: Rules }) {
  const formats = rules.formats.filter((f) => f.active);
  const categories = rules.categories.filter((c) => c.active);
  const [code, setCode] = useState(formats[0]?.code ?? "");
  const f = formats.find((x) => x.code === code) ?? formats[0];
  if (!f) return <section className={`${card} ${css.card}`}><p className={css.lead}>{L("No card format is switched on. Turn one on in Card Rules.", "Tiada format kad dihidupkan. Hidupkan satu dalam Peraturan Kad.")}</p></section>;
  return (
    <>
      <TabZone label={L("Card size & format", "Saiz & format kad")} hint={L("Every page of a template is uploaded at exactly this canvas size. One design works on phones, tablets and desktops - the card is scaled, never stretched or cropped.", "Setiap halaman templat dimuat naik tepat pada saiz kanvas ini. Satu reka bentuk berfungsi pada telefon, tablet dan desktop - kad diskalakan, tidak diregang atau dipotong.")}>
        <section className={`${card} ${css.card}`} data-testid="dc-format">
          <div className={css.formatHead}>
            <PillSwitch value={f.code} onChange={setCode} label={L("Card format", "Format kad")} testid="dc-format-pick"
              options={formats.map((x) => [x.code, nameOf(x)] as const)} />
          </div>
          <div className={css.formatGrid}>
            <SafeAreaDiagram f={f} />
            <div className={css.formatSide}>
              <ul className={css.legend}>
                <li><span className={`${css.swatch} ${css.swSafe}`} aria-hidden />
                  <span><strong>{L("Safe area", "Kawasan selamat")}</strong> {(() => { const s = safeArea(f); return `${s.w} × ${s.h} px`; })()}<br />
                    <small>{L("Names, dates, text, logos and anything the customer edits go here.", "Nama, tarikh, teks, logo dan apa-apa yang pelanggan sunting di sini.")}</small></span></li>
                <li><span className={`${css.swatch} ${css.swMargin}`} aria-hidden />
                  <span><strong>{L("Margin", "Margin")}</strong> {marginText(f)}<br />
                    <small>{L("Background art may run to the edge here - never put text or logos in it. Phone screens and rounded corners can hide it.", "Seni latar boleh sampai ke tepi di sini - jangan letak teks atau logo. Skrin telefon dan bucu bulat boleh menyembunyikannya.")}</small></span></li>
              </ul>
              <button type="button" className={btnSm} onClick={() => downloadBlankLayout(f)} data-testid="dc-blank">
                <AppIcon name="download" /> {L(`Download blank layout (PNG, ${f.width_px} × ${f.height_px})`, `Muat turun susun atur kosong (PNG, ${f.width_px} × ${f.height_px})`)}
              </button>
            </div>
          </div>
          <Requirements f={f} categories={categories} />
        </section>
      </TabZone>

      <TabZone label={L("Pages per category", "Halaman bagi setiap kategori")} hint={L("The first page is always the Cover and always required. A template may not miss a required page.", "Halaman pertama sentiasa Muka depan dan sentiasa wajib. Templat tidak boleh tertinggal halaman wajib.")}>
        <section className={`${card} ${css.card}`} data-testid="dc-categories">
          <ul className={css.catList}>
            {categories.map((c) => (
              <li key={c.id} className={css.catItem} data-testid={`dc-cat-${c.code}`}>
                <span className={css.catHead}><strong>{nameOf(c)}</strong>
                  <span className={css.muted}>{c.min_pages === c.max_pages ? L(`${c.min_pages} pages`, `${c.min_pages} halaman`) : L(`${c.min_pages}–${c.max_pages} pages`, `${c.min_pages}–${c.max_pages} halaman`)}</span></span>
                <PageChips pages={c.pages} />
              </li>
            ))}
          </ul>
        </section>
      </TabZone>

      <TabZone label={L("Correct and incorrect artwork", "Reka bentuk yang betul dan salah")}>
        <section className={`${card} ${css.card}`} data-testid="dc-examples">
          <ul className={css.examples}>
            <Example ok title={L("Background art only", "Seni latar sahaja")}
              text={L("Leave clear space where the names and dates will sit; the portal draws them as editable fields.", "Tinggalkan ruang kosong untuk nama dan tarikh; portal melukisnya sebagai medan boleh sunting.")} kind="good" />
            <Example title={L("Names or dates in the image", "Nama atau tarikh dalam imej")}
              text={L("Text baked into the artwork can never be changed by the customer. It is refused at review.", "Teks dalam reka bentuk tidak boleh diubah oleh pelanggan. Ia ditolak semasa semakan.")} kind="baked" />
            <Example title={L("Content in the margin", "Kandungan dalam margin")}
              text={L("Logos, text or faces outside the safe area may be cut off on a phone.", "Logo, teks atau wajah di luar kawasan selamat mungkin terpotong pada telefon.")} kind="margin" />
            <Example title={L("Wrong size or stretched", "Saiz salah atau diregang")}
              text={L(`Upload exactly ${f.width_px} × ${f.height_px} px. A different size is refused, never resized.`, `Muat naik tepat ${f.width_px} × ${f.height_px} px. Saiz lain ditolak, tidak diubah saiz.`)} kind="stretch" />
          </ul>
        </section>
      </TabZone>
    </>
  );
}

const marginText = (f: CardFormat) => {
  const m = [f.margin_top, f.margin_right, f.margin_bottom, f.margin_left];
  return m.every((x) => x === m[0]) ? L(`${m[0]} px on every side`, `${m[0]} px pada setiap sisi`)
    : L(`top ${f.margin_top} · right ${f.margin_right} · bottom ${f.margin_bottom} · left ${f.margin_left} px`, `atas ${f.margin_top} · kanan ${f.margin_right} · bawah ${f.margin_bottom} · kiri ${f.margin_left} px`);
};

/** the canvas to scale: margin band, safe area, the measurements on it */
function SafeAreaDiagram({ f }: { f: CardFormat }) {
  const s = safeArea(f);
  const pad = Math.max(f.width_px, f.height_px) * 0.09;
  const fs = Math.max(f.width_px, f.height_px) * 0.028;
  return (
    <figure className={css.diagram} data-testid="dc-diagram">
      <svg viewBox={`${-pad} ${-pad} ${f.width_px + pad * 2} ${f.height_px + pad * 2}`} role="img"
        aria-label={L(`${f.width_px} by ${f.height_px} pixel canvas with a ${s.w} by ${s.h} pixel safe area`, `Kanvas ${f.width_px} kali ${f.height_px} piksel dengan kawasan selamat ${s.w} kali ${s.h} piksel`)}>
        <rect x={0} y={0} width={f.width_px} height={f.height_px} className={css.dMargin} />
        <rect x={s.x} y={s.y} width={s.w} height={s.h} className={css.dSafe} />
        <text x={f.width_px / 2} y={-pad * 0.35} className={css.dText} fontSize={fs} textAnchor="middle">{f.width_px} px</text>
        <text x={-pad * 0.35} y={f.height_px / 2} className={css.dText} fontSize={fs} textAnchor="middle" transform={`rotate(-90 ${-pad * 0.35} ${f.height_px / 2})`}>{f.height_px} px</text>
        <text x={f.width_px / 2} y={s.y + s.h / 2 - fs * 0.4} className={css.dStrong} fontSize={fs * 1.2} textAnchor="middle">{L("Safe area", "Kawasan selamat")}</text>
        <text x={f.width_px / 2} y={s.y + s.h / 2 + fs * 1.1} className={css.dText} fontSize={fs} textAnchor="middle">{s.w} × {s.h} px</text>
        {f.margin_top > 0 && <text x={f.width_px / 2} y={Math.max(fs, f.margin_top / 2 + fs * 0.35)} className={css.dSmall} fontSize={fs * 0.8} textAnchor="middle">{f.margin_top}</text>}
        {f.margin_bottom > 0 && <text x={f.width_px / 2} y={f.height_px - f.margin_bottom / 2 + fs * 0.3} className={css.dSmall} fontSize={fs * 0.8} textAnchor="middle">{f.margin_bottom}</text>}
      </svg>
      <figcaption className={css.caption}>{nameOf(f)} · {f.width_px} × {f.height_px} px · {aspectLabel(f.width_px, f.height_px)}</figcaption>
    </figure>
  );
}

function Requirements({ f, categories }: { f: CardFormat; categories: CardCategory[] }) {
  const lo = categories.length ? Math.min(...categories.map((c) => c.min_pages)) : LIMITS.pages[0];
  const hi = categories.length ? Math.max(...categories.map((c) => c.max_pages)) : LIMITS.pages[1];
  const rows: [string, string][] = [
    [L("Canvas", "Kanvas"), `${f.width_px} × ${f.height_px} px (${aspectLabel(f.width_px, f.height_px)}, ${orientationOf(f.width_px, f.height_px) === "portrait" ? L("portrait", "potret") : orientationOf(f.width_px, f.height_px) === "landscape" ? L("landscape", "landskap") : L("square", "segi empat sama")})`],
    [L("File type", "Jenis fail"), f.accepted_types.map((t) => TYPE_LABEL[t]).join(", ")],
    [L("Largest file", "Fail terbesar"), L(`${sizeLabel(f.max_bytes)} per page`, `${sizeLabel(f.max_bytes)} setiap halaman`)],
    [L("Safe area", "Kawasan selamat"), `${safeArea(f).w} × ${safeArea(f).h} px · ${marginText(f)}`],
    [L("Colour", "Warna"), L("RGB (sRGB). CMYK print files are refused.", "RGB (sRGB). Fail cetakan CMYK ditolak.")],
    [L("Pages", "Halaman"), L(`${lo} to ${hi} per card, by category (below)`, `${lo} hingga ${hi} setiap kad, ikut kategori (di bawah)`)],
    [L("Resolution", "Resolusi"), L("Pixels only - DPI is not checked for screen cards.", "Piksel sahaja - DPI tidak disemak untuk kad skrin.")],
  ];
  return (
    <dl className={css.reqs} data-testid="dc-requirements">
      <dt className={css.reqHead}>{L("Technical requirements", "Keperluan teknikal")}</dt>
      {rows.map(([k, v]) => (
        <div key={k} className={css.req}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}

function PageChips({ pages }: { pages: CardPage[] }) {
  return (
    <ol className={css.pages}>
      {pages.map((p, i) => (
        <li key={i}><span className={css.pageNo}>{i + 1}</span> {pageTitle(p)}{" "}
          <span className={p.required ? chipSmWarn : chipSmNeutral}>{p.required ? L("Required", "Wajib") : L("Optional", "Pilihan")}</span></li>
      ))}
    </ol>
  );
}

function Example({ ok = false, title, text, kind }: { ok?: boolean; title: string; text: string; kind: "good" | "baked" | "margin" | "stretch" }) {
  return (
    <li className={css.example} data-ok={ok ? "" : undefined}>
      <svg viewBox="0 0 90 160" className={css.exArt} aria-hidden>
        <rect x={kind === "stretch" ? -10 : 0} y={0} width={kind === "stretch" ? 110 : 90} height={160} rx={6} className={css.exPaper} />
        <rect x={6} y={6} width={78} height={148} rx={3} className={css.exSafe} />
        <circle cx={kind === "stretch" ? 12 : 14} cy={18} r={kind === "stretch" ? 14 : 10} className={css.exArtShape} />
        <circle cx={kind === "stretch" ? 80 : 76} cy={142} r={kind === "stretch" ? 14 : 10} className={css.exArtShape} />
        {kind === "good" && <rect x={20} y={60} width={50} height={36} rx={3} className={css.exZone} />}
        {kind === "baked" && <><rect x={20} y={64} width={50} height={7} rx={2} className={css.exInk} /><rect x={26} y={78} width={38} height={6} rx={2} className={css.exInk} /></>}
        {kind === "margin" && <rect x={56} y={1} width={33} height={9} rx={2} className={css.exInk} />}
      </svg>
      <span className={css.exText}>
        <strong className={ok ? css.exOk : css.exBad}><AppIcon name={ok ? "success" : "error"} /> {ok ? L("Correct", "Betul") : L("Incorrect", "Salah")}: {title}</strong>
        <small>{text}</small>
      </span>
    </li>
  );
}

/** the blank layout, drawn at the full canvas size from the same numbers and the theme's own colours */
function downloadBlankLayout(f: CardFormat) {
  const c = document.createElement("canvas");
  c.width = f.width_px; c.height = f.height_px;
  const g = c.getContext("2d");
  if (!g) return;
  const tok = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const s = safeArea(f);
  g.fillStyle = tok("--danger-soft") || tok("--muted"); g.fillRect(0, 0, f.width_px, f.height_px);
  g.fillStyle = tok("--info-soft") || tok("--card"); g.fillRect(s.x, s.y, s.w, s.h);
  g.strokeStyle = tok("--info") || tok("--foreground"); g.lineWidth = 2; g.setLineDash([16, 10]); g.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
  g.setLineDash([]);
  const font = tok("--font-sans") || "sans-serif";
  const base = Math.round(Math.min(f.width_px, f.height_px) * 0.035);
  g.fillStyle = tok("--foreground"); g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `600 ${Math.round(base * 1.4)}px ${font}`; g.fillText(`SAFE AREA ${s.w} × ${s.h} px`, f.width_px / 2, f.height_px / 2 - base);
  g.font = `400 ${base}px ${font}`; g.fillText(`${nameOf(f)} · ${f.width_px} × ${f.height_px} px · ${aspectLabel(f.width_px, f.height_px)}`, f.width_px / 2, f.height_px / 2 + base * 0.6);
  g.fillText(`Margin: ${marginText(f)}`, f.width_px / 2, f.height_px / 2 + base * 2);
  g.fillText("Background art only - names, dates and text are added as fields", f.width_px / 2, f.height_px / 2 + base * 3.4);
  c.toBlob((b) => {
    if (!b) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = `a2z-card-blank-${f.code}-${f.width_px}x${f.height_px}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, "image/png");
}

/* ================================ CARD RULES ================================ */

function RulesView({ rules, onEdit, onHistory }: {
  rules: Rules;
  onEdit: (e: { kind: "format"; row: CardFormat | null } | { kind: "category"; row: CardCategory | null }) => void;
  onHistory: (h: { entity: "format" | "category"; id: number; name: string }) => void;
}) {
  const edit = rules.can_edit;
  const stamp = (r: { updated_at: string | null; updated_by_name?: string | null; version: number }) =>
    r.updated_at ? L(`v${r.version} · ${dmyMYT(r.updated_at)}${r.updated_by_name ? ` · ${r.updated_by_name}` : ""}`, `v${r.version} · ${dmyMYT(r.updated_at)}${r.updated_by_name ? ` · ${r.updated_by_name}` : ""}`) : L("v1 · starting rule", "v1 · peraturan permulaan");
  return (
    <>
      <p className={css.lead}>{edit
        ? L("A change applies to templates uploaded after it. Every save asks for a reason and is kept in the rule's history.", "Perubahan berkuat kuasa untuk templat yang dimuat naik selepasnya. Setiap simpanan meminta sebab dan disimpan dalam sejarah peraturan.")
        : L("Only the CEO and the super admin change these rules.", "Hanya CEO dan pentadbir super mengubah peraturan ini.")}</p>
      <TabZone label={L("Formats", "Format")}>
        <section className={`${card} ${css.card}`} data-testid="dc-rules-formats">
          <div className={`erp-table-scroll ${css.tableWrap}`}>
            <table className={css.table}>
              <thead><tr>
                <th className={th}>{L("Format", "Format")}</th>
                <th className={thR2}>{L("Canvas", "Kanvas")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Safe margin", "Margin selamat")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Files", "Fail")}</th>
                <th className={th}>{L("Status", "Status")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Last change", "Perubahan terakhir")}</th>
                <th className={th}><span className="erp-sr-only">{L("Actions", "Tindakan")}</span></th>
              </tr></thead>
              <tbody>
                {rules.formats.map((f) => (
                  <tr key={f.id} data-testid={`dc-rf-${f.code}`}>
                    <td className={td}><strong>{nameOf(f)}</strong></td>
                    <td className={tdR2}>{f.width_px} × {f.height_px}<br /><small className={css.muted}>{aspectLabel(f.width_px, f.height_px)}</small></td>
                    <td className={`${td} ${css.cWide}`}>{marginText(f)}</td>
                    <td className={`${td} ${css.cWide}`}>{f.accepted_types.map((t) => TYPE_LABEL[t]).join(", ")} · {sizeLabel(f.max_bytes)}</td>
                    <td className={td}><span className={f.active ? chipSmSuccess : chipSmNeutral}>{f.active ? L("On", "Hidup") : L("Off", "Mati")}</span></td>
                    <td className={`${td} ${css.cWide}`}><small className={css.muted}>{stamp(f)}</small></td>
                    <td className={td}><span className={css.rowActions}>
                      {edit && <button type="button" className={btnSm} onClick={() => onEdit({ kind: "format", row: f })} data-testid={`dc-edit-format-${f.code}`}><AppIcon name="edit" /> {L("Edit", "Sunting")}</button>}
                      <button type="button" className={btnSm} onClick={() => onHistory({ entity: "format", id: f.id, name: nameOf(f) })}>{L("History", "Sejarah")}</button>
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </TabZone>
      <TabZone label={L("Pages per category", "Halaman bagi setiap kategori")}>
        <section className={`${card} ${css.card}`} data-testid="dc-rules-categories">
          {edit && <div className={css.zoneHead}><button type="button" className={btnSm} onClick={() => onEdit({ kind: "category", row: null })} data-testid="dc-add-category"><AppIcon name="add" /> {L("Add category", "Tambah kategori")}</button></div>}
          <div className={`erp-table-scroll ${css.tableWrap}`}>
            <table className={css.table}>
              <thead><tr>
                <th className={th}>{L("Category", "Kategori")}</th>
                <th className={thR2}>{L("Pages", "Halaman")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Suggested pages", "Halaman dicadangkan")}</th>
                <th className={th}>{L("Status", "Status")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Last change", "Perubahan terakhir")}</th>
                <th className={th}><span className="erp-sr-only">{L("Actions", "Tindakan")}</span></th>
              </tr></thead>
              <tbody>
                {rules.categories.map((c) => (
                  <tr key={c.id} data-testid={`dc-rc-${c.code}`}>
                    <td className={td}><strong>{nameOf(c)}</strong>{c.allow_reorder && <><br /><small className={css.muted}>{L("pages may be reordered", "halaman boleh disusun semula")}</small></>}</td>
                    <td className={tdR2}>{c.min_pages}–{c.max_pages}<br /><small className={css.muted}>{L(`${requiredCount(c.pages)} required`, `${requiredCount(c.pages)} wajib`)}</small></td>
                    <td className={`${td} ${css.cWide}`}><PageChips pages={c.pages} /></td>
                    <td className={td}><span className={c.active ? chipSmSuccess : chipSmNeutral}>{c.active ? L("On", "Hidup") : L("Off", "Mati")}</span></td>
                    <td className={`${td} ${css.cWide}`}><small className={css.muted}>{stamp(c)}</small></td>
                    <td className={td}><span className={css.rowActions}>
                      {edit && <button type="button" className={btnSm} onClick={() => onEdit({ kind: "category", row: c })} data-testid={`dc-edit-category-${c.code}`}><AppIcon name="edit" /> {L("Edit", "Sunting")}</button>}
                      <button type="button" className={btnSm} onClick={() => onHistory({ entity: "category", id: c.id, name: nameOf(c) })}>{L("History", "Sejarah")}</button>
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </TabZone>
    </>
  );
}

/* ---- the two edit drawers: the same checks as the server, the server's answer wins ---- */

type SaveResult = Rules & { error?: { message?: string; code?: string; fields?: Problems } };
/** the server's answer to a save: the rules again, or its own message and the fields it refused */
async function settle(call: Promise<ApiResult<SaveResult>>): Promise<{ data: Rules | null; error: string | null; fields: Problems }> {
  const r = await call;
  if (r.ok && r.data) return { data: r.data, error: null, fields: {} };
  return { data: null, error: r.data?.error?.message ?? L("Not saved - check your connection and try again.", "Tidak disimpan - semak sambungan dan cuba lagi."), fields: r.data?.error?.fields ?? {} };
}

const Err = ({ p, k }: { p: Problems; k: string }) => (p[k] ? <span className="erp-error">{p[k]}</span> : null);

function ReasonField({ value, onChange, problems }: { value: string; onChange: (v: string) => void; problems: Problems }) {
  return (
    <label className="erp-field">
      <span className="erp-label" data-required="">{L("Reason for this change", "Sebab perubahan ini")}</span>
      <textarea className="erp-input erp-textarea" rows={2} value={value} onChange={(e) => onChange(e.target.value)} data-testid="dc-reason"
        placeholder={L("e.g. confirmed with the design team", "cth. disahkan dengan pasukan reka bentuk")} />
      <span className="erp-help">{L(`At least ${LIMITS.reason} characters. Kept in the rule history.`, `Sekurang-kurangnya ${LIMITS.reason} aksara. Disimpan dalam sejarah peraturan.`)}</span>
      <Err p={problems} k="reason" />
    </label>
  );
}

function FormatDrawer({ row, onClose, onSaved }: { row: CardFormat | null; onClose: () => void; onSaved: (r: Rules, msg: string) => void }) {
  const [f, setF] = useState({
    name: row?.name ?? "", name_ms: row?.name_ms ?? "",
    width_px: String(row?.width_px ?? 1080), height_px: String(row?.height_px ?? 1920),
    margin_top: String(row?.margin_top ?? 40), margin_right: String(row?.margin_right ?? 40), margin_bottom: String(row?.margin_bottom ?? 40), margin_left: String(row?.margin_left ?? 40),
    accepted_types: (row?.accepted_types ?? [...CARD_TYPES]) as CardType[], max_mb: String((row?.max_bytes ?? 10485760) / 1048576),
    sort: String(row?.sort ?? 0), active: row?.active ?? true,
  });
  const [reason, setReason] = useState("");
  const [server, setServer] = useState<{ error: string | null; fields: Problems }>({ error: null, fields: {} });
  const [busy, setBusy] = useState(false);
  const body = useMemo(() => ({ ...f, max_bytes: Math.round(Number(f.max_mb) * 1048576), max_mb: undefined }), [f]);
  const local = checkFormat(body).problems;
  const problems = { ...local, ...server.fields };
  const preview = !local.width_px && !local.height_px ? { ...(row ?? ({} as CardFormat)), ...checkFormat(body).value } as CardFormat : null;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    const payload = JSON.stringify({ ...body, reason, version: row?.version });
    const r = await settle(row ? api<SaveResult>(`/staff/card-rules/formats/${row.id}`, { method: "PUT", body: payload }) : api<SaveResult>("/staff/card-rules/formats", { method: "POST", body: payload }));
    setBusy(false);
    if (r.data) onSaved(r.data, row ? L(`${f.name} saved`, `${f.name} disimpan`) : L(`${f.name} added`, `${f.name} ditambah`));
    else setServer({ error: r.error, fields: r.fields });
  };
  const ready = !Object.keys(local).length && reason.trim().length >= LIMITS.reason && !busy;
  return (
    <SideDrawer open onClose={onClose} form icon="edit" dirty="auto"
      title={row ? L(`Edit format: ${nameOf(row)}`, `Sunting format: ${nameOf(row)}`) : L("Add a card format", "Tambah format kad")}
      subtitle={row ? L(`Version ${row.version}`, `Versi ${row.version}`) : undefined}>
      <DrawerForm testid="dc-format-form" aside={preview ? (
        <DrawerPanel icon="preview" title={L("Safe area preview", "Pratonton kawasan selamat")} sub={`${preview.width_px} × ${preview.height_px} · ${aspectLabel(preview.width_px, preview.height_px)}`}>
          {!local.margin_top && !local.margin_left ? <SafeAreaDiagram f={preview} /> : <p className={css.muted}>{L("Fix the margins to see the preview.", "Betulkan margin untuk melihat pratonton.")}</p>}
        </DrawerPanel>
      ) : undefined}>
        <div className="erp-field-row">
          <label className="erp-field"><span className="erp-label" data-required="">{L("Name", "Nama")}</span>
            <input className={inputClass} value={f.name} onChange={set("name")} maxLength={LIMITS.name} data-testid="dc-f-name" /><Err p={problems} k="name" /></label>
          <label className="erp-field"><span className="erp-label">{L("Name in BM", "Nama dalam BM")}</span>
            <input className={inputClass} value={f.name_ms} onChange={set("name_ms")} maxLength={LIMITS.name} /><Err p={problems} k="name_ms" /></label>
        </div>
        <div className="erp-field-row">
          <label className="erp-field"><span className="erp-label" data-required="">{L("Width (px)", "Lebar (px)")}</span>
            <input className={inputClass} inputMode="numeric" value={f.width_px} onChange={set("width_px")} data-testid="dc-f-width" /><Err p={problems} k="width_px" /></label>
          <label className="erp-field"><span className="erp-label" data-required="">{L("Height (px)", "Tinggi (px)")}</span>
            <input className={inputClass} inputMode="numeric" value={f.height_px} onChange={set("height_px")} data-testid="dc-f-height" /><Err p={problems} k="height_px" /></label>
        </div>
        <fieldset className={`erp-field ${css.fieldset}`}>
          <legend className="erp-label" data-required="">{L("Safe margin (px)", "Margin selamat (px)")}</legend>
          <div className={css.margins}>
            {(["margin_top", "margin_right", "margin_bottom", "margin_left"] as const).map((k) => (
              <label key={k} className="erp-field"><span className="erp-help">{{ margin_top: L("Top", "Atas"), margin_right: L("Right", "Kanan"), margin_bottom: L("Bottom", "Bawah"), margin_left: L("Left", "Kiri") }[k]}</span>
                <input className={inputClass} inputMode="numeric" value={f[k]} onChange={set(k)} data-testid={`dc-f-${k}`} /></label>
            ))}
          </div>
          <Err p={problems} k="margin_top" /><Err p={problems} k="margin_left" />
        </fieldset>
        <fieldset className={`erp-field ${css.fieldset}`}>
          <legend className="erp-label" data-required="">{L("File types", "Jenis fail")}</legend>
          <div className={css.checks}>
            {CARD_TYPES.map((t) => (
              <label key={t} className="erp-flex"><input type="checkbox" className="erp-check" checked={f.accepted_types.includes(t)}
                onChange={(e) => setF({ ...f, accepted_types: e.target.checked ? [...f.accepted_types, t] : f.accepted_types.filter((x) => x !== t) })} /> {TYPE_LABEL[t]}</label>
            ))}
          </div>
          <Err p={problems} k="accepted_types" />
        </fieldset>
        <div className="erp-field-row">
          <label className="erp-field"><span className="erp-label" data-required="">{L("Largest file per page (MB)", "Fail terbesar setiap halaman (MB)")}</span>
            <input className={inputClass} inputMode="decimal" value={f.max_mb} onChange={set("max_mb")} data-testid="dc-f-max" /><Err p={problems} k="max_bytes" /></label>
          <label className="erp-field"><span className="erp-label">{L("Order in lists", "Susunan dalam senarai")}</span>
            <input className={inputClass} inputMode="numeric" value={f.sort} onChange={set("sort")} /></label>
        </div>
        <label className="erp-flex"><input type="checkbox" className="erp-check" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} data-testid="dc-f-active" />
          {L("On - designers can choose this format", "Hidup - pereka boleh memilih format ini")}</label>
        <Err p={problems} k="active" />
        <ReasonField value={reason} onChange={setReason} problems={problems} />
        {server.error && <p className="erp-error" role="alert" data-testid="dc-save-error">{server.error}</p>}
        <DrawerFoot testid="dc-format-actions">
          <button type="button" className={btnGhost} onClick={onClose}>{L("Cancel", "Batal")}</button>
          <button type="button" className={btnClass} disabled={!ready} onClick={() => void save()} data-testid="dc-format-save">{busy ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}</button>
        </DrawerFoot>
      </DrawerForm>
    </SideDrawer>
  );
}

function CategoryDrawer({ row, onClose, onSaved }: { row: CardCategory | null; onClose: () => void; onSaved: (r: Rules, msg: string) => void }) {
  const [f, setF] = useState({
    name: row?.name ?? "", name_ms: row?.name_ms ?? "",
    min_pages: String(row?.min_pages ?? 1), max_pages: String(row?.max_pages ?? 10),
    pages: (row?.pages ?? [{ title: "Cover", title_ms: "Muka depan", required: true }]).map((p) => ({ ...p, title_ms: p.title_ms ?? "" })),
    allow_reorder: row?.allow_reorder ?? true, sort: String(row?.sort ?? 0), active: row?.active ?? true,
  });
  const [reason, setReason] = useState("");
  const [server, setServer] = useState<{ error: string | null; fields: Problems }>({ error: null, fields: {} });
  const [busy, setBusy] = useState(false);
  const local = checkCategory(f).problems;
  const problems = { ...local, ...server.fields };
  const setPage = (i: number, patch: Partial<{ title: string; title_ms: string; required: boolean }>) =>
    setF({ ...f, pages: f.pages.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (i === 0 || j < 1 || j >= f.pages.length) return;
    const pages = [...f.pages]; [pages[i], pages[j]] = [pages[j]!, pages[i]!]; setF({ ...f, pages });
  };
  const save = async () => {
    setBusy(true);
    const payload = JSON.stringify({ ...f, reason, version: row?.version });
    const r = await settle(row ? api<SaveResult>(`/staff/card-rules/categories/${row.id}`, { method: "PUT", body: payload }) : api<SaveResult>("/staff/card-rules/categories", { method: "POST", body: payload }));
    setBusy(false);
    if (r.data) onSaved(r.data, row ? L(`${f.name} saved`, `${f.name} disimpan`) : L(`${f.name} added`, `${f.name} ditambah`));
    else setServer({ error: r.error, fields: r.fields });
  };
  const ready = !Object.keys(local).length && reason.trim().length >= LIMITS.reason && !busy;
  return (
    <SideDrawer open onClose={onClose} form icon="edit" dirty="auto"
      title={row ? L(`Edit category: ${nameOf(row)}`, `Sunting kategori: ${nameOf(row)}`) : L("Add a card category", "Tambah kategori kad")}
      subtitle={row ? L(`Version ${row.version}`, `Versi ${row.version}`) : undefined}>
      <DrawerForm testid="dc-category-form">
        <div className="erp-field-row">
          <label className="erp-field"><span className="erp-label" data-required="">{L("Name", "Nama")}</span>
            <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={LIMITS.name} data-testid="dc-c-name" /><Err p={problems} k="name" /></label>
          <label className="erp-field"><span className="erp-label">{L("Name in BM", "Nama dalam BM")}</span>
            <input className={inputClass} value={f.name_ms} onChange={(e) => setF({ ...f, name_ms: e.target.value })} maxLength={LIMITS.name} /><Err p={problems} k="name_ms" /></label>
        </div>
        <div className="erp-field-row">
          <label className="erp-field"><span className="erp-label" data-required="">{L("Fewest pages", "Halaman paling sedikit")}</span>
            <input className={inputClass} inputMode="numeric" value={f.min_pages} onChange={(e) => setF({ ...f, min_pages: e.target.value })} data-testid="dc-c-min" /><Err p={problems} k="min_pages" /></label>
          <label className="erp-field"><span className="erp-label" data-required="">{L("Most pages", "Halaman paling banyak")}</span>
            <input className={inputClass} inputMode="numeric" value={f.max_pages} onChange={(e) => setF({ ...f, max_pages: e.target.value })} data-testid="dc-c-max" /><Err p={problems} k="max_pages" /></label>
        </div>
        <fieldset className={`erp-field ${css.fieldset}`}>
          <legend className="erp-label" data-required="">{L("Suggested pages, in order", "Halaman dicadangkan, mengikut urutan")}</legend>
          <ol className={css.pageEdit}>
            {f.pages.map((p, i) => (
              <li key={i} className={css.pageRow} data-testid={`dc-c-page-${i}`}>
                <span className={css.pageNo}>{i + 1}</span>
                <input className={inputClass} value={p.title} disabled={i === 0} onChange={(e) => setPage(i, { title: e.target.value })} aria-label={L(`Page ${i + 1} title`, `Tajuk halaman ${i + 1}`)} maxLength={LIMITS.pageTitle} />
                <input className={inputClass} value={p.title_ms} onChange={(e) => setPage(i, { title_ms: e.target.value })} aria-label={L(`Page ${i + 1} title in BM`, `Tajuk halaman ${i + 1} dalam BM`)} placeholder="BM" maxLength={LIMITS.pageTitle} />
                <label className="erp-flex"><input type="checkbox" className="erp-check" checked={p.required} disabled={i === 0} onChange={(e) => setPage(i, { required: e.target.checked })} /> {L("Required", "Wajib")}</label>
                <span className={css.rowActions}>
                  <button type="button" className={btnSm} disabled={i < 2} onClick={() => move(i, -1)} aria-label={L("Move up", "Naik")}><AppIcon name="up" /></button>
                  <button type="button" className={btnSm} disabled={i === 0 || i === f.pages.length - 1} onClick={() => move(i, 1)} aria-label={L("Move down", "Turun")}><AppIcon name="down" /></button>
                  <button type="button" className={btnSm} disabled={i === 0} onClick={() => setF({ ...f, pages: f.pages.filter((_, j) => j !== i) })} aria-label={L("Remove page", "Buang halaman")}><AppIcon name="close" /></button>
                </span>
                <Err p={problems} k={`pages.${i}`} />
              </li>
            ))}
          </ol>
          {f.pages.length < LIMITS.pages[1] && (
            <button type="button" className={btnSm} onClick={() => setF({ ...f, pages: [...f.pages, { title: "", title_ms: "", required: false }] })} data-testid="dc-c-add-page"><AppIcon name="add" /> {L("Add a page", "Tambah halaman")}</button>
          )}
          <span className="erp-help">{L("The Cover is always first and required.", "Muka depan sentiasa pertama dan wajib.")}</span>
          <Err p={problems} k="pages" />
        </fieldset>
        <label className="erp-flex"><input type="checkbox" className="erp-check" checked={f.allow_reorder} onChange={(e) => setF({ ...f, allow_reorder: e.target.checked })} />
          {L("Designers may reorder the pages after the Cover", "Pereka boleh menyusun semula halaman selepas Muka depan")}</label>
        <label className="erp-flex"><input type="checkbox" className="erp-check" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          {L("On - designers can choose this category", "Hidup - pereka boleh memilih kategori ini")}</label>
        <Err p={problems} k="active" />
        <ReasonField value={reason} onChange={setReason} problems={problems} />
        {server.error && <p className="erp-error" role="alert" data-testid="dc-save-error">{server.error}</p>}
        <DrawerFoot testid="dc-category-actions">
          <button type="button" className={btnGhost} onClick={onClose}>{L("Cancel", "Batal")}</button>
          <button type="button" className={btnClass} disabled={!ready} onClick={() => void save()} data-testid="dc-category-save">{busy ? L("Saving…", "Menyimpan…") : L("Save", "Simpan")}</button>
        </DrawerFoot>
      </DrawerForm>
    </SideDrawer>
  );
}

interface HistoryRow { id: number; version: number; reason: string; created_at: string; actor_name: string | null; snapshot: Record<string, unknown> }
function HistoryDrawer({ target, onClose }: { target: { entity: "format" | "category"; id: number; name: string }; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ history: HistoryRow[]; error?: { message?: string } }>(`/staff/card-rules/history?entity=${target.entity}&id=${target.id}`).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setRows(r.data.history); else setError(r.data?.error?.message ?? L("The history could not be read.", "Sejarah tidak dapat dibaca."));
    });
    return () => { live = false; };
  }, [target.entity, target.id]);
  return (
    <SideDrawer open onClose={onClose} title={L(`History: ${target.name}`, `Sejarah: ${target.name}`)} subtitle={L("Every saved version, newest first", "Setiap versi yang disimpan, terbaru dahulu")}>
      {error ? <p className="erp-error" role="alert">{error}</p> : !rows ? <SkelRows rows={4} /> : rows.length === 0 ? (
        <p className={css.lead}>{L("Not changed since the starting rules (version 1).", "Tidak diubah sejak peraturan permulaan (versi 1).")}</p>
      ) : (
        <ol className={css.history} data-testid="dc-history">
          {rows.map((h) => (
            <li key={h.id}>
              <strong>{L(`Version ${h.version}`, `Versi ${h.version}`)}</strong> <small className={css.muted}>{dmyMYT(h.created_at)}{h.actor_name ? ` · ${h.actor_name}` : ""}</small>
              <p className={css.reason}>“{h.reason}”</p>
            </li>
          ))}
        </ol>
      )}
    </SideDrawer>
  );
}
