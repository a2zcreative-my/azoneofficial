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
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { api, type ApiResult } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { dmyMYT } from "@/lib/format";
import { btnClass, btnGhost, btnSm, card, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClass, td, th, tdR2, thR2 } from "@/lib/ui-styles";
import {
  CARD_TYPES, LIMITS, TYPE_LABEL, aspectLabel, checkCategory, checkFormat, orientationOf, requiredCount, safeArea, sizeLabel,
  type CardCategory, type CardFormat, type CardPage, type CardType, type Problems,
} from "@/lib/card-rules";
import css from "./digital-cards.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
const nameOf = (r: { name: string; name_ms: string | null }) => (getLang() === "ms" && r.name_ms ? r.name_ms : r.name);
const pageTitle = (p: CardPage) => (getLang() === "ms" && p.title_ms ? p.title_ms : p.title);

interface Rules { formats: CardFormat[]; categories: CardCategory[]; can_edit: boolean }
type View = "guidelines" | "rules";

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

export function DigitalCardsPage({ initialView }: { role: string; initialView?: string }) {
  const rules = useRules();
  const [view, setView] = useState<View>(initialView === "rules" ? "rules" : "guidelines");
  const [seen, setSeen] = useState<Record<string, boolean>>({ [view]: true });
  const open = (v: View) => { setView(v); setSeen((s) => (s[v] ? s : { ...s, [v]: true })); };
  const [editing, setEditing] = useState<{ kind: "format"; row: CardFormat | null } | { kind: "category"; row: CardCategory | null } | null>(null);
  const [history, setHistory] = useState<{ entity: "format" | "category"; id: number; name: string } | null>(null);
  const toast = useSaveToast();
  const canEdit = rules.data?.can_edit === true;

  const views: (readonly [View, string])[] = [["guidelines", L("Guidelines", "Garis Panduan")], ["rules", L("Card Rules", "Peraturan Kad")]];
  return (
    <TabPage>
      <LineTabs value={view} onChange={open} label={L("Digital Cards views", "Paparan Kad Digital")} testid="dc-view" tabs={views}
        aside={canEdit && view === "rules" ? (
          <TabAside>
            <TabAction icon="add" onClick={() => setEditing({ kind: "format", row: null })}>{L("Add format", "Tambah format")}</TabAction>
          </TabAside>
        ) : undefined} />
      {!rules.data ? (
        rules.error ? (
          <section className={`${card} ${css.card}`} role="alert" data-testid="dc-error">
            <p className={css.lead}><AppIcon name="warning" /> {rules.error}</p>
            <button type="button" className={btnSm} onClick={() => void rules.load()}><AppIcon name="refresh" /> {L("Try again", "Cuba lagi")}</button>
          </section>
        ) : <section className={`${card} ${css.card}`}><SkelRows rows={5} /></section>
      ) : (
        <>
          <div hidden={view !== "guidelines"}>{seen.guidelines && <Guidelines rules={rules.data} />}</div>
          <div hidden={view !== "rules"}>
            {seen.rules && <RulesView rules={rules.data} onEdit={setEditing} onHistory={setHistory} />}
          </div>
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
      {toast.node}
    </TabPage>
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
