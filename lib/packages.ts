/* SALES PACKAGES, the browser's half — v1.231.0 (worker/src/packages.ts).
   A package's lines are quotation lines (DocItem); applying one copies them
   into the Create form, which saves, previews and prints them as its own. */
import type { DocItem } from "@/lib/doc-template";

/** Who manages master packages - PERMS.packages_manage in the worker
    (tests/sales-packages.mjs holds the two equal). The server refuses
    everyone else whatever the screen shows. */
export const PACKAGE_MANAGE_ROLES: readonly string[] = ["super_admin", "ceo", "coo", "cco"];

export type PackageStatus = "draft" | "active" | "archived";

export interface PackageRow {
  id: number;
  name: string;
  category: string | null;
  description: string | null;
  kind: "service";
  issuers: ("a2z" | "azoo")[];
  status: PackageStatus;
  current_version: number;
  updated_at: string;
  updated_by_name: string | null;
  items: DocItem[];
  item_count: number;
  discount_cents: number;
  subtotal_cents: number;
  total_cents: number;
  used_by: number;
}

/** What a quotation in the form carries: the package and version it was
    filled from. The lines themselves live in the form's own state. */
export interface PackageRef { id: number; version: number; name: string }
