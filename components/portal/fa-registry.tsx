"use client";

/* v1.286.0 - FINANCIAL ADVISORY: BANKERS (the CEO, 12-11-2026: "proceed with
   Banker Registration, Branch Network & Smart Allocation Blueprint v1.1";
   claude/BANKER-REGISTRY-BLUEPRINT-v1.1.md, stage 1). Replaces the old
   free-text banker contacts with the ONE registry:

     Directory   every banker once: search, bank, state, product and status
                 filters; Register banker in four steps; one banker's record
                 with its verifications, where they work and the history
     Branches    each bank's branches, placed by state, district and city
                 from the place list; closed or renamed, never deleted
     Banks       the bank list and what each offers, at branches or centrally
     History     every registry change, append only

   Registering a banker never verifies them, never creates a login and
   never sends anything. Verification is two separate facts (contact
   identity, referral permission), each with its evidence and a review date,
   and nobody verifies a banker they registered themselves. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { atLeast, onBreakpoint } from "@/lib/breakpoints";
import { api, type ApiResult } from "@/lib/api";
import { dmy, dmyMYT, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { SideDrawer } from "@/components/ui/side-drawer";
import { LineTabs } from "@/components/ui/line-tabs";
import { AppIcon } from "@/components/ui/app-icon";
import { SkelRows } from "@/components/ui/skeleton";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { BankerMatching, type DsrPic } from "./fa-dsr";
import { btnSm, btnSmPrimary, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, selectClassSm, textareaClass } from "@/lib/ui-styles";
import css from "./financial-advisory.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Toast = (t: string, m: string, v?: "notice") => void;
type Err = { error?: { message?: string; code?: string }; existing?: { id: number; full_name?: string; bank?: string; name?: string } };
type Sub = "directory" | "branches" | "banks" | "history";

interface Bank { id: number; name: string; kind: string; status: string; website: string | null; source: string | null; last_verified_on: string | null; branches: number; bankers: number; retired_reason: string | null }
interface BankProduct { id: number; bank_id: number; product: string; channel: string; status: string; source: string | null }
interface Place { id: number; state: string; district: string; city: string }
interface Branch { id: number; bank_id: number; bank: string; name: string; code: string | null; address: string | null; postcode: string; state: string | null; district: string | null; city: string | null; phone: string | null; status: string; status_note: string | null; verified: number; last_verified_on: string | null; source: string | null; bankers: number }
interface Assignment { id: number; banker_id: number; branch_id: number | null; is_primary: number; coverage: string; coverage_areas: string | null; effective_from: string; branch: string | null; state: string | null; district: string | null }
interface Banker {
  id: number; bank_id: number; bank: string; full_name: string; position: string | null; work_email: string | null; work_phone: string | null; preferred_channel: string; relationship_type: string;
  owner_id: number | null; owner: string | null; case_limit: number | null; open_cases: number; status_now: string; availability_now: string; registered_by: number;
  identity: { verified_on: string; next_review_on: string; method: string; due: boolean } | null; referral: { verified_on: string; next_review_on: string; restrictions: string | null; due: boolean } | null;
  assignments: Assignment[]; products: string[]; last_contact_at?: string | null;
  /** v1.300.0 (D-3) - measured, never estimated: the median hours from an enquiry to the first feedback recorded on it; null below 3 */
  reply?: { median_hours: number | null; n: number };
}
/* v1.300.0 - the measured reply time in words, or why there is none */
const replyText = (b: Banker) => !b.reply || b.reply.n === 0 ? L("No enquiry answered yet", "Belum ada pertanyaan dijawab")
  : b.reply.median_hours == null ? L(`Not enough history (${b.reply.n} of 3 enquiries)`, `Sejarah belum cukup (${b.reply.n} daripada 3 pertanyaan)`)
    : b.reply.median_hours < 24 ? L(`Feedback ~${Math.max(1, Math.round(b.reply.median_hours))} h after an enquiry (median of ${b.reply.n})`, `Maklum balas ~${Math.max(1, Math.round(b.reply.median_hours))} j selepas pertanyaan (median ${b.reply.n})`)
      : L(`Feedback ~${Math.round(b.reply.median_hours / 24)} day(s) after an enquiry (median of ${b.reply.n})`, `Maklum balas ~${Math.round(b.reply.median_hours / 24)} hari selepas pertanyaan (median ${b.reply.n})`);
const PAGE = 20;
interface Registry { banks: Bank[]; products: BankProduct[]; localities: Place[]; branches: Branch[]; bankers: Banker[]; states: string[]; today: string; can: { register: boolean; manage: boolean } }

const PRODUCTS: [string, string, string][] = [["personal_financing", "Personal financing", "Pembiayaan peribadi"], ["debt_consolidation", "Debt consolidation", "Penyatuan hutang"]];
const productWord = (p: string) => { const x = PRODUCTS.find((r) => r[0] === p); return x ? L(x[1], x[2]) : p.replace(/_/g, " "); };
export const BANKER_STATUS: Record<string, [string, string, string]> = {
  pending_verification: ["Pending verification", "Menunggu pengesahan", chipSmWarn],
  verified: ["Verified", "Disahkan", chipSmSuccess],
  requires_reverification: ["Requires reverification", "Perlu disahkan semula", chipSmDanger],
  inactive: ["Inactive", "Tidak aktif", chipSmNeutral],
  no_longer_available: ["No longer available", "Tidak lagi tersedia", chipSmNeutral],
};
const AVAIL: Record<string, [string, string, string]> = {
  available: ["Available", "Tersedia", chipSmSuccess], limited: ["Limited capacity", "Kapasiti terhad", chipSmWarn],
  unavailable: ["Unavailable", "Tidak tersedia", chipSmDanger], unknown: ["Availability unknown", "Ketersediaan tidak diketahui", chipSmNeutral],
};
const RELATION: Record<string, [string, string]> = { direct: ["Direct contact", "Hubungan terus"], referral: ["Referral partner", "Rakan rujukan"], central_unit: ["Central unit", "Unit pusat"], other: ["Other", "Lain-lain"] };
const CHANNEL: Record<string, [string, string]> = { work_email: ["Work email", "E-mel kerja"], work_phone: ["Work phone", "Telefon kerja"], whatsapp_work: ["WhatsApp (work number)", "WhatsApp (nombor kerja)"], in_person: ["In person", "Bersemuka"] };
const METHOD: Record<string, [string, string]> = {
  call_branch_line: ["Called the branch's official line", "Panggil talian rasmi cawangan"], bank_domain_email: ["Email from the bank's own domain", "E-mel daripada domain bank"],
  in_person: ["Met at the branch", "Bertemu di cawangan"], written_letter: ["Letter from the bank", "Surat daripada bank"], other: ["Other (described below)", "Lain-lain (diterangkan di bawah)"],
};
const EVENT: Record<string, [string, string]> = {
  added: ["Added", "Ditambah"], verified: ["Verified", "Disahkan"], retired: ["Retired", "Ditamatkan"], product_set: ["Product set", "Produk ditetapkan"], product_retired: ["Product retired", "Produk ditamatkan"],
  renamed: ["Renamed", "Dinamakan semula"], status: ["Status changed", "Status ditukar"], registered: ["Registered", "Didaftarkan"], identity_verified: ["Contact identity verified", "Identiti kenalan disahkan"],
  referral_verified: ["Referral permission confirmed", "Kebenaran rujukan disahkan"], availability: ["Availability updated", "Ketersediaan dikemas kini"], transferred: ["Transferred", "Dipindahkan"],
  assignment_ended: ["Assignment ended", "Tugasan ditamatkan"], products: ["Products changed", "Produk ditukar"],
  edited: ["Details edited", "Butiran disunting"],
};
const ENTITY: Record<string, [string, string]> = { bank: ["Bank", "Bank"], branch: ["Branch", "Cawangan"], banker: ["Banker", "Pegawai bank"], locality: ["Place", "Tempat"] };
const chip = (map: Record<string, [string, string, string]>, k: string) => { const x = map[k] ?? [k, k, chipSmNeutral]; return <span className={`${x[2]} ${css.chip}`}>{L(x[0], x[1])}</span>; };
const areas = (s: string | null) => { try { const v = s ? (JSON.parse(s) as string[]) : []; return Array.isArray(v) ? v : []; } catch { return []; } };
const whereText = (a: Assignment) => a.branch_id == null ? L("Central channel", "Saluran pusat") : [a.branch, a.district, a.state].filter(Boolean).join(", ");
const coverText = (a: Assignment) => a.coverage === "national" ? L("national", "seluruh negara") : a.coverage === "branch" ? L("branch only", "cawangan sahaja") : areas(a.coverage_areas).join(", ");
const errMsg = (d: unknown) => (d as Err | null)?.error?.message ?? L("Please try again.", "Sila cuba lagi.");

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: Err | null }> {
  const r = await api<Err>(path, { method: "POST", body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 400), data: (r.data as Err | null) ?? null };
}

export function BankerRegistry({ toast, openCase }: { toast: Toast; openCase?: (id: number, tab?: string) => void }) {
  const [sub, setSub] = useState<Sub>("directory");
  const [data, setData] = useState<Registry | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true;
    void api<Registry>("/staff/fa/registry").then((r) => { if (!live) return; if (r.ok && r.data) { setData(r.data); setFailed(false); } else setFailed(true); });
    return () => { live = false; };
  }, [tick]);
  const due = (data?.bankers ?? []).filter((b) => b.status_now === "pending_verification" || b.status_now === "requires_reverification").length;
  return (
    <div className={css.stack} data-testid="fa-registry">
      <LineTabs value={sub} onChange={setSub} label={L("Bankers", "Pegawai bank")} tabs={[
        ["directory", L("Banker directory", "Direktori pegawai bank"), due || null, L("Directory", "Direktori")],
        ["branches", L("Branch registry", "Daftar cawangan"), null, L("Branches", "Cawangan")],
        ["banks", L("Bank registry", "Daftar bank"), null, L("Banks", "Bank")],
        ["history", L("Audit history", "Sejarah audit"), null, L("History", "Sejarah")],
      ]} />
      {failed ? (
        <div className={`${card} ${css.sec}`}><p className={css.empty}>{L("The banker registry could not load.", "Daftar pegawai bank tidak dapat dimuatkan.")}</p><button type="button" className={btnSm} onClick={reload}>{L("Try again", "Cuba lagi")}</button></div>
      ) : !data ? <div className={`${card} ${css.sec}`}><SkelRows rows={5} /></div> : (
        <>
          {sub === "directory" && <Directory data={data} toast={toast} reload={reload} openCase={openCase} />}
          {sub === "branches" && <Branches data={data} toast={toast} reload={reload} />}
          {sub === "banks" && <Banks data={data} toast={toast} reload={reload} />}
          {sub === "history" && <History />}
        </>
      )}
    </div>
  );
}

/* ============================ the directory ============================ */

/* v1.290.0 (image 04, G4) - the directory's five words, each from the facts:
   Ready = verified and in date, available or limited, under any case limit;
   Needs verification = pending or due again (a changed contact included);
   On hold = unavailable, or at the case limit; Inactive = inactive or left.
   "Active" is not used: it would read as "verified". */
export type DirFilter = "all" | "ready" | "verify" | "hold" | "inactive";
const atLimit = (b: Banker) => b.case_limit != null && (b.open_cases ?? 0) >= b.case_limit;
export function dirGroup(b: Banker): DirFilter | null {
  if (b.status_now === "inactive" || b.status_now === "no_longer_available") return "inactive";
  if (b.status_now === "pending_verification" || b.status_now === "requires_reverification") return "verify";
  if (b.availability_now === "unavailable" || atLimit(b)) return "hold";
  if (b.status_now === "verified" && (b.availability_now === "available" || b.availability_now === "limited")) return "ready";
  return null; /* verified, availability unknown: listed under All only */
}
export const bkId = (id: number) => `BK-${String(id).padStart(6, "0")}`;
const useXl = () => useSyncExternalStore((cb) => onBreakpoint("xl", () => cb()), () => atLeast("xl"), () => false);

