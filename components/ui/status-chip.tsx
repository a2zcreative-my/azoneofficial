"use client";

/* v1.276.0 - A2Z OS 3.0: ONE STATUS CHIP (claude/UIUX-3.0-BLUEPRINT.md,
   approved by the CEO 10-11-2026). The same business status uses the same
   word and the same colour wherever it appears: a payment that is reported
   is amber on Sales, on the Desk and on the phone. Each domain names its
   statuses once here; the chip is a word in its tone (colour is never
   the only signal). It only draws - the status comes from the server. An
   unknown status is shown in neutral grey with its own words, never hidden
   and never guessed into a colour. */

import { chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

export type ChipTone = "success" | "warning" | "danger" | "info" | "neutral";
type Entry = readonly [tone: ChipTone, en: string, ms: string];

export const STATUS_MAP = {
  /* money in: a report is not money until the CEO verifies it (1.272.0) */
  payment: {
    reported: ["warning", "Reported · waiting", "Dilapor · menunggu"],
    pending: ["warning", "Waiting for the CEO", "Menunggu CEO"],
    clarify: ["info", "Question asked", "Soalan ditanya"],
    verified: ["success", "Verified", "Disahkan"],
    rejected: ["danger", "Rejected", "Ditolak"],
    reversed: ["danger", "Reversed", "Dibatalkan"],
  },
  invoice: {
    unpaid: ["warning", "Unpaid", "Belum dibayar"],
    partially_paid: ["warning", "Partially paid", "Dibayar sebahagian"],
    paid: ["success", "Paid", "Dibayar"],
    overdue: ["danger", "Overdue", "Lewat"],
    void: ["neutral", "Void", "Batal"],
  },
  quotation: {
    draft: ["neutral", "Draft", "Draf"],
    sent: ["info", "Sent", "Dihantar"],
    accepted: ["success", "Accepted", "Diterima"],
    partly_invoiced: ["warning", "Partly invoiced", "Diinvois sebahagian"],
    invoiced: ["success", "Invoiced", "Diinvois"],
    expired: ["neutral", "Expired", "Tamat"],
    lost: ["neutral", "Lost", "Kalah"],
  },
  task: {
    open: ["neutral", "Open", "Dibuka"],
    in_progress: ["info", "In progress", "Sedang berjalan"],
    waiting_client: ["warning", "Waiting for client", "Menunggu pelanggan"],
    blocked: ["danger", "Blocked", "Tersekat"],
    ready_for_review: ["info", "Ready for review", "Sedia untuk semakan"],
    completed: ["success", "Closed", "Ditutup"],
    cancelled: ["neutral", "Cancelled", "Dibatalkan"],
  },
  /* leave and claims share the approval words; payment of a claim is its own */
  approval: {
    pending: ["warning", "Pending", "Menunggu"],
    returned: ["info", "Returned for information", "Dipulangkan"],
    approved: ["success", "Approved", "Diluluskan"],
    rejected: ["danger", "Rejected", "Ditolak"],
    withdrawn: ["neutral", "Withdrawn", "Ditarik balik"],
    cancelled: ["neutral", "Cancelled", "Dibatalkan"],
    paid: ["success", "Paid", "Dibayar"],
  },
  /* the six money stages of a commission line, the same words everywhere */
  commission: {
    estimated: ["neutral", "Estimated", "Anggaran"],
    pending: ["warning", "Pending", "Menunggu"],
    review: ["warning", "In review", "Dalam semakan"],
    eligible: ["info", "Eligible", "Layak"],
    included: ["info", "In payroll", "Dalam gaji"],
    paid: ["success", "Paid", "Dibayar"],
    reversed: ["danger", "Reversed", "Dibatalkan"],
  },
  account: {
    active: ["success", "Active", "Aktif"],
    suspended: ["danger", "Suspended", "Digantung"],
    left: ["neutral", "Left", "Telah berhenti"],
    invited: ["info", "Invited", "Dijemput"],
  },
} as const satisfies Record<string, Record<string, Entry>>;

export type StatusDomain = keyof typeof STATUS_MAP;

const TONE_CLASS: Record<ChipTone, string> = {
  success: chipSmSuccess, warning: chipSmWarn, danger: chipSmDanger, info: chipSmInfo, neutral: chipSmNeutral,
};

/** The word and tone for a status - for a cell, a title or a test. */
export function statusOf(domain: StatusDomain, status: string | null | undefined): { tone: ChipTone; label: string } {
  const key = String(status ?? "").trim().toLowerCase();
  const map = STATUS_MAP[domain] as Record<string, Entry>;
  const hit = map[key];
  const ms = getLang() === "ms";
  if (hit) return { tone: hit[0], label: ms ? hit[2] : hit[1] };
  const words = key.replace(/_/g, " ");
  return { tone: "neutral", label: words ? words.charAt(0).toUpperCase() + words.slice(1) : "—" };
}

export function StatusChip({ domain, status, children, title }: {
  domain: StatusDomain;
  status: string | null | undefined;
  /** extra words after the status ("Overdue · 6 d") */
  children?: React.ReactNode;
  title?: string;
}) {
  const s = statusOf(domain, status);
  return (
    <span className={TONE_CLASS[s.tone]} data-status={String(status ?? "")} data-tone={s.tone} title={title}>
      {s.label}{children ? <> · {children}</> : null}
    </span>
  );
}
