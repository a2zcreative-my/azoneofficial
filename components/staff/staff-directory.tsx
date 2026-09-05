"use client";

/**
 * Staff directory & ID badges (v1.4.22).
 *
 *  - Live badge preview: the card renders on screen from the current values
 *    (updates as you type) before anything is printed.
 *  - Amendment lock: once a field is saved it greys out for HR — changing a
 *    set value is admin-only (/admin → Staff). Empty fields stay editable so
 *    HR can complete records. Enforced server-side too, not just visually.
 *  - Badge carries the company logo (not text) and DOCUMENT_ISSUER's identity
 *    (v1.28.0 — the badge names the CURRENT employer), the staff full name
 *    and phone number. Blood type is retired from both the form and the card.
 */

import { makeApi, csrfFetch } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
import { bySeniority, isStaffRole } from "@/lib/staff-order"; // v1.78.0 - one company order, shared with Payroll
const api = makeApi("/staff");
/* v1.77.0 — offboarding is NOT a staff-portal route. It is served at
   /api/v1/users/:id/offboard in the worker's own dispatcher, next to the
   other account-lifecycle routes, because it kills sessions and clears 2FA.
   Calling it through the staff-scoped helper produced
   /api/v1/staff/users/42/offboard, which handleStaff does not serve, so the
   CEO's Offboard button answered "Staff route not found" every time.
   tests/api-routes.mjs now checks every client path against the routes the
   worker actually serves, so a helper with the wrong base cannot ship again. */
const apiRoot = makeApi("");
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { esc, safeUrl } from "@/lib/escape-html";
import { dmy } from "@/lib/format";
import { properName, displayName, givenNames } from "@/lib/names";
import { compressImage } from "@/lib/compress-image";
import { useSaveToast } from "@/components/ui/save-toast";
import { PasswordInput } from "@/components/ui/password-input";
import { card } from "@/lib/ui-styles";
import { Skel } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger } from "@/components/ui/row-button";
/* v1.77.0 — useConfirm is gone from this file: offboarding was its only user
   and it now asks for a date, which the prompt dialog does. The friction is
   not lost — you cannot offboard without choosing a date and pressing a red
   button. */
import { usePrompt } from "@/components/ui/prompt-dialog";
import { RecordToggle } from "@/components/ui/record-row";
/* v1.28.0 — the ID badge identifies the CURRENT employer, so it carries
   DOCUMENT_ISSUER (lib/issuers.ts), not a hardcoded company block. */
import { DOCUMENT_ISSUER } from "@/lib/issuers";
import { getLang } from "@/lib/i18n";
/* v1.101.0 - the organisation chart. CEO, 05-09-2026: "I want to add
   infographic for each staff reported to who which is either CEO, COO or CCO.
   I will assigned by myself and organized it based on who is their HOD to make
   it like organisation." It is a VIEW of this same list, not a tab of its
   own - one fetch, one set of permissions, and pressing a box opens the same
   record card that is already below. */
import { OrgChart, ORG_ASSIGN_ROLES } from "@/components/staff/org-chart";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const API = "/api/v1/staff";

/** Today in Malaysia, as YYYY-MM-DD. The same expression the worker uses for
    its own default, so the date pre-filled in the offboard dialog is exactly
    the date the server would have chosen — a laptop left on UTC must not
    suggest yesterday as somebody's last day. */
const todayIso = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);


const input = "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring disabled:bg-secondary/60 disabled:text-muted-foreground disabled:cursor-not-allowed";

/** v1.4.135: subhead label above a placeholder field — the field's purpose
    stays visible after the placeholder disappears. */
function Sub({ t, children }: { t: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{t}</span>
      {children}
    </label>
  );
}
const btn = "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium transition-colors";

interface Staff {
  ic_number?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  joined_on?: string | null;
  left_on?: string | null;
  rejoined_on?: string | null;
  id: number;
  name: string;
  full_name?: string | null;
  email: string;
  role: string;
  employee_id?: string | null;
  position?: string | null;
  department?: string | null;
  phone?: string | null;
  id_issued_on?: string | null;
  birthday?: string | null;
  blood_type?: string | null;
  photo_key?: string | null;
  is_active: number;
  employment_status?: string | null;
  /* v1.4.213 profile fields */
  address?: string | null;
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relation?: string | null;
  epf_no?: string | null;
  socso_no?: string | null;
  tax_no?: string | null;
  /* v1.101.0 - who this person answers to (users.reports_to, migration 0113).
     null means not placed on the organisation chart yet. */
  reports_to?: number | null;
}

interface ErrShape { error?: { message?: string } }

/* ---------------- badge ---------------- */

/* Dates: the database stores ISO (YYYY-MM-DD) so sorting and payroll queries
   stay sane; people type and read DD-MM-YYYY. These two convert at the edge. */
function isoToDMY(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}
function dmyToISO(v: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}
const DATE_KEYS = ["birthday", "id_issued_on", "joined_on", "left_on", "rejoined_on"] as const;

/** Malaysian banks — Maybank first (company primary bank). */
const MY_BANKS = [
  "Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank",
  "AmBank", "Bank Islam", "Bank Rakyat", "BSN", "Affin Bank",
  "Alliance Bank", "OCBC Bank", "HSBC Bank", "Standard Chartered", "UOB Malaysia",
];
// v1.4.101: full lifecycle — Resigned/Terminated end payroll after the
// effective date; a re-join brings payroll back from the re-join month.
const EMPLOYMENT_STATUSES = ["permanent", "contract", "part_time", "resigned", "terminated"];
const SELECT_FIELDS: Partial<Record<string, string[]>> = {
  bank_name: MY_BANKS,
  employment_status: EMPLOYMENT_STATUSES,
};

/** Company location shown on every badge. */
// v1.4.108: the FULL registered address on the badge (two lines).
// v1.28.0: sourced from DOCUMENT_ISSUER — the badge names the CURRENT
// employer; lib/issuers.ts is the only place identity data lives.
const COMPANY_LOCATION = DOCUMENT_ISSUER.addressLines.join("<br/>");

/** The one source of truth for what a badge shows. */
function badgeData(s: Staff) {
  return {
    name: (s.full_name?.trim() || s.name) ?? "",
    role: s.role.replace(/_/g, " "),
    employee_id: s.employee_id ?? "",
    position: s.position ?? "",
    department: s.department ?? "",
    phone: s.phone ?? "",
    ic: s.ic_number ?? "",
    joined: s.joined_on ? isoToDMY(s.joined_on) : "",
    issued: s.id_issued_on ? isoToDMY(s.id_issued_on) : "",
    photo: s.photo_key ? `/api/v1/media/file/${encodeURIComponent(s.photo_key)}` : "",
  };
}

/** On-screen live preview at true PORTRAIT card size (54 × 85.6 mm, ID-1 rotated). */
function BadgePreview({ s }: { s: Staff }) {
  // An iframe renders the EXACT print document in isolation — the badge CSS
  // cannot leak into the page, and page styles cannot distort the badge.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <iframe
      title={L("Badge preview", "Pratonton lencana")}
      srcDoc={badgeDocHtml(s, origin)}
      style={{ width: "54mm", height: "85.6mm", border: "none", pointerEvents: "none", display: "block" }}
    />
  );
}

/** Print at true PORTRAIT dimensions — same layout as the preview. */
const BADGE_CSS = `
    html,body{margin:0;padding:0;background:transparent;-webkit-print-color-adjust: exact; print-color-adjust: exact;} /* v1.4.239 */
    /* v1.4.167 (CEO): content lowered + spacing spread so the card has no
       big white block above the footer — logo sits lower, photo/name/rows
       breathe more; the footer stays pinned by margin-top:auto. */
    .card{width:54mm;height:85.6mm;box-sizing:border-box;padding:4.4mm 4mm 3mm;
      font-family:Arial,Helvetica,sans-serif;color:#1a2946;
      background:#fff;overflow:hidden;border:0.3mm solid #1a2946;
      display:flex;flex-direction:column;align-items:stretch}
    .photo{width:20mm;height:24mm;margin:3.2mm auto 0;border:0.2mm solid #dfe3ec;
      background:#f4f6fb;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
    .photo img{width:100%;height:100%;object-fit:cover}
    .tagline{margin-top:1.4mm;text-align:center;font-size:4.4px;font-weight:700;
      letter-spacing:.3em;color:#b98a2e;text-transform:uppercase;flex:none}
    .rows{margin-top:3.6mm;text-align:left}
    .row{display:flex;align-items:baseline;padding:0.85mm 0}
    .row .k{flex:none;width:14.5mm;font-size:6.2px;font-weight:800;letter-spacing:.04em}
    .row .c{flex:none;width:2mm;font-size:7.2px;font-weight:600}
    .row .v{flex:1;font-size:7.2px;font-weight:600;line-height:1.25}
    .foot{margin-top:auto;padding-top:1mm;border-top:0.2mm solid #dfe3ec;
      display:flex;justify-content:space-between;align-items:flex-end;gap:2mm;
      font-size:4.8px;line-height:1.35;color:#8a93a6}
    .foot .left{text-align:left}
    .foot .right{text-align:right}
`;

function badgeCardHtml(s: Staff, origin: string): string {
  const d = badgeData(s);
  const logo = `${origin}/logo.png`;
  const photo = d.photo ? `${origin}${d.photo}` : "";
  /* v1.45.0 (security audit C7): every value below is a staff record someone
     typed, and this document is built as a STRING — React's escaping does
     not reach here. esc() puts it back; without it a name containing markup
     is parsed AS markup inside a same-origin print window. */
  const row = (label: string, value: string) =>
    `<div class="row"><span class="k">${esc(label)}</span><span class="c">:</span><span class="v">${esc(value) || "—"}</span></div>`;
  return `<div class="card">
    <img src="${safeUrl(logo)}" alt="${esc(DOCUMENT_ISSUER.name)}" style="height:7mm;width:auto;align-self:center;flex:none"/>
    <div class="tagline">Live · Connect · Grow</div>
    <div class="photo">${photo ? `<img src="${safeUrl(photo)}" alt="${esc(d.name)}"/>` : `<span style="font-size:6px;color:#8a93a6">PHOTO</span>`}</div>
    <div class="rows">
      ${row("NAME", d.name.toUpperCase())}
      ${row("EMP. NO", d.employee_id)}
      ${row("NRIC", d.ic)}
      ${row("DATE JOIN", d.joined)}
      ${row("DATE ISSUED", d.issued)}
      ${row("POSITION", (d.position || "").toUpperCase())}
      ${row("DEPARTMENT", (d.department || "").toUpperCase())}
    </div>
    <div class="foot">
      <!-- COMPANY_LOCATION is a build-time constant that deliberately
           carries <br/> line breaks (lib/issuers.ts), so it is intentionally
           NOT escaped; it can never contain user input. -->
      <span class="left">${COMPANY_LOCATION}</span>
      <span class="right">SSM ${esc(DOCUMENT_ISSUER.ssm)}<br/>(${esc(DOCUMENT_ISSUER.oldReg)})</span>
    </div>
  </div>`;
}