function Directory({ data, toast, reload, openCase }: { data: Registry; toast: Toast; reload: () => void; openCase?: (id: number, tab?: string) => void }) {
  const [q, setQ] = useState("");
  const [bank, setBank] = useState("");
  const [state, setState] = useState("");
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState<DirFilter>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [registering, setRegistering] = useState(false);
  /* v1.300.0 - FA 2.0 phase 3 (photo 3): the directory on the left, client-to-banker matching (or the banker's profile) on the right */
  const [right, setRight] = useState<"match" | "profile">("match");
  const [page, setPage] = useState(0);
  const [compare, setCompare] = useState<number[]>([]);
  const [comparing, setComparing] = useState(false);
  const xl = useXl();
  const base = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.bankers.filter((b) => (!t || `${b.full_name} ${bkId(b.id)} ${b.bank} ${b.position ?? ""} ${b.assignments.map(whereText).join(" ")}`.toLowerCase().includes(t))
      && (!bank || String(b.bank_id) === bank)
      && (!state || b.assignments.some((a) => a.state === state || (a.coverage === "states" && areas(a.coverage_areas).includes(state)) || a.coverage === "national"))
      && (!product || b.products.includes(product)));
  }, [data.bankers, q, bank, state, product]);
  const count = (f: DirFilter) => base.filter((b) => (f === "all" ? b.status_now !== "no_longer_available" : dirGroup(b) === f)).length;
  const rows = base.filter((b) => (status === "all" ? b.status_now !== "no_longer_available" : dirGroup(b) === status));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = rows.slice(pg * PAGE, pg * PAGE + PAGE);
  const pick = (id: number) => { setOpen(id); setRight("profile"); };
  const toggleCompare = (id: number) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 3 ? c : [...c, id]));
  /* a large desktop: the directory, the profile and the cases side by side (G1); smaller: the record opens as a sheet */
  const selected = xl ? (open != null && rows.some((b) => b.id === open) ? open : rows[0]?.id ?? null) : open;
  return (
    <div className={css.stack}>
    <KpiRow label={L("Banker counts", "Kiraan pegawai bank")}>
      <KpiTile icon="users" tone="navy" label={L("Total bankers", "Jumlah pegawai bank")} value={count("all")} onClick={() => { setStatus("all"); setPage(0); }} />
      <KpiTile icon="success" tone="green" label={L("Ready", "Sedia")} value={count("ready")} sub={L("Verified and available", "Disahkan dan ada")} onClick={() => { setStatus("ready"); setPage(0); }} />
      <KpiTile icon="pending" tone="gold" label={L("On hold", "Ditahan")} value={count("hold")} sub={L("Unavailable or at their case limit", "Tiada atau had kes penuh")} onClick={() => { setStatus("hold"); setPage(0); }} />
      <KpiTile icon="warning" tone="red" label={L("Needs verification", "Perlu pengesahan")} value={count("verify")} onClick={() => { setStatus("verify"); setPage(0); }} />
    </KpiRow>
    <div className={xl ? css.bkWs2 : css.stack} data-testid="fa-banker-ws">
    <section className={`${card} ${css.sec}`} aria-label={L("Banker directory", "Direktori pegawai bank")} data-testid="fa-directory">
      <div className={css.head}>
        <h3 className={css.h}><AppIcon name="users" />{L("Banker directory", "Direktori pegawai bank")} <span className={css.sub}>{rows.length} / {data.bankers.length}</span></h3>
        {data.can.register && <button type="button" className={btnSmPrimary} onClick={() => setRegistering(true)} data-testid="fa-register"><AppIcon name="add" />{L("Register banker", "Daftar pegawai bank")}</button>}
      </div>
      <p className={css.sub}>{L("Registering a banker gives them no portal access and sends them nothing. A banker is used only once verified, and only within their recorded products and areas.", "Mendaftar pegawai bank tidak memberi akses portal dan tidak menghantar apa-apa. Pegawai bank digunakan hanya selepas disahkan, dan hanya dalam produk dan kawasan yang direkod.")}</p>
      <div className={css.tools}>
        <input className={inputClassSm} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("Search name, bank or branch", "Cari nama, bank atau cawangan")} aria-label={L("Search bankers", "Cari pegawai bank")} />
        <select className={selectClassSm} value={bank} onChange={(e) => setBank(e.target.value)} aria-label={L("Bank", "Bank")}><option value="">{L("All banks", "Semua bank")}</option>{data.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select className={selectClassSm} value={state} onChange={(e) => setState(e.target.value)} aria-label={L("State", "Negeri")}><option value="">{L("All states", "Semua negeri")}</option>{data.states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className={selectClassSm} value={product} onChange={(e) => setProduct(e.target.value)} aria-label={L("Product", "Produk")}><option value="">{L("All products", "Semua produk")}</option>{PRODUCTS.map(([k]) => <option key={k} value={k}>{productWord(k)}</option>)}</select>
      </div>
      <LineTabs value={status} onChange={(v) => { setStatus(v); setPage(0); }} label={L("Show bankers", "Tunjuk pegawai bank")} tabs={[
        ["all", L("All", "Semua"), count("all")], ["ready", L("Ready", "Sedia"), count("ready")], ["verify", L("Needs verification", "Perlu pengesahan"), count("verify") || null, L("Verify", "Sahkan")],
        ["hold", L("On hold", "Ditahan"), count("hold") || null], ["inactive", L("Inactive", "Tidak aktif"), count("inactive") || null],
      ]} />
      {data.bankers.length === 0 ? <p className={css.empty}>{data.banks.length === 0 ? L("No bank in the registry yet. Management adds the banks first (Bank registry), then their branches.", "Belum ada bank dalam daftar. Pengurusan menambah bank dahulu (Daftar bank), kemudian cawangan.") : L("No banker registered yet.", "Belum ada pegawai bank didaftarkan.")}</p>
        : rows.length === 0 ? <p className={css.empty}>{L("No banker matches these filters.", "Tiada pegawai bank sepadan dengan penapis ini.")}</p> : (
          <ul className={css.rows}>{shown.map((b) => {
            const primary = b.assignments.find((a) => a.is_primary) ?? b.assignments[0];
            return (
              <li key={b.id} className={css.bkLi}>
                <button type="button" className={`${css.bankerRow} ${xl ? css.bankerRowSm : ""} ${xl && right === "profile" && selected === b.id ? css.bankerOn : ""}`} aria-current={xl && right === "profile" && selected === b.id ? "true" : undefined} onClick={() => pick(b.id)} data-testid="fa-banker">
                  <span className={css.who}><b>{b.full_name}</b><span className={css.sub}>{bkId(b.id)} · {[b.position, b.bank].filter(Boolean).join(" · ")}</span></span>
                  <span className={css.who}><span className={css.sub}>{primary ? whereText(primary) : L("No current branch", "Tiada cawangan semasa")}</span><span className={css.sub}>{b.products.map(productWord).join(" · ")}</span></span>
                  <span className={css.chips}>{chip(BANKER_STATUS, b.status_now)}{b.status_now === "verified" || b.status_now === "requires_reverification" ? chip(AVAIL, b.availability_now) : null}</span>
                  <span className={css.when}><span>{b.last_contact_at ? `${L("Last contact", "Hubungan terakhir")} ${dmyMYT(b.last_contact_at)}` : L("Not contacted yet", "Belum dihubungi")}</span><span data-testid="fa-banker-reply">{replyText(b)}</span></span>
                </button>
                <label className={css.bkCmp} title={L("Compare up to three bankers", "Banding sehingga tiga pegawai bank")}><input type="checkbox" checked={compare.includes(b.id)} disabled={!compare.includes(b.id) && compare.length >= 3} onChange={() => toggleCompare(b.id)} data-testid="fa-compare-pick" /> {L("Compare", "Banding")}</label>
              </li>
            );
          })}</ul>
        )}
      {rows.length > PAGE && (
        <div className={css.pager} data-testid="fa-banker-pager">
          <span className={css.sub}>{L(`Showing ${pg * PAGE + 1}-${Math.min(rows.length, pg * PAGE + PAGE)} of ${rows.length}`, `Menunjukkan ${pg * PAGE + 1}-${Math.min(rows.length, pg * PAGE + PAGE)} daripada ${rows.length}`)}</span>
          <span className={css.inline}><button type="button" className={btnSm} disabled={pg === 0} onClick={() => setPage(pg - 1)}>{L("Previous", "Sebelum")}</button><button type="button" className={btnSm} disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>{L("Next", "Seterusnya")}</button></span>
        </div>
      )}
      {compare.length > 0 && (
        <div className={css.row} data-testid="fa-compare-bar">
          <button type="button" className={btnSmPrimary} disabled={compare.length < 2} onClick={() => setComparing(true)} data-testid="fa-compare-open">{L(`Compare ${compare.length}`, `Banding ${compare.length}`)}</button>
          <button type="button" className={btnSmQuiet} onClick={() => setCompare([])}>{L("Clear", "Kosongkan")}</button>
          {compare.length < 2 && <span className={css.sub}>{L("Pick at least two.", "Pilih sekurang-kurangnya dua.")}</span>}
        </div>
      )}
      {comparing && <Compare bankers={data.bankers.filter((b) => compare.includes(b.id))} onClose={() => setComparing(false)} />}
      {registering && <Register data={data} toast={toast} onClose={() => setRegistering(false)} done={(id) => { setRegistering(false); reload(); setOpen(id); }} openExisting={(id) => { setRegistering(false); setOpen(id); }} />}
      {!xl && open != null && <BankerRecord id={open} data={data} toast={toast} onClose={() => setOpen(null)} changed={reload} openCase={openCase} />}
    </section>
    {/* the right side: client-to-banker matching (the photo) or the chosen banker's profile; below xl the matching sits under the directory and a profile opens as a sheet */}
    <div className={css.stack}>
      {xl && (
        <div className={css.seg} role="group" aria-label={L("Right panel", "Panel kanan")} data-testid="fa-bk-right">
          <button type="button" aria-pressed={right === "match"} className={right === "match" ? css.segOn : ""} onClick={() => setRight("match")}>{L("Client-to-banker matching", "Padanan pelanggan-pegawai bank")}</button>
          <button type="button" aria-pressed={right === "profile"} className={right === "profile" ? css.segOn : ""} onClick={() => setRight("profile")}>{L("Banker profile", "Profil pegawai bank")}</button>
        </div>
      )}
      {(!xl || right === "match") && <MatchPanel toast={toast} openCase={openCase} />}
      {xl && right === "profile" && (selected != null
        ? <BankerRecord key={selected} id={selected} data={data} toast={toast} onClose={() => setOpen(null)} changed={reload} openCase={openCase} inline />
        : <section className={`${card} ${css.sec}`}><p className={css.empty}>{L("Choose a banker.", "Pilih pegawai bank.")}</p></section>)}
    </div>
    </div>
    </div>
  );
}

/* v1.300.0 - FA 2.0 phase 3: COMPARE two or three bankers side by side - the
   registry's own facts only (bank, branch, products, coverage, verification,
   availability and case load, last contact, the measured reply time). No
   score, no approval rate. */
