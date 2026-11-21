"use client";

/* v1.404.0 - THE SALES PLAYBOOK (Sales Command Center Phase 7; the CEO, 21-11-2026, "As recommended" on the nine
   Phase 7 decisions; the layout follows his Sales Playbook reference picture, never its sample words).
   worker/src/playbook.ts is the server; lib/playbook.ts the one copy of the rules.

     - the ten sections down the left (a picker on a phone), the open section in the middle, three short reading
       panels on the right (the first published Discovery Questions, Proposal & Follow-up and Quick Guide lists)
     - staff read ONLY the published version of an entry. The CEO, COO and CCO (playbook_manage) write drafts and
       publish them with a note; every version is kept and an earlier one comes back by being published again
     - Product Knowledge opens with the Packages library, live: name, issuing company, current price. No price is
       ever typed into the Playbook - the server refuses a ringgit amount and an entry links packages instead
     - a deal opens "the Playbook for this stage": the entries tagged with its pipeline stage
     - the Playbook's own search covers every published word; it is not in the portal's search (decision 9) */

import { useState, type ReactNode } from "react";
import { api, csrfFetch } from "@/lib/api";
import { useCachedApi } from "@/lib/cached-api";
import { fmtRM } from "@/lib/format";
import { L } from "@/components/portal/page-shared";
import { PillSwitch } from "@/components/ui/panel";
import { DrawerFoot, DrawerForm, SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { useFeedback } from "@/components/ui/feedback-modal";
import { viewFile } from "@/components/ui/open-file";
import { btnSm, btnSmPrimary, btnSmQuiet, card, chipSmInfo, chipSmNeutral, chipSmWarn, fieldLabel, inputClass, selectClass } from "@/lib/ui-styles";
import { STAGE_WORD } from "@/lib/pipeline-words";
import type { PackageRow } from "@/lib/packages";
import {
  PB_DEFAULT_KIND, PB_FILE_TYPES, PB_KINDS, PB_KIND_WORD, PB_LIMITS, PB_MAX_FILES, PB_SECTIONS, PB_SECTION_HINT, PB_SECTION_WORD, PB_STAGES,
  priceProblem, searchText, type PbKind, type PbPayload, type PbSection, type PbStage,
} from "@/lib/playbook";
import css from "./sales-playbook.module.css";

interface PbFile { id: number; filename: string; content_type: string; size: number | null }
interface Published { version: number; payload: PbPayload | null; note: string | null; published_at: string | null; published_by_name: string | null; files: PbFile[] }
export interface PbEntry {
  id: number; section: PbSection; kind: PbKind; sort: number; published: Published | null;
  /* managers only */
  status?: "draft" | "published" | "archived"; has_draft?: boolean; lock?: number; draft?: PbPayload | null; draft_files?: PbFile[];
  updated_at?: string; updated_by_name?: string | null; archived_at?: string | null; archive_reason?: string | null;
}
interface Data { entries: PbEntry[]; can_manage: boolean; pending_migration?: boolean }
interface Version { version: number; payload: PbPayload | null; files: PbFile[]; note: string; restored_from: number | null; published_at: string; published_by_name: string | null }
type Mode = "published" | "drafts" | "archived";

const w = (p: [string, string]) => L(p[0], p[1]);
const ICON: Record<PbSection, AppIconName> = {
  quick: "fast", product: "package", scripts: "chat", objections: "verify", training: "idea",
  discovery: "search", proposal: "send", closing: "target", practices: "star", sop: "documents",
};
const SHORTCUTS: PbSection[] = ["product", "scripts", "objections", "training"];
const RAIL: [PbSection, PbKind[]][] = [["discovery", ["questions", "checklist"]], ["proposal", ["checklist", "questions"]], ["quick", ["checklist", "questions"]]];
const when = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : "");
const failed = (r: { status: number; data?: { error?: { message?: string } } | null }) =>
  r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.");


