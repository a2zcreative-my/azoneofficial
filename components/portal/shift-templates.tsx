"use client";

/* v1.373.0 - SHIFT TEMPLATES, BULK ASSIGNMENT (the CEO, 18-11-2026, his three
   pictures: desktop selection, the review drawer, the phone). Roster &
   Scheduling -> Shift Templates only.

   The working-hour patterns are compact selectable cards; the staff are one
   searchable table with checkboxes (select all visible, clear); ONE pattern and
   ONE effective date go to the whole selection. Review & Assign asks the server
   for the preview first (POST /staff-shifts/bulk dry_run) and shows every person
   - change, no change, conflict, refused - with the pattern before and after;
   nothing is saved until Confirm. The server decides everything again on save
   (worker/src/shift-bulk.ts): tomorrow or later only, hr_manage only, one
   conditional insert per person, audit and notice.

   The existing tools are kept exactly as they were, in a drawer: the pattern
   editor (New Pattern, edit, remove), single-staff assign and the assignment
   history (move a date, withdraw) - AttendanceAdminPanel's Working hours area,
   unchanged (the CEO's answer). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { L } from "@/components/portal/page-shared";
import { properName } from "@/lib/names";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
import { Avatar } from "@/components/ui/avatar";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { AttendanceAdminPanel } from "@/components/portal/lazy-panels";
import { btnSm, btnSmAccent, btnSmQuiet, card, chipSmNeutral, inputClassSm, selectClassSm, td, th } from "@/lib/ui-styles";
import css from "./shift-templates.module.css";

type Pattern = Record<string, unknown> & { id: number; name: string; category?: string | null; is_default?: number };
type Assignment = { id: number; user_id: number; pattern_id: number; effective_from: string; pattern_name: string; name: string };
type Staff = { id: number; name: string; role: string; position: string | null; department: string | null; employment_status: string | null };
type BulkState = "change" | "no_change" | "conflict" | "refused";
type BulkRow = { user_id: number; name: string | null; state: BulkState; reason: string | null; previous: { pattern_id: number; name: string; from: string | null } | null; warnings: string[] };
type Preview = { pattern: { id: number; name: string }; effective_from: string; rows: BulkRow[]; counts: Record<BulkState, number>; saved?: number; dry_run?: boolean };

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const mytDay = (off = 0) => new Date(Date.now() + 8 * 3600_000 + off * 86400_000).toISOString().slice(0, 10);
const hm = (m: unknown) => (typeof m === "number" ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` : "");
const dmy = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
const longDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(getLangTag(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function getLangTag() { try { return localStorage.getItem("azone-lang") === "ms" ? "ms-MY" : "en-GB"; } catch { return "en-GB"; } }
const block = (p: Pattern, d: string) => (p[`${d}_start`] == null ? "" : `${hm(p[`${d}_start`])} – ${hm(p[`${d}_end`])}`);
/** "09:00 – 17:00 (Fri 16:30)" - the weekday most days share, and the Friday exception the pattern holds */
export function hoursOf(p: Pattern | null | undefined): string {
  if (!p) return "—";
  const work = DAYS.filter((d) => p[`${d}_start`] != null);
  if (!work.length) return L("No working days", "Tiada hari bekerja");
  const counts = new Map<string, number>();
  for (const d of work) counts.set(block(p, d), (counts.get(block(p, d)) ?? 0) + 1);
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const others = work.filter((d) => block(p, d) !== main);
  if (!others.length) return main;
  if (others.length === 1 && others[0] === "fri" && p.fri_start === p[`${work[0]}_start`]) return `${main} (${L("Fri", "Jum")} ${hm(p.fri_end)})`;
  return `${main} · ${L("varies", "berbeza")}`;
}
const CAT_ICON: Record<string, AppIconName> = { normal: "building", afternoon: "time", evening: "time", custom: "date" };
const STATE: Record<BulkState, [string, string, string]> = {
  change: ["Change", "Tukar", "erp-chip-warning"], no_change: ["No change", "Tiada perubahan", "erp-chip-neutral"],
  conflict: ["Conflict", "Konflik", "erp-chip-danger"], refused: ["Not assigned", "Tidak ditetapkan", "erp-chip-danger"],
};
type StatusF = "" | "assigned" | "default" | "planned";
const PAGE = 10;

