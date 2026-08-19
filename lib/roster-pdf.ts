/* v1.22.4 — the weekly Schedule & Roster as a shareable PDF, in the CEO's
 * reference layout: a LANDSCAPE staff × day grid ("I want the share plan
 * looks same as the table that I share to you").
 *
 * Same structure as the on-screen Staff grid: left column = staff with their
 * weekly totals, seven day columns with per-day totals in the header, and
 * every session as a colour chip in the cell where person meets day — navy
 * tint = TikTok, gold tint = Shopee, neutral = other, green = completed,
 * amber = conflict, red band = approved leave. Cancelled sessions excluded.
 * Built on the in-house PDF writer (lib/doc-pdf.ts) so the letterhead and
 * colours match every other document we issue.
 */

import { Canvas, assemblePdf, sharePdfFile, widthOf, COLOURS, GEOM } from "@/lib/doc-pdf";
/* v1.28.0 — the roster is an operational snapshot, not a stamped legal
   record: it is regenerated fresh every time, so it always carries the
   CURRENT operating issuer (DOCUMENT_ISSUER), never a stored issuer_code. */
import { DOCUMENT_ISSUER } from "@/lib/issuers";

const { NAVY, GOLD, GREY, SLATE, HAIR, WHITE, GREEN } = COLOURS;
const { PAGE_W, PAGE_H } = GEOM;
/* Landscape: the sheet is PAGE_H wide and PAGE_W tall. */
const LW = PAGE_H, LH = PAGE_W;
const FM = 9 * 2.834645;
const FW = LW - 2 * FM;

/* Chip palette — the print twins of the on-screen tints. */
const TT_FILL = "0.925 0.933 0.953";   // navy 10%
const TT_EDGE = "0.732 0.764 0.828";
const SP_FILL = "0.973 0.945 0.862";   // gold soft
const SP_EDGE = GOLD;
const OT_FILL = "0.965 0.969 0.980";
const OT_EDGE = HAIR;
const OK_FILL = "0.910 0.957 0.929";   // completed
const OK_EDGE = GREEN;
const CF_FILL = "0.992 0.953 0.878";   // conflict
const CF_EDGE = "0.702 0.463 0.035";
const LV_FILL = "0.988 0.925 0.925";   // on leave
const LV_TEXT = "0.753 0.161 0.161";
const TODAY_FILL = "0.984 0.969 0.929";
const BAND_GREY = "0.949 0.957 0.973";

