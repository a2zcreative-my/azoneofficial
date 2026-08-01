"use client";

/**
 * Staff directory & ID badges (v1.4.22).
 *
 *  - Live badge preview: the card renders on screen from the current values
 *    (updates as you type) before anything is printed.
 *  - Amendment lock: once a field is saved it greys out for HR — changing a
 *    set value is admin-only (/admin → Staff). Empty fields stay editable so
 *    HR can complete records. Enforced server-side too, not just visually.
 *  - Badge carries the AZ ONE OFFICIAL logo (not text), the staff full name
 *    and phone number. Blood type is retired from both the form and the card.
 */

import { useCallback, useEffect, useState } from "react";
import { PasswordInput } from "@/components/ui/password-input";

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
const input =
  "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:bg-secondary/60 disabled:text-muted-foreground disabled:cursor-not-allowed";
const btn = "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium transition-colors";

interface Staff {
  ic_number?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  joined_on?: string | null;
  id: number;
  name: string;
  full_name?: string | null;
  email: string;
  role: string;
  employee_id?: string | null;
  position?: string | null;
  department?: string | null;
  phone?: string | null;
  id_issued_on?: string | null;
  birthday?: string | null;
  blood_type?: string | null;
  photo_key?: string | null;
  is_active: number;
  employment_status?: string | null;
}

interface ErrShape { error?: { message?: string } }

/* ---------------- badge ---------------- */

/* Dates: the database stores ISO (YYYY-MM-DD) so sorting and payroll queries
   stay sane; people type and read DD-MM-YYYY. These two convert at the edge. */
function isoToDMY(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}
function dmyToISO(v: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}
const DATE_KEYS = ["birthday", "id_issued_on", "joined_on"] as const;

/** Malaysian banks — Maybank first (company primary bank). */
const MY_BANKS = [
  "Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank",
  "AmBank", "Bank Islam", "Bank Rakyat", "BSN", "Affin Bank",
  "Alliance Bank", "OCBC Bank", "HSBC Bank", "Standard Chartered", "UOB Malaysia",
];
const EMPLOYMENT_STATUSES = ["permanent", "contract", "part_time"];
const SELECT_FIELDS: Partial<Record<string, string[]>> = {
  bank_name: MY_BANKS,
  employment_status: EMPLOYMENT_STATUSES,
};

/** Company location shown on every badge — edit here if the office moves. */
const COMPANY_LOCATION = "Setia Tropika, Johor Bahru, Malaysia";

/** The one source of truth for what a badge shows. */
function badgeData(s: Staff) {
  return {
    name: (s.full_name?.trim() || s.name) ?? "",
    role: s.role.replace(/_/g, " "),
    employee_id: s.employee_id ?? "",
    position: s.position ?? "",
    department: s.department ?? "",
    phone: s.phone ?? "",
    ic: s.ic_number ?? "",
    joined: s.joined_on ? isoToDMY(s.joined_on) : "",
    issued: s.id_issued_on ? isoToDMY(s.id_issued_on) : "",
    photo: s.photo_key ? `/api/v1/media/file/${encodeURIComponent(s.photo_key)}` : "",
  };
}

/** On-screen live preview at true PORTRAIT card size (54 × 85.6 mm, ID-1 rotated). */
function BadgePreview({ s }: { s: Staff }) {
  // An iframe renders the EXACT print document in isolation — the badge CSS
  // cannot leak into the page, and page styles cannot distort the badge.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <iframe
      title="Badge preview"
      srcDoc={badgeDocHtml(s, origin)}
      style={{ width: "54mm", height: "85.6mm", border: "none", pointerEvents: "none", display: "block" }}
    />
  );
}

