"use client";

/* v1.4.213 (team feedback via CEO): company asset / equipment register.
   NEW file — nothing existing imported or altered; tokens copied from the
   approved design. Form is SECTIONED the way the CEO asked ("subhead and
   text placement box"): 🏷 Identification → 🧾 Purchase → 📍 Assignment &
   status. Assets are never deleted; status moves to lost/disposed.
   v1.153.0: EXCEPT a row that never described a real thing - a typo, an
   entry made twice - which can be removed (soft, audited, tag freed).

   v1.199.0 - FIVE TABS, on the owner's mockup (23-10-2026): Overview, Asset
   Register, Assignments, Maintenance & Disposal, Reports & Audit. The same
   register read (/staff/assets), the same add, edit and remove, the same
   rule for the value (lost and disposed are not counted). New on screen:
   search, filters and pages over the register; the assets grouped by person
   and by status; a status change that asks first for lost or disposed; and
   the audit log the worker already writes (asset.create / .update /
   .remove), read from /audit - admin tier, exactly as the server decides.
   Add, edit and status changes show only to the roles the server lets write
   (hr_manage, sent as can_remove); everyone else reads. Every zone stays
   mounted and hides with av.off.

   v1.303.0 - ASSETS WORKSPACE 4.0, PHASE 1 (the CEO, 14-11-2026: "approve as
   recommendation" on claude/ASSETS-WORKSPACE-4.0-BLUEPRINT.md). The five
   tabs stay; each is in the address (Back / Forward, a link opens it) and a
   phone gets the Dashboard's view switch with + Add beside it, never a
   cut-off tab row. Every count and cost comes from lib/asset-figures.ts (one
   figure source for the Overview and the reports). The money is the RECORDED
   PURCHASE COST: an asset with no price is "without a price", never RM 0, and
   no book value is shown. Each asset has its company (A2Z / AZ ONE, set by a
   person - never guessed) and a shared-use asset its team or place (0193).
   The history is the asset events of the audit log, open to everyone who
   may open the register (/staff/assets/history, D-7). The COO edits (A3). */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRecordFocus, useScrollToRecord, type RecordFocus } from "@/lib/record-focus";
import { api } from "@/lib/api"; // v1.23.1: raw fetch here missed the CSRF header — saves 403'd
import { useSaveToast } from "@/components/ui/save-toast";
import { btnClass, btnSm, card, chipDanger, chipInfo, chipNeutral, chipSuccess, chipWarn, inputClassSm, th, td, thR2, tdR2 } from "@/lib/ui-styles";
import { rowBtn, rowBtnDanger, rowActions } from "@/components/ui/row-button";
import { useConfirm } from "@/components/ui/confirm-dialog"; // v1.153.0 - the removal asks first
import { Skel, SkelRows, StaleHint } from "@/components/ui/skeleton";
import { TabPage, TabZone } from "@/components/portal/tab-concept";
import { useCachedApi } from "@/lib/cached-api";
import { getLang } from "@/lib/i18n";
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile, type KpiTone } from "@/components/ui/kpi-tile";
import { Donut } from "@/components/ui/donut";
import { Avatar } from "@/components/ui/avatar";
import { SideDrawer } from "@/components/ui/side-drawer";
import { dmy, dmyMYT, mytToday } from "@/lib/format";
import { ViewSwitch } from "@/components/portal/executive-cards";
import { useTabViewAddress } from "@/lib/tab-view";
import { downloadCsv } from "@/lib/csv";
import { COMPANY_NOT_SET, companyKey, companyLines, groupLines, lineOf, missingOf, share, statusLines, type Line, type MissingField } from "@/lib/asset-figures";
import { buildAssetReportPdf } from "@/lib/asset-report-pdf";
import { downloadPdf } from "@/lib/fa-agreement";
import { CustodyPanel, CustodyQueue, MyAssets } from "./asset-custody"; // v1.304.0 - phase 2: custody
import { CareBoard, CarePanel, eventLabel, eventText, type CareEvent } from "./asset-care"; // v1.305.0 - phase 3: maintenance and disposal
import av from "./assets-page.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const input = "border-border bg-background mt-0.5 h-8 w-full rounded-lg border px-2 text-sm";
// v1.4.272: the private td const was deleted — the global th/td/thR2/tdR2 rule applies here too.

interface Asset {
  id: number; asset_tag: string; name: string; category: string;
  brand_model: string | null; serial_no: string | null;
  purchase_date: string | null; purchase_price_cents: number | null;
  vendor: string | null; warranty_until: string | null; location: string | null;
  assigned_to: number | null; assigned_name: string | null;
  status: string; condition_note: string | null;
  /* v1.303.0 - the asset profile (0193): the owning company, and the team or place that shares it */
  issuer_code?: string | null; shared_label?: string | null;
  /* v1.304.0 - the hand-over still waiting for its holder's acknowledgement (0194) */
  pending_custody_id?: number | null;
  /* the row's own timestamps, sent with a.* - used to order "recent" */
  created_at?: string | null; updated_at?: string | null;
}
interface StaffLite { id: number; name: string; role?: string }
interface AuditRow { id: number; action: string; entity: string | null; entity_id: string | null; detail: string | null; created_at: string; user_name: string | null }

const CATS = [["electronics", "Electronics", "Elektronik"], ["furniture", "Furniture", "Perabot"], ["vehicle", "Vehicle", "Kenderaan"], ["studio", "Studio equipment", "Peralatan studio"], ["other", "Other", "Lain-lain"]] as const;
const STATUSES = [["in_use", "In use", "Sedang digunakan"], ["spare", "Spare", "Simpanan"], ["repair", "In repair", "Dalam pembaikan"], ["lost", "Lost", "Hilang"], ["disposed", "Disposed", "Dilupuskan"]] as const;
import { fmtRM as rm } from "@/lib/format"; // v1.4.272: the global formatter
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";

const EMPTY = {
  asset_tag: "", name: "", category: "electronics", brand_model: "", serial_no: "",
  purchase_date: "", purchase_price: "", vendor: "", warranty_until: "",
  location: "", assigned_to: "", status: "in_use", condition_note: "",
  issuer_code: "", shared_label: "", company_reason: "",
};
/* v1.303.0 - the two companies by their legal names (lib/issuers.ts); an asset without one is "Company not set" */
const COMPANY: Record<string, string> = { a2z: "A2Z CREATIVE MARKETING", azoo: "AZ ONE OFFICIAL" };
const companyLabel = (k: string | null | undefined) => (k && COMPANY[k]) || L("Company not set", "Syarikat belum ditetapkan");

/* v1.199.0 - one badge per status, from the shared chip vocabulary */
const STATUS_CHIP: Record<string, string> = {
  in_use: chipSuccess,
  spare: chipInfo,
  repair: chipWarn,
  lost: chipDanger,
  disposed: chipNeutral,
};
const STATUS_TILE: Record<string, { icon: AppIconName; tone: KpiTone }> = {
  in_use: { icon: "package", tone: "green" },
  spare: { icon: "document", tone: "blue" },
  repair: { icon: "fix", tone: "gold" },
  lost: { icon: "warning", tone: "red" },
  disposed: { icon: "blocked", tone: "navy" },
};
const STATUS_COLOR: Record<string, string> = {
  in_use: "var(--success)", spare: "var(--info)", repair: "var(--warning)", lost: "var(--danger)", disposed: "var(--muted-foreground)",
};
const statusLabel = (code: string) => { const st = STATUSES.find(([v]) => v === code); return st ? L(st[1], st[2]) : code; };
const catLabel = (code: string) => { const c = CATS.find(([v]) => v === code); return c ? L(c[1], c[2]) : code; };
const noLocation = () => L("No location", "Tiada lokasi");
const PER_PAGE = [10, 25, 50] as const;

type AssetView = "overview" | "register" | "assign" | "care" | "reports";
const VIEWS: readonly AssetView[] = ["overview", "register", "assign", "care", "reports"];
type Report = "status" | "category" | "location" | "company" | "assignment" | "missing" | "warranty" | "maintenance" | "losses" | "audit";

