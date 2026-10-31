"use client";
import { holds } from "@/lib/caps"; // v1.237.0 - the server's answer, matrix edits included
import { openPrintPreview } from "@/components/ui/document-preview";

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
 *
 * v1.201.0 - FIVE TABS, on the owner's mockup (23-10-2026): Overview, Staff
 * Directory, Organization Chart, Departments & Roles, Staff Records. The
 * same /staff/users read, the same record form, Save, photo, badge, role,
 * offboard, vault, reporting lines and responsibilities - with the same
 * gates (canAmend, readOnly, canSetRole, canAssign, canEditResponsibilities).
 * New on screen, all read from those records: the overview's department and
 * status figures, a filtered table or grid, a profile drawer that carries no
 * IC, bank or statutory number, "who reports to whom", and the roles written
 * per department. Add staff opens in a drawer from the tab row. Every zone
 * stays mounted and hides with sp.off.
 */

import { makeApi, csrfFetch } from "@/lib/api"; // v1.5.0: shared helper, staff-scoped
import { bySeniority, isStaffRole, staffState, DEPARTURE_STATUSES, type StaffState } from "@/lib/staff-order"; // v1.78.0 - one company order, shared with Payroll; v1.230.0 - one staff status
const api = makeApi("/staff");
/* v1.77.0 — offboarding is NOT a staff-portal route. It is served at
   /api/v1/users/:id/offboard in the worker's own dispatcher, next to the
   other account-lifecycle routes, because it kills sessions and clears 2FA.
   Calling it through the staff-scoped helper produced
   /api/v1/staff/users/42/offboard, which handleStaff does not serve, so the
   CEO's Offboard button answered "Staff route not found" every time.
   tests/api-routes.mjs now checks every client path against the routes the
   worker actually serves, so a helper with the wrong base cannot ship again.
   v1.238.0 - the call now lives in components/staff/offboard-sheet.tsx,
   with the same root helper. */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { esc, safeUrl } from "@/lib/escape-html";
import { dmy } from "@/lib/format";
import { properName, displayName, givenNames } from "@/lib/names";
import { compressImage } from "@/lib/compress-image";
import { useSaveToast } from "@/components/ui/save-toast";
import { PasswordInput } from "@/components/ui/password-input";
import { btnSm, btnSmPrimary, card, chipDanger, chipInfo, chipNeutral, chipSuccess, chipWarn, inputClass, selectClassSm } from "@/lib/ui-styles";
import { TabZone } from "@/components/portal/tab-concept";
import { ResponsibilitiesBlock, ResponsibilitiesView, responsibilityLines } from "@/components/staff/responsibilities"; // v1.174.0
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger } from "@/components/ui/row-button";
/* v1.77.0 — useConfirm is gone from this file: offboarding was its only user
   and it now asks for a date, which the prompt dialog does. The friction is
   not lost — you cannot offboard without choosing a date and pressing a red
   button. */
import { usePrompt } from "@/components/ui/prompt-dialog";
import { RecordToggle } from "@/components/ui/record-row";
import { useCachedApi } from "@/lib/cached-api";
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
import { OrgChart, ORG_ASSIGN_ROLES, buildOrg } from "@/components/staff/org-chart";
/* v1.157.0 - the ROLE on the record. CEO, 13-09-2026: "I want to have a
   roles assigned for me to assigned her role. this is only visible for CEO
   and COO to update the roles". The two lists are held against the worker's
   PERMS.role_assign and the route's WORKING_ROLES by tests/role-assign.mjs. */
import { ROLE_ASSIGN_ROLES, WORKING_ROLES } from "@/lib/org-tree";
/* v1.124.0 — the paper palette has one owner (lib/doc-theme.ts). This
   document is written into a separate window/iframe that cannot see the
   app stylesheet, so it needs literal hex, not var(--doc-*). */
import { DOC } from "@/lib/doc-theme";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
/* v1.201.0 - the five-tab page: the shared tab row, tiles, donut, avatar and
   drawer, and this page's own module (no new utility classes). */
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Donut } from "@/components/ui/donut";
import { Avatar } from "@/components/ui/avatar";
import { SideDrawer } from "@/components/ui/side-drawer";
import sp from "./staff-page.module.css";
/* v1.204.0 - the profile's links into the modules that own their records */
import type { TabName } from "@/lib/portal-tabs";
import { useRecordFocus, type RecordFocus } from "@/lib/record-focus";
import { leaveTypeL } from "@/components/portal/page-shared";
import { OffboardSheet, type OffboardPerson } from "@/components/staff/offboard-sheet";
import { ReportingLineCard } from "@/components/portal/reporting-line-card";
const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const API = "/api/v1/staff";

/** Today in Malaysia, as YYYY-MM-DD. The same expression the worker uses for
    its own default, so the date pre-filled in the offboard dialog is exactly
    the date the server would have chosen — a laptop left on UTC must not
    suggest yesterday as somebody's last day. */
const todayIso = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);


/* v1.172.1 - the V3 control; its disabled state is the class's own. */
const input = inputClass;

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
const btn = "erp-button erp-button-secondary erp-button-compact";

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
  /* v1.174.0 - roles and responsibilities (migration 0137): the role title,
     the list (one per line), who wrote it and when. Written on this tab by
     the CEO / HR tier (PERMS.responsibilities_edit); read on the Profile. */
  role_title?: string | null;
  responsibilities?: string | null;
  responsibilities_updated_at?: string | null;
  responsibilities_updated_by_name?: string | null;
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
      font-family:Arial,Helvetica,sans-serif;color:${DOC.navy};
      background:#fff;overflow:hidden;border:0.3mm solid ${DOC.navy};
      display:flex;flex-direction:column;align-items:stretch}
    .photo{width:20mm;height:24mm;margin:3.2mm auto 0;border:0.2mm solid #dfe3ec;
      background:${DOC.page};display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none}
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
      font-size:4.8px;line-height:1.35;color:${DOC.muted}}
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
    <div class="photo">${photo ? `<img src="${safeUrl(photo)}" alt="${esc(d.name)}"/>` : `<span style="font-size:6px;color:${DOC.muted}">PHOTO</span>`}</div>
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
  openPrintPreview(`<!doctype html><html><head><meta charset="utf-8"><title>${L("Badge", "Lencana")} — ${esc(s.full_name || s.name)}</title>
  <style>@page { size: 54mm 85.6mm; margin: 0; }${BADGE_CSS}</style></head>
  <body onload="setTimeout(function(){window.print()},250)">
  ${badgeCardHtml(s, window.location.origin)}
  </body></html>`);
}

/** Multi-badge sheet (v1.4.43): several badges per A4 page — 3 × 3 = up to
    nine 54×85.6 mm cards per sheet, saving paper over one page per badge. */
