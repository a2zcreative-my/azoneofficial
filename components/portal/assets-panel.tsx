"use client";

/* v1.4.213 (team feedback via CEO): company asset / equipment register.
   NEW file — nothing existing imported or altered; tokens copied from the
   approved design. Form is SECTIONED the way the CEO asked ("subhead and
   text placement box"): 🏷 Identification → 🧾 Purchase → 📍 Assignment &
   status. Assets are never deleted; status moves to lost/disposed. */

import { useCallback, useEffect, useState } from "react";
import { useSaveToast } from "@/components/ui/save-toast";
import { card } from "@/lib/ui-styles";
import { rowBtn } from "@/components/ui/row-button";

const input = "border-border bg-background mt-0.5 h-8 w-full rounded-lg border px-2 text-sm";
const td = "px-2 py-1.5 align-top";

interface Asset {
  id: number; asset_tag: string; name: string; category: string;
  brand_model: string | null; serial_no: string | null;
  purchase_date: string | null; purchase_price_cents: number | null;
  vendor: string | null; warranty_until: string | null; location: string | null;
  assigned_to: number | null; assigned_name: string | null;
  status: string; condition_note: string | null;
}
interface StaffLite { id: number; name: string; is_active: number; role: string }

const CATS = [["electronics", "Electronics"], ["furniture", "Furniture"], ["vehicle", "Vehicle"], ["studio", "Studio equipment"], ["other", "Other"]] as const;
const STATUSES = [["in_use", "In use"], ["spare", "Spare"], ["repair", "In repair"], ["lost", "Lost"], ["disposed", "Disposed"]] as const;
const rm = (c: number) => `RM ${(c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<number | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [msg, setMsg] = useState("");
  const { show: showToast, node: toastNode } = useSaveToast(); // v1.4.221 standard save popup

  const load = useCallback(() => {
    void fetch("/api/v1/staff/assets", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setAssets((d as { assets: Asset[] }).assets ?? []))
      .catch(() => setMsg("Assets unavailable — deploy the worker first."));
    void fetch("/api/v1/staff/users", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setStaff(((d as { users: StaffLite[] }).users ?? []).filter((u) => u.is_active === 1 && u.role !== "customer")))
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
    const res = editId
      ? await fetch(`/api/v1/staff/assets/${editId}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body })
      : await fetch("/api/v1/staff/assets", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body });
    if (res.ok) {
      showToast(editId ? "Asset updated" : "Asset added", editId ? "Changes saved to the register" : "New asset in the register");
      setForm({ ...EMPTY }); setEditId(null); setOpenForm(false); load();
    } else {
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      showToast("Save failed", j?.error?.message ?? "Please try again", "notice");
    }
  };

  const counts = STATUSES.map(([k, label]) => [label, assets.filter((a) => a.status === k).length] as const);
  const totalValue = assets.filter((a) => a.status !== "disposed" && a.status !== "lost")
    .reduce((s, a) => s + (a.purchase_price_cents ?? 0), 0);
  const sub = "text-muted-foreground mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide";
  const lbl = "text-muted-foreground mb-0.5 block text-[11px]";

  return (
    <div className="grid gap-4">
      <div className={card}>
        <p className="text-sm font-semibold">Company assets</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Every piece of equipment the company owns — who holds it, where it lives, what it&apos;s worth. Assets are never
          deleted: mark them lost or disposed so the history stays.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {counts.map(([label, n]) => n > 0 && <span key={label} className="border-border rounded-full border px-2 py-0.5">{label} <span className="font-semibold">{n}</span></span>)}
          {totalValue > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-800">Value {rm(totalValue)}</span>}
        </div>
      </div>

      <div className={card}>
        <button type="button" className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm font-medium"
          onClick={() => { setOpenForm((v) => !v); if (openForm) { setEditId(null); setForm({ ...EMPTY }); } }}>
          {openForm ? (editId ? "Cancel edit" : "Hide form") : "+ New asset — show details"}
        </button>
        {openForm && (
          <div className="mt-3">
            <p className={sub}>🏷 Identification</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <label className="block"><span className={lbl}>Asset tag</span>
                <input className={input} placeholder="blank = auto (AZOA-001)" disabled={editId !== null} {...f("asset_tag")} /></label>
              <label className="block"><span className={lbl}>Asset name *</span>
                <input className={input} placeholder="e.g. Ring light 18&quot;" {...f("name")} /></label>
              <label className="block"><span className={lbl}>Category</span>
                <select className={input} {...f("category")}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="block"><span className={lbl}>Brand &amp; model</span>
                <input className={input} placeholder="e.g. Godox SL-60W" {...f("brand_model")} /></label>
              <label className="block"><span className={lbl}>Serial no.</span>
                <input className={input} placeholder="from the sticker" {...f("serial_no")} /></label>
            </div>
            <p className={sub}>🧾 Purchase</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="block"><span className={lbl}>Purchase date</span>
                <input className={input} type="date" {...f("purchase_date")} /></label>
              <label className="block"><span className={lbl}>Price (RM)</span>
                <input className={input} inputMode="decimal" placeholder="0.00" {...f("purchase_price")} /></label>
              <label className="block"><span className={lbl}>Vendor</span>
                <input className={input} placeholder="e.g. Shopee, Machines" {...f("vendor")} /></label>
              <label className="block"><span className={lbl}>Warranty until</span>
                <input className={input} type="date" {...f("warranty_until")} /></label>
            </div>
            <p className={sub}>📍 Assignment &amp; status</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="block"><span className={lbl}>Assigned to</span>
                <select className={input} {...f("assigned_to")}>
                  <option value="">— unassigned / shared —</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select></label>
              <label className="block"><span className={lbl}>Location</span>
                <input className={input} placeholder="e.g. Studio A, Store room" {...f("location")} /></label>
              <label className="block"><span className={lbl}>Status</span>
                <select className={input} {...f("status")}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="block"><span className={lbl}>Condition note</span>
                <input className={input} placeholder="e.g. scratch on left side" {...f("condition_note")} /></label>
            </div>
            <button type="button" className="bg-primary text-primary-foreground mt-3 rounded-lg px-4 py-2 text-sm font-medium" onClick={() => void save()}>
              {editId ? "Save changes" : "Add asset"}
            </button>
          </div>
        )}
        {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}
        {toastNode}
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">Register</p>
        {assets.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">No assets yet — add the first one above.</p>
        ) : (
          <div className="tbl-sticky -mx-1 mt-2 max-h-96 overflow-auto px-1">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className={td}>TAG</th><th className={td}>ITEM</th><th className={td}>ASSIGNED</th>
                  <th className={td}>LOCATION</th><th className={td}>STATUS</th>
                  <th className={`${td} text-right`}>VALUE</th><th className={td}></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className="border-border border-t">
                    <td className={`${td} font-mono`}>{a.asset_tag}</td>
                    <td className={td}><span className="font-medium">{a.name}</span>
                      {a.brand_model && <span className="text-muted-foreground"> · {a.brand_model}</span>}
                      {a.condition_note && <div className="text-muted-foreground">{a.condition_note}</div>}</td>
                    <td className={td}>{a.assigned_name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className={td}>{a.location ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className={td}><span className={STATUS_CHIP[a.status] ?? STATUS_CHIP.spare}>{STATUSES.find(([v]) => v === a.status)?.[1] ?? a.status}</span></td>
                    <td className={`${td} text-right tabular-nums`}>{a.purchase_price_cents != null ? rm(a.purchase_price_cents) : "—"}</td>
                    <td className={td}><button type="button" className={rowBtn} onClick={() => startEdit(a)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-border border-t-2 font-semibold">
                  <td className={td} colSpan={5}>TOTAL — active asset value</td>
                  <td className={`${td} text-right tabular-nums`}>{rm(totalValue)}</td>
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