function Compare({ bankers, onClose }: { bankers: Banker[]; onClose: () => void }) {
  const rowsOf: [string, (b: Banker) => React.ReactNode][] = [
    [L("Bank", "Bank"), (b) => b.bank],
    [L("Branch / coverage", "Cawangan / liputan"), (b) => b.assignments.map(whereText).join("; ") || L("No current branch", "Tiada cawangan semasa")],
    [L("Products", "Produk"), (b) => b.products.map(productWord).join(", ") || "—"],
    [L("Verification", "Pengesahan"), (b) => <>{chip(BANKER_STATUS, b.status_now)} <span className={css.sub}>{b.identity ? `${L("identity to", "identiti hingga")} ${dmy(b.identity.next_review_on)}` : ""}{b.referral ? ` · ${L("referral to", "rujukan hingga")} ${dmy(b.referral.next_review_on)}` : ""}</span></>],
    [L("Availability", "Ketersediaan"), (b) => <>{chip(AVAIL, b.availability_now)} <span className={css.sub}>{b.open_cases}{b.case_limit != null ? ` / ${b.case_limit}` : ""} {L("open cases", "kes terbuka")}</span></>],
    [L("Last contact", "Hubungan terakhir"), (b) => (b.last_contact_at ? dmyMYT(b.last_contact_at) : L("Not contacted yet", "Belum dihubungi"))],
    [L("Reply time (measured)", "Masa balas (diukur)"), (b) => replyText(b)],
    [L("Relationship owner", "Pemilik hubungan"), (b) => b.owner ?? "—"],
  ];
  return (
    <SideDrawer open onClose={onClose} wide title={L("Compare bankers", "Banding pegawai bank")} subtitle={L("Registry facts only - no score, no approval rate", "Fakta daftar sahaja - tiada skor, tiada kadar kelulusan")}>
      <div className={css.dsrTableWrap} data-testid="fa-compare">
        <table className={css.dsrTable}>
          <thead><tr><th>{L("Fact", "Fakta")}</th>{bankers.map((b) => <th key={b.id}>{b.full_name}<br /><span className={css.sub}>{bkId(b.id)}</span></th>)}</tr></thead>
          <tbody>{rowsOf.map(([k, f]) => <tr key={k}><td><b>{k}</b></td>{bankers.map((b) => <td key={b.id}>{f(b)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </SideDrawer>
  );
}

/* v1.300.0 - FA 2.0 phase 3 (photo 3, right side): CLIENT-TO-BANKER MATCHING
   beside the directory. Pick a case whose DSR assessment Management decided
   Proceed on; the case's own Banker matching (fa-dsr.tsx BankerMatching - the
   ONE matching screen, reused) runs here: verified criteria, coverage,
   verification, availability, tiers and reasons - never a percentage.
   Proposing sends nothing; documents go only under the client's consent. */
interface MatchRow { id: number; case_ref: string; client: string | null; product: string; stage: string; projected_dsr_bp: number | null; review_action?: string | null; banker?: string | null }
function MatchPanel({ toast, openCase }: { toast: Toast; openCase?: (id: number, tab?: string) => void }) {
  const [cases, setCases] = useState<MatchRow[] | null>(null);
  const [id, setId] = useState<number | null>(null);
  const [pic, setPic] = useState<DsrPic | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { let live = true; void api<{ cases: MatchRow[] }>("/staff/fa/cases").then((r) => { if (live && r.ok && r.data) setCases(r.data.cases.filter((c) => c.stage !== "closed" && c.review_action === "proceed")); }); return () => { live = false; }; }, [tick]);
  useEffect(() => { if (id == null) return; let live = true; void api<DsrPic>(`/staff/fa/cases/${id}`).then((r) => { if (live && r.ok && r.data) setPic(r.data); }); return () => { live = false; }; }, [id, tick]);
  const post = async (call: Promise<ApiResult<Err>>, done: string) => {
    const r = await call;
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), (r.data as Err | null)?.error?.message ?? L("Try again", "Cuba lagi"), "notice"); return false; }
    toast(L("Saved", "Disimpan"), done); setTick((x) => x + 1); return true;
  };
  const row = cases?.find((c) => c.id === id) ?? null;
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Client-to-banker matching", "Padanan pelanggan-pegawai bank")} data-testid="fa-match-panel">
      <h3 className={css.h}><AppIcon name="target" />{L("Client-to-banker matching", "Padanan pelanggan-pegawai bank")}</h3>
      <p className={css.sub}>{L("Recommended from the case's verified bank criteria, the banker's coverage, verification and availability - in tiers with reasons, never a match percentage or an approval chance.", "Disyorkan daripada kriteria bank disahkan, liputan, pengesahan dan ketersediaan pegawai - dalam tahap dengan sebab, tidak sekali-kali peratusan padanan atau peluang kelulusan.")}</p>
      {!cases ? <SkelRows rows={2} /> : cases.length === 0 ? <p className={css.empty}>{L("No case is ready for matching. A case opens here after Management decides Proceed on its DSR assessment.", "Tiada kes sedia untuk padanan. Kes dibuka di sini selepas Pengurusan memutuskan Teruskan pada penilaian DSR.")}</p> : (
        <label className={css.field}>{L("Case ready for matching", "Kes sedia untuk padanan")}
          <select className={selectClassSm} value={id ?? ""} onChange={(e) => { setPic(null); setId(e.target.value ? Number(e.target.value) : null); }} data-testid="fa-match-case">
            <option value="">—</option>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.case_ref} · {c.client ?? ""}</option>)}
          </select>
        </label>
      )}
      {row && (
        <dl className={css.bkCaseHead} data-testid="fa-match-head">
          <div><dt>{L("Client", "Pelanggan")}</dt><dd>{row.client ?? "—"} · {row.case_ref}</dd></div>
          <div><dt>{L("Case type", "Jenis kes")}</dt><dd>{productWord(row.product)}</dd></div>
          <div><dt>DSR</dt><dd>{row.projected_dsr_bp == null ? "—" : `${(row.projected_dsr_bp / 100).toFixed(1)}%`} <span className={css.sub}>{L("projected", "unjuran")}</span></dd></div>
          <div><dt>{L("Banker", "Pegawai bank")}</dt><dd>{row.banker ?? L("None yet", "Belum ada")}</dd></div>
        </dl>
      )}
      {id != null && (!pic ? <SkelRows rows={3} /> : <BankerMatching pic={pic} post={post} toast={toast} />)}
      {id != null && openCase && <button type="button" className={btnSmQuiet} onClick={() => openCase(id, "matching")}>{L("Open the whole case", "Buka seluruh kes")}</button>}
    </section>
  );
}

type Assign = { branch_id: number | null; coverage: string; areas: string; primary: boolean };
const blankAssign = (): Assign => ({ branch_id: null, coverage: "branch", areas: "", primary: true });

function Register({ data, toast, onClose, done, openExisting }: { data: Registry; toast: Toast; onClose: () => void; done: (id: number) => void; openExisting: (id: number) => void }) {
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ bank_id: "", full_name: "", position: "", work_email: "", work_phone: "", preferred_channel: "work_email", relationship_type: "direct", products: [] as string[], notes: "", different_reason: "" });
  const [where, setWhere] = useState<Assign[]>([blankAssign()]);
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<{ code: string; message: string; id?: number } | null>(null);
  const banks = data.banks.filter((b) => b.status !== "retired");
  const bankId = Number(f.bank_id) || null;
  const offered = data.products.filter((p) => p.bank_id === bankId && p.status === "active");
  const central = offered.some((p) => p.channel === "central");
  const branches = data.branches.filter((b) => b.bank_id === bankId && b.status !== "closed");
  const sameName = f.full_name.trim().length > 2 ? data.bankers.filter((b) => b.full_name.toLowerCase().replace(/[^a-z]+/g, " ").trim() === f.full_name.toLowerCase().replace(/[^a-z]+/g, " ").trim()) : [];
  const set = (k: keyof typeof f, v: string | string[]) => { setF({ ...f, [k]: v }); setDup(null); };
  const ok1 = !!bankId && f.full_name.trim().length >= 3;
  const ok2 = !!(f.work_email.trim() || f.work_phone.trim()) && (!f.work_email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.work_email.trim()));
  const ok3 = f.products.length > 0 && where.length > 0 && where.every((a) => (a.branch_id != null || central) && (a.coverage === "branch" || a.coverage === "national" || a.areas.trim()));
  const save = async () => {
    setBusy(true);
    const r = await post("/staff/fa/bankers", {
      bank_id: bankId, full_name: f.full_name, position: f.position || undefined, work_email: f.work_email || undefined, work_phone: f.work_phone || undefined,
      preferred_channel: f.preferred_channel, relationship_type: f.relationship_type, products: f.products, notes: f.notes || undefined, different_reason: f.different_reason || undefined,
      assignments: where.map((a, i) => ({ branch_id: a.branch_id, coverage: a.branch_id == null && a.coverage === "branch" ? "national" : a.coverage, areas: a.areas.split(",").map((x) => x.trim()).filter(Boolean), primary: i === 0 })),
    });
    setBusy(false);
    if (!r.ok) {
      const code = r.data?.error?.code ?? "";
      if (code === "duplicate_banker" || code === "possible_duplicate") { setDup({ code, message: errMsg(r.data), id: r.data?.existing?.id }); return; }
      toast(L("Not registered", "Tidak didaftarkan"), errMsg(r.data), "notice"); return;
    }
    toast(L("Banker registered", "Pegawai bank didaftarkan"), L("Pending verification - management verifies before use.", "Menunggu pengesahan - pengurusan mengesahkan sebelum digunakan."));
    done(Number((r.data as unknown as { id: number }).id));
  };
  const STEPS: [number, string, string][] = [[1, "Bank and person", "Bank dan individu"], [2, "Work contact", "Hubungan kerja"], [3, "Where and what", "Di mana dan apa"], [4, "Review", "Semak"]];
  return (
    <SideDrawer open onClose={onClose} dirty={!!(f.full_name || f.work_email || f.work_phone)} title={L("Register banker", "Daftar pegawai bank")} subtitle={`${L("Step", "Langkah")} ${step} / 4 · ${L(STEPS[step - 1]![1], STEPS[step - 1]![2])}`}
      footer={(
        <div className={css.row}>
          {step > 1 && <button type="button" className={btnSmQuiet} onClick={() => setStep(step - 1)}>{L("Back", "Kembali")}</button>}
          {step < 4 && <button type="button" className={btnSmPrimary} data-testid="fa-reg-next" disabled={step === 1 ? !ok1 : step === 2 ? !ok2 : !ok3} onClick={() => setStep(step + 1)}>{L("Next", "Seterusnya")}</button>}
          {step === 4 && <button type="button" className={btnSmPrimary} data-testid="fa-reg-save" disabled={busy || !ok1 || !ok2 || !ok3 || (dup?.code === "possible_duplicate" && f.different_reason.trim().length < 10) || dup?.code === "duplicate_banker"} onClick={() => void save()}>{busy ? L("Registering…", "Mendaftar…") : L("Register as pending", "Daftar sebagai menunggu")}</button>}
        </div>
      )}>
      <div className={css.stack}>
        <ol className={css.steps} aria-label={L("Steps", "Langkah")}>{STEPS.map(([n, en, ms]) => <li key={n} className={n === step ? css.now : n < step ? css.done : css.todo} aria-current={n === step ? "step" : undefined}>{n}. {L(en, ms)}</li>)}</ol>
        {step === 1 && (
          <div className={css.form}>
            <label className={css.field}>{L("Bank (from the registry)", "Bank (daripada daftar)")}
              <select className={selectClassSm} value={f.bank_id} onChange={(e) => { setF({ ...f, bank_id: e.target.value, products: [] }); setWhere([blankAssign()]); setDup(null); }} data-testid="fa-reg-bank">
                <option value="">—</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}{b.status === "pending" ? ` (${L("bank not yet verified", "bank belum disahkan")})` : ""}</option>)}
              </select></label>
            <label className={css.field}>{L("Full name", "Nama penuh")}<input className={inputClassSm} value={f.full_name} maxLength={120} onChange={(e) => set("full_name", e.target.value)} data-testid="fa-reg-name" /></label>
            <label className={css.field}>{L("Position", "Jawatan")}<input className={inputClassSm} value={f.position} maxLength={80} onChange={(e) => set("position", e.target.value)} placeholder={L("e.g. Relationship manager", "cth. Pengurus perhubungan")} /></label>
            {banks.length === 0 && <p className={`erp-note ${css.wide}`}>{L("There is no bank in the registry yet. The CEO or COO adds it first.", "Belum ada bank dalam daftar. CEO atau COO menambahnya dahulu.")}</p>}
            {sameName.length > 0 && <p className={`erp-note ${css.wide}`} data-testid="fa-reg-samename">{L("Someone with this name is already in the directory:", "Seseorang dengan nama ini sudah ada dalam direktori:")} {sameName.map((b) => `${b.full_name} (${b.bank})`).join("; ")}. {L("A name alone never merges records - check the work contact.", "Nama sahaja tidak menggabungkan rekod - semak hubungan kerja.")}</p>}
          </div>
        )}
        {step === 2 && (
          <div className={css.form}>
            <label className={css.field}>{L("Work email", "E-mel kerja")}<input className={inputClassSm} type="email" value={f.work_email} maxLength={160} onChange={(e) => set("work_email", e.target.value)} data-testid="fa-reg-email" /></label>
            <label className={css.field}>{L("Work phone", "Telefon kerja")}<input className={inputClassSm} inputMode="tel" value={f.work_phone} maxLength={40} onChange={(e) => set("work_phone", e.target.value)} data-testid="fa-reg-phone" /></label>
            <label className={css.field}>{L("Preferred channel", "Saluran pilihan")}<select className={selectClassSm} value={f.preferred_channel} onChange={(e) => set("preferred_channel", e.target.value)}>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></label>
            <label className={css.field}>{L("Relationship", "Hubungan")}<select className={selectClassSm} value={f.relationship_type} onChange={(e) => set("relationship_type", e.target.value)}>{Object.entries(RELATION).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></label>
            <p className={`erp-note ${css.wide}`}>{L("Work contact only - never a personal number, a password or an online-banking login.", "Hubungan kerja sahaja - bukan nombor peribadi, kata laluan atau log masuk perbankan.")}</p>
          </div>
        )}
        {step === 3 && (
          <div className={css.stack}>
            <fieldset className={css.fieldset}><legend>{L("Products this banker handles", "Produk yang dikendalikan")}</legend>
              {offered.length === 0 ? <span className={css.sub}>{L("This bank has no product in the registry yet - management adds it in Bank registry.", "Bank ini belum ada produk dalam daftar - pengurusan menambahnya dalam Daftar bank.")}</span>
                : offered.map((p) => <label key={p.product} className={css.check}><input type="checkbox" checked={f.products.includes(p.product)} onChange={(e) => set("products", e.target.checked ? [...f.products, p.product] : f.products.filter((x) => x !== p.product))} /> {productWord(p.product)}{p.channel === "central" ? ` (${L("central", "pusat")})` : ""}</label>)}
            </fieldset>
            {where.map((a, i) => (
              <fieldset key={i} className={css.fieldset} data-testid="fa-reg-where"><legend>{i === 0 ? L("Primary place of work", "Tempat kerja utama") : L("Also covers", "Juga meliputi")}</legend>
                <div className={css.form}>
                  <label className={css.field}>{L("Branch", "Cawangan")}
                    <select className={selectClassSm} value={a.branch_id == null ? "" : String(a.branch_id)} onChange={(e) => setWhere(where.map((x, j) => (j === i ? { ...x, branch_id: e.target.value ? Number(e.target.value) : null } : x)))} data-testid="fa-reg-branch">
                      <option value="">{central ? L("Central channel (no branch)", "Saluran pusat (tiada cawangan)") : "—"}</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name} · {[b.city, b.state].filter(Boolean).join(", ")} {b.postcode}</option>)}
                    </select></label>
                  <label className={css.field}>{L("Coverage", "Liputan")}
                    <select className={selectClassSm} value={a.coverage} onChange={(e) => setWhere(where.map((x, j) => (j === i ? { ...x, coverage: e.target.value } : x)))}>
                      <option value="branch">{L("This branch only", "Cawangan ini sahaja")}</option><option value="districts">{L("Districts", "Daerah")}</option><option value="states">{L("States", "Negeri")}</option><option value="national">{L("National", "Seluruh negara")}</option>
                    </select></label>
                  {(a.coverage === "districts" || a.coverage === "states") && (
                    <label className={`${css.field} ${css.wide}`}>{a.coverage === "states" ? L("States, separated by commas (e.g. JOHOR, MELAKA)", "Negeri, dipisah koma (cth. JOHOR, MELAKA)") : L("Districts, separated by commas", "Daerah, dipisah koma")}
                      <input className={inputClassSm} value={a.areas} maxLength={300} list={a.coverage === "states" ? "fa-states" : "fa-districts"} onChange={(e) => setWhere(where.map((x, j) => (j === i ? { ...x, areas: e.target.value } : x)))} /></label>
                  )}
                </div>
                {i > 0 && <button type="button" className={btnSmQuiet} onClick={() => setWhere(where.filter((_, j) => j !== i))}>{L("Remove", "Buang")}</button>}
              </fieldset>
            ))}
            <datalist id="fa-states">{data.states.map((s) => <option key={s} value={s} />)}</datalist>
            <datalist id="fa-districts">{[...new Set(data.localities.map((l) => l.district))].map((d) => <option key={d} value={d} />)}</datalist>
            {where.length < 4 && <button type="button" className={btnSmQuiet} onClick={() => setWhere([...where, { ...blankAssign(), primary: false }])}><AppIcon name="add" />{L("Add another branch or area", "Tambah cawangan atau kawasan lain")}</button>}
          </div>
        )}
        {step === 4 && (
          <div className={css.stack}>
            <dl className={css.kv}>
              <div><dt>{L("Banker", "Pegawai bank")}</dt><dd>{f.full_name}{f.position ? ` · ${f.position}` : ""}</dd></div>
              <div><dt>{L("Bank", "Bank")}</dt><dd>{banks.find((b) => b.id === bankId)?.name}</dd></div>
              <div><dt>{L("Work contact", "Hubungan kerja")}</dt><dd className={css.lines}>{[f.work_email, f.work_phone].filter(Boolean).join(" · ")}</dd></div>
              <div><dt>{L("Products", "Produk")}</dt><dd>{f.products.map(productWord).join(", ")}</dd></div>
            </dl>
            <label className={css.field}>{L("Notes (optional, no client details)", "Nota (pilihan, tiada butiran pelanggan)")}<textarea className={textareaClass} rows={2} maxLength={600} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
            {dup?.code === "duplicate_banker" && (
              <div className="erp-note" data-testid="fa-reg-dup"><p>{dup.message}</p>{dup.id != null && <button type="button" className={btnSmPrimary} onClick={() => openExisting(dup.id!)}>{L("Open that record", "Buka rekod itu")}</button>}</div>
            )}
            {dup?.code === "possible_duplicate" && (
              <div className="erp-note" data-testid="fa-reg-possible"><p>{dup.message}</p>
                {dup.id != null && <button type="button" className={btnSm} onClick={() => openExisting(dup.id!)}>{L("Open that record", "Buka rekod itu")}</button>}
                <label className={css.field}>{L("Why this is a different person (at least 10 characters)", "Mengapa ini individu berbeza (sekurang-kurangnya 10 aksara)")}<input className={inputClassSm} value={f.different_reason} maxLength={300} onChange={(e) => setF({ ...f, different_reason: e.target.value })} data-testid="fa-reg-reason" /></label>
              </div>
            )}
            <p className="erp-note">{L("Saved as Pending verification. The CEO or COO verifies the contact identity separately - never the person who registered it. Nothing is sent to the banker.", "Disimpan sebagai Menunggu pengesahan. CEO atau COO mengesahkan identiti kenalan secara berasingan - bukan individu yang mendaftar. Tiada apa-apa dihantar kepada pegawai bank.")}</p>
          </div>
        )}
      </div>
    </SideDrawer>
  );
}

