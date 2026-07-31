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

import { useCallback, useEffect, useState } from "react";

const API = "/api/v1/staff";

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
    return { ok: res.ok, status: res.status, data: (res.status === 204 ? null : await res.json()) as T | null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const card = "rounded-lg border border-border bg-card p-4";
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
  birthday?: string | null;
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
    html,body{margin:0;padding:0}
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
  const [staff, setStaff] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<Record<number, Partial<Staff>>>({});
  const [saved, setSaved] = useState<number | null>(null);
  const [newStaff, setNewStaff] = useState({
    email: "", name: "", role: "sales_marketing",
    employee_id: "", position: "", department: "", password: "",
  });
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [existing, setExisting] = useState<Staff | null>(null);

  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const load = useCallback(async () => {
    const res = await api<{ users?: Staff[], staff?: Staff[] }>(`/users`);
    if (res.ok && res.data) {
      const list = res.data.users ?? res.data.staff ?? [];
      setAllStaff(list);
      setStaff(list.filter((u) => u.role !== "customer"));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const [error, setError] = useState<number | null>(null);
  const save = async (id: number) => {
    const d = draft[id];
    if (!d || Object.keys(d).length === 0) return;
    setError(null);
    const res = await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(d) });
    if (res.ok) {
      setSaved(id);
      setDraft((s) => ({ ...s, [id]: {} }));
      window.setTimeout(() => setSaved(null), 3000);
      void load();
    } else {
      setError(id);
    }
  };

  const set = (id: number, key: keyof Staff, value: string) =>
    setDraft((s) => ({ ...s, [id]: { ...s[id], [key]: value } }));
  const val = (u: Staff, key: keyof Staff) =>
    (draft[u.id]?.[key] as string) ?? (u[key] as string) ?? "";

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-2.5">
        <p className="text-sm font-medium">Staff directory &amp; ID badges</p>
        <p className="text-muted-foreground text-xs">
          Set employee ID, position, department and badge details, then print a
          government-size ID card (85.6 × 54 mm).
        </p>
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">Add a staff member</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Company emails (@azoneofficial.com) aren&apos;t Google accounts, so
          staff can&apos;t self-register — create the account here with a
          temporary password and hand it over. They change it on first sign-in.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input className={input} placeholder="name@azoneofficial.com" value={newStaff.email}
            onChange={(e) => { setExisting(null); setNewStaff((d) => ({ ...d, email: e.target.value })); }} />
          <input className={input} placeholder="Full name" value={newStaff.name}
            onChange={(e) => setNewStaff((d) => ({ ...d, name: e.target.value }))} />
          <select className={input} value={newStaff.role}
            onChange={(e) => setNewStaff((d) => ({ ...d, role: e.target.value }))}>
            {["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"].map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
            ))}
          </select>
          <input className={input} placeholder="Employee ID (optional)" value={newStaff.employee_id}
            onChange={(e) => setNewStaff((d) => ({ ...d, employee_id: e.target.value }))} />
          <input className={input} placeholder="Position (optional)" value={newStaff.position}
            onChange={(e) => setNewStaff((d) => ({ ...d, position: e.target.value }))} />
          <input className={input} placeholder="Department (optional)" value={newStaff.department}
            onChange={(e) => setNewStaff((d) => ({ ...d, department: e.target.value }))} />
          <input className={input} type="text" placeholder="Temp password (10+ chars)" value={newStaff.password}
            onChange={(e) => setNewStaff((d) => ({ ...d, password: e.target.value }))} />
        </div>
        {createMsg && <p className={`mt-2 text-xs font-medium ${createMsg.ok ? "text-green-700" : "text-destructive"}`}>{createMsg.text}</p>}
        {existing && (
          <button
            type="button"
            className="border-border mt-2 inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            onClick={async () => {
              // Apply the filled-in employee fields to the existing record.
              // Deliberately NOT applied from this path: role and password —
              // those stay with their proper flows (/admin for roles, the
              // user's own change-password or admin reset for passwords).
              const patch: Record<string, string> = {};
              if (newStaff.employee_id.trim()) patch.employee_id = newStaff.employee_id.trim();
              if (newStaff.position.trim()) patch.position = newStaff.position.trim();
              if (newStaff.department.trim()) patch.department = newStaff.department.trim();
              if (Object.keys(patch).length === 0) {
                setCreateMsg({ ok: false, text: "Fill in employee ID, position or department to update the record." });
                return;
              }
              const res = await api(`/users/${existing.id}`, { method: "PATCH", body: JSON.stringify(patch) });
              if (res.ok) {
                setCreateMsg({ ok: true, text: `${existing.name}'s record updated.` });
                setExisting(null);
                setNewStaff({ email: "", name: "", role: "sales_marketing", employee_id: "", position: "", department: "", password: "" });
                void load();
              } else {
                setCreateMsg({ ok: false, text: "Update failed — check access." });
              }
            }}
          >
            Update {existing.name}&apos;s record instead
          </button>
        )}
        <button type="button" className={`${btn} bg-primary text-primary-foreground hover:bg-primary/85 mt-3 disabled:opacity-50`}
          disabled={!newStaff.email.trim() || !newStaff.name.trim() || newStaff.password.length < 10}
          onClick={async () => {
            setCreateMsg(null);
            const res = await api<{ error?: { message?: string } }>(`/users`, {
              method: "POST",
              body: JSON.stringify(newStaff),
            });
            if (res.ok) {
              setCreateMsg({ ok: true, text: `${newStaff.name} added.` });
              setNewStaff({ email: "", name: "", role: "sales_marketing", employee_id: "", position: "", department: "", password: "" });
              setExisting(null);
              void load();
            } else if (res.status === 409) {
              // The email already has an account — offer to update that record
              // instead of dead-ending on the error.
              const match = allStaff.find(
                (u) => u.email.toLowerCase() === newStaff.email.toLowerCase().trim(),
              );
              if (match && match.role !== "customer") {
                setExisting(match);
                setCreateMsg({
                  ok: false,
                  text: `${match.name} already has an account (${match.role.replace(/_/g, " ")}).`,
                });
              } else if (match) {
                setExisting(null);
                setCreateMsg({
                  ok: false,
                  text: "This email belongs to a customer account — an admin can adjust it in /admin → Users.",
                });
              } else {
                setExisting(null);
                setCreateMsg({ ok: false, text: "A user with this email already exists." });
              }
            } else {
              setExisting(null);
              setCreateMsg({ ok: false, text: res.data?.error?.message ?? "Could not add — check the fields." });
            }
          }}>
          Create staff account
        </button>
      </div>

      {staff.map((u) => (
        <div key={u.id} className={card}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {u.name} <span className="text-muted-foreground">· {u.role.replace(/_/g, " ")}</span>
            </span>
            <span className="flex items-center gap-2">
              {saved === u.id && <span className="text-xs font-medium text-green-700">Saved ✓</span>}
              {error === u.id && <span className="text-destructive text-xs font-medium">Save failed — check access</span>}
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
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ["employee_id", "Employee ID"],
              ["position", "Position"],
              ["department", "Department"],
              ["birthday", "Birth date (YYYY-MM-DD)"],
              ["id_issued_on", "ID issued (YYYY-MM-DD)"],
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
