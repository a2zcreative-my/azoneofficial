"use client";

/* Moved verbatim from app/portal/page.tsx in v1.114.0 (housekeeping: the
   605 KB page split by domain). Nothing here was rewritten; only the imports
   at the top are new and the declarations are exported. */
import { Sub } from "@/components/portal/leave";
import { L, MONTH_NAMES, annCatL, daysAwayL } from "@/components/portal/page-shared";
import { rowActions, rowBtn, rowBtnDanger } from "@/components/ui/row-button";
import { useSaveToast } from "@/components/ui/save-toast";
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { addEventToCalendar } from "@/lib/event-ics";
import { dmy } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { firstName, properName } from "@/lib/names";
import { btnClass, btnGhost, card, inputClass } from "@/lib/ui-styles";
import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";

/* ================= Company events (v1.4.73) ================= */

export interface CompanyEvent {
  id: number;
  title: string;
  category: string;
  event_date: string;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  details?: string | null;
  created_by_name?: string | null;
  /* v1.144.0 - who has to be there. EMPTY MEANS EVERYONE, which is what every
     event meant before this field existed; it is not "nobody". */
  attendees?: { id: number; name: string }[];
}

/** v1.152.0 - one approved leave span as /leave/calendar returns it. */
export interface LeaveSpan { user_id: number; name: string; start_date: string; end_date: string }

export const EVENTS_MANAGE_ROLES = [
  "super_admin",
  "admin",
  "hr_admin",
  "ceo",
  "coo",
  "cco",
];
export const EVENT_CATEGORIES = [
  ["training", "Training"],
  ["class", "Class"],
  ["meeting", "Meeting"],
  ["event", "Event"],
] as const;

/** Upcoming events — visible to EVERY staff member on the Dashboard so
    trainings, classes and important dates are never missed. Managers
    (events_manage roles) add and remove events inline; everyone is
    bell-notified when one is created. */
/* v1.5.0: TrendingMYCard + TREND_BUSINESS_KEYWORDS removed with the Social tab. */

/** v1.152.0 - `embedded`: rendered inside the Dashboard's tabbed card, so
    no card frame of its own and no title (the pill already says it). */