interface Record_ { banker: Banker & { notes: string | null; registered_by_name: string | null; status_reason: string | null; created_at: string; unavailable_until: string | null; duplicate_reason: string | null; contact_changed_at?: string | null; last_contact_at?: string | null }; verifications: { id: number; fact: string; method: string; evidence: string; restrictions: string | null; verified_on: string; next_review_on: string; verified_by_name: string | null; created_at?: string }[]; assignments: (Assignment & { ended_on: string | null; end_reason: string | null; city: string | null })[]; events: { id: number; event: string; detail: string | null; created_at: string; actor: string | null }[]; today: string; owners?: { id: number; name: string }[]; can: { register: boolean; manage: boolean; availability: boolean; edit?: boolean } }

function BankerRecord({ id, data, toast, onClose, changed, openCase, inline = false }: { id: number; data: Registry; toast: Toast; onClose: () => void; changed: () => void; openCase?: (id: number, tab?: string) => void; inline?: boolean }) {
  const [rec, setRec] = useState<Record_ | null>(null);
  const [tick, setTick] = useState(0);
  const [act, setAct] = useState<"" | "identity" | "referral" | "availability" | "transfer" | "status" | "edit">("");
  const [ed, setEd] = useState({ position: "", work_email: "", work_phone: "", preferred_channel: "work_email", relationship_type: "direct", notes: "", owner_id: "", case_limit: "", different_reason: "" });
  const [edDup, setEdDup] = useState("");
  const [f, setF] = useState({ method: "call_branch_line", evidence: "", restrictions: "", on: mytToday(), availability: "available", until: "", case_limit: "", branch: "", reason: "", status: "inactive" });
  useEffect(() => { let live = true; void api<Record_>(`/staff/fa/bankers/${id}`).then((r) => { if (live && r.ok && r.data) setRec(r.data); }); return () => { live = false; }; }, [id, tick]);
  const run = async (path: string, body: unknown, done: string) => {
    const r = await post(path, body);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), errMsg(r.data), "notice"); return; }
    toast(done, rec?.banker.full_name ?? ""); setAct(""); setTick((t) => t + 1); changed();
  };
  const b = rec?.banker;
  const ended = (rec?.assignments ?? []).filter((a) => a.ended_on);
  const current = (rec?.assignments ?? []).filter((a) => !a.ended_on);
  const otherBranches = data.branches.filter((x) => x.bank_id === b?.bank_id && x.status !== "closed");
  const startEdit = () => {
    if (!b) return;
    setEd({ position: b.position ?? "", work_email: b.work_email ?? "", work_phone: b.work_phone ?? "", preferred_channel: b.preferred_channel, relationship_type: b.relationship_type, notes: rec?.banker.notes ?? "", owner_id: b.owner_id == null ? "" : String(b.owner_id), case_limit: b.case_limit == null ? "" : String(b.case_limit), different_reason: "" });
    setEdDup(""); setAct("edit");
  };
  const saveEdit = async () => {
    if (!b || !rec) return;
    const body: Record<string, unknown> = { position: ed.position, work_email: ed.work_email, work_phone: ed.work_phone, preferred_channel: ed.preferred_channel, relationship_type: ed.relationship_type, notes: ed.notes, different_reason: ed.different_reason || undefined };
    if (rec.can.manage) { body.owner_id = ed.owner_id ? Number(ed.owner_id) : undefined; body.case_limit = ed.case_limit ? Number(ed.case_limit) : null; }
    const r = await api<Err & { identity_reverify?: boolean }>(`/staff/fa/bankers/${b.id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!r.ok) {
      const d = r.data as Err | null;
      if (d?.error?.code === "possible_duplicate" || d?.error?.code === "duplicate_banker") { setEdDup(errMsg(d)); return; }
      toast(L("Not saved", "Tidak disimpan"), errMsg(d), "notice"); return;
    }
    toast(L("Details saved", "Butiran disimpan"), (r.data as { identity_reverify?: boolean } | null)?.identity_reverify ? L("The work contact changed - the contact identity must be verified again.", "Hubungan kerja berubah - identiti kenalan perlu disahkan semula.") : b.full_name);
    setAct(""); setTick((t) => t + 1); changed();
  };
  /* an identity confirmed before the contact last changed no longer counts (the row stays, append only) */
  const voidBefore = rec?.banker.contact_changed_at ?? null;
  const head = b ? (
    <div className={css.bkHead}>
      <span className={css.bkAvatar} aria-hidden="true">{b.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</span>
      <div className={css.who}>
        <b className={css.bkName}>{b.full_name}</b>
        <span className={css.chips}><span className={`${chipSmNeutral} ${css.chip}`}>{bkId(b.id)}</span>{chip(BANKER_STATUS, b.status_now)}{chip(AVAIL, b.availability_now)}</span>
        <span className={css.sub}>{[b.position, b.bank].filter(Boolean).join(" · ")} · {L(...(RELATION[b.relationship_type] ?? [b.relationship_type, b.relationship_type]))}</span>
      </div>
      <span className={css.inline}>
        {rec?.can.edit && <button type="button" className={btnSm} onClick={startEdit} data-testid="fa-banker-edit"><AppIcon name="edit" />{L("Edit", "Sunting")}</button>}
        {rec?.can.availability && b.status_now !== "no_longer_available" && <button type="button" className={btnSm} onClick={() => setAct("availability")} data-testid="fa-banker-avail">{L("Set availability", "Tetapkan ketersediaan")}</button>}
      </span>
    </div>
  ) : null;
  const body = !rec || !b ? <SkelRows rows={6} /> : (
        <div className={css.stack} data-testid="fa-banker-record">
          {inline && head}
          {!inline && <div className={css.chips}><span className={`${chipSmNeutral} ${css.chip}`}>{bkId(b.id)}</span>{chip(BANKER_STATUS, b.status_now)}{chip(AVAIL, b.availability_now)}<span className={`${chipSmInfo} ${css.chip}`}>{L(...(RELATION[b.relationship_type] ?? [b.relationship_type, b.relationship_type]))}</span>
            {rec.can.edit && <button type="button" className={btnSmQuiet} onClick={startEdit} data-testid="fa-banker-edit"><AppIcon name="edit" />{L("Edit", "Sunting")}</button>}</div>}
          {act === "edit" && (
            <section className={css.sec} aria-label={L("Edit banker details", "Sunting butiran pegawai bank")} data-testid="fa-banker-edit-form">
              <div className={css.form}>
                <label className={css.field}>{L("Position", "Jawatan")}<input className={inputClassSm} value={ed.position} maxLength={80} onChange={(e) => setEd({ ...ed, position: e.target.value })} /></label>
                <label className={css.field}>{L("Work email", "E-mel kerja")}<input className={inputClassSm} type="email" value={ed.work_email} maxLength={160} onChange={(e) => { setEd({ ...ed, work_email: e.target.value }); setEdDup(""); }} data-testid="fa-edit-email" /></label>
                <label className={css.field}>{L("Work phone", "Telefon kerja")}<input className={inputClassSm} inputMode="tel" value={ed.work_phone} maxLength={40} onChange={(e) => { setEd({ ...ed, work_phone: e.target.value }); setEdDup(""); }} data-testid="fa-edit-phone" /></label>
                <label className={css.field}>{L("Preferred channel", "Saluran pilihan")}<select className={selectClassSm} value={ed.preferred_channel} onChange={(e) => setEd({ ...ed, preferred_channel: e.target.value })}>{Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></label>
                <label className={css.field}>{L("Relationship", "Hubungan")}<select className={selectClassSm} value={ed.relationship_type} onChange={(e) => setEd({ ...ed, relationship_type: e.target.value })}>{Object.entries(RELATION).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></label>
                {rec.can.manage && <label className={css.field}>{L("Relationship owner", "Pemilik hubungan")}<select className={selectClassSm} value={ed.owner_id} onChange={(e) => setEd({ ...ed, owner_id: e.target.value })}><option value="">—</option>{(rec.owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
                {rec.can.manage && <label className={css.field}>{L("Case limit (blank = none)", "Had kes (kosong = tiada)")}<input className={inputClassSm} inputMode="numeric" value={ed.case_limit} onChange={(e) => setEd({ ...ed, case_limit: e.target.value.replace(/\D/g, "") })} /></label>}
                <label className={`${css.field} ${css.wide}`}>{L("Notes (no client details)", "Nota (tiada butiran pelanggan)")}<textarea className={textareaClass} rows={2} maxLength={600} value={ed.notes} onChange={(e) => setEd({ ...ed, notes: e.target.value })} /></label>
              </div>
              {(ed.work_email.trim() !== (b.work_email ?? "") || ed.work_phone.trim() !== (b.work_phone ?? "")) && <p className="erp-note">{L("Changing the work email or phone means the contact identity must be verified again before this banker is matched.", "Menukar e-mel atau telefon kerja bermakna identiti kenalan perlu disahkan semula sebelum pegawai ini dipadankan.")}</p>}
              {edDup && <div className="erp-note" data-testid="fa-edit-dup"><p>{edDup}</p>
                <label className={css.field}>{L("Why this is a different person (at least 10 characters)", "Mengapa ini individu berbeza (sekurang-kurangnya 10 aksara)")}<input className={inputClassSm} value={ed.different_reason} maxLength={300} onChange={(e) => setEd({ ...ed, different_reason: e.target.value })} /></label></div>}
              <div className={css.row}>
                <button type="button" className={btnSmPrimary} disabled={!ed.work_email.trim() && !ed.work_phone.trim()} onClick={() => void saveEdit()} data-testid="fa-edit-save">{L("Save details", "Simpan butiran")}</button>
                <button type="button" className={btnSmQuiet} onClick={() => setAct("")}>{L("Cancel", "Batal")}</button>
              </div>
            </section>
          )}
          <dl className={css.kv}>
            <div><dt>{L("Work contact", "Hubungan kerja")}</dt><dd className={css.lines}>{[b.work_email, b.work_phone].filter(Boolean).join(" · ") || "—"}</dd></div>
            <div><dt>{L("Preferred channel", "Saluran pilihan")}</dt><dd>{L(...(CHANNEL[b.preferred_channel] ?? [b.preferred_channel, b.preferred_channel]))}</dd></div>
            <div><dt>{L("Products", "Produk")}</dt><dd>{b.products.map(productWord).join(", ") || "—"}</dd></div>
            <div><dt>{L("Relationship owner", "Pemilik hubungan")}</dt><dd>{b.owner ?? "—"}</dd></div>
            <div><dt>{L("Registered", "Didaftarkan")}</dt><dd>{dmyMYT(b.created_at)} · {b.registered_by_name ?? "—"}</dd></div>
            <div><dt>{L("Open cases · limit", "Kes terbuka · had")}</dt><dd>{b.open_cases ?? 0} · {b.case_limit ?? L("none set", "tiada had")}</dd></div>
            <div><dt>{L("Last contact", "Hubungan terakhir")}</dt><dd>{rec.banker.last_contact_at ? dmyMYT(rec.banker.last_contact_at) : "—"}</dd></div>
            {rec.banker.notes && <div><dt>{L("Notes", "Nota")}</dt><dd className={css.lines}>{rec.banker.notes}</dd></div>}
          </dl>
          {b.duplicate_reason && <p className={css.sub}>{L("Shares a work phone with another banker:", "Berkongsi telefon kerja dengan pegawai lain:")} {b.duplicate_reason}</p>}

          <section className={css.sec} aria-label={L("Verification", "Pengesahan")}>
            <h3 className={css.h}><AppIcon name="verify" />{L("Verification - two separate facts", "Pengesahan - dua fakta berasingan")}</h3>
            {(["identity", "referral"] as const).map((fact) => {
              const v0 = rec.verifications.find((x) => x.fact === fact);
              /* v1.290.0 - an identity confirmed before the contact changed is shown as superseded, not as confirmed */
              const superseded = fact === "identity" && !!v0 && !!voidBefore && !!v0.created_at && v0.created_at <= voidBefore;
              const v = superseded ? undefined : v0;
              return (
                <div key={fact} className={css.item} data-testid={`fa-fact-${fact}`}>
                  <span className={css.itemMain}>
                    <b>{fact === "identity" ? L("Contact identity", "Identiti kenalan") : L("Referral permission", "Kebenaran rujukan")}</b>
                    {v ? <span className={css.sub}>{L(...(METHOD[v.method] ?? [v.method, v.method]))} · {dmy(v.verified_on)} · {v.verified_by_name ?? "—"} · {L("review by", "semak sebelum")} {dmy(v.next_review_on)}{v.restrictions ? ` · ${v.restrictions}` : ""}</span>
                      : superseded ? <span className={css.sub} data-testid="fa-identity-superseded">{L(`The work contact changed on ${dmyMYT(voidBefore!)} - the earlier confirmation (${dmy(v0!.verified_on)}) no longer counts. Verify the new contact.`, `Hubungan kerja berubah pada ${dmyMYT(voidBefore!)} - pengesahan terdahulu (${dmy(v0!.verified_on)}) tidak lagi dikira. Sahkan hubungan baharu.`)}</span>
                      : <span className={css.sub}>{L("Not confirmed", "Belum disahkan")}</span>}
                  </span>
                  {v ? (v.next_review_on < rec.today ? <span className={`${chipSmDanger} ${css.chip}`}>{L("Review due", "Perlu disemak")}</span> : <span className={`${chipSmSuccess} ${css.chip}`}>{L("Confirmed", "Disahkan")}</span>) : <span className={`${chipSmWarn} ${css.chip}`}>{L("Pending", "Menunggu")}</span>}
                  {rec.can.manage && b.status_now !== "no_longer_available" && b.status_now !== "inactive" && (fact === "identity" || (rec.verifications.some((x) => x.fact === "identity" && x.next_review_on >= rec.today))) && (
                    <button type="button" className={btnSm} onClick={() => { setAct(fact); setF({ ...f, evidence: "", restrictions: "", on: mytToday() }); }}>{v ? L("Re-verify", "Sahkan semula") : L("Verify", "Sahkan")}</button>
                  )}
                </div>
              );
            })}
            {(act === "identity" || act === "referral") && (
              <div className={css.stack} data-testid="fa-verify-form">
                <div className={css.form}>
                  <label className={css.field}>{L("How it was confirmed", "Cara disahkan")}<select className={selectClassSm} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></label>
                  <label className={css.field}>{L("Confirmed on", "Disahkan pada")}<input className={inputClassSm} type="date" value={f.on} max={mytToday()} onChange={(e) => setF({ ...f, on: e.target.value })} /></label>
                  <label className={`${css.field} ${css.wide}`}>{L("Evidence - which official line or email, who confirmed (at least 10 characters)", "Bukti - talian atau e-mel rasmi mana, siapa mengesahkan (sekurang-kurangnya 10 aksara)")}<textarea className={textareaClass} rows={2} maxLength={400} value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} data-testid="fa-verify-evidence" /></label>
                  {act === "referral" && <label className={`${css.field} ${css.wide}`}>{L("Restrictions (products, areas, conditions)", "Sekatan (produk, kawasan, syarat)")}<input className={inputClassSm} value={f.restrictions} maxLength={300} onChange={(e) => setF({ ...f, restrictions: e.target.value })} /></label>}
                </div>
                <p className="erp-note">{L("You cannot verify a banker you registered yourself. The next review is set 12 months ahead.", "Anda tidak boleh mengesahkan pegawai bank yang anda daftarkan sendiri. Semakan seterusnya ditetapkan 12 bulan ke hadapan.")}</p>
                <div className={css.row}>
                  <button type="button" className={btnSmPrimary} disabled={f.evidence.trim().length < 10} data-testid="fa-verify-save" onClick={() => void run(`/staff/fa/bankers/${b.id}/verify`, { fact: act, method: f.method, evidence: f.evidence, restrictions: f.restrictions || undefined, verified_on: f.on }, act === "identity" ? L("Identity verified", "Identiti disahkan") : L("Referral permission confirmed", "Kebenaran rujukan disahkan"))}>{L("Confirm", "Sahkan")}</button>
                  <button type="button" className={btnSmQuiet} onClick={() => setAct("")}>{L("Cancel", "Batal")}</button>
                </div>
              </div>
            )}
          </section>

          <section className={css.sec} aria-label={L("Where they work", "Tempat bekerja")}>
            <div className={css.head}>
              <h3 className={css.h}><AppIcon name="place" />{L("Where they work", "Tempat bekerja")}</h3>
              <span className={css.inline}>
                {rec.can.availability && b.status_now !== "no_longer_available" && <button type="button" className={btnSmQuiet} onClick={() => setAct("availability")}>{L("Update availability", "Kemas kini ketersediaan")}</button>}
                {rec.can.manage && b.status_now !== "no_longer_available" && <button type="button" className={btnSmQuiet} onClick={() => { setAct("transfer"); setF({ ...f, branch: "", reason: "" }); }}>{L("Transfer", "Pindah")}</button>}
                {rec.can.manage && <button type="button" className={btnSmQuiet} onClick={() => { setAct("status"); setF({ ...f, reason: "", status: b.status_now === "inactive" || b.status_now === "no_longer_available" ? "active" : "inactive" }); }}>{L("Change status", "Tukar status")}</button>}
              </span>
            </div>
            {current.length === 0 ? <p className={css.sub}>{L("No current assignment.", "Tiada tugasan semasa.")}</p> : (
              <ul className={css.items}>{current.map((a) => <li key={a.id} className={css.item}><span className={css.itemMain}><b>{whereText(a)}{a.is_primary ? ` · ${L("primary", "utama")}` : ""}</b><span className={css.sub}>{L("Covers", "Meliputi")} {coverText(a)} · {L("since", "sejak")} {dmy(a.effective_from)}</span></span></li>)}</ul>
            )}
            {ended.length > 0 && (
              <details className={css.sub}><summary>{L("Earlier assignments", "Tugasan terdahulu")} ({ended.length})</summary>
                <ul className={css.items}>{ended.map((a) => <li key={a.id} className={css.item}><span className={css.itemMain}><span>{whereText(a)}</span><span className={css.sub}>{dmy(a.effective_from)} – {dmy(a.ended_on!)} · {a.end_reason}</span></span></li>)}</ul>
              </details>
            )}
            {act === "availability" && (
              <div className={css.stack}>
                <div className={css.form}>
                  <label className={css.field}>{L("Availability today", "Ketersediaan hari ini")}<select className={selectClassSm} value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })}><option value="available">{L("Available", "Tersedia")}</option><option value="limited">{L("Limited capacity", "Kapasiti terhad")}</option><option value="unavailable">{L("Unavailable", "Tidak tersedia")}</option></select></label>
                  {f.availability === "unavailable" && <label className={css.field}>{L("Until", "Sehingga")}<input className={inputClassSm} type="date" min={mytToday()} value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></label>}
                  {rec.can.manage && <label className={css.field}>{L("Case limit (optional)", "Had kes (pilihan)")}<input className={inputClassSm} inputMode="numeric" value={f.case_limit} onChange={(e) => setF({ ...f, case_limit: e.target.value.replace(/\D/g, "") })} /></label>}
                </div>
                <p className={css.sub}>{L("A statement older than 30 days shows as Unknown.", "Kenyataan lebih 30 hari ditunjukkan sebagai Tidak diketahui.")}</p>
                <div className={css.row}><button type="button" className={btnSmPrimary} disabled={f.availability === "unavailable" && !f.until} onClick={() => void run(`/staff/fa/bankers/${b.id}/availability`, { availability: f.availability, until: f.until || undefined, case_limit: rec.can.manage && f.case_limit ? Number(f.case_limit) : undefined }, L("Availability updated", "Ketersediaan dikemas kini"))}>{L("Save", "Simpan")}</button><button type="button" className={btnSmQuiet} onClick={() => setAct("")}>{L("Cancel", "Batal")}</button></div>
              </div>
            )}
            {act === "transfer" && (
              <div className={css.stack}>
                <div className={css.form}>
                  <label className={css.field}>{L("New branch", "Cawangan baharu")}<select className={selectClassSm} value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}><option value="">—</option>{otherBranches.map((x) => <option key={x.id} value={x.id}>{x.name} · {[x.city, x.state].filter(Boolean).join(", ")}</option>)}</select></label>
                  <label className={css.field}>{L("Why (at least 5 characters)", "Sebab (sekurang-kurangnya 5 aksara)")}<input className={inputClassSm} value={f.reason} maxLength={300} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
                </div>
                <p className={css.sub}>{L("The current primary assignment ends today and the new one starts - the history is kept.", "Tugasan utama semasa tamat hari ini dan yang baharu bermula - sejarah disimpan.")}</p>
                <div className={css.row}><button type="button" className={btnSmPrimary} disabled={!f.branch || f.reason.trim().length < 5} onClick={() => void run(`/staff/fa/bankers/${b.id}/transfer`, { branch_id: Number(f.branch), coverage: "branch", reason: f.reason }, L("Transferred", "Dipindahkan"))}>{L("Transfer", "Pindah")}</button><button type="button" className={btnSmQuiet} onClick={() => setAct("")}>{L("Cancel", "Batal")}</button></div>
              </div>
            )}
            {act === "status" && (
              <div className={css.stack}>
                <div className={css.form}>
                  <label className={css.field}>{L("Status", "Status")}<select className={selectClassSm} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">{L("Active", "Aktif")}</option><option value="inactive">{L("Inactive", "Tidak aktif")}</option><option value="left">{L("No longer available (left the bank)", "Tidak lagi tersedia (meninggalkan bank)")}</option></select></label>
                  <label className={css.field}>{L("Why (at least 5 characters)", "Sebab (sekurang-kurangnya 5 aksara)")}<input className={inputClassSm} value={f.reason} maxLength={300} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
                </div>
                <div className={css.row}><button type="button" className={btnSmPrimary} disabled={f.reason.trim().length < 5} onClick={() => void run(`/staff/fa/bankers/${b.id}/status`, { status: f.status, reason: f.reason }, L("Status changed", "Status ditukar"))}>{L("Save", "Simpan")}</button><button type="button" className={btnSmQuiet} onClick={() => setAct("")}>{L("Cancel", "Batal")}</button></div>
              </div>
            )}
          </section>

          {!inline && <BankerCases bankerId={b.id} banker={b} openCase={openCase} />}
          <section className={css.sec} aria-label={L("History", "Sejarah")}>
            <h3 className={css.h}><AppIcon name="time" />{L("Activity history", "Sejarah aktiviti")}</h3>
            <EventList events={rec.events.map((e) => ({ ...e, entity: "banker", subject: null }))} />
          </section>
        </div>
      );
  if (inline) {
    return (
      <>
        <section className={`${card} ${css.sec}`} aria-label={L("Banker profile", "Profil pegawai bank")} data-testid="fa-banker-profile">
          <h3 className={css.h}><AppIcon name="person" />{L("Banker profile", "Profil pegawai bank")}</h3>
          {body}
        </section>
        {b && <BankerCases bankerId={b.id} banker={b} openCase={openCase} panel />}
      </>
    );
  }
  return (
    <SideDrawer open onClose={onClose} wide dirty={!!act && !!(f.evidence || f.reason || act === "edit")} title={b ? b.full_name : L("Banker", "Pegawai bank")} subtitle={b ? [b.position, b.bank].filter(Boolean).join(" · ") : ""}>
      {body}
    </SideDrawer>
  );
}

/* ============================ v1.290.0 the banker's cases (image 04, G2) ============================
   Counts for everyone who may open Financial Advisory; the case lines -
   client, DSR, the banker's feedback, the official outcome - only for the
   cases this person may open (the server decides: GET /fa/bankers/:id/cases).
   Four separate kinds of entry, never one "approved" word: the internal
   allocation, the banker's indicative feedback, the official bank decision
   (with the bank's letter) - and the system DSR stays on the case. */
interface BCase {
  allocation_id: number; state: string; mine: boolean; case_id?: number; case_ref?: string; client?: string | null; product?: string; projected_dsr_bp?: number | null;
  application_status?: string; created_at?: string; decided_at?: string | null; decided_by?: string | null; enquiry_state?: string | null; sent_at?: string | null; reason?: string | null;
  feedback?: { id: number; status_value: string; body: string; source: string | null; missing_documents: string | null; follow_up_on: string | null; created_at: string; contact_on: string | null; author: string | null }[];
  decisions?: { id: number; bank: string; status_value: string; bank_reference: string | null; approved_cents: number | null; created_at: string; tenure_months: number | null; has_letter: number }[];
}
const ALLOC: Record<string, [string, string, string]> = {
  draft: ["Draft", "Draf", chipSmNeutral], pending_review: ["Waiting for the CEO or COO", "Menunggu CEO atau COO", chipSmWarn], assigned: ["Allocated", "Diperuntukkan", chipSmSuccess],
  awaiting_consent: ["Awaiting client consent", "Menunggu persetujuan", chipSmWarn], ready: ["Allocated", "Diperuntukkan", chipSmSuccess], cancelled: ["Cancelled", "Dibatalkan", chipSmNeutral], reassigned: ["Reassigned", "Diagih semula", chipSmNeutral],
};
const FEED: Record<string, string> = { enquiry_sent: "Enquiry sent", under_review: "Under review", indicatively_suitable: "Indicatively suitable", documents_required: "Documents required", not_supported: "Not supported" };
const DECIDED: Record<string, string> = { conditional_offer: "Conditional offer (official)", officially_approved: "Officially approved (bank letter)", declined: "Declined (official)", disbursed: "Disbursed (evidence)" };
function BankerCases({ bankerId, banker, openCase, panel = false }: { bankerId: number; banker: Banker; openCase?: (id: number, tab?: string) => void; panel?: boolean }) {
  const [d, setD] = useState<{ counts: { allocated: number; pending: number; enquiry_open: number; feedback: number; outcome: number }; cases: BCase[] } | null>(null);
  useEffect(() => { let live = true; void api<NonNullable<typeof d>>(`/staff/fa/bankers/${bankerId}/cases`).then((r) => { if (live && r.ok && r.data) setD(r.data); }); return () => { live = false; }; }, [bankerId]);
  const mine = (d?.cases ?? []).filter((c) => c.mine);
  const others = (d?.cases ?? []).length - mine.length;
  const primary = banker.assignments.find((a) => a.is_primary) ?? banker.assignments[0];
  const inner = (
    <>
      <h3 className={css.h}><AppIcon name="users" />{L("Client matching & case allocation", "Padanan pelanggan & peruntukan kes")}</h3>
      {!d ? <SkelRows rows={4} /> : (<>
        <dl className={css.bkCounts}>
          <div><dt>{L("Allocated", "Diperuntukkan")}</dt><dd>{d.counts.allocated}</dd></div>
          <div><dt>{L("Enquiry open", "Pertanyaan terbuka")}</dt><dd>{d.counts.enquiry_open}</dd></div>
          <div><dt>{L("Official outcome", "Keputusan rasmi")}</dt><dd>{d.counts.outcome}</dd></div>
        </dl>
        <div className={css.sec}>
          <b className={css.sub}>{L("What matching checks for this banker (internal)", "Apa yang disemak semasa padanan (dalaman)")}</b>
          <ul className={css.list}>
            <li><AppIcon name={banker.status_now === "verified" ? "success" : "warning"} /><span>{banker.status_now === "verified" ? L("Contact identity and referral permission verified, in date", "Identiti kenalan dan kebenaran rujukan disahkan, dalam tempoh") : L("Not matchable until verified", "Tidak boleh dipadan sehingga disahkan")}</span></li>
            <li><AppIcon name="document" /><span>{L("Products", "Produk")}: {banker.products.map(productWord).join(", ") || "—"}</span></li>
            <li><AppIcon name="place" /><span>{L("Coverage", "Liputan")}: {primary ? `${whereText(primary)} · ${coverText(primary)}` : "—"}</span></li>
            <li><AppIcon name={banker.availability_now === "available" || banker.availability_now === "limited" ? "success" : "warning"} /><span>{L(...((AVAIL[banker.availability_now] ?? AVAIL.unknown!).slice(0, 2) as [string, string]))}{banker.case_limit != null ? ` · ${banker.open_cases ?? 0} / ${banker.case_limit} ${L("cases", "kes")}` : ""}</span></li>
            <li><AppIcon name="chart" /><span>{L("The client's projected DSR within the bank's verified guideline - checked on each case", "DSR unjuran pelanggan dalam garis panduan disahkan bank - disemak pada setiap kes")}</span></li>
          </ul>
        </div>
        <div className={css.sec} data-testid="fa-banker-cases">
          <b className={css.sub}>{L("Related cases", "Kes berkaitan")} ({d.cases.length})</b>
          {d.cases.length === 0 ? <p className={css.sub}>{L("No case allocated to this banker yet. Allocation happens in a case's Banker matching tab after a management Proceed.", "Belum ada kes diperuntukkan. Peruntukan dibuat dalam tab Padanan pegawai bank selepas Pengurusan memutuskan Teruskan.")}</p> : (
            <ul className={css.items}>
              {mine.map((c) => (
                <li key={c.allocation_id} className={css.item} data-testid="fa-banker-case">
                  <span className={css.itemMain}>
                    {openCase && c.case_id ? <button type="button" className={css.linkBtn} onClick={() => openCase(c.case_id!, "matching")}><b>{c.case_ref} · {c.client ?? "—"}</b></button> : <b>{c.case_ref} · {c.client ?? "—"}</b>}
                    <span className={css.sub}>{L("Projected DSR", "DSR unjuran")} {c.projected_dsr_bp == null ? "—" : `${(c.projected_dsr_bp / 100).toFixed(1)}%`} · {L("allocated", "diperuntukkan")} {dmyMYT(c.created_at!)}</span>
                  </span>
                  {chip(ALLOC, c.state)}
                  <ul className={css.bkTl}>
                    <li><b>{L("Internal allocation", "Peruntukan dalaman")}</b><span className={css.sub}>{c.decided_at ? `${L("confirmed by management", "disahkan oleh pengurusan")} ${dmyMYT(c.decided_at)}${c.decided_by ? ` · ${c.decided_by}` : ""}` : L("waiting for the CEO or COO", "menunggu CEO atau COO")}</span></li>
                    {c.sent_at && <li><b>{L("Enquiry sent", "Pertanyaan dihantar")}</b><span className={css.sub}>{dmyMYT(c.sent_at)}</span></li>}
                    {(c.feedback ?? []).map((n) => (
                      <li key={`f${n.id}`} className={css.bkFeed}><b>{L("Banker feedback (indicative only)", "Maklum balas bank (indikatif sahaja)")} · {FEED[n.status_value] ?? n.status_value}</b>
                        <span className={css.sub}>{L("contact", "hubungan")} {n.contact_on ? dmy(n.contact_on) : dmyMYT(n.created_at)}{n.source ? ` · ${n.source}` : ""}{n.author ? ` · ${n.author}` : ""}</span><span>“{n.body}”</span>
                        {n.missing_documents && <span className={css.sub}>{L("Asked for", "Diminta")}: {n.missing_documents}</span>}{n.follow_up_on && <span className={css.sub}>{L("Follow up", "Susulan")} {dmy(n.follow_up_on)}</span>}</li>
                    ))}
                    {(c.decisions ?? []).map((x) => (
                      <li key={`d${x.id}`} className={css.bkDecision}><b>{L("Official bank decision", "Keputusan rasmi bank")} · {DECIDED[x.status_value] ?? x.status_value}</b>
                        <span className={css.sub}>{dmyMYT(x.created_at)} · {x.bank}{x.bank_reference ? ` · ${L("ref", "ruj")} ${x.bank_reference}` : ""}{x.approved_cents ? ` · RM ${(x.approved_cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : ""}{x.tenure_months ? ` · ${x.tenure_months} ${L("months", "bulan")}` : ""}{x.has_letter ? ` · ${L("bank letter attached", "surat bank dilampirkan")}` : ""}</span></li>
                    ))}
                  </ul>
                </li>
              ))}
              {others > 0 && <li className={css.item}><span className={css.itemMain}><b>{others} {L(others === 1 ? "case" : "cases", "kes")}</b><span className={css.sub}>{L("Other people's clients - not shown to you", "Pelanggan orang lain - tidak ditunjukkan kepada anda")}</span></span><span className={`${chipSmNeutral} ${css.chip}`}>{L("not yours", "bukan anda")}</span></li>}
            </ul>
          )}
        </div>
        <p className={css.disclaimer}><AppIcon name="info" /><span>{L("Banker matching and feedback are internal and indicative. Only the bank's own letter is a decision.", "Padanan dan maklum balas pegawai bank adalah dalaman dan indikatif. Hanya surat bank sendiri ialah keputusan.")}</span></p>
      </>)}
    </>
  );
  return panel ? <section className={`${card} ${css.sec}`} aria-label={L("Client matching and case allocation", "Padanan pelanggan dan peruntukan kes")} data-testid="fa-banker-panel">{inner}</section> : <section className={css.sec} data-testid="fa-banker-panel">{inner}</section>;
}

