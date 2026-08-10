/* v1.4.264 — "Add to my calendar" for company events.

   The portal's event card is a NOTICE BOARD: it can remind people while they
   are looking at it, and no further. The phone's own calendar is what buzzes
   at 9am on the day — so the honest way to "ensure the event is saved inside
   the user's mobile calendar" is to hand the phone a standard calendar file
   (RFC 5545 .ics) and let its own Calendar app take it from there. iOS opens
   it straight into Calendar; Android offers Google Calendar; a laptop gets
   Outlook or Apple Calendar. No permission prompts, no store app needed.

   Built as text in the browser, like the PDFs — no server round-trip. */

const pad = (n: number) => String(n).padStart(2, "0");

/** RFC 5545 text escaping: backslash, comma, semicolon, newline. */
function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines over 75 octets must fold onto a continuation line (RFC 5545 §3.1) —
    a long event description otherwise breaks strict parsers like Outlook. */
function fold(line: string): string {
  const out: string[] = [];
  let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
  out.push(s);
  return out.join("\r\n");
}

export interface CalendarEventLike {
  id: number;
  title: string;
  event_date: string;             // YYYY-MM-DD
  start_time?: string | null;     // HH:MM (Malaysia time)
  end_time?: string | null;
  location?: string | null;
  details?: string | null;
  category?: string | null;
}

/** One event as a .ics the phone's calendar app understands.

    Times are written as UTC instants (the stored HH:MM is Malaysia time,
    UTC+8, no DST) so the entry lands at the right hour whatever timezone the
    phone is set to. An event with no start time becomes an ALL-DAY entry —
    DTEND is the NEXT day because RFC 5545 end dates are exclusive; writing
    the same date makes some apps show a zero-length event. */
export function buildEventIcs(ev: CalendarEventLike): Blob {
  const [y, mo, d] = ev.event_date.split("-").map(Number);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AZ ONE OFFICIAL//Staff Portal//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // a STABLE UID: re-adding the same event UPDATES the phone's copy
    // instead of duplicating it.
    `UID:event-${ev.id}@azoneofficial.com`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `SUMMARY:${icsEscape(ev.title)}`,
  ];

  if (ev.start_time && /^\d{2}:\d{2}/.test(ev.start_time)) {
    const [sh, sm] = ev.start_time.split(":").map(Number);
    const startUtc = new Date(Date.UTC(y!, mo! - 1, d!, sh! - 8, sm!));
    // no end time → default one hour, so the calendar shows a real block
    let endUtc: Date;
    if (ev.end_time && /^\d{2}:\d{2}/.test(ev.end_time)) {
      const [eh, em] = ev.end_time.split(":").map(Number);
      endUtc = new Date(Date.UTC(y!, mo! - 1, d!, eh! - 8, em!));
      if (endUtc <= startUtc) endUtc = new Date(startUtc.getTime() + 3600_000);
    } else {
      endUtc = new Date(startUtc.getTime() + 3600_000);
    }
    const z = (dt: Date) =>
      `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;
    lines.push(`DTSTART:${z(startUtc)}`, `DTEND:${z(endUtc)}`);
  } else {
    const next = new Date(Date.UTC(y!, mo! - 1, d! + 1));
    lines.push(
      `DTSTART;VALUE=DATE:${y}${pad(mo!)}${pad(d!)}`,
      `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`,
    );
  }

  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  const desc = [ev.category ? `Category: ${ev.category}` : "", ev.details ?? ""].filter(Boolean).join("\n");
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
  lines.push(
    // buzz the phone the evening before AND at the start — the point of the
    // whole exercise is that nobody has to be looking at the portal.
    "BEGIN:VALARM", "TRIGGER:-PT15H", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(ev.title)} — tomorrow`, "END:VALARM",
    "BEGIN:VALARM", "TRIGGER:-PT0M", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(ev.title)}`, "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  );
  return new Blob([lines.map(fold).join("\r\n") + "\r\n"], { type: "text/calendar;charset=utf-8" });
}

/** Hand the .ics to the device: share sheet on a phone (lands on Calendar),
    download on a desktop (opens in Outlook / Apple Calendar). */
export async function addEventToCalendar(ev: CalendarEventLike): Promise<"shared" | "downloaded"> {
  const blob = buildEventIcs(ev);
  const filename = `${ev.event_date}-${ev.title.replace(/[^\w-]+/g, "-").slice(0, 40)}.ics`;
  if (typeof navigator.canShare === "function") {
    const file = new File([blob], filename, { type: "text/calendar" });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: ev.title }); } catch { /* sheet dismissed */ }
      return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}
