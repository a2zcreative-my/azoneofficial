"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { L } from "@/components/portal/page-shared";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows, SkelTable } from "@/components/ui/skeleton";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { firstName, properName } from "@/lib/names";
import { card } from "@/lib/ui-styles";
import { useCallback, useEffect, useState } from "react";

/* ================= Shell ================= */

/* ================= Users (v1.4.101 — super_admin / CEO / COO) ================= */

/** v1.4.153: audit timestamps arrive as UTC "YYYY-MM-DD HH:MM:SS" — show MYT. */
export function mytStamp2(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return iso;
  const m = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(m.getUTCDate())}-${p(m.getUTCMonth() + 1)}-${m.getUTCFullYear()} ${p(m.getUTCHours())}:${p(m.getUTCMinutes())} MYT`;
}

export function UsersPanel({ role }: { role: string }) {
  const [rows, setRows] = useState<
    {
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
    }[]
  >([]);
  const [msg, setMsg] = useState("");
  // v1.4.153: user log (recent sign-ins + account events) for monitoring
  const [events, setEvents] = useState<
    {
      action: string;
      created_at: string;
      name?: string | null;
      email?: string | null;
    }[]
  >([]);
  // v1.4.157 (CEO): role changes are SUPER_ADMIN ONLY — Google sign-ups
  // always land as customer, and keeping promotion out of every business
  // account (including the CEO's) means a breached sign-in can't escalate.
  const canEdit = role === "super_admin";
  const ROLE_OPTIONS = [
    "customer",
    "live_host",
    "editor",
    "marketing",
    "sales_marketing",
    "hr_admin",
    "cco",
    "coo",
    "ceo",
  ];
  const EMP_OPTIONS = ["permanent", "contract", "part_time", "probation"];
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{
    role: string;
    employment_status: string;
  }>({ role: "live_host", employment_status: "part_time" });
  const { show: showToast, node: toastNode } = useSaveToast();
  /* v1.77.0 — skeleton until the first fetch lands (accounts and activity
     are two requests; each region clears its own skeleton). */
  const [loaded, setLoaded] = useState(false);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const load = useCallback(() => {
    void api<{ users?: typeof rows; staff?: typeof rows }>(`/staff/users`).then(
      (r) => {
        if (r.ok && r.data)
          setRows(
            (r.data.users ?? r.data.staff ?? []).filter(
              (u) => !["super_admin", "admin"].includes(u.role)
            )
          );
        else
          setMsg(
            L(
              "Could not load user accounts — check access.",
              "Tidak dapat memuatkan akaun pengguna — semak akses."
            )
          );
        setLoaded(true);
      }
    );
    void api<{ events: typeof events }>(`/staff/users/activity`).then((r) => {
      if (r.ok && r.data) setEvents(r.data.events);
      setEventsLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(["users"], load);
  const saveRole = async (u: { id: number; name: string; email: string }) => {
    const res = await api<{
      role?: string;
      employment_status?: string;
      error?: { message?: string };
    }>(`/staff/users/${u.id}/role`, {
      method: "POST",
      body: JSON.stringify({
        role: draft.role,
        employment_status: draft.employment_status,
      }),
    });
    if (res.ok) {
      showToast(
        L("Saved", "Disimpan"),
        `${firstName(u.name)} → ${draft.role.replace(/_/g, " ")} (${(res.data?.employment_status ?? draft.employment_status).replace(/_/g, " ")})`
      );
      setEditId(null);
      load();
    } else {
      showToast(
        L("Not saved", "Tidak disimpan"),
        res.data?.error?.message ??
          L("Role change failed", "Penukaran peranan gagal"),
        "notice"
      );
    }
  };
  const roleEditor = (u: {
    id: number;
    name: string;
    email: string;
    role: string;
    employment_status?: string | null;
  }) => (
    <div className="bg-secondary/40 mt-2 grid w-full grid-cols-2 items-end gap-2 rounded-lg p-2 sm:flex sm:flex-wrap">
      <label className="block">
        <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">
          {L("Role", "Peranan")}
        </span>
        <select
          className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto"
          value={draft.role}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">
          {L("Employment status", "Status pekerjaan")}
        </span>
        <select
          className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto"
          value={draft.employment_status}
          onChange={(e) =>
            setDraft((d) => ({ ...d, employment_status: e.target.value }))
          }
        >
          {EMP_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="bg-primary text-primary-foreground col-span-1 inline-flex h-9 items-center justify-center rounded-lg px-4 text-sm font-medium"
        onClick={() => void saveRole(u)}
      >
        {L("Save", "Simpan")}
      </button>
      <button
        type="button"
        className="text-xs underline"
        onClick={() => setEditId(null)}
      >
        {L("Cancel", "Batal")}
      </button>
      {!u.email.toLowerCase().endsWith("@azoneofficial.com") &&
        draft.role !== "customer" && (
          <p className="text-muted-foreground col-span-2 w-full text-[11px]">
            {L(
              "Personal-email (Google) account — staff roles are saved as",
              "Akaun e-mel peribadi (Google) — peranan kakitangan disimpan sebagai"
            )}{" "}
            <span className="font-medium">
              {L("part time", "separuh masa")}
            </span>
            {L(
              "; permanent staff need an @azoneofficial.com account.",
              "; kakitangan tetap memerlukan akaun @azoneofficial.com."
            )}
          </p>
        )}
    </div>
  );
  const staffRows = rows.filter((u) => u.role !== "customer");
  const customerRows = rows.filter((u) => u.role === "customer");
  return (
    <div className={card}>
      {toastNode}
      <p className="text-sm font-semibold">
        {L("User accounts", "Akaun pengguna")}
      </p>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {canEdit
          ? L(
              "Change role sets the account's role and employment status — part-time staff are not OT-eligible. Passwords and deactivation stay in /admin.",
              "Tukar peranan menetapkan peranan dan status pekerjaan akaun — kakitangan separuh masa tidak layak OT. Kata laluan dan penyahaktifan kekal di /admin."
            )
          : L(
              "Read-only here — role changes are made by the system super admin only, so no signed-in business account (or breached Google sign-in) can ever escalate a role.",
              "Baca sahaja di sini — penukaran peranan dibuat oleh super admin sistem sahaja, jadi tiada akaun perniagaan yang log masuk (atau log masuk Google yang dicerobohi) boleh menaikkan peranan."
            )}
      </p>
      {msg && <p className="mt-2 text-xs font-medium text-amber-700">{msg}</p>}
      {/* v1.4.161: staff + customer lists sit side-by-side on desktop to cut
          the scroll in half; they stack normally on phones. */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <div>
          {/* v1.4.167: both columns carry the same heading + one-line description
          structure so the two list boxes top-align (the CEO's screenshot
          showed the customer box starting lower). */}
          <p className="mt-4 text-sm font-semibold lg:mt-0">
            {L("Staff accounts", "Akaun kakitangan")}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {L(
              "Role always shows — chips flag exceptions only (part-time, disabled, missing 2FA).",
              "Peranan sentiasa dipaparkan — cip menanda pengecualian sahaja (separuh masa, dinyahaktif, tiada 2FA)."
            )}
          </p>
          {/* v1.4.161 (CEO: "minimalist the card box — too long to scroll"):
          one bordered box with hairline-divided single-line rows instead of
          stacked card boxes; chips show EXCEPTIONS only (non-permanent
          status, disabled, 2FA missing) — role always shows. Everything
          truncates so a phone row stays one line. */}
          <div className="border-border divide-border mt-2 max-h-80 divide-y overflow-y-auto rounded-lg border">
            {/* v1.77.0 — skeleton until the first fetch lands. */}
            {!loaded && <SkelRows rows={6} className="px-3" />}
            {loaded && staffRows.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">
                    {properName(u.full_name || u.name)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {u.email}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  <span className="bg-secondary rounded-full px-1.5 py-px text-[10px] capitalize">
                    {u.role.replace(/_/g, " ")}
                  </span>
                  {(u.employment_status ?? "permanent") !== "permanent" && (
                    <span
                      className={`rounded-full px-1.5 py-px text-[10px] capitalize ${["resigned", "terminated"].includes(u.employment_status ?? "") ? "bg-red-100 text-red-700" : "bg-secondary"}`}
                      title={`${u.left_on ? L(`until ${dmy(u.left_on)}`, `sehingga ${dmy(u.left_on)}`) : ""}${u.rejoined_on ? L(` · rejoined ${dmy(u.rejoined_on)}`, ` · kembali ${dmy(u.rejoined_on)}`) : ""}`}
                    >
                      {(u.employment_status ?? "").replace(/_/g, " ")}
                    </span>
                  )}
                  {!u.is_active && (
                    <span className="rounded-full bg-red-100 px-1.5 py-px text-[10px] text-red-700">
                      {L("disabled", "dinyahaktif")}
                    </span>
                  )}
                  {!u.totp_enabled && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800">
                      2FA ✗
                    </span>
                  )}
                  {canEdit && editId !== u.id && (
                    <button
                      type="button"
                      className="text-[11px] underline"
                      onClick={() => {
                        setEditId(u.id);
                        setDraft({
                          role: u.role,
                          employment_status:
                            u.employment_status &&
                            [
                              "permanent",
                              "contract",
                              "part_time",
                              "probation",
                            ].includes(u.employment_status)
                              ? u.employment_status
                              : "permanent",
                        });
                      }}
                    >
                      ✎
                    </button>
                  )}
                </span>
                {editId === u.id && roleEditor(u)}
              </div>
            ))}
          </div>
          {staffRows.some((u) => !u.totp_enabled && u.is_active) && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              ⚠ {staffRows.filter((u) => !u.totp_enabled && u.is_active).length}{" "}
              {L(
                "active account(s) without 2FA — worth chasing:",
                "akaun aktif tanpa 2FA — perlu dikejar:"
              )}{" "}
              {staffRows
                .filter((u) => !u.totp_enabled && u.is_active)
                .map((u) => firstName(u.name))
                .join(", ")}
            </p>
          )}
        </div>

        {/* v1.4.156: Google sign-ups land here as customers — the CEO promotes
          them into part-time roles (e.g. part-time live host) from this list. */}
        <div className="border-border mt-4 border-t pt-3 lg:mt-0 lg:border-t-0 lg:pt-0">
          <p className="text-sm font-semibold">
            {L(
              "Customer accounts — Google & self sign-ups",
              "Akaun pelanggan — Google & daftar sendiri"
            )}
          </p>
          <p
            className="text-muted-foreground mt-0.5 truncate text-xs"
            title={
              canEdit
                ? L(
                    "Personal emails can hold part-time roles only (e.g. part-time live host); permanent staff need an @azoneofficial.com account.",
                    "E-mel peribadi hanya boleh memegang peranan separuh masa (cth. hos LIVE separuh masa); kakitangan tetap memerlukan akaun @azoneofficial.com."
                  )
                : L(
                    "Google and self sign-ups always land here as customers with zero staff access.",
                    "Pendaftaran Google dan sendiri sentiasa mendarat di sini sebagai pelanggan tanpa akses kakitangan."
                  )
            }
          >
            {canEdit
              ? L(
                  "Promote here when someone joins — personal emails hold part-time roles only.",
                  "Naik taraf di sini apabila seseorang menyertai — e-mel peribadi memegang peranan separuh masa sahaja."
                )
              : L(
                  "Sign-ups land here with zero staff access — promotions by the super admin only.",
                  "Pendaftaran mendarat di sini tanpa akses kakitangan — naik taraf oleh super admin sahaja."
                )}
          </p>
          <div className="border-border divide-border mt-2 max-h-80 divide-y overflow-y-auto rounded-lg border">
            {/* v1.77.0 — skeleton until the first fetch lands. */}
            {!loaded && <SkelRows rows={4} className="px-3" />}
            {loaded && customerRows.length === 0 && (
              <p className="text-muted-foreground px-3 py-2 text-sm">
                {L("No customer accounts yet.", "Tiada akaun pelanggan lagi.")}
              </p>
            )}
            {loaded && customerRows.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">
                    {properName(u.full_name || u.name)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {" "}
                    · {u.email}
                  </span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1">
                  {!u.is_active && (
                    <span className="rounded-full bg-red-100 px-1.5 py-px text-[10px] text-red-700">
                      {L("disabled", "dinyahaktif")}
                    </span>
                  )}
                  {canEdit && editId !== u.id && (
                    <button
                      type="button"
                      className="text-[11px] underline"
                      onClick={() => {
                        setEditId(u.id);
                        setDraft({
                          role: "live_host",
                          employment_status: "part_time",
                        });
                      }}
                    >
                      ✎ {L("Promote", "Naik taraf")}
                    </button>
                  )}
                </span>
                {editId === u.id && roleEditor(u)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-border mt-4 border-t pt-3">
        <p className="text-sm font-semibold">
          {L(
            "User log — recent sign-ins & account events",
            "Log pengguna — log masuk & peristiwa akaun terkini"
          )}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Last 60 authentication events from the audit trail — sign-ins (password, 2FA, Google) and 2FA changes. The full audit lives in /admin.",
            "60 peristiwa pengesahan terakhir daripada jejak audit — log masuk (kata laluan, 2FA, Google) dan perubahan 2FA. Audit penuh berada di /admin."
          )}
        </p>
        <div className="mt-2 max-h-56 space-y-0 overflow-y-auto pr-1">
          {/* v1.77.0 — skeleton until the first fetch lands. */}
          {!eventsLoaded && <SkelTable rows={5} cols={3} />}
          {eventsLoaded && events.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {L("No events recorded yet.", "Tiada peristiwa direkodkan lagi.")}
            </p>
          )}
          {eventsLoaded && events.map((e, i) => (
            <div
              key={i}
              className="border-border flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-b py-1 text-[11px] last:border-0"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{properName(e.name ?? "")}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {e.email ?? ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] ${e.action.includes("2fa_enabled") ? "bg-green-100 text-green-700" : e.action.includes("2fa") ? "bg-blue-100 text-blue-800" : e.action.includes("password") ? "bg-amber-100 text-amber-800" : "bg-secondary"}`}
                >
                  {e.action.replace("auth.", "").replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground">
                  {mytStamp2(e.created_at)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