const DAY_LABEL = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const dmy = (iso: string) => { const p = iso.slice(0, 10).split("-"); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : iso; };
const dayLabel = (iso: string) => DAY_LABEL[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? "";

function clip(s: string, size: number, maxW: number, bold = false): string {
  if (widthOf(s, size, bold) <= maxW) return s;
  let t = s;
  while (t.length > 1 && widthOf(`${t}...`, size, bold) > maxW) t = t.slice(0, -1);
  return `${t}...`;
}

export interface RosterPdfSession {
  id: number; session_date: string; start_time: string; end_time?: string | null;
  client?: string | null; host_user_id: number; host_name: string; platform: string;
  notes?: string | null; status: string;
}
export interface RosterPdfLeave { user_id: number; start_date: string; end_date: string }
export interface RosterPdfStaff { id: number; name: string }

const minsOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/* v1.22.8: an overnight end (20:30–00:00) counts as next-day — the duration
   used to go negative and print as 30 min. */
const durOf = (s: RosterPdfSession) => {
  if (!s.end_time) return 60;
  let d = minsOf(s.end_time) - minsOf(s.start_time);
  if (d <= 0) d += 24 * 60;
  return Math.max(30, d);
};
const hrs = (m: number) => `${(m / 60).toFixed(m % 60 === 0 ? 0 : 1)} hrs`;

export function drawRosterGrid(
  days: string[], sessions: RosterPdfSession[], staff: RosterPdfStaff[],
  onLeave: RosterPdfLeave[], conflictIds: number[], generatedBy: string,
): string {
  const c = new Canvas(LH);
  const active = sessions
    .filter((s) => s.status !== "cancelled")
    .sort((a, b) => `${a.session_date}${a.start_time}`.localeCompare(`${b.session_date}${b.start_time}`));
  const todayIso = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const conflictSet = new Set(conflictIds);
  const leaveOn = (uid: number, d: string) => onLeave.some((l) => l.user_id === uid && l.start_date <= d && d <= l.end_date);

  /* Letterhead — compact for landscape. */
  let y = FM;
  c.rect(FM, y, FW, 3.4, GOLD); y += 3.4 + 5;
  c.text(DOCUMENT_ISSUER.name, FM + FW / 2, y + 10, 12, { bold: true, align: "c", spacing: 0.4 });
  c.text("LIVE  -  CONNECT  -  GROW", FM + FW / 2, y + 18, 5.5, { bold: true, colour: GOLD, align: "c", spacing: 2.2 });
  c.text(`Weekly Schedule & Roster  -  Week of ${dmy(days[0] ?? "")} - ${dmy(days[days.length - 1] ?? "")}`,
    FM + FW / 2, y + 30, 8.5, { bold: true, colour: SLATE, align: "c" });
  y += 38;

  /* Grid geometry. */
  const STAFF_W = 118;
  const dayW = (FW - STAFF_W) / 7;
  const edgeX = (i: number) => FM + STAFF_W + i * dayW; // left edge of day column i

  /* Header row. */
  const HEAD_H = 24;
  c.rect(FM, y, STAFF_W, HEAD_H, NAVY);
  c.text("STAFF", FM + 5, y + 9, 6, { bold: true, colour: WHITE, spacing: 0.8 });
  c.text(`${active.length} session${active.length === 1 ? "" : "s"} · ${hrs(active.reduce((a, s) => a + durOf(s), 0))}`,
    FM + 5, y + 18, 6.5, { bold: true, colour: WHITE });
  days.forEach((d, i) => {
    const x = edgeX(i);
    const dayS = active.filter((s) => s.session_date === d);
    c.box(x, y, dayW, HEAD_H, NAVY, 0.5);
    c.rect(x + 0.5, y + 0.5, dayW - 1, HEAD_H - 1, d === todayIso ? TODAY_FILL : BAND_GREY);
    c.text(`${dayLabel(d)} ${dmy(d).slice(0, 5)}`, x + dayW / 2, y + 10, 7, { bold: true, align: "c" });
    c.text(dayS.length === 0 ? "-" : `${dayS.length} · ${hrs(dayS.reduce((a, s) => a + durOf(s), 0))}`,
      x + dayW / 2, y + 19, 6, { colour: GREY, align: "c" });
  });
  y += HEAD_H;

  /* Staff rows — height grows with the busiest cell of the row. */
  const CHIP_H = 15, CELL_PAD = 3, LEAVE_H = 9;
  const footerY = LH - FM - 26;
  let skippedStaff = 0;

  for (const u of staff) {
    const mine = active.filter((s) => s.host_user_id === u.id);
    const maxChips = Math.max(1, ...days.map((d) =>
      mine.filter((s) => s.session_date === d).length + (leaveOn(u.id, d) ? 1 : 0)));
    const rowH = Math.max(24, CELL_PAD * 2 + maxChips * (CHIP_H + 2) - 2);
    if (y + rowH > footerY - 14) { skippedStaff++; continue; }

    /* staff cell */
    c.box(FM, y, STAFF_W, rowH, HAIR, 0.5);
    const shortName = u.name.split(" ").slice(0, 2).join(" ");
    c.text(clip(shortName, 7, STAFF_W - 10, true), FM + 5, y + 10, 7, { bold: true });
    c.text(mine.length === 0 ? "no sessions" : `${mine.length} session${mine.length === 1 ? "" : "s"} · ${hrs(mine.reduce((a, s) => a + durOf(s), 0))}`,
      FM + 5, y + 18, 5.5, { colour: GREY });

    /* day cells */
    days.forEach((d, i) => {
      const x = edgeX(i);
      c.box(x, y, dayW, rowH, HAIR, 0.5);
      if (d === todayIso) c.rect(x + 0.5, y + 0.5, dayW - 1, rowH - 1, "0.995 0.989 0.973");
      let cy = y + CELL_PAD;
      if (leaveOn(u.id, d)) {
        c.rect(x + 2.5, cy, dayW - 5, LEAVE_H, LV_FILL);
        c.text("ON LEAVE", x + dayW / 2, cy + 6.5, 5.5, { bold: true, colour: LV_TEXT, align: "c", spacing: 0.6 });
        cy += LEAVE_H + 2;
      }
      for (const s of mine.filter((v) => v.session_date === d)) {
        const [fill, edge] = conflictSet.has(s.id) ? [CF_FILL, CF_EDGE]
          : s.status === "completed" ? [OK_FILL, OK_EDGE]
          : s.platform === "tiktok" ? [TT_FILL, TT_EDGE]
          : s.platform === "shopee" ? [SP_FILL, SP_EDGE]
          : [OT_FILL, OT_EDGE];
        c.box(x + 2.5, cy, dayW - 5, CHIP_H, edge, 0.6);
        c.rect(x + 3, cy + 0.5, dayW - 6, CHIP_H - 1, fill);
        c.text(clip(s.client?.trim() || "Live session", 6, dayW - 12, true), x + 5.5, cy + 6.5, 6, { bold: true });
        c.text(`${s.start_time}${s.end_time ? `-${s.end_time}` : ""} · ${durOf(s)} min`, x + 5.5, cy + 12.5, 5, { colour: SLATE });
        cy += CHIP_H + 2;
      }
    });
    y += rowH;
  }

  if (skippedStaff > 0) {
    y += 3;
    c.text(`+${skippedStaff} more staff row${skippedStaff === 1 ? "" : "s"} - see the portal roster.`, FM, y + 7, 6.5, { bold: true, colour: SLATE });
    y += 11;
  }

  /* Legend. */
  y += 6;
  let lx = FM;
  const legend: [string, string, string][] = [
    ["TikTok", TT_FILL, TT_EDGE], ["Shopee", SP_FILL, SP_EDGE], ["Other", OT_FILL, OT_EDGE],
    ["Completed", OK_FILL, OK_EDGE], ["Conflict", CF_FILL, CF_EDGE], ["On leave", LV_FILL, LV_TEXT],
  ];
  for (const [label, fill, edge] of legend) {
    c.box(lx, y, 7, 7, edge, 0.6);
    c.rect(lx + 0.5, y + 0.5, 6, 6, fill);
    c.text(label, lx + 10, y + 5.5, 6, { colour: SLATE });
    lx += 10 + widthOf(label, 6, false) + 14;
  }

  /* Footer. */
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  const stamp = `${now.slice(8, 10)}-${now.slice(5, 7)}-${now.slice(0, 4)} ${now.slice(11, 16)} MYT`;
  /* Same one-line footer style as the HR forms: registered address without
     the trailing country. */
  c.wrap(`${DOCUMENT_ISSUER.name} - ${DOCUMENT_ISSUER.registration} - ${DOCUMENT_ISSUER.address.replace(/, Malaysia$/, "")} - Generated by ${generatedBy} on ${stamp}. Hosts are notified in the staff portal; this PDF is a snapshot for awareness - the in-system roster is authoritative.`,
    FM, footerY, FW, 6, 7.5, { colour: GREY });

  return c.ops.join("\n");
}

/** Build the staff×day roster grid PDF and hand it to the share sheet. */
export async function shareRosterPdf(
  days: string[], sessions: RosterPdfSession[], staff: RosterPdfStaff[],
  onLeave: RosterPdfLeave[], conflictIds: number[], generatedBy: string,
): Promise<"shared" | "downloaded"> {
  const weekTag = days[0] ? days[0]!.slice(0, 10) : "week";
  const blob = new Blob(
    [assemblePdf(drawRosterGrid(days, sessions, staff, onLeave, conflictIds, generatedBy), [], `A2Z Roster ${weekTag}`, true) as BlobPart],
    { type: "application/pdf" },
  );
  return sharePdfFile(blob, `a2z-roster-${weekTag}.pdf`, "A2Z Weekly Roster");
}
