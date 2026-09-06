"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { ShieldOk } from "@/components/layout/nav-icons";
import { UpcomingEventsCard } from "@/components/portal/events";
import { LocationHelp } from "@/components/portal/location-help";
import { NextEventCard } from "@/components/portal/next-event-card";
import { OneDesk } from "@/components/portal/one-desk";
import { Announcement, DASH_ANNS, DASH_ATT, DASH_LEAVE, DASH_TASKS, DashCache, L, LeaveReq, MONTH_NAMES, Task, User, ZoneLabel, annCatL, leaveTypeL, mytGreeting, mytTime, mytTodayLine, priorityL } from "@/components/portal/page-shared";
import { SalesDoc } from "@/components/portal/sales";
import { TradingDesk } from "@/components/portal/trading-desk";
import { WatchersCard } from "@/components/portal/watchers-card";
import { Skel, SkelRows, SkelStat, SkelText } from "@/components/ui/skeleton";
import { SITE_CONFIG } from "@/constants/site";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { api } from "@/lib/api";
import { cacheRead, cacheWrite } from "@/lib/cached-api";
import { dmy, fmtRM, mytDateOf, mytToday } from "@/lib/format";
import { Lang, getLang, t as tr } from "@/lib/i18n";
import { SALES_ROLES, TabName } from "@/lib/portal-tabs";
import { card, toastCard } from "@/lib/ui-styles";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";

/**
 * Punch confirmation overlay (v1.4.29): centered card, animated ring +
 * check draw, brand navy, auto-dismisses. Pure CSS keyframes — no library.
 */

/** ISO "YYYY-MM-DD…" → "DD-MM-YYYY" (+ " HH:MM" when time is present). */

export function PunchToast({
  title,
  sub,
  variant = "success",
}: {
  title: string;
  sub: string;
  variant?: "success" | "notice";
}) {
  /* v1.124.0 — see SaveToast: the ring follows the theme now. */
  const colour = variant === "success" ? "var(--primary)" : "var(--warning)";
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <style>{`
        @keyframes punch-pop { 0% { opacity: 0; transform: scale(.82) translateY(8px); } 60% { opacity: 1; transform: scale(1.03); } 100% { transform: scale(1); } }
        @keyframes punch-ring { from { stroke-dashoffset: 151; } to { stroke-dashoffset: 0; } }
        @keyframes punch-check { from { stroke-dashoffset: 36; } to { stroke-dashoffset: 0; } }
        @keyframes punch-fade { to { opacity: 0; } }
      `}</style>
      <div
        className={toastCard}
        style={{
          animation:
            "punch-pop .45s cubic-bezier(.2,.9,.3,1.2) both, punch-fade .4s ease .2s forwards",
          animationDelay: "0s, 2.2s",
        }}
        role="status"
        aria-live="polite"
      >
        <svg
          viewBox="0 0 52 52"
          className="mx-auto h-14 w-14"
          aria-hidden="true"
        >
          <circle
            cx="26"
            cy="26"
            r="24"
            fill="none"
            stroke={colour}
            strokeWidth="2.5"
            strokeDasharray="151"
            style={{ animation: "punch-ring .6s ease-out .1s both" }}
          />
          {variant === "success" ? (
            <path
              d="M15 27l7.5 7.5L37 20"
              fill="none"
              stroke={colour}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="36"
              style={{ animation: "punch-check .35s ease-out .55s both" }}
            />
          ) : (
            <g style={{ animation: "punch-check .35s ease-out .55s both" }}>
              <path
                d="M26 14v16"
                fill="none"
                stroke={colour}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="16"
              />
              <circle cx="26" cy="37" r="2.2" fill={colour} />
            </g>
          )}
        </svg>
        <p className="mt-3 text-base font-semibold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-sm">{sub}</p>
      </div>
    </div>
  );
}

