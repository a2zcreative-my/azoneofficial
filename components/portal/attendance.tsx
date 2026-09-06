"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { L, MANAGE_ROLES, User, mytDateTime, mytTime } from "@/components/portal/page-shared";
import { DetailsToggle } from "@/components/ui/details-toggle";
import { SkelCard, SkelTable } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { dmy, mytDateOf } from "@/lib/format";
import { firstName, properName } from "@/lib/names";
import { btnGhost, card } from "@/lib/ui-styles";
import { useEffect, useState } from "react";
import { AppIcon, PanelTitle } from "@/components/ui/app-icon";

/* ================= Attendance ================= */

export function Attendance({ user }: { user: User }) {
  const [month, setMonth] = useState(
    new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7)
  );
  const [records, setRecords] = useState<
    { type: string; created_at: string; name?: string }[]
  >([]);
  const [reportMode, setReportMode] = useState(false);
  // v1.4.80: click a column header to sort; click again to reverse.
  const [sortKey, setSortKey] = useState<"name" | "type" | "time" | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const clickSort = (k: "name" | "type" | "time") => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
  };
  // v1.4.78: report can focus on one staff member.
  const [filterName, setFilterName] = useState("");
  const canReport = MANAGE_ROLES.includes(user.role);
  // v1.4.173 (CEO): today's monitor — who has NOT clocked in / out.
  const [monitor, setMonitor] = useState<{
    date: string;
    staff: {
      id: number;
      name: string;
      role: string;
      employment_status?: string | null;
      in_at?: string | null;
      out_at?: string | null;
    }[];
  } | null>(null);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const path =
      reportMode && canReport
        ? `/staff/attendance/report?month=${month}`
        : `/staff/attendance?month=${month}`;
    void api<{ records: typeof records }>(path).then((r) => {
      setRecords(r.data?.records ?? []);
      setLoaded(true);
    });
  }, [month, reportMode, canReport]);
  useEffect(() => {
    if (!canReport) return;
    const loadMon = () =>
      void api<NonNullable<typeof monitor>>(`/staff/attendance/monitor`).then(
        (r) => {
          if (r.ok && r.data) setMonitor(r.data);
        }
      );
    loadMon();
    const t = setInterval(loadMon, 120000); // keeps the monitor live through the day
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReport]);

  return (
    <div className="space-y-4 md:space-y-6">
      {/* v1.4.173 (CEO: "monitoring of the Staff who is not clock in or
          clock out for me to aware"): today's snapshot, refreshed every two
          minutes — missing punches called out on top, then a compact list. */}
      {/* v1.77.0 — skeleton until the first fetch lands (monitor card). */}
      {canReport && monitor === null && <SkelCard lines={2} />}
      {canReport &&
        monitor &&
        (() => {
          const hm = (iso?: string | null) => {
            if (!iso) return null;
            const d = new Date(
              new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime() +
                8 * 3600 * 1000
            );
            return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
          };
          const nowMYT = new Date(Date.now() + 8 * 3600 * 1000);
          const isWeekend = [0, 6].includes(nowMYT.getUTCDay());
          const afterShift = nowMYT.getUTCHours() >= 18;
          const notIn = monitor.staff.filter((s) => !s.in_at);
          const stillIn = monitor.staff.filter((s) => s.in_at && !s.out_at);
          return (
            <div className={card}>
              <PanelTitle icon="preview">
                {L("Today's attendance monitor", "Pemantau kehadiran hari ini")}{" "}
                — {dmy(monitor.date)}
              </PanelTitle>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {L(
                  "Live snapshot of every active staff member's punches today (refreshes every 2 minutes).",
                  "Paparan langsung punch setiap kakitangan aktif hari ini (dimuat semula setiap 2 minit)."
                )}
                {isWeekend
                  ? L(
                      " Weekend — missing punches are normal.",
                      " Hujung minggu — punch yang tiada adalah normal."
                    )
                  : ""}
              </p>
              {notIn.length > 0 && !isWeekend && (
                <p className="mt-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">
                  <AppIcon name="warning" className="mr-1 h-3.5 w-3.5" />{L("Not clocked in:", "Belum daftar masuk:")}{" "}
                  {notIn.map((s) => firstName(s.name)).join(", ")}
                </p>
              )}
              {stillIn.length > 0 && afterShift && (
                <p className="mt-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-xs font-semibold text-info">
                  <AppIcon name="pending" className="mr-1 h-3.5 w-3.5" />
                  {L(
                    "Past 18:00 with no clock-out yet:",
                    "Melepasi 18:00 tanpa daftar keluar lagi:"
                  )}{" "}
                  {stillIn.map((s) => firstName(s.name)).join(", ")}
                </p>
              )}
              {/* v1.4.196 (CEO): summary callouts stay; the full per-staff
                list hides behind one click — minimalist view */}
              <DetailsToggle label={L("Staff list", "Senarai kakitangan")}>
                <div className="border-border divide-border mt-1 max-h-64 divide-y overflow-y-auto rounded-lg border">
                  {[...monitor.staff]
                    .sort(
                      (a, b) =>
                        Number(!!a.in_at) - Number(!!b.in_at) ||
                        a.name.localeCompare(b.name)
                    )
                    .map((st) => (
                      <div
                        key={st.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">
                            {properName(st.name)}
                          </span>
                          <span className="text-muted-foreground text-xs capitalize">
                            {" "}
                            · {st.role.replace(/_/g, " ")}
                            {st.employment_status === "part_time"
                              ? L(" (part-time)", " (separuh masa)")
                              : ""}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center justify-end gap-1">
                          {st.in_at ? (
                            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
                              {L("In", "Masuk")} {hm(st.in_at)}
                            </span>
                          ) : (
                            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning">
                              <AppIcon name="warning" className="mr-0.5 h-3 w-3" />{L("not clocked in", "belum daftar masuk")}
                            </span>
                          )}
                          {st.in_at &&
                            (st.out_at ? (
                              <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">
                                {L("Out", "Keluar")} {hm(st.out_at)}
                              </span>
                            ) : (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${afterShift ?"bg-warning-soft text-warning" :"bg-info-soft text-info"}`}
                              >
                                {afterShift
                                  ? L(
                                      "no clock-out",
                                      "tiada daftar keluar"
                                    )
                                  : L("still in", "belum keluar")}
                              </span>
                            ))}
                        </span>
                      </div>
                    ))}
                </div>
              </DetailsToggle>
            </div>
          );
        })()}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">
              {reportMode && canReport
                ? L("Team attendance report", "Laporan kehadiran pasukan")
                : L("My attendance", "Kehadiran saya")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {reportMode && canReport
                ? L(
                    "Every punch across the team for the chosen month. Times are Malaysia time.",
                    "Setiap punch seluruh pasukan bagi bulan dipilih. Masa ialah waktu Malaysia."
                  )
                : L(
                    "Your days at work with hours counted — first clock-in to last clock-out. Times are Malaysia time.",
                    "Hari bekerja anda dengan jam dikira — daftar masuk pertama hingga daftar keluar terakhir. Masa ialah waktu Malaysia."
                  )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reportMode && canReport && records.length > 0 && (
              <select
                className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm sm:w-auto sm:max-w-44"
                value={filterName}
                title={L(
                  "Show one staff member only",
                  "Papar seorang kakitangan sahaja"
                )}
                onChange={(e) => setFilterName(e.target.value)}
              >
                <option value="">
                  {L("Find staff: everyone", "Cari kakitangan: semua")}
                </option>
                {[...new Set(records.map((r) => r.name).filter(Boolean))]
                  .sort()
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            )}

            <input
              type="month"
              className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            {canReport && (
              <button
                type="button"
                className={btnGhost}
                onClick={() => setReportMode((v) => !v)}
              >
                {reportMode
                  ? L("My attendance", "Kehadiran saya")
                  : L("Team report", "Laporan pasukan")}
              </button>
            )}
          </div>
        </div>

        {/* v1.77.0 — skeleton until the first fetch lands: the table's
            column count (4 personal, 3 report) so nothing jumps. */}
        {!loaded && (
          <SkelTable rows={6} cols={reportMode && canReport ? 3 : 4} className="mt-3" />
        )}

        {loaded && records.length === 0 && (
          <p className="text-muted-foreground mt-3 text-sm">
            {L("No records for this month.", "Tiada rekod untuk bulan ini.")}
          </p>
        )}

        {/* Personal view (v1.4.77): grouped by day — Date | In | Out | Hours. */}
        {loaded &&
          !reportMode &&
          records.length > 0 &&
          (() => {
            const byDay = new Map<string, { ins: string[]; outs: string[] }>();
            for (const r of records) {
              const d = mytDateOf(r.created_at);
              const g = byDay.get(d) ?? { ins: [], outs: [] };
              (r.type === "clock_in" ? g.ins : g.outs).push(r.created_at);
              byDay.set(d, g);
            }
            const days = [...byDay.entries()].sort((a, b) =>
              b[0].localeCompare(a[0])
            );
            const hoursOf = (firstIn?: string, lastOut?: string) => {
              if (!firstIn || !lastOut) return null;
              const ms =
                new Date(lastOut.replace(" ", "T") + "Z").getTime() -
                new Date(firstIn.replace(" ", "T") + "Z").getTime();
              if (ms <= 0) return null;
              const h = Math.floor(ms / 3600000);
              const m = Math.round((ms % 3600000) / 60000);
              return `${h}h ${String(m).padStart(2, "0")}m`;
            };
            const totalMs = days.reduce((sum, [, g]) => {
              const fi = g.ins.sort()[0];
              const lo = g.outs.sort().at(-1);
              if (!fi || !lo) return sum;
              const ms =
                new Date(lo.replace(" ", "T") + "Z").getTime() -
                new Date(fi.replace(" ", "T") + "Z").getTime();
              return ms > 0 ? sum + ms : sum;
            }, 0);
            return (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="border-border border-b">
                      <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">
                        {L("Date", "Tarikh")}
                      </th>
                      <th className="text-muted-foreground py-2 pr-2 pl-4 text-left text-xs font-semibold uppercase">
                        {L("In", "Masuk")}
                      </th>
                      <th className="text-muted-foreground py-2 pr-2 pl-4 text-left text-xs font-semibold uppercase">
                        {L("Out", "Keluar")}
                      </th>
                      <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold uppercase">
                        {L("Hours", "Jam")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map(([d, g]) => {
                      const firstIn = g.ins.sort()[0];
                      const lastOut = g.outs.sort().at(-1);
                      const hrs = hoursOf(firstIn, lastOut);
                      return (
                        <tr
                          key={d}
                          className="border-border border-b last:border-0"
                        >
                          <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                            {dmy(d)}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {firstIn ? (
                              <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                                {mytTime(firstIn)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {lastOut ? (
                              <span className="bg-secondary rounded-full px-2 py-0.5 text-xs font-medium">
                                {mytTime(lastOut)}
                              </span>
                            ) : firstIn ? (
                              <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                                {L("still in", "belum keluar")}
                              </span>
                            ) : (
                              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                                {L("missing", "tiada")}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                            {hrs ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-border border-t-2 font-semibold">
                      <td className="px-2 py-2">
                        {L(
                          `${days.length} day${days.length === 1 ? "" : "s"}`,
                          `${days.length} hari`
                        )}
                      </td>
                      <td className="px-2 py-2" colSpan={2}></td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {totalMs > 0
                          ? `${Math.floor(totalMs / 3600000)}h ${String(Math.round((totalMs % 3600000) / 60000)).padStart(2, "0")}m`
                          : "—"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            );
          })()}

        {/* Team report: every punch, sortable, with clear In/Out chips. */}
        {loaded && reportMode && canReport && records.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-border border-b">
                  {(
                    [
                      ["name", "Staff"],
                      ["type", "Type"],
                      ["time", "Time (MYT)"],
                    ] as const
                  ).map(([k, label]) => (
                    <th
                      key={k}
                      className="text-muted-foreground cursor-pointer px-2 py-2 text-left text-xs font-semibold uppercase select-none hover:underline"
                      title={L(
                        "Click to sort — click again to reverse",
                        "Klik untuk isih — klik lagi untuk terbalikkan"
                      )}
                      onClick={() => clickSort(k)}
                    >
                      {L(
                        label,
                        k === "name"
                          ? "Kakitangan"
                          : k === "type"
                            ? "Jenis"
                            : "Masa (MYT)"
                      )}
                      {sortKey === k ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const visible = filterName
                    ? records.filter((r) => r.name === filterName)
                    : records;
                  if (!sortKey) return visible;
                  const val = (r: (typeof records)[number]) =>
                    sortKey === "name"
                      ? (r.name ?? "")
                      : sortKey === "type"
                        ? r.type
                        : r.created_at;
                  return [...visible].sort(
                    (a, b) =>
                      (val(a).localeCompare(val(b)) ||
                        a.created_at.localeCompare(b.created_at)) * sortDir
                  );
                })().map((r, i) => (
                  <tr key={i} className="border-border border-b last:border-0">
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                      {r.name ?? "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.type ==="clock_in" ?"bg-success-soft text-success" :"bg-secondary"}`}
                      >
                        {r.type === "clock_in"
                          ? L("In", "Masuk")
                          : L("Out", "Keluar")}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {mytDateTime(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
