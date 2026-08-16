/* v1.22.2 — the weekly Schedule & Roster as a shareable PDF.
 *
 * CEO: "help to generate 1 schedule table in PDF so that I can share to them
 * for their awareness, make the table looks nice."
 *
 * Built on the same in-house PDF writer as the claim/leave forms
 * (lib/doc-pdf.ts), so the letterhead, colours and typography match every
 * other AZ ONE document. One A4 page: gold band letterhead, then a bordered
 * table grouped by day — a tinted day band (MONDAY · 17-08-2026 · 2 sessions)
 * followed by that day's rows: Time | Session / Client | Host | Platform |
 * Notes. Cancelled sessions are excluded. If a very full week overflows the
 * page, the tail is summarised ("+N more — see the portal") rather than
 * clipped silently.
 */

import { Canvas, assemblePdf, sharePdfFile, widthOf, COLOURS, GEOM } from "@/lib/doc-pdf";

const { NAVY, GOLD, GREY, SLATE, HAIR, WHITE } = COLOURS;
const { PAGE_W, PAGE_H } = GEOM;
const FM = 9 * 2.834645; // 9mm margin, same as the HR forms
const FW = PAGE_W - 2 * FM;
const BAND_GREY = "0.949 0.957 0.973"; // the forms' key-cell tint

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

const dmy = (iso: string) => {
  const p = iso.slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso;
};
const dayName = (iso: string) => DAY_NAMES[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? "";

/** Truncate `s` with an ellipsis so it fits `maxW` points at `size`. */
function clip(s: string, size: number, maxW: number, bold = false): string {
  if (widthOf(s, size, bold) <= maxW) return s;
  let t = s;
  while (t.length > 1 && widthOf(`${t}...`, size, bold) > maxW) t = t.slice(0, -1);
  return `${t}...`;
}

export interface RosterPdfSession {
  session_date: string; start_time: string; end_time?: string | null;
  client?: string | null; host_name: string; platform: string;
  notes?: string | null; status: string;
}

export function drawRoster(days: string[], sessions: RosterPdfSession[], generatedBy: string): string {
  const c = new Canvas();

  /* Letterhead — same composition as the HR forms. */
  let y = FM;
  c.rect(FM, y, FW, 3.75, GOLD); y += 3.75 + 7;
  c.text("AZ ONE OFFICIAL", FM + FW / 2, y + 11, 13.5, { bold: true, align: "c", spacing: 0.4 });
  c.text("LIVE  -  CONNECT  -  GROW", FM + FW / 2, y + 20, 6, { bold: true, colour: GOLD, align: "c", spacing: 2.4 });
  c.text("Weekly Schedule & Roster", FM + FW / 2, y + 34, 9.75, { align: "c" });
  const weekLabel = days.length ? `Week of ${dmy(days[0]!)} - ${dmy(days[days.length - 1]!)}` : "";
  c.text(weekLabel, FM + FW / 2, y + 46, 8.25, { bold: true, colour: SLATE, align: "c" });
  y += 56;

  /* Column geometry: Time | Session / Client | Host | Platform | Notes */
  const colW = [FW * 0.13, FW * 0.30, FW * 0.26, FW * 0.10, FW * 0.21];
  const edge = [FM];
  for (const w of colW) edge.push(edge[edge.length - 1]! + w);

  /* Header row — navy, white caps. */
  c.rect(FM, y, FW, 15, NAVY);
  ["Time", "Session / Client", "Host", "Platform", "Notes"].forEach((h, i) => {
    c.text(h, edge[i]! + 5, y + 10, 7, { bold: true, colour: WHITE, spacing: 0.5 });
  });
  y += 15;

  const active = sessions
    .filter((s) => s.status !== "cancelled")
    .sort((a, b) => `${a.session_date}${a.start_time}`.localeCompare(`${b.session_date}${b.start_time}`));

  const ROW_H = 16, BAND_H = 14;
  const limitY = PAGE_H - FM - 46; // leave room for the footer
  let drawn = 0, truncated = 0;

  for (const d of days) {
    const dayS = active.filter((s) => s.session_date === d);
    if (y + BAND_H + (dayS.length ? ROW_H : 0) > limitY) { truncated += dayS.length; continue; }

    /* Day band. */
    c.box(FM, y, FW, BAND_H, NAVY, 0.5);
    c.rect(FM + 0.6, y + 0.6, FW - 1.2, BAND_H - 1.2, BAND_GREY);
    c.text(`${dayName(d)}  ·  ${dmy(d)}`, FM + 5, y + 10, 7.5, { bold: true, spacing: 0.3 });
    c.text(dayS.length === 0 ? "no sessions" : `${dayS.length} session${dayS.length === 1 ? "" : "s"}`,
      FM + FW - 5, y + 10, 7, { colour: GREY, align: "r" });
    y += BAND_H;

    for (const s of dayS) {
      if (y + ROW_H > limitY) { truncated++; continue; }
      for (let k = 0; k < 5; k++) c.box(edge[k]!, y, colW[k]!, ROW_H, HAIR, 0.5);
      const time = `${s.start_time}${s.end_time ? `-${s.end_time}` : ""}`;
      c.text(time, edge[0]! + 5, y + 11, 7.5, { bold: true });
      c.text(clip(s.client?.trim() || "Live session", 7.5, colW[1]! - 10), edge[1]! + 5, y + 11, 7.5);
      c.text(clip(s.host_name.toUpperCase(), 7.5, colW[2]! - 10), edge[2]! + 5, y + 11, 7.5);
      c.text(s.platform, edge[3]! + 5, y + 11, 7.5);
      c.text(clip(s.notes ?? "", 7, colW[4]! - 10), edge[4]! + 5, y + 11, 7, { colour: SLATE });
      y += ROW_H;
      drawn++;
    }
  }

  if (truncated > 0) {
    y += 4;
    c.text(`+${truncated} more session${truncated === 1 ? "" : "s"} this week - see the portal roster for the full list.`,
      FM, y + 8, 7.5, { bold: true, colour: SLATE });
    y += 14;
  }

  /* Legend / note + footer. */
  y += 10;
  c.wrap("Hosts are notified in the staff portal when a session is assigned or moved. This PDF is a snapshot for awareness - the in-system roster is authoritative.",
    FM, y, FW, 9, 7.5, { colour: SLATE });

  const fy = PAGE_H - FM - 14;
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const stamp = `${now.toISOString().slice(8, 10)}-${now.toISOString().slice(5, 7)}-${now.toISOString().slice(0, 4)} ${now.toISOString().slice(11, 16)} MYT`;
  c.wrap(`AZ ONE OFFICIAL - SSM 202603168673 (JM1046169-H) - 34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor - Generated by ${generatedBy} on ${stamp}. ${drawn} session(s) listed.`,
    FM, fy, FW, 6, 8, { colour: GREY });

  return c.ops.join("\n");
}

/** Build and hand the roster PDF to the share sheet (or download it). */
export async function shareRosterPdf(days: string[], sessions: RosterPdfSession[], generatedBy: string): Promise<"shared" | "downloaded"> {
  const weekTag = days[0] ? days[0]!.slice(0, 10) : "week";
  const blob = new Blob(
    [assemblePdf(drawRoster(days, sessions, generatedBy), [], `AZ ONE Roster ${weekTag}`) as BlobPart],
    { type: "application/pdf" },
  );
  return sharePdfFile(blob, `azone-roster-${weekTag}.pdf`, "AZ ONE Weekly Roster");
}
