"use client";

/**
 * Staff directory for /admin (v1.4.15).
 *
 * Two jobs the business asked for:
 *  1. Admin sets employee_id / position / department (and badge extras).
 *  2. Admin generates a printable ID badge at government card size
 *     (85.6 × 54 mm — the ISO/IEC 7810 ID-1 format used by MyKad etc.).
 *
 * The badge prints from the browser: "Print badge" opens a print window sized
 * to the card, so it comes out at true dimensions on a normal printer.
 */

import { makeApi } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
const api = makeApi("/staff");
import { useCallback, useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";
import { useSaveToast } from "@/components/ui/save-toast";



const input = "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const btn = "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium transition-colors";

interface Staff {
  id: number;
  name: string;
  email: string;
  role: string;
  employee_id?: string | null;
  position?: string | null;
  department?: string | null;
  id_issued_on?: string | null;
  blood_type?: string | null;
  is_active: number;
}

function printBadge(s: Staff) {
  const w = window.open("", "_blank", "width=420,height=280");
  if (!w) return;
  const field = (label: string, value: string) =>
    `<div style="margin-top:2px"><span style="font-size:6px;letter-spacing:.06em;text-transform:uppercase;color:#8a93a6">${label}</span><br/><span style="font-size:9px;font-weight:600;color:#1a2946">${value || "—"}</span></div>`;
  // ID-1: 85.6mm × 54mm.
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Badge — ${s.name}</title>
  <style>
    @page { size: 85.6mm 54mm; margin: 0; }
    html,body{margin:0;padding:0;-webkit-print-color-adjust: exact; print-color-adjust: exact;} /* v1.4.239 */
    .card{width:85.6mm;height:54mm;box-sizing:border-box;padding:5mm;
      font-family:Arial,Helvetica,sans-serif;color:#1a2946;
      background:linear-gradient(135deg,#fff 60%,#f4f6fb);position:relative;
      border:0.3mm solid #1a2946}
    .brand{font-size:11px;font-weight:800;letter-spacing:.02em}
    .brand small{display:block;font-size:6px;font-weight:600;letter-spacing:.35em;color:#b8912f}
    .role{position:absolute;top:5mm;right:5mm;font-size:7px;font-weight:700;
      text-transform:uppercase;background:#1a2946;color:#fff;padding:2px 5px;border-radius:3px}
    .name{margin-top:6mm;font-size:13px;font-weight:800}
    .grid{display:flex;gap:6mm;margin-top:1mm}
    .foot{position:absolute;bottom:3mm;left:5mm;right:5mm;font-size:5.5px;
      color:#8a93a6;border-top:0.2mm solid #dfe3ec;padding-top:1mm}
  </style></head><body onload="window.print()">
  <div class="card">
    <div class="brand">AZ ONE OFFICIAL<small>STAFF</small></div>
    <div class="role">${s.role.replace(/_/g, " ")}</div>
    <div class="name">${s.name}</div>
    <div class="grid">
      ${field("Employee ID", s.employee_id ?? "")}
      ${field("Position", s.position ?? "")}
    </div>
    <div class="grid">
      ${field("Department", s.department ?? "")}
      ${field("Blood", s.blood_type ?? "")}
    </div>
    <div class="foot">SSM 202603168673 (JM1046169-H) · Issued ${s.id_issued_on ?? "—"} · azoneofficial.com</div>
  </div></body></html>`);
  w.document.close();
}

export function StaffDirectory() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<Record<number, Partial<Staff>>>({});
  const [saved, setSaved] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ users?: Staff[], staff?: Staff[] }>(`/users`);
    if (res.ok && res.data) {
      const list = res.data.users ?? res.data.staff ?? [];
      setStaff(list.filter((u) => u.role !== "customer"));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (id: number) => {
    const d = draft[id];
    if (!d) return;
    const res = await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(d) });
    if (res.ok) {
      setSaved(id);
      setDraft((s) => ({ ...s, [id]: {} }));
      window.setTimeout(() => setSaved(null), 3000);
      showToast("Saved", "Staff record updated");
      void load();
    } else {
      // v1.4.255: a failed save used to do NOTHING — no message, no toast,
      // the edit simply stayed on screen looking unsaved-but-fine.
      showToast("No changes", "Could not save that record — try again", "notice");
    }
  };

  const set = (id: number, key: keyof Staff, value: string) =>
    setDraft((s) => ({ ...s, [id]: { ...s[id], [key]: value } }));
  const val = (u: Staff, key: keyof Staff) =>
    (draft[u.id]?.[key] as string) ?? (u[key] as string) ?? "";

  return (
    <div className="space-y-3">
      {toastNode}
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-2.5">
        <p className="text-sm font-medium">Staff directory &amp; ID badges</p>
        <p className="text-muted-foreground text-xs">
          Set employee ID, position, department and badge details, then print a
          government-size ID card (85.6 × 54 mm).
        </p>
      </div>
      {staff.map((u) => (
        <div key={u.id} className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {u.name} <span className="text-muted-foreground">· {u.role.replace(/_/g, " ")}</span>
            </span>
            <span className="flex items-center gap-2">
              {saved === u.id && <span className="text-xs font-medium text-green-700">Saved ✓</span>}
              <button
                type="button"
                className={`${btn} bg-primary text-primary-foreground hover:bg-primary/85`}
                onClick={() => void save(u.id)}
              >
                Save
              </button>
              <button
                type="button"
                className={`${btn} border-border border hover:bg-secondary`}
                onClick={() => printBadge({ ...u, ...draft[u.id] })}
              >
                Print badge
              </button>
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {([
              ["employee_id", "Employee ID"],
              ["position", "Position"],
              ["department", "Department"],
              ["id_issued_on", "Issued (YYYY-MM-DD)"],
              ["blood_type", "Blood type"],
            ] as [keyof Staff, string][]).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-muted-foreground mb-0.5 block text-[11px]">{label}</span>
                <input className={input} value={val(u, key)} onChange={(e) => set(u.id, key, e.target.value)} />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