/* ============================ branches ============================ */

function Branches({ data, toast, reload }: { data: Registry; toast: Toast; reload: () => void }) {
  const [bank, setBank] = useState("");
  const [state, setState] = useState("");
  const [adding, setAdding] = useState(false);
  const [act, setAct] = useState<{ id: number; what: "verify" | "status" | "rename" } | null>(null);
  const [g, setG] = useState({ source: "", on: mytToday(), status: "temporarily_closed", note: "", name: "" });
  const rows = data.branches.filter((b) => (!bank || String(b.bank_id) === bank) && (!state || b.state === state));
  const run = async (path: string, body: unknown, done: string) => {
    const r = await post(path, body);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), errMsg(r.data), "notice"); return; }
    toast(done, ""); setAct(null); reload();
  };
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Branch registry", "Daftar cawangan")} data-testid="fa-branches">
      <div className={css.head}>
        <h3 className={css.h}><AppIcon name="place" />{L("Branch registry", "Daftar cawangan")} <span className={css.sub}>{rows.length}</span></h3>
        {data.can.manage && <button type="button" className={btnSmPrimary} onClick={() => setAdding(true)} disabled={data.banks.length === 0}><AppIcon name="add" />{L("Add branch", "Tambah cawangan")}</button>}
      </div>
      <p className={css.sub}>{L("Only branches confirmed from the bank's own sources. A branch that closes or is renamed keeps its record; closing one ends its bankers' assignments.", "Hanya cawangan yang disahkan daripada sumber bank sendiri. Cawangan yang ditutup atau dinamakan semula kekal rekodnya; menutupnya menamatkan tugasan pegawai.")}</p>
      <div className={css.tools}>
        <select className={selectClassSm} value={bank} onChange={(e) => setBank(e.target.value)} aria-label={L("Bank", "Bank")}><option value="">{L("All banks", "Semua bank")}</option>{data.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <select className={selectClassSm} value={state} onChange={(e) => setState(e.target.value)} aria-label={L("State", "Negeri")}><option value="">{L("All states", "Semua negeri")}</option>{data.states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      {rows.length === 0 ? <p className={css.empty}>{L("No branch yet.", "Belum ada cawangan.")}</p> : (
        <ul className={css.items}>{rows.map((b) => (
          <li key={b.id} className={css.item} data-testid="fa-branch">
            <span className={css.itemMain}>
              <b>{b.bank} · {b.name}{b.code ? ` (${b.code})` : ""}</b>
              <span className={css.sub}>{[b.address, b.postcode, b.city, b.district, b.state].filter(Boolean).join(", ")}{b.phone ? ` · ${b.phone}` : ""}</span>
              <span className={css.sub}>{b.bankers} {L("current banker(s)", "pegawai semasa")}{b.last_verified_on ? ` · ${L("verified", "disahkan")} ${dmy(b.last_verified_on)}` : ""}{b.status_note ? ` · ${b.status_note}` : ""}</span>
            </span>
            <span className={css.chips}>
              {b.status === "open" ? null : <span className={`${b.status === "closed" ? chipSmNeutral : chipSmWarn} ${css.chip}`}>{b.status === "closed" ? L("Closed", "Ditutup") : L("Temporarily closed", "Ditutup sementara")}</span>}
              {b.verified ? <span className={`${chipSmSuccess} ${css.chip}`}>{L("Verified", "Disahkan")}</span> : <span className={`${chipSmWarn} ${css.chip}`}>{L("Not verified", "Belum disahkan")}</span>}
            </span>
            {data.can.manage && b.status !== "closed" && (
              <span className={css.inline}>
                {!b.verified && <button type="button" className={btnSm} onClick={() => { setAct({ id: b.id, what: "verify" }); setG({ ...g, source: "", on: mytToday() }); }}>{L("Verify", "Sahkan")}</button>}
                <button type="button" className={btnSmQuiet} onClick={() => { setAct({ id: b.id, what: "rename" }); setG({ ...g, name: b.name, note: "" }); }}>{L("Rename", "Namakan semula")}</button>
                <button type="button" className={btnSmQuiet} onClick={() => { setAct({ id: b.id, what: "status" }); setG({ ...g, status: b.status === "open" ? "temporarily_closed" : "open", note: "" }); }}>{L("Status", "Status")}</button>
              </span>
            )}
            {act?.id === b.id && (
              <div className={`${css.form} ${css.wide}`}>
                {act.what === "verify" && <>
                  <label className={css.field}>{L("How you confirmed it", "Cara anda mengesahkan")}<input className={inputClassSm} value={g.source} maxLength={300} onChange={(e) => setG({ ...g, source: e.target.value })} placeholder={L("e.g. the bank's branch locator", "cth. pencari cawangan bank")} /></label>
                  <label className={css.field}>{L("On", "Pada")}<input className={inputClassSm} type="date" max={mytToday()} value={g.on} onChange={(e) => setG({ ...g, on: e.target.value })} /></label>
                </>}
                {act.what === "rename" && <label className={css.field}>{L("New official name", "Nama rasmi baharu")}<input className={inputClassSm} value={g.name} maxLength={120} onChange={(e) => setG({ ...g, name: e.target.value })} /></label>}
                {act.what === "status" && <label className={css.field}>{L("Status", "Status")}<select className={selectClassSm} value={g.status} onChange={(e) => setG({ ...g, status: e.target.value })}><option value="open">{L("Open", "Dibuka")}</option><option value="temporarily_closed">{L("Temporarily closed", "Ditutup sementara")}</option><option value="closed">{L("Closed for good (ends assignments)", "Ditutup terus (tamatkan tugasan)")}</option></select></label>}
                {act.what !== "verify" && <label className={css.field}>{L("Why (at least 5 characters)", "Sebab (sekurang-kurangnya 5 aksara)")}<input className={inputClassSm} value={g.note} maxLength={300} onChange={(e) => setG({ ...g, note: e.target.value })} /></label>}
                <div className={css.row}>
                  <button type="button" className={btnSmPrimary} disabled={act.what === "verify" ? g.source.trim().length < 5 : g.note.trim().length < 5}
                    onClick={() => void (act.what === "verify" ? run(`/staff/fa/branches/${b.id}/verify`, { source: g.source, verified_on: g.on }, L("Branch verified", "Cawangan disahkan"))
                      : act.what === "rename" ? run(`/staff/fa/branches/${b.id}/rename`, { name: g.name, note: g.note }, L("Branch renamed", "Cawangan dinamakan semula"))
                        : run(`/staff/fa/branches/${b.id}/status`, { status: g.status, note: g.note }, L("Branch status changed", "Status cawangan ditukar")))}>{L("Save", "Simpan")}</button>
                  <button type="button" className={btnSmQuiet} onClick={() => setAct(null)}>{L("Cancel", "Batal")}</button>
                </div>
              </div>
            )}
          </li>
        ))}</ul>
      )}
      {adding && <NewBranch data={data} toast={toast} onClose={() => setAdding(false)} saved={() => { setAdding(false); reload(); }} />}
    </section>
  );
}