/** Print at true PORTRAIT dimensions — same layout as the preview. */
const BADGE_CSS = `
    html,body{margin:0;padding:0;background:transparent}
    .card{width:54mm;height:85.6mm;box-sizing:border-box;padding:3.5mm 4mm 3mm;
      font-family:Arial,Helvetica,sans-serif;color:#1a2946;
      background:#fff;overflow:hidden;border:0.3mm solid #1a2946;
      display:flex;flex-direction:column;align-items:stretch}
    .photo{width:20mm;height:24mm;margin:1.8mm auto 0;border:0.2mm solid #dfe3ec;
      background:#f4f6fb;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
    .photo img{width:100%;height:100%;object-fit:cover}
    .tagline{margin-top:0.8mm;text-align:center;font-size:4.4px;font-weight:700;
      letter-spacing:.3em;color:#b98a2e;text-transform:uppercase;flex:none}
    .rows{margin-top:2.4mm;text-align:left}
    .row{display:flex;align-items:baseline;padding:0.6mm 0}
    .row .k{flex:none;width:14.5mm;font-size:6.2px;font-weight:800;letter-spacing:.04em}
    .row .c{flex:none;width:2mm;font-size:7.2px;font-weight:600}
    .row .v{flex:1;font-size:7.2px;font-weight:600;line-height:1.25}
    .foot{margin-top:auto;padding-top:1mm;border-top:0.2mm solid #dfe3ec;
      display:flex;justify-content:space-between;align-items:flex-end;gap:2mm;
      font-size:4.8px;line-height:1.35;color:#8a93a6}
    .foot .left{text-align:left}
    .foot .right{text-align:right}
`;

function badgeCardHtml(s: Staff, origin: string): string {
  const d = badgeData(s);
  const logo = `${origin}/logo.png`;
  const photo = d.photo ? `${origin}${d.photo}` : "";
  const row = (label: string, value: string) =>
    `<div class="row"><span class="k">${label}</span><span class="c">:</span><span class="v">${value || "—"}</span></div>`;
  return `<div class="card">
    <img src="${logo}" alt="AZ ONE OFFICIAL" style="height:7mm;width:auto;align-self:center;flex:none"/>
    <div class="tagline">Live · Connect · Grow</div>
    <div class="photo">${photo ? `<img src="${photo}" alt="${d.name}"/>` : `<span style="font-size:6px;color:#8a93a6">PHOTO</span>`}</div>
    <div class="rows">
      ${row("NAME", d.name.toUpperCase())}
      ${row("EMP. NO", d.employee_id)}
      ${row("NRIC", d.ic)}
      ${row("DATE JOIN", d.joined)}
      ${row("DATE ISSUED", d.issued)}
      ${row("POSITION", (d.position || "").toUpperCase())}
      ${row("DEPARTMENT", (d.department || "").toUpperCase())}
    </div>
    <div class="foot">
      <span class="left">${COMPANY_LOCATION}</span>
      <span class="right">SSM 202603168673<br/>(JM1046169-H)</span>
    </div>
  </div>`;
}

/** Full standalone document for the card — used verbatim by the preview
    iframe and the print windows, so all three can never differ. */
function badgeDocHtml(s: Staff, origin: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BADGE_CSS}</style></head><body>${badgeCardHtml(s, origin)}</body></html>`;
}

function printBadge(s: Staff) {
  const w = window.open("", "_blank", "width=300,height=520");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Badge — ${s.full_name || s.name}</title>
  <style>@page { size: 54mm 85.6mm; margin: 0; }${BADGE_CSS}</style></head>
  <body onload="setTimeout(function(){window.print()},250)">
  ${badgeCardHtml(s, window.location.origin)}
  </body></html>`);
  w.document.close();
}

/** Multi-badge sheet (v1.4.43): several badges per A4 page — 3 × 3 = up to
    nine 54×85.6 mm cards per sheet, saving paper over one page per badge. */
