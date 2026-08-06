"use client";

/**
 * Staff administration inside /admin (v1.4.11).
 *
 * Admin and super admin hold `hr_manage` on the API, but until now the only
 * surface for it was the staff portal. This panel gives the admin interface
 * direct authority over leave — the most decision-heavy staff function — and
 * a bridge to every other staff module, which admins can open in /portal with
 * full rights (only customers are barred from the portal).
 *
 * Every action here is the same guarded API the portal uses: approvals are
 * permission-checked server-side, audit-logged, and notify the requester.
 */

import { useCallback, useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";
import { dmy as dmyD } from "@/lib/format";
import { useSaveToast } from "@/components/ui/save-toast";

const API = "/api/v1/staff";

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
    return {
      ok: res.ok,
      status: res.status,
      data: (res.status === 204 ? null : await res.json()) as T | null,
    };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const btnSmall =
  "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium transition-colors disabled:opacity-50";

interface LeaveRow {
  id: number;
  user_name: string;
  type: string;
  start_date: string;
  end_date: string;
  days: number;
  reason?: string;
  status: string;
  stage?: string;
  review_comment?: string;
}

const STAGE_LABEL: Record<string, string> = {
  applied: "Awaiting HR", hr_reviewed: "Awaiting pre-approval",
  pre_approved: "Awaiting CEO", pending_final: "Awaiting CEO",
  approved: "Approved", rejected: "Rejected", cancelled: "Cancelled",
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function StatusBadge({ value }: { value: string }) {
  const tone =
    value === "approved"
      ? "bg-green-600/10 text-green-700"
      : value === "pending"
        ? "bg-amber-500/10 text-amber-700"
        : value === "rejected"
          ? "bg-destructive/10 text-destructive"
          : "bg-secondary text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {value}
    </span>
  );
}

/** ISO date → DD-MM-YYYY. */

export function StaffPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [comment, setComment] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ leave: LeaveRow[] }>(`/leave?all=1`);
    if (res.ok && res.data) setRows(res.data.leave);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: number, action: "approve" | "reject") => {
    setError("");
    setBusy(id);
    const res = await api<{ error?: { message?: string } }>(`/leave/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action, comment: comment[id] || undefined }),
    });
    setBusy(null);
    if (!res.ok) {
      const m = res.data?.error?.message ?? "Could not update the request — try again.";
      setError(m);
      showToast("No changes", m, "notice");
      return;
    }
    setComment((c) => ({ ...c, [id]: "" }));
    showToast("Saved", action === "approve" ? "Leave request approved" : "Leave request rejected");
    void load();
  };

  const inFlight = ["applied", "hr_reviewed", "pre_approved", "pending_final"];
  const pending = rows.filter((r) => inFlight.includes(r.stage ?? ""));
  const decided = rows.filter((r) => !inFlight.includes(r.stage ?? ""));

  const leaveCard = (r: LeaveRow, withActions: boolean) => (
    <li key={r.id} className="border-border rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {r.user_name}
          <span className="text-muted-foreground font-normal">
            {" "}· {r.type} leave · {dmyD(r.start_date)} → {dmyD(r.end_date)} ({r.days}{" "}
            {r.days === 1 ? "day" : "days"})
          </span>
        </span>
        <span className="text-muted-foreground text-xs">{STAGE_LABEL[r.stage ?? ""] ?? r.status}</span>
      </div>
      {r.reason && (
        <p className="text-muted-foreground mt-1.5 text-sm">Reason: {r.reason}</p>
      )}
      {r.review_comment && (
        <p className="text-muted-foreground mt-1 text-xs">
          Review note: {r.review_comment}
        </p>
      )}
      {withActions && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="border-input bg-background w-64 rounded-lg border px-2 py-1.5 text-xs"
            placeholder="Comment (optional — the requester sees it)"
            value={comment[r.id] ?? ""}
            onChange={(e) => setComment((c) => ({ ...c, [r.id]: e.target.value }))}
          />
          <button
            type="button"
            className={`${btnSmall} bg-primary text-primary-foreground hover:bg-primary/85`}
            disabled={busy === r.id}
            onClick={() => void decide(r.id, "approve")}
          >
            {r.stage === "applied" ? "Mark reviewed" : r.stage === "hr_reviewed" ? "Pre-approve" : "Final approve"}
          </button>
          <button
            type="button"
            className={`${btnSmall} border-destructive/40 text-destructive hover:bg-destructive/5 border`}
            disabled={busy === r.id}
            onClick={() => void decide(r.id, "reject")}
          >
            Reject
          </button>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {toastNode}
      <div className={card}>
        <p className="text-sm font-semibold">
          Leave administration
          {pending.length > 0 && (
            <span className="bg-amber-500/10 ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
              {pending.length} pending
            </span>
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Annual · medical · emergency · unpaid · replacement. Decisions are
          audit-logged and the requester is notified with your comment.
        </p>
        {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
        <ul className="mt-4 space-y-2">
          {pending.length === 0 && (
            <li className="text-muted-foreground text-sm">No pending requests.</li>
          )}
          {pending.map((r) => leaveCard(r, true))}
        </ul>

        {decided.length > 0 && (
          <>
            <p className="text-muted-foreground mt-6 text-xs font-semibold tracking-wide uppercase">
              History
            </p>
            <ul className="mt-2 space-y-2">
              {decided.slice(0, 12).map((r) => leaveCard(r, false))}
            </ul>
          </>
        )}
      </div>

      <div className={card}>
        <p className="text-sm font-semibold">All staff modules</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Your admin account has full rights in every staff module. These open
          in the staff portal:
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["HR — attendance verification", "Shift-checked table for all staff"],
            ["Leave", "Same requests as above, portal view"],
            ["Inventory & postage", "Stock, shipments, materials"],
            ["Commercial", "BD pipeline (open/pending/KIV/closed)"],
            ["Operations", "Daily ops + sales reports"],
            ["Overview", "Company-wide read-only monitor"],
          ].map(([title, desc]) => (
            <li key={title}>
              <a
                href="/portal"
                className="border-border hover:border-foreground/40 block rounded-lg border px-3 py-2.5 transition-colors"
              >
                <span className="block text-sm font-medium">{title}</span>
                <span className="text-muted-foreground mt-0.5 block text-xs">
                  {desc}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