/** Full standalone document for the card — used verbatim by the preview
    iframe and the print windows, so all three can never differ. */
function badgeDocHtml(s: Staff, origin: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BADGE_CSS}</style></head><body>${badgeCardHtml(s, origin)}</body></html>`;
}

function printBadge(s: Staff) {
  const w = window.open("", "_blank", "width=300,height=520");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${L("Badge", "Lencana")} — ${esc(s.full_name || s.name)}</title>
  <style>@page { size: 54mm 85.6mm; margin: 0; }${BADGE_CSS}</style></head>
  <body onload="setTimeout(function(){window.print()},250)">
  ${badgeCardHtml(s, window.location.origin)}
  </body></html>`);
  w.document.close();
}

/** Multi-badge sheet (v1.4.43): several badges per A4 page — 3 × 3 = up to
    nine 54×85.6 mm cards per sheet, saving paper over one page per badge. */
function printBadges(list: Staff[]) {
  if (list.length === 0) return;
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  const origin = window.location.origin;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${L("Badges", "Lencana")} — ${list.length} ${L("staff", "kakitangan")}</title>
  <style>
    @page { size: A4; margin: 8mm; }
    ${BADGE_CSS}
    .sheet{display:flex;flex-wrap:wrap;gap:5mm}
    .sheet .card{page-break-inside:avoid}
  </style></head>
  <body onload="setTimeout(function(){window.print()},400)">
  <div class="sheet">
    ${list.map((s) => badgeCardHtml(s, origin)).join("")}
  </div></body></html>`);
  w.document.close();
}

/* ---------------- directory ---------------- */

/* v1.4.213 (CEO: "minimalist … like a profile looks which is easier for my
   hr to update"): the flat field grid becomes a PROFILE — three sections
   with subheads, personal first the way a profile reads. New fields the
   record was missing: emergency contact + home address (duty of care) and
   EPF / SOCSO / income-tax numbers (payroll needs them the moment the
   pending statutory registration completes). Same inputs, same lock
   policy — only the grouping and the seven additions are new. */
const RECORD_SECTIONS: { title: string; fields: [keyof Staff, string][] }[] = [
  {
    title: "👤 Personal",
    fields: [
      ["full_name", "Full name (as per IC)"],
      ["ic_number", "IC number (NRIC)"],
      ["birthday", "Birth date"],
      ["blood_type", "Blood type (not on badge)"],
      ["phone", "Phone number"],
      ["address", "Home address"],
      ["emergency_name", "Emergency contact — name"],
      ["emergency_phone", "Emergency contact — phone"],
      ["emergency_relation", "Emergency contact — relationship"],
    ],
  },
  {
    title: "💼 Employment",
    fields: [
      ["employee_id", "Employee ID"],
      ["position", "Position"],
      ["department", "Department"],
      ["employment_status", "Employment status"],
      ["joined_on", "Joined on"],
      ["id_issued_on", "ID issued"],
      ["left_on", "End date (resign/terminate)"],
      ["rejoined_on", "Re-joined on"],
    ],
  },
  {
    title: "🏦 Bank & statutory",
    fields: [
      ["bank_name", "Bank (Malaysia)"],
      ["bank_account", "Bank account no."],
      ["epf_no", "EPF (KWSP) no."],
      ["socso_no", "SOCSO (PERKESO) no."],
      ["tax_no", "Income tax no. (LHDN)"],
    ],
  },
];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RECORD_FIELDS: [keyof Staff, string][] = RECORD_SECTIONS.flatMap((s) => s.fields);

/** v1.4.105: format hints IN the boxes — HR/CEO/COO see the exact shape a
    field expects without long labels. Empty boxes show the example; long
    explanations moved to hover titles so labels stay short. */
const FIELD_PLACEHOLDERS: Partial<Record<keyof Staff, string>> = {
  /* v1.4.213 profile fields */
  address: "e.g. 12, Jalan Mawar 3, 81100 Johor Bahru",
  emergency_name: "e.g. SITI BINTI AHMAD",
  emergency_phone: "+60 1X-XXX XXXX",
  emergency_relation: "e.g. mother / spouse",
  epf_no: "KWSP member no.",
  socso_no: "PERKESO no. (usually = IC)",
  tax_no: "e.g. SG 12345678090",
  full_name: "e.g. MOHD ALIF FARHAN BIN NAZARUDIN",
  ic_number: "XXXXXX-XX-XXXX",
  phone: "+60 12-345 6789",
  employee_id: "e.g. AZOOM001",
  position: "e.g. Chief Executive Officer",
  department: "e.g. Management",
  birthday: "DD-MM-YYYY · e.g. 09-02-1997",
  id_issued_on: "DD-MM-YYYY",
  blood_type: "e.g. O / A+ / B−",
  left_on: "DD-MM-YYYY (last paid day)",
  rejoined_on: "DD-MM-YYYY (payroll resumes)",
  joined_on: "DD-MM-YYYY · e.g. 20-07-2026",
  bank_account: "numbers only · e.g. 551100338444",
};
const FIELD_TITLES: Partial<Record<keyof Staff, string>> = {
  ic_number: "Malaysian NRIC in the format XXXXXX-XX-XXXX",
  left_on: "Effective resignation/termination date — payroll runs up to and including this date",
  rejoined_on: "Re-join date — payroll resumes from this month",
  bank_account: "Digits only, no dashes or spaces — prints on the payslip",
};

/* Display-only BM lookups — the keys, API values and EN sources above never
   change; these are read at render time so the language toggle applies live. */
const SECTION_TITLE_MS: Record<string, string> = {
  "👤 Personal": "👤 Peribadi",
  "💼 Employment": "💼 Pekerjaan",
  "🏦 Bank & statutory": "🏦 Bank & statutori",
};
const FIELD_LABEL_MS: Partial<Record<keyof Staff, string>> = {
  full_name: "Nama penuh (seperti dalam IC)",
  ic_number: "Nombor IC (NRIC)",
  birthday: "Tarikh lahir",
  blood_type: "Jenis darah (tiada pada lencana)",
  phone: "Nombor telefon",
  address: "Alamat rumah",
  emergency_name: "Hubungan kecemasan — nama",
  emergency_phone: "Hubungan kecemasan — telefon",
  emergency_relation: "Hubungan kecemasan — pertalian",
  employee_id: "ID pekerja",
  position: "Jawatan",
  department: "Jabatan",
  employment_status: "Status pekerjaan",
  joined_on: "Mula bekerja pada",
  id_issued_on: "ID dikeluarkan",
  left_on: "Tarikh tamat (letak jawatan/tamat khidmat)",
  rejoined_on: "Kembali bekerja pada",
  bank_name: "Bank (Malaysia)",
  bank_account: "No. akaun bank",
  epf_no: "No. EPF (KWSP)",
  socso_no: "No. SOCSO (PERKESO)",
  tax_no: "No. cukai pendapatan (LHDN)",
};
const FIELD_PLACEHOLDERS_MS: Partial<Record<keyof Staff, string>> = {
  address: "cth. 12, Jalan Mawar 3, 81100 Johor Bahru",
  emergency_name: "cth. SITI BINTI AHMAD",
  emergency_relation: "cth. ibu / pasangan",
  epf_no: "No. ahli KWSP",
  socso_no: "No. PERKESO (biasanya = IC)",
  tax_no: "cth. SG 12345678090",
  full_name: "cth. MOHD ALIF FARHAN BIN NAZARUDIN",
  employee_id: "cth. AZOOM001",
  position: "cth. Ketua Pegawai Eksekutif",
  department: "cth. Pengurusan",
  birthday: "DD-MM-YYYY · cth. 09-02-1997",
  blood_type: "cth. O / A+ / B−",
  left_on: "DD-MM-YYYY (hari terakhir dibayar)",
  rejoined_on: "DD-MM-YYYY (gaji bersambung semula)",
  joined_on: "DD-MM-YYYY · cth. 20-07-2026",
  bank_account: "nombor sahaja · cth. 551100338444",
};
const FIELD_TITLES_MS: Partial<Record<keyof Staff, string>> = {
  ic_number: "NRIC Malaysia dalam format XXXXXX-XX-XXXX",
  left_on: "Tarikh berkuat kuasa letak jawatan/tamat khidmat — gaji berjalan sehingga dan termasuk tarikh ini",
  rejoined_on: "Tarikh kembali bekerja — gaji bersambung semula dari bulan ini",
  bank_account: "Digit sahaja, tiada sengkang atau ruang — dicetak pada slip gaji",
};
const STATUS_MS: Record<string, string> = {
  permanent: "tetap", contract: "kontrak", part_time: "separuh masa",
  resigned: "letak jawatan", terminated: "ditamatkan",
};
const ROLE_MS: Record<string, string> = {
  editor: "editor", marketing: "pemasaran", live_host: "hos siaran langsung",
  hr_admin: "admin HR", sales_marketing: "jualan & pemasaran",
};

/**
 * v1.92.0 — THE DIRECTORY IS A ROW OF FACES. CEO, 04-09-2026: *"for Staff
 * tabs content I want the table change to circle avatar which is minimalist
 * the interface so that I can clickable to the staff bubbles circle like an
 * animation."*
 *
 * The list drew one full-width card per person, closed — six rows of
 * checkbox · name · role · id before the first record could be opened, and
 * the record itself (the form, the badge, the vault, the exit) is what the
 * tab is for. A closed record is now a circle: the photo when one is on
 * file, initials on the brand colour when not, the given name under it,
 * the role under that. Press one and the record opens below the row — one
 * at a time, because two open records was never a thing anybody did on
 * purpose. A leaver keeps a red ring and their last day, because the Staff
 * tab is the one place they are still listed (v1.87.0).
 *
 * Printing badges for several people needs a selection, so a Select toggle
 * turns the row into a picker: pressing a circle ticks it instead of
 * opening it. The mode is visible on every circle so nobody presses a face
 * expecting one thing and getting the other.
 *
 * Module scope, per guard #30.
 */
/**
 * v1.93.0 — the birthday lives on the person. CEO, 04-09-2026: *"the
 * birthday should be embedded into the staff card!"* The separate
 * Birthdays card listed everyone with a date box each; the date is already a
 * field on the record, so what the card was FOR — knowing whose day is
 * coming — is now a cake on the face when it is within a fortnight, and a
 * line on the open record with the age they turn.
 */
export function birthdayInfo(birthday: string | null | undefined, todayIso: string): { days: number; turns: number; next: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [ty, tm, td] = todayIso.split("-").map(Number) as [number, number, number];
  const today = Date.UTC(ty, tm - 1, td);
  let next = Date.UTC(ty, mo - 1, d);
  if (next < today) next = Date.UTC(ty + 1, mo - 1, d);
  const days = Math.round((next - today) / 86400000);
  const nextYear = new Date(next).getUTCFullYear();
  return { days, turns: nextYear - y, next: `${String(d).padStart(2, "0")}-${String(mo).padStart(2, "0")}` };
}

/**
 * v1.93.0 — THE CIRCLE. CEO, 04-09-2026, a frame from the LazyThreads video
 * of its Circle screen: *"Staff tabs content should be like this."*
 *
 * v1.99.1 — REDRAWN. CEO, 05-09-2026, a screenshot of the first version:
 * *"make this circle bubbles looks better and nice interface!"* The first
 * draft put one ring per TIER — five rings, 13% apart, on a 544px square —
 * so a face and its two-line label (110px tall) sat on a 70px gap: Nasuha
 * over Izzudin's caption, Nurfarah's name wrapped, and the rings themselves
 * were too faint to read as rings.
 *
 * Now the company is ONE orbit (two when there are more than eight, three
 * beyond sixteen), walked clockwise from the top in company order, with the
 * most senior person at the centre. The tier is in the ORDER round the ring
 * and in the caption, not in a radius of its own - which is how a nine-person
 * team fits a circle a person can read. Leavers come last and faded. Radii
 * are chosen so the arc between neighbours is wider than a cell; a spoke
 * from the centre to each face makes the shape read as an orbit at a glance.
 */
interface Orbit { u: Staff; left: number; top: number; ring: number; r: number; angleDeg: number }
function circleLayout(list: Staff[]): Orbit[] {
  if (list.length === 0) return [];
  const gone = (u: Staff) => ["resigned", "terminated"].includes(u.employment_status ?? "");
  /* The centre: the CEO, or failing one the first in company order. */
  const centre = list.find((u) => u.role === "ceo" && !gone(u)) ?? list.find((u) => !gone(u)) ?? list[0]!;
  const rest = [...list.filter((u) => u.id !== centre.id && !gone(u)), ...list.filter((u) => u.id !== centre.id && gone(u))];
  const out: Orbit[] = [{ u: centre, left: 50, top: 50, ring: 0, r: 0, angleDeg: 0 }];
  /* Rings by headcount, radii as % of the square's side. One ring holds up
     to eight comfortably (arc >= 180px on a 640px field); more splits into
     two, then three, the senior half inward. */
  const n = rest.length;
  /* v1.99.2 — no captions on the orbit, so a face is a 72px disc and
     nothing more: the ring can be wider and the faces closer without a
     single collision. */
  const radii = n <= 9 ? [n <= 4 ? 28 : 38] : n <= 18 ? [24, 43] : [18, 32, 45];
  const per = Math.ceil(n / radii.length);
  radii.forEach((r, ringIdx) => {
    const members = rest.slice(ringIdx * per, (ringIdx + 1) * per);
    const m = members.length;
    members.forEach((u, i) => {
      /* Start at the top; an outer ring starts half a step round so no two
         rings share a spoke. */
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / m + (ringIdx % 2 ? Math.PI / m : 0);
      out.push({
        u, ring: ringIdx + 1, r,
        left: 50 + r * Math.cos(angle), top: 50 + r * Math.sin(angle),
        angleDeg: (angle * 180) / Math.PI,
      });
    });
  });
  return out;
}

function StaffBubble({ u, open, selectMode, selected, delayMs, onPress, size = "md", cake = null, faded = false, caption = true, onFocusPerson }: {
  u: Staff; open: boolean; selectMode: boolean; selected: boolean; delayMs: number; onPress: () => void;
  size?: "md" | "lg"; cake?: { days: number; turns: number } | null; faded?: boolean;
  /* v1.99.2 — the orbit draws faces WITHOUT captions (a fixed caption under a
     floating face is what collided); the grid keeps them. */
  caption?: boolean;
  onFocusPerson?: (u: Staff | null) => void;
}) {
  const lang = getLang();
  const L = (en: string, ms: string) => (lang === "ms" ? ms : en);
  const gone = ["resigned", "terminated"].includes(u.employment_status ?? "");
  const initials = displayName(u).split(" ").filter((w) => !/^(bin|binti|bt\.?|b\.|a\/l|a\/p)$/i.test(w)).map((w) => w[0] ?? "").slice(0, 2).join("").toUpperCase();
  const photo = u.photo_key ? `/api/v1/media/file/${encodeURIComponent(u.photo_key)}` : "";
  /* v1.99.1 — every face wears a white-offset ring so it lifts off the
     field; the open one is primary, a leaver's is a quiet dashed grey rather
     than red (they have left; they are not an alarm). */
  const ring = selectMode
    ? selected ? "ring-primary ring-4" : "ring-border ring-2"
    : open ? "ring-primary ring-4 scale-105" : gone ? "ring-border ring-2 grayscale" : "ring-card ring-2 shadow-md";
  return (
    <button type="button"
      className={`sd-bubble group relative flex shrink-0 flex-col items-center gap-1.5 text-center ${caption ? "w-full sm:w-[112px]" : ""} ${faded && !open ? "opacity-45 hover:opacity-100" : ""}`}
      onMouseEnter={() => onFocusPerson?.(u)}
      onMouseLeave={() => onFocusPerson?.(null)}
      onFocus={() => onFocusPerson?.(u)}
      onBlur={() => onFocusPerson?.(null)}
      style={{ animationDelay: `${delayMs}ms`, ["--sd-drift" as string]: `${4 + (delayMs % 7) * 0.4}s` }}
      aria-pressed={selectMode ? selected : open}
      title={selectMode
        ? (selected ? L("Ticked for badge printing — press to untick", "Ditanda untuk cetakan lencana — tekan untuk nyahtanda") : L("Press to tick for badge printing", "Tekan untuk tanda bagi cetakan lencana"))
        : `${displayName(u)}${u.position ? ` · ${u.position}` : ""} — ${L("press to open the record", "tekan untuk buka rekod")}`}
      onClick={onPress}>
      <span className="relative">
      {size === "lg" && !selectMode && (
        /* the centre's halo — one soft disc behind the most senior face */
        <span aria-hidden className="sd-halo bg-primary/15 absolute -inset-4 rounded-full blur-[3px]" />
      )}
      <span className={`relative inline-flex ${size === "lg" ? "h-24 w-24" : "h-[4.5rem] w-[4.5rem]"} items-center justify-center overflow-hidden rounded-full ring-offset-2 ring-offset-card transition-all duration-200 ease-out group-hover:scale-110 group-hover:shadow-[0_0_0_6px_color-mix(in_oklab,var(--primary)_12%,transparent)] group-active:scale-95 ${ring} ${photo ? "bg-secondary" : size === "lg" ? "bg-gold text-brand" : "bg-brand text-white"}`}>
        {photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={photo} alt="" className="h-full w-full object-cover" />
          : <span className={size === "lg" ? "text-2xl font-bold" : "text-lg font-bold"}>{initials}</span>}
      </span>
        {selectMode && selected && (
          <span className="bg-primary text-primary-foreground absolute -right-0.5 -bottom-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold" aria-hidden>✓</span>
        )}
        {!selectMode && cake && (
          <span className="bg-card absolute -top-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-sm shadow"
            title={cake.days === 0 ? L(`Birthday today — turns ${cake.turns}`, `Hari lahir hari ini — genap ${cake.turns}`) : L(`Birthday in ${cake.days} day(s) — turns ${cake.turns}`, `Hari lahir dalam ${cake.days} hari — genap ${cake.turns}`)}>
            🎂
          </span>
        )}
      </span>
      {/* v1.94.0 — a phone cell is wider than 88px and a Malay given name is
          three words, so the name wraps to two lines there rather than
          becoming "Mohd Alif Far…". The circle at sm+ keeps one line. */}
      {/* v1.94.1 — two lines on the circle too. "Mohd Alif Far…" on a
          desktop was the phone bug wearing a bigger screen. */}
      {caption ? (
        <>
          <span className={`line-clamp-2 w-full leading-tight font-semibold ${size === "lg" ? "text-sm" : "text-xs"}`}>{givenNames(displayName(u))}</span>
          {/* v1.99.1 — the role as a small pill, so the caption reads as a label
              and not as a second, greyer name. A leaver's says when they left. */}
          <span className={`inline-block max-w-full truncate rounded-full px-2 py-px text-[10px] leading-4 ${gone ? "bg-secondary text-muted-foreground" : size === "lg" ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground/80"}`}>
            {gone ? `${L(u.employment_status ?? "", STATUS_MS[u.employment_status ?? ""] ?? "")}${u.left_on ? ` · ${dmy(u.left_on)}` : ""}`
                  : L(u.role.replace(/_/g, " "), ROLE_MS[u.role] ?? u.role.replace(/_/g, " "))}
          </span>
        </>
      ) : (
        /* v1.99.2 — on the orbit the name is a chip that FLOATS above the
           face on hover or focus. It is positioned, so it cannot push a
           neighbour or wrap the layout; it is the reason the orbit can now
           breathe instead of reserving 110px of caption per person. */
        <span aria-hidden
          className="bg-foreground text-background pointer-events-none absolute -top-2 left-1/2 z-30 -translate-x-1/2 -translate-y-full scale-95 rounded-full px-2.5 py-1 text-[11px] leading-none font-medium whitespace-nowrap opacity-0 shadow-lg transition-all duration-150 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100">
          {givenNames(displayName(u))}
        </span>
      )}
    </button>
  );
}

