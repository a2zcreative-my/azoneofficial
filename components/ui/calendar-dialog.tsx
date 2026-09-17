"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Download, ExternalLink } from "lucide-react";
import { openAppDialog } from "@/components/ui/app-dialog";
import {
  buildEventIcs,
  calendarLinks,
  type CalendarEventLike,
} from "@/lib/event-ics";
import { getLang } from "@/lib/i18n";
import { btnClass, btnGhost } from "@/lib/ui-styles";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
export function openCalendarDialog(event: CalendarEventLike): void {
  openAppDialog(
    L("Add to calendar", "Tambah ke kalendar"),
    <CalendarOptions event={event} />
  );
}

function CalendarOptions({ event }: { event: CalendarEventLike }) {
  const [file, setFile] = useState("");
  const [message, setMessage] = useState("");
  const links = calendarLinks(event);
  useEffect(() => {
    const url = URL.createObjectURL(buildEventIcs(event));
    setFile(url);
    return () => URL.revokeObjectURL(url);
  }, [event]);
  return (
    <div className="mx-auto max-w-lg space-y-4 p-4">
      <CalendarDays size={24} className="text-muted-foreground" aria-hidden />
      <h3 className="text-base font-semibold break-words">{event.title}</h3>
      <p className="text-muted-foreground text-sm">
        {event.event_date}
        {event.start_time
          ? ` / ${event.start_time}${event.end_time ? ` - ${event.end_time}` : ""} MYT`
          : ` / ${L("All day", "Sepanjang hari")}`}
      </p>
      {event.location && (
        <p className="text-sm break-words">{event.location}</p>
      )}
      <div className="flex flex-col items-stretch gap-3">
        <a
          className={btnClass}
          href={links.google}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink aria-hidden size={18} />
          Google Calendar
        </a>
        <a
          className={btnGhost}
          href={links.outlook}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink aria-hidden size={18} />
          Outlook
        </a>
        {file && (
          <a
            className={btnGhost}
            href={file}
            download={`event-${event.id}.ics`}
            onClick={() =>
              setMessage(
                L(
                  "Calendar file requested. Import it in your calendar to finish saving.",
                  "Fail kalendar diminta. Import ke kalendar anda untuk melengkapkan simpanan."
                )
              )
            }
          >
            <Download aria-hidden size={18} />
            {L(
              "Download calendar file (.ics)",
              "Muat turun fail kalendar (.ics)"
            )}
          </a>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {L(
          "Save the event in the calendar you choose. The portal cannot confirm that it was saved.",
          "Simpan acara dalam kalendar pilihan anda. Portal tidak dapat mengesahkan bahawa ia telah disimpan."
        )}
      </p>
      <p className="text-muted-foreground text-sm">
        {L(
          "For Apple Calendar, use a connected Google or Outlook account, or import the calendar file using Mail or Calendar on a Mac.",
          "Untuk Apple Calendar, gunakan akaun Google atau Outlook yang disambungkan, atau import fail kalendar melalui Mail atau Calendar pada Mac."
        )}
      </p>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