export function ShiftTemplates({ role }: { role: string }) {
  const [patterns, setPatterns] = useState<Pattern[] | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [problem, setProblem] = useState("");
  const [tick, setTick] = useState(0);
  const [pick, setPick] = useState(0); // the pattern for the selection
  const [from, setFrom] = useState(mytDay(1));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [statusF, setStatusF] = useState<StatusF>("");
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([
      api<{ patterns: Pattern[]; assignments: Assignment[] }>("/staff/shift-patterns"),
      api<{ staff?: Staff[]; users?: Staff[] }>("/staff/staff-list"),
    ]).then(([sp, sl]) => {
      if (!live) return;
      if (!sp.ok) { setProblem(L("The patterns could not be loaded.", "Corak tidak dapat dimuatkan.")); setPatterns([]); return; }
      const ps = sp.data?.patterns ?? [];
      setPatterns(ps); setAssignments(sp.data?.assignments ?? []);
      setStaff((sl.data?.staff ?? sl.data?.users ?? []) as Staff[]);
      setPick((cur) => (cur && ps.some((p) => p.id === cur) ? cur : ps.find((p) => p.is_default)?.id ?? ps[0]?.id ?? 0));
    });
    return () => { live = false; };
  }, [tick]);

  const today = mytDay(0), tomorrow = mytDay(1);
  const patById = useMemo(() => new Map((patterns ?? []).map((p) => [p.id, p])), [patterns]);
  const def = useMemo(() => (patterns ?? []).find((p) => p.is_default) ?? null, [patterns]);
  /* the pattern each person is on today, and the change already planned */
  const now = useMemo(() => {
    const m = new Map<number, { current: Assignment | null; next: Assignment | null }>();
    const sorted = [...assignments].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id);
    for (const a of sorted) {
      const e = m.get(a.user_id) ?? { current: null, next: null };
      if (a.effective_from <= today) { if (!e.current) e.current = a; }
      else e.next = a; // ascending through the loop: the earliest planned stays last written
      m.set(a.user_id, e);
    }
    return m;
  }, [assignments, today]);
  const depts = useMemo(() => [...new Set((staff ?? []).map((s) => s.department).filter(Boolean) as string[])].sort(), [staff]);
  const statusOf = (id: number): StatusF => (now.get(id)?.next ? "planned" : now.get(id)?.current ? "assigned" : "default");
  const shown = useMemo(() => (staff ?? []).filter((s) => (!dept || s.department === dept) && (!statusF || statusOf(s.id) === statusF)
    && (!q || `${s.name} ${s.position ?? ""} ${s.department ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [staff, dept, statusF, q, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = `${q}|${dept}|${statusF}`;
  const [seenKey, setSeenKey] = useState(key);
  if (key !== seenKey) { setSeenKey(key); setPage(1); }
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);
  const allShown = shown.length > 0 && shown.every((s) => sel.has(s.id));
  const someShown = shown.some((s) => sel.has(s.id));
  const toggle = (id: number) => setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleShown = () => setSel((cur) => { const n = new Set(cur); if (allShown) for (const s of shown) n.delete(s.id); else for (const s of shown) n.add(s.id); return n; });

  const ask = useCallback(async (dry: boolean) => {
    setBusy(true); setProblem("");
    const r = await api<Preview & { error?: { message?: string } }>("/staff/staff-shifts/bulk", { method: "POST", body: JSON.stringify({ user_ids: [...sel], pattern_id: pick, effective_from: from, dry_run: dry }) });
    setBusy(false);
    if (!r.ok || !r.data) { setProblem(r.status === 0 ? L("No connection - nothing was changed.", "Tiada sambungan - tiada apa diubah.") : r.data?.error?.message ?? L("The server refused that.", "Pelayan menolaknya.")); return; }
    if (dry) { setReview(r.data); setResult(null); }
    else { setResult(r.data); setReview(null); setSel(new Set()); setTick((t) => t + 1); }
  }, [sel, pick, from]);

  if (!patterns || !staff) return <section className={card}><SkelRows rows={6} /></section>;

  const curOf = (id: number) => { const c = now.get(id)?.current; return c ? { p: patById.get(c.pattern_id) ?? null, name: c.pattern_name, from: c.effective_from } : { p: def, name: def?.name ?? "—", from: null }; };
  const bar = (
    <div className={css.bar} data-testid="st-bar">
      <label className={css.selCount}><input type="checkbox" className={css.check} checked={sel.size > 0} onChange={() => setSel(new Set())} disabled={!sel.size} aria-label={L("Clear the selection", "Kosongkan pilihan")} />
        <strong data-testid="st-count">{L(`${sel.size} staff selected`, `${sel.size} kakitangan dipilih`)}</strong></label>
      <label className={css.field}><span>{L("Assign pattern", "Tetapkan corak")}</span>
        <select className={selectClassSm} value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label={L("Assign pattern", "Tetapkan corak")} data-testid="st-pattern">
          {patterns.map((p) => <option key={p.id} value={p.id}>{p.name} ({hoursOf(p)})</option>)}
        </select></label>
      <label className={css.field}><span>{L("Effective from", "Berkuat kuasa dari")}</span>
        <input type="date" className={inputClassSm} min={tomorrow} value={from} onChange={(e) => setFrom(e.target.value)} aria-label={L("Effective from", "Berkuat kuasa dari")} data-testid="st-from" /></label>
      <button type="button" className={`${btnSmAccent} ${css.go}`} disabled={!sel.size || !pick || !from || from < tomorrow || busy} onClick={() => void ask(true)} data-testid="st-review">
        <AppIcon name="success" />{L(`Review & Assign (${sel.size})`, `Semak & Tetapkan (${sel.size})`)}</button>
      <button type="button" className={`${btnSmQuiet} ${css.clear}`} disabled={!sel.size} onClick={() => setSel(new Set())} data-testid="st-clear"><AppIcon name="close" />{L("Clear selection", "Kosongkan pilihan")}</button>
    </div>
  );

  return (
    <div className="erp-stack-tight" data-testid="shift-templates">
      <section className={card} aria-label={L("Working hours patterns", "Corak waktu bekerja")}>
        <div className={css.headRow}>
          <h3 className={css.h3}>{L("Working Hours Patterns", "Corak Waktu Bekerja")}</h3>
          <span className={css.hint}>{L("Choose the pattern to assign", "Pilih corak untuk ditetapkan")}</span>
        </div>
        <div className={css.cards} role="radiogroup" aria-label={L("Pattern to assign", "Corak untuk ditetapkan")} data-testid="st-cards">
          {patterns.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={pick === p.id} className={css.pcard} onClick={() => setPick(p.id)} data-testid={`st-card-${p.id}`}>
              <span className={css.pIcon} aria-hidden><AppIcon name={CAT_ICON[p.category ?? "custom"] ?? "date"} /></span>
              <span className={css.pText}>
                <strong>{p.name}</strong>
                <span>{hoursOf(p)}</span>
                {p.is_default ? <span className={chipSmNeutral}>{L("Default", "Lalai")}</span> : null}
              </span>
              {pick === p.id && <span className={css.pTick} aria-hidden><AppIcon name="success" /></span>}
            </button>
          ))}
          <button type="button" className={`${css.pcard} ${css.pNew}`} onClick={() => setTools(true)} data-testid="st-new-pattern">
            <AppIcon name="add" /><strong>{L("New Pattern", "Corak Baharu")}</strong>
          </button>
        </div>
      </section>

      <section className={card} aria-label={L("Assign shift templates", "Tetapkan templat syif")}>
        <div className={css.headRow}>
          <div>
            <h3 className={css.h3}>{L("Assign Shift Template", "Tetapkan Templat Syif")}</h3>
            <p className={css.hint}>{L("Select one or more staff, choose ONE pattern and the effective date, then review before assigning. Existing history is kept.", "Pilih seorang atau lebih kakitangan, pilih SATU corak dan tarikh berkuat kuasa, kemudian semak sebelum menetapkan. Sejarah sedia ada dikekalkan.")}</p>
          </div>
          <button type="button" className={btnSm} onClick={() => setTools(true)} data-testid="st-tools"><AppIcon name="edit" />{L("Patterns, single assign & history", "Corak, tetapan tunggal & sejarah")}</button>
        </div>
        <div className={css.filters}>
          <label className={css.search}><AppIcon name="search" /><input className={inputClassSm} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search staff…", "Cari kakitangan…")} aria-label={L("Search staff", "Cari kakitangan")} data-testid="st-search" /></label>
          <select className={selectClassSm} value={dept} onChange={(e) => setDept(e.target.value)} aria-label={L("Department", "Jabatan")} data-testid="st-dept">
            <option value="">{L("All departments", "Semua jabatan")}</option>
            {depts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className={selectClassSm} value={statusF} onChange={(e) => setStatusF(e.target.value as StatusF)} aria-label={L("Status", "Status")} data-testid="st-status">
            <option value="">{L("All statuses", "Semua status")}</option>
            <option value="assigned">{L("On a pattern", "Pada corak")}</option>
            <option value="default">{L("Default hours", "Waktu lalai")}</option>
            <option value="planned">{L("Change planned", "Perubahan dirancang")}</option>
          </select>
        </div>
        {bar}
        {from < tomorrow && <p className={css.warn} role="alert">{L(`A bulk assignment starts tomorrow (${dmy(tomorrow)}) or later.`, `Tetapan pukal bermula esok (${dmy(tomorrow)}) atau kemudian.`)}</p>}
        {problem && <p className={css.warn} role="alert" data-testid="st-problem">{problem}</p>}
        {result && (
          <p className={css.done} role="status" data-testid="st-result">
            <AppIcon name="success" />{L(`${result.saved ?? 0} assigned ${result.pattern.name} from ${dmy(result.effective_from)}`, `${result.saved ?? 0} ditetapkan ${result.pattern.name} dari ${dmy(result.effective_from)}`)}
            {result.counts.no_change ? L(` · ${result.counts.no_change} no change`, ` · ${result.counts.no_change} tiada perubahan`) : ""}
            {result.counts.conflict + result.counts.refused ? L(` · ${result.counts.conflict + result.counts.refused} not assigned`, ` · ${result.counts.conflict + result.counts.refused} tidak ditetapkan`) : ""}
          </p>
        )}
        <div className={`erp-table-scroll ${css.tableWrap}`}>
          <table className={css.table} data-testid="st-table">
            <thead>
              <tr>
                <th className={`${th} ${css.cCheck}`}><input type="checkbox" className={css.check} checked={allShown} ref={(el) => { if (el) el.indeterminate = !allShown && someShown; }} onChange={toggleShown}
                  aria-label={L(`Select all ${shown.length} shown`, `Pilih semua ${shown.length} yang ditunjuk`)} data-testid="st-all" /></th>
                <th className={th}>{L("Staff name", "Nama kakitangan")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Department", "Jabatan")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Current pattern", "Corak semasa")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Working hours", "Waktu bekerja")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Effective from", "Berkuat kuasa")}</th>
                <th className={`${th} ${css.cWide}`}>{L("Status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((s) => {
                const c = curOf(s.id);
                const nx = now.get(s.id)?.next ?? null;
                return (
                  <tr key={s.id} className={sel.has(s.id) ? css.on : undefined} data-testid={`st-row-${s.id}`}>
                    <td className={`${td} ${css.cCheck}`}><input type="checkbox" className={css.check} checked={sel.has(s.id)} onChange={() => toggle(s.id)} aria-label={L(`Select ${properName(s.name)}`, `Pilih ${properName(s.name)}`)} data-testid={`st-check-${s.id}`} /></td>
                    <td className={td}>
                      <span className={css.who}><Avatar name={properName(s.name)} userId={s.id} size="sm" />
                        <span className={css.whoText}><strong>{properName(s.name)}</strong><span className={css.phoneOnly}>{c.name} · {hoursOf(c.p)}</span></span></span>
                    </td>
                    <td className={`${td} ${css.cWide}`}>{s.department ? <span className={chipSmNeutral}>{s.department}</span> : "—"}</td>
                    <td className={`${td} ${css.cWide}`}><span className={css.pat}><AppIcon name={CAT_ICON[String(c.p?.category ?? "custom")] ?? "date"} />{c.name}</span></td>
                    <td className={`${td} ${css.cWide} ${css.num}`}>{hoursOf(c.p)}</td>
                    <td className={`${td} ${css.cWide} ${css.num}`}>{c.from ? dmy(c.from) : L("Default", "Lalai")}</td>
                    <td className={`${td} ${css.cWide}`}>{nx
                      ? <span className="erp-chip erp-chip-sm erp-chip-info">{L(`${nx.pattern_name} from ${dmy(nx.effective_from)}`, `${nx.pattern_name} dari ${dmy(nx.effective_from)}`)}</span>
                      : <span className="erp-chip erp-chip-sm erp-chip-success">{L("Active", "Aktif")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <p className={css.empty}>{L("No staff match this filter.", "Tiada kakitangan sepadan dengan penapis ini.")}</p>}
        </div>
        <div className={css.pager}>
          <span>{shown.length ? L(`Showing ${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, shown.length)} of ${shown.length} staff`, `Menunjukkan ${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, shown.length)} daripada ${shown.length} kakitangan`) : ""}</span>
          {shown.length > PAGE && !allShown && <button type="button" className={btnSmQuiet} onClick={toggleShown} data-testid="st-all-matching">{L(`Select all ${shown.length} matching`, `Pilih semua ${shown.length} yang sepadan`)}</button>}
          <span className={css.pages}>
            <button type="button" className={btnSmQuiet} disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={L("Previous page", "Halaman sebelum")}><AppIcon name="previous" /></button>
            <span className={chipSmNeutral}>{page} / {pages}</span>
            <button type="button" className={btnSmQuiet} disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label={L("Next page", "Halaman seterusnya")}><AppIcon name="next" /></button>
          </span>
        </div>
      </section>

      {review && (
        <SideDrawer open onClose={() => setReview(null)} title={L("Review before assigning", "Semak sebelum menetapkan")}
          subtitle={L("Confirm the staff, the shift pattern and the effective date.", "Sahkan kakitangan, corak syif dan tarikh berkuat kuasa.")}
          footer={<div className={css.footer}>
            <button type="button" className={btnSm} onClick={() => setReview(null)} data-testid="st-back">{L("Back", "Kembali")}</button>
            <button type="button" className={btnSmAccent} disabled={busy || !review.counts.change} onClick={() => void ask(false)} data-testid="st-confirm">
              {review.counts.change ? L(`Confirm bulk assignment (${review.counts.change})`, `Sahkan tetapan pukal (${review.counts.change})`) : L("Nothing to change", "Tiada untuk diubah")}</button>
          </div>}>
          <div className={css.review} data-testid="st-drawer">
            <dl className={css.summary}>
              <div><dt>{L("Selected staff", "Kakitangan dipilih")}</dt><dd>{L(`${review.rows.length} staff`, `${review.rows.length} kakitangan`)}</dd></div>
              <div><dt>{L("Shift pattern", "Corak syif")}</dt><dd>{review.pattern.name} · {hoursOf(patById.get(review.pattern.id))}</dd></div>
              <div><dt>{L("Effective from", "Berkuat kuasa dari")}</dt><dd>{longDay(review.effective_from)}</dd></div>
              <div><dt>{L("Existing history", "Sejarah sedia ada")}</dt><dd>{L("Preserved", "Dikekalkan")}</dd></div>
            </dl>
            <p className={css.counts} data-testid="st-counts">
              {L(`${review.counts.change} change · ${review.counts.no_change} no change · ${review.counts.conflict} conflict${review.counts.refused ? ` · ${review.counts.refused} not on staff` : ""}`,
                 `${review.counts.change} tukar · ${review.counts.no_change} tiada perubahan · ${review.counts.conflict} konflik${review.counts.refused ? ` · ${review.counts.refused} bukan kakitangan` : ""}`)}
            </p>
            <h4 className={css.h4}>{L("Staff affected", "Kakitangan terlibat")}</h4>
            <ul className={css.affected}>
              {review.rows.map((r) => (
                <li key={r.user_id} data-testid={`st-prev-${r.user_id}`} data-state={r.state}>
                  <span className={css.who}><Avatar name={properName(r.name ?? `#${r.user_id}`)} userId={r.user_id} size="sm" />
                    <span className={css.whoText}><strong>{properName(r.name ?? `#${r.user_id}`)}</strong>
                      <span>{r.previous ? r.previous.name : "—"} <AppIcon name="forward" /> {review.pattern.name} · {dmy(review.effective_from)}</span></span></span>
                  <span className={`erp-chip erp-chip-sm ${STATE[r.state][2]}`}>{L(STATE[r.state][0], STATE[r.state][1])}</span>
                  {(r.reason || r.warnings.length > 0) && (
                    <span className={css.notes}>
                      {r.reason && <span>{r.reason}</span>}
                      {r.warnings.map((w) => <span key={w} className={css.warnLine}><AppIcon name="warning" />{w}</span>)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className={css.note}><AppIcon name="info" />{L("A new assignment starts on its date. Days already worked, attendance, approved leave, payroll and exported reports keep the hours they were measured against.", "Tetapan baharu bermula pada tarikhnya. Hari yang telah dikerjakan, kehadiran, cuti yang diluluskan, gaji dan laporan yang dieksport mengekalkan waktu asal.")}</p>
          </div>
        </SideDrawer>
      )}

      {tools && (
        <SideDrawer open wide full onClose={() => { setTools(false); setTick((t) => t + 1); }} title={L("Patterns, single assign & history", "Corak, tetapan tunggal & sejarah")}
          subtitle={L("The existing editor and assignment history, unchanged.", "Penyunting dan sejarah tetapan sedia ada, tidak berubah.")}>
          <div data-testid="st-tools-drawer"><AttendanceAdminPanel role={role} areas={["hours"]} showPending={false} bare /></div>
        </SideDrawer>
      )}
    </div>
  );
}