export function Dashboard({
  user,
  go,
  lang = "en",
}: {
  user: User;
  go: (t: TabName) => void;
  lang?: Lang;
}) {
  /* v1.25.1: seeded from remembered data IN THE INITIALISER — seeding only
     the "known" flag left a single frame where the answer was declared known
     while the list was still empty, which printed the false message again. */
  const [today, setToday] = useState<{ type: string; created_at: string }[]>(
    () =>
      (cacheRead<DashCache>(DASH_ATT)?.records ?? []).filter(
        (r) => mytDateOf(r.created_at) === mytToday()
      )
  );
  const [todayOt, setTodayOt] = useState<
    { type: string; created_at: string }[]
  >(() =>
    (cacheRead<DashCache>(DASH_ATT)?.ot ?? []).filter(
      (r) => mytDateOf(r.created_at) === mytToday()
    )
  );
  /* v1.15.0: the same attendance response, kept un-filtered — powers the
     personal month chart and the KPI strip without a second request. */
  const [monthRecs, setMonthRecs] = useState<
    { type: string; created_at: string }[]
  >(() => cacheRead<DashCache>(DASH_ATT)?.records ?? []);
  /* v1.15.0: the same tasks response, kept un-filtered — the mobile Today
     checklist needs completed items too for its "2 of 4 done" count. */
  const [allTasks, setAllTasks] = useState<Task[]>(
    () => cacheRead<Task[]>(DASH_TASKS) ?? []
  );
  const [otEligible, setOtEligible] = useState(
    () => cacheRead<DashCache>(DASH_ATT)?.ot_eligible === true
  );
  const [leave, setLeave] = useState<LeaveReq[]>(
    () => cacheRead<LeaveReq[]>(DASH_LEAVE) ?? []
  );
  const [tasks, setTasks] = useState<Task[]>(() =>
    (cacheRead<Task[]>(DASH_TASKS) ?? [])
      .filter((x) => x.status !== "completed")
      .slice(0, 5)
  );
  const [anns, setAnns] = useState<Announcement[]>(
    () => cacheRead<Announcement[]>(DASH_ANNS) ?? []
  );
  /* v1.25.1 (CEO's screen recording: the card showed a green "Clock in" and
     "No attendance recorded today." for half a second — while he had ALREADY
     clocked in at 09:13). Root cause: `today` starts as [], which is
     indistinguishable from "loaded, and genuinely nothing". The card then
     states a confident WRONG answer and invites a second punch.
     Fix — UNKNOWN UNTIL PROVEN EMPTY: these flags say whether the answer is
     actually known yet. Unknown → skeleton. Known + empty → the real "None"
     message. They are SEEDED from remembered data, so a repeat open is not
     skeleton-then-truth but truth immediately (own punches are personal and
     non-financial, so instant display is safe). */
  const [attKnown, setAttKnown] = useState(
    () => cacheRead<DashCache>(DASH_ATT) !== null
  );
  const [leaveKnown, setLeaveKnown] = useState(
    () => cacheRead<LeaveReq[]>(DASH_LEAVE) !== null
  );
  const [tasksKnown, setTasksKnown] = useState(
    () => cacheRead<Task[]>(DASH_TASKS) !== null
  );
  const [annsKnown, setAnnsKnown] = useState(
    () => cacheRead<Announcement[]>(DASH_ANNS) !== null
  );
  const [busy, setBusy] = useState("");
  // v1.4.155: minute tick so the OT buttons appear at 18:00 MYT without a
  // manual refresh — the card is often left open on a phone all day.
  const [nowMins, setNowMins] = useState(() => {
    const m = new Date(Date.now() + 8 * 3600 * 1000);
    return m.getUTCHours() * 60 + m.getUTCMinutes();
  });
  useEffect(() => {
    const t = window.setInterval(() => {
      const m = new Date(Date.now() + 8 * 3600 * 1000);
      setNowMins(m.getUTCHours() * 60 + m.getUTCMinutes());
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  /* v1.25.1: paint remembered data first (instant + correct), then refresh.
     The four requests below used to run one after another — four round-trips
     stacked end to end on a phone; they now go together. */
  const applyAtt = useCallback((d: DashCache) => {
    setMonthRecs(d.records ?? []);
    setToday(
      (d.records ?? []).filter((r) => mytDateOf(r.created_at) === mytToday())
    );
    setTodayOt(
      (d.ot ?? []).filter((r) => mytDateOf(r.created_at) === mytToday())
    );
    setOtEligible(d.ot_eligible === true);
    setAttKnown(true);
  }, []);
  const applyTasks = useCallback((all: Task[]) => {
    setAllTasks(all);
    setTasks(all.filter((x) => x.status !== "completed").slice(0, 5));
    setTasksKnown(true);
  }, []);
  const load = useCallback(async () => {
    const month = new Date(Date.now() + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 7);
    const [a, l, t] = await Promise.all([
      api<DashCache>(`/staff/attendance?month=${month}`),
      api<{ leave: LeaveReq[] }>(`/staff/leave`),
      api<{ tasks: Task[] }>(`/staff/tasks`),
    ]);
    if (a.data) {
      applyAtt(a.data);
      cacheWrite(DASH_ATT, a.data);
    } else setAttKnown(true);
    const pending = (l.data?.leave ?? []).filter((x) => x.status === "pending");
    setLeave(pending);
    setLeaveKnown(true);
    if (l.data) cacheWrite(DASH_LEAVE, pending);
    applyTasks(t.data?.tasks ?? []);
    if (t.data) cacheWrite(DASH_TASKS, t.data.tasks ?? []);
    const n = await api<{ announcements: Announcement[] }>(
      `/staff/announcements`
    );
    setAnnsKnown(true);
    if (n.data?.announcements)
      cacheWrite(DASH_ANNS, n.data.announcements.slice(0, 3));
    setAnns((n.data?.announcements ?? []).slice(0, 3));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  /* v1.65.0 live: The dashboard is four cards in a trench coat, so it watches all four. */
  useLiveRefresh(["attendance", "leave", "tasks", "announcements"], load);

  const [punchToast, setPunchToast] = useState<{
    title: string;
    sub: string;
    variant?: "success" | "notice";
  } | null>(null);
  const [punchError, setPunchError] = useState("");
  /* v1.76.0 — the second tap. Armed by the first one, which explained what
     it will do; cleared as soon as any punch completes. */
  const [forgotArmed, setForgotArmed] = useState(false);
  /* v1.9.1 — office geofence replaces the selfie step. When a fence is set
     (management, Users tab), the punch grabs the phone's position first and
     the server refuses punches outside the radius. No fence → old behaviour. */
  const [fence, setFence] = useState<{
    configured: boolean;
    radius_m?: number;
    label?: string;
  } | null>(null);
  /* v1.17.0 — on-demand location check (CEO: "I still cant see the gps
     detection"). Runs the SAME server rule the punch enforces and mirrors
     the verdict back, without creating any record. Tap-initiated only: an
     automatic probe would fire the browser's location prompt on page open. */
  const [gpsCheck, setGpsCheck] = useState<
    | { state: "idle" | "busy" }
    | {
        state: "done";
        inside: boolean;
        distance_m: number;
        radius_m: number;
        label: string;
      }
    | { state: "error"; message: string; denied?: boolean }
  >({ state: "idle" });
  const checkLocation = async () => {
    setGpsCheck({ state: "busy" });
    const { gps, reason } = await getGpsFull();
    if (!gps) {
      /* v1.25.2: this used to say "blocked — check your browser settings" for
         EVERY failure, so staff who had already granted permission were sent
         to fix a setting that was correct. Each cause now gets its own words. */
      const msg =
        reason === "policy"
          ? lang === "ms"
            ? "Lokasi disekat oleh binaan laman web itu sendiri — bukan telefon anda. Maklumkan CEO/admin: deploy terkini perlu dijalankan (DEPLOY.bat penuh)."
            : "Location is blocked by the website build itself — NOT your phone. Tell the CEO/admin: the latest deploy needs to run (full DEPLOY.bat)."
          : reason === "denied"
            ? lang === "ms"
              ? "Lokasi disekat untuk laman ini — benarkan lokasi dalam tetapan tapak pelayar anda."
              : "Location is blocked for this site — allow it in your browser's site settings (the padlock/⋮ menu), not just in phone Settings."
            : reason === "unsupported"
              ? lang === "ms"
                ? "Pelayar ini tidak menyokong lokasi."
                : "This browser cannot provide location."
              : lang === "ms"
                ? "Tidak dapat isyarat lokasi — hidupkan Lokasi telefon, dekati tingkap dan cuba lagi."
                : "No location signal yet — switch phone Location ON, step near a window, then tap again.";
      setGpsCheck({
        state: "error",
        message: msg,
        denied: reason === "denied",
      });
      return;
    }
    const r = await api<{
      configured: boolean;
      inside?: boolean;
      distance_m?: number;
      radius_m?: number;
      label?: string;
    }>(`/staff/attendance/geofence/check`, {
      method: "POST",
      body: JSON.stringify({ gps }),
    });
    if (r.ok && r.data?.configured && typeof r.data.inside === "boolean") {
      setGpsCheck({
        state: "done",
        inside: r.data.inside,
        distance_m: r.data.distance_m ?? 0,
        radius_m: r.data.radius_m ?? 0,
        label: r.data.label ?? "the office",
      });
    } else {
      setGpsCheck({
        state: "error",
        message:
          lang === "ms"
            ? "Semakan gagal — cuba lagi."
            : "Check failed — try again.",
      });
    }
  };
  const fmtDist = (m: number) =>
    m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  useEffect(() => {
    void api<{ configured: boolean; radius_m?: number; label?: string }>(
      `/staff/attendance/geofence`
    ).then((r) => setFence(r.ok && r.data ? r.data : { configured: false }));
  }, []);
  /* v1.18.1: reports DENIED separately from "couldn't get a fix" — the CEO
     wants staff told when their punch was recorded without location, and
     "you blocked it" needs different words from "GPS timed out". */
  /* v1.25.2 (staff: "the location was not capture which is they already
     toggle on the location permission!" — screenshots showed Android
     permission correctly set to "Allow only while using the app" + precise
     location ON).
     THE BUG WAS OURS: a single high-accuracy request with a 10-second
     timeout. enableHighAccuracy asks the phone for a SATELLITE fix — which
     is exactly what does not work INSIDE a building, and inside the office
     is precisely where staff clock in. The request timed out, we reported
     "no location", and the person was told to check permissions they had
     already granted.
     Now it is staged: a short high-accuracy attempt (instant outdoors),
     then a fallback to NETWORK positioning (wifi/cell), which answers in
     about a second indoors and is accurate to tens of metres — far inside
     the 120 m office fence. A real denial short-circuits immediately; there
     is no point retrying a permission the person refused. */
  type GpsFail =
    "denied" | "timeout" | "unavailable" | "unsupported" | "policy";
  const getGpsFull = () =>
    new Promise<{
      gps: string | null;
      denied: boolean;
      reason: GpsFail | null;
    }>((resolve) => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        resolve({ gps: null, denied: false, reason: "unsupported" });
        return;
      }
      /* v1.26.3: the v1.23.5 _headers shipped Permissions-Policy geolocation=()
       — the SITE ITSELF forbade location, and Android browsers enforce that
       as an instant "denied", which we mislabelled as the phone blocking it
       for three releases. Chromium exposes the policy — check it FIRST, so
       if a build ever forbids geolocation again it announces itself as a
       deploy problem instead of sending staff to fix innocent phones. */
      const fp = (
        document as unknown as {
          featurePolicy?: { allowsFeature?: (f: string) => boolean };
        }
      ).featurePolicy;
      if (fp?.allowsFeature && !fp.allowsFeature("geolocation")) {
        resolve({ gps: null, denied: true, reason: "policy" });
        return;
      }
      const ok = (p: GeolocationPosition) =>
        resolve({
          gps: `${p.coords.latitude.toFixed(6)},${p.coords.longitude.toFixed(6)},${Math.round(p.coords.accuracy)}`,
          denied: false,
          reason: null,
        });
      const ask = (
        opts: PositionOptions,
        onFail: (e: { code: number }) => void
      ) => {
        // an insecure context throws synchronously — treat as unavailable
        try {
          navigator.geolocation.getCurrentPosition(ok, onFail, opts);
        } catch {
          onFail({ code: 2 });
        }
      };
      ask(
        { enableHighAccuracy: true, timeout: 6_000, maximumAge: 60_000 },
        (e1) => {
          if (e1.code === 1) {
            resolve({ gps: null, denied: true, reason: "denied" });
            return;
          }
          ask(
            { enableHighAccuracy: false, timeout: 15_000, maximumAge: 120_000 },
            (e2) => {
              resolve({
                gps: null,
                denied: e2.code === 1,
                reason:
                  e2.code === 1
                    ? "denied"
                    : e2.code === 3
                      ? "timeout"
                      : "unavailable",
              });
            }
          );
        }
      );
    });
  const getGps = async () => (await getGpsFull()).gps;
  /* v1.21.6 (CEO: "On mobile, I cant see the details of the task assigned…
     how to notify staff that he has a assigned schedule and roaster? The
     dashboard mobile view doesnt show any"): the bell/push notification
     already fires on assignment — what was missing is a PLACE on the phone
     where the schedule lives. This card shows the person's own upcoming
     roster/live sessions right on the Dashboard, both breakpoints. */
  type MySess = {
    id: number;
    session_date: string;
    start_time: string;
    end_time?: string | null;
    platform: string;
    client_company?: string | null;
    client_name?: string | null;
    host_user_id: number;
    status: string;
    notes?: string | null;
  };
  const [mySessions, setMySessions] = useState<MySess[]>([]);
  useEffect(() => {
    void api<{ sessions?: MySess[] }>(`/staff/live-sessions`).then((r) => {
      if (!r.ok || !r.data?.sessions) return;
      const todayIso = new Date(Date.now() + 8 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      setMySessions(
        r.data.sessions
          .filter(
            (s) =>
              s.host_user_id === user.id &&
              s.status === "scheduled" &&
              s.session_date >= todayIso
          )
          .slice(0, 5)
      );
    });
  }, [user.id]);

  const punch = async (type: string, forgot = false) => {
    // v1.4.113: flow is clock IN → clock OUT. Trying to clock out before
    // clocking in gets an instant popup (and the server refuses it too).
    /* v1.76.0 (CEO: "if they forget to clock in or clock out, they will be
       able to clock in and out but system will require them to get the
       approval"). Refusing outright meant a worked day could not be recorded
       at all and simply vanished from payroll. Now the first tap explains,
       and a second tap sends it to the CEO — recorded, but counting for
       nothing until it is approved and the real time set. */
    if (type === "clock_out" && !today.some((r) => r.type === "clock_in") && !forgot) {
      setPunchToast({
        title: L("You have not clocked in today", "Anda belum daftar masuk hari ini"),
        sub: L(
          "Tap Clock out again to send it to the CEO to approve — it will not count until then.",
          "Tekan Daftar keluar sekali lagi untuk hantar kepada CEO untuk kelulusan — ia tidak dikira sehingga itu."
        ),
        variant: "notice",
      });
      setForgotArmed(true);
      window.setTimeout(() => setPunchToast(null), 5200);
      return;
    }
    setBusy(type);
    setPunchError("");
    /* v1.18.1 (CEO): location is captured on EVERY punch, fence or no fence —
       fence OFF means it is recorded for the register without being enforced;
       fence ON keeps the server-side refusal. The prompt only ever fires on
       the punch tap itself (user-initiated), never on page load. */
    const { gps, denied: gpsDenied, reason: gpsReason } = await getGpsFull();
    // A likely duplicate (button shows ✓) is sent WITHOUT blocking on
    // location — the server answers "already punched" before the fence check.
    const likelyDup =
      type === "clock_in"
        ? today.some((r) => r.type === "clock_in")
        : today.some((r) => r.type === "clock_out");
    /* v1.21.4 (CEO): location is required on EVERY punch — no longer only
       when the fence config is present. The server refuses without it too;
       this check just gives the person the right words before a round-trip. */
    /* v1.25.3 (CEO: "record it, flag it loudly"): a phone whose permission is
       stuck must not cost someone their attendance record. The punch goes
       through carrying the REASON; the server stores it as NO LOCATION,
       shows it in red in the register and tells HR. We still say so plainly
       here so the person knows it was not a clean punch. */
    if (!gps && !likelyDup && gpsReason) {
      const res0 = await api<{ error?: { message?: string } }>(
        `/staff/attendance`,
        {
          method: "POST",
          body: JSON.stringify({ type, no_location_reason: gpsReason }),
        }
      );
      setBusy("");
      if (res0.queued) {
        setPunchToast({
          title: L("Kept — no signal", "Disimpan — tiada isyarat"),
          sub: L(
            "Saved on this phone with the time you pressed it. It will be sent the moment you are back online, and goes to the CEO to approve.",
            "Disimpan pada telefon ini dengan masa anda menekannya. Ia akan dihantar sebaik sahaja anda kembali dalam talian, dan dihantar kepada CEO untuk kelulusan.",
          ),
          variant: "notice",
        });
        window.setTimeout(() => setPunchToast(null), 6000);
        return;
      }
      if (res0.ok) {
        setPunchToast({
          title:
            type === "clock_in"
              ? L(
                  "Clocked in — without location",
                  "Daftar masuk — tanpa lokasi"
                )
              : L(
                  "Clocked out — without location",
                  "Daftar keluar — tanpa lokasi"
                ),
          sub: gpsDenied
            ? L(
                "Recorded and flagged for HR. Your phone is blocking location for this site — fix it with the steps on the Dashboard so tomorrow's punch is clean.",
                "Direkodkan dan ditandakan untuk HR. Telefon anda menyekat lokasi untuk laman ini — betulkan dengan langkah di Papan Pemuka supaya punch esok bersih."
              )
            : L(
                "Recorded and flagged for HR — no GPS signal here. Try near a window next time.",
                "Direkodkan dan ditandakan untuk HR — tiada isyarat GPS di sini. Cuba berdekatan tingkap lain kali."
              ),
          variant: "notice",
        });
        window.setTimeout(() => setPunchToast(null), 6000);
        void load();
        return;
      }
      setPunchToast({
        title: L("Location needed", "Lokasi diperlukan"),
        sub: gpsDenied
          ? L(
              `Location is blocked for THIS SITE — open the padlock/⋮ menu in your browser, allow Location, then tap ${type === "clock_in" ? "Clock in" : "Clock out"} again. (Phone Settings alone is not enough.)`,
              `Lokasi disekat untuk LAMAN INI — buka menu mangga/⋮ dalam pelayar anda, benarkan Lokasi, kemudian tekan ${type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} semula. (Tetapan telefon sahaja tidak mencukupi.)`
            )
          : L(
              `No location signal yet — check phone Location is ON, step near a window, then tap ${type === "clock_in" ? "Clock in" : "Clock out"} again.`,
              `Belum ada isyarat lokasi — pastikan Lokasi telefon HIDUP, dekati tingkap, kemudian tekan ${type === "clock_in" ? "Daftar masuk" : "Daftar keluar"} semula.`
            ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 4800);
      return;
    }
    const res = await api<{ flag?: string; pending?: boolean; error?: { message?: string } }>(
      `/staff/attendance`,
      {
        method: "POST",
        body: JSON.stringify({ type, ...(gps ? { gps } : {}), ...(forgot ? { forgot: true } : {}) }),
      }
    );
    setBusy("");
    setForgotArmed(false);
    /* v1.105.0 (roadmap phase 03) - no signal: the punch is KEPT on this
       phone (lib/outbox.ts) and sent when the network is back, carrying the
       time it was pressed. The CEO's decision: it is recorded at that time
       and goes to him to approve, like a forgotten punch. Say exactly that -
       "clocked in" would be a lie for another few minutes. */
    if (res.queued) {
      setPunchToast({
        title: type === "clock_in" ? L("Kept — no signal", "Disimpan — tiada isyarat") : L("Kept — no signal", "Disimpan — tiada isyarat"),
        sub: L(
          "Saved on this phone with the time you pressed it. It will be sent the moment you are back online, and goes to the CEO to approve.",
          "Disimpan pada telefon ini dengan masa anda menekannya. Ia akan dihantar sebaik sahaja anda kembali dalam talian, dan dihantar kepada CEO untuk kelulusan.",
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 6000);
      return;
    }
    if (res.ok && res.data?.pending) {
      setPunchToast({
        title: L("Sent to the CEO", "Dihantar kepada CEO"),
        sub: L(
          "Recorded and waiting for approval. It does not count towards your hours until the CEO approves it and sets the real time.",
          "Direkod dan menunggu kelulusan. Ia tidak dikira dalam jam kerja anda sehingga CEO meluluskannya dan menetapkan masa sebenar."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 5200);
      void load();
      return;
    }
    if (!res.ok && (res.data as { already?: boolean } | null)?.already) {
      // Already punched today — confirm it with the recorded time rather than
      // leaving the person unsure whether the tap registered.
      setPunchToast({
        title:
          type === "clock_in"
            ? L("Already clocked in", "Sudah daftar masuk")
            : L("Already clocked out", "Sudah daftar keluar"),
        sub:
          res.data?.error?.message?.replace(
            /^You already clocked (in|out) today at /,
            L("Recorded at ", "Direkodkan pada ")
          ) ?? L("Recorded earlier today", "Direkodkan lebih awal hari ini"),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3200);
      void load();
      return;
    }
    if (res.ok && res.data?.flag) {
      const label: Record<string, string> = {
        ok: L("On time", "Tepat masa"),
        late: L("Marked late", "Ditanda lewat"),
        half_day: L("Half day (after 12:00)", "Separuh hari (selepas 12:00)"),
        early_out: L("Early out (before 18:00)", "Keluar awal (sebelum 18:00)"),
        completed: L("Shift completed", "Syif selesai"),
        /* v1.109.0 - a part-time host is paid by the clock; the punch says so
           instead of measuring her against hours that do not apply */
        hourly: L("Counted by the clock", "Dikira mengikut jam"),
        assigned: L("Assigned work", "Kerja yang ditugaskan"),
        rest_day: L("Rest day", "Hari rehat"),
      };
      const now = new Date(Date.now() + 8 * 3600 * 1000);
      const hhmm = now.toISOString().slice(11, 16);
      setPunchToast({
        title:
          type === "clock_in"
            ? L("Clock-in recorded", "Daftar masuk direkodkan")
            : L("Clock-out recorded", "Daftar keluar direkodkan"),
        sub: `${label[res.data.flag] ?? res.data.flag} · ${hhmm} MYT${
          gps
            ? ""
            : gpsDenied
              ? L(
                  " · no location — enable location access for this site",
                  " · tiada lokasi — benarkan akses lokasi untuk laman ini"
                )
              : L(" · no location recorded", " · tiada lokasi direkodkan")
        }`,
        ...(gps ? {} : { variant: "notice" as const }),
      });
      window.setTimeout(() => setPunchToast(null), 2600);
    } else if (
      (res.data?.error as { code?: string } | undefined)?.code === "no_clock_in"
    ) {
      setPunchToast({
        title: L("Clock in first", "Daftar masuk dahulu"),
        sub:
          res.data?.error?.message ??
          L(
            "Clock in before clocking out.",
            "Daftar masuk sebelum daftar keluar."
          ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
    } else if (
      ["too_far", "location_required"].includes(
        (res.data?.error as { code?: string } | undefined)?.code ?? ""
      )
    ) {
      // v1.9.1: geofence refusals get a toast, not the red error line — being
      // outside the fence is expected behaviour, not a system fault.
      setPunchToast({
        title:
          (res.data?.error as { code?: string }).code === "too_far"
            ? L("Too far from the office", "Terlalu jauh dari pejabat")
            : L("Location needed", "Lokasi diperlukan"),
        sub:
          res.data?.error?.message ??
          L(
            "Move closer to the office and try again.",
            "Dekati pejabat dan cuba lagi."
          ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 5200);
    } else {
      setPunchError(
        res.data?.error?.message ??
          L("Punch failed — try again.", "Punch gagal — cuba lagi.")
      );
    }
    void load();
  };

  // v1.4.155: overtime punches. OT is pre-approved by the Section HOD — these
  // buttons record the hours, they are not the approval itself, and the toast
  // reminds the staff member of that every time.
  const punchOt = async (type: string) => {
    if (!today.some((r) => r.type === "clock_in")) {
      setPunchToast({
        title: L("Clock in first", "Daftar masuk dahulu"),
        sub: L(
          "No clock-in recorded today — overtime can only follow a worked day.",
          "Tiada daftar masuk direkodkan hari ini — OT hanya boleh selepas hari bekerja."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
      return;
    }
    if (type === "ot_out" && !todayOt.some((r) => r.type === "ot_in")) {
      setPunchToast({
        title: L("OT in first", "OT masuk dahulu"),
        sub: L(
          "Tap OT in when overtime starts, then OT out when you finish.",
          "Tekan OT in apabila OT bermula, kemudian OT out apabila selesai."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
      return;
    }
    setBusy(type);
    setPunchError("");
    // v1.9.1: OT punches are gated by the same office fence as clock punches.
    // v1.18.1: position captured on every OT punch too (recorded even with
    // the fence off — they are the paid hours).
    const otGps = await getGps();
    // v1.21.4: OT punches carry the same location requirement as clock punches.
    if (!otGps) {
      setBusy("");
      setPunchToast({
        title: L("Location needed", "Lokasi diperlukan"),
        sub: L(
          "OT punches need your location — allow location access and try again.",
          "Punch OT memerlukan lokasi anda — benarkan akses lokasi dan cuba lagi."
        ),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 4200);
      return;
    }
    const res = await api<{ at?: string; error?: { message?: string } }>(
      `/staff/attendance/ot`,
      {
        method: "POST",
        body: JSON.stringify({ type, ...(otGps ? { gps: otGps } : {}) }),
      }
    );
    setBusy("");
    if (!res.ok && (res.data as { already?: boolean } | null)?.already) {
      setPunchToast({
        title:
          type === "ot_in"
            ? L("OT in already recorded", "OT masuk sudah direkodkan")
            : L("OT out already recorded", "OT keluar sudah direkodkan"),
        sub:
          res.data?.error?.message?.replace(
            /^You already recorded OT (in|out) today at /,
            L("Recorded at ", "Direkodkan pada ")
          ) ?? L("Recorded earlier today", "Direkodkan lebih awal hari ini"),
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3200);
      void load();
      return;
    }
    if (res.ok && res.data?.at) {
      setPunchToast({
        title:
          type === "ot_in"
            ? L("OT in recorded", "OT masuk direkodkan")
            : L("OT out recorded", "OT keluar direkodkan"),
        sub:
          type === "ot_in"
            ? L(
                `${res.data.at} MYT — only proceed if your Section HOD approved this overtime.`,
                `${res.data.at} MYT — teruskan hanya jika HOD Seksyen anda meluluskan OT ini.`
              )
            : L(
                `${res.data.at} MYT — overtime completed. Thank you.`,
                `${res.data.at} MYT — OT selesai. Terima kasih.`
              ),
      });
      window.setTimeout(() => setPunchToast(null), 3200);
    } else if (res.data?.error?.message) {
      setPunchToast({
        title: L("Overtime", "OT"),
        sub: res.data.error.message,
        variant: "notice",
      });
      window.setTimeout(() => setPunchToast(null), 3600);
    } else {
      setPunchError(
        L("OT punch failed — try again.", "Punch OT gagal — cuba lagi.")
      );
    }
    void load();
  };

  const hasIn = today.some((r) => r.type === "clock_in");
  const hasOut = today.some((r) => r.type === "clock_out");
  const hasOtIn = todayOt.some((r) => r.type === "ot_in");
  const hasOtOut = todayOt.some((r) => r.type === "ot_out");
  // OT buttons: eligible staff only (not part-time live hosts), from 18:00 MYT
  // on weekdays. v1.4.179 (CEO): WEEKENDS are rest days — any work is OT, so
  // the buttons show ALL DAY on Sat/Sun (executives stay excluded via
  // ot_eligible). Also kept visible after a punch exists so a recorded OT day
  // never "loses" its buttons to a clock edge case.
  const isWeekendMYT = [0, 6].includes(
    new Date(Date.now() + 8 * 3600 * 1000).getUTCDay()
  );
  const showOt =
    otEligible && (isWeekendMYT || nowMins >= 18 * 60 || todayOt.length > 0);

  /* v1.15.0 — personal month stats from the punches already fetched.
     Hours pair the FIRST clock-in with the LAST clock-out per MYT day, so a
     duplicate punch can't double-count; a day still in progress contributes
     presence but no hours (honest: we don't know the total yet). */
  const dayPairs = (() => {
    const m = new Map<string, { in?: number; out?: number }>();
    for (const r of monthRecs) {
      const d = mytDateOf(r.created_at);
      const t = new Date(r.created_at.replace(" ", "T") + "Z").getTime();
      const e = m.get(d) ?? {};
      if (r.type === "clock_in")
        e.in = e.in === undefined ? t : Math.min(e.in, t);
      if (r.type === "clock_out")
        e.out = e.out === undefined ? t : Math.max(e.out, t);
      m.set(d, e);
    }
    return m;
  })();
  const daysPresent = dayPairs.size;
  const monthHours = Array.from(dayPairs.values()).reduce(
    (a, e) =>
      a +
      (e.in !== undefined && e.out !== undefined && e.out > e.in
        ? Math.min((e.out - e.in) / 3_600_000, 16)
        : 0),
    0
  );
  const doneTasks = allTasks.filter((t) => t.status === "completed").length;

  /* v1.10.0 (reference design): the mockup's punchy action buttons — taller
     and rounder on phones, pixel-identical to btnClass/btnGhost from `sm` up.
     Self-contained strings (NOT btnClass + overrides): two conflicting
     unprefixed utilities like h-9 + h-12 resolve by stylesheet order, not
     class order — a silent trap. Class changes ONLY; every handler, guard
     and geofence path is untouched. */
  const qaPrimary =
    "bg-primary text-primary-foreground hover:bg-primary/85 inline-flex items-center px-4 transition-colors disabled:opacity-50 h-12 justify-center rounded-xl text-[15px] font-semibold md:h-9 md:justify-start md:rounded-lg md:text-sm md:font-medium";
  const qaGhost =
    "border-border inline-flex items-center border px-4 transition-colors hover:bg-secondary max-md:disabled:opacity-50 h-12 justify-center rounded-xl text-[15px] font-semibold md:h-9 md:justify-start md:rounded-lg md:text-sm md:font-medium";

  return (
    <div className="space-y-3 md:space-y-6">
      {/* v1.15.0 — mobile Today greeting: date line + time-of-day hello, the
          top of the reference's phone screen. Phones only; the desktop header
          already greets. */}
      <div className="md:hidden">
        <p className="text-muted-foreground text-[12px]">
          {mytTodayLine(lang)}
        </p>
        <h2 className="mt-0.5 text-[23px] font-semibold tracking-tight">
          {mytGreeting(lang)}, {user.name.split(" ")[0]}
        </h2>
      </div>
      {/* v1.116.0 — THE DASHBOARD IN FOUR ZONES. The CEO, 06-09-2026: *"for
          the Dashboard I want UI/UX being re-organized for better user
          experience and at the same time the user interface well organized
          ... both are being checked - Webview and Mobile apps view"*. One
          order for both screens, read top to bottom: MY DAY (the buttons
          and the four numbers that explain them) - WAITING ON ME (the desk,
          the watchers, the next event, my sessions) - THE COMPANY (the
          sales floor, for the roles that have it, moved up from the bottom
          of the page) - AROUND ME (leave, tasks, news, my attendance, the
          calendar). Every card kept its content and its gate; three
          duplicates folded: the sales floor greeting, and the phone-only
          twin of the KPI tiles. The zone captions are text, not chrome. */}
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("My day", "Hari saya")}</ZoneLabel>
      {/* v1.115.0 — QUICK ACTIONS FIRST. The CEO, 05-09-2026, with the
          Dashboard on screen: *"Quick actions should be on the top so that
          user easily to click. also on the mobile apps view"*. Clock in is
          the one thing everybody does every day; it was three cards down,
          under the desk and the watchers. The card is unchanged, only
          moved - on every screen size, since the phone view is the same
          tree. */}
      <div className={card}>
        {/* "On shift" once clocked in (the reference design's heading),
            "Quick actions" before that. */}
        <p className="text-[15px] font-semibold md:text-sm">
          {hasIn && !hasOut ? tr("On shift", lang) : tr("Quick actions", lang)}
        </p>
        {/* v1.4.146: 2-up grid on phones — equal-width, thumb-friendly, no
            ragged wrapping; the desktop keeps its inline row. v1.10.0: the
            flip moved sm→md so the whole mobile shell (nav, hero, cards,
            buttons) switches at ONE breakpoint. */}
        {/* v1.25.1: until the punches are KNOWN, show skeleton buttons — never
            a green "Clock in" for someone who already clocked in. */}
        {!attKnown ? (
          <div
            className="mt-2.5 grid grid-cols-2 gap-2 md:flex md:flex-wrap"
            aria-busy="true"
          >
            {[0, 1, 2, 3].map((i) => (
              <Skel key={i} className="h-10 rounded-lg md:w-36" />
            ))}
          </div>
        ) : (
          <div className="mt-2.5 grid grid-cols-2 gap-2 md:flex md:flex-wrap">
            <button
              type="button"
              /* v1.15.0: phones get the reference's green Clock in. tile tokens,
               not --success — that one flips to a light text-green in dark
               mode and white text on it would fail contrast. Desktop (md:)
               keeps qaPrimary's navy exactly. */
              className={`${qaPrimary} ${!hasIn ? "max-md:bg-tile-success max-md:text-tile-success-fg max-md:hover:bg-tile-success/90" : ""}`}
              disabled={!!busy}
              onClick={() => void punch("clock_in")}
            >
              {hasIn ? tr("Clocked in ✓", lang) : <><AppIcon name="place" className="mr-1 -mt-0.5" />{tr("Clock in", lang)}</>}
            </button>
            <button
              type="button"
              className={qaGhost}
              disabled={!!busy}
              onClick={() => void punch("clock_out", forgotArmed)}
            >
              {hasOut ? tr("Clocked out ✓", lang) : tr("Clock out", lang)}
            </button>
            <button
              type="button"
              className={qaGhost}
              onClick={() => go("Leave")}
            >
              {tr("Apply leave", lang)}
            </button>
            {SALES_ROLES.includes(user.role) && (
              <button
                type="button"
                className={qaGhost}
                onClick={() => go("Sales")}
              >
                {tr("Create quotation", lang)}
              </button>
            )}
            {showOt && (
              <>
                <button
                  type="button"
                  className={hasOtIn ? qaGhost : qaPrimary}
                  disabled={!!busy}
                  onClick={() => void punchOt("ot_in")}
                >
                  {hasOtIn ? "OT in ✓" : "OT in"}
                </button>
                <button
                  type="button"
                  className={qaGhost}
                  disabled={!!busy}
                  onClick={() => void punchOt("ot_out")}
                >
                  {hasOtOut ? "OT out ✓" : "OT out"}
                </button>
              </>
            )}
          </div>
        )}
        {showOt && (
          <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs font-medium text-warning">
            {L(
              "Working overtime today? OT in / OT out only with your Section HOD's approval — tap OT in when it starts and OT out when you finish.",
              "Bekerja OT hari ini? OT in / OT out hanya dengan kelulusan HOD Seksyen anda — tekan OT in apabila bermula dan OT out apabila selesai."
            )}
            {isWeekendMYT
              ? L(
                  " Weekend: the whole day counts as overtime — no normal clock-in needed.",
                  " Hujung minggu: sepanjang hari dikira OT — tiada daftar masuk biasa diperlukan."
                )
              : ""}
          </p>
        )}
        {punchError && (
          <p className="text-destructive mt-2 text-xs font-medium">
            {punchError}
          </p>
        )}
        {punchToast && (
          <PunchToast
            title={punchToast.title}
            sub={punchToast.sub}
            variant={punchToast.variant}
          />
        )}
        {/* v1.9.1: clock-out reminder — mirrors the 18:30/22:00 bell + push
            from the cron, for the person who has the tab open right now. */}
        {hasIn && !hasOut && nowMins >= 18 * 60 + 30 && (
          <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs font-medium text-warning">
            <AppIcon name="time" className="mr-1 -mt-0.5 h-3.5 w-3.5" />{tr("Don't forget to clock out", lang)}
            {hasOtIn && !hasOtOut
              ? L(
                  " (and OT out when overtime ends)",
                  " (dan OT out apabila OT tamat)"
                )
              : ""}{" "}
            — {tr("tap Clock out before you leave.", lang)}
          </p>
        )}
        {fence?.configured && (
          <>
            {/* v1.15.0 — phone: the reference's readiness strip. Config only,
                deliberately NOT a live GPS probe: reading the position here
                would fire the browser's location prompt on every Dashboard
                open, before the person asked to punch. The real check stays
                where it belongs — server-side, at the punch. */}
            <div className="bg-secondary mt-2.5 rounded-xl px-3 py-2.5 md:hidden">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[12px] font-medium">
                  <ShieldOk
                    aria-hidden
                    className="h-4 w-4"
                    strokeWidth={1.75}
                  />
                  {lang === "ms"
                    ? "Semakan lokasi pejabat aktif"
                    : "Office location check is on"}
                </span>
                <button
                  type="button"
                  onClick={() => void checkLocation()}
                  disabled={gpsCheck.state === "busy"}
                  className="text-gold-deep rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap disabled:opacity-50"
                >
                  {gpsCheck.state === "busy"
                    ? lang === "ms"
                      ? "Menyemak…"
                      : "Checking…"
                    : lang === "ms"
                      ? "Semak lokasi saya"
                      : "Check my location"}
                </button>
              </div>
              {gpsCheck.state === "done" && (
                <p
                  className={`mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold ${gpsCheck.inside ? "text-success" : "text-warning"}`}
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${gpsCheck.inside ? "bg-success" : "bg-warning"}`}
                  />
                  {gpsCheck.inside
                    ? lang === "ms"
                      ? `Dalam kawasan — ${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label}`
                      : `Inside — ${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label}`
                    : GEOFENCE_EXEMPT_ROLES.includes(user.role)
                      ? lang === "ms"
                        ? `${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label} — lokasi anda direkodkan`
                        : `${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label} — your location is recorded`
                      : lang === "ms"
                        ? `Luar kawasan — ${fmtDist(gpsCheck.distance_m)} dari ${gpsCheck.label}. Daftar masuk direkodkan & DITANDAKAN untuk HR.`
                        : `Outside — ${fmtDist(gpsCheck.distance_m)} from ${gpsCheck.label}. Your punch is recorded and FLAGGED for HR.`}
                </p>
              )}
              {gpsCheck.state === "error" && (
                <p className="text-warning mt-1.5 text-[12px] font-medium">
                  {gpsCheck.message}
                </p>
              )}
            </div>
            <p className="text-muted-foreground mt-2 hidden text-[11px] md:block">
              {tr("Office check-in is on", lang)} —{" "}
              {GEOFENCE_EXEMPT_ROLES.includes(user.role)
                ? lang === "ms"
                  ? "lokasi anda direkodkan pada setiap daftar masuk/keluar."
                  : "your location is recorded with every punch."
                : lang === "ms"
                  ? `punch memerlukan lokasi; di luar ${fence.radius_m ?? 120} m dari ${fence.label ?? "pejabat"} ia direkodkan dan ditandakan untuk HR.`
                  : `punches require your location; outside ${fence.radius_m ?? 120} m of ${fence.label ?? "the office"} they are recorded and flagged for HR.`}{" "}
              <button
                type="button"
                className="text-gold-deep font-semibold underline-offset-2 hover:underline disabled:opacity-50"
                onClick={() => void checkLocation()}
                disabled={gpsCheck.state === "busy"}
              >
                {gpsCheck.state === "busy"
                  ? lang === "ms"
                    ? "Menyemak…"
                    : "Checking…"
                  : lang === "ms"
                    ? "Semak lokasi saya"
                    : "Check my location"}
              </button>
              {gpsCheck.state === "done" && (
                <span
                  className={`ml-1.5 font-semibold ${gpsCheck.inside ? "text-success" : "text-warning"}`}
                >
                  {gpsCheck.inside
                    ? L(
                        `✓ ${fmtDist(gpsCheck.distance_m)} — inside`,
                        `✓ ${fmtDist(gpsCheck.distance_m)} — dalam kawasan`
                      )
                    : L(
                        `${fmtDist(gpsCheck.distance_m)} — outside${GEOFENCE_EXEMPT_ROLES.includes(user.role) ? "" : " (punch will be flagged)"}`,
                        `${fmtDist(gpsCheck.distance_m)} — luar kawasan${GEOFENCE_EXEMPT_ROLES.includes(user.role) ? "" : " (punch akan ditandakan)"}`
                      )}
                </span>
              )}
              {gpsCheck.state === "error" && (
                <>
                  <span className="text-warning ml-1.5">
                    {gpsCheck.message}
                  </span>
                  {/* v1.25.3: "tap the padlock" is impossible when the portal
                      was opened from a home-screen icon — the steps below are
                      chosen from what this phone actually is. */}
                  {gpsCheck.denied && <LocationHelp lang={lang} />}
                </>
              )}
            </p>
          </>
        )}
        {!attKnown ? (
          <Skel className="mt-3 h-3 w-48" />
        ) : (
          <p className="text-muted-foreground mt-3 text-xs">
            {today.length === 0 && todayOt.length === 0
              ? L(
                  "No attendance recorded today.",
                  "Tiada kehadiran direkodkan hari ini."
                )
              : `${L("Today", "Hari ini")}: ${[
                  ...today.slice().reverse(),
                  ...todayOt.slice().reverse(),
                ]
                  .map(
                    (r) =>
                      `${
                        getLang() === "ms"
                          ? ((
                              {
                                clock_in: "masuk",
                                clock_out: "keluar",
                                ot_in: "OT masuk",
                                ot_out: "OT keluar",
                              } as Record<string, string>
                            )[r.type] ?? r.type)
                          : r.type.startsWith("ot_")
                            ? r.type.replace("ot_", "OT ")
                            : r.type.replace("_", " ")
                      } ${mytTime(r.created_at)}`
                  )
                  .join(" · ")}`}
          </p>
        )}
      </div>

      {/* v1.15.0 — personal KPI strip: my day and my month at a glance, from
          data this component already fetched. v1.116.0: on every screen - four
          across on the desk, two by two on the phone - directly under the
          buttons they explain; the phone-only "This month" twin is gone. */}
      {/* v1.25.1: the KPI tiles derive from the SAME punches — while those are
          unknown they would read "—", "Not clocked in yet" and 0 days, which
          is the same false answer as the button bug. Skeletons until known. */}
      {!attKnown ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <SkelStat key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className={card}>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {tr("Today", lang)}
            </p>
            <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {hasIn
                ? mytTime(
                    today.filter((r) => r.type === "clock_in").slice(-1)[0]
                      ?.created_at ?? ""
                  )
                : "—"}
            </p>
            <p className="text-muted-foreground mt-2 text-[11.5px]">
              {hasOut
                ? L("Shift completed", "Syif selesai")
                : hasIn
                  ? L("On shift", "Sedang bertugas")
                  : L("Not clocked in yet", "Belum daftar masuk")}
            </p>
            <div className="bg-tint-navy mt-3 h-1 overflow-hidden rounded-full">
              <i
                className={`block h-full rounded-full ${hasOut ? "bg-ring-ontime w-full" : hasIn ? "bg-gold-solid w-1/2" : "w-0"}`}
              />
            </div>
          </div>
          <div className={card}>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {L("Days present · month", "Hari hadir · bulan")}
            </p>
            <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {daysPresent}
            </p>
            <p className="text-muted-foreground mt-2 text-[11.5px]">
              {L("attendance recorded", "kehadiran direkodkan")}
            </p>
            <div className="bg-tint-navy mt-3 h-1 overflow-hidden rounded-full">
              <i
                className="bg-bar-high block h-full rounded-full"
                style={{ width: `${Math.min(100, (daysPresent / 22) * 100)}%` }}
              />
            </div>
          </div>
          <div className={card}>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {L("Hours · month", "Jam · bulan")}
            </p>
            <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {monthHours.toFixed(1)}
            </p>
            <p className="text-muted-foreground mt-2 text-[11.5px]">
              {L(
                "first in → last out, per day",
                "masuk pertama → keluar terakhir, setiap hari"
              )}
            </p>
            <div className="bg-tint-navy mt-3 h-1 overflow-hidden rounded-full">
              <i
                className="bg-gold-solid block h-full rounded-full"
                style={{ width: `${Math.min(100, (monthHours / 176) * 100)}%` }}
              />
            </div>
          </div>
          <div className={card}>
            <p className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {L("Open tasks", "Tugasan terbuka")}
            </p>
            <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {tasks.length}
            </p>
            <p className="text-muted-foreground mt-2 text-[11.5px]">
              {leave.length > 0
                ? L(
                    `+ ${leave.length} leave pending`,
                    `+ ${leave.length} cuti menunggu`
                  )
                : L("no leave pending", "tiada cuti menunggu")}
            </p>
            <div className="bg-tint-navy mt-3 h-1 overflow-hidden rounded-full">
              <i
                className={`block h-full rounded-full ${tasks.length > 0 ? "bg-bar-mid w-2/3" : "bg-ring-ontime w-full"}`}
              />
            </div>
          </div>
        </div>
      )}
      </section>
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Waiting on me", "Menunggu saya")}</ZoneLabel>
      {/* v1.106.0 (roadmap phase 04) — ONE DESK. Everything waiting on this
          person, from every module. One quiet line when there is nothing.
          v1.115.0: it follows the Quick actions card - the CEO put the
          clock-in first - and stays above everything else. */}
      <OneDesk go={(t) => go(t as TabName)} />
      {/* v1.108.0 — WATCHERS, executive tier: what the company's rules find
          true right now, and (CEO) the rules themselves. One quiet line when
          nothing is. */}
      <WatchersCard role={user.role} go={(t) => go(t as TabName)} />
      {/* v1.10.0: the hero card — phones only, the desktop keeps its layout */}
      <NextEventCard lang={lang} />
      {/* v1.21.6 — My schedule: the person's own upcoming roster/live
          sessions, on the Dashboard where the phone actually opens. */}
      {mySessions.length > 0 && (
        <div className={card}>
          <p className="text-[15px] font-semibold md:text-sm">
            {lang === "ms" ? "Jadual saya" : "My schedule"}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {lang === "ms"
              ? "Sesi roster yang ditetapkan kepada anda — anda dimaklumkan setiap kali satu ditambah atau dipindah."
              : "Roster sessions assigned to you — you are notified whenever one is added or moved."}
          </p>
          <div className="mt-1.5">
            {mySessions.map((s) => {
              const todayIso = new Date(Date.now() + 8 * 3600 * 1000)
                .toISOString()
                .slice(0, 10);
              const isToday = s.session_date === todayIso;
              return (
                <div
                  key={s.id}
                  className="border-border border-b py-2 text-sm last:border-0 last:pb-0"
                >
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    <span
                      className={`font-semibold tabular-nums ${isToday ? "text-gold-deep" : ""}`}
                    >
                      {isToday
                        ? lang === "ms"
                          ? "HARI INI"
                          : "TODAY"
                        : dmy(s.session_date)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {s.start_time}
                      {s.end_time ? `–${s.end_time}` : ""}
                    </span>
                    <span className="bg-secondary rounded-full px-2 py-0.5 text-[10px]">
                      {s.platform}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[13px] font-medium">
                    {s.client_company ??
                      s.client_name ??
                      L("Live session", "Sesi LIVE")}
                    {s.notes ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        — {s.notes}
                      </span>
                    ) : null}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </section>
      {/* v1.5.0: the hero band became the Sales Floor — a trading-desk view
          of today, the KPI target (auto-computed from history), product vs
          service market targets, motivation and boost suggestions. */}
      <TradingDesk user={user} go={go} lang={lang} />
      <section className="space-y-3 md:space-y-4">
        <ZoneLabel>{L("Around me", "Sekeliling saya")}</ZoneLabel>
      {/* v1.15.0 — mobile Today checklist: the reference's two-column card
          grid with a progress count. Same tasks the desktop list shows; the
          full response (incl. completed) so "2 of 4 done" is countable.
          Tapping any card opens the Tasks tab — editing stays there. */}
      {allTasks.length > 0 && (
        <div className="md:hidden">
          <div className="mb-2 flex items-baseline justify-between px-0.5">
            <p className="text-[15px] font-semibold">
              {lang === "ms" ? "Senarai semak hari ini" : "Today's checklist"}
            </p>
            <p className="text-muted-foreground text-[11.5px]">
              {doneTasks} {lang === "ms" ? "daripada" : "of"} {allTasks.length}{" "}
              {lang === "ms" ? "selesai" : "done"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {allTasks.slice(0, 6).map((t) => {
              const done = t.status === "completed";
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => go("Tasks")}
                  className={`border-border bg-card flex min-h-[64px] flex-col gap-1.5 rounded-2xl border p-3 text-left ${done ? "opacity-70" : ""}`}
                >
                  <span
                    aria-hidden
                    className={`grid h-5 w-5 place-items-center rounded-md text-[11px] ${
                      done
                        ? "bg-success-soft text-success"
                        : "bg-tint-gold text-gold-deep"
                    }`}
                  >
                    {done ? "✓" : "◷"}
                  </span>
                  <span
                    className={`text-[12px] leading-snug font-medium ${done ? "line-through" : ""}`}
                  >
                    {t.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* v1.4.214 (CEO reorg): LiveGmvCard + ConnectionStatusCard moved to
          the new Ecommerce tab — the Dashboard is Quick actions → the
          three-column day view → Upcoming events. */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <div className={card}>
          <p
            className="cursor-pointer text-[15px] font-semibold md:text-sm"
            role="button"
            tabIndex={0}
            onClick={() => go("Leave")}
            onKeyDown={(e) => e.key === "Enter" && go("Leave")}
          >
            {tr("Pending leave", lang)}
            {leave.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                {leave.length}
              </span>
            )}
          </p>
          {!leaveKnown ? (
            <SkelText lines={2} className="mt-2.5" />
          ) : leave.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {tr("None pending.", lang)}
            </p>
          ) : (
            leave.map((l) => (
              <p key={l.id} className="mt-2 text-sm">
                {leaveTypeL(l.type)} · {dmy(l.start_date)} → {dmy(l.end_date)} (
                {l.days}d)
              </p>
            ))
          )}
        </div>
        <div className={card}>
          <p
            className="cursor-pointer text-[15px] font-semibold md:text-sm"
            role="button"
            tabIndex={0}
            onClick={() => go("Tasks")}
            onKeyDown={(e) => e.key === "Enter" && go("Tasks")}
          >
            {tr("My open tasks", lang)}
            {tasks.length > 0 && (
              <span className="ml-2 inline-flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                {tasks.length}
              </span>
            )}
          </p>
          {!tasksKnown ? (
            <SkelText lines={2} className="mt-2.5" />
          ) : tasks.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {tr("Nothing assigned.", lang)}
            </p>
          ) : (
            tasks.map((t) => (
              <p key={t.id} className="mt-2 text-sm">
                {t.title}{" "}
                <span className="text-muted-foreground">
                  · {priorityL(t.priority)}
                  {t.deadline
                    ? L(` · due ${t.deadline}`, ` · sebelum ${t.deadline}`)
                    : ""}
                </span>
              </p>
            ))
          )}
        </div>
        <div className={card}>
          <p
            className="cursor-pointer text-[15px] font-semibold md:text-sm"
            role="button"
            tabIndex={0}
            onClick={() => go("Announcements")}
            onKeyDown={(e) => e.key === "Enter" && go("Announcements")}
          >
            {tr("News", lang)}
            {anns.length > 0 && (
              <span
                className="ml-2 inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500"
                aria-hidden="true"
              ></span>
            )}
          </p>
          {!annsKnown ? (
            <SkelText lines={2} className="mt-2.5" />
          ) : anns.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {tr("No announcements.", lang)}
            </p>
          ) : (
            anns.map((a) => (
              <p key={a.id} className="mt-2 text-sm">
                <span className="font-medium">{a.title}</span>{" "}
                <span className="text-muted-foreground">
                  · {annCatL(a.category)}
                </span>
              </p>
            ))
          )}
        </div>
      </div>
      {/* v1.116.0 - two reference lists of similar weight, side by side on
          the desk, stacked on the phone. */}
      <div className={`grid grid-cols-1 gap-4 md:gap-6 ${monthRecs.length > 0 ? "lg:grid-cols-2" : ""}`}>
      {/* v1.15.0 — desktop: my attendance, day by day. First-in → last-out
          hours; today in navy; a gold half-bar marks a day still in progress
          (in, no out yet) rather than pretending the hours are known. */}
      {monthRecs.length > 0 && (
        <div className={`${card} hidden md:block`}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">
              {lang === "ms" ? "Kehadiran saya" : "My attendance"} —{" "}
              {MONTH_NAMES[lang][Number(mytToday().slice(5, 7)) - 1]}
            </p>
            <p className="text-muted-foreground text-[11.5px]">
              {daysPresent} {lang === "ms" ? "hari" : "days"} ·{" "}
              {monthHours.toFixed(1)} h
            </p>
          </div>
          <div className="flex h-28 items-end gap-[3px]">
            {(() => {
              const todayS = mytToday();
              const [yy, mm] = [
                Number(todayS.slice(0, 4)),
                Number(todayS.slice(5, 7)),
              ];
              const daysIn = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
              return Array.from({ length: daysIn }, (_, i) => {
                const d = `${todayS.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`;
                const e = dayPairs.get(d);
                const hrs =
                  e && e.in !== undefined && e.out !== undefined && e.out > e.in
                    ? Math.min((e.out - e.in) / 3_600_000, 16)
                    : 0;
                const open =
                  !!e &&
                  e.in !== undefined &&
                  (e.out === undefined || e.out <= (e.in ?? 0));
                const pct = Math.max(
                  hrs > 0 ? 8 : 0,
                  Math.round((hrs / 12) * 100)
                );
                return (
                  <div
                    key={d}
                    className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1"
                    role="img"
                    aria-label={`${d}: ${open ? L("on shift, in progress", "sedang bertugas") : `${hrs.toFixed(1)} ${L("hours", "jam")}`}`}
                  >
                    <div
                      className={`w-full rounded-t-[3px] ${d === todayS ? "bg-bar-high" : open ? "bg-gold-solid" : hrs > 0 ? "bg-bar-low group-hover:bg-bar-mid" : "bg-tint-navy"}`}
                      style={{
                        height: open && hrs === 0 ? "40%" : `${pct}%`,
                        minHeight: "2px",
                      }}
                    />
                    <span
                      className={`text-[9px] tabular-nums ${d === todayS ? "text-foreground font-semibold" : "text-muted-foreground"} ${(i + 1) % 5 === 0 || i === 0 || d === todayS ? "" : "invisible"}`}
                    >
                      {i + 1}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
          <div className="text-muted-foreground mt-2 flex gap-4 text-[11px]">
            <span>
              <i className="bg-bar-low mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" />
              {L("Worked", "Bekerja")}
            </span>
            <span>
              <i className="bg-gold-solid mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" />
              {L("In progress", "Sedang berlangsung")}
            </span>
            <span>
              <i className="bg-bar-high mr-1.5 inline-block h-2 w-2 rounded-[2px] align-middle" />
              {L("Today", "Hari ini")}
            </span>
          </div>
        </div>
      )}
      {/* v1.4.277 (CEO): Sales revenue MOVED to the Ecommerce tab — the
          hero band already carries today + month + overall up top, so the
          detailed month card was the Dashboard's third telling of the same
          story. Ecommerce is where the channel detail lives. */}
      {/* v1.10.0: id anchor — the mobile hero card scrolls here on tap */}
      <div id="upcoming-events" className="scroll-mt-16">
        <UpcomingEventsCard role={user.role} />
      </div>
      </div>
      </section>
    </div>
  );
}

/* ================= Sales revenue (v1.4.75) ================= */

export const REVENUE_ROLES = [
  "super_admin",
  "admin",
  "ceo",
  "coo",
  "cco",
  "sales_marketing",
  "marketing",
  "hr_admin",
];

export interface RevenueData {
  month: string;
  last_month: string;
  today?: {
    date: string;
    tiktok_cents: number;
    tiktok_orders: number;
    invoiced_cents: number;
    invoiced_docs: number;
    other_cents?: number;
    manual_cents?: number;
  };
  yesterday?: { date: string; total_cents: number }; // v1.4.206 trend arrow
  other?: {
    this_cents: number;
    this_orders: number;
    last_cents: number;
    last_orders: number;
  }; // v1.4.169 non-TikTok shipments
  manual?: {
    this_cents: number;
    this_units: number;
    last_cents: number;
    last_units: number;
  }; // v1.4.169 manual sales
  tiktok: {
    this_cents: number;
    this_orders: number;
    last_cents: number;
    last_orders: number;
  };
  invoiced: {
    this_cents: number;
    this_docs: number;
    last_cents: number;
    last_docs: number;
  };
  outstanding?: { cents: number; docs: number };
  overall?: {
    total_cents: number;
    months: { month: string; cents: number }[];
    best?: { month: string; cents: number };
  }; // v1.4.276 all-time, all channels
  target_cents?: number | null;
  next_month?: string;
  last_target_cents?: number | null;
  next_target_cents?: number | null;
}

/** Sales revenue at a glance — TikTok order amounts (captured by the sync)
    plus invoices issued, this month vs last. */
/* v1.4.270 — the brand-toned hero band (CEO approved: "firmly brand-toned,
   and hero band + row bars"). Structure from his reference screenshot,
   palette from the brand: ONE navy solid card for the single most important
   number, white + gold for the rest — the v1.4.253 one-fill rule applied to
   cards. Renders progressively: each card appears when its data arrives, and
   a role that can't see revenue simply gets the cards it can see. */
export interface DashSummary {
  today: string;
  pending_leave: number | null;
  pending_claims: number | null;
  pending_ot: number | null;
  low_stock: number | null;
  open_quotations: number | null;
  // v1.7.0 company pulse
  clients?: number | null;
  active_stokis?: number | null;
  lives_today?: number | null;
  attendance_today?: number | null;
  outstanding_invoices?: number | null;
  cash_in_cents?: number | null;
  cash_out_cents?: number | null;
  // v1.8.0 attendance donut
  attendance_on_time?: number | null;
  attendance_late?: number | null;
  staff_total?: number | null;
}

/* ================= v1.5.0 — the Sales Floor (trading-desk dashboard) =======
   CEO brief: "my dashboard nice like a trading sales view — Today sales,
   market target for my product and service, KPI target and motivation for
   them to hit the requirement and suggestion to boost the sales."

   One live view, four zones:
   1. TICKER   — today's number in market green/red vs yesterday, month,
                 all-time, unpaid (collections are revenue already earned).
   2. KPI      — the month target with a pace marker. The target is AUTO-
                 COMPUTED from history (beat last month by 10%, rounded up to
                 the next RM500); a manually set target always wins.
   3. MARKETS  — product vs service, each line measured against its own
                 auto-target (its last month + 10%).
   4. DESK NOTES — motivation tied to the actual pace, plus concrete,
                 data-driven suggestions to boost sales (best live hour,
                 unpaid invoices, open quotations, restocks).
   Calendar and quick actions are untouched — this replaces only the band. */

export interface RevLineLite {
  key: string;
  label: string;
  total_cents: number;
  months: { month: string; cents: number }[];
}
export interface HourBucket {
  hour: number;
  cents: number;
  orders: number;
}

/** Auto-target: beat last month by 10%, rounded UP to the next RM500.
    No history yet → no target (never invent a number). */
export function autoTargetCents(lastCents: number): number | null {
  if (lastCents <= 0) return null;
  const raised = lastCents * 1.1;
  return Math.ceil(raised / 50_000) * 50_000;
}

export function ActiveStokisSummary({ inModal }: { inModal?: boolean } = {}) {
  const [data, setData] = useState<
    { id: number; name: string; status: string; month_cents: number }[]
  >([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{
      stokis: {
        id: number;
        name: string;
        status: string;
        month_cents: number;
      }[];
    }>("/staff/stokis").then((r) => {
      if (r.ok && r.data)
        setData(r.data.stokis.filter((s) => s.status === "active"));
      setLoaded(true);
    });
  }, []);
  const wrap = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col pb-4 sm:pb-0">{node}</div>
    ) : (
      <div className={card}>
        <p className="mb-3 text-sm font-semibold">
          ⭐ {L("Active Stokis", "Stokis aktif")}
        </p>
        {node}
      </div>
    );
  if (!loaded)
    return wrap(
      <SkelRows rows={4} className={inModal ? "px-4 sm:px-5" : "max-h-80 pr-1"} />
    );
  if (data.length === 0)
    return wrap(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No active stokis.", "Tiada stokis aktif.")}
      </p>
    );
  return wrap(
    <div
      className={
        inModal ? "overflow-y-auto" : "max-h-80 space-y-3 overflow-y-auto pr-1"
      }
    >
      {data.map((s) => (
        <div
          key={s.id}
          className={`border-border flex flex-wrap items-center justify-between gap-2 border-b text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-4 py-3 transition-colors sm:px-5" : "pb-2"}`}
        >
          <p className="font-bold">{s.name}</p>
          <p className="text-muted-foreground text-xs">
            {fmtRM(s.month_cents)} {L("this month", "bulan ini")}
          </p>
        </div>
      ))}
    </div>
  );
}

/* v1.21.0 (CEO chose "allow but flag") — punches outside the office are
   RECORDED and management views mark them red; the C-suite is exempt from
   the flag but their location still shows. Display only: the location
   requirement is enforced server-side at the punch. */
export const GEOFENCE_EXEMPT_ROLES = ["ceo", "coo", "cco"];

/* v1.18.1 — where a punch happened, as a human phrase. The stored gps is
   "lat,lng[,acc]"; distance is measured against the CONFIGURED fence when
   the caller has one (monitor ships it), falling back to SITE_CONFIG.
   Accuracy grace mirrors the server: radius + min(acc, 150). */
export function gpsLabel(
  gps?: string | null,
  fence?: { lat: number; lng: number; radius_m: number; label?: string } | null
): { text: string; ok: boolean | null; dist: number | null } {
  if (!gps)
    return { text: L("no location", "tiada lokasi"), ok: null, dist: null };
  // v1.25.3: deliberately-unlocated punch — surface it as a failure, not a blank.
  if (gps.startsWith("no_location:")) {
    const why = gps.slice("no_location:".length);
    return {
      text:
        why === "denied"
          ? L("NO LOCATION (blocked)", "TIADA LOKASI (disekat)")
          : why === "policy"
            ? L(
                "NO LOCATION (site build blocked it — redeploy)",
                "TIADA LOKASI (disekat oleh binaan laman — deploy semula)"
              )
            : L(`NO LOCATION (${why})`, `TIADA LOKASI (${why})`),
      ok: false,
      dist: null,
    };
  }
  const m =
    /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?/.exec(
      gps
    );
  if (!m)
    return { text: L("no location", "tiada lokasi"), ok: null, dist: null };
  const office = fence ?? {
    lat: SITE_CONFIG.office.lat,
    lng: SITE_CONFIG.office.lng,
    radius_m: SITE_CONFIG.office.radiusM,
  };
  const [lat, lng] = [Number(m[1]), Number(m[2])];
  const acc = m[3] ? Math.min(Number(m[3]), 150) : 0;
  const rad = Math.PI / 180;
  const dLat = (office.lat - lat) * rad;
  const dLng = (office.lng - lng) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat * rad) * Math.cos(office.lat * rad) * Math.sin(dLng / 2) ** 2;
  const dist = Math.round(
    6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
  const near = dist <= office.radius_m + acc; // same rule as the server gate
  return {
    text:
      dist >= 1000
        ? L(
            `${(dist / 1000).toFixed(1)} km from HQ`,
            `${(dist / 1000).toFixed(1)} km dari HQ`
          )
        : L(`${dist} m from HQ`, `${dist} m dari HQ`),
    ok: near,
    dist,
  };
}

export function InTodaySummary({ inModal }: { inModal?: boolean } = {}) {
  type MonRow = {
    id: number;
    name: string;
    role?: string;
    in_at?: string | null;
    in_gps?: string | null;
  };
  const [data, setData] = useState<MonRow[]>([]);
  const [fence, setFence] = useState<{
    lat: number;
    lng: number;
    radius_m: number;
    label?: string;
  } | null>(null);
  /* v1.21.4: distinguish "worker says fence is NOT configured" (explicit
     null → show the red deployment warning) from "old worker, field absent"
     (undefined → say nothing rather than guess). */
  const [fenceMissing, setFenceMissing] = useState(false);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{
      staff: MonRow[];
      geofence?: {
        lat: number;
        lng: number;
        radius_m: number;
        label?: string;
      } | null;
    }>("/staff/attendance/monitor").then((r) => {
      if (r.ok && r.data) {
        setData(r.data.staff.filter((s) => !!s.in_at));
        setFence(r.data.geofence ?? null);
        setFenceMissing("geofence" in r.data && r.data.geofence === null);
      }
      setLoaded(true);
    });
  }, []);
  /* v1.21.4: when the deployed worker explicitly reports NO fence, tell the
     manager plainly — this is the silent state behind "no location" punches
     being accepted before, and the fix is one full DEPLOY.bat run. */
  const fenceWarning = fenceMissing ? (
    <p
      className={`bg-danger-soft text-danger rounded-lg px-3 py-2 text-xs font-medium ${inModal ? "mx-4 mt-3 sm:mx-5" : "mb-2"}`}
    >
      Office geofence is NOT active on this deployment — run DEPLOY.bat in full
      (step 2 seeds it via migration 0072), then punches require location and
      outside-office flags turn on.
    </p>
  ) : null;
  const wrap = (node: ReactNode) =>
    inModal ? (
      <div className="flex flex-col pb-4 sm:pb-0">
        {fenceWarning}
        {node}
      </div>
    ) : (
      <div className={card}>
        <p className="mb-3 text-sm font-semibold">
          {L("In Today", "Hadir hari ini")}
        </p>
        {fenceWarning}
        {node}
      </div>
    );
  if (!loaded)
    return wrap(
      <SkelRows rows={4} className={inModal ? "px-4 sm:px-5" : "max-h-80 pr-1"} />
    );
  if (data.length === 0)
    return wrap(
      <p
        className={
          inModal
            ? "text-muted-foreground px-4 py-8 text-center text-sm"
            : "text-muted-foreground mt-2 text-sm"
        }
      >
        {L("No one checked in today.", "Tiada sesiapa daftar masuk hari ini.")}
      </p>
    );
  return wrap(
    <div
      className={
        inModal ? "overflow-y-auto" : "max-h-80 space-y-3 overflow-y-auto pr-1"
      }
    >
      {data.map((u) => (
        <div
          key={u.id}
          className={`border-border flex flex-wrap items-center justify-between gap-2 border-b text-sm last:border-0 ${inModal ? "hover:bg-muted/50 px-4 py-3 transition-colors sm:px-5" : "pb-2"}`}
        >
          <p className="text-sm font-medium">{u.name}</p>
          {/* v1.15.0 fix (audit finding): in_at is a UTC string — slicing it
              showed a 10:00 MYT clock-in as 02:00. mytTime converts. */}
          <p className="text-muted-foreground text-xs">
            {L("Checked in at", "Daftar masuk pada")}{" "}
            {u.in_at ? mytTime(u.in_at) : L("unknown", "tidak diketahui")}
            {(() => {
              /* v1.21.0 allow-but-flag: staff outside the fence show RED
                 ("outside office"); CEO/COO/CCO are exempt from the flag —
                 their distance shows neutrally. Missing location on a staff
                 punch is amber (older rows predate the requirement). */
              const g = gpsLabel(u.in_gps, fence);
              const exempt = GEOFENCE_EXEMPT_ROLES.includes(u.role ?? "");
              if (g.ok === null)
                return (
                  <span
                    className={`ml-1.5 font-medium ${exempt ? "opacity-60" : "text-warning"}`}
                  >
                    · {g.text}
                  </span>
                );
              if (exempt)
                return (
                  <span className="ml-1.5 font-medium opacity-60">
                    · {g.text}
                  </span>
                );
              return g.ok ? (
                <span className="text-success ml-1.5 font-medium">
                  · {L("at office", "di pejabat")} · {g.text}
                </span>
              ) : (
                <span className="text-danger ml-1.5 font-semibold">
                  · {L("OUTSIDE OFFICE", "LUAR PEJABAT")} · {g.text}
                </span>
              );
            })()}
          </p>
        </div>
      ))}
    </div>
  );
}

export function OutstandingDocsSummary({ kind }: { kind: "INV" | "QT" }) {
  const [data, setData] = useState<SalesDoc[]>([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{ docs: SalesDoc[] }>("/staff/docs").then((r) => {
      if (r.ok && r.data)
        setData(
          r.data.docs.filter(
            (d) => d.doc_type === kind && d.payment_status !== "paid"
          )
        );
      setLoaded(true);
    });
  }, [kind]);
  if (!loaded) return <SkelRows rows={4} className="px-4 pb-4 sm:px-5 sm:pb-0" />;
  if (data.length === 0)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {L(
          `No ${kind === "INV" ? "unpaid invoices" : "open quotations"}.`,
          kind === "INV"
            ? "Tiada invois belum dibayar."
            : "Tiada sebut harga terbuka."
        )}
      </p>
    );
  return (
    <div className="flex flex-col pb-4 sm:pb-0">
      {data.map((d) => (
        <div
          key={d.id}
          className="border-border hover:bg-muted/50 flex items-center justify-between border-b px-4 py-3 transition-colors last:border-0 sm:px-5"
        >
          <span className="text-sm font-medium">
            {d.doc_number}{" "}
            <span className="text-muted-foreground font-normal">
              ({d.company})
            </span>
          </span>
          <span className="font-bold text-danger tabular-nums">
            {fmtRM(d.total_cents)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PendingLeaveSummary() {
  const [data, setData] = useState<LeaveReq[]>([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{ leave: LeaveReq[] }>("/staff/leave?all=1").then((r) => {
      if (r.ok && r.data)
        setData(r.data.leave.filter((l) => l.status === "pending"));
      setLoaded(true);
    });
  }, []);
  if (!loaded) return <SkelRows rows={4} className="px-4 pb-4 sm:px-5 sm:pb-0" />;
  if (data.length === 0)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {L("No pending leave requests.", "Tiada permohonan cuti menunggu.")}
      </p>
    );
  return (
    <div className="flex flex-col pb-4 sm:pb-0">
      {data.map((l) => (
        <div
          key={l.id}
          className="border-border hover:bg-muted/50 flex items-center justify-between border-b px-4 py-3 transition-colors last:border-0 sm:px-5"
        >
          <p className="text-sm font-medium">
            {l.user_name || L("Unknown", "Tidak diketahui")}{" "}
            <span className="text-muted-foreground font-normal">
              ({l.days} {L("days", "hari")})
            </span>
          </p>
          <p className="text-muted-foreground text-xs">
            {l.start_date} {L("to", "hingga")} {l.end_date}
          </p>
        </div>
      ))}
    </div>
  );
}

export function PendingClaimsSummary() {
  const [data, setData] = useState<
    {
      id: number;
      user_name: string;
      category: string;
      amount_cents: number;
      status: string;
    }[]
  >([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{
      claims: {
        id: number;
        user_name: string;
        category: string;
        amount_cents: number;
        status: string;
      }[];
    }>("/staff/claims").then((r) => {
      if (r.ok && r.data)
        setData(r.data.claims.filter((c) => c.status === "pending"));
      setLoaded(true);
    });
  }, []);
  if (!loaded) return <SkelRows rows={4} className="px-4 pb-4 sm:px-5 sm:pb-0" />;
  if (data.length === 0)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {L("No pending claims.", "Tiada tuntutan menunggu.")}
      </p>
    );
  return (
    <div className="flex flex-col pb-4 sm:pb-0">
      {data.map((c) => (
        <div
          key={c.id}
          className="border-border hover:bg-muted/50 flex items-center justify-between border-b px-4 py-3 transition-colors last:border-0 sm:px-5"
        >
          <p className="text-sm font-medium">
            {c.user_name || L("Unknown", "Tidak diketahui")}{" "}
            <span className="text-muted-foreground font-normal">
              - {c.category}
            </span>
          </p>
          <span className="font-bold tabular-nums">
            {fmtRM(c.amount_cents)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LowStockSummary() {
  const [data, setData] = useState<
    { id: number; name: string; sku: string; stock: number }[]
  >([]);
  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void api<{
      items: { id: number; name: string; sku: string; stock: number }[];
    }>("/staff/inventory").then((r) => {
      if (r.ok && r.data && r.data.items)
        setData(r.data.items.filter((i) => (i.stock || 0) <= 5));
      setLoaded(true);
    });
  }, []);
  if (!loaded) return <SkelRows rows={4} className="px-4 pb-4 sm:px-5 sm:pb-0" />;
  if (data.length === 0)
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {L("No low stock items.", "Tiada barang stok rendah.")}
      </p>
    );
  return (
    <div className="flex flex-col pb-4 sm:pb-0">
      {data.map((i) => (
        <div
          key={i.id}
          className="border-border hover:bg-muted/50 flex items-center justify-between border-b px-4 py-3 transition-colors last:border-0 sm:px-5"
        >
          <p className="text-sm font-medium">
            {i.name}{" "}
            <span className="text-muted-foreground font-normal">({i.sku})</span>
          </p>
          <span className="font-bold text-danger tabular-nums">
            {L(`${i.stock} left`, `baki ${i.stock}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