export function UpcomingEventsCard({ role, embedded = false }: { role: string; embedded?: boolean }) {
  const [events, setEvents] = useState<CompanyEvent[]>([]);
  const [msg, setMsg] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    category: "training",
    event_date: "",
    start_time: "",
    end_time: "",
    location: "",
    details: "",
    attendees: [] as number[],
  });
  /* v1.144.0 - the people this event can be for, sent with the events by the
     same request. Empty for anyone who cannot create an event. */
  const [staffOptions, setStaffOptions] = useState<{ id: number; name: string }[]>([]);
  // v1.4.76: professional month-calendar view (default) with a list toggle.
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [calMonth, setCalMonth] = useState(
    new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7)
  );
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const canManage = EVENTS_MANAGE_ROLES.includes(role);
  const { show: showToast, node: toastNode } = useSaveToast();

  // v1.4.81: Johor public holidays render on the calendar too.
  const [holidays, setHolidays] = useState<
    { holiday_date: string; name: string; kind: string }[]
  >([]);
  // v1.4.101: staff birthdays render on the calendar + upcoming list — the
  // team sees them coming and can prepare the celebration.
  const [bdays, setBdays] = useState<{ name: string; birthday: string }[]>([]);
  useEffect(() => {
    void api<{ birthdays: { name: string; birthday: string }[] }>(
      `/staff/birthdays-lite`
    ).then((r) => {
      if (r.ok && r.data) setBdays(r.data.birthdays);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const bdayOn = (iso: string) =>
    bdays.filter((b) => b.birthday?.slice(5) === iso.slice(5));

  /* v1.77.0 — skeleton until the first fetch lands. */
  const [loaded, setLoaded] = useState(false);
  const loadEvents = useCallback(async () => {
    const res = await api<{ events: CompanyEvent[]; staff?: { id: number; name: string }[] }>(`/staff/events`);
    if (res.ok && res.data) {
      setEvents(res.data.events);
      setStaffOptions(res.data.staff ?? []);
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);
  useEffect(() => {
    void api<{
      holidays: { holiday_date: string; name: string; kind: string }[];
    }>(`/staff/holidays?year=${calMonth.slice(0, 4)}`).then((r) => {
      if (r.ok && r.data) setHolidays(r.data.holidays);
    });
  }, [calMonth]);
  /* v1.152.0 (CEO: "need to add also staff that planned leave so easier for
     me to aware on the calendar after approval"): APPROVED leave for the
     month on screen, from the same door the roster's pickers use
     (/leave/calendar, v1.131.0) - names and dates, never the type or the
     reason; managers see the floor, everybody else their own days. */
  const [leave, setLeave] = useState<LeaveSpan[]>([]);
  useEffect(() => {
    const y = Number(calMonth.slice(0, 4)), m = Number(calMonth.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    void api<{ leave: LeaveSpan[] }>(`/staff/leave/calendar?from=${calMonth}-01&to=${calMonth}-${String(last).padStart(2, "0")}`)
      .then((r) => { if (r.ok && r.data) setLeave(r.data.leave ?? []); });
  }, [calMonth]);

  const todayISO = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const upcoming = events.filter((e) => e.event_date >= todayISO);
  // birthdays in the next 30 days, projected onto this/next year
  const upcomingBdays = bdays
    .map((b) => {
      const md = b.birthday.slice(5);
      let iso = `${todayISO.slice(0, 4)}-${md}`;
      if (iso < todayISO) iso = `${Number(todayISO.slice(0, 4)) + 1}-${md}`;
      return { name: b.name, iso };
    })
    .filter(
      (b) =>
        (new Date(b.iso).getTime() - new Date(todayISO).getTime()) / 86400000 <=
        30
    )
    .sort((a, b) => a.iso.localeCompare(b.iso));
  const daysAway = (iso: string) => {
    const today = new Date(Date.now() + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    const n = Math.round(
      (new Date(iso).getTime() - new Date(today).getTime()) / 86400000
    );
    return n === 0 ? "TODAY" : n === 1 ? "Tomorrow" : `in ${n} days`;
  };

  const createEvent = async () => {
    if (!draft.title.trim() || !draft.event_date) {
      setMsg(L("Title and date are required.", "Tajuk dan tarikh diperlukan."));
      return;
    }
    setMsg("");
    const res = await api<{ error?: { message?: string } }>(`/staff/events`, {
      method: "POST",
      body: JSON.stringify({
        ...draft,
        start_time: draft.start_time || undefined,
        end_time: draft.end_time || undefined,
        location: draft.location || undefined,
        details: draft.details || undefined,
        attendees: draft.attendees,
      }),
    });
    if (!res.ok) {
      setMsg(
        res.data?.error?.message ??
          L("Could not create the event", "Tidak dapat membuat acara")
      );
      return;
    }
    setDraft({
      title: "",
      category: "training",
      event_date: "",
      start_time: "",
      end_time: "",
      location: "",
      details: "",
      attendees: [],
    });
    setShowForm(false);
    showToast(
      L("Saved", "Disimpan"),
      L(
        "Event created — all staff notified",
        "Acara dibuat — semua kakitangan dimaklumkan"
      )
    );
    void loadEvents();
  };

  /* v1.77.0 — this used to delete and say nothing, not even checking whether
     the server agreed. Creating an event notifies every member of staff; the
     person removing one deserves at least to know it went. */
  const removeEvent = async (id: number) => {
    const res = await api(`/staff/events/${id}`, { method: "DELETE" });
    showToast(
      res.ok ? L("Event removed", "Acara dibuang") : L("Not removed", "Tidak dibuang"),
      res.ok
        ? L("It is off the calendar", "Ia telah keluar dari kalendar")
        : L("The event is still there — try again", "Acara masih ada — cuba lagi"),
      res.ok ? undefined : "notice",
    );
    void loadEvents();
  };

  return (
    <div className={embedded ? "" : card}>
      {toastNode}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {!embedded && (
            <p className="text-sm font-semibold">
              {L("Upcoming events", "Acara akan datang")}
              {upcoming.length > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                  {upcoming.length}
                </span>
              )}
            </p>
          )}
          <p className="text-muted-foreground mt-0.5 text-xs">
            {L(
              "Trainings, classes and important company dates — everyone is notified when one is added.",
              "Latihan, kelas dan tarikh penting syarikat — semua dimaklumkan apabila satu ditambah."
            )}
          </p>
        </div>
        <span className="flex items-center gap-2">
          <span className="border-border inline-flex overflow-hidden rounded-lg border text-xs">
            {(["calendar", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`px-3 py-1.5 font-medium capitalize ${view === v ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
                onClick={() => setView(v)}
              >
                {v === "calendar"
                  ? L("calendar", "kalendar")
                  : L("list", "senarai")}
              </button>
            ))}
          </span>
          {canManage && (
            <button
              type="button"
              className={btnGhost}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm
                ? L("Close", "Tutup")
                : L("+ Add event", "+ Tambah acara")}
            </button>
          )}
        </span>
      </div>
      {canManage && showForm && (
        <div className="border-border mt-3 space-y-2 rounded-lg border p-3">
          <Sub t={L("Event title", "Tajuk acara")}>
            <input
              className={inputClass}
              placeholder={L(
                "e.g. TikTok Live hosting training",
                "cth. Latihan pengacaraan TikTok Live"
              )}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
          </Sub>
          {/* v1.4.154: standard widths — 2-up grid on phones, capped row from sm: */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Sub t={L("Category", "Kategori")}>
              <select
                className={`${inputClass} sm:max-w-40`}
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value }))
                }
              >
                {EVENT_CATEGORIES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {L(
                      l,
                      (
                        {
                          training: "Latihan",
                          class: "Kelas",
                          meeting: "Mesyuarat",
                          event: "Acara",
                        } as Record<string, string>
                      )[v] ?? l
                    )}
                  </option>
                ))}
              </select>
            </Sub>
            <Sub t={L("Date", "Tarikh")}>
              <input
                type="date"
                className={`${inputClass} sm:max-w-44`}
                value={draft.event_date}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, event_date: e.target.value }))
                }
              />
            </Sub>
            <Sub t={L("Start (optional)", "Mula (pilihan)")}>
              <input
                type="time"
                className={`${inputClass} sm:max-w-32`}
                value={draft.start_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, start_time: e.target.value }))
                }
              />
            </Sub>
            <Sub t={L("End (optional)", "Tamat (pilihan)")}>
              <input
                type="time"
                className={`${inputClass} sm:max-w-32`}
                value={draft.end_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, end_time: e.target.value }))
                }
              />
            </Sub>
          </div>
          <Sub t={L("Location (optional)", "Lokasi (pilihan)")}>
            <input
              className={inputClass}
              placeholder={L(
                "e.g. HQ meeting room / Google Meet",
                "cth. Bilik mesyuarat HQ / Google Meet"
              )}
              value={draft.location}
              onChange={(e) =>
                setDraft((d) => ({ ...d, location: e.target.value }))
              }
            />
          </Sub>
          <Sub t={L("Details (optional)", "Butiran (pilihan)")}>
            <textarea
              className={`${inputClass} min-h-16`}
              placeholder={L(
                "Agenda, links, what to prepare",
                "Agenda, pautan, apa yang perlu disediakan"
              )}
              value={draft.details}
              onChange={(e) =>
                setDraft((d) => ({ ...d, details: e.target.value }))
              }
            />
          </Sub>
          {/* v1.144.0 (CEO: "I want some selected staff which is require to
              join the event only being notified"): who has to be there. Left
              empty it means EVERYONE, which is what an event has always meant
              - so an event created without touching this is announced exactly
              as it was before. Everyone still SEES the event on the calendar;
              only the bell is aimed. */}
          {staffOptions.length > 0 && (
            <Sub t={L("Who must attend (optional)", "Siapa perlu hadir (pilihan)")}>
              <div className="border-border max-h-56 space-y-0.5 overflow-y-auto rounded-xl border p-1.5">
                {staffOptions.map((p) => {
                  const on = draft.attendees.includes(p.id);
                  return (
                    <label key={p.id}
                      className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 sm:min-h-9 ${on ? "bg-secondary" : ""}`}>
                      <input type="checkbox" checked={on}
                        onChange={() => setDraft((d) => ({
                          ...d,
                          attendees: on ? d.attendees.filter((x) => x !== p.id) : [...d.attendees, p.id],
                        }))} />
                      <span className="min-w-0 truncate text-sm">{properName(p.name)}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-muted-foreground mt-1 text-[11px]">
                {draft.attendees.length === 0
                  ? L("Nobody picked — everyone is notified, as before.",
                      "Tiada dipilih — semua kakitangan dimaklumkan, seperti biasa.")
                  : L(`${draft.attendees.length} picked — only they are notified. Everyone still sees the event.`,
                      `${draft.attendees.length} dipilih — hanya mereka dimaklumkan. Semua masih nampak acara ini.`)}
                {draft.attendees.length > 0 && (
                  <button type="button" className="ml-2 font-semibold underline"
                    onClick={() => setDraft((d) => ({ ...d, attendees: [] }))}>
                    {L("Clear", "Kosongkan")}
                  </button>
                )}
              </p>
            </Sub>
          )}
          {msg && <p className="text-destructive text-xs font-medium">{msg}</p>}
          <button
            type="button"
            className={btnClass}
            onClick={() => void createEvent()}
          >
            {draft.attendees.length === 0
              ? L("Save event — notifies all staff", "Simpan acara — memaklumkan semua kakitangan")
              : L(`Save event — notifies ${draft.attendees.length} staff`,
                  `Simpan acara — memaklumkan ${draft.attendees.length} kakitangan`)}
          </button>
        </div>
      )}
      {upcomingBdays.length > 0 && (
        <p className="mt-2 rounded-lg bg-celebrate-soft px-3 py-2 text-xs font-medium text-celebrate">
          <AppIcon name="cake" className="mr-1 -mt-0.5 h-3.5 w-3.5" />{L("Coming up:", "Akan tiba:")}{" "}
          {upcomingBdays
            .slice(0, 4)
            .map((b) => `${firstName(b.name)} (${dmy(b.iso)})`)
            .join(" · ")}
          {upcomingBdays.length > 4
            ? L(
                ` +${upcomingBdays.length - 4} more`,
                ` +${upcomingBdays.length - 4} lagi`
              )
            : ""}{" "}
          —{" "}
          {L("time to plan the celebration!", "masa untuk merancang sambutan!")}
        </p>
      )}
      {/* v1.77.0 — skeleton until the first fetch lands: the month grid's
          exact geometry (7 columns, 5 rows, the same cell heights) so the
          card does not jump when the events arrive. */}
      {!loaded && view === "calendar" && (
        <div className="mt-3" aria-hidden>
          <div className="flex items-center justify-between">
            <Skel className="h-8 w-8" />
            <Skel className="h-4 w-32" />
            <Skel className="h-8 w-8" />
          </div>
          <div className="mt-2 grid grid-cols-7 gap-2 px-2 py-1">
            {Array.from({ length: 7 }, (_, i) => (
              <Skel key={i} className="mx-auto h-2.5 w-6" />
            ))}
          </div>
          <div className="border-border grid grid-cols-7 overflow-hidden rounded-lg border [&>*:nth-child(7n)]:border-r-0 [&>*:nth-last-child(-n+7)]:border-b-0">
            {Array.from({ length: 35 }, (_, i) => (
              <div
                key={i}
                className="border-border min-h-12 border-r border-b p-1 md:min-h-20 md:p-1.5"
              >
                <Skel className="h-5 w-5 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      )}
      {!loaded && view === "list" && (
        <SkelRows rows={3} className="mt-3 max-h-80 pr-1" />
      )}
      {loaded && view === "calendar" && (
        <EventsCalendar
          birthdays={bdays}
          leave={leave}
          events={events}
          holidays={holidays}
          month={calMonth}
          onMonth={setCalMonth}
          selected={selectedDay}
          onSelect={setSelectedDay}
          canManage={canManage}
          onRemove={(id) => void removeEvent(id)}
          onAdded={(title, how) =>
            showToast(
              how === "opened"
                ? L("Calendar opened", "Kalendar dibuka")
                : how === "stale"
                  ? L("Server needs the update", "Pelayan perlu dikemas kini")
                  : L("Saved", "Disimpan"),
              how === "opened"
                ? L(
                    `${title} — tap Add All (iPhone) or Save (Android) on the page that just opened`,
                    `${title} — tekan Add All (iPhone) atau Save (Android) pada halaman yang baru dibuka`
                  )
                : how === "stale"
                  ? "The calendar fix lives on the server — deploy the worker (cd worker && wrangler deploy), then this button saves properly"
                  : how === "shared"
                    ? L(
                        `${title} — pick Calendar in the share sheet to finish`,
                        `${title} — pilih Kalendar dalam helaian kongsi untuk selesai`
                      )
                    : L(
                        `${title} — calendar file downloaded; open it to add the event`,
                        `${title} — fail kalendar dimuat turun; buka untuk menambah acara`
                      )
            )
          }
        />
      )}
      {loaded && view === "list" && (
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
          {upcoming.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {L(
                "No upcoming events scheduled.",
                "Tiada acara akan datang dijadualkan."
              )}
            </p>
          )}
          {upcoming.map((ev) => (
            <div
              key={ev.id}
              className="border-border flex flex-wrap items-start justify-between gap-2 rounded-lg border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-medium">{ev.title}</span>{" "}
                  <span className="bg-secondary rounded-full px-2 py-0.5 text-xs capitalize">
                    {annCatL(ev.category)}
                  </span>
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {dmy(ev.event_date)}
                  <span
                    className={`ml-1.5 font-semibold ${daysAway(ev.event_date) ==="TODAY" ?"text-warning" :""}`}
                  >
                    · {daysAwayL(daysAway(ev.event_date))}
                  </span>
                  {ev.start_time
                    ? ` · ${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}`
                    : ""}
                  {ev.location ? ` · ${ev.location}` : ""}
                </p>
                {ev.details && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {ev.details}
                  </p>
                )}
                {/* v1.144.0 - who is required. The CEO's own call: the floor
                    sees the names, so a manager can tell at a glance who is
                    out of the office that day. */}
                {ev.attendees && ev.attendees.length > 0 && (
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    <span className="font-semibold">{L("Required:", "Wajib hadir:")}</span>{" "}
                    {ev.attendees.map((a) => properName(a.name)).join(", ")}
                  </p>
                )}
                {ev.created_by_name && (
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {L("Added by", "Ditambah oleh")} {ev.created_by_name}
                  </p>
                )}
              </div>
              <span className={rowActions}>
                {/* v1.4.264: the portal card can only remind people while they
                  are LOOKING at it — the phone's own calendar is what buzzes
                  on the day. Every staff member gets this, not just managers. */}
                <button
                  type="button"
                  className={rowBtn}
                  title={L(
                    "Save this event into your phone's calendar — it carries a reminder the evening before and at the start",
                    "Simpan acara ini ke dalam kalendar telefon anda — ia membawa peringatan pada malam sebelumnya dan pada waktu mula"
                  )}
                  onClick={async () => {
                    const how = await addEventToCalendar(ev);
                    showToast(
                      how === "opened"
                        ? L("Calendar opened", "Kalendar dibuka")
                        : how === "stale"
                          ? L(
                              "Server needs the update",
                              "Pelayan perlu dikemas kini"
                            )
                          : L("Saved", "Disimpan"),
                      how === "opened"
                        ? L(
                            `${ev.title} — tap Add All (iPhone) or Save (Android) on the page that just opened`,
                            `${ev.title} — tekan Add All (iPhone) atau Save (Android) pada halaman yang baru dibuka`
                          )
                        : how === "stale"
                          ? "The calendar fix lives on the server — deploy the worker (cd worker && wrangler deploy), then this button saves properly"
                          : how === "shared"
                            ? L(
                                `${ev.title} — pick Calendar in the share sheet to finish`,
                                `${ev.title} — pilih Kalendar dalam helaian kongsi untuk selesai`
                              )
                            : L(
                                `${ev.title} — calendar file downloaded; open it to add the event`,
                                `${ev.title} — fail kalendar dimuat turun; buka untuk menambah acara`
                              ),
                      how === "stale" ? "notice" : undefined
                    );
                  }}
                >
                  <AppIcon name="calendarAdd" className="mr-1 -mt-0.5 h-3.5 w-3.5" />{L("Add to my calendar", "Tambah ke kalendar saya")}
                </button>
                {canManage && (
                  <button
                    type="button"
                    className={rowBtnDanger}
                    onClick={() => void removeEvent(ev.id)}
                  >
                    {L("Remove", "Buang")}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Category dot / accent colours — consistent across dots, chips, agenda.
 *
 *  v1.124.0 — these four stay RAW Tailwind on purpose, and tests/status-
 *  tokens.mjs allowlists them by name. They are not statuses: nothing here
 *  means good, bad or needs-attention, so there is no semantic token they
 *  could take. They are a categorical palette, chosen to be four telling-apart
 *  colours, and they are solid -500 fills that read on either theme. Give them
 *  status tokens and the calendar starts saying a meeting is worse than a
 *  class. Add a fifth category by adding a fifth colour here. */
export const EVENT_COLORS: Record<string, string> = {
  training: "bg-amber-500",
  class: "bg-sky-500",
  meeting: "bg-violet-500",
  event: "bg-emerald-500",
};

/** Month calendar — professional on desktop AND phones: 7-column grid,
    today ringed, category-coloured markers (titles on desktop, dots on
    mobile), tap a day for its agenda below. Weeks start Sunday (MY). */
export function EventsCalendar({
  events,
  holidays,
  birthdays = [],
  leave = [],
  month,
  onMonth,
  selected,
  onSelect,
  canManage,
  onRemove,
  onAdded,
}: {
  events: CompanyEvent[];
  holidays: { holiday_date: string; name: string; kind: string }[];
  birthdays?: { name: string; birthday: string }[];
  /** v1.152.0 - approved leave spans; a day inside one shows who is away. */
  leave?: LeaveSpan[];
  month: string;
  onMonth: (m: string) => void;
  selected: string | null;
  onSelect: (d: string | null) => void;
  canManage: boolean;
  onRemove: (id: number) => void;
  onAdded: (
    title: string,
    how: "opened" | "shared" | "downloaded" | "stale"
  ) => void;
}) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = Sunday
  const today = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const byDay = (d: string) => events.filter((e) => e.event_date === d);
  const holidayOf = (d: string) => holidays.find((h) => h.holiday_date === d);
  const bdaysOf = (d: string) =>
    birthdays.filter((b) => b.birthday?.slice(5) === d.slice(5)); // month-day match, any year
  const leaveOn = (d: string) => leave.filter((l) => l.start_date <= d && l.end_date >= d);
  const shift = (delta: number) => {
    onSelect(null);
    onMonth(new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7));
  };
  const monthLabel =
    getLang() === "ms"
      ? `${MONTH_NAMES.ms[m - 1]} ${y}`
      : first.toLocaleDateString("en-MY", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
  /* v1.21.1 (CEO: "the cell looks like not full cell border line"): pad the
     TAIL to complete weeks too — the last row used to stop at the final day,
     leaving the grid's bottom-right corner as an open notch with no borders. */
  const lived: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const cells: (number | null)[] = [
    ...lived,
    ...Array<null>((7 - (lived.length % 7)) % 7).fill(null),
  ];
  const dayEvents = selected ? byDay(selected) : [];

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={L("Previous month", "Bulan sebelumnya")}
          className="border-border hover:bg-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg border"
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <p className="text-sm font-semibold">{monthLabel}</p>
        <button
          type="button"
          aria-label={L("Next month", "Bulan seterusnya")}
          className="border-border hover:bg-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg border"
          onClick={() => shift(1)}
        >
          ›
        </button>
      </div>
      <div className="text-muted-foreground mt-2 grid grid-cols-7 text-center text-[11px] font-semibold tracking-wide uppercase">
        {(getLang() === "ms"
          ? ["Ahd", "Isn", "Sel", "Rab", "Kha", "Jum", "Sab"]
          : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        ).map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      {/* v1.21.1: collapse the inner borders cleanly — every 7th cell drops
          border-r (it met the frame and read as a doubled line) and the last
          week drops border-b, so the frame is the single outer line. */}
      <div className="border-border grid grid-cols-7 overflow-hidden rounded-lg border [&>*:nth-child(7n)]:border-r-0 [&>*:nth-last-child(-n+7)]:border-b-0">
        {cells.map((d, i) => {
          if (d === null)
            return (
              <div
                key={`x${i}`}
                className="border-border bg-secondary/20 min-h-12 border-r border-b md:min-h-20"
              />
            );
          const dISO = iso(d);
          const evs = byDay(dISO);
          const hol = holidayOf(dISO);
          const isToday = dISO === today;
          const isSel = dISO === selected;
          return (
            <button
              key={dISO}
              type="button"
              onClick={() => onSelect(isSel ? null : dISO)}
              className={`border-border relative min-h-12 overflow-hidden border-r border-b p-1 text-left align-top transition-colors md:min-h-20 md:p-1.5 ${isSel ? "bg-secondary/60" : "hover:bg-secondary/40"}`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] md:text-xs ${isToday ?"bg-primary text-primary-foreground font-bold" : hol ?"font-bold text-danger" :"font-medium"}`}
              >
                {d}
              </span>
              {hol && (
                <>
                  <span className="mt-0.5 flex md:hidden">
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                  </span>
                  <span
                    className="mt-0.5 hidden truncate rounded bg-danger-soft px-1 py-0.5 text-[10px] leading-tight font-medium text-danger md:block"
                    title={hol.name}
                  >
                    {hol.name}
                  </span>
                </>
              )}
              {bdaysOf(dISO).length > 0 && (
                <>
                  <span className="mt-0.5 flex md:hidden">
                    <span className="h-1.5 w-1.5 rounded-full bg-celebrate" />
                  </span>
                  <span
                    className="mt-0.5 hidden truncate rounded bg-celebrate-soft px-1 py-0.5 text-[10px] leading-tight font-medium text-celebrate md:block"
                    title={bdaysOf(dISO)
                      .map((b) => b.name)
                      .join(", ")}
                  >
                    <AppIcon name="cake" className="mr-0.5 -mt-0.5 h-3 w-3" />{firstName(bdaysOf(dISO)[0]!.name)}
                    {bdaysOf(dISO).length > 1
                      ? ` +${bdaysOf(dISO).length - 1}`
                      : ""}
                  </span>
                </>
              )}
              {/* v1.152.0 - who is on approved leave this day. */}
              {leaveOn(dISO).length > 0 && (
                <>
                  <span className="mt-0.5 flex md:hidden">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  </span>
                  <span
                    className="mt-0.5 hidden truncate rounded bg-tint-navy px-1 py-0.5 text-[10px] leading-tight font-medium text-foreground md:block"
                    title={`${L("On leave:", "Cuti:")} ${leaveOn(dISO).map((l) => properName(l.name)).join(", ")}`}
                  >
                    <AppIcon name="person" className="mr-0.5 -mt-0.5 h-3 w-3" />{firstName(leaveOn(dISO)[0]!.name)}
                    {leaveOn(dISO).length > 1 ? ` +${leaveOn(dISO).length - 1}` : ""}
                  </span>
                </>
              )}
              {/* Mobile: dots. Desktop: title snippets. */}
              {evs.length > 0 && (
                <>
                  <span className="mt-0.5 flex flex-wrap gap-0.5 md:hidden">
                    {evs.slice(0, 4).map((e) => (
                      <span
                        key={e.id}
                        className={`h-1.5 w-1.5 rounded-full ${EVENT_COLORS[e.category] ?? "bg-primary"}`}
                      />
                    ))}
                  </span>
                  <span className="mt-0.5 hidden md:block">
                    {evs.slice(0, 2).map((e) => (
                      <span
                        key={e.id}
                        title={e.title}
                        className="bg-secondary mb-0.5 block truncate rounded px-1 py-0.5 text-[10px] leading-tight"
                      >
                        <span
                          className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${EVENT_COLORS[e.category] ?? "bg-primary"}`}
                        />
                        {e.title}
                      </span>
                    ))}
                    {evs.length > 2 && (
                      <span className="text-muted-foreground block text-[10px]">
                        +{evs.length - 2} {L("more", "lagi")}
                      </span>
                    )}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-3 text-[11px]">
        {Object.entries(EVENT_COLORS).map(([k, cls]) => (
          <span key={k} className="inline-flex items-center gap-1 capitalize">
            <span className={`h-2 w-2 rounded-full ${cls}`} />
            {annCatL(k)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-danger" />
          {L("Public holiday", "Cuti umum")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-celebrate" />
          <AppIcon name="cake" className="mr-1 h-3.5 w-3.5" />{L("Birthday", "Hari lahir")}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-primary" />
          {L("On leave (approved)", "Cuti (diluluskan)")}
        </span>
      </div>
      {selected && (
        <div className="border-border mt-3 rounded-lg border p-3">
          <p className="text-sm font-semibold">
            {dmy(selected)}
            {holidayOf(selected) && (
              <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                <AppIcon name="holiday" className="mr-1 -mt-0.5 h-3 w-3" />{holidayOf(selected)!.name}
              </span>
            )}
            {bdaysOf(selected).map((b) => (
              <span
                key={b.name}
                className="ml-2 rounded-full bg-celebrate-soft px-2 py-0.5 text-xs font-medium text-celebrate"
              >
                <AppIcon name="cake" className="mr-1 -mt-0.5 h-3 w-3" />
                {L(
                  `${properName(b.name)}'s birthday`,
                  `Hari lahir ${properName(b.name)}`
                )}
              </span>
            ))}
            {leaveOn(selected).map((l) => (
              <span key={`lv${l.user_id}`} className="ml-2 rounded-full bg-tint-navy px-2 py-0.5 text-xs font-medium text-foreground"
                title={`${dmy(l.start_date)} → ${dmy(l.end_date)}`}>
                <AppIcon name="person" className="mr-1 -mt-0.5 h-3 w-3" />
                {properName(l.name)} · {L("on leave", "cuti")}
              </span>
            ))}
          </p>
          {dayEvents.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-sm">
              {holidayOf(selected)
                ? L(
                    "Public holiday — no company events.",
                    "Cuti umum — tiada acara syarikat."
                  )
                : L("No events this day.", "Tiada acara pada hari ini.")}
            </p>
          ) : (
            dayEvents.map((ev) => (
              <div
                key={ev.id}
                className="mt-2 flex flex-wrap items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm">
                    <span
                      className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${EVENT_COLORS[ev.category] ?? "bg-primary"}`}
                    />
                    <span className="font-medium">{ev.title}</span>{" "}
                    <span className="bg-secondary rounded-full px-2 py-0.5 text-xs capitalize">
                      {annCatL(ev.category)}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {ev.start_time
                      ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}`
                      : L("All day", "Sepanjang hari")}
                    {ev.location ? ` · ${ev.location}` : ""}
                    {ev.created_by_name
                      ? L(
                          ` · added by ${ev.created_by_name}`,
                          ` · ditambah oleh ${ev.created_by_name}`
                        )
                      : ""}
                  </p>
                  {ev.details && (
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {ev.details}
                    </p>
                  )}
                  {/* v1.144.0 - the same "Required:" line as the list, so a day
                      opened on the calendar says who has to be there too. */}
                  {ev.attendees && ev.attendees.length > 0 && (
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      <span className="font-semibold">{L("Required:", "Wajib hadir:")}</span>{" "}
                      {ev.attendees.map((a) => properName(a.name)).join(", ")}
                    </p>
                  )}
                </div>
                <span className={rowActions}>
                  {/* v1.4.264: same button as the list view — one tap into the
                      phone's own calendar, for every staff member. */}
                  <button
                    type="button"
                    className={rowBtn}
                    title={L(
                      "Save this event into your phone's calendar — it carries a reminder the evening before and at the start",
                      "Simpan acara ini ke dalam kalendar telefon anda — ia membawa peringatan pada malam sebelumnya dan pada waktu mula"
                    )}
                    onClick={async () => {
                      const how = await addEventToCalendar(ev);
                      onAdded(ev.title, how);
                    }}
                  >
                    <AppIcon name="calendarAdd" className="mr-1 -mt-0.5 h-3.5 w-3.5" />{L("Add to my calendar", "Tambah ke kalendar saya")}
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      className={rowBtnDanger}
                      onClick={() => onRemove(ev.id)}
                    >
                      {L("Remove", "Buang")}
                    </button>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
