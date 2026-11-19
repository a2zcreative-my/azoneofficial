"use client";

/* v1.387.0 - COMPANIES MANAGES THE LEGAL ENTITIES (the CEO's restructuring
   brief, 18-11-2026, and his decisions D1-D5 on
   docs/COMPANIES-USERS-RESTRUCTURE-AUDIT.md; reference: his "Companies"
   picture).

   Six tabs about A2Z CREATIVE MARKETING and AZ ONE OFFICIAL themselves:
   Company Overview · Corporate Details · Ownership & Directors ·
   Documents & Signing · Audit & History · Access Summary.

   The rule the page keeps: Companies manages legal entities. Users &
   Security manages access. HR manages employment. Finance manages financial
   ownership. So nothing here grants, plans or restricts access (that
   reconciliation moved WHOLE to Users & Security > Company Access - D1), no
   figure is typed in: identity is lib/issuers.ts (the letterhead every
   document prints, held by the document-issuer guard), the glance is
   Finance's and Sales' own reads (D3: /staff/docs/by-company, read-only, by
   the issuer stamped on each invoice), signatories are the signing records,
   the owner is the verified owner record. A read the person may not open
   says so instead of a number. The picture's controls the system cannot do
   (Update Company Details, Upload Documents, a directors register, the
   "Established" date) are left out, never drawn dead (D4). */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LineTabs } from "@/components/ui/line-tabs";
import { PillSwitch } from "@/components/ui/panel";
import { PaginationControls, type PageSize } from "@/components/ui/pagination-controls";
import { SkelRows } from "@/components/ui/skeleton";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { SigningPanel } from "@/components/portal/signing-panel";
import { usePortal } from "@/components/portal/portal-provider";
import { roleLabel } from "@/components/portal/users-shared";
import { api } from "@/lib/api";
import { holds as holdsCap } from "@/lib/caps";
import { COMPANY_CODES, type CompanyCode, type CompanyStaffSetup } from "@/lib/company-review";
import { dmy, dmyMYT, fmtRM, mytToday } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { resolveIssuer } from "@/lib/issuers";
import { btnSm, card, chipInfo, chipNeutral, chipSuccess, chipWarn } from "@/lib/ui-styles";
import css from "./companies.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type View = "overview" | "details" | "ownership" | "signing" | "audit" | "access";
const VIEWS: readonly View[] = ["overview", "details", "ownership", "signing", "audit", "access"];

/* the CEO's decision recorded in lib/issuers.ts: "A2Z invoices, A2Z employs"
   from 19-08-2026; every document before it keeps AZ ONE OFFICIAL */
const SWITCH_DAY = "19-08-2026";
const LAST_AZOO_DAY = "18-08-2026";
const LOGO: Record<CompanyCode, string> = { a2z: "/logo.png", azoo: "/brands/azone.png" };
const SHORT: Record<CompanyCode, string> = { a2z: "A2Z", azoo: "AZ ONE" };
const SHORT_NAME: Record<CompanyCode, string> = { a2z: "A2Z Creative Marketing", azoo: "AZ One Official" };
const last4 = (t: string) => t.replace(/\D/g, "").slice(-4);
const bankShown = (bank: string) => { const w = bank.split(/\s+/)[0] ?? ""; return `${w.charAt(0)}${w.slice(1).toLowerCase()} •••• ${last4(bank)}`; };

