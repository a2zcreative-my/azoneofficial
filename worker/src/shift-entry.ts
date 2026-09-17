import { canClockIn, claimedSlots, pairSessions, mytMinutes, type Slot } from "./clock-day";

export function shiftEntry(now: Date, day: string, slots: Slot[], previousSlots: Slot[],
  punches: { type: string; created_at: string; pending_approval?: number }[], leaveReview = false) {
  const today = punches.filter(p => new Date(Date.parse(`${p.created_at.replace(" ", "T")}Z`) + 8 * 3600000).toISOString().slice(0, 10) === day);
  const sessions = pairSessions(today.map(p => ({ type: p.type, at: p.created_at })));
  const latest = [...punches].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const at = latest ? Date.parse(`${latest.created_at.replace(" ", "T")}Z`) : 0;
  const todayLatest = latest && today.includes(latest);
  const open = latest?.type === "clock_in" && (todayLatest || (!latest.pending_approval && now.getTime() - at <= 16 * 3600000));
  const clock = new Date(now.getTime() + 8 * 3600000);
  const minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
  const claimed = claimedSlots(slots, sessions);
  const due = slots.some((s, i) => !claimed.has(i) && minute >= s.start - 30 && minute < s.end);
  const openMinute = open ? mytMinutes(latest.created_at) : 0;
  const active = open ? (todayLatest ? slots : previousSlots).find(s => openMinute < s.end) : undefined;
  const midnight = Date.parse(`${day}T00:00:00+08:00`);
  const time = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}${m >= 1440 ? " (+1)" : ""}`;
  return {
    work_label: leaveReview ? null : slots.map(s => `${time(s.start)} - ${time(s.end)}`).join(" + "),
    clocked_in: Boolean(open), open_since: open ? latest.created_at : null,
    clock_out_at: active ? new Date(midnight + (active.end - (todayLatest ? 0 : 1440)) * 60000).toISOString() : null,
    launch_shift: !open && !leaveReview && due && canClockIn(slots, sessions, minute).ok,
    leave_review: leaveReview,
  };
}
