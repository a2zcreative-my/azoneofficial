"use client";

import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";

/* v1.88.2 (CEO: "on /admin the UI/UX should same width as /portal. same goes
   to other. everything must follow like /portal UI/UX") — this page had NO
   shell at all: a bare centred column on the page background, no navy rail,
   no canvas, and its own max-w-6xl cap. Reached from the admin console, it
   looked like leaving the product. It sits in the same shell now, full
   width, with a way back. The matrix itself is untouched. */
export default function PermissionsPage() {
  const ROLES = ["super_admin", "admin", "editor", "marketing", "live_host", "live_host_part_time", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"];
  
  const PERMISSIONS = [
    { id: "staff_read", label: "View Staff" },
    { id: "staff_write", label: "Edit Staff" },
    { id: "audit_read", label: "View Audit Logs" },
    { id: "roles_manage", label: "Manage Roles" },
    { id: "payroll_manage", label: "Manage Payroll" },
    { id: "payroll_view", label: "View Payroll" },
    { id: "inventory_read", label: "View Inventory" },
    { id: "inventory_write", label: "Edit Inventory" },
    { id: "claims_manage", label: "Manage Claims" },
    { id: "sales_manage", label: "Manage Sales" },
    { id: "enquiry_manage", label: "Manage Enquiries" },
    { id: "sync_manage", label: "Manage Integrations" },
  ];

  return (
    <AppShell
      rail={
        <div className="flex h-full flex-col items-center gap-1 py-3">
          <Link href="/admin" className="mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/90 text-xs font-bold text-slate-900" title="Back to the admin console">A</Link>
          <Link href="/admin" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:bg-white/20" title="Admin console" aria-label="Admin console">←</Link>
        </div>
      }
    >
    <div className="w-full px-4 py-4 pb-28 md:px-6 md:py-6 md:pb-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Permission Matrix</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            A read-only overview of which roles have access to which actions across the platform.
          </p>
        </div>
        <Link href="/admin" className="border-border hover:bg-secondary rounded-lg border px-3 py-1.5 text-sm">← Admin console</Link>
      </div>
      
      <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="p-3 text-left font-medium text-muted-foreground">Permission</th>
              {ROLES.map((role) => (
                <th key={role} className="p-3 text-center font-medium capitalize text-muted-foreground min-w-[120px]">
                  {role.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {PERMISSIONS.map((perm) => (
              <tr key={perm.id} className="hover:bg-secondary/20 transition-colors">
                <td className="p-3 font-medium">{perm.label}</td>
                {ROLES.map((role) => {
                  // Simplified representation for visual matrix.
                  // The actual `can(role, perm)` is enforced server-side.
                  let hasPerm = false;
                  if (role === "super_admin" || role === "ceo") hasPerm = true;
                  else if (perm.id.includes("sales") && ["sales_marketing", "marketing", "editor"].includes(role)) hasPerm = true;
                  else if (perm.id.includes("payroll") && ["hr_admin", "admin", "coo", "cco"].includes(role)) hasPerm = true;
                  else if (perm.id.includes("staff") && ["hr_admin", "admin", "coo", "cco", "sales_marketing"].includes(role)) hasPerm = true;
                  else if (perm.id.includes("inventory") && ["editor", "marketing", "admin"].includes(role)) hasPerm = true;
                  else if (role === "admin" && perm.id !== "roles_manage") hasPerm = true;
                  else if (role === "coo" || role === "cco") hasPerm = true;
                  else if (role === "customer") hasPerm = false;
                  
                  return (
                    <td key={`${perm.id}-${role}`} className="p-3 text-center">
                      {hasPerm ? (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500/10 text-green-600">✓</span>
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-muted-foreground/50">-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </AppShell>
  );
}