/* ---------------- the reads (each says when it is refused) ---------------- */
type Read<T> = { d: T | null; refused: boolean } | null;
function useRead<T>(path: string | null, tick = 0): Read<T> {
  const [got, setGot] = useState<{ path: string; r: Read<T> } | null>(null);
  useEffect(() => {
    if (!path) return;
    const c = new AbortController();
    void api<T>(path, { signal: c.signal }).then((r) => { if (!c.signal.aborted) setGot({ path, r: { d: r.ok ? (r.data as T) : null, refused: !r.ok } }); });
    return () => c.abort();
  }, [path, tick]);
  return path && got?.path === path ? got.r : null;
}
type ByCompany = { month: string; companies: Record<CompanyCode, { invoices: number; invoiced_cents: number; paid_cents: number; outstanding_n: number; outstanding_cents: number }> };
type Cash = { totals: { in_cents: number; out_cents: number }; banks: { id: number; active: number; company: string | null }[] };
type ReviewSummary = { totals: { unassigned: number; pending: number }; checklist: { done: boolean }[]; registers: unknown[]; staff: { active: number; with_access: number; without_access: number } };
type Owner = { owner: { name: string; verified: boolean; set_at: string; set_by_name: string | null } | null };
type Signing = { authorities: { id: number; user_id: number; issuer_code: string; capacity: string; doc_types: string; granted_at: string }[]; people: { id: number; name: string; role: string; position: string | null; is_active: number }[]; policies?: { issuer_code?: string; personal?: number | boolean }[] };
type AuditRow = { id: number; action: string; entity: string | null; entity_id: string | null; detail: string | null; created_at: string; user_name: string | null };