export function AssetsPanel({ focus, startView }: { focus?: RecordFocus | null; startView?: string }) {
  type AssetCol = "tag" | "item" | "brand" | "company" | "assigned" | "location" | "status" | "value" | "date";
  const [assetSort, setAssetSort] = useState<{ col: AssetCol; asc: boolean }>({ col: "tag", asc: true });
  const cycleAsset = (col: AssetCol) => setAssetSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: true });
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<number | null>(null);
  const [openForm, setOpenForm] = useState(false);
  /* v1.210.0 (the owner's Assets brief, 25-10-2026) - ONE ASSET DRAWER: an
     asset's record, its holder, its history and the commands the row has.
     Opened from any tag or name, and from a search hit. */
  const [detailId, setDetailId] = useState<number | null>(null);
  const [dTab, setDTab] = useState<"assignment" | "care" | "history">("assignment"); // v1.303.0 - the Asset Detail's tabs
  const [regMode, setRegMode] = useState<"list" | "grid">("list");
  /* opening it from a click also reads the history (the audit log, for the
     roles the server lets read it); from a search hit it is one press away */
  const openDetail = (a: Asset) => { setStatusFor(null); setDetailId(a.id); };
  const { show: showToast, node: toastNode } = useSaveToast(); // v1.4.221 standard save popup
  const { confirm, node: confirmNode } = useConfirm();
  /* v1.104.0 (roadmap phase 02) - remembered, then refreshed: the register
     you saw last time paints from the device before the request lands. A
     write on any asset bumps the "assets" topic and the view refetches.
     v1.77.0 (kept): until the first EVER response the count chips and the
     table are skeletons, never "No assets yet". */
  const register = useCachedApi<{ assets: Asset[]; can_remove?: boolean; can?: { edit: boolean; company_change: boolean }; custody_live?: boolean; care_live?: boolean }>("/staff/assets", true, ["assets"]);
  const canRemove = register.data?.can_remove === true;
  /* v1.199.0 - can_remove is the server's hr_manage answer, and hr_manage is
     also what POST and PATCH /assets demand: the same flag decides whether
     Add, Edit and Change status are offered. A button that 403s is worse
     than no button. */
  const canEdit = canRemove;
  const canMoveCompany = register.data?.can?.company_change === true;
  /* v1.304.0 - after 0194 the holder changes only through Assign / Transfer / Return (D-5) */
  const custodyLive = register.data?.custody_live === true;
  /* v1.305.0 - after 0195 In repair, Lost and Disposed come only from their records; a plain status change is In use <-> Spare */
  const careLive = register.data?.care_live === true;
  const CARE = ["repair", "lost", "disposed"];
  const statusChoices = (cur: string) => (careLive ? STATUSES.filter(([v]) => v === "in_use" || v === "spare" || v === cur) : STATUSES);
  const [careTick, setCareTick] = useState(0);
  /* v1.21.0: assignment picker reads /staff-list — the one picker source
     (active staff only, full names) instead of the raw account list. */
  const people = useCachedApi<{ staff: StaffLite[] }>("/staff/staff-list", true, ["users"]);
  const assets = useMemo(() => register.data?.assets ?? [], [register.data]);
  const staff = useMemo(() => people.data?.staff ?? [], [people.data]);
  const loaded = !register.loading;
  const unavailable = register.failed && !register.data;
  const refreshRegister = register.refresh;
  const load = useCallback(() => { refreshRegister(); }, [refreshRegister]);

  /* v1.303.0 - the view is in the address (Back / Forward, a link opens it) */
  const [view, setView] = useState<AssetView>(() => ((VIEWS as readonly string[]).includes(startView ?? "") ? startView as AssetView : "overview"));
  const [seenStart, setSeenStart] = useState(startView);
  if (startView !== seenStart) { setSeenStart(startView); if ((VIEWS as readonly string[]).includes(startView ?? "")) setView(startView as AssetView); }
  const allowedView = useCallback((v: string | null): v is AssetView => !!v && (VIEWS as readonly string[]).includes(v), []);
  useTabViewAddress("Assets", view, setView, allowedView);
  const [report, setReport] = useState<Report>("status");
  const go = (v: AssetView, anchor?: string) => {
    setView(v);
    if (v === "reports" || anchor === "asset-history") void loadAudit();
    if (anchor) window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  };

  const f = (k: keyof typeof EMPTY) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((d) => ({ ...d, [k]: e.target.value })),
  });

  const startEdit = (a: Asset) => {
    /* v1.210.0 - the same form, in a drawer over the page you were on */
    setDetailId(null);
    setEditId(a.id); setOpenForm(true);
    setForm({
      asset_tag: a.asset_tag, name: a.name, category: a.category,
      brand_model: a.brand_model ?? "", serial_no: a.serial_no ?? "",
      purchase_date: a.purchase_date ?? "", purchase_price: a.purchase_price_cents != null ? String(a.purchase_price_cents / 100) : "",
      vendor: a.vendor ?? "", warranty_until: a.warranty_until ?? "",
      location: a.location ?? "", assigned_to: a.assigned_to != null ? String(a.assigned_to) : "",
      status: a.status, condition_note: a.condition_note ?? "",
      issuer_code: a.issuer_code ?? "", shared_label: a.shared_label ?? "", company_reason: "",
    });
  };
  const startAdd = () => {
    setDetailId(null);
    setEditId(null); setForm({ ...EMPTY }); setOpenForm(true);
  };
  const closeForm = () => { setOpenForm(false); setEditId(null); setForm({ ...EMPTY }); };

  const save = async () => {
    /* v1.303.0 - the company and the shared label go only when they changed (an
       older database answers not_ready for them); the reason only with a move */
    const was = editId ? assets.find((x) => x.id === editId) : null;
    const { company_reason, issuer_code, shared_label: labelTyped, ...rest } = form;
    const shared_label = rest.assigned_to !== "" ? "" : labelTyped; // one holder, or shared - never both
    const body = JSON.stringify({
      ...rest,
      ...((was ? issuer_code !== (was.issuer_code ?? "") : !!issuer_code) ? { issuer_code } : {}),
      ...((was ? shared_label !== (was.shared_label ?? "") : !!shared_label.trim()) ? { shared_label } : {}),
      ...(was?.issuer_code && issuer_code !== was.issuer_code ? { company_reason } : {}),
    });
    /* v1.23.1: through the shared api() helper — the raw fetch never sent
       X-CSRF-Token, so every asset save 403'd ("CSRF token mismatch"). */
    const res = editId
      ? await api<{ error?: { message?: string } }>(`/staff/assets/${editId}`, { method: "PATCH", body })
      : await api<{ error?: { message?: string } }>(`/staff/assets`, { method: "POST", body });
    if (res.ok) {
      showToast(editId ? L("Asset updated", "Aset dikemas kini") : L("Asset added", "Aset ditambah"), editId ? L("Changes saved to the register", "Perubahan disimpan ke daftar") : L("New asset in the register", "Aset baharu dalam daftar"));
      setForm({ ...EMPTY }); setEditId(null); setOpenForm(false); load();
    } else {
      showToast(L("Save failed", "Simpan gagal"), res.data?.error?.message ?? L("Please try again", "Sila cuba lagi"), "notice");
    }
  };

  /* v1.153.0 (CEO: "need to have an option to delete if there is a typo
     error there or amendment require to fill new one"). The dialog says what
     removal is and is not: the row leaves the register and frees its tag,
     the audit log keeps the whole record. A thing that existed and is gone
     is still "lost" or "disposed", not removed. Both outcomes toast. */
  const remove = async (a: Asset) => {
    const okC = await confirm({
      title: L(`Remove ${a.asset_tag}?`, `Buang ${a.asset_tag}?`),
      message: L(
        `${a.name}${a.brand_model ? ` · ${a.brand_model}` : ""}\nFor a typo or an entry made by mistake. It leaves the register and the tag ${a.asset_tag} is freed for the corrected entry; the audit log keeps the full record.\nA real asset that is gone should be marked lost or disposed instead.`,
        `${a.name}${a.brand_model ? ` · ${a.brand_model}` : ""}\nUntuk kesilapan taip atau entri yang tersilap. Ia keluar dari daftar dan tag ${a.asset_tag} dibebaskan untuk entri yang betul; log audit menyimpan rekod penuh.\nAset sebenar yang sudah tiada patut ditanda hilang atau dilupuskan.`),
      confirmLabel: L("Remove entry", "Buang entri"),
      variant: "danger",
    });
    if (!okC) return;
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/staff/assets/${a.id}`, { method: "DELETE", body: JSON.stringify({ reason: "typo" }) });
    if (res.ok) {
      showToast(L("Entry removed", "Entri dibuang"), L(`${a.asset_tag} is off the register — recorded in the audit log`, `${a.asset_tag} dikeluarkan dari daftar — direkodkan dalam log audit`));
      if (editId === a.id) { setForm({ ...EMPTY }); setEditId(null); setOpenForm(false); }
      if (detailId === a.id) setDetailId(null);
      load();
    } else {
      showToast(L("Not removed", "Tidak dibuang"), res.data?.error?.message ?? L("Please try again", "Sila cuba lagi"), "notice");
    }
  };

  /* v1.199.0 - CHANGE STATUS, the mockup's "Update status". The same PATCH
     the editor sends, with only the status and the condition note. Lost and
     disposed ask first: they take the asset out of the value and are how a
     real asset leaves service - the record itself stays. */
  const [statusFor, setStatusFor] = useState<Asset | null>(null);
  const [nextStatus, setNextStatus] = useState("in_use");
  const [nextNote, setNextNote] = useState("");
  const openStatusChange = (a: Asset) => { setDetailId(null); setStatusFor(a); setNextStatus(a.status); setNextNote(a.condition_note ?? ""); };
  const saveStatus = async () => {
    const a = statusFor;
    if (!a) return;
    if (nextStatus === a.status && nextNote === (a.condition_note ?? "")) {
      showToast(L("No changes", "Tiada perubahan"), L("The status and note are as saved", "Status dan nota seperti yang disimpan"), "notice");
      return;
    }
    if (nextStatus !== a.status && (nextStatus === "lost" || nextStatus === "disposed")) {
      /* the drawer steps aside for the question (it sits above the dialog
         layer) and comes back with the choice intact if the answer is no */
      setStatusFor(null);
      const okS = await confirm({
        title: L(`Mark ${a.asset_tag} as ${statusLabel(nextStatus).toLowerCase()}?`, `Tanda ${a.asset_tag} sebagai ${statusLabel(nextStatus).toLowerCase()}?`),
        message: L(
          `${a.name}${a.brand_model ? ` · ${a.brand_model}` : ""}\nIt stays in the register and its history is kept, but it no longer counts in the asset value.`,
          `${a.name}${a.brand_model ? ` · ${a.brand_model}` : ""}\nIa kekal dalam daftar dan sejarahnya disimpan, tetapi tidak lagi dikira dalam nilai aset.`),
        confirmLabel: L(`Mark ${statusLabel(nextStatus).toLowerCase()}`, `Tanda ${statusLabel(nextStatus).toLowerCase()}`),
        variant: "danger",
      });
      if (!okS) { setStatusFor(a); return; }
    }
    const res = await api<{ error?: { message?: string } }>(`/staff/assets/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus, condition_note: nextNote }) });
    if (res.ok) {
      showToast(L("Asset updated", "Aset dikemas kini"), L(`${a.asset_tag} — ${statusLabel(nextStatus)}`, `${a.asset_tag} — ${statusLabel(nextStatus)}`));
      setStatusFor(null); load();
    } else {
      showToast(L("Save failed", "Simpan gagal"), res.data?.error?.message ?? L("Please try again", "Sila cuba lagi"), "notice");
    }
  };

  /* v1.199.0 - THE AUDIT LOG, as the worker already keeps it. Read on
     demand, never cached on the device, and only what the server lets this
     role see (admin tier) - a refusal is said, not hidden. */
  const [audit, setAudit] = useState<{ state: "idle" | "loading" | "ok" | "denied" | "error"; entries: AuditRow[] }>({ state: "idle", entries: [] });
  /* v1.303.0 - read once per open (a save reads it again); the state changes only when the answer lands */
  const auditState = audit.state;
  const loadAudit = useCallback(async (again = false) => {
    if (auditState === "ok" && !again) return;
    const r = await api<{ entries?: AuditRow[] }>(`/staff/assets/history?limit=300`); // v1.303.0 - the asset events only, for everyone who may open the register (D-7)
    if (r.ok) setAudit({ state: "ok", entries: r.data?.entries ?? [] });
    else setAudit({ state: r.status === 403 ? "denied" : "error", entries: [] });
  }, [auditState]);
  const showAsset = (a: Asset) => { openDetail(a); void loadAudit(); };
  /* v1.303.0 - the Overview's Recent Activities and the Audit Trail read the asset history; a view opened from the address loads it too */
  useEffect(() => { if (view === "overview" || view === "reports") void loadAudit(); }, [view, loadAudit]);
  /* a write refreshes the register; the history it wrote is read again with it */
  const regData = register.data;
  useEffect(() => { if (auditState === "ok") void loadAudit(true); }, [regData, auditState, loadAudit]);
  /* a tag that opens its asset */
  const tagBtn = (a: Asset) => (
    <button type="button" className={`${av.mono} ${av.linkBtn}`} onClick={() => showAsset(a)} aria-label={L(`Open ${a.asset_tag} — ${a.name}`, `Buka ${a.asset_tag} — ${a.name}`)}>{a.asset_tag}</button>
  );
  const parse = (s: string | null): Record<string, unknown> => { try { return s ? (JSON.parse(s) as Record<string, unknown>) : {}; } catch { return {}; } };
  const staffName = (id: unknown) => {
    const n = Number(id);
    if (!id || !Number.isFinite(n) || n === 0) return L("unassigned", "tidak diberikan");
    return staff.find((u) => u.id === n)?.name ?? assets.find((a) => a.assigned_to === n)?.assigned_name ?? `#${n}`;
  };
  const tagOf = (row: AuditRow) => {
    const d = parse(row.detail);
    const t = (d.tag ?? d.asset_tag) as string | undefined;
    return t ?? assets.find((a) => String(a.id) === row.entity_id)?.asset_tag ?? `#${row.entity_id ?? "?"}`;
  };
  const auditWhat = (row: AuditRow) => {
    const d = parse(row.detail);
    if (row.action === "asset.create") return L("Added to the register", "Ditambah ke daftar");
    if (row.action === "asset.remove") return L(`Removed as a mistaken entry${d.reason ? ` (${String(d.reason)})` : ""}`, `Dibuang sebagai entri tersilap${d.reason ? ` (${String(d.reason)})` : ""}`);
    /* v1.303.0 - a company move, with its reason */
    if (row.action === "asset.company_change") return L(`Company: ${companyLabel(d.from as string | null)} → ${companyLabel(d.to as string | null)} — ${String(d.reason ?? "")}`, `Syarikat: ${companyLabel(d.from as string | null)} → ${companyLabel(d.to as string | null)} — ${String(d.reason ?? "")}`);
    /* v1.303.0 - since 4.0 an edit keeps what changed, before and after */
    const ch = (d.changes && typeof d.changes === "object" ? d.changes : null) as Record<string, [unknown, unknown]> | null;
    if (ch) {
      const parts = Object.entries(ch).map(([k, [from, to]]) =>
        k === "status" ? `${statusLabel(String(from ?? ""))} → ${statusLabel(String(to ?? ""))}`
        : k === "assigned_to" ? L(`holder: ${staffName(from)} → ${staffName(to)}`, `pemegang: ${staffName(from)} → ${staffName(to)}`)
        : k === "issuer_code" ? L(`company set: ${companyLabel(to as string | null)}`, `syarikat ditetapkan: ${companyLabel(to as string | null)}`)
        : k === "shared_label" ? (to ? L(`shared use: ${String(to)}`, `kegunaan bersama: ${String(to)}`) : L("no longer shared", "tidak lagi dikongsi"))
        : k === "purchase_price_cents" ? L(`purchase cost: ${from == null ? "none" : rm(Number(from))} → ${to == null ? "none" : rm(Number(to))}`, `kos belian: ${from == null ? "tiada" : rm(Number(from))} → ${to == null ? "tiada" : rm(Number(to))}`)
        : `${k.replace(/_/g, " ")}: ${from ?? "—"} → ${to ?? "—"}`);
      return parts.length ? parts.join(" · ") : L("Saved with no change", "Disimpan tanpa perubahan");
    }
    const parts: string[] = [];
    if (typeof d.status === "string") parts.push(statusLabel(d.status));
    if ("assigned_to" in d) parts.push(L(`assigned: ${staffName(d.assigned_to)}`, `diberikan: ${staffName(d.assigned_to)}`));
    if (typeof d.location === "string" && d.location) parts.push(d.location);
    return parts.length ? parts.join(" · ") : L("Details edited", "Butiran disunting");
  };
  const auditVerb = (action: string) => action === "asset.create" ? L("Added", "Ditambah") : action === "asset.remove" ? L("Removed", "Dibuang") : action === "asset.company_change" ? L("Company moved", "Syarikat dipindah") : L("Updated", "Dikemas kini");

  /* v1.88.0 (CEO: "ensure that all the tabs have a function of clickable data
     without me need to open another new tabs") - a status figure narrows the
     register. v1.199.0: the figure is an Overview tile; pressing it opens the
     Asset Register filtered to that status. The KEY is the status code, not
     the translated label, or the filter would stop working in BM. */
  /* v1.303.0 - every count and cost from the one figure source (lib/asset-figures.ts) */
  const lines = statusLines(assets);
  const counts = STATUSES.map(([k, label, labelMs], i) => [k, L(label, labelMs), lines[i]!.count] as const);
  const all = lineOf("all", assets);
  const [statusF, setStatusF] = useState<string>("");
  const openStatus = (k: string) => { setStatusF(statusF === k && view === "register" ? "" : k); setPage(0); go("register"); };
  /* the recorded purchase cost of the active assets (lost and disposed out); an asset with no price is not RM 0 - it is counted apart */
  const totalValue = all.active_cost_cents;
  const unpricedActive = assets.filter((a) => a.purchase_price_cents == null && a.status !== "disposed" && a.status !== "lost").length;
  const sub = "text-muted-foreground mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide";
  const lbl = "text-muted-foreground mb-0.5 block text-[11px]";

  /* ---- the register's toolbar: search, filters, pages ---- */
  const [q, setQ] = useState("");
  const [catF, setCatF] = useState("");
  const [coF, setCoF] = useState(""); // v1.303.0 - the company filter
  const [locF, setLocF] = useState("");
  const [page, setPage] = useState(0);
  const [per, setPer] = useState<number>(10);
  const locations = useMemo(() => [...new Set(assets.map((a) => a.location || ""))].sort((a, b) => (a || "~").localeCompare(b || "~")), [assets]);
  /* v1.205.0 - a search hit opens the asset in the register: the search set
     to its tag (so its row is the one shown), the filters cleared */
  const focused = useRecordFocus(focus, loaded, (f) => {
    if (f.kind !== "asset") return;
    const a = assets.find((x) => x.id === f.id);
    setStatusF(""); setCatF(""); setLocF(""); setCoF(""); setPage(0);
    setQ(a ? a.asset_tag : "");
    setView("register");
    /* v1.210.0 - and the asset's drawer opens on it */
    if (a) openDetail(a);
  });
  useScrollToRecord(focused);
  const needle = q.trim().toLowerCase();
  const filtered = [...assets].filter((a) => !statusF || a.status === statusF)
    .filter((a) => !catF || a.category === catF)
    .filter((a) => !coF || companyKey(a) === coF)
    .filter((a) => !locF || (locF === "-" ? !a.location : a.location === locF))
    .filter((a) => !needle || [a.asset_tag, a.name, a.brand_model, a.serial_no, a.assigned_name, a.location, a.vendor, a.condition_note]
      .some((x) => (x ?? "").toLowerCase().includes(needle)) || (a.shared_label ?? "").toLowerCase().includes(needle))
    .sort((a, b) => {
      const dir = assetSort.asc ? 1 : -1;
      switch (assetSort.col) {
        case "tag": return dir * a.asset_tag.localeCompare(b.asset_tag);
        case "item": return dir * a.name.localeCompare(b.name);
        case "brand": return dir * (a.brand_model || "").localeCompare(b.brand_model || "");
        case "company": return dir * companyKey(a).localeCompare(companyKey(b));
        case "assigned": return dir * (a.assigned_name || "").localeCompare(b.assigned_name || "");
        case "location": return dir * (a.location || "").localeCompare(b.location || "");
        case "status": return dir * a.status.localeCompare(b.status);
        case "value": return dir * ((a.purchase_price_cents ?? -1) - (b.purchase_price_cents ?? -1));
        case "date": return dir * (a.purchase_date || "").localeCompare(b.purchase_date || "");
        default: return 0;
      }
    });
  const pages = Math.max(1, Math.ceil(filtered.length / per));
  const pageNow = Math.min(page, pages - 1);
  const shown = filtered.slice(pageNow * per, pageNow * per + per);
  const filtering = !!(statusF || catF || locF || coF || needle);
  const clearFilters = () => { setStatusF(""); setCatF(""); setLocF(""); setCoF(""); setQ(""); setPage(0); };

  /* ---- what the other tabs group ---- */
  const total = assets.length;
  const pct = (n: number) => share(n, total);
  const stamp = (a: Asset) => a.updated_at || a.created_at || "";
  /* v1.210.0 - an active asset whose holder is not on the current staff list
     (left, deactivated, or an account the list does not carry). Only once
     the list has loaded, so a slow list never flags everybody. */
  const offList = (a: Asset) => people.data != null && a.assigned_to != null && a.status !== "lost" && a.status !== "disposed"
    && !(people.data.staff ?? []).some((u) => u.id === a.assigned_to);
  const attention = assets.filter((a) => a.status === "repair" || a.status === "lost" || a.status === "disposed" || offList(a));
  const active = (a: Asset) => a.status !== "disposed" && a.status !== "lost";
  const valueOf = (list: Asset[]) => lineOf("", list).active_cost_cents;
  const holders = useMemo(() => {
    const m = new Map<number, { id: number; name: string; list: Asset[] }>();
    for (const a of assets) {
      if (a.assigned_to == null) continue;
      const cur = m.get(a.assigned_to) ?? { id: a.assigned_to, name: a.assigned_name ?? `#${a.assigned_to}`, list: [] };
      cur.list.push(a); m.set(a.assigned_to, cur);
    }
    return [...m.values()].sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  }, [assets]);
  /* v1.303.0 - a shared-use asset is In Use without a person: it is not "unassigned" */
  const unassigned = assets.filter((a) => a.assigned_to == null && !a.shared_label && active(a));
  const sharedUse = assets.filter((a) => a.assigned_to == null && !!a.shared_label);
  const [today] = useState(() => mytToday());
  const in90 = useMemo(() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 90); return d.toISOString().slice(0, 10); }, [today]);
  const warrantyExpired = assets.filter((a) => active(a) && a.warranty_until && a.warranty_until < today);
  const warrantySoon = assets.filter((a) => active(a) && a.warranty_until && a.warranty_until >= today && a.warranty_until <= in90);

  const head = (icon: AppIconName, tone: string | undefined, title: string, subText?: ReactNode, action?: ReactNode) => (
    <div className={av.head}>
      <div className={av.lead}>
        <span className={`${av.well} ${tone ?? ""}`}><AppIcon name={icon} /></span>
        <div className={av.headText}>
          <p className={av.title}>{title}</p>
          {subText && <p className={av.sub}>{subText}</p>}
        </div>
      </div>
      {action}
    </div>
  );
  const chip = (code: string) => <span className={STATUS_CHIP[code] ?? chipNeutral}>{statusLabel(code)}</span>;
  const empty = (text: string) => <p className={av.empty}><AppIcon name="package" />{text}</p>;
  const rowTools = (a: Asset) => (
    <span className={rowActions}>
      {canEdit && <button type="button" className={rowBtn} onClick={() => startEdit(a)}>{L("Edit", "Sunting")}</button>}
      {canEdit && (!careLive || !CARE.includes(a.status)) && <button type="button" className={rowBtn} onClick={() => openStatusChange(a)}>{L("Status", "Status")}</button>}
      {audit.state !== "denied" && (
        <button type="button" className={`${rowBtn} ${av.iconBtn}`} onClick={() => showAsset(a)}
          aria-label={`${L("History", "Sejarah")} — ${a.asset_tag}`} title={L("History", "Sejarah")}>
          <AppIcon name="time" />
        </button>
      )}
    </span>
  );
  /* a compact read-only table of assets, for the grouped tabs */
  const miniTable = (list: Asset[], cols: ("assigned" | "location" | "note" | "status" | "date")[], label: string) => (
    <div className={`erp-table-scroll erp-mt-2 ${av.tableWrap}`}>
      <table className={av.plain} aria-label={label}>
        <thead><tr>
          <th>{L("Tag", "Tag")}</th><th>{L("Item", "Barang")}</th>
          {cols.includes("assigned") && <th>{L("Assigned to", "Diberikan kepada")}</th>}
          {cols.includes("location") && <th>{L("Location", "Lokasi")}</th>}
          {cols.includes("note") && <th>{L("Issue / note", "Isu / nota")}</th>}
          {cols.includes("status") && <th>{L("Status", "Status")}</th>}
          {cols.includes("date") && <th>{L("Updated", "Dikemas kini")}</th>}
          <th className={av.num}>{L("Value (RM)", "Nilai (RM)")}</th>
          <th>{L("Actions", "Tindakan")}</th>
        </tr></thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <td>{tagBtn(a)}</td>
              <td><span className={av.strong}>{a.name}</span>{a.brand_model && <span className={av.muted}> · {a.brand_model}</span>}</td>
              {cols.includes("assigned") && <td>{a.assigned_name ?? <span className={av.muted}>—</span>}</td>}
              {cols.includes("location") && <td>{a.location ?? <span className={av.muted}>—</span>}</td>}
              {cols.includes("note") && <td>{a.condition_note ?? <span className={av.muted}>—</span>}</td>}
              {cols.includes("status") && <td>{chip(a.status)}</td>}
              {cols.includes("date") && <td>{stamp(a) ? dmyMYT(stamp(a)) : <span className={av.muted}>—</span>}</td>}
              <td className={av.num}>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : "—"}</td>
              <td>{rowTools(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  /* ---- v1.303.0 - Reports & Audit: one selector, one figure source ---- */
  const REPORTS: readonly (readonly [Report, string, AppIconName])[] = [
    ["status", L("Asset Status Summary", "Ringkasan Status Aset"), "chart"],
    ["category", L("Assets by Category", "Aset mengikut Kategori"), "package"],
    ["location", L("Assets by Location", "Aset mengikut Lokasi"), "place"],
    ["company", L("Assets by Company", "Aset mengikut Syarikat"), "store"],
    ["assignment", L("Assignment Summary", "Ringkasan Penugasan"), "users"],
    ["missing", L("Missing Information", "Maklumat Tiada"), "warning"],
    ["warranty", L("Warranty", "Waranti"), "verify"],
    /* v1.305.0 - from the maintenance and disposal records (0195) */
    ...(careLive ? [["maintenance", L("Maintenance History", "Sejarah Penyelenggaraan"), "fix"], ["losses", L("Lost & Disposal", "Hilang & Pelupusan"), "blocked"]] as const : []),
    ["audit", L("Audit Trail", "Jejak Audit"), "time"],
  ];
  const [coR, setCoR] = useState("");
  /* v1.305.0 - the two history reports read the records once, when one of them is opened */
  const [careHist, setCareHist] = useState<{ state: "idle" | "ok" | "error"; events: CareEvent[] }>({ state: "idle", events: [] });
  const wantHist = careLive && view === "reports" && (report === "maintenance" || report === "losses");
  useEffect(() => {
    if (!wantHist) return;
    let live = true;
    void api<{ history?: CareEvent[] }>("/staff/assets/care").then((r) => { if (live) setCareHist(r.ok && r.data?.history ? { state: "ok", events: r.data.history } : { state: "error", events: [] }); });
    return () => { live = false; };
  }, [wantHist, careTick]);
  type Cell = string | number | { c: number } | null;
  const cellText = (c: Cell) => (c == null ? "—" : typeof c === "object" ? rm(c.c) : String(c));
  const repAssets = coR ? assets.filter((a) => companyKey(a) === coR) : assets;
  /* each company's money in its own column: never one total across A2Z and AZ ONE */
  const coKeys = coR ? [coR] : ["a2z", "azoo", COMPANY_NOT_SET].filter((k) => repAssets.some((a) => companyKey(a) === k));
  const coShort = (k: string) => (k === "a2z" ? "A2Z" : k === "azoo" ? "AZ ONE" : L("not set", "belum"));
  /* short heads so the company columns fit beside the selector; the report's line says what the money is */
  const costHead = (word: string) => (coKeys.length > 1 ? coKeys.map((k) => `${coShort(k)} (RM)`) : [`${word} (RM)`]);
  const costCells = (list: Asset[], activeOnly: boolean): Cell[] => (coKeys.length ? coKeys : [""]).map((k) => {
    const l = lineOf(k, k ? list.filter((a) => companyKey(a) === k) : list);
    return { c: activeOnly ? l.active_cost_cents : l.cost_cents };
  });
  const MISSING_WORD: Record<MissingField, string> = {
    price: L("no purchase price", "tiada harga belian"), serial: L("no serial no.", "tiada no. siri"), company: L("company not set", "syarikat belum ditetapkan"),
    purchase_date: L("no purchase date", "tiada tarikh belian"), warranty_ended: L("warranty ended", "waranti tamat"),
  };
  const rep = ((): { title: string; sub: string; head: string[]; numFrom: number; rows: Cell[][]; foot?: Cell[]; note?: string; empty: string; ready: boolean; denied?: boolean } => {
    const title = REPORTS.find(([k]) => k === report)?.[1] ?? "";
    const coWord = coR ? companyLabel(coR === COMPANY_NOT_SET ? null : coR) : L("both companies", "kedua-dua syarikat");
    const priceNote = L("Recorded purchase cost as typed in the register — not a book value. An asset without a price is not counted as RM 0; its count is shown.", "Kos belian seperti ditaip dalam daftar — bukan nilai buku. Aset tanpa harga tidak dikira RM 0; bilangannya ditunjukkan.");
    const grouped = (lines: Line[], label: (k: string) => string, first: string): { head: string[]; rows: Cell[][]; foot: Cell[] } => ({
      head: [first, L("Assets", "Aset"), L("Active", "Aktif"), ...costHead(L("Active cost", "Kos aktif")), L("Without a price", "Tanpa harga")],
      rows: lines.map((g) => { const list = repAssets.filter((a) => keyFor(a) === g.key); return [label(g.key), g.count, g.active, ...costCells(list, true), g.unpriced]; }),
      foot: [L("Total", "Jumlah"), repAssets.length, repAssets.filter(active).length, ...costCells(repAssets, true), repAssets.filter((a) => a.purchase_price_cents == null).length],
    });
    let keyFor: (a: Asset) => string = () => "";
    if (report === "status") {
      return { title, sub: L(`Every status, ${coWord}${coKeys.length > 1 ? " - the money columns are each company's recorded purchase cost" : ""}.`, `Setiap status, ${coWord}${coKeys.length > 1 ? " - lajur wang ialah kos belian direkodkan setiap syarikat" : ""}.`), numFrom: 1, ready: loaded, empty: L("No assets yet.", "Belum ada aset."), note: priceNote,
        head: [L("Status", "Status"), L("Assets", "Aset"), L("Share", "Bahagian"), ...costHead(L("Recorded cost", "Kos direkodkan")), L("Without a price", "Tanpa harga")],
        rows: statusLines(repAssets).map((l) => { const list = repAssets.filter((a) => a.status === l.key); return [statusLabel(l.key), l.count, `${share(l.count, repAssets.length)}%`, ...costCells(list, false), l.unpriced]; }),
        foot: [L("Active (lost and disposed out)", "Aktif (tanpa hilang dan dilupuskan)"), repAssets.filter(active).length, `${share(repAssets.filter(active).length, repAssets.length)}%`, ...costCells(repAssets, true), repAssets.filter((a) => active(a) && a.purchase_price_cents == null).length] };
    }
    if (report === "category" || report === "location" || report === "company") {
      keyFor = report === "category" ? (a) => a.category : report === "location" ? (a) => a.location || "-" : (a) => companyKey(a);
      const lines = report === "company" ? companyLines(repAssets).filter((l) => !coR || l.key === coR) : groupLines(repAssets, keyFor);
      const g = grouped(lines, report === "category" ? catLabel : report === "location" ? (k) => (k === "-" ? noLocation() : k) : (k) => companyLabel(k === COMPANY_NOT_SET ? null : k), report === "category" ? L("Category", "Kategori") : report === "location" ? L("Location", "Lokasi") : L("Company", "Syarikat"));
      return { title, sub: report === "company" ? L("Each company on its own line — never added together.", "Setiap syarikat dalam barisnya sendiri — tidak dijumlahkan bersama.") : L(`Active cost (lost and disposed out), ${coWord}${coKeys.length > 1 ? " - each company in its own column" : ""}.`, `Kos aktif (tanpa hilang dan dilupuskan), ${coWord}${coKeys.length > 1 ? " - setiap syarikat dalam lajurnya sendiri" : ""}.`),
        numFrom: 1, ready: loaded, empty: L("No assets yet.", "Belum ada aset."), note: priceNote, ...g };
    }
    if (report === "assignment") {
      const lines = groupLines(repAssets.filter(active), (a) => (a.assigned_to != null ? `p:${a.assigned_to}` : a.shared_label ? `s:${a.shared_label}` : "none"));
      const who = (k: string) => k === "none" ? L("Nobody named (spare or store)", "Tiada nama (simpanan atau stor)") : k.startsWith("s:") ? L(`Shared · ${k.slice(2)}`, `Dikongsi · ${k.slice(2)}`) : repAssets.find((a) => `p:${a.assigned_to}` === k)?.assigned_name ?? k.slice(2);
      return { title, sub: L(`Active assets by who keeps them, ${coWord}${coKeys.length > 1 ? " - active cost, each company in its own column" : ""}.`, `Aset aktif mengikut penjaga, ${coWord}${coKeys.length > 1 ? " - kos aktif, setiap syarikat dalam lajurnya sendiri" : ""}.`), numFrom: 1, ready: loaded, empty: L("No active asset.", "Tiada aset aktif."), note: priceNote,
        head: [L("Held by", "Dipegang oleh"), L("Assets", "Aset"), ...costHead(L("Active cost", "Kos aktif")), L("Without a price", "Tanpa harga")],
        rows: lines.map((g) => [who(g.key), g.count, ...costCells(repAssets.filter((a) => active(a) && (a.assigned_to != null ? `p:${a.assigned_to}` : a.shared_label ? `s:${a.shared_label}` : "none") === g.key), true), g.unpriced]) };
    }
    if (report === "missing") {
      const rows = repAssets.map((a) => [a, missingOf(a, today)] as const).filter(([, m]) => m.length > 0);
      return { title, sub: L(`Register rows with something missing, ${coWord} — fill them in from the asset's Edit.`, `Baris daftar dengan maklumat tiada, ${coWord} — lengkapkan melalui Sunting aset.`), numFrom: 99, ready: loaded,
        empty: L("Nothing missing.", "Tiada yang tiada."), head: [L("Tag", "Tag"), L("Item", "Barang"), L("Status", "Status"), L("Missing", "Tiada")],
        rows: rows.map(([a, m]) => [a.asset_tag, a.name, statusLabel(a.status), m.map((x) => MISSING_WORD[x]).join(", ")]),
        note: (["price", "company", "serial", "purchase_date", "warranty_ended"] as MissingField[]).map((f) => `${MISSING_WORD[f]}: ${rows.filter(([, m]) => m.includes(f)).length}`).join(" · ") };
    }
    if (report === "warranty") {
      const list = [...warrantySoon, ...warrantyExpired].filter((a) => !coR || companyKey(a) === coR);
      return { title, sub: L("Active assets whose warranty date is past or within 90 days.", "Aset aktif yang tarikh warantinya telah lepas atau dalam 90 hari."), numFrom: 99, ready: loaded,
        empty: L("No warranty ending in the next 90 days.", "Tiada waranti tamat dalam 90 hari akan datang."), head: [L("Tag", "Tag"), L("Item", "Barang"), L("Warranty until", "Waranti sehingga"), L("State", "Keadaan")],
        rows: list.map((a) => [a.asset_tag, a.name, dmy(a.warranty_until), a.warranty_until! < today ? L("ended", "tamat") : L("ends within 90 days", "tamat dalam 90 hari")]) };
    }
    if (report === "maintenance" || report === "losses") {
      const inCo = new Set(repAssets.map((a) => a.id));
      const list = careHist.events.filter((e) => inCo.has(e.asset_id) && (report === "maintenance" ? e.area === "issue" || e.area === "repair" : e.area === "incident" || e.area === "disposal"));
      return { title, sub: report === "maintenance" ? L(`Every issue and repair recorded, newest first, ${coWord}. A repair cost is a note, not an expense.`, `Setiap isu dan pembaikan direkod, terbaru dahulu, ${coWord}. Kos pembaikan ialah nota, bukan perbelanjaan.`) : L(`Every loss, find and disposal decision recorded, newest first, ${coWord}. Proceeds are a note; nothing is written off.`, `Setiap kehilangan, penemuan dan keputusan pelupusan direkod, terbaru dahulu, ${coWord}. Hasil ialah nota; tiada yang dihapus kira.`),
        numFrom: 99, ready: careHist.state !== "idle", denied: careHist.state === "error", empty: L("No record yet.", "Belum ada rekod."),
        head: [L("When", "Bila"), L("Asset", "Aset"), L("Item", "Barang"), L("Record", "Rekod"), L("Detail", "Butiran"), L("Who", "Siapa")],
        rows: list.map((e) => [dmyMYT(e.created_at), e.asset_tag, e.name, eventLabel(e), eventText(e) || "—", e.actor ?? "—"]) };
    }
    return { title, sub: L("Every add, edit, company move and removal on the register, as the system recorded it (asset events only).", "Setiap penambahan, suntingan, pindahan syarikat dan pembuangan pada daftar, seperti yang direkodkan sistem (peristiwa aset sahaja)."), numFrom: 99,
      ready: audit.state === "ok" || audit.state === "denied" || audit.state === "error", denied: audit.state !== "ok", empty: L("No asset changes recorded yet.", "Belum ada perubahan aset direkodkan."),
      head: [L("When", "Bila"), L("Who", "Siapa"), L("Action", "Tindakan"), L("Asset", "Aset"), L("What", "Apa")],
      rows: audit.entries.map((r) => [dmyMYT(r.created_at), r.user_name ?? "—", auditVerb(r.action), tagOf(r), auditWhat(r)]) };
  })();
  const fileBase = `assets-${report}${coR ? `-${coR}` : ""}-${today}`;
  const exportCsv = () => downloadCsv(`${fileBase}.csv`, [rep.head, ...rep.rows.map((r) => r.map((c) => (c == null ? "" : typeof c === "object" ? (c.c / 100).toFixed(2) : c))), ...(rep.foot ? [rep.foot.map((c) => (c == null ? "" : typeof c === "object" ? (c.c / 100).toFixed(2) : c))] : [])]);
  const exportPdf = () => downloadPdf(buildAssetReportPdf({ title: rep.title, sub: rep.sub, head: rep.head, numFrom: rep.numFrom, rows: rep.rows.map((r) => r.map(cellText)), foot: rep.foot?.map(cellText), note: rep.note, made: dmyMYT(new Date().toISOString()) }), `${fileBase}.pdf`);

  /* v1.303.0 - the register as cards: the Grid view, and the list on a phone (no sideways table below 768 px) */
  const gridCards = (withRecord: boolean) => (
          shown.length === 0 ? <p className={av.empty}>{L("No asset matches — clear the search or a filter.", "Tiada aset sepadan — kosongkan carian atau penapis.")}</p> : (
            <ul className={av.grid} aria-label={L("Assets", "Aset")}>
              {shown.map((a) => (
                <li key={a.id} data-record={withRecord ? `asset:${a.id}` : undefined}>
                  <button type="button" className={av.gridCard} onClick={() => showAsset(a)}>
                    <span className={av.gridTop}><span className={av.mono}>{a.asset_tag}</span>{chip(a.status)}</span>
                    <strong>{a.name}</strong>
                    <span className={av.muted}>{catLabel(a.category)}{a.brand_model ? ` · ${a.brand_model}` : ""} · {companyLabel(a.issuer_code)}</span>
                    <span className={av.gridFoot}>
                      <span>{a.assigned_name ?? (a.shared_label ? L(`Shared · ${a.shared_label}`, `Dikongsi · ${a.shared_label}`) : L("Unassigned", "Tidak diberikan"))}{a.location ? ` · ${a.location}` : ""}</span>
                      <strong>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : L("No price", "Tiada harga")}</strong>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
  );
  /* v1.304.0 - D-4: a member of staff who may not open the register sees the assets they hold (and, a manager, their team's) */
  if (unavailable) return (
    <TabPage>
      {toastNode}
      <MyAssets toast={showToast} />
    </TabPage>
  );
  return (
    <TabPage>
      {/* v1.199.0 - outside every zone: a hidden tab must not hide a toast or a question */}
      {toastNode}
      {confirmNode}
      {/* v1.303.0 - the tab row on a wide screen; on a phone the Dashboard's view
          switch with + Add beside it (as Financial Advisory, Ecommerce, the Desk
          and Sales) - never a row cut off at the edge */}
      <div className="erp-desktop-only">
      <LineTabs value={view} onChange={(k) => go(k)} label={L("Assets", "Aset")} tabs={[
        ["overview", L("Overview", "Gambaran")],
        ["register", L("Asset Register", "Daftar Aset")],
        ["assign", L("Assignments", "Penugasan")],
        ["care", L("Maintenance & Disposal", "Penyelenggaraan & Pelupusan")],
        ["reports", L("Reports & Audit", "Laporan & Audit")],
      ] as const} aside={canEdit ? (
        <TabAside>
          <TabAction icon="add" onClick={startAdd}>{L("Add asset", "Tambah aset")}</TabAction>
        </TabAside>
      ) : undefined} />
      </div>
      <div className={`erp-phone-only ${av.viewBar}`} data-testid="asset-view-bar">
        <ViewSwitch value={view} onChange={(k) => go(k)} label={L("Assets view", "Paparan aset")} options={[
          ["overview", L("Overview", "Gambaran"), L("Status, cost and recent activity", "Status, kos dan aktiviti terkini")],
          ["register", L("Asset Register", "Daftar Aset"), L("Every asset, search and filters", "Setiap aset, carian dan penapis")],
          ["assign", L("Assignments", "Penugasan"), L("Who holds what, shared use", "Siapa memegang apa, kegunaan bersama")],
          ["care", L("Maintenance & Disposal", "Penyelenggaraan & Pelupusan"), L("In repair, lost, disposed", "Pembaikan, hilang, dilupuskan")],
          ["reports", L("Reports & Audit", "Laporan & Audit"), L("Reports, export and history", "Laporan, eksport dan sejarah")],
        ] as const} />
        {canEdit && <button type="button" className={av.phoneAdd} onClick={startAdd} data-testid="asset-add-phone"><AppIcon name="add" />{L("Add", "Tambah")}</button>}
      </div>

      {/* ============================== OVERVIEW ============================== */}
      <TabZone label={L("Overview", "Gambaran")} className={view !== "overview" ? av.off : ""}>
        <div className={`${av.kpis} ${av.kpis6}`}>
          <KpiRow label={L("Assets by status", "Aset mengikut status")}>
            <KpiTile icon="package" tone="navy" label={L("Total Assets", "Jumlah Aset")} value={total} busy={!loaded}
              sub={L("in the register", "dalam daftar")} onClick={() => { clearFilters(); go("register"); }}
              title={L("Open the whole register", "Buka seluruh daftar")} />
            {counts.map(([k, label, n]) => (
              <KpiTile key={k} icon={STATUS_TILE[k]?.icon ?? "package"} tone={STATUS_TILE[k]?.tone ?? "navy"} label={label} value={n} busy={!loaded}
                sub={L(`${pct(n)}% of total`, `${pct(n)}% daripada jumlah`)}
                onClick={() => openStatus(k)}
                title={L(`Show only ${label.toLowerCase()} assets`, `Tunjuk aset ${label.toLowerCase()} sahaja`)} />
            ))}
          </KpiRow>
        </div>

        <div className={av.split}>
          <section className={card} aria-label={L("Asset status", "Status aset")} data-testid="asset-status-card">
            {head("chart", av.goldWell, L("Asset by Status", "Aset mengikut Status"), L("Current status of all company assets.", "Status semasa semua aset syarikat."))}
            {!loaded ? <SkelRows rows={5} /> : (
              <div className={av.donutRow}>
                <Donut size={150} hideLegend centerLabel={String(total)} centerSub={L("assets", "aset")}
                  slices={counts.map(([k, label, n]) => ({ label, value: n, color: STATUS_COLOR[k] ?? "var(--muted-foreground)" }))} />
                <ul className={av.legend}>
                  {counts.map(([k, label, n]) => (
                    <li key={k}>
                      <button type="button" onClick={() => openStatus(k)}>
                        <span className={av.dot} style={{ background: STATUS_COLOR[k] }} aria-hidden />
                        <span>{label}</span>
                        <strong>{n}</strong>
                        <span className={av.muted}>{pct(n)}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* v1.303.0 - the RECORDED PURCHASE COST, never called a value: no book value is kept */}
            <div className={av.costBox} data-testid="asset-cost">
              <span className={av.sub}>{L("Recorded purchase cost", "Kos belian direkodkan")}</span>
              <strong>{loaded ? rm(totalValue) : <Skel className="h-5 w-28" />}</strong>
              <span className={av.sub}>
                {L("Active assets (lost and disposed excluded). Not a book value — A2Z OS keeps no depreciation.", "Aset aktif (tidak termasuk hilang dan dilupuskan). Bukan nilai buku — A2Z OS tidak menyimpan susut nilai.")}
                {loaded && unpricedActive > 0 && <> <button type="button" className={av.linkBtn} onClick={() => { setReport("missing"); go("reports"); }} data-testid="asset-unpriced">{L(`${unpricedActive} without a price — not counted`, `${unpricedActive} tanpa harga — tidak dikira`)}</button></>}
              </span>
            </div>
          </section>
          <section className={card} aria-label={L("Recent activities", "Aktiviti terkini")} data-testid="asset-activity">
            {head("time", av.goldWell, L("Recent Activities", "Aktiviti Terkini"), L("The latest changes to the register, as the system recorded them.", "Perubahan terkini pada daftar, seperti yang direkodkan sistem."),
              <button type="button" className={btnSm} onClick={() => { setReport("audit"); go("reports"); }}>{L("View all", "Lihat semua")}</button>)}
            {audit.state === "idle" || audit.state === "loading" ? <SkelRows rows={5} />
              : audit.state !== "ok" ? <p className={av.empty}><AppIcon name="warning" />{L("The asset history could not be read just now.", "Sejarah aset tidak dapat dibaca sekarang.")}</p>
              : audit.entries.length === 0 ? empty(L("No change recorded yet.", "Belum ada perubahan direkodkan."))
              : (
                <ol className={av.activity}>
                  {audit.entries.slice(0, 6).map((r) => {
                    const a = assets.find((x) => String(x.id) === r.entity_id);
                    return (
                      <li key={r.id}>
                        <span className={`${av.well} ${av.goldWell}`}><AppIcon name={r.action === "asset.create" ? "add" : r.action === "asset.remove" ? "blocked" : "package"} /></span>
                        <span className={av.actText}>
                          <span><strong>{auditVerb(r.action)}</strong> {a ? <button type="button" className={`${av.mono} ${av.linkBtn}`} onClick={() => showAsset(a)}>{a.asset_tag}</button> : <span className={av.mono}>{tagOf(r)}</span>}</span>
                          <span className={av.muted}>{auditWhat(r)}</span>
                        </span>
                        <span className={av.actWhen}>{dmyMYT(r.created_at)}<br />{r.user_name ?? ""}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
          </section>
        </div>

        <div className={av.split2}>
          <section className={card} aria-label={L("Assets needing attention", "Aset perlu perhatian")}>
            {head("warning", av.redWell, L("Assets Needing Attention", "Aset Perlu Perhatian"), L("In repair, lost or disposed — or held by someone not on the current staff list.", "Dalam pembaikan, hilang atau dilupuskan — atau dipegang oleh seseorang yang tiada dalam senarai kakitangan semasa."),
              <button type="button" className={btnSm} onClick={() => go("care")}>{L("View all", "Lihat semua")}</button>)}
            {!loaded ? <SkelRows rows={3} /> : attention.length === 0
              ? empty(L("No assets needing attention — nothing is in repair, lost or disposed, and every holder is on the staff list.", "Tiada aset perlu perhatian — tiada dalam pembaikan, hilang atau dilupuskan, dan setiap pemegang ada dalam senarai kakitangan."))
              : (
                <div className={`erp-table-scroll erp-mt-2 ${av.tableWrap}`}>
                  <table className={av.plain} aria-label={L("Assets needing attention", "Aset perlu perhatian")}>
                    <thead><tr><th>{L("Tag", "Tag")}</th><th>{L("Item", "Barang")}</th><th>{L("Issue", "Isu")}</th><th>{L("Status", "Status")}</th><th>{L("Date", "Tarikh")}</th></tr></thead>
                    <tbody>
                      {attention.slice(0, 5).map((a) => (
                        <tr key={a.id}>
                          <td>{tagBtn(a)}</td>
                          <td className={av.strong}>{a.name}</td>
                          <td>{offList(a) ? <span className={av.warnText}>{L(`Held by ${a.assigned_name ?? `#${a.assigned_to}`} — not on the current staff list`, `Dipegang oleh ${a.assigned_name ?? `#${a.assigned_to}`} — tiada dalam senarai kakitangan semasa`)}</span> : a.condition_note ?? <span className={av.muted}>—</span>}</td>
                          <td>{chip(a.status)}</td>
                          <td>{stamp(a) ? dmyMYT(stamp(a)) : <span className={av.muted}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </section>
          <section className={card} aria-label={L("Quick actions", "Tindakan pantas")}>
            {head("fast", av.goldWell, L("Quick Actions", "Tindakan Pantas"))}
            <div className={av.quick}>
              {canEdit && <button type="button" className={av.qa} onClick={startAdd}><span className={`${av.qaIcon} ${av.goldWell}`}><AppIcon name="add" /></span><strong>{L("Register Asset", "Daftar Aset")}</strong><span>{L("Add a company asset to the register", "Tambah aset syarikat ke daftar")}</span></button>}
              <button type="button" className={av.qa} onClick={() => go("assign")}><span className={`${av.qaIcon} ${av.goldWell}`}><AppIcon name="users" /></span><strong>{L("Assign Asset", "Tugaskan Aset")}</strong><span>{L("Who holds what, and what is free", "Siapa memegang apa, dan apa yang kosong")}</span></button>
              <button type="button" className={av.qa} onClick={() => go("care")}><span className={`${av.qaIcon} ${av.redWell}`}><AppIcon name="fix" /></span><strong>{careLive ? L("Report Maintenance", "Lapor Penyelenggaraan") : L("Update Status", "Kemas Kini Status")}</strong><span>{careLive ? L("Issues, repairs, lost and disposals", "Isu, pembaikan, hilang dan pelupusan") : L("Mark as repair, lost or disposed", "Tanda pembaikan, hilang atau dilupuskan")}</span></button>
              <button type="button" className={av.qa} onClick={() => go("reports")}><span className={`${av.qaIcon} ${av.blueWell}`}><AppIcon name="document" /></span><strong>{L("View Reports", "Lihat Laporan")}</strong><span>{L("Recorded cost, missing information and the history", "Kos direkodkan, maklumat tiada dan sejarah")}</span></button>
            </div>
          </section>
        </div>
      </TabZone>

      {/* ============================ ASSET REGISTER ============================ */}
      <TabZone label={L("The register", "Daftar")} className={view !== "register" ? av.off : ""}>
      <div className={card}>
        <p className={av.title}>{L("Company assets", "Aset syarikat")}</p>
        <p className={av.sub}>
          {L("Every piece of equipment the company owns — who holds it, where it lives, what it cost. A real asset is never deleted: mark it lost or disposed so the history stays. An entry typed by mistake can be removed — it leaves the register, the audit log keeps it.", "Setiap peralatan milik syarikat — siapa yang memegangnya, di mana ia berada, berapa kosnya. Aset sebenar tidak pernah dipadam: tandakan sebagai hilang atau dilupuskan supaya sejarahnya kekal. Entri yang tersilap taip boleh dibuang — ia keluar dari daftar, log audit menyimpannya.")}
        </p>
      </div>

      <div className={card}>
        <div className={av.head}>
          <p className={av.title}>{L("Register", "Daftar")}</p>
          <span className={av.headTools}>
            {/* v1.210.0 - the same rows as a table or as cards */}
            <span role="group" aria-label={L("View", "Paparan")} className={av.mode}>
              <button type="button" aria-pressed={regMode === "list"} onClick={() => setRegMode("list")}><AppIcon name="orders" />{L("List", "Senarai")}</button>
              <button type="button" aria-pressed={regMode === "grid"} onClick={() => setRegMode("grid")}><AppIcon name="package" />{L("Grid", "Grid")}</button>
            </span>
            {canEdit && <button type="button" className={btnSm} onClick={startAdd}><AppIcon name="add" />{L("Add asset", "Tambah aset")}</button>}
          </span>
        </div>
        <div className={av.toolbar} role="search">
          <label className={av.search}>
            <AppIcon name="search" />
            <input type="search" value={q} placeholder={L("Search tag, item, brand, serial, staff, location…", "Cari tag, barang, jenama, siri, kakitangan, lokasi…")}
              aria-label={L("Search the register", "Cari dalam daftar")} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
          </label>
          <select className={inputClassSm} aria-label={L("Status", "Status")} value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(0); }}>
            <option value="">{L("All statuses", "Semua status")}</option>
            {STATUSES.map(([v, l, ms]) => <option key={v} value={v}>{L(l, ms)}</option>)}
          </select>
          <select className={inputClassSm} aria-label={L("Category", "Kategori")} value={catF} onChange={(e) => { setCatF(e.target.value); setPage(0); }}>
            <option value="">{L("All categories", "Semua kategori")}</option>
            {CATS.map(([v, l, ms]) => <option key={v} value={v}>{L(l, ms)}</option>)}
          </select>
          <select className={inputClassSm} aria-label={L("Company", "Syarikat")} value={coF} onChange={(e) => { setCoF(e.target.value); setPage(0); }} data-testid="asset-company-filter">
            <option value="">{L("All companies", "Semua syarikat")}</option>
            {Object.entries(COMPANY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <option value={COMPANY_NOT_SET}>{L("Company not set", "Syarikat belum ditetapkan")}</option>
          </select>
          <select className={inputClassSm} aria-label={L("Location", "Lokasi")} value={locF} onChange={(e) => { setLocF(e.target.value); setPage(0); }}>
            <option value="">{L("All locations", "Semua lokasi")}</option>
            {locations.map((l) => <option key={l || "-"} value={l || "-"}>{l || noLocation()}</option>)}
          </select>
          {filtering && <button type="button" className={btnSm} onClick={clearFilters}>{L("Clear", "Kosongkan")}</button>}
        </div>
        {/* v1.77.0 — skeleton until the first fetch lands: the real header
            row over shimmering cells, same columns as the register. */}
        {!loaded ? (
          <div className="tbl-sticky erp-table-scroll erp-mt-2" aria-hidden>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-border text-left">
                  <th className={th}>{L("TAG", "TAG")}</th>
                  <th className={th}>{L("ITEM", "BARANG")}</th>
                  <th className={th}>{L("ASSIGNED", "DIBERIKAN")}</th>
                  <th className={th}>{L("LOCATION", "LOKASI")}</th>
                  <th className={th}>{L("STATUS", "STATUS")}</th>
                  <th className={thR2}>{L("VALUE", "NILAI")}</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="border-border border-t">
                    <td className={td}><Skel className="h-3.5 w-16" /></td>
                    <td className={td}><Skel className="h-3.5 w-36" /></td>
                    <td className={td}><Skel className="h-3.5 w-20" /></td>
                    <td className={td}><Skel className="h-3.5 w-20" /></td>
                    <td className={td}><Skel className="h-4 w-14 rounded-full" /></td>
                    <td className={tdR2}><Skel className="ml-auto h-3.5 w-16" /></td>
                    <td className={td}><Skel className="h-6 w-10" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : assets.length === 0 ? (
          <p className={av.empty}>{canEdit ? L("No assets yet — add the first one with Add asset.", "Belum ada aset — tambah yang pertama dengan Tambah aset.") : L("No assets yet.", "Belum ada aset.")}</p>
        ) : regMode === "grid" ? gridCards(true) : (
          <>
          <div className={av.narrowOnly}>{gridCards(false)}</div>
          {/* v1.176.1 - sideways only; the page owns the vertical gesture. */}
          <div className={`tbl-sticky erp-table-scroll erp-mt-2 ${av.tableWrap} ${av.wideOnly}`}>
            <table className={av.register}>
              <thead>
                <tr>
                  {([
                    ["tag", L("Tag", "Tag"), ""],
                    ["item", L("Item", "Barang"), ""],
                    ["brand", L("Brand", "Jenama"), ""],
                    ["company", L("Company", "Syarikat"), ""],
                    ["assigned", L("Assigned to", "Diberikan kepada"), ""],
                    ["location", L("Location", "Lokasi"), ""],
                    ["status", L("Status", "Status"), ""],
                    ["date", L("Purchased", "Dibeli"), ""],
                    ["value", L("Purchase cost (RM)", "Kos belian (RM)"), av.num],
                  ] as [AssetCol, string, string | undefined][]).map(([col, label, cls]) => (
                    <th key={col} className={cls ?? ""}
                      aria-sort={assetSort.col === col ? (assetSort.asc ? "ascending" : "descending") : undefined}>
                      <button type="button" className={av.sortBtn}
                        title={L(`Sort by ${label} — click again to reverse`, `Isih mengikut ${label} — klik lagi untuk terbalikkan`)}
                        onClick={() => cycleAsset(col)}>
                        {label}{assetSort.col === col ? (assetSort.asc ? " ▲" : " ▼") : ""}
                      </button>
                    </th>
                  ))}
                  <th>{L("Actions", "Tindakan")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr><td colSpan={10} className={av.emptyCell}>{L("No asset matches — clear the search or a filter.", "Tiada aset sepadan — kosongkan carian atau penapis.")}</td></tr>
                ) : shown.map((a) => (
                  <tr key={a.id} data-record={`asset:${a.id}`}>
                    <td>{tagBtn(a)}</td>
                    <td><button type="button" className={`${av.strong} ${av.linkBtn}`} onClick={() => showAsset(a)}>{a.name}</button>
                      <span className={av.muted}> · {catLabel(a.category)}</span>
                      {a.condition_note && <span className={av.note}>{a.condition_note}</span>}</td>
                    <td>{a.brand_model ?? <span className={av.muted}>—</span>}</td>
                    <td>{a.issuer_code ? <span className={av.coChip}>{a.issuer_code === "a2z" ? "A2Z" : "AZ ONE"}</span> : <span className={av.muted}>{L("Not set", "Belum")}</span>}</td>
                    <td>{a.assigned_name ?? (a.shared_label ? <span className={av.muted}>{L(`Shared · ${a.shared_label}`, `Dikongsi · ${a.shared_label}`)}</span> : <span className={av.muted}>—</span>)}
                      {a.pending_custody_id ? <span className={`${chipWarn} ${av.ackChip}`}>{L("Waiting for acknowledgement", "Menunggu pengesahan")}</span> : null}</td>
                    <td>{a.location ?? <span className={av.muted}>—</span>}</td>
                    <td>{chip(a.status)}</td>
                    <td className={av.nowrap}>{a.purchase_date ? dmy(a.purchase_date) : <span className={av.muted}>—</span>}</td>
                    <td className={av.num}>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : <span className={av.muted} title={L("No price recorded — not counted as RM 0", "Tiada harga direkodkan — tidak dikira RM 0")}>{L("No price", "Tiada harga")}</span>}</td>
                    <td>
                      <span className={rowActions}>
                        {canEdit && <button type="button" className={rowBtn} onClick={() => startEdit(a)}>{L("Edit", "Sunting")}</button>}
                        {canRemove && (
                          <button type="button" className={rowBtnDanger} title={L("Remove a typo or a mistaken entry — a real asset is marked lost or disposed instead", "Buang kesilapan taip atau entri tersilap — aset sebenar ditanda hilang atau dilupuskan")}
                            onClick={() => void remove(a)}>{L("Remove", "Buang")}</button>
                        )}
                        {audit.state !== "denied" && (
                          <button type="button" className={`${rowBtn} ${av.iconBtn}`} onClick={() => showAsset(a)}
                            aria-label={`${L("History", "Sejarah")} — ${a.asset_tag}`} title={L("History", "Sejarah")}>
                            <AppIcon name="time" />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8}>{L(`TOTAL — recorded purchase cost, active assets${unpricedActive ? ` (${unpricedActive} without a price, not counted)` : ""}`, `JUMLAH — kos belian direkodkan, aset aktif${unpricedActive ? ` (${unpricedActive} tanpa harga, tidak dikira)` : ""}`)}</td>
                  <td className={av.num}>{rm(totalValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
        {loaded && assets.length > 0 && (
          <div className={av.pager}>
            <span className={av.sub}>
              {filtered.length === 0 ? L("0 assets", "0 aset")
                : L(`${pageNow * per + 1}–${Math.min(filtered.length, pageNow * per + per)} of ${filtered.length}${filtering ? ` (filtered from ${assets.length})` : ""}`,
                    `${pageNow * per + 1}–${Math.min(filtered.length, pageNow * per + per)} daripada ${filtered.length}${filtering ? ` (ditapis daripada ${assets.length})` : ""}`)}
            </span>
            <label className={av.perPage}>
              <span>{L("Rows", "Baris")}</span>
              <select className={inputClassSm} value={per} onChange={(e) => { setPer(Number(e.target.value)); setPage(0); }}>
                {PER_PAGE.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <span className={av.pageBtns}>
              <button type="button" className={btnSm} disabled={pageNow === 0} onClick={() => setPage(pageNow - 1)} aria-label={L("Previous page", "Halaman sebelumnya")}><AppIcon name="previous" /></button>
              {/* v1.210.0 - numbered pages, the first, the last and two either side */}
              {Array.from({ length: pages }, (_, i) => i).filter((i) => i === 0 || i === pages - 1 || Math.abs(i - pageNow) <= 2).map((i, k, arr) => (
                <span key={i} className={av.pageGroup}>
                  {k > 0 && i - arr[k - 1]! > 1 && <span className={av.muted} aria-hidden>…</span>}
                  <button type="button" className={`${btnSm} ${i === pageNow ? av.pageOn : ""}`} aria-current={i === pageNow ? "page" : undefined}
                    aria-label={L(`Page ${i + 1}`, `Halaman ${i + 1}`)} onClick={() => setPage(i)}>{i + 1}</button>
                </span>
              ))}
              <button type="button" className={btnSm} disabled={pageNow >= pages - 1} onClick={() => setPage(pageNow + 1)} aria-label={L("Next page", "Halaman seterusnya")}><AppIcon name="next" /></button>
            </span>
          </div>
        )}
      </div>

      <div className={card}>
        {!canEdit && (
          <p className={av.sub}>{L("You can read the register. Adding and editing assets is for the roles that keep it (HR, the CEO and the COO).", "Anda boleh membaca daftar. Menambah dan menyunting aset adalah untuk peranan yang menyimpannya (HR, CEO dan COO).")}</p>
        )}
        {unavailable && <p className="text-warning mt-2 text-xs font-medium">{L("Assets unavailable — deploy the worker first.", "Aset tidak tersedia — sila pasang worker dahulu.")}</p>}
        <StaleHint show={register.stale} className="mt-2" />
      </div>
      </TabZone>

      {/* ============================== ASSIGNMENTS ============================== */}
      <TabZone label={L("Assignments", "Penugasan")} className={view !== "assign" ? av.off : ""}>
        {/* v1.304.0 - custody: what waits for an acknowledgement or a decision, and the viewer's own assets */}
        {custodyLive && view === "assign" && <CustodyQueue toast={showToast} onChanged={load} openAsset={(id) => { const x = assets.find((y) => y.id === id); if (x) { setDTab("assignment"); showAsset(x); } }} />}
        {custodyLive && view === "assign" && <MyAssets toast={showToast} compact />}
        <div className={av.kpis}>
          <KpiRow label={L("Assignments at a glance", "Penugasan sepintas lalu")}>
            <KpiTile icon="users" tone="gold" label={L("Assigned to staff", "Diberikan kepada kakitangan")} value={assets.filter((a) => a.assigned_to != null).length} busy={!loaded}
              sub={L(`held by ${holders.length} ${holders.length === 1 ? "person" : "people"}`, `dipegang oleh ${holders.length} orang`)} />
            <KpiTile icon="package" tone="blue" label={L("Unassigned", "Tidak diberikan")} value={unassigned.length} busy={!loaded}
              sub={L("In use, spare or in repair, held by nobody", "Digunakan, simpanan atau pembaikan, tiada pemegang")} />
            <KpiTile icon="users" tone="green" label={L("Shared use", "Kegunaan bersama")} value={sharedUse.length} busy={!loaded}
              sub={L("Kept by a team or a place, not one person", "Disimpan oleh pasukan atau tempat, bukan seorang")} />
          </KpiRow>
        </div>
        <section className={card} aria-label={L("Assets by staff", "Aset mengikut kakitangan")}>
          {head("users", av.goldWell, L("Assets by Staff", "Aset mengikut Kakitangan"), L("Who holds which asset, from the register's Assigned to.", "Siapa memegang aset mana, daripada Diberikan kepada dalam daftar."))}
          {!loaded ? <SkelRows rows={4} /> : holders.length === 0 ? empty(L("No asset is assigned to anybody yet.", "Belum ada aset diberikan kepada sesiapa.")) : (
            <div className={av.holders}>
              {holders.map((h) => (
                <div key={h.id} className={av.holder}>
                  <div className={av.holderHead}>
                    <Avatar name={h.name} size="sm" />
                    <span className={av.strong}>{h.name}</span>
                    <span className={av.muted}>{L(`${h.list.length} asset${h.list.length === 1 ? "" : "s"} · ${rm(valueOf(h.list))}`, `${h.list.length} aset · ${rm(valueOf(h.list))}`)}</span>
                  </div>
                  <ul className={av.holderList}>
                    {h.list.map((a) => (
                      <li key={a.id}>
                        {tagBtn(a)}
                        <span>{a.name}{a.brand_model && <span className={av.muted}> · {a.brand_model}</span>}</span>
                        {chip(a.status)}
                        {canEdit && <button type="button" className={rowBtn} onClick={() => { if (custodyLive) { setDTab("assignment"); showAsset(a); } else startEdit(a); }}>{custodyLive ? L("Transfer or return", "Pindah atau pulang") : L("Reassign", "Tugaskan semula")}</button>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
        {/* v1.303.0 - a shared-use asset is In Use without a person (D-3) */}
        <section className={card} aria-label={L("Shared use", "Kegunaan bersama")} data-testid="asset-shared">
          {head("users", av.blueWell, L("Shared Use", "Kegunaan Bersama"), L("Assets kept by a team or a place — in use, with nobody named on purpose.", "Aset yang disimpan oleh pasukan atau tempat — digunakan, sengaja tanpa nama pemegang."))}
          {!loaded ? <SkelRows rows={2} /> : sharedUse.length === 0 ? empty(L("No shared-use asset. Edit an asset and name the team or place that shares it.", "Tiada aset kegunaan bersama. Sunting aset dan namakan pasukan atau tempat yang berkongsi."))
            : (
              <div className={av.holders}>
                {groupLines(sharedUse, (a) => a.shared_label ?? "").map((g) => (
                  <div key={g.key} className={av.holder}>
                    <div className={av.holderHead}>
                      <span className={`${av.well} ${av.blueWell}`}><AppIcon name="users" /></span>
                      <span className={av.strong}>{g.key}</span>
                      <span className={av.muted}>{L(`${g.count} asset${g.count === 1 ? "" : "s"} · ${rm(g.active_cost_cents)}`, `${g.count} aset · ${rm(g.active_cost_cents)}`)}</span>
                    </div>
                    <ul className={av.holderList}>
                      {sharedUse.filter((a) => a.shared_label === g.key).map((a) => (
                        <li key={a.id}>{tagBtn(a)}<span>{a.name}</span>{chip(a.status)}{canEdit && <button type="button" className={rowBtn} onClick={() => startEdit(a)}>{L("Edit", "Sunting")}</button>}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
        </section>
        <section className={card} aria-label={L("Unassigned assets", "Aset tidak diberikan")}>
          {head("package", av.blueWell, L("Unassigned Assets", "Aset Tidak Diberikan"), L("Active assets with nobody named and no shared team or place — spares and things in the store.", "Aset aktif tanpa nama pemegang — peralatan kongsi, simpanan dan barang di stor."))}
          {!loaded ? <SkelRows rows={3} /> : unassigned.length === 0 ? empty(L("Every active asset has somebody named.", "Setiap aset aktif ada pemegangnya."))
            : miniTable(unassigned, ["location", "status"], L("Unassigned assets", "Aset tidak diberikan"))}
          {!custodyLive && <p className={av.proposal}>
            <AppIcon name="idea" />
            {L("Next (approved 14-11-2026, phase 2, opens once the database update 0194 is applied): the custody workflow — assign, the holder acknowledges, transfer or return — each step kept in the asset's history. Until then every change, with what it was before and after, is in the asset history under Reports & Audit.",
               "Seterusnya (diluluskan 14-11-2026, fasa 2, dibuka sebaik kemas kini pangkalan data 0194 dipasang): aliran jagaan — tugaskan, pemegang mengesahkan, pindah atau pulang — setiap langkah disimpan dalam sejarah aset. Sehingga itu setiap perubahan, dengan nilai sebelum dan selepas, ada dalam sejarah aset di bawah Laporan & Audit.")}
          </p>}
        </section>
      </TabZone>

      {/* ======================== MAINTENANCE & DISPOSAL ======================== */}
      <TabZone label={L("Maintenance and disposal", "Penyelenggaraan dan pelupusan")} className={view !== "care" ? av.off : ""}>
        {/* v1.305.0 - phase 3: the records (0195); before it is applied, the status lists as they were */}
        {careLive && view === "care" && <CareBoard toast={showToast} refreshKey={careTick} assets={assets} onChanged={load} openAsset={(id) => { const x = assets.find((y) => y.id === id); if (x) { setDTab("care"); showAsset(x); } }} />}
        {!careLive && (["repair", "lost", "disposed"] as const).map((k) => {
          const list = assets.filter((a) => a.status === k);
          const meta = k === "repair"
            ? { icon: "fix" as AppIconName, tone: av.goldWell, title: L("In Repair", "Dalam Pembaikan"), sub: L("Out of use while being fixed — still counted in the value.", "Tidak digunakan semasa dibaiki — masih dikira dalam nilai.") }
            : k === "lost"
            ? { icon: "warning" as AppIconName, tone: av.redWell, title: L("Lost", "Hilang"), sub: L("Kept in the register for the record; not counted in the value.", "Disimpan dalam daftar untuk rekod; tidak dikira dalam nilai.") }
            : { icon: "blocked" as AppIconName, tone: av.greyWell, title: L("Disposed", "Dilupuskan"), sub: L("Retired on purpose; the record and its history stay.", "Dibersarakan dengan sengaja; rekod dan sejarahnya kekal.") };
          return (
            <section key={k} className={card} aria-label={meta.title}>
              {head(meta.icon, meta.tone, `${meta.title} · ${list.length}`, meta.sub)}
              {!loaded ? <SkelRows rows={2} /> : list.length === 0
                ? empty(L("Nothing here.", "Tiada apa-apa di sini."))
                : miniTable(list, ["assigned", "location", "note", "date"], meta.title)}
            </section>
          );
        })}
        {!careLive && <section className={card} aria-label={L("How status works", "Cara status berfungsi")}>
          {head("info", av.blueWell, L("How Status Works", "Cara Status Berfungsi"))}
          <ul className={av.rules}>
            <li>{L("Change status moves an asset between In use, Spare, In repair, Lost and Disposed. Lost and Disposed ask first.", "Tukar status memindahkan aset antara Digunakan, Simpanan, Pembaikan, Hilang dan Dilupuskan. Hilang dan Dilupuskan bertanya dahulu.")}</li>
            <li>{L("A real asset is never deleted — Lost and Disposed keep the record. Only an entry typed by mistake is removed, from the register, and the audit log keeps it.", "Aset sebenar tidak pernah dipadam — Hilang dan Dilupuskan menyimpan rekod. Hanya entri tersilap taip dibuang, dari daftar, dan log audit menyimpannya.")}</li>
            <li className={av.proposalItem}><AppIcon name="idea" />{L("Approved 14-11-2026 (phase 3): issue reports, repair records with their cost as a note, lost-asset incidents, disposal requests approved by the CEO or COO — never by the requester. They open once the database update (0195) is applied; until then, status changes are recorded in the asset history.", "Diluluskan 14-11-2026 (fasa 3): laporan isu, rekod pembaikan dengan kos sebagai nota, insiden aset hilang, permohonan pelupusan diluluskan oleh CEO atau COO — tidak sekali-kali oleh pemohon. Ia dibuka sebaik kemas kini pangkalan data (0195) dipasang; sehingga itu, perubahan status direkodkan dalam sejarah aset.")}</li>
          </ul>
        </section>}
      </TabZone>

      {/* ============================ REPORTS & AUDIT ============================ */}
      {/* v1.303.0 - ONE report selector (the reference's list) beside the report;
          every figure from lib/asset-figures.ts; each company's money in its own
          column, never one mixed total; CSV (opens in Excel) and PDF from the
          same rows the screen shows */}
      <TabZone label={L("Reports and audit", "Laporan dan audit")} className={view !== "reports" ? av.off : ""}>
        <div className={av.reports}>
          <nav className={`${card} ${av.repNav} erp-desktop-only`} aria-label={L("Reports", "Laporan")}>
            <p className={av.title}>{L("Reports", "Laporan")}</p>
            <ul>
              {REPORTS.map(([k, label, icon]) => (
                <li key={k}><button type="button" aria-pressed={report === k} onClick={() => setReport(k)} data-testid="asset-report-pick"><AppIcon name={icon} />{label}</button></li>
              ))}
            </ul>
          </nav>
          <section className={card} aria-label={rep.title} data-testid="asset-report">
            <label className={`${av.field} erp-phone-only`}>
              <span>{L("Report", "Laporan")}</span>
              <select className={inputClassSm} value={report} onChange={(e) => setReport(e.target.value as Report)} data-testid="asset-report-select">
                {REPORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            {head(REPORTS.find(([k]) => k === report)?.[2] ?? "chart", av.goldWell, rep.title, rep.sub,
              <span className={av.headTools}>
                {report !== "audit" && (
                  <select className={inputClassSm} aria-label={L("Company", "Syarikat")} value={coR} onChange={(e) => setCoR(e.target.value)} data-testid="asset-report-company">
                    <option value="">{L("Both companies (each its own column)", "Kedua-dua syarikat (lajur masing-masing)")}</option>
                    {Object.entries(COMPANY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    <option value={COMPANY_NOT_SET}>{L("Company not set", "Syarikat belum ditetapkan")}</option>
                  </select>
                )}
                <button type="button" className={btnSm} disabled={!rep.ready || rep.rows.length === 0} onClick={exportCsv} data-testid="asset-export-csv"><AppIcon name="download" />CSV</button>
                <button type="button" className={btnSm} disabled={!rep.ready || rep.rows.length === 0} onClick={exportPdf} data-testid="asset-export-pdf"><AppIcon name="document" />PDF</button>
              </span>)}
            {!rep.ready ? <SkelRows rows={5} />
              : rep.denied ? <p className={av.empty}><AppIcon name="warning" />{L("The asset history could not be read just now — try again later.", "Sejarah aset tidak dapat dibaca sekarang — cuba lagi kemudian.")}</p>
              : rep.rows.length === 0 ? empty(rep.empty)
              : (
                <div className={`erp-table-scroll erp-mt-2 ${av.tableWrap}`}>
                  <table className={av.plain} aria-label={rep.title} data-testid="asset-report-table">
                    <thead><tr>{rep.head.map((h, k) => <th key={k} className={k >= rep.numFrom ? av.num : ""}>{h}</th>)}</tr></thead>
                    <tbody>
                      {rep.rows.map((r, n) => (
                        <tr key={n}>{r.map((c, k) => <td key={k} className={k >= rep.numFrom ? av.num : ""}>{cellText(c)}</td>)}</tr>
                      ))}
                    </tbody>
                    {rep.foot && <tfoot><tr>{rep.foot.map((c, k) => <td key={k} className={k >= rep.numFrom ? av.num : ""}>{cellText(c)}</td>)}</tr></tfoot>}
                  </table>
                </div>
              )}
            {rep.note && <p className={av.sub}>{rep.note}</p>}
          </section>
        </div>
      </TabZone>


      {/* ============================ ADD / EDIT ============================ */}
      {/* v1.210.0 - the same form and the same save(), in a drawer from Add
          asset or an asset's Edit, so the list stays where it was */}
      <SideDrawer
        open={openForm && canEdit}
        onClose={closeForm}
        wide
        title={editId ? L(`Edit ${form.asset_tag}`, `Sunting ${form.asset_tag}`) : L("New asset", "Aset baharu")}
        subtitle={editId ? form.name : L("A blank tag is numbered for you (AZOA-001…).", "Tag kosong dinomborkan untuk anda (AZOA-001…).")}
        footer={
          <span className={av.actions}>
            <button type="button" className={btnClass} onClick={() => void save()}>{editId ? L("Save changes", "Simpan perubahan") : L("Add asset", "Tambah aset")}</button>
            <button type="button" className={btnSm} onClick={closeForm}>{L("Cancel", "Batal")}</button>
          </span>
        }
      >
        <div id="asset-form" className={av.drawer}>
            <p className={`${sub} flex items-center gap-1.5`}><AppIcon name="identification" className="h-3.5 w-3.5" />{L("Identification", "Pengenalan")}</p>
            <div className={av.formGrid}>
              <label className="block"><span className={lbl}>{L("Asset tag", "Tag aset")}</span>
                <input className={input} placeholder={L("blank = auto (AZOA-001)", "kosong = auto (AZOA-001)")} disabled={editId !== null} {...f("asset_tag")} /></label>
              <label className="block"><span className={lbl}>{L("Asset name *", "Nama aset *")}</span>
                <input className={input} placeholder={L('e.g. Ring light 18"', 'cth. Ring light 18"')} {...f("name")} /></label>
              <label className="block"><span className={lbl}>{L("Category", "Kategori")}</span>
                <select className={input} {...f("category")}>{CATS.map(([v, l, ms]) => <option key={v} value={v}>{L(l, ms)}</option>)}</select></label>
              <label className="block"><span className={lbl}>{L("Brand & model", "Jenama & model")}</span>
                <input className={input} placeholder={L("e.g. Godox SL-60W", "cth. Godox SL-60W")} {...f("brand_model")} /></label>
              <label className="block"><span className={lbl}>{L("Serial no.", "No. siri")}</span>
                <input className={input} placeholder={L("from the sticker", "daripada pelekat")} {...f("serial_no")} /></label>
            </div>
            <p className={`${sub} flex items-center gap-1.5`}><AppIcon name="purchase" className="h-3.5 w-3.5" />{L("Purchase", "Pembelian")}</p>
            <div className={av.formGrid}>
              <label className="block"><span className={lbl}>{L("Purchase date", "Tarikh pembelian")}</span>
                <input className={input} type="date" {...f("purchase_date")} /></label>
              <label className="block"><span className={lbl}>{L("Price (RM)", "Harga (RM)")}</span>
                <input className={input} inputMode="decimal" placeholder="0.00" {...f("purchase_price")} /></label>
              <label className="block"><span className={lbl}>{L("Vendor", "Pembekal")}</span>
                <input className={input} placeholder={L("e.g. Shopee, Machines", "cth. Shopee, Machines")} {...f("vendor")} /></label>
              <label className="block"><span className={lbl}>{L("Warranty until", "Waranti sehingga")}</span>
                <input className={input} type="date" {...f("warranty_until")} /></label>
            </div>
            <p className={`${sub} flex items-center gap-1.5`}><AppIcon name="assignment" className="h-3.5 w-3.5" />{L("Assignment & status", "Penugasan & status")}</p>
            <div className={av.formGrid}>
              <label className="block"><span className={lbl}>{L("Assigned to", "Diberikan kepada")}</span>
                <select className={input} {...f("assigned_to")} disabled={editId !== null && custodyLive} title={editId !== null && custodyLive ? L("Use Assign, Transfer or Return in the asset's detail", "Guna Tugaskan, Pindah atau Pulang dalam butiran aset") : undefined}>
                  <option value="">{L("— unassigned / shared —", "— tidak diberikan / kongsi —")}</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select></label>
              {editId !== null && custodyLive && <p className={av.sub}>{L("Who holds it changes with Assign, Transfer or Return in the asset's Assignment tab — each step is kept.", "Pemegang ditukar melalui Tugaskan, Pindah atau Pulang dalam tab Penugasan aset — setiap langkah disimpan.")}</p>}
              <label className="block"><span className={lbl}>{L("Location", "Lokasi")}</span>
                <input className={input} placeholder={L("e.g. Studio A, Store room", "cth. Studio A, Bilik stor")} {...f("location")} /></label>
              <label className="block"><span className={lbl}>{L("Status", "Status")}</span>
                <select className={input} {...f("status")} disabled={careLive && CARE.includes(form.status)}>{statusChoices(form.status).map(([v, l, ms]) => <option key={v} value={v}>{L(l, ms)}</option>)}</select></label>
              {careLive && <p className={av.sub}>{L("In repair, Lost and Disposed are recorded in the asset's Maintenance tab.", "Dalam pembaikan, Hilang dan Dilupuskan direkod dalam tab Penyelenggaraan aset.")}</p>}
              <label className="block"><span className={lbl}>{L("Condition note", "Nota keadaan")}</span>
                <input className={input} placeholder={L("e.g. scratch on left side", "cth. calar di sebelah kiri")} {...f("condition_note")} /></label>
              {/* v1.303.0 - a shared-use asset: a team or a place, and nobody named (D-3) */}
              <label className="block"><span className={lbl}>{L("Shared use by (team or place)", "Kegunaan bersama oleh (pasukan atau tempat)")}</span>
                <input className={input} placeholder={L("e.g. Studio team, Reception — leave empty if one person holds it", "cth. Pasukan studio, Kaunter — kosongkan jika dipegang seorang")} disabled={form.assigned_to !== ""} {...f("shared_label")} data-testid="asset-shared-label" /></label>
            </div>
            {/* v1.303.0 - the owning company: set by a person, never guessed (A5); once set, only the CEO or COO moves it, with a reason */}
            <p className={`${sub} flex items-center gap-1.5`}><AppIcon name="store" className="h-3.5 w-3.5" />{L("Company", "Syarikat")}</p>
            {(() => {
              const was = editId ? assets.find((x) => x.id === editId) : null;
              const locked = !!was?.issuer_code && !canMoveCompany;
              const moving = !!was?.issuer_code && form.issuer_code !== was.issuer_code;
              return (
                <div className={av.formGrid}>
                  <label className="block"><span className={lbl}>{L("Owning company", "Syarikat pemilik")}</span>
                    <select className={input} disabled={locked} {...f("issuer_code")} data-testid="asset-company">
                      <option value="">{L("— not set yet —", "— belum ditetapkan —")}</option>
                      {Object.entries(COMPANY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></label>
                  {locked && <p className={av.sub}>{L("Set. Only the CEO or COO moves an asset to the other company.", "Telah ditetapkan. Hanya CEO atau COO memindahkan aset ke syarikat lain.")}</p>}
                  {moving && (
                    <label className="block"><span className={lbl}>{L("Reason for the company change *", "Sebab pertukaran syarikat *")}</span>
                      <input className={input} placeholder={L("at least 10 characters", "sekurang-kurangnya 10 aksara")} {...f("company_reason")} data-testid="asset-company-reason" /></label>
                  )}
                </div>
              );
            })()}
        </div>
      </SideDrawer>

      {/* change status - the same PATCH, asked first for lost or disposed */}
      <SideDrawer
        open={statusFor !== null}
        onClose={() => setStatusFor(null)}
        title={statusFor ? L(`Change status — ${statusFor.asset_tag}`, `Tukar status — ${statusFor.asset_tag}`) : ""}
        subtitle={statusFor ? `${statusFor.name}${statusFor.brand_model ? ` · ${statusFor.brand_model}` : ""}` : undefined}
        footer={statusFor ? (
          <span className={av.actions}>
            <button type="button" className={btnClass} onClick={() => void saveStatus()}>{L("Save status", "Simpan status")}</button>
            <button type="button" className={btnSm} onClick={() => setStatusFor(null)}>{L("Cancel", "Batal")}</button>
          </span>
        ) : undefined}
      >
        {statusFor && (
          <div className={av.drawer}>
            <p className={av.sub}>{L("Now: ", "Sekarang: ")}{chip(statusFor.status)}</p>
            <fieldset className={av.statusPick}>
              <legend className={av.formTitle}>{L("New status", "Status baharu")}</legend>
              {statusChoices(statusFor.status).map(([v, l, ms]) => (
                <label key={v} className={nextStatus === v ? av.pickOn : ""}>
                  <input type="radio" name="asset-status" value={v} checked={nextStatus === v} onChange={() => setNextStatus(v)} />
                  <span className={av.dot} style={{ background: STATUS_COLOR[v] }} aria-hidden />
                  {L(l, ms)}
                </label>
              ))}
            </fieldset>
            <label className={av.field}>
              <span>{L("Condition note", "Nota keadaan")}</span>
              <input className={inputClassSm} value={nextNote} placeholder={L("e.g. sent for repair, fan noise", "cth. dihantar untuk dibaiki, bunyi kipas")} onChange={(e) => setNextNote(e.target.value)} />
            </label>
            {careLive && <p className={av.sub}>{L("In repair, Lost and Disposed are recorded in the asset's Maintenance tab — each with its record.", "Dalam pembaikan, Hilang dan Dilupuskan direkod dalam tab Penyelenggaraan aset — setiap satu dengan rekodnya.")}</p>}
            {(nextStatus === "lost" || nextStatus === "disposed") && nextStatus !== statusFor.status && (
              <p className={av.warnText}>{L("Lost and disposed keep the record but take the asset out of the value. You will be asked to confirm.", "Hilang dan dilupuskan menyimpan rekod tetapi mengeluarkan aset daripada nilai. Anda akan diminta mengesahkan.")}</p>
            )}
          </div>
        )}
      </SideDrawer>

      {/* ============================ THE ASSET DRAWER ============================ */}
      {/* v1.210.0 - one asset: the record as the register holds it, who has
          it and where, its history from the audit log (for the roles the
          server lets read it), and the commands the row already had. Nothing
          here is computed that the record does not hold. */}
      {(() => {
        const a = detailId == null ? null : assets.find((x) => x.id === detailId) ?? null;
        if (!a) return null;
        const warr = a.warranty_until ? (a.warranty_until < today ? "ended" : a.warranty_until <= in90 ? "soon" : "ok") : null;
        const rows = audit.state === "ok" ? audit.entries.filter((r) => r.entity_id === String(a.id)) : [];
        return (
          <SideDrawer open onClose={() => setDetailId(null)} wide title={a.name}
            subtitle={<span className={av.badges}><span className={av.mono}>{a.asset_tag}</span>{chip(a.status)}<span className={chipNeutral}>{catLabel(a.category)}</span></span>}
            footer={(canEdit || canRemove) ? (
              <span className={av.actions}>
                {canEdit && <button type="button" className={btnClass} onClick={() => startEdit(a)}><AppIcon name="edit" />{L("Edit", "Sunting")}</button>}
                {canEdit && (!careLive || !CARE.includes(a.status)) && <button type="button" className={btnSm} onClick={() => openStatusChange(a)}>{L("Change status", "Tukar status")}</button>}
                {canRemove && <button type="button" className={rowBtnDanger} onClick={() => { setDetailId(null); void remove(a); }}>{L("Remove entry", "Buang entri")}</button>}
              </span>
            ) : undefined}>
            <div className={av.detail} data-record={`asset:${a.id}`}>
              <section className={av.detailSec} aria-label={L("Basic information", "Maklumat asas")}>
                <p className={av.title}>{L("Basic information", "Maklumat asas")}</p>
                <dl className={av.facts}>
                  <div><dt>{L("Asset tag", "Tag aset")}</dt><dd className={av.mono}>{a.asset_tag}</dd></div>
                  <div><dt>{L("Asset name", "Nama aset")}</dt><dd>{a.name}</dd></div>
                  <div><dt>{L("Category", "Kategori")}</dt><dd>{catLabel(a.category)}</dd></div>
                  <div><dt>{L("Brand & model", "Jenama & model")}</dt><dd>{a.brand_model ?? "—"}</dd></div>
                  <div><dt>{L("Serial no.", "No. siri")}</dt><dd>{a.serial_no ?? "—"}</dd></div>
                  <div><dt>{L("Purchase date", "Tarikh pembelian")}</dt><dd>{a.purchase_date ? dmy(a.purchase_date) : "—"}</dd></div>
                  <div><dt>{L("Recorded purchase cost", "Kos belian direkodkan")}</dt><dd>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : L("No price recorded", "Tiada harga direkodkan")}</dd></div>
                  <div><dt>{L("Company", "Syarikat")}</dt><dd>{companyLabel(a.issuer_code)}</dd></div>
                  <div><dt>{L("Vendor", "Pembekal")}</dt><dd>{a.vendor ?? "—"}</dd></div>
                  <div><dt>{L("Warranty until", "Waranti sehingga")}</dt><dd>{a.warranty_until ? <>{dmy(a.warranty_until)} {warr === "ended" ? <span className={chipNeutral}>{L("ended", "tamat")}</span> : warr === "soon" ? <span className={chipWarn}>{L("ends within 90 days", "tamat dalam 90 hari")}</span> : null}</> : "—"}</dd></div>
                  <div><dt>{L("Status", "Status")}</dt><dd>{chip(a.status)}</dd></div>
                </dl>
                {a.condition_note && <p className={av.noteBox}>{a.condition_note}</p>}
                <p className={av.sub}>{L("The cost is the purchase price as recorded; lost and disposed assets are not counted in the totals. No depreciation is calculated.", "Kos ialah harga belian seperti direkodkan; aset hilang dan dilupuskan tidak dikira dalam jumlah. Tiada susut nilai dikira.")}</p>
              </section>
              <span role="group" aria-label={L("Asset detail", "Butiran aset")} className={av.mode}>
                <button type="button" aria-pressed={dTab === "assignment"} onClick={() => setDTab("assignment")}>{L("Assignment", "Penugasan")}</button>
                {careLive && <button type="button" aria-pressed={dTab === "care"} onClick={() => setDTab("care")} data-testid="asset-tab-care">{L("Maintenance", "Penyelenggaraan")}</button>}
                <button type="button" aria-pressed={dTab === "history"} onClick={() => { setDTab("history"); void loadAudit(); }}>{L("History", "Sejarah")}</button>
              </span>
              <section className={`${av.detailSec} ${dTab !== "assignment" ? av.off : ""}`} aria-label={L("Assignment", "Penugasan")}>
                <p className={av.title}>{L("Assignment", "Penugasan")}</p>
                <dl className={av.facts}>
                  <div><dt>{L("Assigned to", "Diberikan kepada")}</dt><dd>{a.assigned_name ? <span className={av.who}><Avatar name={a.assigned_name} size="sm" /><span>{a.assigned_name}</span></span> : a.shared_label ? L(`Shared use · ${a.shared_label}`, `Kegunaan bersama · ${a.shared_label}`) : L("Unassigned", "Tidak diberikan")}</dd></div>
                  <div><dt>{L("Location", "Lokasi")}</dt><dd>{a.location ?? noLocation()}</dd></div>
                </dl>
                {offList(a) && <p className={av.warnText}>{L("The holder is not on the current staff list — check whether the asset was returned.", "Pemegang tiada dalam senarai kakitangan semasa — semak sama ada aset telah dipulangkan.")}</p>}
                {a.pending_custody_id ? <p className={av.warnText}>{L("Waiting for the holder's acknowledgement.", "Menunggu pengesahan pemegang.")}</p> : null}
                {custodyLive && <CustodyPanel key={`${a.id}:${a.assigned_to ?? "-"}:${a.pending_custody_id ?? "-"}`} assetId={a.id} holderId={a.assigned_to} staff={staff} canManage={canEdit} toast={showToast} onChanged={load} />}
              </section>
              {careLive && dTab === "care" && (
                <section className={av.detailSec} aria-label={L("Maintenance", "Penyelenggaraan")}>
                  <p className={av.title}>{L("Maintenance", "Penyelenggaraan")}</p>
                  <CarePanel key={`${a.id}:${a.status}:${a.assigned_to ?? "-"}`} assetId={a.id} held={a.assigned_to != null} toast={showToast} onChanged={() => { load(); setCareTick((t) => t + 1); }} />
                </section>
              )}
              <section className={`${av.detailSec} ${dTab !== "history" ? av.off : ""}`} aria-label={L("History", "Sejarah")}>
                <p className={av.title}>{L("History", "Sejarah")}</p>
                {audit.state === "idle" ? <button type="button" className={btnSm} onClick={() => void loadAudit()}><AppIcon name="time" />{L("Show history", "Tunjuk sejarah")}</button>
                  : audit.state === "loading" ? <SkelRows rows={3} />
                  : audit.state === "denied" || audit.state === "error" ? <p className={av.empty}><AppIcon name="warning" />{L("The audit log could not be read just now.", "Log audit tidak dapat dibaca sekarang.")}</p>
                  : rows.length === 0 ? empty(L("No change recorded for this asset in the latest 300 asset events.", "Tiada perubahan direkodkan untuk aset ini dalam 300 peristiwa aset terkini."))
                  : (
                    <ol className={av.timeline}>
                      {rows.map((r) => (
                        <li key={r.id}>
                          <span className={av.strong}>{auditVerb(r.action)}</span>
                          <span>{auditWhat(r)}</span>
                          <span className={av.muted}>{dmyMYT(r.created_at)} · {r.user_name ?? "—"}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                <p className={av.sub}>
                  {L(`Added ${a.created_at ? dmyMYT(a.created_at) : "—"}${a.updated_at ? ` · last changed ${dmyMYT(a.updated_at)}` : ""}`,
                     `Ditambah ${a.created_at ? dmyMYT(a.created_at) : "—"}${a.updated_at ? ` · terakhir diubah ${dmyMYT(a.updated_at)}` : ""}`)}
                </p>
              </section>
            </div>
          </SideDrawer>
        );
      })()}
    </TabPage>
  );
}