function printBadges(list: Staff[]) {
  if (list.length === 0) return;
  const origin = window.location.origin;
  openPrintPreview(`<!doctype html><html><head><meta charset="utf-8"><title>${L("Badges", "Lencana")} — ${list.length} ${L("staff", "kakitangan")}</title>
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
}

/* ---------------- directory ---------------- */

/* v1.4.213 (CEO: "minimalist … like a profile looks which is easier for my
   hr to update"): the flat field grid becomes a PROFILE — three sections
   with subheads, personal first the way a profile reads. New fields the
   record was missing: emergency contact + home address (duty of care) and
   EPF / SOCSO / income-tax numbers (payroll needs them the moment the
   pending statutory registration completes). Same inputs, same lock
   policy — only the grouping and the seven additions are new. */
/* v1.126.0 — the title was "👤 Personal", and it is a KEY as well as a label
   (SECTION_TITLE_MS below looks it up). The glyph moved to its own field so
   the key is words; changing an icon can never break a translation again. */
const RECORD_SECTIONS: { title: string; icon: AppIconName; fields: [keyof Staff, string][] }[] = [
  {
    title: "Personal",
    icon: "person",
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
    title: "Employment",
    icon: "orders",
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
    title: "Bank & statutory",
    icon: "money",
    fields: [
      ["bank_name", "Bank (Malaysia)"],
      ["bank_account", "Bank account no."],
      ["epf_no", "EPF (KWSP) no."],
      ["socso_no", "SOCSO (PERKESO) no."],
      ["tax_no", "Income tax no. (LHDN)"],
    ],
  },
];
/* v1.201.0 - read by Staff Records: how many of these a record has filled */
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
  Personal: "Peribadi",
  Employment: "Pekerjaan",
  "Bank & statutory": "Bank & statutori",
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
  const gone = (u: Staff) => staffState(u) === "left"; // v1.230.0 - the one status rule
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
  const gone = staffState(u) === "left"; // v1.230.0 - the one status rule
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
        : `${displayName(u)}${u.position ? ` · ${u.position}` : ""} — ${L("press to open the profile", "tekan untuk buka profil")}`}
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
            <AppIcon name="cake" className="h-3.5 w-3.5" />
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

/* v1.201.0 - the page's five tabs, and the three states a record can be in:
   working (is_active), an account switched off, or a leaver (resigned or
   terminated - the Staff tab is the one place they are still listed). */
type StaffTab = "overview" | "directory" | "org" | "team" | "roles" | "records";
/* v1.204.0 - the profile's sections (the owner's second Staff mockup,
   25-10-2026). Profile and Employment are this record; Documents is the
   record's own vault; Leave, Attendance and Payroll are READ from the modules
   that own them, with a link to the original - nothing is copied here. */
type PeekTab = "profile" | "employment" | "documents" | "leave" | "attendance" | "payroll";
type SortKey = "rank" | "az" | "za" | "id" | "dept";
/* the fields of a Leave record the profile reads (Leave owns the record) */
interface LeaveRow { id: number; user_id?: number; type: string; start_date: string; end_date: string; days: number; status: string }
/* a wide screen docks the profile beside the directory; anything narrower
   opens it in the drawer */
const WIDE = "(min-width: 1280px)";
const subscribeWide = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
function useWide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
}
/* v1.230.0 - StaffState and staffState() live in lib/staff-order.ts */
const NO_DEPT = "__none";
/* one colour per department, mixed from the brand and the status tokens -
   theme tokens only, so both themes get them */
const DEPT_COLORS = [
  "var(--primary)", "var(--gold-solid)", "var(--info)", "var(--success)", "var(--warning)",
  "color-mix(in oklab, var(--gold-solid) 45%, var(--primary))", "var(--danger)",
];

export function StaffDirectory({ canAmend = false, readOnly = false, role = "", canEditResponsibilities = false, go, canOpen, recordFocus, initialView }: {
  /** v1.233.0 - the Dashboard's reporting-line card opens the Organisation tab directly */
  initialView?: string;
  /** v1.205.0 - a search hit or a link opened this person (lib/record-focus.ts) */
  recordFocus?: RecordFocus | null;
  /** v1.204.0 - open another tab (the profile's links to Leave, Attendance, Payroll, Users) */
  go?: (t: TabName) => void;
  /** v1.204.0 - whether this account's tab strip shows a tab; a link is drawn only where it leads */
  canOpen?: (t: string) => boolean;
  canAmend?: boolean;
  readOnly?: boolean;
  role?: string;
  /** v1.174.0 - may write role titles and responsibilities; mirrors PERMS.responsibilities_edit in the worker. */
  canEditResponsibilities?: boolean;
}) {
  /* v1.101.0 - only the three the CEO named may set a reporting line. The
     list lives in org-chart.tsx and tests/org-chart.mjs holds it against
     PERMS.org_assign in the worker, so the button and the door agree. The
     server refuses regardless of what this says. */
  const canAssign = holds("org_assign", ORG_ASSIGN_ROLES.includes(role));
  /* v1.201.0 - FIVE TABS (the owner's mockup, 23-10-2026). `tab` is the
     page; `view` is now only the Organization Chart's own switch,
     Organisation or Team map - the directory is a tab of its own. */
  const [tab, setTab] = useState<StaffTab>(initialView === "org" ? "org" : "overview");
  /* v1.204.0 - Organisation and Team Map are tabs of their own now; the
     Team Map's circle is drawn only while its tab is open */
  const view: "org" | "circle" = tab === "team" ? "circle" : "org";
  const [peekTab, setPeekTab] = useState<PeekTab>("profile");
  const wide = useWide();
  const [layout, setLayout] = useState<"table" | "grid">("table");
  const [deptF, setDeptF] = useState("");
  const [stateF, setStateF] = useState<"" | StaffState>("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [recQuery, setRecQuery] = useState("");
  /* whose profile drawer is open */
  const [peek, setPeek] = useState<number | null>(null);
  const recRef = useRef<HTMLDivElement | null>(null);
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
  const [sortBy, setSortBy] = useState<SortKey>("rank");
  const [query, setQuery] = useState("");
  /* v1.92.0 — pressing a circle opens the record, or ticks it for printing. */
  const [selectMode, setSelectMode] = useState(false);
  /* v1.99.2 — who the orbit is naming right now (hover or keyboard focus).
     The orbit itself carries no captions, so this is where the name goes. */
  const [focus, setFocus] = useState<Staff | null>(null);
  const todayS = todayIso();
  const { show: showToast, node: toastNode } = useSaveToast();
  const { prompt, node: promptNode } = usePrompt();
  /* v1.238.0 - the Offboard sheet: what they hold, the handover, the last
     day, and the authenticator code for an executive or Admin account */
  const [offboard, setOffboard] = useState<OffboardPerson | null>(null);

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

  /* v1.104.0 (roadmap phase 02) - remembered, then refreshed. The directory
     you saw last time paints from the device before /users answers; the fetch
     runs behind it and swaps the list in. `staff` and `allStaff` stay local
     state on purpose - assignReportsTo patches a row the moment the server
     says yes, and that patch must not wait for a refetch - so they are DERIVED
     from the cached view rather than replaced by it. A write on any account
     bumps the "users" topic and the view refetches itself.

     v1.77.0 (kept) - skeleton until the first EVER fetch lands; `staff`
     starts [] and the directory used to draw an empty list and "Select all"
     over nothing until /users answered. */
  const users = useCachedApi<{ users?: Staff[]; staff?: Staff[] }>("/staff/users", true, ["users"]);
  const loaded = !users.loading;
  /* v1.4.218: a failed load previously rendered a silently EMPTY directory —
     which read as "all staff details was gone!". Say why. Only when there is
     nothing remembered to show; a stale-but-present list is better than a
     warning over an empty one. */
  const loadError = users.failed && !users.data ? L(
    "Couldn't load the staff list from the server — the data is safe. Usually this means the worker and database are out of step: run the pending migrations + deploy, then refresh.",
    "Tidak dapat memuatkan senarai kakitangan daripada pelayan — data selamat. Biasanya ini bermakna worker dan pangkalan data tidak selari: jalankan migrasi tertunda + deploy, kemudian muat semula.",
  ) : "";
  useEffect(() => {
    if (!users.data) return;
    const list = users.data.users ?? users.data.staff ?? [];
    setAllStaff(list);
    /* v1.78.0 - the rank order that used to be written out here now lives in
       lib/staff-order.ts, because the Payroll tab needed the same one and two
       copies of an order drift. */
    setStaff(list.filter((u) => isStaffRole(u.role)).sort(bySeniority));
  }, [users.data]);
  const refreshView = users.refresh;
  const load = useCallback(async () => { refreshView(); }, [refreshView]);

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

  /* v1.157.0 - THE ROLE, SET FROM THE RECORD. Only the CEO and COO see the
     control (ROLE_ASSIGN_ROLES); it is deliberately NOT part of Save, because
     the COO is read-only on the record's fields and a role is not a field -
     it is the door list. Its own audited route, a confirmation that names
     both roles, an optional reason. Executive accounts show the control
     locked: those roles are the super_admin's to change (v1.4.157). */
  const canSetRole = holds("role_assign", ROLE_ASSIGN_ROLES.includes(role));
  const roleLabel = (r: string) => L(r.replace(/_/g, " "), ROLE_MS[r] ?? r.replace(/_/g, " "));
  const changeRole = async (u: Staff, next: string) => {
    if (!next || next === u.role) return;
    const r = await prompt({
      title: L(`Change ${displayName(u)}'s role?`, `Tukar peranan ${displayName(u)}?`),
      message: L(
        `${roleLabel(u.role)} → ${roleLabel(next)}. This changes which tabs they see the next time the app refreshes, and whether the Sales Performance register measures them. The change is recorded with your name.`,
        `${roleLabel(u.role)} → ${roleLabel(next)}. Ini menukar tab yang mereka lihat pada muat semula seterusnya, dan sama ada daftar Prestasi Jualan mengukur mereka. Perubahan direkodkan dengan nama anda.`,
      ),
      label: L("Reason (optional)", "Sebab (pilihan)"),
      placeholder: L("e.g. moved to the live team from 15-09", "cth. berpindah ke pasukan siaran langsung dari 15-09"),
      confirmLabel: L("Change role", "Tukar peranan"),
    });
    if (!r) return;
    setRowMsg((m) => ({ ...m, [u.id]: "" }));
    const res = await api<ErrShape & { role?: string }>(`/users/${u.id}/role`, {
      method: "POST", body: JSON.stringify({ role: next, reason: r.value }),
    });
    if (res.ok) {
      showToast(L("Role changed", "Peranan ditukar"), `${displayName(u)} — ${roleLabel(next)}`);
      void load();
    } else {
      setRowMsg((m) => ({ ...m, [u.id]: res.data?.error?.message ?? L("Role change failed", "Penukaran peranan gagal") }));
    }
  };

  /* v1.173.0 (tab concept) - the summary tier from the records already
     loaded: headcount, active, departments. No second request.
     v1.230.0 - ACTIVE IS HEADCOUNT (the owner, 30-10-2026: "ONE
     AUTHORITATIVE STAFF STATUS DEFINITION"). It counted the account switch,
     which offboarding leaves on so a leaver's final month is paid: 9 Active
     beside a chart that said 7. Now every figure on this tab is
     staffState() (lib/staff-order.ts), the worker's headcountSql. */
  const stateOf = (u: Staff): StaffState => staffState(u, todayS);
  const isHead = (u: Staff) => stateOf(u) === "active";
  const headcount = staff.filter(isHead);
  const activeCount = headcount.length;
  /* v1.230.0 - who of them is on approved leave today (the owner: "Yes, a
     note under Active"). Leave keeps a person in headcount; this only says
     so. Read from Leave's own calendar route - dates and names, never the
     type or the reason (its PDPA stance) - for today only. */
  const leaveToday = useCachedApi<{ leave?: { user_id: number }[] }>(`/staff/leave/calendar?from=${todayS}&to=${todayS}`, true, ["leave"]);
  const onLeaveIds = new Set((leaveToday.data?.leave ?? []).map((l) => l.user_id));
  const onLeaveToday = headcount.filter((u) => onLeaveIds.has(u.id)).length;
  const departments = new Set(staff.map((u) => (u.department ?? "").trim()).filter(Boolean)).size;
  /* v1.174.0 - how many working staff have their roles and responsibilities
     written (a title or at least one line) - the CEO's own to-do figure. */
  const writtenCount = headcount.filter((u) => (u.role_title ?? "").trim() || responsibilityLines(u.responsibilities).length > 0).length;

  /* v1.201.0 - THE FIVE TABS, read from the same records. Nothing below
     fetches: every figure, group and chart is the /staff/users list already
     loaded above, so no tab can disagree with another. */
  const isGone = (u: Staff) => stateOf(u) === "left";
  const STATE_LABEL: Record<StaffState, string> = {
    active: L("Active", "Aktif"),
    starting: L("Starting", "Akan bermula"),
    inactive: L("Inactive", "Tidak aktif"),
    left: L("Left", "Telah keluar"),
    system: L("System account", "Akaun sistem"),
  };
  const stateChip = (u: Staff) => {
    const s = stateOf(u);
    if (s === "left") {
      /* v1.201.1 - the owner, 23-10-2026: "staff resigned account active?"
         The account stays switched on (is_active) on purpose - payroll and
         the M2E file read is_active, so a leaver is still paid for the last
         month - but the password and Google sign-in both refuse a resigned
         or terminated status. Say so beside the status, so nobody reads the
         Users page's "active" as "can still log in". Display only. */
      return (
        <span className={sp.statusPair}>
          <span className={chipDanger}>
            {L(u.employment_status ?? "", STATUS_MS[u.employment_status ?? ""] ?? (u.employment_status ?? ""))}{u.left_on ? ` · ${dmy(u.left_on)}` : ""}
          </span>
          <span className={chipNeutral}
            title={L("Password and Google sign-in refuse a resigned or terminated account. The account itself stays on so their final month is still paid.",
                     "Log masuk kata laluan dan Google menolak akaun yang telah letak jawatan atau ditamatkan. Akaun itu sendiri kekal supaya gaji bulan terakhir mereka masih dibayar.")}>
            <AppIcon name="lock" />{L("Sign-in blocked", "Log masuk disekat")}
          </span>
        </span>
      );
    }
    /* v1.230.0 - serving notice: on staff (and paid) until the last day */
    if (s === "active" && DEPARTURE_STATUSES.includes(u.employment_status ?? "") && u.left_on) {
      return <span className={chipSuccess}>{L(`Active · leaving ${dmy(u.left_on)}`, `Aktif · keluar ${dmy(u.left_on)}`)}</span>;
    }
    if (s === "starting") return <span className={chipInfo}>{L(`Starting ${dmy(u.joined_on ?? "")}`, `Bermula ${dmy(u.joined_on ?? "")}`)}</span>;
    return <span className={s === "active" ? chipSuccess : chipNeutral}>{STATE_LABEL[s]}</span>;
  };
  const deptName = (u: Staff) => (u.department ?? "").trim();
  const noDept = L("No department", "Tiada jabatan");
  const writtenOf = (u: Staff) => Boolean((u.role_title ?? "").trim() || responsibilityLines(u.responsibilities).length > 0);
  /* departments by headcount, the unnamed group last */
  const byDept = [...staff.reduce((m, u) => m.set(deptName(u), [...(m.get(deptName(u)) ?? []), u]), new Map<string, Staff[]>())]
    .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : b[1].length - a[1].length || a[0].localeCompare(b[0])));
  const deptColor = (i: number, k: string) => (k === "" ? "var(--muted-foreground)" : DEPT_COLORS[i % DEPT_COLORS.length]!);
  const pctOf = (n: number, of: number) => (of > 0 ? Math.round((n * 100) / of) : 0);
  const notOnChart = buildOrg(staff).unassigned.length;
  const noFullName = staff.filter((u) => !isGone(u) && !u.full_name?.trim()).length;
  const notWritten = headcount.filter((u) => !writtenOf(u)).length;
  const filledOf = (u: Staff) => RECORD_FIELDS.filter(([k]) => String(u[k] ?? "").trim()).length;
  /* v1.230.0 - employment TYPE among current staff (the owner: "Current
     staff only"). Resigned/Terminated are how somebody left - they are
     under Left, not a kind of contract. Any other stored value (probation,
     the legacy "active") is shown under its own name, so the bars always
     add up to Active. */
  const TYPE_ORDER = ["permanent", "contract", "part_time", "probation"];
  /* someone serving notice, or back after leaving, still carries the
     departure where the type was (offboarding writes it there): their type
     is not on record, so it is "Not set" - never a "Resigned" type */
  const typeOf = (u: Staff) => (DEPARTURE_STATUSES.includes(u.employment_status ?? "") ? "" : (u.employment_status ?? ""));
  const typeKeys = [...TYPE_ORDER, ...[...new Set(headcount.map(typeOf))].filter((k) => k && !TYPE_ORDER.includes(k)).sort(), ""];
  const typeCounts = typeKeys.map((k) => [k, headcount.filter((u) => typeOf(u) === k).length] as const).filter(([, n]) => n > 0);
  const maxType = Math.max(1, ...typeCounts.map(([, n]) => n));
  /* every record in exactly one state: the bars add up to Staff records.
     Starting and System account are drawn only when somebody is in them. */
  const stateCounts = (["active", "starting", "inactive", "left", "system"] as const)
    .map((k) => [k, staff.filter((u) => stateOf(u) === k).length] as const)
    .filter(([k, n]) => n > 0 || k === "active" || k === "inactive" || k === "left");

  /* the directory: search, department, status, then the chosen order */
  const needle = query.trim().toLowerCase();
  /* v1.204.0 - two more orders: by staff ID, and by department (company
     order inside each) */
  const ranked = sortBy === "rank"
    ? staff
    : [...staff].sort((a, b) => sortBy === "az" ? displayName(a).localeCompare(displayName(b))
      : sortBy === "za" ? displayName(b).localeCompare(displayName(a))
      : sortBy === "id" ? (a.employee_id || "~").localeCompare(b.employee_id || "~", undefined, { numeric: true })
      : (deptName(a) || "~").localeCompare(deptName(b) || "~"));
  const dirList = ranked
    .filter((u) => !needle || [displayName(u), u.email, u.employee_id, u.position, u.department, u.role]
      .some((value) => (value ?? "").toLowerCase().includes(needle)))
    .filter((u) => !deptF || (deptF === NO_DEPT ? !deptName(u) : deptName(u) === deptF))
    .filter((u) => !stateF || stateOf(u) === stateF);
  const allShownTicked = dirList.length > 0 && dirList.every((u) => selected.has(u.id));
  const recNeedle = recQuery.trim().toLowerCase();
  const recList = staff.filter((u) => !recNeedle || [displayName(u), u.employee_id, u.position, u.department]
    .some((value) => (value ?? "").toLowerCase().includes(recNeedle)));

  /* v1.201.0 - ONE DOOR TO A PERSON. Pressing anybody - a row, a card, a
     box on the chart, a face on the team map - opens their profile drawer;
     the drawer's "Open full record" takes you to Staff Records with that
     record open. Selecting for printing still ticks instead. */
  const press = (u: Staff) => {
    if (selectMode) { toggleSelect(u.id); return; }
    setPeek(u.id);
    setPeekTab("profile");
  };
  const openRecord = (id: number) => {
    setPeek(null);
    setOpen(new Set([id]));
    setTab("records");
    window.setTimeout(() => recRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  };
  const showDirectory = (dept: string, state: "" | StaffState = "") => {
    setQuery(""); setDeptF(dept); setStateF(state); setTab("directory");
  };
  const peekU = peek == null ? null : staff.find((u) => u.id === peek) ?? null;
  /* v1.205.0 - a search hit opens the person's profile on the Directory,
     with the filters cleared so their row is in the list beside it */
  useRecordFocus(recordFocus, loaded, (f) => {
    if (f.kind !== "staff") return;
    setQuery(""); setDeptF(""); setStateF(""); setSelectMode(false);
    setTab("directory"); setPeek(f.id); setPeekTab("profile");
  });
  /* v1.233.0 - the CEO reports to nobody: whatever is stored on the CEO's
     record is never shown as a manager (the Organisation chart already roots
     at the CEO and ignores it) */
  const managerOf = (u: Staff) => (u.role !== "ceo" && u.reports_to ? staff.find((x) => x.id === u.reports_to) ?? null : null);
  const reportsOf = (u: Staff) => staff.filter((x) => x.reports_to === u.id && !isGone(x));
  const managers = staff.filter((m) => !isGone(m) && reportsOf(m).length > 0);
  const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const employmentLabel = (s: string | null | undefined) => (s ? cap1(L(s.replace("_", " "), STATUS_MS[s] ?? s.replace("_", " "))) : L("Not set", "Belum ditetapkan"));

  const head = (icon: AppIconName, well: string | undefined, title: string, sub?: string, right?: ReactNode) => (
    <div className={sp.head}>
      <div className={sp.lead}>
        <span className={`${sp.well} ${well}`} aria-hidden><AppIcon name={icon} /></span>
        <div className={sp.headText}>
          <h3 className={sp.title}>{title}</h3>
          {sub && <p className={sp.sub}>{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
  const personBtn = (u: Staff, line: string) => (
    <button type="button" className={sp.person} onClick={() => press(u)}
      title={selectMode ? L("Press to tick for badge printing", "Tekan untuk tanda bagi cetakan lencana") : L("Open the profile", "Buka profil")}>
      <Avatar name={displayName(u)} photoKey={u.photo_key} size="md" />
      <span className={sp.personText}>
        <strong>{displayName(u)}</strong>
        <span>{line}</span>
      </span>
    </button>
  );
  const skelRows = (n: number, cols: number) => Array.from({ length: n }, (_, i) => (
    <tr key={`sk-${i}`} aria-hidden>
      <td colSpan={cols}><span className={sp.skelRow}><Skel className="h-9 w-9 rounded-full" /><Skel className="h-3 w-48" /></span></td>
    </tr>
  ));

  /* v1.204.0 - THE PROFILE, one body for two places: the drawer (any width,
     any tab) and the panel docked beside the Directory on a wide screen.
     Profile and Employment are this record; Documents is its own vault;
     Leave, Attendance and Payroll are READ from the modules that own them,
     each with a link to the original. Still no IC, bank or statutory number
     here - those stay on the full record (Staff Records). */
  const can = (t: string) => (canOpen ? canOpen(t) : false);
  const leaveView = useCachedApi<{ leave?: (LeaveRow)[] }>(peekU && peekTab === "leave" ? "/staff/leave?all=1" : null, Boolean(peekU && peekTab === "leave"), ["leave"]);
  const monitorView = useCachedApi<{ staff?: { id: number; in_at?: string | null; out_at?: string | null; last_type?: string | null; shifts?: number }[] }>(
    peekU && peekTab === "attendance" ? "/staff/attendance/monitor" : null, Boolean(peekU && peekTab === "attendance"), ["attendance"]);
  const fact = (label: string, value: ReactNode) => <div><dt>{label}</dt><dd>{value || <span className={sp.muted}>—</span>}</dd></div>;
  const linkTo = (t: TabName, label: string) => (can(t) && go
    ? <button type="button" className={btnSm} onClick={() => { setPeek(null); go(t); }}><AppIcon name="external" />{label}</button>
    : <p className={sp.hint}>{L(`${t} is not open to your role.`, `${t} tidak dibuka kepada peranan anda.`)}</p>);
  const mytHmOf = (utc?: string | null) => {
    if (!utc) return "";
    const t = new Date(utc.replace(" ", "T") + "Z").getTime();
    return Number.isNaN(t) ? "" : new Date(t + 8 * 3600 * 1000).toISOString().slice(11, 16);
  };
  const PEEK_TABS: [PeekTab, string][] = [
    ["profile", L("Profile", "Profil")],
    ["employment", L("Employment", "Pekerjaan")],
    ["documents", L("Documents", "Dokumen")],
    ["leave", L("Leave", "Cuti")],
    ["attendance", L("Attendance", "Kehadiran")],
    ["payroll", L("Payroll", "Gaji")],
  ];
  const profileBody = (u: Staff) => {
    const manager = managerOf(u);
    const directs = reportsOf(u);
    const b = birthdayInfo(u.birthday, todayS);
    const photo = u.photo_key ? `/api/v1/media/file/${encodeURIComponent(u.photo_key)}` : "";
    const leaves = (leaveView.data?.leave ?? []).filter((l) => l.user_id === u.id).sort((x, y) => y.start_date.localeCompare(x.start_date)).slice(0, 6);
    const today = (monitorView.data?.staff ?? []).find((m) => m.id === u.id) ?? null;
    return (
      <div className={sp.drawer}>
        <div className={sp.profileHead}>
          <Avatar name={displayName(u)} photoKey={u.photo_key} size="lg" />
          <span className={sp.profileName}>
            <strong>{displayName(u)}</strong>
            <span>{[u.position || roleLabel(u.role), deptName(u), u.employee_id].filter(Boolean).join(" · ")}</span>
          </span>
          <span className={sp.chips}>
            {stateChip(u)}
            {!u.full_name?.trim() && <span className={chipWarn}>{L("no full name", "tiada nama penuh")}</span>}
            {b && !isGone(u) && b.days <= 14 && (
              <span className={chipInfo}><AppIcon name="cake" />{b.days === 0 ? L(`turns ${b.turns} today`, `genap ${b.turns} hari ini`) : `${L("turns", "genap")} ${b.turns} ${L("in", "dalam")} ${b.days} ${L("day(s)", "hari")}`}</span>
            )}
          </span>
        </div>
        <div className={sp.peekTabs} role="tablist" aria-label={L("Profile sections", "Bahagian profil")}>
          {PEEK_TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={peekTab === k} onClick={() => setPeekTab(k)}>{label}</button>
          ))}
        </div>

        {peekTab === "profile" && (
          <>
            <section className={sp.block} aria-label={L("Basic information", "Maklumat asas")}>
              <p className={sp.formTitle}>{L("Basic information", "Maklumat asas")}</p>
              <div className={sp.basic}>
                <dl className={sp.facts}>
                  {fact(L("Full name", "Nama penuh"), u.full_name?.trim())}
                  {fact(L("Preferred name", "Nama panggilan"), u.name)}
                  {fact(L("Staff ID", "ID kakitangan"), u.employee_id && <span className={sp.mono}>{u.employee_id}</span>)}
                  {fact(L("Position", "Jawatan"), u.position)}
                  {fact(L("Department", "Jabatan"), deptName(u))}
                  {fact(L("Phone", "Telefon"), u.phone)}
                </dl>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photo ? <img className={sp.photo} src={photo} alt={L(`Photo of ${displayName(u)}`, `Foto ${displayName(u)}`)} />
                  : <span className={`${sp.photo} ${sp.photoNone}`}><AppIcon name="person" />{L("No photo", "Tiada foto")}</span>}
              </div>
            </section>
            <section className={sp.block} aria-label={L("Reporting and access", "Pelaporan dan akses")}>
              <p className={sp.formTitle}>{L("Reporting & access", "Pelaporan & akses")}</p>
              <dl className={sp.facts}>
                {fact(L("Reports to", "Melapor kepada"), manager ? (
                  <button type="button" className={sp.pill} onClick={() => setPeek(manager.id)}>
                    <Avatar name={displayName(manager)} photoKey={manager.photo_key} size="sm" />{displayName(manager)}
                  </button>
                ) : u.role === "ceo" ? <span className={sp.muted}>{L("Top of the organisation — reports to nobody", "Puncak organisasi — tidak melapor kepada sesiapa")}</span>
                  : <span className={sp.muted}>{L("Not on the chart", "Tiada pada carta")}</span>)}
                {fact(L("Direct reports", "Melapor terus"), directs.length === 0 ? <span className={sp.muted}>{L("None", "Tiada")}</span> : (
                  <span className={sp.reports}>
                    {directs.map((r) => (
                      <button key={r.id} type="button" className={sp.pill} onClick={() => setPeek(r.id)}>
                        <Avatar name={displayName(r)} photoKey={r.photo_key} size="sm" />{givenNames(displayName(r))}
                      </button>
                    ))}
                  </span>
                ))}
                {fact(L("System role", "Peranan sistem"), <span className={sp.cap}>{roleLabel(u.role)}</span>)}
                {fact(L("Work email", "E-mel kerja"), u.email)}
              </dl>
              {/* Users owns sign-in and permissions: the account is changed there */}
              {can("Users") && go && (
                <button type="button" className={btnSm} onClick={() => { setPeek(null); go("Users"); }}><AppIcon name="lock" />{L("View in Users", "Lihat di Pengguna")}</button>
              )}
            </section>
            <section className={sp.block} aria-label={L("Roles and responsibilities", "Peranan dan tanggungjawab")}>
              <p className={sp.formTitle}>{L("Roles and responsibilities", "Peranan dan tanggungjawab")}</p>
              <ResponsibilitiesView
                value={{ role_title: u.role_title, responsibilities: u.responsibilities, responsibilities_updated_at: u.responsibilities_updated_at, responsibilities_updated_by_name: u.responsibilities_updated_by_name }}
                emptyText={L("Not written yet.", "Belum ditulis.")} />
            </section>
          </>
        )}

        {peekTab === "employment" && (
          <section className={sp.block} aria-label={L("Employment", "Pekerjaan")}>
            <p className={sp.formTitle}>{L("Employment", "Pekerjaan")}</p>
            <dl className={sp.facts}>
              {fact(L("Staff ID", "ID kakitangan"), u.employee_id && <span className={sp.mono}>{u.employee_id}</span>)}
              {fact(L("Position", "Jawatan"), u.position)}
              {fact(L("Department", "Jabatan"), deptName(u))}
              {fact(L("Employment type", "Jenis pekerjaan"), employmentLabel(u.employment_status))}
              {fact(L("Joined on", "Mula bekerja"), u.joined_on && dmy(u.joined_on))}
              {fact(L("ID issued", "ID dikeluarkan"), u.id_issued_on && dmy(u.id_issued_on))}
              {(u.left_on || isGone(u)) && fact(L("Last day", "Hari terakhir"), u.left_on && dmy(u.left_on))}
              {u.rejoined_on && fact(L("Re-joined on", "Kembali bekerja"), dmy(u.rejoined_on))}
            </dl>
            <p className={sp.hint}>{L("Changed on the full record, with its locks: HR fills empty fields; a saved field is amended by the CEO or an admin.", "Diubah pada rekod penuh, dengan kuncinya: HR mengisi medan kosong; medan yang disimpan dipinda oleh CEO atau admin.")}</p>
          </section>
        )}

        {peekTab === "documents" && <StaffVault userId={u.id} name={displayName(u)} />}

        {peekTab === "leave" && (
          <section className={sp.block} aria-label={L("Leave", "Cuti")}>
            <p className={sp.formTitle}>{L("Leave requests", "Permohonan cuti")}</p>
            {leaveView.loading ? <SkelRows rows={3} /> : leaves.length === 0 ? (
              <p className={sp.empty}><AppIcon name="holiday" />{L("No leave request you may see for this person.", "Tiada permohonan cuti yang boleh anda lihat untuk orang ini.")}</p>
            ) : (
              <ul className={sp.miniList}>
                {leaves.map((l) => (
                  <li key={l.id}>
                    <span className={sp.leaveLine}><strong>{cap1(leaveTypeL(l.type))}</strong><span>{dmy(l.start_date)}{l.end_date && l.end_date !== l.start_date ? ` → ${dmy(l.end_date)}` : ""} · {l.days} {L("day(s)", "hari")}</span></span>
                    <span className={l.status === "approved" ? chipSuccess : l.status === "rejected" ? chipDanger : l.status === "cancelled" ? chipNeutral : chipWarn}>{l.status}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className={sp.hint}>{L("Leave owns these records and their entitlements; they are shown here, not kept here.", "Cuti memiliki rekod dan kelayakan ini; ia dipaparkan di sini, bukan disimpan di sini.")}</p>
            {linkTo("Leave", L("Open in Leave", "Buka di Cuti"))}
          </section>
        )}

        {peekTab === "attendance" && (
          <section className={sp.block} aria-label={L("Attendance", "Kehadiran")}>
            <p className={sp.formTitle}>{L("Today", "Hari ini")}</p>
            {monitorView.loading ? <SkelRows rows={2} /> : monitorView.failed && !monitorView.data ? (
              <p className={sp.empty}><AppIcon name="lock" />{L("Today's attendance is open to HR and management.", "Kehadiran hari ini dibuka kepada HR dan pengurusan.")}</p>
            ) : (
              <dl className={sp.facts}>
                {fact(L("Status", "Status"), today?.last_type === "clock_in" ? <span className={chipSuccess}>{L("On shift", "Sedang syif")}</span>
                  : today?.in_at ? <span className={chipNeutral}>{L("Clocked out", "Daftar keluar")}</span>
                  : <span className={chipWarn}>{L("Not clocked in", "Belum daftar masuk")}</span>)}
                {fact(L("Clocked in", "Daftar masuk"), mytHmOf(today?.in_at))}
                {fact(L("Clocked out", "Daftar keluar"), mytHmOf(today?.out_at))}
              </dl>
            )}
            <p className={sp.hint}>{L("Attendance owns the punches, the month and the roster.", "Kehadiran memiliki rekod punch, bulan dan roster.")}</p>
            {linkTo("Attendance", L("Open in Attendance", "Buka di Kehadiran"))}
          </section>
        )}

        {peekTab === "payroll" && (
          <section className={sp.block} aria-label={L("Payroll", "Gaji")}>
            <p className={sp.formTitle}>{L("Payroll", "Gaji")}</p>
            <p className={sp.empty}><AppIcon name="lock" />{L("Salary, payslips and the bank file belong to Payroll and are kept there — no pay figure is shown on a profile.", "Gaji, slip gaji dan fail bank milik Gaji dan disimpan di sana — tiada angka gaji dipaparkan pada profil.")}</p>
            {linkTo("Payroll", L("Open in Payroll", "Buka di Gaji"))}
          </section>
        )}
      </div>
    );
  };
  const profileFooter = (u: Staff) => (
    <span className={sp.actions}>
      <button type="button" className={btnSmPrimary} onClick={() => openRecord(u.id)}><AppIcon name="edit" />{readOnly ? L("Open full record", "Buka rekod penuh") : L("Edit profile", "Sunting profil")}</button>
      <button type="button" className={btnSm} onClick={() => printBadge({ ...u, ...draft[u.id] } as Staff)}><AppIcon name="print" />{L("Print badge", "Cetak lencana")}</button>
      <button type="button" className={btnSm} onClick={() => setPeek(null)}>{L("Close", "Tutup")}</button>
    </span>
  );

  return (
    /* The page's TabPage is the stack. v1.201.0 - five tabs, every zone
       mounted and hidden with sp.off, so a search, a selection or an open
       record survives a trip to another tab. */
    <>
      {/* outside every zone: a hidden tab must not hide a toast, a question or a drawer */}
      {toastNode}{promptNode}
      <OffboardSheet person={offboard} onClose={() => setOffboard(null)}
        colleagues={offboard ? staff.filter((x) => x.id !== offboard.id && x.is_active && x.role !== "customer" && x.role !== "super_admin" && !["resigned", "terminated"].includes(x.employment_status ?? "")).map((x) => ({ id: x.id, name: displayName(x) })) : []}
        onDone={(m) => { showToast(L("Offboarded", "Khidmat ditamatkan"), m); void load(); }} />
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
      <LineTabs value={tab} onChange={(k) => setTab(k)} label={L("Staff", "Kakitangan")} tabs={[
        ["overview", L("Overview", "Gambaran")],
        ["directory", L("Directory", "Direktori")],
        ["org", L("Organisation", "Organisasi")],
        ["team", L("Team Map", "Peta Pasukan")],
        ["roles", L("Departments & Roles", "Jabatan & Peranan")],
        ["records", L("Staff Records", "Rekod Kakitangan")],
      ] as const} aside={!readOnly ? (
        <TabAside>
          <TabAction icon="add" onClick={() => setShowCreate(true)}>{L("Add staff", "Tambah kakitangan")}</TabAction>
        </TabAside>
      ) : undefined} />

      {/* ============================== OVERVIEW ============================== */}
      <TabZone label={L("Overview", "Gambaran")} className={tab !== "overview" ? sp.off : ""}>
        <KpiRow label={L("Staff summary", "Ringkasan kakitangan")}>
          <KpiTile icon="users" tone="navy" label={L("Staff records", "Rekod kakitangan")} value={staff.length} busy={!loaded}
            sub={L("Everyone on the staff list", "Semua dalam senarai kakitangan")}
            onClick={() => showDirectory("")} title={L("Open the directory", "Buka direktori")} />
          <KpiTile icon="success" tone="green" label={L("Active", "Aktif")} value={activeCount} busy={!loaded}
            sub={L(`${pctOf(activeCount, staff.length)}% of records${onLeaveToday ? ` · ${onLeaveToday} on leave today` : ""}`, `${pctOf(activeCount, staff.length)}% daripada rekod${onLeaveToday ? ` · ${onLeaveToday} bercuti hari ini` : ""}`)}
            onClick={() => showDirectory("", "active")} title={L("Show only active staff", "Tunjuk kakitangan aktif sahaja")} />
          <KpiTile icon="store" tone="blue" label={L("Departments", "Jabatan")} value={departments} busy={!loaded}
            sub={L("Named on the records", "Dinamakan pada rekod")}
            onClick={() => setTab("roles")} title={L("Open Departments & Roles", "Buka Jabatan & Peranan")} />
          <KpiTile icon="document" tone="gold" label={L("Roles written", "Peranan ditulis")} value={writtenCount} busy={!loaded}
            sub={L(`of ${activeCount} working`, `daripada ${activeCount} bekerja`)}
            onClick={() => setTab("roles")}
            title={L("Working staff whose roles and responsibilities are written", "Kakitangan bekerja yang peranan dan tanggungjawabnya telah ditulis")} />
        </KpiRow>

        <div className={sp.split}>
          <section className={card} aria-label={L("Department distribution", "Taburan jabatan")}>
            {head("store", sp.goldWell, L("Department Distribution", "Taburan Jabatan"), L("Staff records by department. Press one to list its people.", "Rekod kakitangan mengikut jabatan. Tekan satu untuk menyenaraikan orangnya."))}
            {!loaded ? <SkelRows rows={4} /> : staff.length === 0 ? <p className={sp.empty}>{L("No staff records yet.", "Belum ada rekod kakitangan.")}</p> : (
              <div className={sp.donutRow}>
                <Donut size={150} hideLegend centerLabel={String(staff.length)} centerSub={L("staff", "kakitangan")}
                  slices={byDept.map(([k, list], i) => ({ label: k || noDept, value: list.length, color: deptColor(i, k) }))} />
                <ul className={sp.legend}>
                  {byDept.map(([k, list], i) => (
                    <li key={k || NO_DEPT}>
                      <button type="button" onClick={() => showDirectory(k || NO_DEPT)}>
                        <span className={sp.dot} style={{ background: deptColor(i, k) }} aria-hidden />
                        <span>{k || noDept}</span>
                        <strong>{list.length}</strong>
                        <span className={sp.muted}>{pctOf(list.length, staff.length)}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className={card} aria-label={L("Staff status", "Status kakitangan")}>
            {head("chart", sp.blueWell, L("Staff Status", "Status Kakitangan"), L("Every record's status today, and the employment type of current staff.", "Status setiap rekod hari ini, dan jenis pekerjaan kakitangan semasa."))}
            {!loaded ? <SkelRows rows={4} /> : (
              <>
                <ul className={sp.bars}>
                  {stateCounts.map(([k, n]) => (
                    <li key={k}>
                      <button type="button" onClick={() => showDirectory("", k)}>
                        <span>{STATE_LABEL[k]}</span>
                        <span className={sp.track}><span className={`${sp.fill} ${k === "active" ? sp.fillGreen : k === "left" ? sp.fillRed : k === "starting" ? sp.fillBlue : sp.fillGrey}`} style={{ width: `${Math.max(n ? 3 : 0, pctOf(n, staff.length))}%` }} /></span>
                        <strong>{n}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className={sp.groupLabel}>{L("Employment type", "Jenis pekerjaan")}</p>
                <ul className={sp.bars}>
                  {typeCounts.map(([k, n]) => (
                    <li key={k || "unset"}>
                      <div>
                        <span>{employmentLabel(k)}</span>
                        <span className={sp.track}><span className={`${sp.fill} ${sp.fillBlue}`} style={{ width: `${Math.max(3, (n / maxType) * 100)}%` }} /></span>
                        <strong>{n}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <div className={sp.split}>
          <section className={card} aria-label={L("Records needing attention", "Rekod perlu perhatian")}>
            {head("warning", sp.redWell, L("Needs Attention", "Perlu Perhatian"), L("Gaps in the records, counted from what is on file.", "Jurang dalam rekod, dikira daripada apa yang ada dalam fail."))}
            {!loaded ? <SkelRows rows={3} /> : notWritten + noFullName + notOnChart === 0 ? (
              <p className={sp.empty}><AppIcon name="success" />{L("Nothing needs attention — every record has a full name, every working person has their role written and everyone is on the chart.", "Tiada yang perlu perhatian — setiap rekod mempunyai nama penuh, peranan setiap orang yang bekerja ditulis dan semua berada pada carta.")}</p>
            ) : (
              <ul className={sp.attn}>
                {notWritten > 0 && (
                  <li><button type="button" onClick={() => { setOnlyMissing(true); setTab("roles"); }}>
                    <span className={`${sp.well} ${sp.goldWell}`} aria-hidden><AppIcon name="document" /></span>
                    <span className={sp.attnText}><strong>{L("Roles not written yet", "Peranan belum ditulis")}</strong><span>{L("Working staff with no role title or responsibilities", "Kakitangan bekerja tanpa gelaran peranan atau tanggungjawab")}</span></span>
                    <span className={sp.attnNum}>{notWritten}</span>
                  </button></li>
                )}
                {noFullName > 0 && (
                  <li><button type="button" onClick={() => setTab("records")}>
                    <span className={`${sp.well} ${sp.redWell}`} aria-hidden><AppIcon name="identification" /></span>
                    <span className={sp.attnText}><strong>{L("No full name on file", "Tiada nama penuh dalam rekod")}</strong><span>{L("The payslip, badge and bank file fall back to the short name", "Slip gaji, lencana dan fail bank menggunakan nama pendek")}</span></span>
                    <span className={sp.attnNum}>{noFullName}</span>
                  </button></li>
                )}
                {notOnChart > 0 && (
                  <li><button type="button" onClick={() => setTab("org")}>
                    <span className={`${sp.well} ${sp.blueWell}`} aria-hidden><AppIcon name="users" /></span>
                    <span className={sp.attnText}><strong>{L("Not on the organisation chart", "Belum berada pada carta organisasi")}</strong><span>{L("Nobody has said who they report to", "Belum ditetapkan kepada siapa mereka melapor")}</span></span>
                    <span className={sp.attnNum}>{notOnChart}</span>
                  </button></li>
                )}
              </ul>
            )}
          </section>

          <section className={card} aria-label={L("Quick links", "Pautan pantas")}>
            {head("fast", sp.goldWell, L("Quick Links", "Pautan Pantas"))}
            <ul className={sp.links}>
              <li><button type="button" className={sp.link} onClick={() => showDirectory("")}>
                <span className={`${sp.well} ${sp.goldWell}`} aria-hidden><AppIcon name="users" /></span>
                <strong>{L("Staff Directory", "Direktori Kakitangan")}</strong><span>{L("Find anybody, print badges", "Cari sesiapa, cetak lencana")}</span>
              </button></li>
              <li><button type="button" className={sp.link} onClick={() => setTab("org")}>
                <span className={`${sp.well} ${sp.blueWell}`} aria-hidden><AppIcon name="chart" /></span>
                <strong>{L("Organisation", "Organisasi")}</strong><span>{L("Who reports to whom", "Siapa melapor kepada siapa")}</span>
              </button></li>
              <li><button type="button" className={sp.link} onClick={() => setTab("team")}>
                <span className={`${sp.well} ${sp.blueWell}`} aria-hidden><AppIcon name="place" /></span>
                <strong>{L("Team map", "Peta pasukan")}</strong><span>{L("The whole team and the next birthdays", "Seluruh pasukan dan hari lahir seterusnya")}</span>
              </button></li>
              <li><button type="button" className={sp.link} onClick={() => setTab("roles")}>
                <span className={`${sp.well} ${sp.goldWell}`} aria-hidden><AppIcon name="document" /></span>
                <strong>{L("Departments & Roles", "Jabatan & Peranan")}</strong><span>{L("Positions and written roles", "Jawatan dan peranan bertulis")}</span>
              </button></li>
              <li><button type="button" className={sp.link} onClick={() => setTab("records")}>
                <span className={`${sp.well} ${sp.greenWell}`} aria-hidden><AppIcon name="identification" /></span>
                <strong>{L("Staff Records", "Rekod Kakitangan")}</strong><span>{L("The full record of each person", "Rekod penuh setiap orang")}</span>
              </button></li>
              {!readOnly && (
                <li><button type="button" className={sp.link} onClick={() => setShowCreate(true)}>
                  <span className={`${sp.well} ${sp.greenWell}`} aria-hidden><AppIcon name="add" /></span>
                  <strong>{L("Add staff", "Tambah kakitangan")}</strong><span>{L("Create a staff account", "Cipta akaun kakitangan")}</span>
                </button></li>
              )}
            </ul>
          </section>
        </div>
      </TabZone>

      {/* =========================== STAFF DIRECTORY =========================== */}
      <TabZone label={L("Staff directory", "Direktori kakitangan")} className={tab !== "directory" ? sp.off : ""}>
        {/* v1.204.0 - on a wide screen the profile docks beside the list (the
            same profileBody the drawer draws), so the list stays in view */}
        <div className={`${sp.dirLayout} ${wide && peekU ? sp.dirLayoutOpen : ""}`}>
        <section className={card} aria-label={L("Staff directory", "Direktori kakitangan")}>
          {head("users", sp.goldWell, L("Staff Directory", "Direktori Kakitangan"),
            dirList.length === staff.length
              ? L(`${staff.length} staff records`, `${staff.length} rekod kakitangan`)
              : L(`${dirList.length} of ${staff.length} staff records`, `${dirList.length} daripada ${staff.length} rekod kakitangan`),
            <span className={sp.mode} role="group" aria-label={L("How to show the directory", "Cara memaparkan direktori")}>
              <button type="button" aria-pressed={layout === "table"} onClick={() => setLayout("table")}><AppIcon name="documents" />{L("List", "Senarai")}</button>
              <button type="button" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><AppIcon name="users" />{L("Grid", "Grid")}</button>
            </span>)}
          <div className={sp.toolbar}>
            <label className={sp.search}>
              <AppIcon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={L("Find staff", "Cari kakitangan")} aria-label={L("Find staff", "Cari kakitangan")} />
            </label>
            <select className={selectClassSm} value={deptF} onChange={(e) => setDeptF(e.target.value)} aria-label={L("Department", "Jabatan")}>
              <option value="">{L("All departments", "Semua jabatan")}</option>
              {byDept.map(([k]) => <option key={k || NO_DEPT} value={k || NO_DEPT}>{k || noDept}</option>)}
            </select>
            <select className={selectClassSm} value={stateF} onChange={(e) => setStateF(e.target.value as "" | StaffState)} aria-label={L("Status", "Status")}>
              <option value="">{L("All statuses", "Semua status")}</option>
              {stateCounts.map(([k]) => <option key={k} value={k}>{STATE_LABEL[k]}</option>)}
            </select>
            <select
              className={selectClassSm}
              value={sortBy}
              title={L("Sort staff records", "Susun rekod kakitangan")}
              aria-label={L("Sort staff records", "Susun rekod kakitangan")}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
            >
              <option value="rank">{L("Sort: Rank (default)", "Susun: Pangkat (lalai)")}</option>
              <option value="az">{L("Sort: Name A–Z", "Susun: Nama A–Z")}</option>
              <option value="za">{L("Sort: Name Z–A", "Susun: Nama Z–A")}</option>
              <option value="id">{L("Sort: Staff ID", "Susun: ID kakitangan")}</option>
              <option value="dept">{L("Sort: Department", "Susun: Jabatan")}</option>
            </select>
          </div>
          {/* v1.201.0 - the badge controls in one bar: the mode, what is
              ticked, and the print button the moment there is something to
              print (v1.94.0's rule). Select all ticks what is SHOWN, so a
              department filter is a quick way to print one team's badges. */}
          <div className={sp.selectBar}>
            <button
              type="button"
              className={selectMode ? btnSmPrimary : btnSm}
              aria-pressed={selectMode}
              onClick={() => { setSelectMode((m) => !m); if (selectMode) setSelected(new Set()); }}
            >
              <AppIcon name="print" />{selectMode ? L("Done selecting", "Selesai memilih") : L("Select for printing", "Pilih untuk cetakan")}
            </button>
            {selectMode && (
              <button
                type="button"
                className={btnSm}
                onClick={() => setSelected((prev) => {
                  const next = new Set(prev);
                  for (const u of dirList) { if (allShownTicked) next.delete(u.id); else next.add(u.id); }
                  return next;
                })}
              >
                {allShownTicked ? L("Clear selection", "Kosongkan pilihan") : L(`Select all shown (${dirList.length})`, `Pilih semua dipaparkan (${dirList.length})`)}
              </button>
            )}
            {selectMode && <span className={sp.selectCount}>{selected.size} {L("ticked", "ditanda")}</span>}
            {selected.size > 0 && (
              <button
                type="button"
                className={btnSmPrimary}
                onClick={() => printBadges(staff.filter((u) => selected.has(u.id)).map((u) => ({ ...u, ...draft[u.id] } as Staff)))}
              >
                {L("Print badges", "Cetak lencana")} ({selected.size}) — {L("up to 9 per A4", "sehingga 9 setiap A4")}
              </button>
            )}
            <span className={sp.hint}>
              {selectMode
                ? L("Press a person to tick them.", "Tekan seseorang untuk menandanya.")
                : L("Press a person to open their profile.", "Tekan seseorang untuk buka profilnya.")}
            </span>
          </div>

          {loadError && <p className={sp.warnText}><AppIcon name="warning" />{loadError}</p>}

          {layout === "table" ? (
            <div className={`erp-table-scroll ${sp.tableWrap}`}>
              <table className={sp.table} aria-label={L("Staff directory", "Direktori kakitangan")}>
                <thead><tr>
                  {selectMode && <th className={sp.checkCell}><span className={sp.srOnly}>{L("Ticked", "Ditanda")}</span></th>}
                  <th>{L("Staff", "Kakitangan")}</th>
                  <th>{L("Staff ID", "ID kakitangan")}</th>
                  <th>{L("Position", "Jawatan")}</th>
                  <th>{L("Department", "Jabatan")}</th>
                  <th>{L("Status", "Status")}</th>
                  <th><span className={sp.srOnly}>{L("Actions", "Tindakan")}</span></th>
                </tr></thead>
                <tbody>
                  {!loaded && skelRows(5, selectMode ? 7 : 6)}
                  {loaded && dirList.length === 0 && (
                    <tr><td colSpan={selectMode ? 7 : 6}><p className={sp.empty}><AppIcon name="search" />{query || deptF || stateF ? L("No staff matches that search.", "Tiada kakitangan sepadan dengan carian itu.") : L("No staff records yet.", "Belum ada rekod kakitangan.")}</p></td></tr>
                  )}
                  {loaded && dirList.map((u) => (
                    <tr key={u.id} className={`${selected.has(u.id) ? sp.rowOn : ""} ${isGone(u) ? sp.rowGone : ""}`}>
                      {selectMode && (
                        <td className={sp.checkCell}>
                          <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)}
                            aria-label={L(`Tick ${displayName(u)} for badge printing`, `Tanda ${displayName(u)} untuk cetakan lencana`)} />
                        </td>
                      )}
                      <td className={sp.personCell}>{personBtn(u, roleLabel(u.role))}</td>
                      <td className={sp.mono} data-label={L("Staff ID", "ID kakitangan")}>{u.employee_id || <span className={sp.muted}>—</span>}</td>
                      <td data-label={L("Position", "Jawatan")}>{u.position || <span className={sp.muted}>—</span>}</td>
                      <td data-label={L("Department", "Jabatan")}>{deptName(u) || <span className={sp.muted}>—</span>}</td>
                      <td data-label={L("Status", "Status")}>{stateChip(u)}</td>
                      <td className={sp.actCell}>
                        <span>
                          <button type="button" className={rowBtn} onClick={() => setPeek(u.id)}>{L("Profile", "Profil")}</button>
                          <button type="button" className={rowBtn} onClick={() => openRecord(u.id)}>{L("Record", "Rekod")}</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className={sp.grid} aria-label={L("Staff directory", "Direktori kakitangan")}>
              {!loaded && Array.from({ length: 6 }, (_, i) => (
                <li key={`sk-${i}`} aria-hidden><span className={sp.tile}><Skel className="h-11 w-11 rounded-full" /><Skel className="h-3 w-24" /><Skel className="h-2.5 w-16" /></span></li>
              ))}
              {loaded && dirList.length === 0 && <li><p className={sp.empty}><AppIcon name="search" />{L("No staff matches that search.", "Tiada kakitangan sepadan dengan carian itu.")}</p></li>}
              {loaded && dirList.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => press(u)} aria-pressed={selectMode ? selected.has(u.id) : undefined}
                    className={`${sp.tile} ${selected.has(u.id) ? sp.tileOn : ""} ${isGone(u) ? sp.tileGone : ""}`}>
                    {selectMode && <span className={`${sp.tick} ${selected.has(u.id) ? sp.tickOn : ""}`} aria-hidden>{selected.has(u.id) ? "✓" : ""}</span>}
                    <Avatar name={displayName(u)} photoKey={u.photo_key} size="lg" />
                    <strong>{displayName(u)}</strong>
                    <span>{u.position || roleLabel(u.role)}</span>
                    <span>{[deptName(u), u.employee_id].filter(Boolean).join(" · ") || "—"}</span>
                    <span>{stateChip(u)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {wide && peekU && (
          <aside className={`${card} ${sp.docked}`} aria-label={L(`Profile of ${displayName(peekU)}`, `Profil ${displayName(peekU)}`)}>
            {profileBody(peekU)}
            <div className={sp.dockedFoot}>{profileFooter(peekU)}</div>
          </aside>
        )}
        </div>

        {/* v1.204.0 - the departments at a glance, from the same records;
            pressing one filters the list above */}
        {loaded && byDept.length > 0 && (
          <section className={card} aria-label={L("Departments", "Jabatan")}>
            {head("folder", sp.blueWell, L("Departments", "Jabatan"), L("Press a department to show only its people.", "Tekan jabatan untuk tunjuk orangnya sahaja."))}
            <ul className={sp.deptCards}>
              {byDept.map(([k, people], i) => {
                const here = people.filter((u) => !isGone(u));
                return (
                  <li key={k || NO_DEPT}>
                    <button type="button" className={sp.deptCard} aria-pressed={deptF === (k || NO_DEPT)}
                      onClick={() => { setDeptF(deptF === (k || NO_DEPT) ? "" : k || NO_DEPT); setQuery(""); }}>
                      <span className={sp.deptDot} style={{ background: deptColor(i, k) }} aria-hidden />
                      <strong>{k || noDept}</strong>
                      <span className={sp.deptCount}>{here.length} {L("working", "bekerja")}{people.length > here.length ? ` · ${people.length - here.length} ${L("left", "keluar")}` : ""}</span>
                      <span className={sp.faces} aria-hidden>
                        {here.slice(0, 5).map((u) => <Avatar key={u.id} name={displayName(u)} photoKey={u.photo_key} size="sm" />)}
                        {here.length > 5 && <span className={sp.more}>+{here.length - 5}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </TabZone>

      {/* ============================== ORGANISATION ============================== */}
      <TabZone label={L("Organisation chart", "Carta organisasi")} className={tab !== "org" ? sp.off : ""}>
        {/* v1.239.0 - the full reporting-line card moved here from the
            Dashboard (which keeps one line); the chart is right below it */}
        <ReportingLineCard canOpenOrg={false} openOrg={() => setTab("org")} />
        <section className={card} aria-label={L("Organisation", "Organisasi")}>
          {head("chart", sp.blueWell, L("Organisation", "Organisasi"),
            L("Who answers to whom. Each box is a person — press one to open their profile; the stripe is the division (CEO, COO or CCO) and the number is how many sit below.", "Siapa melapor kepada siapa. Setiap kotak ialah seorang — tekan untuk buka profilnya; jalur ialah bahagian (CEO, COO atau CCO) dan nombor ialah bilangan di bawahnya."))}
        </section>
        <OrgChart
          people={staff}
          loaded={loaded}
          canAssign={canAssign && !readOnly}
          saving={orgSaving}
          onAssign={(personId, managerId) => { void assignReportsTo(personId, managerId); }}
          onOpen={(p) => { const u = staff.find((x) => x.id === p.id); if (u) press(u); }}
        />
        <section className={card} aria-label={L("Who reports to whom", "Siapa melapor kepada siapa")}>
          {head("users", sp.goldWell, L("Who Reports to Whom", "Siapa Melapor kepada Siapa"),
            L("Each manager and the people who answer to them directly — the same lines as the chart, readable on a phone.", "Setiap pengurus dan orang yang melapor terus kepadanya — garis yang sama seperti carta, mudah dibaca di telefon."))}
          {!loaded ? <SkelRows rows={3} /> : managers.length === 0 ? (
            <p className={sp.empty}><AppIcon name="info" />{L("No reporting lines are set yet.", "Belum ada garis pelaporan ditetapkan.")}</p>
          ) : (
            <ul className={sp.lines}>
              {managers.map((m) => (
                <li key={m.id}>
                  {personBtn(m, [m.position || roleLabel(m.role), deptName(m)].filter(Boolean).join(" · "))}
                  <span className={sp.reports}>
                    <span className={sp.arrow}>{L(`${reportsOf(m).length} direct`, `${reportsOf(m).length} terus`)} ←</span>
                    {reportsOf(m).map((r) => (
                      <button key={r.id} type="button" className={sp.pill} onClick={() => press(r)} title={[r.position || roleLabel(r.role), deptName(r)].filter(Boolean).join(" · ")}>
                        <Avatar name={displayName(r)} photoKey={r.photo_key} size="sm" />{givenNames(displayName(r))}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </TabZone>

      {/* ================================ TEAM MAP ================================ */}
      <TabZone label={L("Team map", "Peta pasukan")} className={tab !== "team" ? sp.off : ""}>
        <section className={card} aria-label={L("Team Map", "Peta Pasukan")}>
          {head("place", sp.goldWell, L("Team Map", "Peta Pasukan"),
            L("The whole team in company order, the CEO at the centre. Press a face to open the profile.", "Seluruh pasukan mengikut susunan syarikat, CEO di tengah. Tekan wajah untuk buka profil."))}
          {selectMode && (
            <p className={sp.warnText}><AppIcon name="print" />{L(`Selecting for badge printing — press a face to tick it. ${selected.size} ticked; print from the Directory.`, `Memilih untuk cetakan lencana — tekan wajah untuk menandanya. ${selected.size} ditanda; cetak dari Direktori.`)}</p>
          )}
        </section>
        <div className="erp-stack-tight">
      {view === "circle" && (() => {
        const ordered = ranked;
        const cakeFor = (u: Staff) => {
          const b = birthdayInfo(u.birthday, todayS);
          return b && b.days <= 14 && !isGone(u) ? b : null;
        };
        /* v1.201.0 - `press` is the page's own now: a face opens the
           profile drawer, or ticks it while selecting for printing. */
        const gone = isGone;
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
                        className={`pointer-events-none absolute top-1/2 left-1/2 h-px origin-left transition-colors ${focus?.id === p.u.id || peek === p.u.id ? "bg-primary/50" : "bg-primary/12"}`}
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
                <div key={u.id} className={`absolute -translate-x-1/2 -translate-y-1/2 ${peek === u.id || focus?.id === u.id ? "z-20" : ring === 0 ? "z-10" : "z-[1]"}`}
                  style={{ left: `${left}%`, top: `${top}%` }}>
                  <StaffBubble u={u} open={peek === u.id} selectMode={selectMode} selected={selected.has(u.id)} delayMs={i * 45}
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
              const who = focus ?? ordered.find((u) => peek === u.id) ?? null;
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
                            <AppIcon name="cake" className="mr-1 -mt-0.5 h-3 w-3" />{cakeFor(who)!.days === 0 ? L("today", "hari ini") : `${cakeFor(who)!.days} ${L("day(s)", "hari")}`}
                          </span>
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {L("Hover a face to see who it is · press to open the profile. Clockwise from the top in company order, CEO at the centre.",
                         "Tuding pada wajah untuk melihat namanya · tekan untuk buka profil. Ikut jam dari atas mengikut susunan syarikat, CEO di tengah.")}
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
                <StaffBubble key={u.id} u={u} open={peek === u.id} selectMode={selectMode} selected={selected.has(u.id)} delayMs={i * 35}
                  cake={cakeFor(u)} faded={gone(u)} onPress={() => press(u)} />
              ))}
            </div>
            {loaded && upcoming.length > 0 && (
              /* v1.99.1 — one chip per birthday, pressable, instead of a
                 dotted-underline sentence. */
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5"><AppIcon name="cake" className="h-3.5 w-3.5" />{L("Next birthdays", "Hari lahir seterusnya")}</span>
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
        </div>
      </TabZone>

      {/* ========================== DEPARTMENTS & ROLES ========================== */}
      <TabZone label={L("Departments and roles", "Jabatan dan peranan")} className={tab !== "roles" ? sp.off : ""}>
        <section className={card} aria-label={L("Roles and responsibilities written", "Peranan dan tanggungjawab ditulis")}>
          {head("document", sp.goldWell, L("Roles & Responsibilities Written", "Peranan & Tanggungjawab Ditulis"),
            L("Working staff whose role title or responsibilities are on their record. Written on Staff Records; each person reads theirs on their Profile.", "Kakitangan bekerja yang gelaran peranan atau tanggungjawabnya ada pada rekod. Ditulis di Rekod Kakitangan; setiap orang membacanya di Profil mereka."),
            <span className={sp.bigPct}>{loaded ? `${pctOf(writtenCount, activeCount)}%` : "—"}</span>)}
          <div className={sp.progressRow}>
            <span className={sp.track} role="img" aria-label={L(`${writtenCount} of ${activeCount} written`, `${writtenCount} daripada ${activeCount} ditulis`)}>
              <span className={`${sp.fill} ${writtenCount >= activeCount && activeCount > 0 ? sp.fillGreen : ""}`} style={{ width: `${pctOf(writtenCount, activeCount)}%` }} />
            </span>
            <span className={sp.hint}>{L(`${writtenCount} of ${activeCount} working staff · ${byDept.filter(([k]) => k).length} departments · ${new Set(staff.map((u) => (u.position ?? "").trim()).filter(Boolean)).size} positions`, `${writtenCount} daripada ${activeCount} kakitangan bekerja · ${byDept.filter(([k]) => k).length} jabatan · ${new Set(staff.map((u) => (u.position ?? "").trim()).filter(Boolean)).size} jawatan`)}</span>
          </div>
          <div className={sp.toolbar}>
            <span className={sp.mode} role="group" aria-label={L("Which staff to show", "Kakitangan mana untuk dipaparkan")}>
              <button type="button" aria-pressed={!onlyMissing} onClick={() => setOnlyMissing(false)}>{L("Everyone", "Semua")}</button>
              <button type="button" aria-pressed={onlyMissing} onClick={() => setOnlyMissing(true)}>{L(`Not written yet (${notWritten})`, `Belum ditulis (${notWritten})`)}</button>
            </span>
          </div>
        </section>
        {!loaded && <section className={card}><SkelRows rows={4} /></section>}
        {loaded && onlyMissing && notWritten === 0 && (
          <section className={card}><p className={sp.empty}><AppIcon name="success" />{L("Every working person has their role written.", "Peranan setiap orang yang bekerja telah ditulis.")}</p></section>
        )}
        {loaded && byDept.map(([k, list]) => {
          const rows = onlyMissing ? list.filter((u) => isHead(u) && !writtenOf(u)) : list;
          if (rows.length === 0) return null;
          const working = list.filter(isHead);
          const done = working.filter(writtenOf).length;
          return (
            <section key={k || NO_DEPT} className={card} aria-label={k || noDept}>
              {head("store", k ? sp.blueWell : sp.redWell, k || noDept,
                working.length === 0
                  ? L(`${list.length} staff · nobody working here now`, `${list.length} kakitangan · tiada yang bekerja di sini sekarang`)
                  : L(`${list.length} staff · ${done} of ${working.length} working staff written`, `${list.length} kakitangan · ${done} daripada ${working.length} kakitangan bekerja ditulis`),
                <button type="button" className={btnSm} onClick={() => showDirectory(k || NO_DEPT)}>{L("In the directory", "Dalam direktori")}</button>)}
              <div className={`erp-table-scroll ${sp.tableWrap}`}>
                <table className={sp.table} aria-label={k || noDept}>
                  <thead><tr>
                    <th>{L("Staff", "Kakitangan")}</th>
                    <th>{L("Position", "Jawatan")}</th>
                    <th>{L("Role title", "Gelaran peranan")}</th>
                    <th>{L("Responsibilities", "Tanggungjawab")}</th>
                    <th>{L("Last written", "Terakhir ditulis")}</th>
                    <th><span className={sp.srOnly}>{L("Actions", "Tindakan")}</span></th>
                  </tr></thead>
                  <tbody>
                    {rows.map((u) => {
                      const lines = responsibilityLines(u.responsibilities).length;
                      return (
                        <tr key={u.id} className={isGone(u) ? sp.rowGone : ""}>
                          <td className={sp.personCell}>{personBtn(u, u.employee_id || roleLabel(u.role))}</td>
                          <td data-label={L("Position", "Jawatan")}>{u.position || <span className={sp.muted}>—</span>}</td>
                          <td data-label={L("Role title", "Gelaran peranan")}>{u.role_title?.trim() || <span className={sp.muted}>—</span>}</td>
                          <td data-label={L("Responsibilities", "Tanggungjawab")}>
                            {lines > 0 ? <span className={chipSuccess}>{L(`${lines} written`, `${lines} ditulis`)}</span>
                              : writtenOf(u) ? <span className={chipInfo}>{L("Title only", "Gelaran sahaja")}</span>
                              : isHead(u) ? <span className={chipWarn}>{L("Not written", "Belum ditulis")}</span>
                              : <span className={chipNeutral}>{STATE_LABEL[stateOf(u)]}</span>}
                          </td>
                          <td data-label={L("Last written", "Terakhir ditulis")} className={sp.mono}>
                            {u.responsibilities_updated_at
                              ? `${dmy(u.responsibilities_updated_at.slice(0, 10))}${u.responsibilities_updated_by_name ? ` · ${properName(u.responsibilities_updated_by_name)}` : ""}`
                              : <span className={sp.muted}>—</span>}
                          </td>
                          <td className={sp.actCell}>
                            <span>
                              <button type="button" className={rowBtn} onClick={() => setPeek(u.id)}>{L("Read", "Baca")}</button>
                              {canEditResponsibilities && Boolean(u.is_active) && !isGone(u) && (
                                <button type="button" className={rowBtn} onClick={() => openRecord(u.id)}>{L("Write", "Tulis")}</button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </TabZone>

      {/* ============================= STAFF RECORDS ============================= */}
      <TabZone label={L("Staff records", "Rekod kakitangan")} className={tab !== "records" ? sp.off : ""}>
      <div className={sp.recordsSplit}>
        <section className={card} aria-label={L("Choose a record", "Pilih rekod")}>
          {head("identification", sp.goldWell, L("Staff Records", "Rekod Kakitangan"), L("Choose a person to open their full record.", "Pilih seseorang untuk buka rekod penuhnya."))}
          <div className={sp.toolbar}>
            <label className={sp.search}>
              <AppIcon name="search" />
              <input value={recQuery} onChange={(e) => setRecQuery(e.target.value)}
                placeholder={L("Find a record", "Cari rekod")} aria-label={L("Find a record", "Cari rekod")} />
            </label>
          </div>
          <ul className={sp.picker}>
            {!loaded && Array.from({ length: 5 }, (_, i) => (
              <li key={`sk-${i}`} aria-hidden><span className={sp.pick}><Skel className="h-9 w-9 rounded-full" /><Skel className="h-3 w-32" /><Skel className="h-3 w-8" /></span></li>
            ))}
            {loaded && recList.length === 0 && <li><p className={sp.empty}>{L("No record matches that search.", "Tiada rekod sepadan dengan carian itu.")}</p></li>}
            {loaded && recList.map((u) => (
              <li key={u.id}>
                <button type="button" className={sp.pick} aria-pressed={open.has(u.id)}
                  onClick={() => {
                    setOpen(open.has(u.id) ? new Set() : new Set([u.id]));
                    if (!open.has(u.id)) window.setTimeout(() => { if (window.innerWidth < 1100) recRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, 60);
                  }}>
                  <Avatar name={displayName(u)} photoKey={u.photo_key} size="md" />
                  <span className={sp.personText}>
                    <strong>{displayName(u)}</strong>
                    <span>{[u.employee_id, u.position].filter(Boolean).join(" · ") || roleLabel(u.role)}</span>
                  </span>
                  <span className={sp.filled} title={L("Fields filled on the record", "Medan yang diisi pada rekod")}>{filledOf(u)}/{RECORD_FIELDS.length}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className={sp.note}>
            <AppIcon name="lock" />
            {readOnly
              ? L("You can read these records. HR fills them in; once a field is saved, only the CEO or an admin can change it.", "Anda boleh membaca rekod ini. HR mengisinya; setelah medan disimpan, hanya CEO atau admin boleh mengubahnya.")
              : canAmend
                ? L("You can change any field, including a saved one. HR fills empty fields; a saved field locks for them.", "Anda boleh mengubah mana-mana medan, termasuk yang telah disimpan. HR mengisi medan kosong; medan yang disimpan dikunci bagi mereka.")
                : L("You can fill an empty field. Once saved it locks, and only the CEO or an admin can change it.", "Anda boleh mengisi medan kosong. Setelah disimpan ia dikunci, dan hanya CEO atau admin boleh mengubahnya.")}
          </p>
        </section>
        <div className={sp.recordCol} ref={recRef}>
          {loaded && open.size === 0 && (
            <section className={card}>
              <p className={sp.empty}><AppIcon name="identification" />{L("Choose someone on the left to open their record — personal details, employment, bank and statutory numbers, roles, documents and the ID badge.", "Pilih seseorang di sebelah kiri untuk buka rekodnya — butiran peribadi, pekerjaan, nombor bank dan statutori, peranan, dokumen dan lencana ID.")}</p>
            </section>
          )}
      {ranked.map((u) => {
        const merged = { ...u, ...draft[u.id] } as Staff;
        /* v1.92.0 — a closed record is its circle above; only an open one
           draws the card. */
        if (!open.has(u.id)) return null;
        return (
          <div key={u.id} className={card}>
            {/* v1.176.1 - THE ROW CONTRACT, ON A RECORD HEADER. The owner's
                phone, 22-09-2026: the role beside his name came out as "c / e
                / o", one letter per line. This inner span was `flex
                items-center` with no wrap and no `min-width: 0`, so on a
                390px screen it was squeezed under its own content and every
                child fell back to its MINIMUM contribution - which for a bare
                word is one character. Same rule as v1.174.3: the words are
                `.erp-row-lead` (shrinkable, wrapping), the controls are
                `.erp-row-actions`. */}
            <div className="erp-flex erp-flex-wrap erp-flex-between erp-gap-2">
              <span className="erp-flex erp-flex-wrap erp-row-lead text-sm font-medium">
                {selectMode && (
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
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
                  <span className="ml-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning"
                    title={L(
                      "No full name on file — the payslip, claim form, leave form, ID badge and the Maybank2E salary file all fall back to the short name, and a bank can reject a transfer whose name does not match the account",
                      "Tiada nama penuh dalam rekod — slip gaji, borang tuntutan, borang cuti, lencana ID dan fail gaji Maybank2E semuanya kembali kepada nama pendek, dan bank boleh menolak pindahan yang namanya tidak sepadan dengan akaun",
                    )}>
                    <AppIcon name="warning" className="mr-1 -mt-0.5 h-3 w-3" />{L("no full name", "tiada nama penuh")}
                  </span>
                )}
                {["resigned", "terminated"].includes(u.employment_status ?? "") && (
                  <span className="ml-1.5 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger capitalize">
                    {L(u.employment_status ?? "", STATUS_MS[u.employment_status ?? ""] ?? (u.employment_status ?? ""))}{u.left_on ? ` · ${dmy(u.left_on)}` : ""}
                  </span>
                )}
                {u.rejoined_on && !["resigned", "terminated"].includes(u.employment_status ?? "") && (
                  <span className="ml-1.5 rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
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
                      <AppIcon name="cake" className="mr-1 -mt-0.5 h-3 w-3" />{b.next} · {b.days === 0 ? L(`turns ${b.turns} today`, `genap ${b.turns} hari ini`) : `${L("turns", "genap")} ${b.turns} ${L("in", "dalam")} ${b.days} ${L("day(s)", "hari")}`}
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
              <span className="erp-row-actions">
                {saved === u.id && <span className="text-xs font-medium text-success">{L("Saved ✓","Disimpan ✓")}</span>}
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
                    onClick={() => setOffboard({ id: u.id, name: displayName(u) })}>
                    <AppIcon name="offboard" className="mr-1 -mt-0.5 h-3.5 w-3.5" />{L("Offboard", "Tamatkan khidmat")}
                  </button>
                )}
                {open.has(u.id) && !readOnly && (
                <label className={`${btn} border-border cursor-pointer border hover:bg-secondary`}>
                  {u.photo_key ? (canAmend ? L("Replace photo", "Ganti foto") : L("Photo set (locked)", "Foto ditetapkan (dikunci)")) : L("Upload photo", "Muat naik foto")}
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
            <p className="text-muted-foreground mt-3 mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"><AppIcon name={sec.icon} className="h-3.5 w-3.5" />{L(sec.title, SECTION_TITLE_MS[sec.title] ?? sec.title)}</p>
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
              {sec.title === "Employment" && canSetRole && (
                <label className="block">
                  <span className="text-muted-foreground mb-0.5 block text-[11px]">
                    {L("Role (portal access)", "Peranan (akses portal)")}
                    {!WORKING_ROLES.includes(u.role) && <span className="ml-1">🔒</span>}
                  </span>
                  <select
                    className={input}
                    value={u.role}
                    disabled={!WORKING_ROLES.includes(u.role)}
                    title={WORKING_ROLES.includes(u.role)
                      ? L("Which tabs they see and which register measures them — recorded with your name", "Tab yang mereka lihat dan daftar yang mengukur mereka — direkodkan dengan nama anda")
                      : L("Executive roles are set by the system administrator", "Peranan eksekutif ditetapkan oleh pentadbir sistem")}
                    onChange={(e) => void changeRole(u, e.target.value)}
                  >
                    {WORKING_ROLES.includes(u.role)
                      ? WORKING_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)
                      : <option value={u.role}>{roleLabel(u.role)}</option>}
                  </select>
                </label>
              )}
            </div>
            </div>
            ))}
            {/* v1.174.0 - what this person is answerable for. Working staff
                only (the CEO: "staff that currently working for me"); a
                leaver's text stays readable if it was written. */}
            {open.has(u.id) && (u.is_active || u.role_title || u.responsibilities) && (
              <ResponsibilitiesBlock userId={u.id} personName={displayName(u)}
                value={{ role_title: u.role_title, responsibilities: u.responsibilities, responsibilities_updated_at: u.responsibilities_updated_at, responsibilities_updated_by_name: u.responsibilities_updated_by_name }}
                canEdit={canEditResponsibilities && Boolean(u.is_active)}
                onSaved={(next) => {
                  /* the saved record shows at once; the cached view refetches behind it */
                  const merge = (list: Staff[]) => list.map((x) => (x.id === u.id ? { ...x, ...next } : x));
                  setStaff(merge); setAllStaff(merge); void load();
                }} />
            )}
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
      </TabZone>

      {/* v1.201.0 - THE PROFILE DRAWER; v1.204.0 - sectioned, and docked
          beside the Directory on a wide screen instead of covering it */}
      <SideDrawer
        open={peekU !== null && !(wide && tab === "directory")}
        onClose={() => setPeek(null)}
        title={peekU ? displayName(peekU) : ""}
        subtitle={peekU ? [peekU.position || roleLabel(peekU.role), deptName(peekU)].filter(Boolean).join(" · ") : undefined}
        wide
        footer={peekU ? profileFooter(peekU) : undefined}
      >
        {peekU && profileBody(peekU)}
      </SideDrawer>

      {/* v1.201.0 - Add staff opens here, from the button on the tab row, on
          every tab. The form, its checks and its create call are v1.4.101's,
          unchanged. */}
      <SideDrawer
        open={!readOnly && showCreate}
        onClose={() => setShowCreate(false)}
        title={L("Add a staff member", "Tambah kakitangan")}
        wide
      >
      {!readOnly && (
      <div>
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
        {createMsg && <p className={`mt-2 text-xs font-medium ${createMsg.ok ?"text-success" :"text-destructive"}`}>{createMsg.text}</p>}
        {existing && (
          <button
            type="button"
            className={`${btnSm} mt-2`}
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
      </SideDrawer>
    </>
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
      <p className="flex items-center gap-1.5 text-xs font-semibold"><AppIcon name="folder" className="h-3.5 w-3.5" />{L("Documents & onboarding", "Dokumen & onboarding")} — {name}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className={selectClassSm} value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-secondary"
          onClick={() => fileRef.current?.click()}><AppIcon name="upload" className="mr-1 -mt-0.5 h-3.5 w-3.5" />{L("Upload document", "Muat naik dokumen")}</button>
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