export function SalesPlaybook({ stage, onStage, open, onOpened, newTick = 0 }: {
  /** a deal's stage: the entries tagged with it (decision 5); null = the sections */
  stage: PbStage | null; onStage: (s: PbStage | null) => void;
  /** an entry a bell asked for (playbook:<id>) */
  open: number | null; onOpened: () => void;
  /** the view bar's gold New entry (managers): each press opens the form once */
  newTick?: number;
}) {
  const fb = useFeedback();
  const list = useCachedApi<Data>("/staff/playbook", true, ["playbook"]);
  const pk = useCachedApi<{ packages: PackageRow[] }>("/staff/packages", true, ["packages"]);
  const [section, setSection] = useState<PbSection>("quick");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("published");
  const [editing, setEditing] = useState<PbEntry | { section: PbSection; kind: PbKind } | null>(null);
  const [history, setHistory] = useState<PbEntry | null>(null);
  const [tickSeen, setTickSeen] = useState(newTick);
  const [focusId, setFocusId] = useState<number | null>(null);
  if (tickSeen !== newTick) { setTickSeen(newTick); setEditing({ section, kind: PB_DEFAULT_KIND[section] }); }

  const data = list.data;
  const manage = !!data?.can_manage;
  const entries = data?.entries ?? [];
  /* a bell names one entry: its section, scrolled to and lit */
  if (open !== null && data) {
    const hit = entries.find((e) => e.id === open);
    if (hit) { setSection(hit.section); setMode(hit.status === "archived" ? "archived" : "published"); setQ(""); onStage(null); setFocusId(hit.id); }
    onOpened();
  }
  const packages = (pk.data?.packages ?? []).filter((p) => p.status === "active");
  const refresh = () => list.refresh();

  const inMode = (e: PbEntry) => mode === "published" ? e.status !== "archived" && !!e.published?.payload
    : mode === "drafts" ? e.status !== "archived" && (e.status === "draft" || !!e.has_draft)
    : e.status === "archived";
  const visible = manage ? entries.filter(inMode) : entries;
  const textOf = (e: PbEntry) => (mode === "published" || !manage ? e.published?.payload : e.draft) ?? null;
  const needle = q.trim().toLowerCase();
  const shown = needle ? visible.filter((e) => { const p = textOf(e); return !!p && searchText(p).includes(needle); })
    : stage ? visible.filter((e) => textOf(e)?.stage === stage)
    : visible.filter((e) => e.section === section);
  const counts = Object.fromEntries(PB_SECTIONS.map((s) => [s, visible.filter((e) => e.section === s).length])) as Record<PbSection, number>;

  const pick = (s: PbSection) => { setSection(s); setQ(""); onStage(null); };
  const discard = async (e: PbEntry) => {
    const r = await api<{ error?: { message?: string } }>(`/staff/playbook/${e.id}/discard`, { method: "POST", body: JSON.stringify({ version: e.lock }) });
    if (!r.ok) { fb.show({ variant: "error", title: L("Not changed", "Tidak diubah"), description: failed(r) }); return; }
    fb.show({ variant: "success", title: L("Draft discarded", "Draf dibuang"), description: L(`Back to version ${e.published?.version}.`, `Kembali ke versi ${e.published?.version}.`) });
    refresh();
  };
  const unarchive = async (e: PbEntry) => {
    const r = await api<{ error?: { message?: string } }>(`/staff/playbook/${e.id}/unarchive`, { method: "POST", body: JSON.stringify({ version: e.lock }) });
    if (!r.ok) { fb.show({ variant: "error", title: L("Not changed", "Tidak diubah"), description: failed(r) }); return; }
    fb.show({ variant: "success", title: L("Brought back", "Dikembalikan"), description: e.draft?.title ?? "" });
    refresh();
  };

  if (!data) return list.failed
    ? <p className={css.warn} role="alert" data-testid="pb-failed"><AppIcon name="warning" />{L("The Playbook could not be loaded. Try again.", "Buku panduan tidak dapat dimuatkan. Cuba lagi.")}</p>
    : <div className={card}><SkelRows rows={6} /></div>;
  if (data.pending_migration) return <p className={css.warn} role="status" data-testid="pb-pending">{L("The Sales Playbook is waiting for a database update (0230).", "Buku Panduan Jualan menunggu kemas kini pangkalan data (0230).")}</p>;

  const heading = needle ? L(`Search: "${q.trim()}"`, `Carian: "${q.trim()}"`) : stage ? L(`For the stage: ${STAGE_WORD[stage][0]}`, `Untuk peringkat: ${STAGE_WORD[stage][1]}`) : w(PB_SECTION_WORD[section]);
  const railFor = (s: PbSection, kinds: PbKind[]) => entries.find((e) => e.section === s && e.status !== "archived" && kinds.includes(e.kind) && e.published?.payload);

  return (
    <div className={css.page} data-testid="playbook">
      {fb.node}
      {/* the four doors of the reference picture - buttons into their sections, never figures */}
      <div className={css.shortcuts} data-testid="pb-shortcuts">
        {SHORTCUTS.map((s) => (
          <button key={s} type="button" className={css.shortcut} data-on={!needle && !stage && section === s ? "" : undefined} onClick={() => pick(s)} data-testid={`pb-short-${s}`}>
            <span className={css.shortIcon} aria-hidden><AppIcon name={ICON[s]} /></span>
            <span className={css.shortText}><strong>{w(PB_SECTION_WORD[s])}</strong><small>{w(PB_SECTION_HINT[s])}</small></span>
          </button>
        ))}
      </div>

      <div className={css.layout}>
        <nav className={`${card} ${css.nav}`} aria-label={L("Playbook sections", "Bahagian buku panduan")} data-testid="pb-nav">
          <h2 className={css.navHead}><AppIcon name="documents" />{L("Sales Playbook", "Buku Panduan Jualan")}</h2>
          <ul className={css.navList}>
            {PB_SECTIONS.map((s) => (
              <li key={s}>
                <button type="button" className={css.navItem} aria-current={!needle && !stage && section === s ? "page" : undefined} onClick={() => pick(s)} data-testid={`pb-nav-${s}`}>
                  <AppIcon name={ICON[s]} /><span>{w(PB_SECTION_WORD[s])}</span>{counts[s] ? <small className={css.navCount}>{counts[s]}</small> : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <label className={css.phonePick}>
          <span className="erp-sr-only">{L("Section", "Bahagian")}</span>
          <select className={selectClass} value={section} onChange={(e) => pick(e.target.value as PbSection)} data-testid="pb-section-select">
            {PB_SECTIONS.map((s) => <option key={s} value={s}>{w(PB_SECTION_WORD[s])}{counts[s] ? ` (${counts[s]})` : ""}</option>)}
          </select>
        </label>

        <section className={`${card} ${css.main}`} aria-label={heading} data-testid="pb-main">
          <div className={css.mainHead}>
            <span className={css.mainIcon} aria-hidden><AppIcon name={needle ? "search" : stage ? "target" : ICON[section]} /></span>
            <div className={css.mainText}>
              <h2 className={css.h} data-testid="pb-heading">{heading}</h2>
              {!needle && !stage && <p className={css.meta}>{w(PB_SECTION_HINT[section])}</p>}
              {stage && <p className={css.meta}>{L("Entries the managers tagged for this pipeline stage, from every section.", "Catatan yang ditanda pengurus untuk peringkat ini, dari setiap bahagian.")}</p>}
            </div>
          </div>
          <div className={css.tools}>
            <label className={css.search}>
              <span className="erp-sr-only">{L("Search the Playbook", "Cari buku panduan")}</span>
              <span className={css.searchIcon} aria-hidden><AppIcon name="search" /></span>
              <input type="search" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search the Playbook", "Cari buku panduan")} data-testid="pb-search" />
            </label>
            {stage && <button type="button" className={btnSmQuiet} onClick={() => onStage(null)} data-testid="pb-stage-clear"><AppIcon name="close" />{L("All sections", "Semua bahagian")}</button>}
            {manage && (
              <PillSwitch value={mode} onChange={(v) => setMode(v as Mode)} label={L("Show", "Tunjuk")} testid="pb-mode" options={[
                ["published", L("Published", "Diterbitkan")], ["drafts", L("Drafts & changes", "Draf & perubahan")], ["archived", L("Archived", "Diarkib")],
              ]} />
            )}
          </div>
          {manage && mode !== "published" && (
            <p className={css.note} data-testid="pb-staff-note"><AppIcon name="lock" />{mode === "drafts"
              ? L("Staff do not see these words until they are published.", "Staf tidak nampak teks ini sehingga ia diterbitkan.")
              : L("Archived entries are hidden from staff. Nothing is deleted.", "Catatan diarkib tersembunyi daripada staf. Tiada yang dipadam.")}</p>
          )}

          {!needle && !stage && section === "product" && mode === "published" && <PackagesLive packages={pk.data ? packages : null} />}

          {shown.length === 0 ? (
            <div className={css.empty} data-testid="pb-empty">
              <AppIcon name="documents" />
              <p>{needle ? L("Nothing in the Playbook matches that.", "Tiada apa dalam buku panduan sepadan.")
                : stage ? L("Nothing is written for this stage yet.", "Belum ada catatan untuk peringkat ini.")
                : manage && mode === "published" ? L("Nothing is published in this section yet. Write an entry and publish it - staff see it from that moment.", "Belum ada terbitan dalam bahagian ini. Tulis catatan dan terbitkan - staf nampak dari saat itu.")
                : manage ? L("Nothing here.", "Tiada apa di sini.")
                : L("Nothing is published in this section yet.", "Belum ada terbitan dalam bahagian ini.")}</p>
              {manage && !needle && !stage && mode !== "archived" && <button type="button" className={btnSmPrimary} onClick={() => setEditing({ section, kind: PB_DEFAULT_KIND[section] })} data-testid="pb-empty-new"><AppIcon name="add" />{L("New entry", "Catatan baharu")}</button>}
            </div>
          ) : (
            <ol className={css.entries} data-testid="pb-entries">
              {shown.map((e) => {
                const p = textOf(e);
                if (!p) return null;
                const files = (mode === "published" || !manage ? e.published?.files : e.draft_files) ?? [];
                return (
                  <li key={e.id} className={css.entry} data-testid="pb-entry" data-entry={e.id} data-kind={e.kind} data-focus={focusId === e.id ? "" : undefined}>
                    {(needle || stage) && <span className={css.where}>{w(PB_SECTION_WORD[e.section])}</span>}
                    <EntryBody kind={e.kind} p={p} files={files} packages={packages} />
                    {manage && (
                      <div className={css.manage} data-testid="pb-manage">
                        <span className={css.status}>
                          {e.status === "archived" ? <span className={chipSmNeutral}>{L("Archived", "Diarkib")}</span>
                            : !e.published ? <span className={chipSmWarn}>{L("Draft - never published", "Draf - belum diterbitkan")}</span>
                            : e.has_draft ? <span className={chipSmWarn}>{L(`Version ${e.published.version} live · changes not published`, `Versi ${e.published.version} aktif · perubahan belum diterbitkan`)}</span>
                            : <span className={chipSmInfo}>{L(`Version ${e.published.version} · ${when(e.published.published_at)}`, `Versi ${e.published.version} · ${when(e.published.published_at)}`)}</span>}
                          {e.status === "archived" && e.archive_reason && <small className={css.meta}>{e.archive_reason}</small>}
                        </span>
                        <span className={css.manageBtns}>
                          {e.status === "archived"
                            ? <button type="button" className={btnSm} onClick={() => void unarchive(e)} data-testid="pb-unarchive">{L("Bring back", "Kembalikan")}</button>
                            : <button type="button" className={btnSm} onClick={() => setEditing(e)} data-testid="pb-edit"><AppIcon name="edit" />{e.has_draft ? L("Edit & publish", "Sunting & terbit") : L("Edit", "Sunting")}</button>}
                          {e.published && e.has_draft && e.status !== "archived" && <button type="button" className={btnSmQuiet} onClick={() => void discard(e)} data-testid="pb-discard">{L("Discard changes", "Buang perubahan")}</button>}
                          {e.published && <button type="button" className={btnSmQuiet} onClick={() => setHistory(e)} data-testid="pb-history">{L("Versions", "Versi")}</button>}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className={css.rail} aria-label={L("Quick reference", "Rujukan pantas")} data-testid="pb-rail">
          {RAIL.map(([s, kinds]) => {
            const e = railFor(s, kinds);
            const p = e?.published?.payload;
            if (!e || !p) return null;
            const numbered = s === "quick";
            return (
              <section key={s} className={`${card} ${css.railCard}`} data-testid={`pb-rail-${s}`}>
                <button type="button" className={css.railHead} onClick={() => { pick(s); setFocusId(e.id); }}>
                  <AppIcon name={ICON[s]} /><strong>{p.title}</strong><AppIcon name="next" />
                </button>
                {numbered ? (
                  <ol className={css.railNum}>{p.items.slice(0, 6).map((it, i) => <li key={i}><span>{i + 1}</span>{it}</li>)}</ol>
                ) : (
                  <ul className={css.railList}>{p.items.slice(0, 6).map((it, i) => <li key={i}><AppIcon name="success" />{it}</li>)}</ul>
                )}
              </section>
            );
          })}
        </aside>
      </div>

      {editing && <EntryEditor key={"id" in editing ? `e${editing.id}` : "new"} start={editing} packages={pk.data?.packages ?? []} onClose={() => setEditing(null)}
        onSaved={(id) => { refresh(); if (id) setFocusId(id); }} />}
      {history && <VersionsDrawer entry={history} packages={packages} onClose={() => setHistory(null)} onRestored={() => { setHistory(null); setMode("drafts"); refresh(); }} />}
    </div>
  );
}

/* ---------------- Product Knowledge: the Packages library, live ---------------- */
function PackagesLive({ packages }: { packages: PackageRow[] | null }) {
  return (
    <section className={css.pkgs} aria-label={L("Packages", "Pakej")} data-testid="pb-packages">
      <h3 className={css.h4}>{L("Our packages - live from the Packages library", "Pakej kami - terus dari pustaka Pakej")}</h3>
      {packages === null ? <SkelRows rows={3} /> : packages.length === 0 ? (
        <p className={css.meta}>{L("No active package in the library.", "Tiada pakej aktif dalam pustaka.")}</p>
      ) : (
        <ul className={css.pkgList}>
          {packages.map((p) => (
            <li key={p.id} data-testid="pb-package" data-package={p.id}>
              <span className={css.pkgName}><strong>{p.name}</strong>{p.category && <small>{p.category}</small>}</span>
              <span className={css.pkgCo}>{p.issuers.map((i) => (i === "a2z" ? "A2Z Creative" : "AZ ONE")).join(" · ")}</span>
              <span className={css.pkgPrice}>{fmtRM(p.total_cents)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={css.meta}>{L("Prices are the library's current ones. The Playbook never holds a price of its own.", "Harga ialah harga semasa pustaka. Buku panduan tidak menyimpan harga sendiri.")}</p>
    </section>
  );
}

/* ---------------- one entry, as staff read it ---------------- */
function EntryBody({ kind, p, files, packages }: { kind: PbKind; p: PbPayload; files: PbFile[]; packages: PackageRow[] }) {
  const linked = p.package_ids.map((id) => packages.find((x) => x.id === id)).filter((x): x is PackageRow => !!x);
  const lang = <span className={css.lang} title={p.lang === "ms" ? "Bahasa Melayu" : "English"}>{p.lang === "ms" ? "BM" : "EN"}</span>;
  let body: ReactNode;
  if (kind === "objection") {
    body = (
      <div className={css.objection}>
        <blockquote className={css.said}><AppIcon name="chat" /><span>{p.title}</span></blockquote>
        <div className={css.answer}>
          <h3 className={css.h4}><AppIcon name="success" />{L("Suggested answer", "Cadangan jawapan")}</h3>
          <p className={css.text}>{p.answer}</p>
        </div>
        {p.items.length > 0 && (
          <div className={css.focus}>
            <h3 className={css.h4}><AppIcon name="target" />{L("Focus points", "Titik fokus")}</h3>
            <ul>{p.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
      </div>
    );
  } else if (kind === "questions" || kind === "checklist") {
    body = (
      <>
        <h3 className={css.title}>{p.title}</h3>
        <ul className={css.ticks}>{p.items.map((x, i) => <li key={i}><AppIcon name={kind === "questions" ? "info" : "success"} />{x}</li>)}</ul>
      </>
    );
  } else {
    body = (
      <>
        <h3 className={css.title}>{p.title}</h3>
        <p className={kind === "script" ? css.script : css.text}>{p.body}</p>
      </>
    );
  }
  return (
    <div className={css.body}>
      <div className={css.tags}>
        <span className={chipSmNeutral}>{w(PB_KIND_WORD[kind])}</span>{lang}
        {p.stage && <span className={chipSmInfo}>{w(STAGE_WORD[p.stage])}</span>}
      </div>
      {body}
      {linked.length > 0 && (
        <ul className={css.linked} aria-label={L("Linked packages", "Pakej dipaut")} data-testid="pb-linked">
          {linked.map((x) => <li key={x.id}><AppIcon name="package" />{x.name}<b>{fmtRM(x.total_cents)}</b></li>)}
        </ul>
      )}
      {files.length > 0 && (
        <ul className={css.files} aria-label={L("Files", "Fail")}>
          {files.map((f) => {
            const url = `/api/v1/staff/playbook/files/${f.id}`;
            return <li key={f.id}><a className={btnSmQuiet} href={url} onClick={viewFile(url, f.filename)} data-testid="pb-file"><AppIcon name="attach" />{f.filename}</a></li>;
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------- write, save and publish (the CEO, COO and CCO) ---------------- */
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function EntryEditor({ start, packages, onClose, onSaved }: {
  start: PbEntry | { section: PbSection; kind: PbKind };
  packages: PackageRow[];
  onClose: () => void; onSaved: (id: number | null) => void;
}) {
  const fb = useFeedback();
  const isNew = !("id" in start);
  const [entry, setEntry] = useState<PbEntry | null>(isNew ? null : (start as PbEntry));
  const base = entry?.draft ?? null;
  const [section, setSection] = useState<PbSection>(start.section);
  const [kind, setKind] = useState<PbKind>(start.kind);
  const [lang, setLang] = useState<"ms" | "en">(base?.lang ?? "ms");
  const [title, setTitle] = useState(base?.title ?? "");
  const [body, setBody] = useState(base?.body ?? "");
  const [answer, setAnswer] = useState(base?.answer ?? "");
  const [items, setItems] = useState((base?.items ?? []).join("\n"));
  const [stage, setStage] = useState<PbStage | "">(base?.stage ?? "");
  const [pkgs, setPkgs] = useState<number[]>(base?.package_ids ?? []);
  const [keep, setKeep] = useState<number[]>((entry?.draft_files ?? []).map((f) => f.id));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const textual = kind === "guide" || kind === "script";
  const payload = (): PbPayload => ({
    title: title.trim(), lang, body: textual ? body : "", answer: kind === "objection" ? answer : "",
    items: textual ? [] : lines(items), stage: stage || null, package_ids: pkgs,
  });
  const price = [title, body, answer, items].map(priceProblem).find(Boolean) ?? "";
  const choosable = packages.filter((p) => p.status === "active" || pkgs.includes(p.id));

  /* save the draft; returns the entry as the server now holds it */
  const save = async (): Promise<PbEntry | null> => {
    setProblem("");
    const r = isNew && !entry
      ? await api<{ entry?: PbEntry; error?: { message?: string } }>("/staff/playbook", { method: "POST", body: JSON.stringify({ section, kind, payload: payload() }) })
      : await api<{ entry?: PbEntry; error?: { message?: string } }>(`/staff/playbook/${entry!.id}`, { method: "PUT", body: JSON.stringify({ payload: payload(), files: keep, version: entry!.lock }) });
    if (!r.ok || !r.data?.entry) { setProblem(failed(r)); return null; }
    setEntry(r.data.entry);
    return r.data.entry;
  };
  const saveDraft = async () => {
    setBusy(true);
    const e = await save();
    setBusy(false);
    if (!e) return;
    fb.show({ variant: "success", title: L("Draft saved", "Draf disimpan"), description: L("Staff do not see it until it is published.", "Staf tidak nampak sehingga ia diterbitkan.") });
    onSaved(e.id);
  };
  const publish = async () => {
    setBusy(true);
    const e = await save();
    if (!e) { setBusy(false); return; }
    const r = await api<{ version?: number; error?: { message?: string } }>(`/staff/playbook/${e.id}/publish`, { method: "POST", body: JSON.stringify({ note: note.trim(), version: e.lock }) });
    setBusy(false);
    if (!r.ok) { setProblem(failed(r)); onSaved(e.id); return; }
    fb.show({ variant: "success", title: L(`Published as version ${r.data?.version}`, `Diterbitkan sebagai versi ${r.data?.version}`), description: L("Staff read it from now. The other managers were told.", "Staf membacanya mulai sekarang. Pengurus lain telah dimaklumkan.") });
    onSaved(e.id);
    onClose();
  };
  const archive = async () => {
    if (!entry) return;
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/playbook/${entry.id}/archive`, { method: "POST", body: JSON.stringify({ reason: reason.trim(), version: entry.lock }) });
    setBusy(false);
    if (!r.ok) { setProblem(failed(r)); return; }
    fb.show({ variant: "success", title: L("Archived", "Diarkib"), description: L("Hidden from staff. Every version is kept.", "Tersembunyi daripada staf. Setiap versi disimpan.") });
    onSaved(entry.id);
    onClose();
  };
  const attach = async (file: File) => {
    let e = entry;
    if (!e) { setBusy(true); e = await save(); setBusy(false); if (!e) return; }
    if (!(PB_FILE_TYPES as readonly string[]).includes(file.type)) { setProblem(L("Only PDF, Word (.docx), JPEG, PNG or WebP files can be attached.", "Hanya fail PDF, Word (.docx), JPEG, PNG atau WebP boleh dilampirkan.")); return; }
    if (file.size > 10 * 1024 * 1024) { setProblem(L("The file is larger than 10 MB.", "Fail melebihi 10 MB.")); return; }
    setBusy(true);
    try {
      const res = await csrfFetch(`/api/v1/staff/playbook/${e.id}/files?version=${e.lock}`, {
        method: "POST", body: file, headers: { "Content-Type": file.type, "X-File-Name": file.name.replace(/[^\x20-\x7e]/g, "_").slice(0, 160) },
      });
      const d = (await res.json().catch(() => null)) as { entry?: PbEntry; file_id?: number; error?: { message?: string } } | null;
      if (!res.ok || !d?.entry) setProblem(d?.error?.message ?? L("The file was not attached.", "Fail tidak dilampirkan."));
      else { setEntry(d.entry); setKeep((k) => [...k, d.file_id!]); onSaved(d.entry.id); }
    } catch { setProblem(L("No connection - the file was not attached.", "Tiada sambungan - fail tidak dilampirkan.")); }
    setBusy(false);
  };

  const files = entry?.draft_files ?? [];
  const valid = title.trim().length >= 2 && (textual ? body.trim().length >= 10 : kind === "objection" ? answer.trim().length >= 10 : lines(items).length > 0) && !price;
  return (
    <SideDrawer open onClose={onClose} title={isNew && !entry ? L("New Playbook entry", "Catatan buku panduan baharu") : L("Edit Playbook entry", "Sunting catatan buku panduan")}
      subtitle={entry?.published ? L(`Version ${entry.published.version} is what staff read now`, `Versi ${entry.published.version} yang staf baca sekarang`) : L("A draft - staff do not see it yet", "Draf - staf belum nampak")}
      form icon="documents" dirty="auto">
      {fb.node}
      <DrawerForm>
        {problem && <p className={css.warn} role="alert" data-testid="pb-ed-problem"><AppIcon name="warning" />{problem}</p>}
        {isNew && !entry && (
          <div className={css.pair}>
            <label className={fieldLabel}>{L("Section", "Bahagian")}
              <select className={selectClass} value={section} onChange={(e) => { const s = e.target.value as PbSection; setSection(s); setKind(PB_DEFAULT_KIND[s]); }} data-testid="pb-ed-section">
                {PB_SECTIONS.map((s) => <option key={s} value={s}>{w(PB_SECTION_WORD[s])}</option>)}
              </select>
            </label>
            <label className={fieldLabel}>{L("Kind", "Jenis")}
              <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as PbKind)} data-testid="pb-ed-kind">
                {PB_KINDS.map((k) => <option key={k} value={k}>{w(PB_KIND_WORD[k])}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className={css.pair}>
          <label className={fieldLabel}>{L("Written in", "Ditulis dalam")}
            <select className={selectClass} value={lang} onChange={(e) => setLang(e.target.value as "ms" | "en")} data-testid="pb-ed-lang">
              <option value="ms">Bahasa Melayu</option><option value="en">English</option>
            </select>
          </label>
          <label className={fieldLabel}>{L("For a pipeline stage (optional)", "Untuk peringkat saluran (pilihan)")}
            <select className={selectClass} value={stage} onChange={(e) => setStage(e.target.value as PbStage | "")} data-testid="pb-ed-stage">
              <option value="">{L("Any stage", "Mana-mana peringkat")}</option>
              {PB_STAGES.map((s) => <option key={s} value={s}>{w(STAGE_WORD[s])}</option>)}
            </select>
          </label>
        </div>
        <label className={fieldLabel}>{kind === "objection" ? L("What the customer says", "Apa kata pelanggan") : L("Title", "Tajuk")}
          <input className={inputClass} value={title} maxLength={PB_LIMITS.title} onChange={(e) => setTitle(e.target.value)} data-testid="pb-ed-title" />
        </label>
        {textual && (
          <label className={fieldLabel}>{kind === "script" ? L("The script", "Skrip") : L("The guide", "Panduan")}
            <textarea className={inputClass} rows={8} value={body} maxLength={PB_LIMITS.body} onChange={(e) => setBody(e.target.value)} data-testid="pb-ed-body" />
          </label>
        )}
        {kind === "objection" && (
          <label className={fieldLabel}>{L("Suggested answer", "Cadangan jawapan")}
            <textarea className={inputClass} rows={5} value={answer} maxLength={PB_LIMITS.answer} onChange={(e) => setAnswer(e.target.value)} data-testid="pb-ed-answer" />
          </label>
        )}
        {!textual && (
          <label className={fieldLabel}>{kind === "objection" ? L(`Focus points - one per line, up to ${PB_LIMITS.focus}`, `Titik fokus - satu sebaris, sehingga ${PB_LIMITS.focus}`)
            : kind === "questions" ? L(`Questions - one per line, up to ${PB_LIMITS.items}`, `Soalan - satu sebaris, sehingga ${PB_LIMITS.items}`)
            : L(`Checklist - one per line, up to ${PB_LIMITS.items}`, `Senarai semak - satu sebaris, sehingga ${PB_LIMITS.items}`)}
            <textarea className={inputClass} rows={6} value={items} onChange={(e) => setItems(e.target.value)} data-testid="pb-ed-items" />
          </label>
        )}
        {price && <p className={css.warn} role="status" data-testid="pb-ed-price"><AppIcon name="warning" />{L(`"${price}" is a price. Prices come only from the Packages library - link the package below instead.`, `"${price}" ialah harga. Harga hanya dari pustaka Pakej - paut pakej di bawah.`)}</p>}

        <fieldset className={css.fieldset}>
          <legend className={fieldLabel}>{L(`Linked packages (up to ${PB_LIMITS.packages}) - staff see each one's live price`, `Pakej dipaut (sehingga ${PB_LIMITS.packages}) - staf nampak harga semasa`)}</legend>
          {choosable.length === 0 ? <p className={css.meta}>{L("No active package in the library.", "Tiada pakej aktif dalam pustaka.")}</p> : (
            <div className={css.checks}>
              {choosable.map((p) => (
                <label key={p.id} className={css.check}>
                  <input type="checkbox" checked={pkgs.includes(p.id)} disabled={!pkgs.includes(p.id) && pkgs.length >= PB_LIMITS.packages}
                    onChange={(e) => setPkgs((x) => (e.target.checked ? [...x, p.id] : x.filter((i) => i !== p.id)))} data-testid="pb-ed-pkg" />
                  <span>{p.name}{p.status !== "active" && <small className={css.meta}> · {L("not active", "tidak aktif")}</small>}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className={css.fieldset}>
          <legend className={fieldLabel}>{L(`Files (PDF, Word or image, 10 MB each, up to ${PB_MAX_FILES})`, `Fail (PDF, Word atau imej, 10 MB setiap satu, sehingga ${PB_MAX_FILES})`)}</legend>
          {files.length > 0 && (
            <div className={css.checks}>
              {files.map((f) => (
                <label key={f.id} className={css.check}>
                  <input type="checkbox" checked={keep.includes(f.id)} onChange={(e) => setKeep((k) => (e.target.checked ? [...k, f.id] : k.filter((i) => i !== f.id)))} data-testid="pb-ed-file" />
                  <span>{f.filename}</span>
                </label>
              ))}
            </div>
          )}
          {keep.length < PB_MAX_FILES && (
            <label className={`${btnSmQuiet} ${css.attach}`}>
              <AppIcon name="attach" />{L("Attach file", "Lampirkan fail")}
              <input type="file" className="erp-sr-only" accept={PB_FILE_TYPES.join(",")} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attach(f); }} data-testid="pb-ed-attach" />
            </label>
          )}
          <p className={css.meta}>{L("A file you untick leaves the next version; the versions already published keep theirs.", "Fail yang dinyahtanda tiada dalam versi seterusnya; versi yang sudah diterbitkan kekal dengan failnya.")}</p>
        </fieldset>

        <label className={fieldLabel}>{L("What changed - needed to publish", "Apa yang berubah - perlu untuk terbit")}
          <input className={inputClass} value={note} maxLength={PB_LIMITS.note} onChange={(e) => setNote(e.target.value)} placeholder={L("e.g. New answer for budget concerns", "cth. Jawapan baharu untuk isu bajet")} data-testid="pb-ed-note" />
        </label>
        <p className={css.meta}>{L("Publishing makes this the version staff read and tells the other managers. The earlier versions are kept.", "Menerbitkan menjadikan ini versi yang staf baca dan memaklumkan pengurus lain. Versi terdahulu disimpan.")}</p>

        {entry && entry.status !== "archived" && (
          <details className={css.archive} data-testid="pb-ed-archive">
            <summary>{L("Archive this entry", "Arkibkan catatan ini")}</summary>
            <label className={fieldLabel}>{L("Why (staff stop seeing it; nothing is deleted)", "Sebab (staf tidak lagi nampak; tiada yang dipadam)")}
              <input className={inputClass} value={reason} maxLength={PB_LIMITS.reason} onChange={(e) => setReason(e.target.value)} data-testid="pb-ed-reason" />
            </label>
            <button type="button" className={btnSm} disabled={busy || reason.trim().length < 5} onClick={() => void archive()} data-testid="pb-ed-archive-btn">{L("Archive", "Arkibkan")}</button>
          </details>
        )}
      </DrawerForm>
      <DrawerFoot>
        <button type="button" className={btnSmQuiet} onClick={onClose}>{L("Close", "Tutup")}</button>
        <button type="button" className={btnSm} disabled={busy || !valid} onClick={() => void saveDraft()} data-testid="pb-ed-save">{L("Save draft", "Simpan draf")}</button>
        <button type="button" className={btnSmPrimary} disabled={busy || !valid || note.trim().length < 5} onClick={() => void publish()} data-testid="pb-ed-publish">{L("Publish", "Terbitkan")}</button>
      </DrawerFoot>
    </SideDrawer>
  );
}

/* ---------------- every published version, and bringing one back ---------------- */
function VersionsDrawer({ entry, packages, onClose, onRestored }: { entry: PbEntry; packages: PackageRow[]; onClose: () => void; onRestored: () => void }) {
  const fb = useFeedback();
  const v = useCachedApi<{ versions: Version[] }>(`/staff/playbook/${entry.id}/versions`, true, ["playbook"]);
  const [openV, setOpenV] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const restore = async (from: number) => {
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/playbook/${entry.id}/restore`, { method: "POST", body: JSON.stringify({ from, version: entry.lock }) });
    setBusy(false);
    if (!r.ok) { fb.show({ variant: "error", title: L("Not brought back", "Tidak dikembalikan"), description: failed(r) }); return; }
    fb.show({ variant: "success", title: L(`Version ${from} is in the draft`, `Versi ${from} dalam draf`), description: L("Publish it to make it the version staff read.", "Terbitkan untuk menjadikannya versi yang staf baca.") });
    onRestored();
  };
  return (
    <SideDrawer open onClose={onClose} title={L("Versions", "Versi")} subtitle={entry.published?.payload?.title ?? entry.draft?.title ?? ""} wide>
      {fb.node}
      {!v.data ? <SkelRows rows={4} /> : (
        <ol className={css.versions} data-testid="pb-versions">
          {v.data.versions.map((x) => (
            <li key={x.version} data-testid="pb-version" data-version={x.version}>
              <div className={css.vHead}>
                <strong>{L(`Version ${x.version}`, `Versi ${x.version}`)}</strong>
                {x.version === entry.published?.version && <span className={chipSmInfo}>{L("Staff read this", "Staf membaca ini")}</span>}
                <span className={css.meta}>{when(x.published_at)}{x.published_by_name ? ` · ${x.published_by_name}` : ""}{x.restored_from ? L(` · from version ${x.restored_from}`, ` · dari versi ${x.restored_from}`) : ""}</span>
              </div>
              <p className={css.vNote}>{x.note}</p>
              <div className={css.manageBtns}>
                <button type="button" className={btnSmQuiet} aria-expanded={openV === x.version} onClick={() => setOpenV((o) => (o === x.version ? null : x.version))} data-testid="pb-version-view">{openV === x.version ? L("Hide", "Sembunyi") : L("Read", "Baca")}</button>
                {x.version !== entry.published?.version && entry.status !== "archived" && <button type="button" className={btnSm} disabled={busy} onClick={() => void restore(x.version)} data-testid="pb-version-restore">{L("Bring back into the draft", "Kembalikan ke draf")}</button>}
              </div>
              {openV === x.version && x.payload && <div className={css.vBody}><EntryBody kind={entry.kind} p={x.payload} files={x.files} packages={packages} /></div>}
            </li>
          ))}
        </ol>
      )}
    </SideDrawer>
  );
}

