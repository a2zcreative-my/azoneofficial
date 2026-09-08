"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { Sub } from "@/components/portal/leave";
import { L, User, sessStatusL } from "@/components/portal/page-shared";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useLiveRefresh } from "@/hooks/use-live-refresh"; // v1.139.0 - the rows here are changed by three other cards
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { properName } from "@/lib/names";
import { btnClass, card, inputClass } from "@/lib/ui-styles";
import { useCallback, ReactNode, useEffect, useState } from "react";
import { PanelTitle } from "@/components/ui/app-icon";

/* v1.4.181 (CEO: customers must be able to reach staff for package/service
   enquiries): the business team works those enquiries HERE, not only in
   /admin — newest first, category chips, status select, one-tap WhatsApp /
   email reply. */
/* v1.4.193 LIVE GMV (CEO: "staff view their live GMV daily results"): 🔥
   today + this month + last-7-days rows, all staff roles. Hosts with a live
   session scheduled today additionally see the GMV that landed during
   their session window(s) — motivation, not payroll. Auto-refresh 5 min. */
/* v1.4.197 LIVE ENGAGEMENT (CEO: "I want to bring this data into my
   dashboard too, possible?"): TikTok Shop LIVE analytics — views, likes,
   comments, shares, new followers etc. for the last 7 days, from the
   official /analytics shop_lives endpoint. Honest states: TikTok's own
   error verbatim while the Data & Insights (Analytics) scope is missing.
   LIVE Rewards (diamonds) is creator-side and NOT in the Shop API. */
/* v1.19.0 (consolidation C1): LiveGmvCard deleted — it showed the same
   TikTok month GMV as SalesRevenueCard's TikTok box on the SAME tab, from a
   second endpoint that could disagree on NULL-amount rows. One number, one
   card. (/staff/gmv itself survives: LiveEconomicsCard uses it.) */

/* v1.4.191 OT APPROVALS (CEO gap list): pending day-pairs decided here —
   only approved OT will ever feed payroll. */
