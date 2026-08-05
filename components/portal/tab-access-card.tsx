"use client";

/* v1.4.219 (CEO: "I want to have a users access control for CEO to
   assigned to the roles … which users need to access the tabs"): the
   manager card. Per tab, click role chips on/off and Save; "Reset to
   default" removes the override. Safety rails mirrored from the worker:
   Dashboard + Profile are not listed (always visible to everyone), and
   super_admin ignores overrides — shown as a locked ✓ so the CEO knows
   the escape hatch exists. Self-contained new file. */

import { useCallback, useEffect, useState } from "react";
import { useSaveToast } from "@/components/ui/save-toast";

const card = "rounded-lg border border-border bg-card p-3.5 md:p-4";

const TABS: { name: string; label: string; hint: string }[] = [
  { name: "Overview", label: "Overview", hint: "company monitor" },
  { name: "Announcements", label: "News", hint: "feed + publish" },
  { name: "HR", label: "HR", hint: "docs, leave admin" },
  { name: "Staff Details", label: "Staff", hint: "records + badges" },
  { name: "Attendance", label: "Attendance", hint: "" },
  { name: "Leave", label: "Leave", hint: "" },
  { name: "Tasks", label: "Tasks", hint: "" },
  { name: "Claims", label: "Claims", hint: "" },
  { name: "Payroll", label: "Payroll", hint: "salaries — keep tight" },
  { name: "Expenses", label: "Expenses", hint: "" },
  { name: "Sales", label: "Sales", hint: "CRM + documents" },
  { name: "Inventory", label: "Inventory", hint: "" },
  { name: "Ecommerce", label: "Ecommerce", hint: "TikTok cards" },
  { name: "Assets", label: "Assets", hint: "equipment register" },
  { name: "Birthdays", label: "Birthdays", hint: "" },
  { name: "Users", label: "Users", hint: "accounts — keep tight" },
];

const ROLES: [string, string][] = [
  ["admin", "admin"],
  ["ceo", "ceo"],
  ["coo", "coo"],
  ["cco", "cco"],
  ["hr_admin", "hr admin"],
  ["sales_marketing", "sales marketing"],
  ["marketing", "marketing"],
  ["editor", "editor"],
  ["live_host", "live host"],
];

/** Built-in defaults, mirrored from TAB_ROLES/SALES_ROLES in page.tsx so the
    card can show what "default" means. Keep in sync when defaults change. */
const DEFAULTS: Record<string, string[] | null> = {
  Overview: ["ceo", "coo", "cco", "admin"],
  Announcements: null,
  HR: ["hr_admin", "coo", "cco", "ceo", "admin"],
  "Staff Details": ["hr_admin", "coo", "cco", "ceo", "admin"],
  Attendance: null, Leave: null, Tasks: null,
  Claims: ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "editor", "marketing", "live_host", "admin"],
  Payroll: ["ceo", "coo", "admin"],
  Expenses: ["ceo", "coo", "admin"],
  Sales: ["ceo", "coo", "cco", "hr_admin", "sales_marketing", "admin"],
  Inventory: ["admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"],
  Ecommerce: null,
  Assets: ["hr_admin", "coo", "cco", "ceo", "admin"],
  Birthdays: ["ceo", "hr_admin", "coo", "cco", "admin"],
  Users: ["ceo", "coo"],
};

export function TabAccessCard() {
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  const [openTab, setOpenTab] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  /* v1.4.221 (CEO: "there is no save popup notification"): the standard
     v1.4.87 save toast — same popup as every other Save in the portal. */
  const { show: showToast, node: toastNode } = useSaveToast();

  const load = useCallback(() => {
    void fetch("/api/v1/staff/tabs/access", { credentials: "include" })
      .then(async (r) => (r.ok ? await r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setOverrides((d as { overrides: Record<string, string[]> }).overrides ?? {}))
      .catch(() => setMsg("Tab access needs the latest server — deploy the worker first."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const effective = (t: string): string[] | null =>
    Object.prototype.hasOwnProperty.call(overrides, t) ? overrides[t]! : (DEFAULTS[t] ?? null);

  const save = async (tab: string, roles: string[] | null) => {
    const res = await fetch("/api/v1/staff/tabs/access", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roles === null ? { tab, reset: true } : { tab, roles }),
    });
    if (res.ok) {
      const d = (await res.json()) as { overrides: Record<string, string[]> };
      setOverrides(d.overrides ?? {});
      setOpenTab(null);
      showToast(
        roles === null ? "Back to default" : "Access saved",
        roles === null ? `${tab} uses the built-in default again` : `${tab} — takes effect on each person's next refresh`,
      );
    } else showToast("Save failed", "Please try again", "notice");
  };

  return (
    <div className={card}>
      <p className="text-sm font-semibold">🔐 Tab access control</p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        Choose which roles see each tab. Everyone always keeps Dashboard and Profile (clock-in and payslips), and
        super_admin always sees every tab — the safety net if an assignment goes wrong. Changes apply on each
        person&apos;s next page refresh.
      </p>
      <div className="mt-3 space-y-1.5">
        {TABS.map(({ name, label, hint }) => {
          const eff = effective(name);
          const overridden = Object.prototype.hasOwnProperty.call(overrides, name);
          const isOpen = openTab === name;
          return (
            <div key={name} className="border-border rounded-lg border px-2.5 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs">
                  <span className="font-semibold">{label}</span>
                  {hint && <span className="text-muted-foreground"> · {hint}</span>}
                  {" "}
                  {overridden
                    ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">custom</span>
                    : <span className="text-muted-foreground text-[10px]">default</span>}
                  {" "}
                  <span className="text-muted-foreground">
                    — {eff === null ? "all staff" : eff.length === 0 ? "nobody (super_admin only)" : eff.map((r) => r.replace("_", " ")).join(", ")}
                  </span>
                </p>
                <span className="flex items-center gap-2">
                  {overridden && !isOpen && (
                    <button type="button" className="text-muted-foreground text-xs underline" onClick={() => void save(name, null)}>Reset to default</button>
                  )}
                  <button type="button" className="text-xs underline"
                    onClick={() => { setOpenTab(isOpen ? null : name); setDraft(eff === null ? ROLES.map(([r]) => r) : [...eff]); }}>
                    {isOpen ? "Close" : "Edit"}
                  </button>
                </span>
              </div>
              {isOpen && (
                <div className="mt-2">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-green-700 px-2 py-0.5 text-[11px] font-semibold text-green-700" title="Always on — the safety net">✓ super admin 🔒</span>
                    {ROLES.map(([r, labelR]) => {
                      const on = draft.includes(r);
                      return (
                        <button key={r} type="button"
                          className={on
                            ? "bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-[11px] font-medium"
                            : "border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[11px]"}
                          onClick={() => setDraft((d) => (on ? d.filter((x) => x !== r) : [...d, r]))}>
                          {on ? "✓ " : ""}{labelR}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <button type="button" className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium" onClick={() => void save(name, draft)}>Save</button>
                    <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setDraft(ROLES.map(([r]) => r))}>Select all</button>
                    <button type="button" className="text-muted-foreground text-xs underline" onClick={() => setDraft([])}>Clear</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}
      {toastNode}
    </div>
  );
}