function NewBranch({ data, toast, onClose, saved }: { data: Registry; toast: Toast; onClose: () => void; saved: () => void }) {
  const [f, setF] = useState({ bank_id: "", name: "", code: "", address: "", postcode: "", locality_id: "", phone: "", source: "", postcode_note: "" });
  const [place, setPlace] = useState({ state: "", district: "", city: "" });
  const [places, setPlaces] = useState(data.localities);
  const [mismatch, setMismatch] = useState("");
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); if (k === "postcode" || k === "locality_id") setMismatch(""); };
  const addPlace = async () => {
    const r = await post("/staff/fa/localities", place);
    if (!r.ok) { toast(L("Not added", "Tidak ditambah"), errMsg(r.data), "notice"); return; }
    const id = Number((r.data as unknown as { id: number }).id);
    if (!places.some((p) => p.id === id)) setPlaces([...places, { id, state: place.state, district: place.district.trim(), city: place.city.trim() }]);
    setF({ ...f, locality_id: String(id) }); setPlace({ state: "", district: "", city: "" });
  };
  const save = async () => {
    const r = await post("/staff/fa/branches", { bank_id: Number(f.bank_id), name: f.name, code: f.code || undefined, address: f.address || undefined, postcode: f.postcode, locality_id: Number(f.locality_id), phone: f.phone || undefined, source: f.source || undefined, postcode_note: f.postcode_note || undefined });
    if (!r.ok) {
      if (r.data?.error?.code === "postcode_state_mismatch") { setMismatch(errMsg(r.data)); return; }
      toast(L("Not saved", "Tidak disimpan"), errMsg(r.data), "notice"); return;
    }
    const others = (r.data as unknown as { same_name_elsewhere?: string[] }).same_name_elsewhere ?? [];
    toast(L("Branch added", "Cawangan ditambah"), others.length ? L(`Note: a branch of the same name exists at ${others.join(", ")}.`, `Nota: cawangan dengan nama sama wujud di ${others.join(", ")}.`) : L("Not verified until management confirms it.", "Belum disahkan sehingga pengurusan mengesahkannya."));
    saved();
  };
  return (
    <SideDrawer open onClose={onClose} dirty={!!(f.name || f.postcode)} title={L("Add branch", "Tambah cawangan")} subtitle={L("From the bank's own sources only - never invented", "Daripada sumber bank sahaja - tidak direka")}>
      <div className={css.stack}>
        <div className={css.form}>
          <label className={css.field}>{L("Bank", "Bank")}<select className={selectClassSm} value={f.bank_id} onChange={(e) => set("bank_id", e.target.value)}><option value="">—</option>{data.banks.filter((b) => b.status !== "retired").map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className={css.field}>{L("Official branch name", "Nama rasmi cawangan")}<input className={inputClassSm} value={f.name} maxLength={120} onChange={(e) => set("name", e.target.value)} /></label>
          <label className={css.field}>{L("Branch code (optional)", "Kod cawangan (pilihan)")}<input className={inputClassSm} value={f.code} maxLength={20} onChange={(e) => set("code", e.target.value)} /></label>
          <label className={css.field}>{L("Official phone (optional)", "Telefon rasmi (pilihan)")}<input className={inputClassSm} inputMode="tel" value={f.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} /></label>
          <label className={`${css.field} ${css.wide}`}>{L("Address (optional)", "Alamat (pilihan)")}<input className={inputClassSm} value={f.address} maxLength={300} onChange={(e) => set("address", e.target.value)} /></label>
          <label className={css.field}>{L("Postcode", "Poskod")}<input className={inputClassSm} inputMode="numeric" value={f.postcode} maxLength={5} onChange={(e) => set("postcode", e.target.value.replace(/\D/g, ""))} /></label>
          <label className={css.field}>{L("State, district and city", "Negeri, daerah dan bandar")}<select className={selectClassSm} value={f.locality_id} onChange={(e) => set("locality_id", e.target.value)}><option value="">—</option>{places.map((p) => <option key={p.id} value={p.id}>{p.city}, {p.district}, {p.state}</option>)}</select></label>
          <label className={`${css.field} ${css.wide}`}>{L("Source (where this branch is confirmed)", "Sumber (di mana cawangan ini disahkan)")}<input className={inputClassSm} value={f.source} maxLength={300} onChange={(e) => set("source", e.target.value)} /></label>
        </div>
        <fieldset className={css.fieldset}><legend>{L("Place not in the list? Add it", "Tempat tiada dalam senarai? Tambah")}</legend>
          <div className={css.form}>
            <label className={css.field}>{L("State", "Negeri")}<select className={selectClassSm} value={place.state} onChange={(e) => setPlace({ ...place, state: e.target.value })}><option value="">—</option>{data.states.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
            <label className={css.field}>{L("District", "Daerah")}<input className={inputClassSm} value={place.district} maxLength={60} onChange={(e) => setPlace({ ...place, district: e.target.value })} /></label>
            <label className={css.field}>{L("City or town", "Bandar")}<input className={inputClassSm} value={place.city} maxLength={60} onChange={(e) => setPlace({ ...place, city: e.target.value })} /></label>
          </div>
          <button type="button" className={btnSmQuiet} disabled={!place.state || place.district.trim().length < 2 || place.city.trim().length < 2} onClick={() => void addPlace()}>{L("Add place", "Tambah tempat")}</button>
        </fieldset>
        {mismatch && (
          <div className="erp-note" data-testid="fa-postcode-mismatch"><p>{mismatch}</p>
            <label className={css.field}>{L("Why it is right (at least 5 characters)", "Mengapa ia betul (sekurang-kurangnya 5 aksara)")}<input className={inputClassSm} value={f.postcode_note} maxLength={200} onChange={(e) => setF({ ...f, postcode_note: e.target.value })} /></label>
          </div>
        )}
        <div className={css.row}><button type="button" className={btnSmPrimary} disabled={!f.bank_id || f.name.trim().length < 2 || !/^\d{5}$/.test(f.postcode) || !f.locality_id || (!!mismatch && f.postcode_note.trim().length < 5)} onClick={() => void save()}>{L("Add branch", "Tambah cawangan")}</button></div>
      </div>
    </SideDrawer>
  );
}

/* ============================ banks ============================ */

function Banks({ data, toast, reload }: { data: Registry; toast: Toast; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", kind: "commercial", website: "", source: "" });
  const [act, setAct] = useState<{ id: number; what: "verify" | "retire" | "product" } | null>(null);
  const [g, setG] = useState({ source: "", on: mytToday(), reason: "", product: "personal_financing", channel: "branch" });
  const run = async (path: string, body: unknown, done: string) => {
    const r = await post(path, body);
    if (!r.ok) { toast(L("Not saved", "Tidak disimpan"), errMsg(r.data), "notice"); return false; }
    toast(done, ""); setAct(null); reload(); return true;
  };
  const KIND: Record<string, [string, string]> = { commercial: ["Commercial bank", "Bank perdagangan"], islamic: ["Islamic bank", "Bank Islam"], dfi: ["Development financial institution", "Institusi kewangan pembangunan"], cooperative: ["Cooperative", "Koperasi"], other: ["Other", "Lain-lain"] };
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Bank registry", "Daftar bank")} data-testid="fa-banks">
      <div className={css.head}>
        <h3 className={css.h}><AppIcon name="balance" />{L("Bank registry", "Daftar bank")} <span className={css.sub}>{data.banks.length}</span></h3>
        {data.can.manage && <button type="button" className={btnSmPrimary} onClick={() => setAdding(true)}><AppIcon name="add" />{L("Add bank", "Tambah bank")}</button>}
      </div>
      <p className={css.sub}>{L("Each bank once, by its official name. Adding a bank is not a partnership claim - A2Z is not affiliated with any bank.", "Setiap bank sekali, dengan nama rasminya. Menambah bank bukan tuntutan perkongsian - A2Z tidak bergabung dengan mana-mana bank.")}</p>
      {data.banks.length === 0 ? <p className={css.empty}>{L("No bank yet.", "Belum ada bank.")}</p> : (
        <ul className={css.items}>{data.banks.map((b) => {
          const prods = data.products.filter((p) => p.bank_id === b.id);
          return (
            <li key={b.id} className={css.item} data-testid="fa-bank">
              <span className={css.itemMain}>
                <b>{b.name}</b>
                <span className={css.sub}>{L(...(KIND[b.kind] ?? [b.kind, b.kind]))} · {b.branches} {L("branch(es)", "cawangan")} · {b.bankers} {L("banker(s)", "pegawai")}{b.last_verified_on ? ` · ${L("verified", "disahkan")} ${dmy(b.last_verified_on)}` : ""}</span>
                <span className={css.sub}>{prods.length === 0 ? L("No product recorded", "Tiada produk direkod") : prods.map((p) => `${productWord(p.product)} (${p.channel === "central" ? L("central", "pusat") : L("branches", "cawangan")}${p.status === "retired" ? `, ${L("retired", "ditamatkan")}` : ""})`).join(" · ")}</span>
                {b.retired_reason && <span className={css.sub}>{b.retired_reason}</span>}
              </span>
              <span className={`${b.status === "verified" ? chipSmSuccess : b.status === "pending" ? chipSmWarn : chipSmNeutral} ${css.chip}`}>{b.status === "verified" ? L("Verified", "Disahkan") : b.status === "pending" ? L("Pending", "Menunggu") : L("Retired", "Ditamatkan")}</span>
              {data.can.manage && b.status !== "retired" && (
                <span className={css.inline}>
                  {b.status === "pending" && <button type="button" className={btnSm} onClick={() => { setAct({ id: b.id, what: "verify" }); setG({ ...g, source: "", on: mytToday() }); }}>{L("Verify", "Sahkan")}</button>}
                  <button type="button" className={btnSmQuiet} onClick={() => { setAct({ id: b.id, what: "product" }); setG({ ...g, source: "" }); }}>{L("Products", "Produk")}</button>
                  <button type="button" className={btnSmQuiet} onClick={() => { setAct({ id: b.id, what: "retire" }); setG({ ...g, reason: "" }); }}>{L("Retire", "Tamatkan")}</button>
                </span>
              )}
              {act?.id === b.id && (
                <div className={`${css.form} ${css.wide}`}>
                  {act.what === "product" && <>
                    <label className={css.field}>{L("Product", "Produk")}<select className={selectClassSm} value={g.product} onChange={(e) => setG({ ...g, product: e.target.value })}>{PRODUCTS.map(([k]) => <option key={k} value={k}>{productWord(k)}</option>)}</select></label>
                    <label className={css.field}>{L("Handled", "Dikendalikan")}<select className={selectClassSm} value={g.channel} onChange={(e) => setG({ ...g, channel: e.target.value })}><option value="branch">{L("At branches", "Di cawangan")}</option><option value="central">{L("By a central unit", "Oleh unit pusat")}</option></select></label>
                  </>}
                  {act.what !== "retire" && <label className={css.field}>{L("Source (the bank's website, an official letter)", "Sumber (laman web bank, surat rasmi)")}<input className={inputClassSm} value={g.source} maxLength={300} onChange={(e) => setG({ ...g, source: e.target.value })} /></label>}
                  {act.what === "verify" && <label className={css.field}>{L("Confirmed on", "Disahkan pada")}<input className={inputClassSm} type="date" max={mytToday()} value={g.on} onChange={(e) => setG({ ...g, on: e.target.value })} /></label>}
                  {act.what === "retire" && <label className={css.field}>{L("Why (at least 10 characters)", "Sebab (sekurang-kurangnya 10 aksara)")}<input className={inputClassSm} value={g.reason} maxLength={300} onChange={(e) => setG({ ...g, reason: e.target.value })} /></label>}
                  <div className={css.row}>
                    <button type="button" className={btnSmPrimary} disabled={act.what === "retire" ? g.reason.trim().length < 10 : g.source.trim().length < 5}
                      onClick={() => void (act.what === "verify" ? run(`/staff/fa/banks/${b.id}/verify`, { source: g.source, verified_on: g.on }, L("Bank verified", "Bank disahkan"))
                        : act.what === "retire" ? run(`/staff/fa/banks/${b.id}/retire`, { reason: g.reason }, L("Bank retired", "Bank ditamatkan"))
                          : run(`/staff/fa/banks/${b.id}/products`, { product: g.product, channel: g.channel, source: g.source }, L("Product saved", "Produk disimpan")))}>{L("Save", "Simpan")}</button>
                    <button type="button" className={btnSmQuiet} onClick={() => setAct(null)}>{L("Cancel", "Batal")}</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}</ul>
      )}
      {adding && (
        <SideDrawer open onClose={() => setAdding(false)} dirty={!!f.name} title={L("Add bank", "Tambah bank")} subtitle={L("The official name, from the bank's own sources", "Nama rasmi, daripada sumber bank sendiri")}>
          <div className={css.stack}>
            <div className={css.form}>
              <label className={css.field}>{L("Official name", "Nama rasmi")}<input className={inputClassSm} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="fa-bank-name" /></label>
              <label className={css.field}>{L("Kind", "Jenis")}<select className={selectClassSm} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{L(v[0], v[1])}</option>)}</select></label>
              <label className={css.field}>{L("Official website (optional)", "Laman web rasmi (pilihan)")}<input className={inputClassSm} value={f.website} maxLength={160} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
              <label className={css.field}>{L("Source (optional)", "Sumber (pilihan)")}<input className={inputClassSm} value={f.source} maxLength={300} onChange={(e) => setF({ ...f, source: e.target.value })} /></label>
            </div>
            <p className="erp-note">{L("Saved as Pending. A bank written another way (\"Bhd\", capitals, spaces) is recognised as the same bank.", "Disimpan sebagai Menunggu. Bank yang ditulis cara lain (\"Bhd\", huruf besar, ruang) dikenali sebagai bank yang sama.")}</p>
            <div className={css.row}><button type="button" className={btnSmPrimary} disabled={f.name.trim().length < 2} onClick={() => void run("/staff/fa/banks", { name: f.name, kind: f.kind, website: f.website || undefined, source: f.source || undefined }, L("Bank added", "Bank ditambah")).then((ok) => { if (ok) { setAdding(false); setF({ name: "", kind: "commercial", website: "", source: "" }); } })}>{L("Add bank", "Tambah bank")}</button></div>
          </div>
        </SideDrawer>
      )}
    </section>
  );
}

/* ============================ history ============================ */

interface Ev { id: number; entity: string; event: string; detail: string | null; created_at: string; actor: string | null; subject: string | null }
function History() {
  const [events, setEvents] = useState<Ev[] | null>(null);
  useEffect(() => { let live = true; void api<{ events: Ev[] }>("/staff/fa/registry/events").then((r) => { if (live && r.ok && r.data) setEvents(r.data.events); }); return () => { live = false; }; }, []);
  return (
    <section className={`${card} ${css.sec}`} aria-label={L("Audit history", "Sejarah audit")} data-testid="fa-reg-history">
      <h3 className={css.h}><AppIcon name="time" />{L("Audit history", "Sejarah audit")} <span className={css.sub}>{L("append only", "tambah sahaja")}</span></h3>
      {!events ? <SkelRows rows={5} /> : <EventList events={events} />}
    </section>
  );
}

function EventList({ events }: { events: Ev[] }) {
  if (events.length === 0) return <p className={css.empty}>{L("Nothing recorded yet.", "Belum ada rekod.")}</p>;
  const detailText = (d: string | null) => {
    if (!d) return "";
    try {
      const o = JSON.parse(d) as Record<string, unknown>;
      return ["reason", "note", "source", "method", "to", "availability", "next_review_on", "restrictions"].filter((k) => o[k] != null && o[k] !== "").map((k) => String(o[k])).join(" · ");
    } catch { return ""; }
  };
  return (
    <ul className={css.items}>{events.map((e) => (
      <li key={e.id} className={css.item} data-testid="fa-reg-event">
        <span className={css.itemMain}>
          <b>{L(...(ENTITY[e.entity] ?? [e.entity, e.entity]))}{e.subject ? ` · ${e.subject}` : ""} — {L(...(EVENT[e.event] ?? [e.event.replace(/_/g, " "), e.event.replace(/_/g, " ")]))}</b>
          <span className={css.sub}>{dmyMYT(e.created_at)} · {e.actor ?? "—"}{detailText(e.detail) ? ` · ${detailText(e.detail)}` : ""}</span>
        </span>
      </li>
    ))}</ul>
  );
}