export function OtApprovalsCard({ inModal }: { inModal?: boolean } = {}) {
  interface Pend {
    user_id: number;
    name: string;
    d: string;
    ot_in: string | null;
    ot_out: string | null;
    /* v1.133.0 — the day's overtime MINUTES, summed over its stretches by
       the worker. Out minus in would count the hours at home between an
       early start and a late finish. */
    minutes?: number;
    stretches?: number;
    /** The live session or roster task that vouches for it, by name. */
    assigned?: string | null;
  }
  const [pending, setPending] = useState<Pend[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const { confirm: otConfirm, node: otConfirmNode } = useConfirm();
  const { show: showOtToast, node: otToastNode } = useSaveToast();
  const load = useCallback(async () => {
    const r = await api<{ pending?: Pend[] }>(`/staff/attendance/ot/pending`);
    if (r.ok) setPending(r.data?.pending ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  /* v1.139.0 - v1.138.0 made the Overtime TABLE follow this card; this is the
     other direction. A stretch removed in the table, a rest day paid as OT,
     or a clock-out that has just derived one all change the very rows listed
     here, and none of them reached it - so Approve could be pressed on a
     record that no longer existed and answer "No pending OT punches". */
  useLiveRefresh(["attendance", "rest-day-ot"], load);
  const decide = async (p: Pend, decision: "approved" | "rejected") => {
    if (
      decision === "rejected" &&
      !(await otConfirm({
        title: L("Reject this overtime?", "Tolak OT ini?"),
        message: L(
          `${properName(p.name)} — ${dmy(p.d)} ${p.ot_in ?? "?"}–${p.ot_out ?? "?"}. The staff member is notified either way.`,
          `${properName(p.name)} — ${dmy(p.d)} ${p.ot_in ?? "?"}–${p.ot_out ?? "?"}. Kakitangan akan dimaklumkan apa pun keputusannya.`
        ),
        confirmLabel: L("Reject OT", "Tolak OT"),
        variant: "danger",
      }))
    )
      return;
    const res = await api<{ error?: { message?: string } }>(`/staff/attendance/ot/decide`, {
      method: "POST",
      body: JSON.stringify({
        user_id: p.user_id,
        date: p.d,
        decision,
        note: note[`${p.user_id}:${p.d}`] || undefined,
      }),
    });
    /* v1.77.0 — an OT decision is money. It says so now. */
    if (!res.ok) {
      showOtToast(L("Not changed", "Tidak diubah"),
        res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    showOtToast(
      decision === "approved" ? L("OT approved", "OT diluluskan") : L("OT rejected", "OT ditolak"),
      L(`${properName(p.name)} · ${dmy(p.d)} — they have been notified.`,
        `${properName(p.name)} · ${dmy(p.d)} — mereka telah dimaklumkan.`),
      decision === "approved" ? undefined : "notice",
    );
    void load();
  };
  const dur = (p: Pend) => {
    /* The worker's sum when it sends one; the old span for a worker that
       predates it. */
    let mins = typeof p.minutes === "number" ? p.minutes : -1;
    if (mins < 0) {
      if (!p.ot_in || !p.ot_out) return "";
      const [h1, m1] = p.ot_in.split(":").map(Number);
      const [h2, m2] = p.ot_out.split(":").map(Number);
      mins = h2! * 60 + m2! - (h1! * 60 + m1!);
    }
    return mins > 0
      ? ` · ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m${(p.stretches ?? 1) > 1 ? ` (${p.stretches} ${L("stretches", "bahagian")})` : ""}`
      : "";
  };

  const wrapCard = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col pb-4 sm:pb-0">{node}</div>
    ) : (
      <div className={card}>
        <PanelTitle icon="time">
          {L("Overtime approvals", "Kelulusan OT")}
        </PanelTitle>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Time clocked outside each person's scheduled shifts, read off their clock-in and clock-out. Only APPROVED overtime will count when OT feeds payroll. The staff member is notified of every decision.",
            "Masa yang didaftarkan di luar syif berjadual setiap orang, dibaca daripada daftar masuk dan keluar mereka. Hanya OT yang DILULUSKAN dikira apabila OT masuk ke gaji. Kakitangan dimaklumkan bagi setiap keputusan."
          )}
        </p>
        <div className="mt-3 space-y-0">{node}</div>
      </div>
    );

  /* v1.77.0 — skeleton until the first fetch lands; the card still hides
     itself once the list is known to be empty (unchanged). */
  if (!loaded)
    return (
      <>
        {otConfirmNode}
        {otToastNode}
        {wrapCard(<SkelRows rows={2} className={inModal ? "px-4 sm:px-5" : ""} />)}
      </>
    );
  if (pending.length === 0) return <>{otConfirmNode}{otToastNode}</>;

  return (
    <>
      {otConfirmNode}
      {otToastNode}
      {wrapCard(
        <>
          {pending.map((p) => (
            <div
              key={`${p.user_id}:${p.d}`}
              className={`border-border flex flex-wrap items-center justify-between gap-2 border-b text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-4 py-3 sm:px-5" : "py-2"}`}
            >
              <span className="min-w-0">
                <span className="font-medium">{properName(p.name)}</span>{" "}
                <span className="text-muted-foreground text-xs">
                  {dmy(p.d)} · {p.ot_in}–{p.ot_out}
                  {dur(p)}
                  {/* v1.133.0 — the evidence that decides most approvals:
                      the live session or roster task that covered the time. */}
                  {p.assigned && (
                    <span className="text-success ml-1 font-medium">
                      · {L("assigned", "ditugaskan")}: {p.assigned}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <input
                  className="border-input bg-background w-36 rounded border px-1.5 py-0.5 text-xs"
                  placeholder={L("Note (optional)", "Catatan (pilihan)")}
                  value={note[`${p.user_id}:${p.d}`] ?? ""}
                  onChange={(e) =>
                    setNote((n) => ({
                      ...n,
                      [`${p.user_id}:${p.d}`]: e.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  className="bg-primary text-primary-foreground rounded px-2 py-0.5 text-xs font-medium"
                  onClick={() => void decide(p, "approved")}
                >
                  {L("Approve", "Luluskan")}
                </button>
                <button
                  type="button"
                  className="text-destructive border-border rounded border px-2 py-0.5 text-xs"
                  onClick={() => void decide(p, "rejected")}
                >
                  {L("Reject", "Tolak")}
                </button>
              </span>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/* v1.4.191 LIVE SESSION ROSTER (CEO gap list): which host, which client,
   which platform, what slot. Managers schedule; hosts see their own and are
   bell-notified on assignment. */
export function LiveScheduleCard({
  user,
  inModal,
}: {
  user: User;
  inModal?: boolean;
}) {
  interface Sess {
    id: number;
    session_date: string;
    start_time: string;
    end_time?: string | null;
    platform: string;
    client_company?: string | null;
    client_name?: string | null;
    host_user_id: number;
    host_name: string;
    notes?: string | null;
    status: string;
  }
  interface Opt {
    id: number;
    name?: string | null;
    company?: string | null;
    role?: string;
  }
  const manager = [
    "ceo",
    "coo",
    "cco",
    "hr_admin",
    "super_admin",
    "admin",
  ].includes(user.role);
  /* v1.29.1 — same complaint as the roster board's Mark completed: this
     card's status dropdown changed a live session with no confirmation at
     all, and a rejected PATCH left the select showing the NEW value while
     the database still held the old one. It now reports through the shared
     save toast and reloads from the server either way. */
  const { show: showToast, node: toastNode } = useSaveToast();
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hosts, setHosts] = useState<Opt[]>([]);
  const [clients, setClients] = useState<Opt[]>([]);
  const [draft, setDraft] = useState({
    session_date: "",
    start_time: "",
    end_time: "",
    platform: "tiktok",
    client_id: "",
    client_name: "",
    host_user_id: "",
    notes: "",
  });
  const load = async () => {
    const r = await api<{ sessions?: Sess[] }>(`/staff/live-sessions`);
    if (r.ok) setSessions(r.data?.sessions ?? []);
    setLoaded(true);
  };
  useEffect(() => {
    void load();
    if (manager) {
      /* v1.21.0: host picker moved to /staff-list — the one picker source
         (active staff, full names). It already excludes customer/admin
         accounts, so the old filter went with it. */
      void api<{ staff?: Opt[] }>(`/staff/staff-list`).then((r) => {
        if (r.ok) setHosts(r.data?.staff ?? []);
      });
      void api<{ customers?: Opt[] }>(`/staff/customers`).then((r) => {
        if (r.ok)
          setClients(
            (r.data?.customers ?? []).filter(
              (c) => (c.company ?? "") !== "Walk-in Customer"
            )
          );
      });
    }
  }, [manager]);
  const create = async () => {
    if (!draft.session_date || !draft.start_time || !draft.host_user_id) return;
    await api(`/staff/live-sessions`, {
      method: "POST",
      body: JSON.stringify({
        session_date: draft.session_date,
        start_time: draft.start_time,
        end_time: draft.end_time || undefined,
        platform: draft.platform,
        client_id: draft.client_id ? Number(draft.client_id) : undefined,
        client_name: draft.client_name || undefined,
        host_user_id: Number(draft.host_user_id),
        notes: draft.notes || undefined,
      }),
    });
    setDraft({
      session_date: "",
      start_time: "",
      end_time: "",
      platform: "tiktok",
      client_id: "",
      client_name: "",
      host_user_id: "",
      notes: "",
    });
    void load();
  };
  const setStatus = async (id: number, status: string) => {
    const sn = sessions.find((x) => x.id === id);
    const r = await api<{ error?: { message?: string } }>(
      `/staff/live-sessions/${id}`,
      { method: "PATCH", body: JSON.stringify({ status }) }
    );
    if (!r.ok) {
      showToast(
        L("No change", "Tiada perubahan"),
        r.data?.error?.message ??
          L("Could not update the session", "Sesi tidak dapat dikemas kini"),
        "notice"
      );
      void load(); // pull the real value back so the dropdown stops lying
      return;
    }
    showToast(
      status === "completed"
        ? L("Session completed", "Sesi selesai")
        : status === "cancelled"
          ? L("Session cancelled", "Sesi dibatalkan")
          : L("Back to scheduled", "Kembali kepada dijadualkan"),
      sn
        ? `${sn.client_company ?? sn.client_name ?? L("Live session", "Sesi LIVE")} · ${dmy(sn.session_date)} ${sn.start_time}`
        : ""
    );
    void load();
  };

  /* v1.21.2 (CEO: "lives today seem overfloating"): the modal variant had
     NO padding — fields and the empty-state line sat flush against the
     dialog edges. It now carries the dialog's standard inner padding. */
  const wrapCard = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col px-4 pt-1 pb-4 sm:px-5 sm:pb-5">
        {node}
        {toastNode}
      </div>
    ) : (
      <div className={card}>
        <PanelTitle icon="live">
          {L("Live session schedule", "Jadual sesi LIVE")}
        </PanelTitle>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {manager
            ? L(
                "The roster: which host goes live for which client, on which platform, at what slot. Hosts are bell-notified when assigned.",
                "Roster: hos mana yang LIVE untuk pelanggan mana, di platform mana, pada slot apa. Hos dimaklumkan melalui loceng apabila ditugaskan."
              )
            : L(
                "Your upcoming live sessions — you are notified when a new one is assigned to you.",
                "Sesi LIVE anda yang akan datang — anda dimaklumkan apabila yang baharu ditugaskan kepada anda."
              )}
        </p>
        {node}
        {toastNode}
      </div>
    );

  /* v1.77.0 — skeleton until the first fetch lands (the shared primitive,
     in place of the hand-rolled pulse: session rows, the shape of the list). */
  if (!loaded) {
    return wrapCard(<SkelRows rows={3} className="mt-2" />);
  }
  if (!manager && sessions.length === 0) {
    return wrapCard(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No live sessions scheduled.", "Tiada sesi LIVE dijadualkan.")}
      </p>
    );
  }

  return wrapCard(
    <>
      {manager && (
        /* v1.21.2: inside the modal the form stays a tidy 2-up grid — the
           free-flowing sm:flex row was built for the full-width card and
           squeezed four fields into the dialog's 576px. */
        <div
          className={`mt-3 grid grid-cols-2 items-end gap-2 ${inModal ? "" : "sm:flex sm:flex-wrap"}`}
        >
          <Sub t={L("Date", "Tarikh")}>
            <input
              type="date"
              className={inputClass}
              value={draft.session_date}
              onChange={(e) =>
                setDraft((d) => ({ ...d, session_date: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Start", "Mula")}>
            <input
              type="time"
              className={inputClass}
              value={draft.start_time}
              onChange={(e) =>
                setDraft((d) => ({ ...d, start_time: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("End (optional)", "Tamat (pilihan)")}>
            <input
              type="time"
              className={inputClass}
              value={draft.end_time}
              onChange={(e) =>
                setDraft((d) => ({ ...d, end_time: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Platform", "Platform")}>
            <select
              className={inputClass}
              value={draft.platform}
              onChange={(e) =>
                setDraft((d) => ({ ...d, platform: e.target.value }))
              }
            >
              {["tiktok", "shopee", "other"].map((pf) => (
                <option key={pf} value={pf}>
                  {pf === "other" ? L("other", "lain-lain") : pf}
                </option>
              ))}
            </select>
          </Sub>
          <Sub t={L("Host", "Hos")}>
            <select
              className={inputClass}
              value={draft.host_user_id}
              onChange={(e) =>
                setDraft((d) => ({ ...d, host_user_id: e.target.value }))
              }
            >
              <option value="">{L("Select host…", "Pilih hos…")}</option>
              {hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {properName(h.name ?? "")}
                </option>
              ))}
            </select>
          </Sub>
          <Sub t={L("Client", "Pelanggan")}>
            <select
              className={inputClass}
              value={draft.client_id}
              onChange={(e) =>
                setDraft((d) => ({ ...d, client_id: e.target.value }))
              }
            >
              <option value="">
                {L(
                  "— unregistered / see note —",
                  "— tidak berdaftar / lihat catatan —"
                )}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
          </Sub>
          <Sub
            t={L("Notes (optional)", "Catatan (pilihan)")}
            className="col-span-2 sm:max-w-64 sm:flex-1"
          >
            <input
              className={inputClass}
              placeholder={L(
                "e.g. Raya campaign, product focus",
                "cth. Kempen Raya, fokus produk"
              )}
              value={draft.notes}
              onChange={(e) =>
                setDraft((d) => ({ ...d, notes: e.target.value }))
              }
            />
          </Sub>
          <button
            type="button"
            className={`${btnClass} col-span-2 sm:col-span-1`}
            onClick={() => void create()}
          >
            {L("Schedule", "Jadualkan")}
          </button>
        </div>
      )}
      {sessions.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {L("No sessions scheduled.", "Tiada sesi dijadualkan.")}
        </p>
      ) : (
        <div className="mt-3 max-h-96 space-y-0 overflow-y-auto pr-1">
          {sessions.map((sn) => (
            <div
              key={sn.id}
              className={`border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-2" : ""}`}
            >
              <span className="min-w-0">
                <span className="font-medium">{dmy(sn.session_date)}</span>{" "}
                <span className="text-muted-foreground">
                  {sn.start_time}
                  {sn.end_time ? `–${sn.end_time}` : ""}
                </span>{" "}
                <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">
                  {sn.platform}
                </span>{" "}
                <span>{properName(sn.host_name)}</span>
                {(sn.client_company ?? sn.client_name) && (
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {sn.client_company ?? sn.client_name}
                  </span>
                )}
                {sn.notes && (
                  <span className="text-muted-foreground block text-xs">
                    {sn.notes}
                  </span>
                )}
              </span>
              {manager ? (
                <select
                  className="border-input bg-background rounded border px-1.5 py-0.5 text-[11px]"
                  value={sn.status}
                  onChange={(e) => void setStatus(sn.id, e.target.value)}
                >
                  {["scheduled", "completed", "cancelled"].map((st) => (
                    <option key={st} value={st}>
                      {sessStatusL(st)}
                    </option>
                  ))}
                </select>
              ) : (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${sn.status ==="cancelled" ?"bg-danger-soft text-danger" : sn.status ==="completed" ?"bg-secondary" :"bg-success-soft text-success"}`}
                >
                  {sessStatusL(sn.status)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