function printBadges(list: Staff[]) {
  if (list.length === 0) return;
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  const origin = window.location.origin;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Badges — ${list.length} staff</title>
  <style>
    @page { size: A4; margin: 8mm; }
    ${BADGE_CSS}
    .sheet{display:flex;flex-wrap:wrap;gap:5mm}
    .sheet .card{page-break-inside:avoid}
  </style></head>
  <body onload="setTimeout(function(){window.print()},400)">
  <div class="sheet">
    ${list.map((s) => badgeCardHtml(s, origin)).join("")}
  </div></body></html>`);
  w.document.close();
}

/* ---------------- directory ---------------- */

const RECORD_FIELDS: [keyof Staff, string][] = [
  ["full_name", "Full name (as per IC)"],
  ["ic_number", "IC number (NRIC)"],
  ["phone", "Phone number"],
  ["employee_id", "Employee ID"],
  ["position", "Position"],
  ["department", "Department"],
  ["birthday", "Birth date (DD-MM-YYYY)"],
  ["id_issued_on", "ID issued (DD-MM-YYYY)"],
  ["blood_type", "Blood type (record only, not on badge)"],
  ["employment_status", "Employment status"],
  ["joined_on", "Joined on (DD-MM-YYYY)"],
  ["bank_name", "Bank (Malaysia)"],
  ["bank_account", "Bank account no."],
];

export function StaffDirectory({ canAmend = false, readOnly = false }: { canAmend?: boolean; readOnly?: boolean }) {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<Record<number, Partial<Staff>>>({});
  const [saved, setSaved] = useState<number | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const emptyNewStaff = {
    email: "", name: "", role: "sales_marketing",
    employee_id: "", position: "", department: "",
    birthday: "", id_issued_on: "", blood_type: "", password: "",
    bank_name: "", bank_account: "", ic_number: "",
  };
  const [newStaff, setNewStaff] = useState(emptyNewStaff);
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [existing, setExisting] = useState<Staff | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ users?: Staff[]; staff?: Staff[] }>(`/users`);
    if (res.ok && res.data) {
      const list = res.data.users ?? res.data.staff ?? [];
      setAllStaff(list);
          // Rank order: CEO, COO, CCO, Administrative (HR), Sales & Marketing,
    // then the remaining staff roles; same-rank sorts by name.
    const RANK: Record<string, number> = {
      ceo: 1, coo: 2, cco: 3, hr_admin: 4, sales_marketing: 5,
      admin: 6, editor: 7, marketing: 7, live_host: 7,
    };
    setStaff(
      list
        .filter((u) => u.role !== "customer" && u.role !== "super_admin")
        .sort((a, b) => (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9) || a.name.localeCompare(b.name)),
    );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (id: number) => {
    const d = draft[id];
    if (!d || Object.keys(d).length === 0) return;
    setRowMsg((m) => ({ ...m, [id]: "" }));
    // Dates were typed DD-MM-YYYY; store ISO.
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) {
      payload[k] = (DATE_KEYS as readonly string[]).includes(k) ? dmyToISO(String(v)) : String(v);
    }
    const res = await api<ErrShape>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    if (res.ok) {
      setSaved(id);
      setDraft((s) => ({ ...s, [id]: {} }));
      window.setTimeout(() => setSaved(null), 3000);
      void load();
    } else {
      setRowMsg((m) => ({ ...m, [id]: res.data?.error?.message ?? "Save failed — check access" }));
    }
  };

  const set = (id: number, key: keyof Staff, value: string) =>
    setDraft((s) => ({ ...s, [id]: { ...s[id], [key]: value } }));
  const val = (u: Staff, key: keyof Staff) => {
    const raw = (draft[u.id]?.[key] as string) ?? (u[key] as string) ?? "";
    return (DATE_KEYS as readonly string[]).includes(key as string) ? isoToDMY(raw) : raw;
  };
  /** A field locks for HR once its SAVED value is non-empty; admin can always edit. */
  const isLocked = (u: Staff, key: keyof Staff) =>
    readOnly || (!canAmend && Boolean(((u[key] as string) ?? "").trim()));

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-2.5">
        <p className="text-sm font-medium">Staff directory &amp; ID badges</p>
        <p className="text-muted-foreground text-xs">
          Fill each record (dates as DD-MM-YYYY), preview the badge live, then
          print the portrait card (54 × 85.6 mm). Saved fields lock — amendments
          are made by an admin in /admin → Staff.
        </p>
      </div>

      {!readOnly && (
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
          <input className={input} placeholder="Birth date DD-MM-YYYY (optional)" value={newStaff.birthday}
            onChange={(e) => setNewStaff((d) => ({ ...d, birthday: e.target.value }))} />
          <input className={input} placeholder="ID issued DD-MM-YYYY (optional)" value={newStaff.id_issued_on}
            onChange={(e) => setNewStaff((d) => ({ ...d, id_issued_on: e.target.value }))} />
          <input className={input} placeholder="Blood type (optional)" value={newStaff.blood_type}
            onChange={(e) => setNewStaff((d) => ({ ...d, blood_type: e.target.value }))} />
          <input className={input} placeholder="IC number / NRIC (optional)" value={newStaff.ic_number}
            onChange={(e) => setNewStaff((d) => ({ ...d, ic_number: e.target.value }))} />
          <select className={input} value={newStaff.bank_name}
            onChange={(e) => setNewStaff((d) => ({ ...d, bank_name: e.target.value }))}>
            <option value="">Bank (optional — Maybank is company primary)</option>
            {MY_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input className={input} placeholder="Bank account no. (optional)" value={newStaff.bank_account}
            onChange={(e) => setNewStaff((d) => ({ ...d, bank_account: e.target.value }))} />
          <PasswordInput className={input} placeholder="Temp password (10+ chars)" value={newStaff.password}
            onChange={(e) => setNewStaff((d) => ({ ...d, password: e.target.value }))} />
          <label className={`${input} flex cursor-pointer items-center justify-between`}>
            <span className={newPhoto ? "" : "text-muted-foreground"}>
              {newPhoto ? newPhoto.name : "Staff photo (optional)"}
            </span>
            <span className="text-muted-foreground text-xs underline">Browse</span>
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => setNewPhoto(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {createMsg && <p className={`mt-2 text-xs font-medium ${createMsg.ok ? "text-green-700" : "text-destructive"}`}>{createMsg.text}</p>}
        {existing && (
          <button
            type="button"
            className="border-border mt-2 inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            onClick={async () => {
              const patch: Record<string, string> = {};
              if (newStaff.employee_id.trim()) patch.employee_id = newStaff.employee_id.trim();
              if (newStaff.position.trim()) patch.position = newStaff.position.trim();
              if (newStaff.department.trim()) patch.department = newStaff.department.trim();
              if (Object.keys(patch).length === 0) {
                setCreateMsg({ ok: false, text: "Fill in employee ID, position or department to update the record." });
                return;
              }
              const res = await api<ErrShape>(`/users/${existing.id}`, { method: "PATCH", body: JSON.stringify(patch) });
              if (res.ok) {
                setCreateMsg({ ok: true, text: `${existing.name}'s record updated.` });
                setExisting(null);
                setNewStaff(emptyNewStaff);
                void load();
              } else {
                setCreateMsg({ ok: false, text: res.data?.error?.message ?? "Update failed — check access." });
              }
            }}
          >
            Update {existing.name}&apos;s record instead
          </button>
        )}
        <div>
          <button type="button" className={`${btn} bg-primary text-primary-foreground hover:bg-primary/85 mt-3 disabled:opacity-50`}
            disabled={!newStaff.email.trim() || !newStaff.name.trim() || newStaff.password.length < 10}
            onClick={async () => {
              setCreateMsg(null);
              const res = await api<ErrShape & { id?: number }>(`/users`, {
                method: "POST",
                body: JSON.stringify({
                  ...newStaff,
                  birthday: newStaff.birthday ? dmyToISO(newStaff.birthday) : "",
                  id_issued_on: newStaff.id_issued_on ? dmyToISO(newStaff.id_issued_on) : "",
                }),
              });
              if (res.ok) {
                // Photo chosen up front? Attach it to the account just created.
                let photoNote = "";
                if (newPhoto && res.data?.id) {
                  const up = await fetch(`${API}/users/${res.data.id}/photo`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": newPhoto.type || "image/jpeg" },
                    body: newPhoto,
                  });
                  photoNote = up.ok ? " Photo uploaded." : " (Photo upload failed — use Upload photo on the row.)";
                }
                setCreateMsg({ ok: true, text: `${newStaff.name} added.${photoNote}` });
                setNewStaff(emptyNewStaff);
                setNewPhoto(null);
                setExisting(null);
                void load();
              } else if (res.status === 409) {
                const match = allStaff.find(
                  (u) => u.email.toLowerCase() === newStaff.email.toLowerCase().trim(),
                );
                if (match && match.role !== "customer") {
                  setExisting(match);
                  setCreateMsg({ ok: false, text: `${match.name} already has an account (${match.role.replace(/_/g, " ")}).` });
                } else if (match) {
                  setExisting(null);
                  setCreateMsg({ ok: false, text: "This email belongs to a customer account — an admin can adjust it in /admin → Users." });
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
      </div>
      )}

      <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium disabled:opacity-50"
          disabled={selected.size === 0}
          onClick={() => printBadges(staff.filter((u) => selected.has(u.id)).map((u) => ({ ...u, ...draft[u.id] } as Staff)))}
        >
          Print selected badges ({selected.size}) — up to 9 per A4
        </button>
        <button
          type="button"
          className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs hover:bg-secondary"
          onClick={() => setSelected(selected.size === staff.length ? new Set() : new Set(staff.map((u) => u.id)))}
        >
          {selected.size === staff.length && staff.length > 0 ? "Clear selection" : "Select all"}
        </button>
        <span className="text-muted-foreground text-xs">Individual printing stays on each record.</span>
      </div>

      {staff.map((u) => {
        const merged = { ...u, ...draft[u.id] } as Staff;
        return (
          <div key={u.id} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#1a2946]"
                  checked={selected.has(u.id)}
                  onChange={() => toggleSelect(u.id)}
                  title="Select for multi-badge printing"
                />
                {u.name} <span className="text-muted-foreground">· {u.role.replace(/_/g, " ")}</span>
              </span>
              <span className="flex items-center gap-2">
                {saved === u.id && <span className="text-xs font-medium text-green-700">Saved ✓</span>}
                {rowMsg[u.id] && <span className="text-destructive text-xs font-medium">{rowMsg[u.id]}</span>}
                {!readOnly && (
                  <button
                    type="button"
                    className={`${btn} bg-primary text-primary-foreground hover:bg-primary/85`}
                    onClick={() => void save(u.id)}
                  >
                    Save
                  </button>
                )}
                <button
                  type="button"
                  className={`${btn} border-border border hover:bg-secondary`}
                  onClick={() => setPreview((p) => (p === u.id ? null : u.id))}
                >
                  {preview === u.id ? "Hide badge" : "Preview badge"}
                </button>
                <button
                  type="button"
                  className={`${btn} border-border border hover:bg-secondary`}
                  onClick={() => printBadge(merged)}
                >
                  Print badge
                </button>
                {!readOnly && (
                <label className={`${btn} border-border cursor-pointer border hover:bg-secondary`}>
                  {u.photo_key ? (canAmend ? "Replace photo" : "Photo set 🔒") : "Upload photo"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={Boolean(u.photo_key) && !canAmend}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setRowMsg((m) => ({ ...m, [u.id]: "" }));
                      const res = await fetch(`${API}/users/${u.id}/photo`, {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": file.type || "image/jpeg" },
                        body: file,
                      });
                      if (res.ok) {
                        setSaved(u.id);
                        window.setTimeout(() => setSaved(null), 3000);
                        void load();
                      } else {
                        const j = (await res.json().catch(() => null)) as ErrShape | null;
                        setRowMsg((m) => ({ ...m, [u.id]: j?.error?.message ?? "Photo upload failed" }));
                      }
                    }}
                  />
                </label>
                )}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {RECORD_FIELDS.map(([key, label]) => (
                <label key={key} className="block">
                  <span className="text-muted-foreground mb-0.5 block text-[11px]">
                    {label}
                    {isLocked(u, key) && <span className="ml-1">🔒</span>}
                  </span>
                  {SELECT_FIELDS[key as string] ? (
                    <select
                      className={input}
                      value={val(u, key)}
                      disabled={isLocked(u, key)}
                      title={isLocked(u, key) ? "Locked — amendments are made by an admin" : undefined}
                      onChange={(e) => set(u.id, key, e.target.value)}
                    >
                      <option value="">— select —</option>
                      {SELECT_FIELDS[key as string]!.map((o) => (
                        <option key={o} value={o}>{o.replace("_", " ")}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={input}
                      value={val(u, key)}
                      disabled={isLocked(u, key)}
                      title={isLocked(u, key) ? "Locked — amendments are made by an admin" : undefined}
                      onChange={(e) => set(u.id, key, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            {preview === u.id && (
              <div className="mt-3 overflow-x-auto">
                <p className="text-muted-foreground mb-2 text-xs">
                  Live preview — updates as you type. Print uses exactly this layout.
                </p>
                <BadgePreview s={merged} />
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
