"use client";

/* v1.4.213 (team feedback via CEO): company asset / equipment register.
   NEW file — nothing existing imported or altered; tokens copied from the
   approved design. Form is SECTIONED the way the CEO asked ("subhead and
   text placement box"): 🏷 Identification → 🧾 Purchase → 📍 Assignment &
   status. Assets are never deleted; status moves to lost/disposed. */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api"; // v1.23.1: raw fetch here missed the CSRF header — saves 403'd
import { useSaveToast } from "@/components/ui/save-toast";
import { card, th, td, thR2, tdR2 } from "@/lib/ui-styles";
import { rowBtn } from "@/components/ui/row-button";
import { Skel } from "@/components/ui/skeleton";
import { getLang } from "@/lib/i18n";

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
}
interface StaffLite { id: number; name: string; role?: string }

const CATS = [["electronics", "Electronics", "Elektronik"], ["furniture", "Furniture", "Perabot"], ["vehicle", "Vehicle", "Kenderaan"], ["studio", "Studio equipment", "Peralatan studio"], ["other", "Other", "Lain-lain"]] as const;
const STATUSES = [["in_use", "In use", "Sedang digunakan"], ["spare", "Spare", "Simpanan"], ["repair", "In repair", "Dalam pembaikan"], ["lost", "Lost", "Hilang"], ["disposed", "Disposed", "Dilupuskan"]] as const;
import { fmtRM as rm } from "@/lib/format"; // v1.4.272: the global formatter

const EMPTY = {
  asset_tag: "", name: "", category: "electronics", brand_model: "", serial_no: "",
  purchase_date: "", purchase_price: "", vendor: "", warranty_until: "",
  location: "", assigned_to: "", status: "in_use", condition_note: "",
};

const STATUS_CHIP: Record<string, string> = {
  in_use: "rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800",
  spare: "border-border rounded-full border px-2 py-0.5 text-[11px]",
  repair: "rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800",
  lost: "rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700",
  disposed: "text-muted-foreground rounded-full border border-border px-2 py-0.5 text-[11px] line-through",
};

