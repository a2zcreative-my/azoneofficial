/* v1.189.0 - what the Users tabs share: the account and event shapes, the
   names a role and a status are written with, and the MYT stamp. Moved out of
   users-panel.tsx verbatim so the page and its overview read ONE definition;
   nothing about an account, a role or a time changed. */
import { L } from "@/components/portal/page-shared";

/** v1.4.153: audit timestamps arrive as UTC "YYYY-MM-DD HH:MM:SS" - show MYT. */
export function mytStamp2(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  const m = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(m.getUTCDate())}-${p(m.getUTCMonth() + 1)}-${m.getUTCFullYear()} ${p(m.getUTCHours())}:${p(m.getUTCMinutes())} MYT`;
}

export interface Account {
  id: number;
  name: string;
  full_name?: string | null;
  email: string;
  role: string;
  employment_status?: string | null;
  is_active: number;
  left_on?: string | null;
  rejoined_on?: string | null;
  totp_enabled?: number;
  photo_key?: string | null;
}

export interface AuthEvent { action: string; created_at: string; name?: string | null; email?: string | null }

/* v1.137.0 - `capitalize` title-cased every word, so the CEO's own chip read
   "Ceo" and the HR account read "Hr Admin". A role is a name, not a sentence:
   the acronyms are spelled, and everything else gets one capital. */
const ROLE_LABEL: Record<string, string> = {
  ceo: "CEO", coo: "COO", cco: "CCO", hr_admin: "HR Admin",
  sales_marketing: "Sales & Marketing", live_host: "Live Host",
  editor: "Editor", marketing: "Marketing", customer: "Customer",
  admin: "Admin", super_admin: "Super Admin",
};
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r.replace(/_/g, " ");
export const statusLabel = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A sign-in event as a person would say it, and the chip tone it wears. */
export function eventLabel(action: string): string {
  const a = action.replace("auth.", "");
  if (a === "login") return L("Password", "Kata laluan");
  if (a === "login_2fa") return L("Password + 2FA", "Kata laluan + 2FA");
  if (a === "login_google") return "Google";
  if (a === "2fa_challenge") return L("2FA check", "Semakan 2FA");
  if (a === "2fa_backup_used") return L("Backup code used", "Kod sandaran digunakan");
  if (a === "2fa_enabled") return L("2FA switched on", "2FA dihidupkan");
  if (a === "2fa_disabled") return L("2FA switched off", "2FA dimatikan");
  return a.replace(/_/g, " ");
}
export type EventTone = "success" | "info" | "warn" | "neutral";
export function eventTone(action: string): EventTone {
  if (action.includes("2fa_enabled")) return "success";
  if (action.includes("2fa_disabled") || action.includes("backup")) return "warn";
  if (action.includes("2fa")) return "info";
  if (action.includes("password")) return "warn";
  return "neutral";
}
export const isSignIn = (action: string) => /^auth\.login/.test(action);