export function CompaniesPanel({ role = "", initialView }: { role?: string; initialView?: string }) {
  const { setTab, setTabStart, canOpen } = usePortal();
  const [view, setView] = useState<View>(() => (VIEWS.includes(initialView as View) ? (initialView as View) : "overview"));
  const [seenStart, setSeenStart] = useState(initialView);
  if (initialView !== seenStart) { setSeenStart(initialView); if (VIEWS.includes(initialView as View)) setView(initialView as View); }
  const canReview = holdsCap("company_review", ["super_admin", "ceo"].includes(role));
  const canAudit = holdsCap("audit_read", ["super_admin", "admin", "ceo"].includes(role));
  const today = mytToday();
  const month = today.slice(0, 7);

  const byCo = useRead<ByCompany>("/staff/docs/by-company");
  const cashA = useRead<Cash>(`/staff/erp/cashbook?from=${month}-01&to=${today}&company=a2z`);
  const cashZ = useRead<Cash>(`/staff/erp/cashbook?from=${month}-01&to=${today}&company=azoo`);
  const cash: Record<CompanyCode, Read<Cash>> = { a2z: cashA, azoo: cashZ };
  const reviewStaff = useRead<{ staff: CompanyStaffSetup[] }>(canReview ? "/staff/companies/staff" : null);
  const summary = useRead<ReviewSummary>(canReview && (view === "overview" || view === "access") ? "/staff/companies/summary" : null);
  const owner = useRead<Owner>(view === "ownership" || view === "overview" ? "/staff/owner" : null);
  const signing = useRead<Signing>(view === "ownership" ? "/staff/signing/overview" : null);

  const members = (co: CompanyCode) => reviewStaff?.d?.staff.filter((s) => s.is_active && s.memberships.some((m) => m.company_code === co)).length ?? null;
  const banks = (co: CompanyCode) => cash[co]?.d ? cash[co]!.d!.banks.filter((b) => b.active && b.company === co).length : null;
  const openUsers = (part?: string) => { if (part) setTabStart({ tab: "Users", view: part }); setTab("Users"); };
  const openTab = (t: "Finance" | "Staff Details" | "HR") => setTab(t);

  const tabs: readonly (readonly [View, string])[] = [
    ["overview", L("Company Overview", "Gambaran Syarikat")],
    ["details", L("Corporate Details", "Butiran Korporat")],
    ["ownership", L("Ownership & Directors", "Pemilikan & Pengarah")],
    ["signing", L("Documents & Signing", "Dokumen & Tandatangan")],
    ["audit", L("Audit & History", "Audit & Sejarah")],
    ["access", L("Access Summary", "Ringkasan Akses")],
  ];

  return (
    <TabPage className={css.page}>
      <LineTabs value={view} onChange={setView} tabs={tabs} label={L("Companies", "Syarikat")} testid="companies-tabs" />

      {/* ================= Company Overview ================= */}
      <div className={css.body} hidden={view !== "overview"} data-testid="companies-overview">
        <div className={css.coGrid}>
          {COMPANY_CODES.map((co) => <CompanyCard key={co} co={co} banks={banks(co)} members={members(co)} reviewer={canReview} />)}
        </div>
        <div className={css.glanceRow}>
          <section className={`${card} ${css.panel}`} aria-label={L("Company at a glance", "Syarikat sepintas lalu")} data-testid="companies-glance">
            <div className={css.panelHead}>
              <h2 className={css.h2}><AppIcon name="chart" />{L("Company at a Glance", "Syarikat Sepintas Lalu")}</h2>
              {canOpen("Finance") && <button type="button" className={btnSm} onClick={() => openTab("Finance")}>{L("Open Finance", "Buka Kewangan")}<AppIcon name="next" /></button>}
            </div>
            <p className={css.meta}>{L(`This month so far, in RM · invoices by the company that issued them (Sales) · Money In / Out from Finance (verified receipts only). Read-only.`, `Bulan ini setakat ini, dalam RM · invois ikut syarikat pengeluar (Jualan) · Tunai Masuk / Keluar dari Kewangan (penerimaan disahkan sahaja). Baca sahaja.`)}</p>
            <div className={css.tableWrap}>
              <table className={css.table}>
                <thead><tr><th>{L("Company", "Syarikat")}</th><th className={css.num}>{L("Invoices", "Invois")}</th><th className={css.num}>{L("Invoiced", "Diinvois")}</th><th className={css.num}>{L("Money In", "Tunai Masuk")}</th><th className={css.num}>{L("Money Out", "Tunai Keluar")}</th><th className={css.num}>{L("Outstanding", "Tertunggak")}</th></tr></thead>
                <tbody>
                  {COMPANY_CODES.map((co) => {
                    const s = byCo?.d?.companies[co];
                    const c = cash[co]?.d;
                    const cell = (r: Read<unknown>, v: ReactNode) => (!r ? <span className={css.skel} aria-hidden="true" /> : r.refused ? <span className={css.muted} title={L("Not available to your role", "Tiada untuk peranan anda")}>—</span> : v);
                    return (
                      <tr key={co} data-testid={`glance-${co}`}>
                        <th scope="row" title={resolveIssuer(co).name}>{SHORT_NAME[co]}</th>
                        <td className={css.num}>{cell(byCo, s?.invoices)}</td>
                        <td className={css.num}>{cell(byCo, s ? fmtRM(s.invoiced_cents).replace(/^RM\s?/, "") : undefined)}</td>
                        <td className={css.num}>{cell(cash[co], c ? fmtRM(c.totals.in_cents).replace(/^RM\s?/, "") : undefined)}</td>
                        <td className={css.num}>{cell(cash[co], c ? fmtRM(c.totals.out_cents).replace(/^RM\s?/, "") : undefined)}</td>
                        <td className={css.num}>{cell(byCo, s ? <span className={s.outstanding_cents > 0 ? css.outChip : undefined} title={L(`${s.outstanding_n} unpaid invoice(s), all time`, `${s.outstanding_n} invois belum dibayar, sepanjang masa`)}>{fmtRM(s.outstanding_cents).replace(/^RM\s?/, "")}</span> : undefined)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={css.meta}>{L("Outstanding is every unpaid invoice, less part payments. A dash: your role does not read that figure.", "Tertunggak ialah semua invois belum dibayar, tolak bayaran separa. Sengkang: peranan anda tidak membaca angka itu.")}</p>
          </section>
          <section className={`${card} ${css.panel}`} aria-label={L("Quick actions", "Tindakan pantas")}>
            <h2 className={css.h2}><AppIcon name="fast" />{L("Quick Actions", "Tindakan Pantas")}</h2>
            <div className={css.qaList}>
              <button type="button" className={css.qa} onClick={() => setView("ownership")}><AppIcon name="edit" /><span>{L("Signatories & owner", "Penandatangan & pemilik")}</span><AppIcon name="next" /></button>
              <button type="button" className={css.qa} onClick={() => setView("signing")}><AppIcon name="document" /><span>{L("Signatures & stamps", "Tandatangan & cop")}</span><AppIcon name="next" /></button>
              <button type="button" className={css.qa} onClick={() => setView("access")}><AppIcon name="lock" /><span>{L("View access summary", "Lihat ringkasan akses")}</span><AppIcon name="next" /></button>
              <button type="button" className={css.qa} onClick={() => setView("details")}><AppIcon name="building" /><span>{L("Corporate details", "Butiran korporat")}</span><AppIcon name="next" /></button>
            </div>
          </section>
        </div>
        <div className={css.linkRow}>
          <LinkCard icon="users" title={L("Company Access & Roles", "Akses Syarikat & Peranan")} text={L("Who can open each company, roles and permissions.", "Siapa boleh membuka setiap syarikat, peranan dan kebenaran.")}
            action={canOpen("Users") ? { label: L("Go to Users & Security", "Ke Pengguna & Keselamatan"), go: () => openUsers(canReview ? "company_access" : undefined) } : null} />
          <LinkCard icon="person" title={L("Employment & Staff", "Pekerjaan & Staf")} text={L("Employment, department, position and reporting line.", "Pekerjaan, jabatan, jawatan dan garis pelaporan.")}
            action={canOpen("Staff Details") ? { label: L("Go to HR / Staff", "Ke HR / Staf"), go: () => openTab("Staff Details") } : canOpen("HR") ? { label: L("Go to HR", "Ke HR"), go: () => openTab("HR") } : null} />
          <section className={css.notes} aria-label={L("Important notes", "Nota penting")}>
            <h2 className={css.h3}><AppIcon name="info" />{L("Important Notes", "Nota Penting")}</h2>
            <ul>
              <li>{L("Companies manages the two legal entities, their details, documents and signatories.", "Syarikat mengurus dua entiti sah, butiran, dokumen dan penandatangannya.")}</li>
              <li>{L("Accounts, roles and company access are managed in Users & Security.", "Akaun, peranan dan akses syarikat diurus dalam Pengguna & Keselamatan.")}</li>
              <li>{L("Employment and the employer are managed in HR / Staff.", "Pekerjaan dan majikan diurus dalam HR / Staf.")}</li>
              <li>{L("Financial records and their company are managed in Finance.", "Rekod kewangan dan syarikatnya diurus dalam Kewangan.")}</li>
            </ul>
          </section>
        </div>
      </div>

      {/* ================= Corporate Details ================= */}
      <div className={css.body} hidden={view !== "details"} data-testid="companies-details">
        <p className={css.notice}><AppIcon name="info" /><span>{L("The registered identity printed on every document. It is legal data kept with the system's documents and changes only by an approved release - not on this page.", "Identiti berdaftar yang dicetak pada setiap dokumen. Ia data sah yang disimpan bersama dokumen sistem dan hanya berubah melalui keluaran yang diluluskan - bukan di halaman ini.")}</span></p>
        <div className={css.coGrid}>
          {COMPANY_CODES.map((co) => {
            const i = resolveIssuer(co);
            return (
              <section key={co} className={`${card} ${css.panel}`} aria-label={i.name} data-testid={`details-${co}`}>
                <h2 className={css.h2}><AppIcon name="building" />{i.name}</h2>
                <dl className={css.kv}>
                  <div><dt>{L("Registration", "Pendaftaran")}</dt><dd>SSM {i.ssm}<span className={css.muted}> · {L("old", "lama")} {i.oldReg}</span></dd></div>
                  <div><dt>{L("Business activity", "Aktiviti perniagaan")}</dt><dd>{i.descriptor}</dd></div>
                  <div><dt>{L("Registered address", "Alamat berdaftar")}</dt><dd>{i.addressLines.map((l) => <span key={l} className={css.line}>{l}</span>)}</dd></div>
                  <div><dt>{L("Official email", "E-mel rasmi")}</dt><dd>{i.email}</dd></div>
                  <div><dt>WhatsApp</dt><dd>{i.whatsapp}</dd></div>
                  <div><dt>{L("Website", "Laman web")}</dt><dd>{i.website}</dd></div>
                  <div><dt>{L("Bank account on invoices", "Akaun bank pada invois")}</dt><dd>{bankShown(i.bank)}<span className={css.muted}> · {i.bankHolder}</span></dd></div>
                  <div><dt>SST</dt><dd>{i.sstRegistered ? L("Registered", "Berdaftar") : L("Not registered - documents say no SST is charged", "Tidak berdaftar - dokumen menyatakan tiada SST dikenakan")}</dd></div>
                  <div><dt>{L("Documents", "Dokumen")}</dt><dd>{co === "a2z" ? L(`Issues every new document since ${SWITCH_DAY}`, `Mengeluarkan setiap dokumen baharu sejak ${SWITCH_DAY}`) : L(`Issued every document until ${LAST_AZOO_DAY}; those keep this letterhead`, `Mengeluarkan setiap dokumen hingga ${LAST_AZOO_DAY}; ia kekal dengan kepala surat ini`)}</dd></div>
                </dl>
              </section>
            );
          })}
        </div>
      </div>

      {/* ================= Ownership & Directors ================= */}
      <div className={css.body} hidden={view !== "ownership"} data-testid="companies-ownership">
        <TabZone label={L("Verified owner", "Pemilik disahkan")} hint={L("The one verified company owner (a CEO account with two-factor on). Designated in Users & Security > Security & MFA.", "Satu pemilik syarikat yang disahkan (akaun CEO dengan dua faktor). Ditetapkan dalam Pengguna & Keselamatan > Keselamatan & MFA.")}>
          <section className={`${card} ${css.panel}`}>
            {!owner ? <SkelRows rows={2} /> : owner.refused ? <p className={css.meta}>{L("Your role does not read the owner record.", "Peranan anda tidak membaca rekod pemilik.")}</p>
              : !owner.d?.owner ? <p className={css.meta} data-testid="owner-none">{L("No company owner is designated yet.", "Belum ada pemilik syarikat ditetapkan.")}</p>
              : <div className={css.ownerRow} data-testid="owner-row">
                  <span className={css.avatar} aria-hidden="true">{owner.d.owner.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}</span>
                  <span><strong>{owner.d.owner.name}</strong><span className={css.meta}>{L(`Designated ${owner.d.owner.set_at ? dmy(String(owner.d.owner.set_at).slice(0, 10)) : ""}${owner.d.owner.set_by_name ? ` by ${owner.d.owner.set_by_name}` : ""}`, `Ditetapkan ${owner.d.owner.set_at ? dmy(String(owner.d.owner.set_at).slice(0, 10)) : ""}${owner.d.owner.set_by_name ? ` oleh ${owner.d.owner.set_by_name}` : ""}`)}</span></span>
                  <span className={owner.d.owner.verified ? chipSuccess : chipWarn}>{owner.d.owner.verified ? L("Verified", "Disahkan") : L("Not verified", "Belum disahkan")}</span>
                </div>}
          </section>
        </TabZone>
        <TabZone label={L("Authorised signatories", "Penandatangan diberi kuasa")} hint={L("Who may prepare or approve documents for each company - the signing records. They are granted and removed in Documents & Signing.", "Siapa boleh menyediakan atau meluluskan dokumen bagi setiap syarikat - rekod tandatangan. Diberi dan ditarik dalam Dokumen & Tandatangan.")}>
          <div className={css.coGrid}>
            {COMPANY_CODES.map((co) => {
              const rows = (signing?.d?.authorities ?? []).filter((a) => a.issuer_code === co);
              const person = (id: number) => signing?.d?.people.find((p) => p.id === id);
              return (
                <section key={co} className={`${card} ${css.panel}`} aria-label={resolveIssuer(co).name} data-testid={`signatories-${co}`}>
                  <h2 className={css.h3}>{resolveIssuer(co).name}</h2>
                  {!signing ? <SkelRows rows={2} /> : signing.refused ? <p className={css.meta}>{L("Your role does not read the signing records.", "Peranan anda tidak membaca rekod tandatangan.")}</p>
                    : rows.length === 0 ? <p className={css.meta}>{L("No signing authority granted yet.", "Belum ada kuasa tandatangan diberi.")}</p>
                    : <ul className={css.people}>{rows.map((a) => { const p = person(a.user_id); return (
                        <li key={a.id}><strong>{p?.name ?? `#${a.user_id}`}</strong><span className={css.meta}>{p ? roleLabel(p.role) : ""}{p?.position ? ` · ${p.position}` : ""}</span>
                          <span className={a.capacity === "approve" ? chipInfo : chipNeutral}>{a.capacity === "approve" ? L("Approves", "Meluluskan") : L("Prepares", "Menyediakan")}</span>
                          <span className={css.meta}>{a.doc_types}</span></li>); })}</ul>}
                </section>
              );
            })}
          </div>
        </TabZone>
        <TabZone label={L("Directors and management appointments", "Pengarah dan pelantikan pengurusan")}>
          <section className={`${card} ${css.panel}`}>
            <p className={css.meta} data-testid="directors-none">{L("A directors register is not kept in A2Z OS yet. The registered directors are in each company's SSM records; a register here would be a separate feature you approve.", "Daftar pengarah belum disimpan dalam A2Z OS. Pengarah berdaftar ada dalam rekod SSM setiap syarikat; daftar di sini ialah ciri berasingan yang anda luluskan.")}</p>
          </section>
        </TabZone>
      </div>

      {/* ================= Documents & Signing ================= */}
      <SigningBody show={view === "signing"} />

      {/* ================= Audit & History ================= */}
      <div className={css.body} hidden={view !== "audit"} data-testid="companies-audit">
        {view === "audit" && <CorporateAudit allowed={canAudit} />}
      </div>

      {/* ================= Access Summary ================= */}
      <div className={css.body} hidden={view !== "access"} data-testid="companies-access">
        <p className={css.notice} role="status"><AppIcon name="warning" /><span><strong>{L("Reconciliation only.", "Penyesuaian sahaja.")}</strong> {L("Company access restrictions are not active - roles still decide what each person can open. Access is managed only in Users & Security.", "Sekatan akses syarikat belum aktif - peranan masih menentukan apa yang boleh dibuka. Akses diurus hanya dalam Pengguna & Keselamatan.")}</span></p>
        {canReview ? (
          <KpiRow label={L("Company access at a glance", "Akses syarikat sepintas lalu")} testid="access-summary-figures">
            <KpiTile icon="pending" tone="gold" busy={!summary} label={L("Records not yet reviewed", "Rekod belum disemak")} value={summary?.d?.totals.unassigned ?? "—"} sub={L(`across ${summary?.d?.registers.length ?? 9} registers`, `merentasi ${summary?.d?.registers.length ?? 9} daftar`)} />
            <KpiTile icon="verify" tone="blue" busy={!summary} label={L("Reviewed, not settled", "Disemak, belum muktamad")} value={summary?.d?.totals.pending ?? "—"} />
            {COMPANY_CODES.map((co) => <KpiTile key={co} icon="users" tone="navy" busy={!reviewStaff} label={L(`Proposed for ${SHORT[co]}`, `Dicadang untuk ${SHORT[co]}`)} value={members(co) ?? "—"} sub={L("active staff in the plan · not enforced", "staf aktif dalam pelan · belum dikuatkuasa")} />)}
            <KpiTile icon="lock" tone="red" busy={!summary} label={L("Access readiness", "Kesediaan akses")} value={summary?.d ? `${summary.d.checklist.filter((c) => c.done).length} / ${summary.d.checklist.length}` : "—"} sub={L("Not active", "Belum aktif")} />
          </KpiRow>
        ) : (
          <section className={`${card} ${css.panel}`}><p className={css.meta}>{L("Everyone sees both companies as their role allows. The company access review is kept by the CEO.", "Semua orang melihat kedua-dua syarikat mengikut peranan. Semakan akses syarikat dipegang oleh CEO.")}</p></section>
        )}
        {canOpen("Users") && <div className={css.formRow}><button type="button" className="erp-button erp-button-accent" onClick={() => openUsers(canReview ? "company_access" : undefined)} data-testid="access-summary-open">{canReview ? L("Open Users & Security > Company Access", "Buka Pengguna & Keselamatan > Akses Syarikat") : L("Open Users & Security", "Buka Pengguna & Keselamatan")}<AppIcon name="next" /></button></div>}
      </div>
    </TabPage>
  );
}

/* Documents & Signing: the same SigningPanel (signing.ts decides who
   manages - CEO, super admin; the COO and CCO read), mounted once opened,
   with the letterhead and controlled form numbers of each company above it */
function SigningBody({ show }: { show: boolean }) {
  const [opened, setOpened] = useState(show);
  if (show && !opened) setOpened(true);
  if (!opened) return null;
  return (
    <div className={css.body} hidden={!show} data-testid="companies-signing">
      <TabZone label={L("Letterheads & controlled forms", "Kepala surat & borang terkawal")} hint={L("Each document prints the company that issued it - an AZ ONE OFFICIAL document never wears A2Z's letterhead, and the reverse.", "Setiap dokumen mencetak syarikat yang mengeluarkannya - dokumen AZ ONE OFFICIAL tidak memakai kepala surat A2Z, dan sebaliknya.")}>
        <section className={`${card} ${css.panel}`}>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead><tr><th>{L("Company", "Syarikat")}</th><th>{L("Letterhead", "Kepala surat")}</th><th>{L("Claim form", "Borang tuntutan")}</th><th>{L("Leave form", "Borang cuti")}</th><th>{L("Issues", "Mengeluarkan")}</th></tr></thead>
              <tbody>{COMPANY_CODES.map((co) => { const i = resolveIssuer(co); return (
                <tr key={co}><th scope="row">{i.name}</th><td>{i.descriptor} · {i.registration}</td><td>{i.claimFormNo} v{i.claimFormVersion}</td><td>{i.leaveFormNo} v{i.leaveFormVersion}</td>
                  <td>{co === "a2z" ? L(`New documents since ${SWITCH_DAY}`, `Dokumen baharu sejak ${SWITCH_DAY}`) : L(`Documents until ${LAST_AZOO_DAY}`, `Dokumen hingga ${LAST_AZOO_DAY}`)}</td></tr>); })}</tbody>
            </table>
          </div>
        </section>
      </TabZone>
      <TabZone label={L("Signatures, stamps and signing policy", "Tandatangan, cop dan polisi tandatangan")}><SigningPanel /></TabZone>
    </div>
  );
}

/* Audit & History: the corporate trail - signing and owner records from the
   audit log (the access review's own history is in Users & Security >
   Company Access). Read-only, newest first, 10 a page. */
const AUDIT_KINDS = { all: ["signing.", "owner."], signing: ["signing."], owner: ["owner."] } as const;
function CorporateAudit({ allowed }: { allowed: boolean }) {
  const [kind, setKind] = useState<keyof typeof AUDIT_KINDS>("all");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const sig = useRead<{ entries: AuditRow[] }>(allowed ? "/audit?action=signing.&limit=300" : null);
  const own = useRead<{ entries: AuditRow[] }>(allowed ? "/audit?action=owner.&limit=300" : null);
  const rows = useMemo(() => [...(sig?.d?.entries ?? []), ...(own?.d?.entries ?? [])]
    .filter((r) => AUDIT_KINDS[kind].some((p) => r.action.startsWith(p)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id)), [sig, own, kind]);
  if (!allowed) return <section className={`${card} ${css.panel}`}><p className={css.meta}>{L("Only the CEO, the admin and the super admin read the audit log.", "Hanya CEO, admin dan super admin membaca log audit.")}</p></section>;
  const loading = !sig || !own;
  const shown = rows.slice((page - 1) * size, page * size);
  const company = (r: AuditRow) => { const m = /"issuer(?:_code)?":"(a2z|azoo)"/.exec(r.detail ?? ""); return m ? SHORT[m[1] as CompanyCode] : "—"; };
  return (
    <section className={`${card} ${css.panel}`} data-testid="corporate-audit">
      <div className={css.panelHead}>
        <h2 className={css.h2}><AppIcon name="time" />{L("Corporate changes", "Perubahan korporat")}</h2>
        <PillSwitch testid="audit-kind" label={L("Changes", "Perubahan")} value={kind} onChange={(k) => { setKind(k); setPage(1); }}
          options={[["all", L("All", "Semua")], ["signing", L("Signing", "Tandatangan")], ["owner", L("Owner", "Pemilik")]]} />
      </div>
      <p className={css.meta}>{L("Who did what and when, in Malaysia time. Entries are never edited or removed.", "Siapa buat apa dan bila, waktu Malaysia. Catatan tidak pernah diubah atau dibuang.")}</p>
      {loading ? <SkelRows rows={5} /> : rows.length === 0 ? <p className={css.meta}>{L("No corporate changes recorded yet.", "Belum ada perubahan korporat direkod.")}</p> : <>
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead><tr><th>{L("When", "Bila")}</th><th>{L("Who", "Siapa")}</th><th>{L("Change", "Perubahan")}</th><th>{L("Company", "Syarikat")}</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}><td className={css.nowrap}>{dmyMYT(r.created_at)}</td><td>{r.user_name ?? L("System", "Sistem")}</td><td>{r.action.replace(/[._]/g, " ")}</td><td>{company(r)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <PaginationControls page={page} total={rows.length} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} label={L("Corporate change pages", "Halaman perubahan korporat")} testid="audit-pages" />
      </>}
    </section>
  );
}

function CompanyCard({ co, banks, members, reviewer }: { co: CompanyCode; banks: number | null; members: number | null; reviewer: boolean }) {
  const i = resolveIssuer(co);
  const operating = co === "a2z";
  return (
    <section className={`${card} ${css.coCard} ${operating ? css.coOn : ""}`} aria-label={i.name} data-testid={`company-card-${co}`}>
      <div className={css.coTop}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO[co]} alt="" className={css.logo} />
        <div className={css.coName}>
          <span className={operating ? chipSuccess : chipNeutral}>{operating ? L("Operating issuer", "Pengeluar semasa") : L("Legacy issuer", "Pengeluar lama")}</span>
          <h2 className={css.coTitle}>{i.name}</h2>
          <span className={css.meta}>SSM {i.ssm} ({i.oldReg})</span>
        </div>
      </div>
      <div className={css.facts}>
        <Fact icon="date" label={operating ? L("Issuing since", "Mengeluarkan sejak") : L("Issued until", "Mengeluarkan hingga")} value={operating ? SWITCH_DAY : LAST_AZOO_DAY} />
        <Fact icon="store" label={L("Business type", "Jenis perniagaan")} value={i.descriptor} />
        <Fact icon="money" label={L("Bank accounts", "Akaun bank")} value={banks === null ? "—" : L(`${banks} account${banks === 1 ? "" : "s"}`, `${banks} akaun`)} />
        <Fact icon="users" label={L("Proposed members", "Ahli dicadang")} value={reviewer ? (members === null ? "—" : L(`${members} · planned`, `${members} · dirancang`)) : L("By role", "Ikut peranan")} />
      </div>
    </section>
  );
}
function Fact({ icon, label, value }: { icon: "date" | "store" | "money" | "users"; label: string; value: string }) {
  return <div className={css.fact}><AppIcon name={icon} /><span><span className={css.meta}>{label}</span><strong>{value}</strong></span></div>;
}
function LinkCard({ icon, title, text, action }: { icon: "users" | "person"; title: string; text: string; action: { label: string; go: () => void } | null }) {
  return (
    <section className={`${card} ${css.link}`}>
      <span className={css.linkWell}><AppIcon name={icon} /></span>
      <span className={css.linkBody}>
        <h2 className={css.h3}>{title}</h2>
        <span className={css.meta}>{text}</span>
        {action && <button type="button" className={css.linkBtn} onClick={action.go}>{action.label}<AppIcon name="next" /></button>}
      </span>
    </section>
  );
}
