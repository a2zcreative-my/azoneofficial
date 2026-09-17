/* Calendar file export and provider drafts. Import behaviour depends on the
   calendar application; generating a file or opening a draft is not a save. */

const pad = (n: number) => String(n).padStart(2, "0");

/** RFC 5545 text escaping: backslash, comma, semicolon, newline. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Lines over 75 octets must fold onto a continuation line (RFC 5545 §3.1) —
    a long event description otherwise breaks strict parsers like Outlook. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "",
    bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) {
      out.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += length;
  }
  out.push(current);
  return out.join("\r\n");
}

export interface CalendarEventLike {
  id: number;
  title: string;
  event_date: string; // YYYY-MM-DD
  start_time?: string | null; // HH:MM (Malaysia time)
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
    // Stable identity; each calendar application decides how to handle re-imports.
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
      if (endUtc <= startUtc) endUtc = new Date(endUtc.getTime() + 86_400_000);
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
      `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`
    );
  }

  if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
  const desc = [ev.category ? `Category: ${ev.category}` : "", ev.details ?? ""]
    .filter(Boolean)
    .join("\n");
  if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
  lines.push(
    // Request alerts 15 hours before and at the start; importers may override them.
    "BEGIN:VALARM",
    "TRIGGER:-PT15H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(ev.title)} — upcoming`,
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT0M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(ev.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  );
  return new Blob([lines.map(fold).join("\r\n") + "\r\n"], {
    type: "text/calendar;charset=utf-8",
  });
}

/** Provider draft links do not prove that the person saved an event. */
export function calendarLinks(ev: CalendarEventLike): {
  google: string;
  outlook: string;
} {
  const start = new Date(
    `${ev.event_date}T${ev.start_time?.slice(0, 5) || "00:00"}:00+08:00`
  );
  let end =
    ev.end_time && ev.start_time
      ? new Date(`${ev.event_date}T${ev.end_time.slice(0, 5)}:00+08:00`)
      : new Date(start.getTime() + (ev.start_time ? 3600000 : 86400000));
  if (end <= start) end = new Date(end.getTime() + 86400000);
  const compact = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const nextDay = new Date(Date.parse(`${ev.event_date}T00:00:00Z`) + 86400000)
    .toISOString()
    .slice(0, 10);
  const google = new URL("https://calendar.google.com/calendar/render");
  google.search = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: ev.start_time
      ? `${compact(start)}/${compact(end)}`
      : `${ev.event_date.replaceAll("-", "")}/${nextDay.replaceAll("-", "")}`,
    ctz: "Asia/Kuala_Lumpur",
    details: ev.details || "",
    location: ev.location || "",
  }).toString();
  const outlook = new URL(
    "https://outlook.office.com/calendar/0/deeplink/compose"
  );
  outlook.search = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    startdt: ev.start_time ? start.toISOString() : ev.event_date,
    enddt: ev.start_time ? end.toISOString() : nextDay,
    allday: String(!ev.start_time),
    body: ev.details || "",
    location: ev.location || "",
  }).toString();
  return { google: google.href, outlook: outlook.href };
}