export function StaffDirectory({ canAmend = false, readOnly = false, role = "" }: { canAmend?: boolean; readOnly?: boolean; role?: string }) {
  /* v1.101.0 - only the three the CEO named may set a reporting line. The
     list lives in org-chart.tsx and tests/org-chart.mjs holds it against
     PERMS.org_assign in the worker, so the button and the door agree. The
     server refuses regardless of what this says. */
  const canAssign = ORG_ASSIGN_ROLES.includes(role);
  const [view, setView] = useState<"circle" | "org">("circle");
  const [orgSaving, setOrgSaving] = useState<number | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [showCreate, setShowCreate] = useState(false); // v1.4.101: form hidden by default
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<Record<number, Partial<Staff>>>({});
  const [saved, setSaved] = useState<number | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // v1.4.74 minimalist view: records are COLLAPSED by default — one line each.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [sortBy, setSortBy] = useState<"rank" | "az" | "za">("rank");
  /* v1.92.0 — pressing a circle opens the record, or ticks it for printing. */
  const [selectMode, setSelectMode] = useState(false);
  /* v1.99.2 — who the orbit is naming right now (hover or keyboard focus).
     The orbit itself carries no captions, so this is where the name goes. */
  const [focus, setFocus] = useState<Staff | null>(null);
  const todayS = todayIso();
  const { show: showToast, node: toastNode } = useSaveToast();
  const { prompt, node: promptNode } = usePrompt();

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const emptyNewStaff = {
    email: "", name: "", role: "sales_marketing",
    employee_id: "", position: "", department: "",
    birthday: "", id_issued_on: "", blood_type: "", password: "",
    bank_name: "", bank_account: "", ic_number: "",
  };
  const [newStaff, setNewStaff] = useState(emptyNewStaff);
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [existing, setExisting] = useState<Staff | null>(null);

  const [loadError, setLoadError] = useState("");
  /* v1.77.0 — skeleton until the first fetch lands. `staff` starts [], so the
     directory drew an empty list (and "Select all" over nothing) until /users
     answered. Set right after the await so a failed load clears it too. */
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const res = await api<{ users?: Staff[]; staff?: Staff[] }>(`/users`);
    setLoaded(true);
    /* v1.4.218: a failed load previously rendered a silently EMPTY
       directory — which read as "all staff details was gone!". Say why. */
    if (!res.ok) {
      setLoadError(L(
        "Couldn't load the staff list from the server — the data is safe. Usually this means the worker and database are out of step: run the pending migrations + deploy, then refresh.",
        "Tidak dapat memuatkan senarai kakitangan daripada pelayan — data selamat. Biasanya ini bermakna worker dan pangkalan data tidak selari: jalankan migrasi tertunda + deploy, kemudian muat semula.",
      ));
      return;
    }
    setLoadError("");
    if (res.ok && res.data) {
      const list = res.data.users ?? res.data.staff ?? [];
      setAllStaff(list);
    /* v1.78.0 - the rank order that used to be written out here now lives in
       lib/staff-order.ts, because the Payroll tab needed the same one and two
       copies of an order drift. It also gained the two levels the CEO named
       on 31-08 that this version flattened: marketing and editor were one
       bucket with live_host, and a part-time contract sorted with the
       full-timers. */
    setStaff(
      list
        .filter((u) => isStaffRole(u.role))
        .sort(bySeniority),
    );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /* v1.101.0 - set (or clear) a reporting line. The row is written locally
     the moment the server says yes rather than re-fetching the whole
     directory: assigning fifteen people is fifteen presses, and a full reload
     between each one would scroll the chart back to the top every time.
     Every outcome speaks - a silent success on a chart is indistinguishable
     from a press that missed. */
  const assignReportsTo = async (personId: number, managerId: number | null) => {
    const person = allStaff.find((u) => u.id === personId);
    setOrgSaving(personId);
    const r = await api<{ ok?: boolean; manager_name?: string | null; error?: { message?: string } }>(
      `/users/${personId}/reports-to`,
      { method: "PUT", body: JSON.stringify({ reports_to: managerId }) },
    );
    setOrgSaving(null);
    if (!r.ok) {
      showToast(L("Not changed", "Tidak diubah"),
        r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
      return;
    }
    const patch = (list: Staff[]) => list.map((u) => (u.id === personId ? { ...u, reports_to: managerId } : u));
    setAllStaff(patch);
    setStaff(patch);
    const who = person ? displayName(person) : L("That person", "Orang itu");
    showToast(L("Reporting line set", "Garis pelaporan ditetapkan"),
      managerId === null
        ? `${who} — ${L("no longer on the chart", "tidak lagi pada carta")}`
        : `${who} → ${r.data?.manager_name ?? ""}`);
  };

  const save = async (id: number, name?: string) => {
    const d = draft[id];
    if (!d || Object.keys(d).length === 0) {
      showToast(L("No changes", "Tiada perubahan"), name ? `${name} — ${L("nothing to save", "tiada apa untuk disimpan")}` : L("Nothing to save", "Tiada apa untuk disimpan"), "notice");
      return;
    }
    setRowMsg((m) => ({ ...m, [id]: "" }));
    // Dates were typed DD-MM-YYYY; store ISO.
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(d)) {
      payload[k] = (DATE_KEYS as readonly string[]).includes(k) ? dmyToISO(String(v)) : String(v);
    }
    const res = await api<ErrShape>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
    if (res.ok) {
      setSaved(id);
      setDraft((s) => ({ ...s, [id]: {} }));
      window.setTimeout(() => setSaved(null), 3000);
      showToast(L("Saved", "Disimpan"), name ?? L("Staff record updated", "Rekod kakitangan dikemas kini"));
      void load();
    } else {
      setRowMsg((m) => ({ ...m, [id]: res.data?.error?.message ?? L("Save failed — check access", "Simpan gagal — semak akses") }));
    }
  };

  const set = (id: number, key: keyof Staff, value: string) =>
    setDraft((s) => ({ ...s, [id]: { ...s[id], [key]: value } }));
  const val = (u: Staff, key: keyof Staff) => {
    const raw = (draft[u.id]?.[key] as string) ?? (u[key] as string) ?? "";
    return (DATE_KEYS as readonly string[]).includes(key as string) ? isoToDMY(raw) : raw;
  };
  /** A field locks for HR once its SAVED value is non-empty; admin can always edit. */
  const isLocked = (u: Staff, key: keyof Staff) =>
    readOnly || (!canAmend && Boolean(((u[key] as string) ?? "").trim()));

  return (
    <div className="space-y-3">
      {toastNode}{promptNode}
      <div className="rounded-lg border border-border bg-secondary/40 px-4 py-2.5">
        <p className="text-sm font-medium">{L("Staff directory & ID badges", "Direktori kakitangan & lencana ID")}</p>
        <p className="text-muted-foreground text-xs">
          {L(
            "Fill each record (dates as DD-MM-YYYY), preview the badge live, then print the portrait card (54 × 85.6 mm). Saved fields lock — amendments are made by an admin in /admin → Staff.",
            "Isi setiap rekod (tarikh sebagai DD-MM-YYYY), pratonton lencana secara langsung, kemudian cetak kad potret (54 × 85.6 mm). Medan yang disimpan akan dikunci — pindaan dibuat oleh admin di /admin → Staff.",
          )}
        </p>
      </div>

      {!readOnly && !showCreate && (
        <div className={card}>
          <button type="button" className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium"
            onClick={() => setShowCreate(true)}>
            {L("+ New staff record — show details", "+ Rekod kakitangan baharu — tunjukkan butiran")}
          </button>
          <p className="text-muted-foreground mt-1 text-xs">{L("The creation form stays hidden until needed — minimalist by request.", "Borang penciptaan kekal tersembunyi sehingga diperlukan — minimalis atas permintaan.")}</p>
        </div>
      )}
      {!readOnly && showCreate && (
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{L("Add a staff member", "Tambah kakitangan")}</p>
          <button type="button"
            className="border-border hover:bg-secondary inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium"
            onClick={() => setShowCreate(false)}>
            {L("Hide form", "Sembunyikan borang")} <span aria-hidden="true">▲</span>
          </button>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {L(
            "Company emails (@azoneofficial.com) aren't Google accounts, so staff can't self-register — create the account here with a temporary password and hand it over. They change it on first sign-in.",
            "E-mel syarikat (@azoneofficial.com) bukan akaun Google, jadi kakitangan tidak boleh mendaftar sendiri — cipta akaun di sini dengan kata laluan sementara dan serahkan kepada mereka. Mereka menukarnya pada log masuk pertama.",
          )}
        </p>
        {/* v1.4.135: every placeholder field carries a SUBHEAD label above it,
            so the field's purpose stays visible after typing. */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Sub t={L("Company email", "E-mel syarikat")}>
            <input className={input} placeholder="name@azoneofficial.com" value={newStaff.email}
              onChange={(e) => { setExisting(null); setNewStaff((d) => ({ ...d, email: e.target.value })); }} />
          </Sub>
          <Sub t={L("Full name (as per NRIC)", "Nama penuh (seperti dalam NRIC)")}>
            <input className={input} placeholder={L("Full name", "Nama penuh")} value={newStaff.name}
              onChange={(e) => setNewStaff((d) => ({ ...d, name: e.target.value }))} />
          </Sub>
          <Sub t={L("Role", "Peranan")}>
            <select className={input} value={newStaff.role}
              onChange={(e) => setNewStaff((d) => ({ ...d, role: e.target.value }))}>
              {["editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco"].map((r) => (
                <option key={r} value={r}>{L(r.replace(/_/g, " "), ROLE_MS[r] ?? r.replace(/_/g, " "))}</option>
              ))}
            </select>
          </Sub>
          <Sub t={L("Employee ID (optional)", "ID pekerja (pilihan)")}>
            <input className={input} placeholder={L("e.g. AZOOM001", "cth. AZOOM001")} value={newStaff.employee_id}
              onChange={(e) => setNewStaff((d) => ({ ...d, employee_id: e.target.value }))} />
          </Sub>
          <Sub t={L("Position (optional)", "Jawatan (pilihan)")}>
            <input className={input} placeholder={L("e.g. Marketing Executive", "cth. Eksekutif Pemasaran")} value={newStaff.position}
              onChange={(e) => setNewStaff((d) => ({ ...d, position: e.target.value }))} />
          </Sub>
          <Sub t={L("Department (optional)", "Jabatan (pilihan)")}>
            <input className={input} placeholder={L("e.g. Management", "cth. Pengurusan")} value={newStaff.department}
              onChange={(e) => setNewStaff((d) => ({ ...d, department: e.target.value }))} />
          </Sub>
          <Sub t={L("Birth date (optional)", "Tarikh lahir (pilihan)")}>
            <input className={input} placeholder="DD-MM-YYYY" value={newStaff.birthday}
              onChange={(e) => setNewStaff((d) => ({ ...d, birthday: e.target.value }))} />
          </Sub>
          <Sub t={L("ID issued on (optional)", "ID dikeluarkan pada (pilihan)")}>
            <input className={input} placeholder="DD-MM-YYYY" value={newStaff.id_issued_on}
              onChange={(e) => setNewStaff((d) => ({ ...d, id_issued_on: e.target.value }))} />
          </Sub>
          <Sub t={L("Blood type (optional)", "Jenis darah (pilihan)")}>
            <input className={input} placeholder={L("e.g. O+", "cth. O+")} value={newStaff.blood_type}
              onChange={(e) => setNewStaff((d) => ({ ...d, blood_type: e.target.value }))} />
          </Sub>
          <Sub t={L("NRIC (optional)", "NRIC (pilihan)")}>
            <input className={input} placeholder="XXXXXX-XX-XXXX" value={newStaff.ic_number}
              onChange={(e) => setNewStaff((d) => ({ ...d, ic_number: e.target.value }))} />
          </Sub>
          <Sub t={L("Bank (optional)", "Bank (pilihan)")}>
            <select className={input} value={newStaff.bank_name}
              onChange={(e) => setNewStaff((d) => ({ ...d, bank_name: e.target.value }))}>
              <option value="">{L("— Maybank is company primary —", "— Maybank ialah bank utama syarikat —")}</option>
              {MY_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Sub>
          <Sub t={L("Bank account no. (optional)", "No. akaun bank (pilihan)")}>
            <input className={input} placeholder={L("numbers only", "nombor sahaja")} value={newStaff.bank_account}
              onChange={(e) => setNewStaff((d) => ({ ...d, bank_account: e.target.value }))} />
          </Sub>
          <Sub t={L("Temp password (10+ chars)", "Kata laluan sementara (10+ aksara)")}>
            <PasswordInput className={input} placeholder={L("They change it on first sign-in", "Mereka menukarnya pada log masuk pertama")} value={newStaff.password}
              onChange={(e) => setNewStaff((d) => ({ ...d, password: e.target.value }))} />
          </Sub>
          <Sub t={L("Staff photo (optional)", "Foto kakitangan (pilihan)")}>
            <label className={`${input} flex cursor-pointer items-center justify-between`}>
              <span className={newPhoto ? "" : "text-muted-foreground"}>
                {newPhoto ? newPhoto.name : L("Choose an image", "Pilih imej")}
              </span>
              <span className="text-muted-foreground text-xs underline">{L("Browse", "Semak imbas")}</span>
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => setNewPhoto(e.target.files?.[0] ?? null)} />
            </label>
          </Sub>
        </div>
        {createMsg && <p className={`mt-2 text-xs font-medium ${createMsg.ok ? "text-green-700" : "text-destructive"}`}>{createMsg.text}</p>}
        {existing && (
          <button
            type="button"
            className="border-border mt-2 inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-secondary"
            onClick={async () => {
              const patch: Record<string, string> = {};
              if (newStaff.employee_id.trim()) patch.employee_id = newStaff.employee_id.trim();
              if (newStaff.position.trim()) patch.position = newStaff.position.trim();
              if (newStaff.department.trim()) patch.department = newStaff.department.trim();
              if (Object.keys(patch).length === 0) {
                setCreateMsg({ ok: false, text: L("Fill in employee ID, position or department to update the record.", "Isi ID pekerja, jawatan atau jabatan untuk mengemas kini rekod.") });
                return;
              }
              const res = await api<ErrShape>(`/users/${existing.id}`, { method: "PATCH", body: JSON.stringify(patch) });
              if (res.ok) {
                setCreateMsg({ ok: true, text: L(`${existing.name}'s record updated.`, `Rekod ${existing.name} dikemas kini.`) });
                setExisting(null);
                setNewStaff(emptyNewStaff);
                void load();
              } else {
                setCreateMsg({ ok: false, text: res.data?.error?.message ?? L("Update failed — check access.", "Kemas kini gagal — semak akses.") });
              }
            }}
          >
            {L(`Update ${existing.name}'s record instead`, `Kemas kini rekod ${existing.name} sebaliknya`)}
          </button>
        )}
        <div>
          <button type="button" className={`${btn} bg-primary text-primary-foreground hover:bg-primary/85 mt-3 disabled:opacity-50`}
            disabled={!newStaff.email.trim() || !newStaff.name.trim() || newStaff.password.length < 10}
            onClick={async () => {
              setCreateMsg(null);
              const res = await api<ErrShape & { id?: number }>(`/users`, {
                method: "POST",
                body: JSON.stringify({
                  ...newStaff,
                  birthday: newStaff.birthday ? dmyToISO(newStaff.birthday) : "",
                  id_issued_on: newStaff.id_issued_on ? dmyToISO(newStaff.id_issued_on) : "",
                }),
              });
              if (res.ok) {
                // Photo chosen up front? Attach it to the account just created.
                let photoNote = "";
                if (newPhoto && res.data?.id) {
                  const compressed = await compressImage(newPhoto);
                  const up = await csrfFetch(`${API}/users/${res.data.id}/photo`, {
                    method: "POST",
                    headers: { "Content-Type": compressed.type || "image/jpeg" },
                    body: compressed,
                  });
                  photoNote = up.ok ? ` ${L("Photo uploaded.", "Foto dimuat naik.")}` : ` ${L("(Photo upload failed — use Upload photo on the row.)", "(Muat naik foto gagal — guna Muat naik foto pada baris.)")}`;
                }
                setCreateMsg({ ok: true, text: `${newStaff.name} ${L("added.", "ditambah.")}${photoNote}` });
                setNewStaff(emptyNewStaff);
                setNewPhoto(null);
                setExisting(null);
                void load();
              } else if (res.status === 409) {
                const match = allStaff.find(
                  (u) => u.email.toLowerCase() === newStaff.email.toLowerCase().trim(),
                );
                if (match && match.role !== "customer") {
                  setExisting(match);
                  setCreateMsg({ ok: false, text: `${match.name} ${L("already has an account", "sudah mempunyai akaun")} (${match.role.replace(/_/g, " ")}).` });
                } else if (match) {
                  setExisting(null);
                  setCreateMsg({ ok: false, text: L("This email belongs to a customer account — an admin can adjust it in /admin → Users.", "E-mel ini milik akaun pelanggan — admin boleh melaraskannya di /admin → Users.") });
                } else {
                  setExisting(null);
                  setCreateMsg({ ok: false, text: L("A user with this email already exists.", "Pengguna dengan e-mel ini sudah wujud.") });
                }
              } else {
                setExisting(null);
                setCreateMsg({ ok: false, text: res.data?.error?.message ?? L("Could not add — check the fields.", "Tidak dapat menambah — semak medan.") });
              }
            }}>
            {L("Create staff account", "Cipta akaun kakitangan")}
          </button>
        </div>
      </div>
      )}

      {/* v1.94.0 — the inner scroller is a desktop convenience and a phone
          bug: a scroll area inside the page scroll cut the last row of faces
          in half and trapped the flick.
          v1.99.4 — CEO: "should it scrollable for this staff UI/UX? I dont
          think so." It is gone on every width. A 30rem box around a 34rem
          circle cut the bottom third off and put a scrollbar inside a card
          that is already inside the page's scroll — two scrollbars for one
          picture. The orbit is now sized against the VIEWPORT instead, so it
          is whole on the screen it is drawn on, and the page scrolls once. */}
      <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* v1.101.0 — Circle or Organisation. One segmented control rather
            than a second tab: it is the same people, the same fetch and the
            same permissions, and a box on the chart opens the same record
            card the circle does. */}
        <span className="border-border inline-flex h-8 items-center rounded-lg border p-0.5" role="group"
          aria-label={L("How to show the staff", "Cara memaparkan kakitangan")}>
          {([["circle", L("Circle", "Bulatan")], ["org", L("Organisation", "Organisasi")]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v}
              className={`inline-flex h-7 items-center rounded-[7px] px-2.5 text-xs font-medium transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
              onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </span>
        {/* v1.94.0 — a disabled full-width button reading "Print selected
            badges (0)" was the first thing on the phone, every time. It
            appears when there is something to print. */}
        {selected.size > 0 && (
        <button
          type="button"
          className="bg-primary text-primary-foreground inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium"
          onClick={() => printBadges(staff.filter((u) => selected.has(u.id)).map((u) => ({ ...u, ...draft[u.id] } as Staff)))}
        >
          {L("Print badges", "Cetak lencana")} ({selected.size}) <span className="hidden sm:inline">&nbsp;— {L("up to 9 per A4", "sehingga 9 setiap A4")}</span>
        </button>
        )}
        <button
          type="button"
          className={`inline-flex h-8 items-center rounded-lg border px-3 text-xs ${selectMode ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"}`}
          aria-pressed={selectMode}
          onClick={() => { setSelectMode((m) => !m); if (selectMode) setSelected(new Set()); }}
        >
          {selectMode ? L("Done selecting", "Selesai memilih") : L("Select for printing", "Pilih untuk cetakan")}
        </button>
        {selectMode && (
          <button
            type="button"
            className="border-border inline-flex h-8 items-center rounded-lg border px-3 text-xs hover:bg-secondary"
            onClick={() => setSelected(selected.size === staff.length ? new Set() : new Set(staff.map((u) => u.id)))}
          >
            {selected.size === staff.length && staff.length > 0 ? L("Clear selection", "Kosongkan pilihan") : L("Select all", "Pilih semua")}
          </button>
        )}
        <span className="text-muted-foreground hidden text-xs sm:inline">
          {selectMode
            ? L("Press a face to tick it.", "Tekan wajah untuk menandanya.")
            : L("Press a face to open the record.", "Tekan wajah untuk buka rekod.")}
        </span>
        <select
          className="border-input bg-background h-8 rounded-lg border px-2 text-xs sm:ml-auto"
          value={sortBy}
          title={L("Sort staff records", "Susun rekod kakitangan")}
          onChange={(e) => setSortBy(e.target.value as "rank" | "az" | "za")}
        >
          <option value="rank">{L("Sort: Rank (default)", "Susun: Pangkat (lalai)")}</option>
          <option value="az">{L("Sort: Name A–Z", "Susun: Nama A–Z")}</option>
          <option value="za">{L("Sort: Name Z–A", "Susun: Nama Z–A")}</option>
        </select>
      </div>

      {loadError && (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900">⚠ {loadError}</p>
      )}
      {/* v1.77.0 — skeleton until the first fetch lands: five collapsed
          record cards (checkbox · name · role, chevron on the right), the
          exact row each staff member renders as below. */}
      <style>{`@keyframes sd-pop { from { opacity: 0; transform: translateY(6px) scale(.9) } to { opacity: 1; transform: none } }
        @keyframes sd-drift { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        @keyframes sd-spin { to { transform: rotate(360deg) } }
        .sd-bubble { animation: sd-pop .35s cubic-bezier(.2,.8,.3,1.2) both }
        .sd-orbit .sd-bubble { animation: sd-pop .35s cubic-bezier(.2,.8,.3,1.2) both, sd-drift var(--sd-drift, 5s) ease-in-out .4s infinite }
        .sd-orbit .sd-ring-dash { animation: sd-spin 240s linear infinite }
        @keyframes sd-sweepspin { to { transform: translate(-50%, -50%) rotate(360deg) } }
        .sd-sweep { animation: sd-sweepspin 26s linear infinite }
        @keyframes sd-pulse { 0%, 100% { opacity: .35; transform: scale(1) } 50% { opacity: .6; transform: scale(1.06) } }
        .sd-halo { animation: sd-pulse 4.5s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .sd-bubble, .sd-orbit .sd-bubble, .sd-orbit .sd-ring-dash, .sd-sweep, .sd-halo { animation: none } }`}</style>
      {view === "org" && (
        <OrgChart
          people={staff}
          loaded={loaded}
          canAssign={canAssign && !readOnly}
          saving={orgSaving}
          onAssign={(personId, managerId) => { void assignReportsTo(personId, managerId); }}
          onOpen={(u) => setOpen((o) => (o.has(u.id) ? new Set() : new Set([u.id])))}
        />
      )}
      {view === "circle" && (() => {
        const ordered = sortBy === "rank"
          ? staff
          : [...staff].sort((a, b) => sortBy === "az" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
        const cakeFor = (u: Staff) => {
          const b = birthdayInfo(u.birthday, todayS);
          return b && b.days <= 14 && !["resigned", "terminated"].includes(u.employment_status ?? "") ? b : null;
        };
        const press = (u: Staff) => {
          if (selectMode) { toggleSelect(u.id); return; }
          /* one record open at a time; pressing the open one closes it */
          setOpen((o) => (o.has(u.id) ? new Set() : new Set([u.id])));
        };
        const gone = (u: Staff) => ["resigned", "terminated"].includes(u.employment_status ?? "");
        /* v1.93.0 — whose day is next, in one line under the field. */
        const upcoming = staff.filter((u) => !gone(u)).map((u) => ({ u, b: birthdayInfo(u.birthday, todayS) }))
          .filter((x): x is { u: Staff; b: NonNullable<ReturnType<typeof birthdayInfo>> } => Boolean(x.b))
          .sort((a, b) => a.b.days - b.b.days).slice(0, 3);
        return (
          <>
            {/* the circle — desktop and tablet */}
            {/* v1.94.1 — a CENTRED SQUARE field. Percentages of a 1600x460
                strip are an ellipse; percentages of a square are a circle.
                Capped so it stays one glance on a wide monitor instead of
                a horizon. */}
            {/* The wrapper's padding is where the outermost ring's LABELS
                live: a face centred at 47% of the square still puts half a
                104px cell outside it. */}
            {/* v1.99.2 — CEO: "still not nice for UI/UX!". The diagnosis was
                the caption: a name and a role pinned under every floating
                face means each person needs a 112 x 110px box on a circle,
                and on a nine-person ring those boxes touch — Nurfarah wrapped
                to two lines, Izzudin's role sat under Nasuha's chin. Nothing
                about radius or colour fixes that.

                So the orbit carries FACES ONLY. The name floats over the face
                on hover, and one caption bar under the field — fixed height,
                so nothing ever moves — names whoever is hovered or open. The
                circle finally has air in it, and every label is legible
                because only one is on screen at a time. */}
            {/* v1.99.4 — the field as a panel: a hairline glass card, a slow
                conic sweep behind the orbit and a soft floor glow. All of it
                is theme tokens, so it reads the same in light and dark, and
                all of it is behind the faces (pointer-events-none) so nothing
                here can swallow a press. */}
            <div className="border-border/60 bg-card/50 relative hidden overflow-hidden rounded-3xl border px-6 pt-6 pb-5 backdrop-blur-sm sm:block">
            <span aria-hidden className="sd-sweep pointer-events-none absolute top-1/2 left-1/2 aspect-square w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.55]"
              style={{ background: "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, var(--primary) 14%, transparent) 40deg, transparent 110deg, transparent 360deg)" }} />
            <div className="sd-orbit relative mx-auto aspect-square w-full"
              style={{
                /* whole on the screen it is drawn on: never wider than the
                   card, never taller than what is left of the viewport. */
                maxWidth: "min(34rem, calc(100svh - 25rem))",
                minWidth: "20rem",
                background: "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--primary) 9%, transparent) 0%, color-mix(in oklab, var(--primary) 3%, transparent) 45%, transparent 72%)",
              }}>
              {(() => {
                const placed = loaded ? circleLayout(ordered) : [];
                const radii = loaded ? [...new Set(placed.filter((p) => p.ring > 0).map((p) => p.r))] : [38];
                return (
                  <>
                    {radii.map((r) => (
                      <span key={r} aria-hidden className="sd-ring-dash border-primary/20 pointer-events-none absolute rounded-full border border-dashed"
                        style={{ left: `${50 - r}%`, top: `${50 - r}%`, width: `${r * 2}%`, height: `${r * 2}%` }} />
                    ))}
                    {placed.filter((p) => p.ring > 0).map((p) => (
                      <span key={`spoke-${p.u.id}`} aria-hidden
                        className={`pointer-events-none absolute top-1/2 left-1/2 h-px origin-left transition-colors ${focus?.id === p.u.id || open.has(p.u.id) ? "bg-primary/50" : "bg-primary/12"}`}
                        style={{ width: `${p.r}%`, transform: `rotate(${p.angleDeg}deg)` }} />
                    ))}
                  </>
                );
              })()}
              {!loaded && Array.from({ length: 8 }, (_, i) => {
                const a = -Math.PI / 2 + (2 * Math.PI * i) / 8;
                return (
                  <div key={`skel-${i}`} className="absolute -translate-x-1/2 -translate-y-1/2" aria-hidden
                    style={{ left: `${50 + 38 * Math.cos(a)}%`, top: `${50 + 38 * Math.sin(a)}%` }}>
                    <Skel className="h-[4.5rem] w-[4.5rem] rounded-full" />
                  </div>
                );
              })}
              {!loaded && <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden><Skel className="h-24 w-24 rounded-full" /></div>}
              {loaded && circleLayout(ordered).map(({ u, left, top, ring }, i) => (
                <div key={u.id} className={`absolute -translate-x-1/2 -translate-y-1/2 ${open.has(u.id) || focus?.id === u.id ? "z-20" : ring === 0 ? "z-10" : "z-[1]"}`}
                  style={{ left: `${left}%`, top: `${top}%` }}>
                  <StaffBubble u={u} open={open.has(u.id)} selectMode={selectMode} selected={selected.has(u.id)} delayMs={i * 45}
                    size={ring === 0 ? "lg" : "md"} cake={cakeFor(u)} faded={gone(u)} caption={false}
                    onFocusPerson={setFocus} onPress={() => press(u)} />
                </div>
              ))}
              {loaded && staff.length === 0 && !loadError && (
                <p className="text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs">{L("No staff records yet.", "Belum ada rekod kakitangan.")}</p>
              )}
            </div>
            {/* the caption bar — one line, fixed height, never moves */}
            {loaded && staff.length > 0 && (() => {
              const who = focus ?? ordered.find((u) => open.has(u.id)) ?? null;
              return (
                <div className="mt-3 flex min-h-[3.25rem] flex-col items-center justify-center gap-1 text-center">
                  {who ? (
                    <>
                      <p className="text-sm font-semibold">{displayName(who)}</p>
                      <p className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
                        <span className="bg-secondary text-foreground/80 rounded-full px-2 py-0.5">
                          {who.position || L(who.role.replace(/_/g, " "), ROLE_MS[who.role] ?? who.role.replace(/_/g, " "))}
                        </span>
                        {gone(who) && (
                          <span className="bg-secondary text-muted-foreground rounded-full px-2 py-0.5">
                            {L(who.employment_status ?? "", STATUS_MS[who.employment_status ?? ""] ?? "")}{who.left_on ? ` · ${dmy(who.left_on)}` : ""}
                          </span>
                        )}
                        {cakeFor(who) && (
                          <span className="bg-warning-soft text-warning rounded-full px-2 py-0.5">
                            🎂 {cakeFor(who)!.days === 0 ? L("today", "hari ini") : `${cakeFor(who)!.days} ${L("day(s)", "hari")}`}
                          </span>
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {L("Hover a face to see who it is · press to open the record. Clockwise from the top in company order, CEO at the centre.",
                         "Tuding pada wajah untuk melihat namanya · tekan untuk buka rekod. Ikut jam dari atas mengikut susunan syarikat, CEO di tengah.")}
                    </p>
                  )}
                </div>
              );
            })()}
            </div>
            {/* the row — phones, where an orbit is a pile */}
            {/* v1.94.0 — CEO, a phone screenshot: names cut to "Mohd Alif
                Far…", the last row's roles sliced in half by the card's inner
                scroller. A three-column GRID (not a wrap row) gives each face
                a third of the screen instead of a fixed 88px, and the inner
                scroller is desktop-only now, so the page scrolls the way a
                phone expects and nothing is cut. */}
            <div className="grid grid-cols-3 gap-x-2 gap-y-4 py-2 sm:hidden">
              {!loaded && Array.from({ length: 6 }, (_, i) => (
                <div key={`skel-${i}`} className="flex w-full flex-col items-center gap-1.5" aria-hidden>
                  <Skel className="h-[4.5rem] w-[4.5rem] rounded-full" />
                  <Skel className="h-3 w-14" />
                  <Skel className="h-2.5 w-10" />
                </div>
              ))}
              {loaded && ordered.map((u, i) => (
                <StaffBubble key={u.id} u={u} open={open.has(u.id)} selectMode={selectMode} selected={selected.has(u.id)} delayMs={i * 35}
                  cake={cakeFor(u)} faded={gone(u)} onPress={() => press(u)} />
              ))}
            </div>
            {loaded && upcoming.length > 0 && (
              /* v1.99.1 — one chip per birthday, pressable, instead of a
                 dotted-underline sentence. */
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">🎂 {L("Next birthdays", "Hari lahir seterusnya")}</span>
                {upcoming.map((x) => (
                  <button key={x.u.id} type="button" onClick={() => press(x.u)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${x.b.days <= 7 ? "bg-warning-soft text-warning" : "bg-secondary text-foreground/80 hover:bg-secondary/70"}`}
                    title={L(`Turns ${x.b.turns}`, `Genap ${x.b.turns}`)}>
                    {givenNames(displayName(x.u))} · {x.b.next} · {x.b.days === 0 ? L("today", "hari ini") : `${x.b.days} ${L("day(s)", "hari")}`}
                  </button>
                ))}
              </div>
            )}
          </>
        );
      })()}
      {(sortBy === "rank"
        ? staff
        : [...staff].sort((a, b) => sortBy === "az" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name))
      ).map((u) => {
        const merged = { ...u, ...draft[u.id] } as Staff;
        /* v1.92.0 — a closed record is its circle above; only an open one
           draws the card. */
        if (!open.has(u.id)) return null;
        return (
          <div key={u.id} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                {selectMode && (
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#1a2946]"
                  checked={selected.has(u.id)}
                  onChange={() => toggleSelect(u.id)}
                  title={L("Select for multi-badge printing", "Pilih untuk cetakan berbilang lencana")}
                />
                )}
                {/* v1.4.256: the staff member's name opens the record — the
                    same affordance as every other list. That also frees a slot
                    in this row, which v1.4.209 had to teach to wrap because it
                    held five buttons with a record open. */}
                <RecordToggle open={open.has(u.id)} title={L("Full staff record", "Rekod kakitangan penuh")}
                  onToggle={() => setOpen((o) => {
                    const next = new Set(o);
                    if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                    return next;
                  })}>
                  {/* v1.4.260: the register shows the LEGAL name when it is on
                      file. Everything official already prefers full_name —
                      payslip, claim form, leave form, ID badge, sales-document
                      signature, and the Maybank2E batch — so a list showing
                      only the short name hid whose record was incomplete. */}
                  {displayName(u)}
                </RecordToggle>
                {!u.full_name?.trim() && (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                    title={L(
                      "No full name on file — the payslip, claim form, leave form, ID badge and the Maybank2E salary file all fall back to the short name, and a bank can reject a transfer whose name does not match the account",
                      "Tiada nama penuh dalam rekod — slip gaji, borang tuntutan, borang cuti, lencana ID dan fail gaji Maybank2E semuanya kembali kepada nama pendek, dan bank boleh menolak pindahan yang namanya tidak sepadan dengan akaun",
                    )}>
                    ⚠ {L("no full name", "tiada nama penuh")}
                  </span>
                )}
                {["resigned", "terminated"].includes(u.employment_status ?? "") && (
                  <span className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 capitalize">
                    {L(u.employment_status ?? "", STATUS_MS[u.employment_status ?? ""] ?? (u.employment_status ?? ""))}{u.left_on ? ` · ${dmy(u.left_on)}` : ""}
                  </span>
                )}
                {u.rejoined_on && !["resigned", "terminated"].includes(u.employment_status ?? "") && (
                  <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    {L("re-joined", "kembali bekerja")} {dmy(u.rejoined_on)}
                  </span>
                )}
                {" "}<span className="text-muted-foreground">· {L(u.role.replace(/_/g, " "), ROLE_MS[u.role] ?? u.role.replace(/_/g, " "))}</span>
                {/* v1.93.0 — the birthday on the card, not in a card of its own. */}
                {(() => {
                  const b = birthdayInfo(u.birthday, todayS);
                  if (!b) return null;
                  return (
                    <span className={`ml-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${b.days <= 14 ? "bg-gold-soft text-gold-deep" : "bg-secondary text-muted-foreground"}`}
                      title={L("Birth date on the record below", "Tarikh lahir pada rekod di bawah")}>
                      🎂 {b.next} · {b.days === 0 ? L(`turns ${b.turns} today`, `genap ${b.turns} hari ini`) : `${L("turns", "genap")} ${b.turns} ${L("in", "dalam")} ${b.days} ${L("day(s)", "hari")}`}
                    </span>
                  );
                })()}
                {!open.has(u.id) && (u.employee_id || u.position) && (
                  <span className="text-muted-foreground hidden text-xs sm:inline">
                    · {[u.employee_id, u.position].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {/* v1.4.209 (CEO's iPhone screenshot: "mobile view apps out"):
                  with a record OPEN this span holds FIVE buttons — Save,
                  Preview badge, Print badge, Replace/Upload photo, Hide
                  details — and without flex-wrap the row ran past the
                  right edge of the phone screen (Hide details clipped).
                  flex-wrap + justify-end = v1.4.154 phone standard. */}
              <span className="flex flex-wrap items-center justify-end gap-2">
                {saved === u.id && <span className="text-xs font-medium text-green-700">{L("Saved ✓", "Disimpan ✓")}</span>}
                {rowMsg[u.id] && <span className="text-destructive text-xs font-medium">{rowMsg[u.id]}</span>}
                {open.has(u.id) && !readOnly && (
                  <button
                    type="button"
                    className={`${btn} bg-primary text-primary-foreground hover:bg-primary/85`}
                    onClick={() => void save(u.id, u.name)}
                  >
                    {L("Save", "Simpan")}
                  </button>
                )}
                {open.has(u.id) && (
                <button
                  type="button"
                  className={`${btn} border-border border hover:bg-secondary`}
                  onClick={() => setPreview((p) => (p === u.id ? null : u.id))}
                >
                  {preview === u.id ? L("Hide badge", "Sembunyikan lencana") : L("Preview badge", "Pratonton lencana")}
                </button>
                )}
                {open.has(u.id) && (
                <button
                  type="button"
                  className={`${btn} border-border border hover:bg-secondary`}
                  onClick={() => printBadge(merged)}
                >
                  {L("Print badge", "Cetak lencana")}
                </button>
                )}
                {/* v1.4.282 (auditor pick 3): the WHOLE exit in one tap —
                    status + final date + sessions revoked + 2FA cleared, one
                    audited call, so no step can be forgotten.

                    v1.77.0 (CEO: "offboard should I can insert the date of
                    their resignation ... instead of capture to today date"):
                    THE DIALOG ASKS FOR THE LAST DAY. It defaulted to today,
                    which is only right if you offboard somebody the moment
                    they walk out — and notice is usually served in advance,
                    so the common case was the wrong one. The date is not
                    cosmetic: `left_on` is what payroll prorates a final month
                    on, so a day out is money out. Today is still the pre-filled
                    suggestion; it just has to be looked at now. */}
                {open.has(u.id) && canAmend && !["resigned", "terminated"].includes(u.employment_status ?? "") && (
                  <button type="button" className={rowBtnDanger}
                    onClick={() => {
                      void prompt({
                        title: L(`Offboard ${displayName(u)}?`, `Tamatkan khidmat ${displayName(u)}?`),
                        message: L(
                          "This does the whole exit in one audited step: marks them resigned from the date below, signs them out everywhere, and removes their two-factor setup. The date is their LAST DAY of employment — payroll prorates their final month on it. You can change it, or switch to terminated, in the fields afterwards.",
                          "Ini melakukan keseluruhan proses keluar dalam satu langkah yang diaudit: menandakan letak jawatan dari tarikh di bawah, melog keluar mereka di semua peranti, dan membuang persediaan dua faktor. Tarikh itu ialah HARI TERAKHIR pekerjaan mereka — gaji bulan akhir dikira mengikutnya. Anda boleh menukarnya, atau menukar kepada ditamatkan, dalam medan selepas itu.",
                        ),
                        text: false,
                        date: {
                          label: L("Last day of employment", "Hari terakhir bekerja"),
                          initial: todayIso(),
                          required: true,
                        },
                        confirmLabel: L("Offboard", "Tamatkan khidmat"), variant: "danger",
                      }).then(async (r) => {
                        if (!r?.date) return;
                        const res = await apiRoot<ErrShape & { left_on?: string }>(`/users/${u.id}/offboard`, { method: "POST", body: JSON.stringify({ left_on: r.date }) });
                        if (res.ok) {
                          showToast(L("Offboarded", "Khidmat ditamatkan"),
                            `${displayName(u)} — ${L(`last day ${dmy(res.data?.left_on ?? r.date)}, signed out everywhere, 2FA cleared`, `hari terakhir ${dmy(res.data?.left_on ?? r.date)}, dilog keluar di semua peranti, 2FA dibuang`)}`);
                          void load();
                        } else {
                          setRowMsg((m) => ({ ...m, [u.id]: res.data?.error?.message ?? L("Offboard failed", "Tamat khidmat gagal") }));
                        }
                      });
                    }}>
                    🚪 {L("Offboard", "Tamatkan khidmat")}
                  </button>
                )}
                {open.has(u.id) && !readOnly && (
                <label className={`${btn} border-border cursor-pointer border hover:bg-secondary`}>
                  {u.photo_key ? (canAmend ? L("Replace photo", "Ganti foto") : L("Photo set 🔒", "Foto ditetapkan 🔒")) : L("Upload photo", "Muat naik foto")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={Boolean(u.photo_key) && !canAmend}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setRowMsg((m) => ({ ...m, [u.id]: "" }));
                      const compressed = await compressImage(file);
                      const res = await csrfFetch(`${API}/users/${u.id}/photo`, {
                        method: "POST",
                        headers: { "Content-Type": compressed.type || "image/jpeg" },
                        body: compressed,
                      });
                      if (res.ok) {
                        setSaved(u.id);
                        window.setTimeout(() => setSaved(null), 3000);
                        // v1.4.184 (CEO: "no popup successful when upload staff
                        // Photo"): same save-popup family as every other save.
                        showToast(L("Photo uploaded", "Foto dimuat naik"), `${displayName(u)} — ${L("badge photo saved", "foto lencana disimpan")}`);
                        void load();
                      } else {
                        const j = (await res.json().catch(() => null)) as ErrShape | null;
                        setRowMsg((m) => ({ ...m, [u.id]: j?.error?.message ?? L("Photo upload failed", "Muat naik foto gagal") }));
                        showToast(L("Photo upload failed", "Muat naik foto gagal"), j?.error?.message ?? `${displayName(u)} — ${L("try again", "cuba lagi")}`, "notice");
                      }
                    }}
                  />
                </label>
                )}
              </span>
            </div>
            {open.has(u.id) && RECORD_SECTIONS.map((sec) => (
            <div key={sec.title}>
            <p className="text-muted-foreground mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide">{L(sec.title, SECTION_TITLE_MS[sec.title] ?? sec.title)}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {sec.fields.map(([key, label]) => (
                <label key={key} className="block">
                  <span className="text-muted-foreground mb-0.5 block text-[11px]">
                    {L(label, FIELD_LABEL_MS[key] ?? label)}
                    {isLocked(u, key) && <span className="ml-1">🔒</span>}
                  </span>
                  {SELECT_FIELDS[key as string] ? (
                    <select
                      className={input}
                      value={val(u, key)}
                      disabled={isLocked(u, key)}
                      title={isLocked(u, key) ? L("Locked — amendments are made by an admin", "Dikunci — pindaan dibuat oleh admin") : undefined}
                      onChange={(e) => set(u.id, key, e.target.value)}
                    >
                      <option value="">{L("— select —", "— pilih —")}</option>
                      {SELECT_FIELDS[key as string]!.map((o) => (
                        <option key={o} value={o}>{L(o.replace("_", " "), STATUS_MS[o] ?? o.replace("_", " "))}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={input}
                      value={val(u, key)}
                      placeholder={FIELD_PLACEHOLDERS[key] ? L(FIELD_PLACEHOLDERS[key]!, FIELD_PLACEHOLDERS_MS[key] ?? FIELD_PLACEHOLDERS[key]!) : undefined}
                      disabled={isLocked(u, key)}
                      title={isLocked(u, key)
                        ? L("Locked — amendments are made by an admin", "Dikunci — pindaan dibuat oleh admin")
                        : (FIELD_TITLES[key] ? L(FIELD_TITLES[key]!, FIELD_TITLES_MS[key] ?? FIELD_TITLES[key]!) : undefined)}
                      onChange={(e) => set(u.id, key, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            </div>
            ))}
            {open.has(u.id) && <StaffVault userId={u.id} name={displayName(u)} />}
            {open.has(u.id) && preview === u.id && (
              <div className="mt-3 overflow-x-auto">
                <p className="text-muted-foreground mb-2 text-xs">
                  {L("Live preview — updates as you type. Print uses exactly this layout.", "Pratonton langsung — dikemas kini semasa anda menaip. Cetakan menggunakan susun atur ini secara tepat.")}
                </p>
                <BadgePreview s={merged} />
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}


/* v1.4.191 STAFF DOCUMENT VAULT + onboarding checklist (CEO gap list):
   contracts, offer letters and resignation letters finally have a home —
   R2-backed, indexed, downloadable. The checklist tracks the standard
   joining steps per staff member. */
const ONBOARDING_ITEMS: [string, string][] = [
  ["offer_letter", "Offer letter signed"],
  ["contract", "Employment contract signed"],
  ["bank", "Bank details collected"],
  ["twofa", "2FA enabled"],
  ["badge", "ID badge printed"],
  ["groups", "Added to team WhatsApp group"],
];
// Display-only BM labels for the checklist (keyed by item key).
const ONBOARDING_MS: Record<string, string> = {
  offer_letter: "Surat tawaran ditandatangani",
  contract: "Kontrak pekerjaan ditandatangani",
  bank: "Butiran bank dikumpul",
  twofa: "2FA diaktifkan",
  badge: "Lencana ID dicetak",
  groups: "Ditambah ke kumpulan WhatsApp pasukan",
};
function StaffVault({ userId, name }: { userId: number; name: string }) {
  interface Doc { id: number; kind: string; label?: string | null; filename?: string | null; size?: number | null; created_at: string; uploaded_by_name?: string | null }
  const [docs, setDocs] = useState<Doc[]>([]);
  const [onb, setOnb] = useState<Record<string, boolean>>({});
  const [kind, setKind] = useState("contract");
  const [loaded, setLoaded] = useState(false);
  /* v1.77.0 — the vault is its own component, so it needs its own toast.
     The directory's showToast belongs to the list above and is not in scope
     here; reaching for it is what broke the 31-08 website build. */
  const { show: vaultToast, node: vaultToastNode } = useSaveToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const load = async () => {
    const r = await api<{ documents?: Doc[]; onboarding?: Record<string, boolean> }>(`/users/${userId}/documents`);
    if (r.ok) { setDocs(r.data?.documents ?? []); setOnb(r.data?.onboarding ?? {}); }
    setLoaded(true);
  };
  useEffect(() => { void load(); }, [userId]);
  const upload = async (f: File) => {
    /* v1.77.0 — this used to succeed and fail identically. Somebody who
       uploads a signed contract and sees nothing assumes it is filed. */
    const res = await csrfFetch(`${API}/users/${userId}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": f.type || "application/octet-stream",
        "X-Doc-Kind": kind, "X-Doc-Filename": f.name,
      },
      body: f,
    });
    vaultToast(res.ok ? L("Document uploaded", "Dokumen dimuat naik") : L("Not uploaded", "Tidak dimuat naik"),
      res.ok ? `${f.name} — ${name}` : L("The file did not save — try again", "Fail tidak disimpan — cuba lagi"),
      res.ok ? undefined : "notice");
    void load();
  };
  const toggle = async (key: string) => {
    const before = onb;
    const next = { ...onb, [key]: !onb[key] };
    setOnb(next);
    const res = await api(`/users/${userId}/onboarding`, { method: "POST", body: JSON.stringify({ items: next }) });
    /* v1.78.0 — the tick was set on screen and the save was never checked.
       A refused request left the box ticked and nothing saved: the one state
       where the screen actively lies about a staff member's onboarding. Put
       it back and say so. A successful tick needs no toast — the box moving
       is the receipt — but a failed one has no other tell. */
    if (!res.ok) {
      setOnb(before);
      vaultToast(
        L("Not saved", "Tidak disimpan"),
        L("That tick did not reach the server — try again", "Tanda itu tidak sampai ke pelayan — cuba lagi"),
        "notice",
      );
    }
  };
  if (!loaded) {
    /* v1.77.0 — skeleton until the first fetch lands, in the vault's own
       shape: heading, the kind-select + upload row, two document rows and
       the 2/3-column onboarding checklist. It used to be a blank gap that
       filled in a beat after the record opened. */
    return (
      <div className="border-border mt-3 rounded-lg border p-3" aria-hidden>
        <Skel className="h-3 w-56 max-w-full" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Skel className="h-6 w-24 rounded" />
          <Skel className="h-6 w-32 rounded" />
        </div>
        <div className="mt-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="border-border flex items-center justify-between gap-2 border-b py-1.5 last:border-0">
              <span className="flex items-center gap-1.5">
                <Skel className="h-4 w-14 rounded-full" />
                <Skel className="h-3 w-40" />
              </span>
              <Skel className="h-3 w-16" />
            </div>
          ))}
        </div>
        <Skel className="mt-3 h-2.5 w-32" />
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
          {ONBOARDING_ITEMS.map(([k]) => (
            <span key={k} className="flex items-center gap-1.5">
              <Skel className="h-3.5 w-3.5 rounded" />
              <Skel className="h-3 w-3/4" />
            </span>
          ))}
        </div>
      </div>
    );
  }
  const KIND_LABEL: Record<string, string> = { contract: L("Contract", "Kontrak"), offer_letter: L("Offer letter", "Surat tawaran"), resignation: L("Resignation", "Peletakan jawatan"), other: L("Other", "Lain-lain") };
  return (
    <div className="border-border mt-3 rounded-lg border p-3">
      {vaultToastNode}
      <p className="text-xs font-semibold">📁 {L("Documents & onboarding", "Dokumen & onboarding")} — {name}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className="border-input bg-background rounded border px-2 py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary"
          onClick={() => fileRef.current?.click()}>⬆ {L("Upload document", "Muat naik dokumen")}</button>
        <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      </div>
      {docs.length > 0 && (
        <div className="mt-2 space-y-0">
          {docs.map((d) => (
            <div key={d.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-xs last:border-0">
              <span className="min-w-0">
                <span className="bg-secondary mr-1.5 rounded-full px-2 py-0.5 text-[10px]">{KIND_LABEL[d.kind] ?? d.kind}</span>
                <span className="font-medium">{d.filename ?? d.label ?? L("document", "dokumen")}</span>
                <span className="text-muted-foreground"> · {dmy(d.created_at.slice(0, 10))}{d.uploaded_by_name ? ` · ${L("by", "oleh")} ${properName(d.uploaded_by_name)}` : ""}</span>
              </span>
              <span className="flex items-center gap-2">
                <a className={rowBtn} href={`${API}/staff-documents/${d.id}`}>{L("Download", "Muat turun")}</a>
                {/* v1.77.0 — deleting somebody's document said nothing.
                    A file in a staff vault is exactly the thing you want a
                    receipt for. */}
                <button type="button" className="text-destructive underline"
                  onClick={async () => {
                    const res = await api<{ error?: { message?: string } }>(`/staff-documents/${d.id}`, { method: "DELETE" });
                    vaultToast(res.ok ? L("Document deleted", "Dokumen dipadam") : L("Not deleted", "Tidak dipadam"),
                      res.ok ? (d.filename ?? d.label ?? L("The file is gone.", "Fail telah hilang."))
                             : (res.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya")),
                      res.ok ? undefined : "notice");
                    void load();
                  }}>{L("Delete", "Padam")}</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-muted-foreground mt-3 text-[11px] font-semibold tracking-wide uppercase">{L("Onboarding checklist", "Senarai semak onboarding")}</p>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
        {ONBOARDING_ITEMS.map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={!!onb[k]} onChange={() => void toggle(k)} />
            <span className={onb[k] ? "text-muted-foreground line-through" : ""}>{L(l, ONBOARDING_MS[k] ?? l)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