export function AssetsPanel() {
  const [assets, setAssets] = useState<Asset[]>([]);
  type AssetCol = "tag" | "item" | "assigned" | "location" | "status" | "value";
  const [assetSort, setAssetSort] = useState<{ col: AssetCol; asc: boolean }>({ col: "tag", asc: true });
  const cycleAsset = (col: AssetCol) => setAssetSort(s => s.col === col ? { col, asc: !s.asc } : { col, asc: true });
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<number | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [msg, setMsg] = useState("");
  const { show: showToast, node: toastNode } = useSaveToast(); // v1.4.221 standard save popup
  /* v1.77.0 — true once the first register request settles (ok or not);
     until then the count chips and the table are skeletons, never
     "No assets yet". */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    void fetch("/api/v1/staff/assets", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setAssets((d as { assets: Asset[] }).assets ?? []))
      .catch(() => setMsg(L("Assets unavailable — deploy the worker first.", "Aset tidak tersedia — sila pasang worker dahulu.")))
      .finally(() => setLoaded(true));
    /* v1.21.0: assignment picker reads /staff-list — the one picker source
       (active staff only, full names) instead of the raw account list. */
    void fetch("/api/v1/staff/staff-list", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setStaff((d as { staff: StaffLite[] }).staff ?? []))
      .catch(() => setStaff([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const f = (k: keyof typeof EMPTY) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((d) => ({ ...d, [k]: e.target.value })),
  });

  const startEdit = (a: Asset) => {
    setEditId(a.id); setOpenForm(true);
    setForm({
      asset_tag: a.asset_tag, name: a.name, category: a.category,
      brand_model: a.brand_model ?? "", serial_no: a.serial_no ?? "",
      purchase_date: a.purchase_date ?? "", purchase_price: a.purchase_price_cents != null ? String(a.purchase_price_cents / 100) : "",
      vendor: a.vendor ?? "", warranty_until: a.warranty_until ?? "",
      location: a.location ?? "", assigned_to: a.assigned_to != null ? String(a.assigned_to) : "",
      status: a.status, condition_note: a.condition_note ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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

  const counts = STATUSES.map(([k, label, labelMs]) => [L(label, labelMs), assets.filter((a) => a.status === k).length] as const);
  const totalValue = assets.filter((a) => a.status !== "disposed" && a.status !== "lost")
    .reduce((s, a) => s + (a.purchase_price_cents ?? 0), 0);
  const sub = "text-muted-foreground mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide";
  const lbl = "text-muted-foreground mb-0.5 block text-[11px]";

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className={card}>
        <p className="text-sm font-semibold">{L("Company assets", "Aset syarikat")}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {L("Every piece of equipment the company owns — who holds it, where it lives, what it's worth. Assets are never deleted: mark them lost or disposed so the history stays.", "Setiap peralatan milik syarikat — siapa yang memegangnya, di mana ia berada, berapa nilainya. Aset tidak pernah dipadam: tandakan sebagai hilang atau dilupuskan supaya sejarahnya kekal.")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {/* v1.77.0 — skeleton until the first fetch lands: three count
              chips and the value chip, same height as the real pills. */}
          {!loaded && Array.from({ length: 4 }, (_, i) => <Skel key={i} className="h-5 w-20 rounded-full" />)}
          {loaded && counts.map(([label, n]) => n > 0 && <span key={label} className="border-border rounded-full border px-2 py-0.5">{label} <span className="font-semibold">{n}</span></span>)}
          {totalValue > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">{L("Value", "Nilai")} {rm(totalValue)}</span>}
        </div>
      </div>

      <div className={card}>
        <button type="button" className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium"
          onClick={() => { setOpenForm((v) => !v); if (openForm) { setEditId(null); setForm({ ...EMPTY }); } }}>
          {openForm ? (editId ? L("Cancel edit", "Batal sunting") : L("Hide form", "Sembunyi borang")) : L("+ New asset — show details", "+ Aset baharu — tunjuk butiran")}
        </button>
        {openForm && (
          <div className="mt-3">
            <p className={sub}>{L("🏷 Identification", "🏷 Pengenalan")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
            <p className={sub}>{L("🧾 Purchase", "🧾 Pembelian")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="block"><span className={lbl}>{L("Purchase date", "Tarikh pembelian")}</span>
                <input className={input} type="date" {...f("purchase_date")} /></label>
              <label className="block"><span className={lbl}>{L("Price (RM)", "Harga (RM)")}</span>
                <input className={input} inputMode="decimal" placeholder="0.00" {...f("purchase_price")} /></label>
              <label className="block"><span className={lbl}>{L("Vendor", "Pembekal")}</span>
                <input className={input} placeholder={L("e.g. Shopee, Machines", "cth. Shopee, Machines")} {...f("vendor")} /></label>
              <label className="block"><span className={lbl}>{L("Warranty until", "Waranti sehingga")}</span>
                <input className={input} type="date" {...f("warranty_until")} /></label>
            </div>
            <p className={sub}>{L("📍 Assignment & status", "📍 Penugasan & status")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            <button type="button" className="bg-primary text-primary-foreground mt-3 rounded-lg px-4 py-2 text-sm font-medium" onClick={() => void save()}>
              {editId ? L("Save changes", "Simpan perubahan") : L("Add asset", "Tambah aset")}
            </button>
          </div>
        )}
        {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}
        {toastNode}
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">{L("Register", "Daftar")}</p>
        {/* v1.77.0 — skeleton until the first fetch lands: the real header
            row over shimmering cells, same seven columns as the register. */}
        {!loaded ? (
          <div className="tbl-sticky -mx-1 mt-2 max-h-96 overflow-auto px-1" aria-hidden>
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
          <p className="text-muted-foreground mt-2 text-sm">{L("No assets yet — add the first one above.", "Belum ada aset — tambah yang pertama di atas.")}</p>
        ) : (
          <div className="tbl-sticky -mx-1 mt-2 max-h-96 overflow-auto px-1">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-border text-left">
                  {([
                    ["tag", L("TAG", "TAG"), th],
                    ["item", L("ITEM", "BARANG"), th],
                    ["assigned", L("ASSIGNED", "DIBERIKAN"), th],
                    ["location", L("LOCATION", "LOKASI"), th],
                    ["status", L("STATUS", "STATUS"), th],
                    ["value", L("VALUE", "NILAI"), thR2]
                  ] as [AssetCol, string, string][]).map(([col, label, cls]) => (
                    <th key={col} className={`${cls} cursor-pointer select-none whitespace-nowrap`}
                      title={L(`Sort by ${label} — click again to reverse`, `Isih mengikut ${label} — klik lagi untuk terbalikkan`)}
                      onClick={() => cycleAsset(col)}>
                      {label}{assetSort.col === col ? (assetSort.asc ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody>
                {[...assets].sort((a, b) => {
                  const dir = assetSort.asc ? 1 : -1;
                  switch (assetSort.col) {
                    case "tag": return dir * a.asset_tag.localeCompare(b.asset_tag);
                    case "item": return dir * a.name.localeCompare(b.name);
                    case "assigned": return dir * (a.assigned_name || "").localeCompare(b.assigned_name || "");
                    case "location": return dir * (a.location || "").localeCompare(b.location || "");
                    case "status": return dir * a.status.localeCompare(b.status);
                    case "value": return dir * ((a.purchase_price_cents ?? 0) - (b.purchase_price_cents ?? 0));
                    default: return 0;
                  }
                }).map((a) => (
                  <tr key={a.id} className="border-border border-t">
                    <td className={`${td} font-mono`}>{a.asset_tag}</td>
                    <td className={td}><span className="font-medium">{a.name}</span>
                      {a.brand_model && <span className="text-muted-foreground"> · {a.brand_model}</span>}
                      {a.condition_note && <div className="text-muted-foreground">{a.condition_note}</div>}</td>
                    <td className={td}>{a.assigned_name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className={td}>{a.location ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className={td}><span className={STATUS_CHIP[a.status] ?? STATUS_CHIP.spare}>{(() => { const st = STATUSES.find(([v]) => v === a.status); return st ? L(st[1], st[2]) : a.status; })()}</span></td>
                    <td className={tdR2}>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : "—"}</td>
                    <td className={td}><button type="button" className={rowBtn} onClick={() => startEdit(a)}>{L("Edit", "Sunting")}</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-border border-t-2 font-semibold">
                  <td className={td} colSpan={5}>{L("TOTAL — active asset value", "JUMLAH — nilai aset aktif")}</td>
                  <td className={tdR2}>{rm(totalValue)}</td>
                  <td className={td}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
