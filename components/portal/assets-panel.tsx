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
   mounted and hides with av.off. */

import { useCallback, useMemo, useState, type ReactNode } from "react";
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
};

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

export function AssetsPanel({ focus }: { focus?: RecordFocus | null }) {
  type AssetCol = "tag" | "item" | "brand" | "assigned" | "location" | "status" | "value" | "date";
  const [assetSort, setAssetSort] = useState<{ col: AssetCol; asc: boolean }>({ col: "tag", asc: true });
  const cycleAsset = (col: AssetCol) => setAssetSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: true });
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<number | null>(null);
  const [openForm, setOpenForm] = useState(false);
  /* v1.210.0 (the owner's Assets brief, 25-10-2026) - ONE ASSET DRAWER: an
     asset's record, its holder, its history and the commands the row has.
     Opened from any tag or name, and from a search hit. */
  const [detailId, setDetailId] = useState<number | null>(null);
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
  const register = useCachedApi<{ assets: Asset[]; can_remove?: boolean }>("/staff/assets", true, ["assets"]);
  const canRemove = register.data?.can_remove === true;
  /* v1.199.0 - can_remove is the server's hr_manage answer, and hr_manage is
     also what POST and PATCH /assets demand: the same flag decides whether
     Add, Edit and Change status are offered. A button that 403s is worse
     than no button. */
  const canEdit = canRemove;
  /* v1.21.0: assignment picker reads /staff-list — the one picker source
     (active staff only, full names) instead of the raw account list. */
  const people = useCachedApi<{ staff: StaffLite[] }>("/staff/staff-list", true, ["users"]);
  const assets = useMemo(() => register.data?.assets ?? [], [register.data]);
  const staff = useMemo(() => people.data?.staff ?? [], [people.data]);
  const loaded = !register.loading;
  const unavailable = register.failed && !register.data;
  const refreshRegister = register.refresh;
  const load = useCallback(() => { refreshRegister(); }, [refreshRegister]);

  const [view, setView] = useState<AssetView>("overview");
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
    });
  };
  const startAdd = () => {
    setDetailId(null);
    setEditId(null); setForm({ ...EMPTY }); setOpenForm(true);
  };
  const closeForm = () => { setOpenForm(false); setEditId(null); setForm({ ...EMPTY }); };

  const save = async () => {
    const body = JSON.stringify(form);
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
  const loadAudit = async () => {
    if (audit.state === "loading" || audit.state === "ok") return;
    setAudit({ state: "loading", entries: [] });
    const r = await api<{ entries?: AuditRow[] }>(`/audit?action=asset.&limit=300`);
    if (r.ok) setAudit({ state: "ok", entries: r.data?.entries ?? [] });
    else setAudit({ state: r.status === 403 ? "denied" : "error", entries: [] });
  };
  const showAsset = (a: Asset) => { openDetail(a); void loadAudit(); };
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
    const parts: string[] = [];
    if (typeof d.status === "string") parts.push(statusLabel(d.status));
    if ("assigned_to" in d) parts.push(L(`assigned: ${staffName(d.assigned_to)}`, `diberikan: ${staffName(d.assigned_to)}`));
    if (typeof d.location === "string" && d.location) parts.push(d.location);
    return parts.length ? parts.join(" · ") : L("Details edited", "Butiran disunting");
  };
  const auditVerb = (action: string) => action === "asset.create" ? L("Added", "Ditambah") : action === "asset.remove" ? L("Removed", "Dibuang") : L("Updated", "Dikemas kini");

  /* v1.88.0 (CEO: "ensure that all the tabs have a function of clickable data
     without me need to open another new tabs") - a status figure narrows the
     register. v1.199.0: the figure is an Overview tile; pressing it opens the
     Asset Register filtered to that status. The KEY is the status code, not
     the translated label, or the filter would stop working in BM. */
  const counts = STATUSES.map(([k, label, labelMs]) => [k, L(label, labelMs), assets.filter((a) => a.status === k).length] as const);
  const [statusF, setStatusF] = useState<string>("");
  const openStatus = (k: string) => { setStatusF(statusF === k && view === "register" ? "" : k); setPage(0); go("register"); };
  const totalValue = assets.filter((a) => a.status !== "disposed" && a.status !== "lost")
    .reduce((s, a) => s + (a.purchase_price_cents ?? 0), 0);
  const sub = "text-muted-foreground mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide";
  const lbl = "text-muted-foreground mb-0.5 block text-[11px]";

  /* ---- the register's toolbar: search, filters, pages ---- */
  const [q, setQ] = useState("");
  const [catF, setCatF] = useState("");
  const [locF, setLocF] = useState("");
  const [page, setPage] = useState(0);
  const [per, setPer] = useState<number>(10);
  const locations = useMemo(() => [...new Set(assets.map((a) => a.location || ""))].sort((a, b) => (a || "~").localeCompare(b || "~")), [assets]);
  /* v1.205.0 - a search hit opens the asset in the register: the search set
     to its tag (so its row is the one shown), the filters cleared */
  const focused = useRecordFocus(focus, loaded, (f) => {
    if (f.kind !== "asset") return;
    const a = assets.find((x) => x.id === f.id);
    setStatusF(""); setCatF(""); setLocF(""); setPage(0);
    setQ(a ? a.asset_tag : "");
    setView("register");
    /* v1.210.0 - and the asset's drawer opens on it */
    if (a) openDetail(a);
  });
  useScrollToRecord(focused);
  const needle = q.trim().toLowerCase();
  const filtered = [...assets].filter((a) => !statusF || a.status === statusF)
    .filter((a) => !catF || a.category === catF)
    .filter((a) => !locF || (locF === "-" ? !a.location : a.location === locF))
    .filter((a) => !needle || [a.asset_tag, a.name, a.brand_model, a.serial_no, a.assigned_name, a.location, a.vendor, a.condition_note]
      .some((x) => (x ?? "").toLowerCase().includes(needle)))
    .sort((a, b) => {
      const dir = assetSort.asc ? 1 : -1;
      switch (assetSort.col) {
        case "tag": return dir * a.asset_tag.localeCompare(b.asset_tag);
        case "item": return dir * a.name.localeCompare(b.name);
        case "brand": return dir * (a.brand_model || "").localeCompare(b.brand_model || "");
        case "assigned": return dir * (a.assigned_name || "").localeCompare(b.assigned_name || "");
        case "location": return dir * (a.location || "").localeCompare(b.location || "");
        case "status": return dir * a.status.localeCompare(b.status);
        case "value": return dir * ((a.purchase_price_cents ?? 0) - (b.purchase_price_cents ?? 0));
        case "date": return dir * (a.purchase_date || "").localeCompare(b.purchase_date || "");
        default: return 0;
      }
    });
  const pages = Math.max(1, Math.ceil(filtered.length / per));
  const pageNow = Math.min(page, pages - 1);
  const shown = filtered.slice(pageNow * per, pageNow * per + per);
  const filtering = !!(statusF || catF || locF || needle);
  const clearFilters = () => { setStatusF(""); setCatF(""); setLocF(""); setQ(""); setPage(0); };

  /* ---- what the other tabs group ---- */
  const total = assets.length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const stamp = (a: Asset) => a.updated_at || a.created_at || "";
  const recent = [...assets].sort((a, b) => stamp(b).localeCompare(stamp(a)) || b.id - a.id).slice(0, 5);
  /* v1.210.0 - an active asset whose holder is not on the current staff list
     (left, deactivated, or an account the list does not carry). Only once
     the list has loaded, so a slow list never flags everybody. */
  const offList = (a: Asset) => people.data != null && a.assigned_to != null && a.status !== "lost" && a.status !== "disposed"
    && !(people.data.staff ?? []).some((u) => u.id === a.assigned_to);
  const attention = assets.filter((a) => a.status === "repair" || a.status === "lost" || a.status === "disposed" || offList(a));
  const byCat = CATS.map(([k]) => ({ k, label: catLabel(k), list: assets.filter((a) => a.category === k) })).filter((c) => c.list.length > 0);
  const byLoc = locations.map((loc) => ({ k: loc || "-", label: loc || noLocation(), list: assets.filter((a) => (a.location || "") === loc) }))
    .sort((a, b) => b.list.length - a.list.length);
  const maxCat = Math.max(1, ...byCat.map((c) => c.list.length));
  const maxLoc = Math.max(1, ...byLoc.map((c) => c.list.length));
  const active = (a: Asset) => a.status !== "disposed" && a.status !== "lost";
  const valueOf = (list: Asset[]) => list.filter(active).reduce((s, a) => s + (a.purchase_price_cents ?? 0), 0);
  const unpriced = assets.filter((a) => a.purchase_price_cents == null).length;
  const holders = useMemo(() => {
    const m = new Map<number, { id: number; name: string; list: Asset[] }>();
    for (const a of assets) {
      if (a.assigned_to == null) continue;
      const cur = m.get(a.assigned_to) ?? { id: a.assigned_to, name: a.assigned_name ?? `#${a.assigned_to}`, list: [] };
      cur.list.push(a); m.set(a.assigned_to, cur);
    }
    return [...m.values()].sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  }, [assets]);
  const unassigned = assets.filter((a) => a.assigned_to == null && active(a));
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
      {canEdit && <button type="button" className={rowBtn} onClick={() => openStatusChange(a)}>{L("Status", "Status")}</button>}
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

  return (
    <TabPage>
      {/* v1.199.0 - outside every zone: a hidden tab must not hide a toast or a question */}
      {toastNode}
      {confirmNode}
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
            <KpiTile icon="database" tone="blue" label={L("Total Asset Value", "Jumlah Nilai Aset")} value={rm(totalValue)} busy={!loaded}
              sub={L("Purchase value, lost and disposed excluded", "Nilai belian, tidak termasuk hilang dan dilupuskan")} />
          </KpiRow>
        </div>

        <div className={av.split}>
          <section className={card} aria-label={L("Recent assets", "Aset terkini")}>
            {head("package", av.goldWell, L("Recent Assets", "Aset Terkini"), L("Latest assets added or updated in the register.", "Aset terkini yang ditambah atau dikemas kini dalam daftar."),
              <button type="button" className={btnSm} onClick={() => { clearFilters(); go("register"); }}>{L("View all", "Lihat semua")}</button>)}
            {!loaded ? <SkelRows rows={5} /> : recent.length === 0 ? empty(L("No assets yet.", "Belum ada aset.")) : (
              <div className={`erp-table-scroll erp-mt-2 ${av.tableWrap}`}>
                <table className={av.plain} aria-label={L("Recent assets", "Aset terkini")}>
                  <thead><tr>
                    <th>{L("Tag", "Tag")}</th><th>{L("Item", "Barang")}</th><th>{L("Brand", "Jenama")}</th><th>{L("Assigned to", "Diberikan kepada")}</th>
                    <th>{L("Location", "Lokasi")}</th><th>{L("Status", "Status")}</th><th className={av.num}>{L("Value (RM)", "Nilai (RM)")}</th>
                  </tr></thead>
                  <tbody>
                    {recent.map((a) => (
                      <tr key={a.id}>
                        <td>{tagBtn(a)}</td>
                        <td className={av.strong}>{a.name}</td>
                        <td>{a.brand_model ?? <span className={av.muted}>—</span>}</td>
                        <td>{a.assigned_name ?? <span className={av.muted}>—</span>}</td>
                        <td>{a.location ?? <span className={av.muted}>—</span>}</td>
                        <td>{chip(a.status)}</td>
                        <td className={av.num}>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className={card} aria-label={L("Asset status", "Status aset")}>
            {head("chart", av.goldWell, L("Asset Status", "Status Aset"), L("Current status of all company assets.", "Status semasa semua aset syarikat."))}
            {!loaded ? <SkelRows rows={5} /> : (
              <div className={av.donutRow}>
                <Donut size={150} hideLegend centerLabel={String(total)} centerSub={L("total assets", "jumlah aset")}
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
          </section>
        </div>

        <div className={av.split2}>
          <section className={card} aria-label={L("Assets by category", "Aset mengikut kategori")}>
            {head("package", av.goldWell, L("Assets by Category", "Aset mengikut Kategori"), L("Distribution of assets by category.", "Taburan aset mengikut kategori."))}
            {!loaded ? <SkelRows rows={4} /> : byCat.length === 0 ? empty(L("No assets yet.", "Belum ada aset.")) : (
              <div className={av.columns} role="img" aria-label={byCat.map((c) => `${c.label}: ${c.list.length}`).join(", ")}>
                {byCat.map((c) => (
                  <button key={c.k} type="button" className={av.col} onClick={() => { setCatF(c.k); setPage(0); go("register"); }}
                    title={L(`Show ${c.label} in the register`, `Tunjuk ${c.label} dalam daftar`)}>
                    <span className={av.colNum}>{c.list.length}</span>
                    <span className={av.colTrack}><span className={av.colBar} style={{ height: `${Math.max(6, (c.list.length / maxCat) * 100)}%` }} /></span>
                    <span className={av.colLabel}>{c.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className={card} aria-label={L("Assets by location", "Aset mengikut lokasi")}>
            {head("place", av.goldWell, L("Assets by Location", "Aset mengikut Lokasi"), L("Distribution of assets by current location.", "Taburan aset mengikut lokasi semasa."))}
            {!loaded ? <SkelRows rows={4} /> : byLoc.length === 0 ? empty(L("No assets yet.", "Belum ada aset.")) : (
              <ul className={av.bars}>
                {byLoc.map((c) => (
                  <li key={c.k}>
                    <button type="button" onClick={() => { setLocF(c.k); setPage(0); go("register"); }}>
                      <span className={av.barLabel}>{c.label}</span>
                      <span className={av.barTrack}><span className={av.barFill} style={{ width: `${Math.max(3, (c.list.length / maxLoc) * 100)}%` }} /></span>
                      <span className={av.barNum}>{c.list.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
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
              {canEdit && <button type="button" className={av.qa} onClick={startAdd}><span className={`${av.qaIcon} ${av.goldWell}`}><AppIcon name="add" /></span><strong>{L("Add New Asset", "Tambah Aset Baharu")}</strong><span>{L("Register a new company asset", "Daftar aset syarikat baharu")}</span></button>}
              <button type="button" className={av.qa} onClick={() => go("assign")}><span className={`${av.qaIcon} ${av.goldWell}`}><AppIcon name="users" /></span><strong>{L("Assign Asset", "Tugaskan Aset")}</strong><span>{L("Who holds what, and what is free", "Siapa memegang apa, dan apa yang kosong")}</span></button>
              <button type="button" className={av.qa} onClick={() => go("care")}><span className={`${av.qaIcon} ${av.redWell}`}><AppIcon name="fix" /></span><strong>{L("Update Status", "Kemas Kini Status")}</strong><span>{L("Mark as repair, lost or disposed", "Tanda pembaikan, hilang atau dilupuskan")}</span></button>
              <button type="button" className={av.qa} onClick={() => go("reports")}><span className={`${av.qaIcon} ${av.blueWell}`}><AppIcon name="document" /></span><strong>{L("View Reports", "Lihat Laporan")}</strong><span>{L("Asset valuation and activity logs", "Penilaian aset dan log aktiviti")}</span></button>
            </div>
          </section>
        </div>
      </TabZone>

      {/* ============================ ASSET REGISTER ============================ */}
      <TabZone label={L("The register", "Daftar")} className={view !== "register" ? av.off : ""}>
      <div className={card}>
        <p className={av.title}>{L("Company assets", "Aset syarikat")}</p>
        <p className={av.sub}>
          {L("Every piece of equipment the company owns — who holds it, where it lives, what it's worth. A real asset is never deleted: mark it lost or disposed so the history stays. An entry typed by mistake can be removed — it leaves the register, the audit log keeps it.", "Setiap peralatan milik syarikat — siapa yang memegangnya, di mana ia berada, berapa nilainya. Aset sebenar tidak pernah dipadam: tandakan sebagai hilang atau dilupuskan supaya sejarahnya kekal. Entri yang tersilap taip boleh dibuang — ia keluar dari daftar, log audit menyimpannya.")}
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
        ) : regMode === "grid" ? (
          shown.length === 0 ? <p className={av.empty}>{L("No asset matches — clear the search or a filter.", "Tiada aset sepadan — kosongkan carian atau penapis.")}</p> : (
            <ul className={av.grid} aria-label={L("Assets", "Aset")}>
              {shown.map((a) => (
                <li key={a.id} data-record={`asset:${a.id}`}>
                  <button type="button" className={av.gridCard} onClick={() => showAsset(a)}>
                    <span className={av.gridTop}><span className={av.mono}>{a.asset_tag}</span>{chip(a.status)}</span>
                    <strong>{a.name}</strong>
                    <span className={av.muted}>{catLabel(a.category)}{a.brand_model ? ` · ${a.brand_model}` : ""}</span>
                    <span className={av.gridFoot}>
                      <span>{a.assigned_name ?? L("Unassigned", "Tidak diberikan")}{a.location ? ` · ${a.location}` : ""}</span>
                      <strong>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : "—"}</strong>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          /* v1.176.1 - sideways only; the page owns the vertical gesture. */
          <div className={`tbl-sticky erp-table-scroll erp-mt-2 ${av.tableWrap}`}>
            <table className={av.register}>
              <thead>
                <tr>
                  {([
                    ["tag", L("Tag", "Tag"), ""],
                    ["item", L("Item", "Barang"), ""],
                    ["brand", L("Brand", "Jenama"), ""],
                    ["assigned", L("Assigned to", "Diberikan kepada"), ""],
                    ["location", L("Location", "Lokasi"), ""],
                    ["status", L("Status", "Status"), ""],
                    ["date", L("Purchased", "Dibeli"), ""],
                    ["value", L("Value (RM)", "Nilai (RM)"), av.num],
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
                  <tr><td colSpan={9} className={av.emptyCell}>{L("No asset matches — clear the search or a filter.", "Tiada aset sepadan — kosongkan carian atau penapis.")}</td></tr>
                ) : shown.map((a) => (
                  <tr key={a.id} data-record={`asset:${a.id}`}>
                    <td>{tagBtn(a)}</td>
                    <td><button type="button" className={`${av.strong} ${av.linkBtn}`} onClick={() => showAsset(a)}>{a.name}</button>
                      <span className={av.muted}> · {catLabel(a.category)}</span>
                      {a.condition_note && <span className={av.note}>{a.condition_note}</span>}</td>
                    <td>{a.brand_model ?? <span className={av.muted}>—</span>}</td>
                    <td>{a.assigned_name ?? <span className={av.muted}>—</span>}</td>
                    <td>{a.location ?? <span className={av.muted}>—</span>}</td>
                    <td>{chip(a.status)}</td>
                    <td className={av.nowrap}>{a.purchase_date ? dmy(a.purchase_date) : <span className={av.muted}>—</span>}</td>
                    <td className={av.num}>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : "—"}</td>
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
                  <td colSpan={7}>{L("TOTAL — active asset value", "JUMLAH — nilai aset aktif")}</td>
                  <td className={av.num}>{rm(totalValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
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
          <p className={av.sub}>{L("You can read the register. Adding and editing assets is for the roles that keep it (HR and the CEO).", "Anda boleh membaca daftar. Menambah dan menyunting aset adalah untuk peranan yang menyimpannya (HR dan CEO).")}</p>
        )}
        {unavailable && <p className="text-warning mt-2 text-xs font-medium">{L("Assets unavailable — deploy the worker first.", "Aset tidak tersedia — sila pasang worker dahulu.")}</p>}
        <StaleHint show={register.stale} className="mt-2" />
      </div>
      </TabZone>

      {/* ============================== ASSIGNMENTS ============================== */}
      <TabZone label={L("Assignments", "Penugasan")} className={view !== "assign" ? av.off : ""}>
        <div className={av.kpis}>
          <KpiRow label={L("Assignments at a glance", "Penugasan sepintas lalu")}>
            <KpiTile icon="users" tone="gold" label={L("Assigned to staff", "Diberikan kepada kakitangan")} value={assets.filter((a) => a.assigned_to != null).length} busy={!loaded}
              sub={L(`held by ${holders.length} ${holders.length === 1 ? "person" : "people"}`, `dipegang oleh ${holders.length} orang`)} />
            <KpiTile icon="package" tone="blue" label={L("Unassigned", "Tidak diberikan")} value={unassigned.length} busy={!loaded}
              sub={L("In use, spare or in repair, held by nobody", "Digunakan, simpanan atau pembaikan, tiada pemegang")} />
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
                        {canEdit && <button type="button" className={rowBtn} onClick={() => startEdit(a)}>{L("Reassign", "Tugaskan semula")}</button>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className={card} aria-label={L("Unassigned assets", "Aset tidak diberikan")}>
          {head("package", av.blueWell, L("Unassigned Assets", "Aset Tidak Diberikan"), L("Active assets with nobody named — shared kit, spares and things in the store.", "Aset aktif tanpa nama pemegang — peralatan kongsi, simpanan dan barang di stor."))}
          {!loaded ? <SkelRows rows={3} /> : unassigned.length === 0 ? empty(L("Every active asset has somebody named.", "Setiap aset aktif ada pemegangnya."))
            : miniTable(unassigned, ["location", "status"], L("Unassigned assets", "Aset tidak diberikan"))}
          <p className={av.proposal}>
            <AppIcon name="idea" />
            {L("Proposed, not built: an assignment history (who held an asset, from when to when) needs its own record and a database change — it would come to you for approval first. Today each edit, with the holder at the time, is in the audit log under Reports & Audit.",
               "Dicadangkan, belum dibina: sejarah penugasan (siapa memegang aset, dari bila hingga bila) memerlukan rekod sendiri dan perubahan pangkalan data — ia akan dibawa kepada anda untuk kelulusan dahulu. Hari ini setiap suntingan, dengan pemegang ketika itu, ada dalam log audit di Laporan & Audit.")}
          </p>
        </section>
      </TabZone>

      {/* ======================== MAINTENANCE & DISPOSAL ======================== */}
      <TabZone label={L("Maintenance and disposal", "Penyelenggaraan dan pelupusan")} className={view !== "care" ? av.off : ""}>
        {(["repair", "lost", "disposed"] as const).map((k) => {
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
        <section className={card} aria-label={L("How status works", "Cara status berfungsi")}>
          {head("info", av.blueWell, L("How Status Works", "Cara Status Berfungsi"))}
          <ul className={av.rules}>
            <li>{L("Change status moves an asset between In use, Spare, In repair, Lost and Disposed. Lost and Disposed ask first.", "Tukar status memindahkan aset antara Digunakan, Simpanan, Pembaikan, Hilang dan Dilupuskan. Hilang dan Dilupuskan bertanya dahulu.")}</li>
            <li>{L("A real asset is never deleted — Lost and Disposed keep the record. Only an entry typed by mistake is removed, from the register, and the audit log keeps it.", "Aset sebenar tidak pernah dipadam — Hilang dan Dilupuskan menyimpan rekod. Hanya entri tersilap taip dibuang, dari daftar, dan log audit menyimpannya.")}</li>
            <li className={av.proposalItem}><AppIcon name="idea" />{L("Proposed, not built: maintenance tracking (when it went in, the repairer, the cost, when it came back) needs a database change — it would come to you for approval first.", "Dicadangkan, belum dibina: penjejakan penyelenggaraan (bila dihantar, pembaik, kos, bila kembali) memerlukan perubahan pangkalan data — ia akan dibawa kepada anda untuk kelulusan dahulu.")}</li>
          </ul>
        </section>
      </TabZone>

      {/* ============================ REPORTS & AUDIT ============================ */}
      <TabZone label={L("Reports and audit", "Laporan dan audit")} className={view !== "reports" ? av.off : ""}>
        <section className={card} aria-label={L("Status summary", "Ringkasan status")}>
          {head("chart", av.goldWell, L("Asset Status Summary", "Ringkasan Status Aset"),
            L(`Purchase value as recorded in the register${unpriced > 0 ? ` — ${unpriced} asset${unpriced === 1 ? " has" : "s have"} no price recorded` : ""}.`,
              `Nilai belian seperti direkodkan dalam daftar${unpriced > 0 ? ` — ${unpriced} aset tiada harga direkodkan` : ""}.`))}
          {!loaded ? <SkelRows rows={5} /> : (
            <div className={`erp-table-scroll erp-mt-2 ${av.tableWrap}`}>
              <table className={av.plain} aria-label={L("Status summary", "Ringkasan status")}>
                <thead><tr><th>{L("Status", "Status")}</th><th className={av.num}>{L("Assets", "Aset")}</th><th className={av.num}>{L("Share", "Bahagian")}</th><th className={av.num}>{L("Purchase value", "Nilai belian")}</th></tr></thead>
                <tbody>
                  {counts.map(([k, , n]) => (
                    <tr key={k}><td>{chip(k)}</td><td className={av.num}>{n}</td><td className={av.num}>{pct(n)}%</td>
                      <td className={av.num}>{rm(assets.filter((a) => a.status === k).reduce((s, a) => s + (a.purchase_price_cents ?? 0), 0))}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr><td>{L("Total", "Jumlah")}</td><td className={av.num}>{total}</td><td className={av.num}>{total > 0 ? "100%" : "0%"}</td><td className={av.num}>{rm(assets.reduce((s, a) => s + (a.purchase_price_cents ?? 0), 0))}</td></tr>
                  <tr><td colSpan={3}>{L("Active asset value (lost and disposed excluded)", "Nilai aset aktif (tidak termasuk hilang dan dilupuskan)")}</td><td className={av.num}>{rm(totalValue)}</td></tr></tfoot>
              </table>
            </div>
          )}
        </section>

        <div className={av.split2}>
          {([
            ["category", L("Valuation by Category", "Penilaian mengikut Kategori"), byCat] as const,
            ["location", L("Valuation by Location", "Penilaian mengikut Lokasi"), byLoc] as const,
          ]).map(([key, title, groups]) => (
            <section key={key} className={card} aria-label={title}>
              {head(key === "category" ? "package" : "place", av.goldWell, title, L("Active value: lost and disposed excluded.", "Nilai aktif: tidak termasuk hilang dan dilupuskan."))}
              {!loaded ? <SkelRows rows={4} /> : groups.length === 0 ? empty(L("No assets yet.", "Belum ada aset.")) : (
                <div className={`erp-table-scroll erp-mt-2 ${av.tableWrap}`}>
                  <table className={av.plain} aria-label={title}>
                    <thead><tr><th>{key === "category" ? L("Category", "Kategori") : L("Location", "Lokasi")}</th><th className={av.num}>{L("Assets", "Aset")}</th><th className={av.num}>{L("Active value", "Nilai aktif")}</th></tr></thead>
                    <tbody>
                      {[...groups].sort((a, b) => valueOf(b.list) - valueOf(a.list)).map((g) => (
                        <tr key={g.k}><td>{g.label}</td><td className={av.num}>{g.list.length}</td><td className={av.num}>{rm(valueOf(g.list))}</td></tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>{L("Total", "Jumlah")}</td><td className={av.num}>{total}</td><td className={av.num}>{rm(totalValue)}</td></tr></tfoot>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>

        <section className={card} aria-label={L("Warranty", "Waranti")}>
          {head("verify", av.blueWell, L("Warranty", "Waranti"), L("Active assets whose warranty date is past or within 90 days, from Warranty until.", "Aset aktif yang tarikh warantinya telah lepas atau dalam 90 hari, daripada Waranti sehingga."))}
          {!loaded ? <SkelRows rows={2} /> : warrantyExpired.length + warrantySoon.length === 0 ? empty(L("No warranty ending in the next 90 days.", "Tiada waranti tamat dalam 90 hari akan datang.")) : (
            <ul className={av.warranty}>
              {[...warrantySoon.map((a) => [a, false] as const), ...warrantyExpired.map((a) => [a, true] as const)].map(([a, past]) => (
                <li key={a.id}>{tagBtn(a)}<span>{a.name}</span>
                  <span className={past ? chipNeutral : chipWarn}>{past ? L(`ended ${dmy(a.warranty_until)}`, `tamat ${dmy(a.warranty_until)}`) : L(`ends ${dmy(a.warranty_until)}`, `tamat ${dmy(a.warranty_until)}`)}</span></li>
              ))}
            </ul>
          )}
        </section>

        <section id="asset-audit" className={card} aria-label={L("Audit log", "Log audit")}>
          {head("verify", av.goldWell, L("Audit Log", "Log Audit"), L("Every add, edit and removal on the register, as the system recorded it.", "Setiap penambahan, suntingan dan pembuangan pada daftar, seperti yang direkodkan sistem."))}
          {audit.state === "idle" || audit.state === "loading" ? <SkelRows rows={4} />
            : audit.state === "denied" ? <p className={av.empty}><AppIcon name="lock" />{L("The audit log is open to the CEO and admins. Ask one of them for an asset's history.", "Log audit terbuka kepada CEO dan pentadbir. Minta salah seorang daripada mereka untuk sejarah aset.")}</p>
            : audit.state === "error" ? <p className={av.empty}><AppIcon name="warning" />{L("The audit log could not be read just now — try again later.", "Log audit tidak dapat dibaca sekarang — cuba lagi kemudian.")}</p>
            : audit.entries.length === 0 ? empty(L("No asset changes recorded yet.", "Belum ada perubahan aset direkodkan."))
            : (
              <div className={`erp-table-scroll erp-mt-2 ${av.tableWrap}`}>
                <table className={av.plain} aria-label={L("Audit log", "Log audit")}>
                  <thead><tr><th>{L("When", "Bila")}</th><th>{L("Who", "Siapa")}</th><th>{L("Action", "Tindakan")}</th><th>{L("Asset", "Aset")}</th><th>{L("What", "Apa")}</th></tr></thead>
                  <tbody>
                    {audit.entries.map((r) => (
                      <tr key={r.id}>
                        <td className={av.nowrap}>{dmyMYT(r.created_at)}</td>
                        <td>{r.user_name ?? "—"}</td>
                        <td><span className={r.action === "asset.remove" ? chipDanger : r.action === "asset.create" ? chipSuccess : chipInfo}>{auditVerb(r.action)}</span></td>
                        <td className={av.mono}>{tagOf(r)}</td>
                        <td>{auditWhat(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>
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
                <select className={input} {...f("assigned_to")}>
                  <option value="">{L("— unassigned / shared —", "— tidak diberikan / kongsi —")}</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select></label>
              <label className="block"><span className={lbl}>{L("Location", "Lokasi")}</span>
                <input className={input} placeholder={L("e.g. Studio A, Store room", "cth. Studio A, Bilik stor")} {...f("location")} /></label>
              <label className="block"><span className={lbl}>{L("Status", "Status")}</span>
                <select className={input} {...f("status")}>{STATUSES.map(([v, l, ms]) => <option key={v} value={v}>{L(l, ms)}</option>)}</select></label>
              <label className="block"><span className={lbl}>{L("Condition note", "Nota keadaan")}</span>
                <input className={input} placeholder={L("e.g. scratch on left side", "cth. calar di sebelah kiri")} {...f("condition_note")} /></label>
            </div>
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
              {STATUSES.map(([v, l, ms]) => (
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
                {canEdit && <button type="button" className={btnSm} onClick={() => openStatusChange(a)}>{L("Change status", "Tukar status")}</button>}
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
                  <div><dt>{L("Recorded value", "Nilai direkodkan")}</dt><dd>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : L("No price recorded", "Tiada harga direkodkan")}</dd></div>
                  <div><dt>{L("Vendor", "Pembekal")}</dt><dd>{a.vendor ?? "—"}</dd></div>
                  <div><dt>{L("Warranty until", "Waranti sehingga")}</dt><dd>{a.warranty_until ? <>{dmy(a.warranty_until)} {warr === "ended" ? <span className={chipNeutral}>{L("ended", "tamat")}</span> : warr === "soon" ? <span className={chipWarn}>{L("ends within 90 days", "tamat dalam 90 hari")}</span> : null}</> : "—"}</dd></div>
                  <div><dt>{L("Status", "Status")}</dt><dd>{chip(a.status)}</dd></div>
                </dl>
                {a.condition_note && <p className={av.noteBox}>{a.condition_note}</p>}
                <p className={av.sub}>{L("The value is the purchase price as recorded; lost and disposed assets are not counted in the totals. No depreciation is calculated.", "Nilai ialah harga belian seperti direkodkan; aset hilang dan dilupuskan tidak dikira dalam jumlah. Tiada susut nilai dikira.")}</p>
              </section>
              <section className={av.detailSec} aria-label={L("Assignment", "Penugasan")}>
                <p className={av.title}>{L("Assignment", "Penugasan")}</p>
                <dl className={av.facts}>
                  <div><dt>{L("Assigned to", "Diberikan kepada")}</dt><dd>{a.assigned_name ? <span className={av.who}><Avatar name={a.assigned_name} size="sm" /><span>{a.assigned_name}</span></span> : L("Unassigned / shared", "Tidak diberikan / kongsi")}</dd></div>
                  <div><dt>{L("Location", "Lokasi")}</dt><dd>{a.location ?? noLocation()}</dd></div>
                </dl>
                {offList(a) && <p className={av.warnText}>{L("The holder is not on the current staff list — check whether the asset was returned.", "Pemegang tiada dalam senarai kakitangan semasa — semak sama ada aset telah dipulangkan.")}</p>}
              </section>
              <section className={av.detailSec} aria-label={L("History", "Sejarah")}>
                <p className={av.title}>{L("History", "Sejarah")}</p>
                {audit.state === "idle" ? <button type="button" className={btnSm} onClick={() => void loadAudit()}><AppIcon name="time" />{L("Show history", "Tunjuk sejarah")}</button>
                  : audit.state === "loading" ? <SkelRows rows={3} />
                  : audit.state === "denied" ? <p className={av.empty}><AppIcon name="lock" />{L("The audit log is open to the CEO and admins. Ask one of them for this asset's history.", "Log audit terbuka kepada CEO dan pentadbir. Minta salah seorang daripada mereka untuk sejarah aset ini.")}</p>
                  : audit.state === "error" ? <p className={av.empty}><AppIcon name="warning" />{L("The audit log could not be read just now.", "Log audit tidak dapat dibaca sekarang.")}</p>
                  : rows.length === 0 ? empty(L("No change recorded for this asset in the latest 300 audit entries.", "Tiada perubahan direkodkan untuk aset ini dalam 300 entri audit terkini."))
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
