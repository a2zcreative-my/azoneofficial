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
import { btnSm, btnSmPrimary, card, chipDanger, chipInfo, chipNeutral, chipSuccess, chipWarn, chipSmWarn, chipSmSuccess, inputClass, selectClassSm } from "@/lib/ui-styles";
import { TabZone } from "@/components/portal/tab-concept";
import { ResponsibilitiesBlock, ResponsibilitiesView, responsibilityLines } from "@/components/staff/responsibilities"; // v1.174.0
import { Skel, SkelRows } from "@/components/ui/skeleton";
import { rowBtn, rowBtnDanger } from "@/components/ui/row-button";
/* v1.77.0 — useConfirm is gone from this file: offboarding was its only user
   and it now asks for a date, which the prompt dialog does. The friction is
   not lost — you cannot offboard without choosing a date and pressing a red
   button. */
import { usePrompt } from "@/components/ui/prompt-dialog";
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
import { withStepUp } from "@/components/portal/page-shared"; // v1.358.0 - an own role needs the code
/* v1.124.0 — the paper palette has one owner (lib/doc-theme.ts). This
   document is written into a separate window/iframe that cannot see the
   app stylesheet, so it needs literal hex, not var(--doc-*). */
import { DOC } from "@/lib/doc-theme";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";
/* v1.201.0 - the five-tab page: the shared tab row, tiles, donut, avatar and
   drawer, and this page's own module (no new utility classes). */
import { LineTabs, TabAction, TabAside } from "@/components/ui/line-tabs";
import { PillSwitch } from "@/components/ui/panel"; // v1.325.0 - D-2
import { FillPanel } from "@/components/ui/fill-panel"; // v1.325.0 - D-4
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Donut } from "@/components/ui/donut";
import { Avatar } from "@/components/ui/avatar";
import { SideDrawer } from "@/components/ui/side-drawer";
import sp from "./staff-page.module.css";
import { useTabViewAddress } from "@/lib/tab-view"; // v1.308.0 - the view in the address
import { ViewSwitch } from "@/components/portal/executive-cards";
import { TeamMap } from "@/components/staff/team-map"; // v1.308.0 - Team Map to reference 04
/* v1.204.0 - the profile's links into the modules that own their records */
import type { TabName } from "@/lib/portal-tabs";
import { useRecordFocus, type RecordFocus } from "@/lib/record-focus";
import { leaveTypeL } from "@/components/portal/page-shared";
import { OffboardSheet, type OffboardPerson } from "@/components/staff/offboard-sheet";
/* v1.322.0 - the positions list (the CEO, 16-11-2026): the picker on the record, the card on Departments & Roles */
import { POSITIONS_DATALIST, PositionHint, PositionsCard, PositionsDatalist, usePositions } from "@/components/staff/positions";
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
  /** v1.308.0 (Staff 4.0, S-1) - which private fields are filled; the values
      come from GET /staff/users/:id/private, for the HR tier and the CEO */
  private_set?: string[];
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
/* v1.308.0 - STAFF WORKSPACE 4.0 (reference 06): the same 22 fields, in the
   reference's sections - Emergency Contact is its own section now. `key` is
   the section tab; the field list is still the record. */
type RecordSectionKey = "personal" | "employment" | "role" | "bank" | "documents" | "emergency";
const RECORD_SECTIONS: { key: RecordSectionKey; title: string; icon: AppIconName; fields: [keyof Staff, string][] }[] = [
  {
    key: "personal",
    title: "Personal",
    icon: "person",
    fields: [
      ["full_name", "Full name (as per IC)"],
      ["ic_number", "IC number (NRIC)"],
      ["birthday", "Birth date"],
      ["blood_type", "Blood type (not on badge)"],
      ["phone", "Phone number"],
      ["address", "Home address"],
    ],
  },
  {
    key: "employment",
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
    key: "bank",
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
  {
    key: "emergency",
    title: "Emergency contact",
    icon: "person",
    fields: [
      ["emergency_name", "Emergency contact — name"],
      ["emergency_phone", "Emergency contact — phone"],
      ["emergency_relation", "Emergency contact — relationship"],
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

/* v1.201.0 - the page's five tabs, and the three states a record can be in:
   working (is_active), an account switched off, or a leaver (resigned or
   terminated - the Staff tab is the one place they are still listed). */
type StaffTab = "overview" | "directory" | "org" | "team" | "roles" | "records";
const STAFF_TABS: readonly StaffTab[] = ["overview", "directory", "org", "team", "roles", "records"];
const isStaffTab = (v: string | null): v is StaffTab => !!v && (STAFF_TABS as readonly string[]).includes(v);
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
const NO_TYPE = "__none";
/* v1.308.0 (S-12) - the change history's words */
const HISTORY_LABEL: Record<string, [string, string]> = {
  "staff.hr_update": ["Record updated", "Rekod dikemas kini"], "staff.create": ["Record created", "Rekod dicipta"],
  "staff.photo": ["Photo changed", "Foto ditukar"], "staff.reports_to": ["Reporting line changed", "Garis pelaporan ditukar"],
  "staff.responsibilities_update": ["Role and responsibilities written", "Peranan dan tanggungjawab ditulis"],
  "staff.role_change": ["System role changed", "Peranan sistem ditukar"], "staff.offboard": ["Offboarded", "Khidmat ditamatkan"],
  "staff.document_upload": ["Document uploaded", "Dokumen dimuat naik"], "staff.profile_update": ["Profile updated by the person", "Profil dikemas kini oleh orang itu"],
  "staff.onboarding": ["Joining checklist updated", "Senarai semak kemasukan dikemas kini"], "staff.probation_set": ["Probation review set", "Semakan percubaan ditetapkan"],
  "staff.probation_decide": ["Probation decided", "Percubaan diputuskan"], "staff.letter_issue": ["Letter issued", "Surat dikeluarkan"],
};
const FIELD_LABEL_EN: Record<string, string> = Object.fromEntries(RECORD_FIELDS.map(([k, l]) => [k as string, l]));
function historyLine(action: string, d: Record<string, unknown> | null): string {
  if (!d) return "";
  if (action === "staff.hr_update") {
    const ch = (d.changes ?? {}) as Record<string, [string | null, string]>;
    const parts = Object.entries(ch).map(([k, [a, b]]) => `${FIELD_LABEL_EN[k] ?? k}: ${a || "—"} → ${b || "—"}`);
    const others = ((d.fields ?? []) as string[]).filter((k) => !(k in ch)).map((k) => FIELD_LABEL_EN[k] ?? k);
    return [...parts, ...(others.length ? [`${others.join(", ")}`] : [])].join(" · ");
  }
  if (action === "staff.reports_to") return [`${String(d.from_name ?? "—")} → ${String(d.to_name ?? "—")}`, d.effective_on ? L(`from ${String(d.effective_on)}`, `dari ${String(d.effective_on)}`) : "", d.reason ? `"${String(d.reason)}"` : ""].filter(Boolean).join(" · ");
  if (action === "staff.role_change") return `${String(d.from ?? d.before ?? "")} → ${String(d.to ?? d.after ?? "")}`.replace(/_/g, " ");
  if (action === "staff.document_upload") return String(d.filename ?? d.kind ?? "");
  return "";
}
/** v1.308.0 (S-1) - an NRIC shown masked: only the last four digits */
const maskIc = (ic: string) => { const d = ic.replace(/\D/g, ""); return d.length >= 4 ? `******-**-${d.slice(-4)}` : "••••"; };
/* v1.308.0 (S-1) - the private block (worker STAFF_PRIVATE_FIELDS) */
const PRIVATE_KEYS = ["ic_number", "bank_name", "bank_account", "epf_no", "socso_no", "tax_no", "address", "emergency_name", "emergency_phone", "emergency_relation", "blood_type"] as const;
/* v1.308.0 (S-5) - the twelve fields a working record needs */
const REQUIRED_FIELDS = ["full_name", "ic_number", "birthday", "phone", "employee_id", "position", "department", "joined_on", "bank_name", "bank_account", "emergency_name", "emergency_phone"] as const;
/* v1.308.0 (S-4) - the employment status vocabulary, in the order shown */
type StatusKey = "active" | "probation" | "notice" | "starting" | "inactive" | "left" | "resigned" | "terminated";
const STATUS_ORDER: readonly StatusKey[] = ["active", "probation", "notice", "starting", "inactive", "left", "resigned", "terminated"];
/* one colour per department, mixed from the brand and the status tokens -
   theme tokens only, so both themes get them */
const DEPT_COLORS = [
  "var(--primary)", "var(--gold-solid)", "var(--info)", "var(--success)", "var(--warning)",
  "color-mix(in oklab, var(--gold-solid) 45%, var(--primary))", "var(--danger)",
];

export function StaffDirectory({ canAmend = false, readOnly = false, role = "", canEditResponsibilities = false, go, canOpen, recordFocus, initialView, openHrLifecycle }: {
  /** v1.306.0 - HR 4.0 (H-3): the joining checklist's one editor is HR > Employee Lifecycle */
  openHrLifecycle?: () => void;
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
  /* v1.308.0 - STAFF WORKSPACE 4.0 (the CEO, 15-11-2026, S-0): the six views
     in the address (/portal?tab=Staff Details&view=...), Back / Forward, the
     Dashboard's view switch on a phone */
  const [tab, setTab] = useState<StaffTab>(isStaffTab(initialView ?? null) ? initialView as StaffTab : "overview");
  const [seenStart, setSeenStart] = useState(initialView);
  if (initialView !== seenStart) { setSeenStart(initialView); if (isStaffTab(initialView ?? null)) setTab(initialView as StaffTab); }
  useTabViewAddress("Staff Details", tab, setTab, isStaffTab);
  /* a profile docked beside the Directory does not follow you to another view
     as a drawer over it */
  const [tabSeen, setTabSeen] = useState(tab);
  /* v1.204.0 - Organisation and Team Map are tabs of their own now; the
     Team Map's circle is drawn only while its tab is open */
  const [peekTab, setPeekTab] = useState<PeekTab>("profile");
  const wide = useWide();
  const [layout, setLayout] = useState<"table" | "grid">("table");
  const [deptF, setDeptF] = useState("");
  const [stateF, setStateF] = useState<"" | StaffState | StatusKey>("");
  const [typeF, setTypeF] = useState<string>(""); // v1.308.0 - employment type filter (ref 02)
  const [rolesF, setRolesF] = useState<"all" | "missing" | "written">("all"); // v1.308.0 - ref 05 pills
  const [rolesDept, setRolesDept] = useState("");
  const [recOnlyIncomplete, setRecOnlyIncomplete] = useState(false);
  const [deptAdd, setDeptAdd] = useState<string | null>(null); // v1.308.0 - "Add staff to department" (ref 05)
  /* v1.308.0 - Staff Records (reference 06): the section shown, the record in
     Edit, the private block read for the HR tier, the history drawer */
  const [recSection, setRecSection] = useState<RecordSectionKey>("personal");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [privateOf, setPrivateOf] = useState<Record<number, Partial<Staff>>>({});
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [recQuery, setRecQuery] = useState("");
  /* whose profile drawer is open */
  const [peek, setPeek] = useState<number | null>(null);
  const recRef = useRef<HTMLDivElement | null>(null);
  const orgRef = useRef<HTMLDivElement | null>(null); // v1.308.0 - View Full Organisation
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
  const todayS = todayIso();
  const { show: showToast, node: toastNode } = useSaveToast();
  const { data: posData, reload: reloadPositions } = usePositions(); // v1.322.0 - everyone on staff reads the list
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
    setStaff(list.filter((u) => isStaffRole(u.role) && !(u as { not_staff?: number }).not_staff /* v1.384.0 - a test account is not staff */).sort(bySeniority));
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
    const mgr = managerId === null ? null : allStaff.find((u) => u.id === managerId) ?? null;
    /* v1.308.0 (S-8) - why, and from when: recorded with the change. The line
       changes on save; the date is not a schedule. A new line also decides who
       approves this person's NEXT leave (the approved routing, v1.260). */
    const ask = await prompt({
      title: person ? L(`Change who ${displayName(person)} reports to?`, `Tukar kepada siapa ${displayName(person)} melapor?`) : L("Change reporting line?", "Tukar garis pelaporan?"),
      message: mgr ? L(`New supervisor: ${displayName(mgr)}. Their next leave request goes to the new line; one already waiting keeps its route.`, `Penyelia baharu: ${displayName(mgr)}. Permohonan cuti seterusnya ke garis baharu; yang sedang menunggu kekal pada laluannya.`)
        : L("They come off the chart until a new line is set.", "Mereka keluar dari carta sehingga garis baharu ditetapkan."),
      label: L("Reason (optional)", "Sebab (pilihan)"),
      placeholder: L("e.g. moved to the COO's team", "cth. berpindah ke pasukan COO"),
      date: { label: L("Effective date", "Tarikh berkuat kuasa"), initial: todayS, required: true },
      confirmLabel: L("Change line", "Tukar garis"),
    });
    if (!ask) return;
    setOrgSaving(personId);
    const r = await api<{ ok?: boolean; manager_name?: string | null; error?: { message?: string } }>(
      `/users/${personId}/reports-to`,
      { method: "PUT", body: JSON.stringify({ reports_to: managerId, reason: ask.value.trim(), effective_on: ask.date || todayS }) },
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
    /* v1.308.0 - the values this screen started from, so the server can refuse a
       field somebody else changed meanwhile (409 changed_since) */
    const row = allStaff.find((x) => x.id === id);
    const startedFrom = { ...(row ?? {}), ...(privateOf[id] ?? {}) } as Record<string, unknown>;
    const expect: Record<string, string> = {};
    for (const k of Object.keys(payload)) expect[k] = String(startedFrom[k] ?? "");
    const res = await api<ErrShape>(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ ...payload, expect }) });
    if (res.ok) {
      setSaved(id);
      setDraft((s) => ({ ...s, [id]: {} }));
      setEditingId(null);
      window.setTimeout(() => setSaved(null), 3000);
      showToast(L("Saved", "Disimpan"), name ?? L("Staff record updated", "Rekod kakitangan dikemas kini"));
      if (privateOf[id]) void loadPrivate(id);
      void load();
    } else {
      setRowMsg((m) => ({ ...m, [id]: res.data?.error?.message ?? L("Save failed — check access", "Simpan gagal — semak akses") }));
    }
  };

  const set = (id: number, key: keyof Staff, value: string) =>
    setDraft((s) => ({ ...s, [id]: { ...s[id], [key]: value } }));
  /* v1.308.0 - a field's value and its lock are worked out on the open record
     itself (Staff Records), from the stored record and its private block: a
     field locks for HR once its SAVED value is non-empty; the CEO and an admin
     can always amend - the same rule the server enforces. */

  /* v1.157.0 - THE ROLE, SET FROM THE RECORD. Only the CEO and COO see the
     control (ROLE_ASSIGN_ROLES); it is deliberately NOT part of Save, because
     the COO is read-only on the record's fields and a role is not a field -
     it is the door list. Its own audited route, a confirmation that names
     both roles, an optional reason. Executive accounts show the control
     locked: those roles are the super_admin's to change (v1.4.157). */
  const canSetRole = holds("role_assign", ROLE_ASSIGN_ROLES.includes(role));
  /* v1.308.0 (S-1) - who reads the private block: hr_manage (the HR tier and
     the CEO). The server decides; this only stops asking where it would refuse. */
  const canPrivate = holds("hr_manage", ["super_admin", "admin", "hr_admin", "ceo"].includes(role));
  const loadPrivate = useCallback(async (id: number) => {
    const r = await api<{ private?: Partial<Staff> }>(`/users/${id}/private`);
    if (r.ok && r.data?.private) setPrivateOf((m) => ({ ...m, [id]: r.data!.private! }));
    return r.ok ? r.data?.private ?? null : null;
  }, []);
  /* the badge prints the NRIC, so it is printed from the private block */
  const openId = open.size === 1 ? [...open][0]! : null;
  useEffect(() => {
    if (openId === null || !canPrivate || privateOf[openId]) return;
    void loadPrivate(openId);
  }, [openId, canPrivate, privateOf, loadPrivate]);
  /* one person's change history (GET /staff/users/:id/history) */
  const historyView = useCachedApi<{ entries?: { id: number; action: string; created_at: string; by_name: string | null; detail: Record<string, unknown> | null }[] }>(historyFor !== null ? `/staff/users/${historyFor}/history` : null, historyFor !== null, ["users"]);
  const printWithPrivate = async (list: Staff[]) => {
    const full: Staff[] = [];
    for (const u of list) {
      const pv = privateOf[u.id] ?? await loadPrivate(u.id);
      full.push({ ...u, ...(pv ?? {}), ...draft[u.id] } as Staff);
    }
    if (full.length === 1) printBadge(full[0]!); else printBadges(full);
  };
  /* v1.358.0 - ROLES V2: the roles you made (Roles & Permissions) are offered here too, to the CEO
     and the Super Admin only (role_custom - the server decides), with their names. The server asks
     for a reason and the authenticator code for these, as on the Users tab. */
  const canGiveOwn = holds("role_custom", ["ceo", "super_admin"].includes(role));
  const [ownRoles, setOwnRoles] = useState<{ key: string; name: string }[]>([]);
  useEffect(() => {
    if (!canGiveOwn) return;
    let live = true;
    void api<{ role_table?: { key: string; name: string; kind: string }[] }>("/access/policy").then((r) => {
      if (live && r.ok) setOwnRoles((r.data?.role_table ?? []).filter((x) => x.kind === "own").map((x) => ({ key: x.key, name: x.name })));
    });
    return () => { live = false; };
  }, [canGiveOwn]);
  const ownName = (k: string) => ownRoles.find((x) => x.key === k)?.name;
  const roleLabel = (r: string) => ownName(r) ?? L(r.replace(/_/g, " "), ROLE_MS[r] ?? r.replace(/_/g, " "));
  const roleChoices = (cur: string) => [...WORKING_ROLES, ...(canGiveOwn ? ownRoles.map((x) => x.key) : [])].concat(/^r_/.test(cur) && !ownName(cur) ? [cur] : []);
  const roleEditable = (cur: string) => WORKING_ROLES.includes(cur) || (canGiveOwn && /^r_/.test(cur));
  const changeRole = async (u: Staff, next: string) => {
    if (!next || next === u.role) return;
    if (/^r_/.test(next) || /^r_/.test(u.role)) {
      /* an own role, given or taken away: a reason (10+) and the code, as the server requires */
      const why = await prompt({ title: L(`Change ${displayName(u)}'s role?`, `Tukar peranan ${displayName(u)}?`),
        label: L(`Why (at least 10 characters, kept in the audit history). ${roleLabel(u.role)} becomes ${roleLabel(next)}; what they may do and see changes at once, and their leave and claims follow the Organisation chart.`, `Sebab (sekurang-kurangnya 10 aksara, disimpan dalam sejarah audit). ${roleLabel(u.role)} menjadi ${roleLabel(next)}; apa yang mereka boleh lakukan dan lihat berubah serta-merta, dan cuti serta tuntutan mereka mengikut carta Organisasi.`), required: true });
      if (!why) return;
      if (why.value.trim().length < 10) { setRowMsg((m) => ({ ...m, [u.id]: L("Give a reason of at least 10 characters.", "Beri sebab sekurang-kurangnya 10 aksara.") })); return; }
      setRowMsg((m) => ({ ...m, [u.id]: "" }));
      const res = await withStepUp<ErrShape>(
        (totp) => api<ErrShape>(`/users/${u.id}/role`, { method: "POST", body: JSON.stringify({ role: next, reason: why.value.trim(), ...(totp ? { totp } : {}) }) }),
        prompt, { title: L(`Confirm: ${displayName(u)} → ${roleLabel(next)}`, `Sahkan: ${displayName(u)} → ${roleLabel(next)}`), label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") });
      if (res.ok) { showToast(L("Role changed", "Peranan ditukar"), `${displayName(u)} — ${roleLabel(next)}`); void load(); }
      else setRowMsg((m) => ({ ...m, [u.id]: res.data?.error?.message ?? L("Role change failed", "Penukaran peranan gagal") }));
      return;
    }
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
  /* v1.308.0 - STAFF WORKSPACE 4.0 (S-4): one status word per record, from
     the record alone - employment, never today's attendance or leave */
  const statusKeyOf = (u: Staff): StatusKey => {
    const st = stateOf(u);
    if (st === "left") return u.employment_status === "terminated" ? "terminated" : u.employment_status === "resigned" ? "resigned" : "left";
    if (st === "starting" || st === "inactive") return st;
    if (st === "system") return "inactive";
    if (DEPARTURE_STATUSES.includes(u.employment_status ?? "") && u.left_on) return "notice";
    if (u.employment_status === "probation") return "probation";
    return "active";
  };
  const TAB_NAMES: readonly (readonly [StaffTab, string, string])[] = [
    ["overview", L("Overview", "Gambaran"), L("Summary and attention", "Ringkasan dan perhatian")],
    ["directory", L("Directory", "Direktori"), L("Find people", "Cari orang")],
    ["org", L("Organisation", "Organisasi"), L("Who reports to whom", "Siapa melapor kepada siapa")],
    ["team", L("Team Map", "Peta Pasukan"), L("The team at a glance", "Pasukan sepintas lalu")],
    ["roles", L("Departments & Roles", "Jabatan & Peranan"), L("Positions and responsibilities", "Jawatan dan tanggungjawab")],
    ["records", L("Staff Records", "Rekod Kakitangan"), L("The full record", "Rekod penuh")],
  ];
  const STATUS_LABEL: Record<StatusKey, string> = {
    active: L("Active", "Aktif"), probation: L("On probation", "Dalam percubaan"), notice: L("On notice", "Dalam notis"),
    starting: L("Starting", "Akan bermula"), inactive: L("Inactive", "Tidak aktif"), left: L("Left (all)", "Telah keluar (semua)"),
    resigned: L("Resigned", "Letak jawatan"), terminated: L("Terminated", "Ditamatkan"),
  };
  const STATE_LABEL: Record<StaffState, string> = {
    active: L("Active", "Aktif"),
    starting: L("Starting", "Akan bermula"),
    inactive: L("Inactive", "Tidak aktif"),
    left: L("Left", "Telah keluar"),
    system: L("System account", "Akaun sistem"),
  };
  const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
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
            {cap1(L(u.employment_status ?? "", STATUS_MS[u.employment_status ?? ""] ?? (u.employment_status ?? "")))}{u.left_on ? ` · ${dmy(u.left_on)}` : ""}
          </span>
          <span className={chipNeutral}
            title={L("Password and Google sign-in refuse a resigned or terminated account. The account itself stays on so their final month is still paid.",
                     "Log masuk kata laluan dan Google menolak akaun yang telah letak jawatan atau ditamatkan. Akaun itu sendiri kekal supaya gaji bulan terakhir mereka masih dibayar.")}>
            <AppIcon name="lock" />{L("Sign-in blocked", "Log masuk disekat")}
          </span>
        </span>
      );
    }
    /* v1.230.0 - serving notice: on staff (and paid) until the last day;
       v1.308.0 (S-4) - said as "On notice" */
    if (statusKeyOf(u) === "notice") {
      return <span className={chipWarn}>{L(`On notice · last day ${dmy(u.left_on ?? "")}`, `Dalam notis · hari terakhir ${dmy(u.left_on ?? "")}`)}</span>;
    }
    if (statusKeyOf(u) === "probation") return <span className={chipInfo}>{L("On probation", "Dalam percubaan")}</span>;
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
  const notWritten = headcount.filter((u) => !writtenOf(u)).length;
  /* v1.308.0 (S-1) - a private field is filled when the list says so
     (private_set); its value is never in the list */
  const isFilled = (u: Staff, k: keyof Staff) => ((PRIVATE_KEYS as readonly string[]).includes(k as string)
    ? (u.private_set ?? []).includes(k as string) || String(u[k] ?? "").trim() !== ""
    : String(u[k] ?? "").trim() !== "");
  const filledOf = (u: Staff) => RECORD_FIELDS.filter(([k]) => isFilled(u, k)).length;
  /* v1.308.0 (S-5) - PROFILES MISSING INFO: a working record missing any of
     the twelve fields payroll, the badge and duty of care need */
  const missingOf = (u: Staff) => REQUIRED_FIELDS.filter((k) => !isFilled(u, k));
  const incomplete = headcount.filter((u) => missingOf(u).length > 0);
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
  const sorted = sortBy === "rank"
    ? staff
    : [...staff].sort((a, b) => sortBy === "az" ? displayName(a).localeCompare(displayName(b))
      : sortBy === "za" ? displayName(b).localeCompare(displayName(a))
      : sortBy === "id" ? (a.employee_id || "~").localeCompare(b.employee_id || "~", undefined, { numeric: true })
      : (deptName(a) || "~").localeCompare(deptName(b) || "~"));
  /* v1.361.0 (the CEO, 18-11-2026: "resigned staff should be in grey and at
     the bottom of the list since it is inactive, same goes to staff
     records") - whatever the order, working staff come first, inactive
     accounts next and the people who have left (staffState "left": a past
     last day, or Resigned / Terminated with no last day) last, each group in
     the chosen order. The last two are drawn grey. Nothing is hidden or
     changed. */
  const dimRank = (u: Staff) => (isGone(u) ? 2 : stateOf(u) === "inactive" ? 1 : 0);
  const isDim = (u: Staff) => dimRank(u) > 0;
  const leaversLast = <T extends Staff>(list: T[]): T[] => [0, 1, 2].flatMap((r) => list.filter((u) => dimRank(u) === r));
  const ranked = leaversLast(sorted);
  const dirList = ranked
    .filter((u) => !needle || [displayName(u), u.email, u.employee_id, u.position, u.department, u.role]
      .some((value) => (value ?? "").toLowerCase().includes(needle)))
    .filter((u) => !deptF || (deptF === NO_DEPT ? !deptName(u) : deptName(u) === deptF))
    .filter((u) => !stateF || stateOf(u) === stateF || statusKeyOf(u) === stateF)
    .filter((u) => !typeF || (typeF === NO_TYPE ? !typeOf(u) : typeOf(u) === typeF));
  const allShownTicked = dirList.length > 0 && dirList.every((u) => selected.has(u.id));
  const recNeedle = recQuery.trim().toLowerCase();
  const recList = leaversLast(staff).filter((u) => !recNeedle || [displayName(u), u.employee_id, u.position, u.department]
    .some((value) => (value ?? "").toLowerCase().includes(recNeedle)))
    .filter((u) => !recOnlyIncomplete || (isHead(u) && missingOf(u).length > 0));
  /* v1.308.0 - THE STATUS VOCABULARY (S-4): employment, never today's
     attendance or leave. Read from the record only. */
  const statusCounts = STATUS_ORDER.map((k) => [k, staff.filter((u) => k === "active" ? stateOf(u) === "active" : k === "left" ? stateOf(u) === "left" : statusKeyOf(u) === k).length] as const)
    .filter(([, n]) => n > 0);
  /* v1.308.0 (S-2) - the attention rows, each verified from the records */
  const in60 = (() => { const d = new Date(`${todayS}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 60); return d.toISOString().slice(0, 10); })();
  const leavingSoon = staff.filter((u) => statusKeyOf(u) === "notice" && (u.left_on ?? "") <= in60);
  const signInBlocked = staff.filter((u) => isGone(u) && Boolean(u.is_active));
  const hrReader = ["super_admin", "admin", "hr_admin", "ceo"].includes(role);
  const hrPeople = useCachedApi<{ probation?: { id: number; suggested_ends_on: string | null; review: { ends_on?: string | null; outcome?: string | null } | null }[] }>(hrReader ? "/staff/people/overview" : null, hrReader, ["users"]);
  const in30 = (() => { const d = new Date(`${todayS}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 30); return d.toISOString().slice(0, 10); })();
  const probationSoon = (hrPeople.data?.probation ?? []).filter((p) => !p.review?.outcome && (p.review?.ends_on ?? p.suggested_ends_on ?? "9999") <= in30).length;

  /* v1.201.0 - ONE DOOR TO A PERSON. Pressing anybody - a row, a card, a
     box on the chart, a face on the team map - opens their profile drawer;
     the drawer's "Open full record" takes you to Staff Records with that
     record open. Selecting for printing still ticks instead. */
  const press = (u: Staff) => {
    if (selectMode) { toggleSelect(u.id); return; }
    setPeek(u.id);
    setPeekTab("profile");
  };
  const openRecordHere = (id: number) => {
    setOpen(open.has(id) ? new Set() : new Set([id]));
    setEditingId(null);
    if (!open.has(id)) window.setTimeout(() => { if (window.innerWidth < 1024) recRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, 60);
  };
  const openRecord = (id: number) => {
    setPeek(null);
    setEditingId(null);
    setOpen(new Set([id]));
    setTab("records");
    window.setTimeout(() => recRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  };
  const showDirectory = (dept: string, state: "" | StaffState | StatusKey = "") => {
    setQuery(""); setDeptF(dept); setStateF(state); setTypeF(""); setTab("directory");
  };
  if (tab !== tabSeen) { setTabSeen(tab); if (tabSeen === "directory" && wide && peek !== null) setPeek(null); }
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
  const monitorView = useCachedApi<{ staff?: { id: number; in_at?: string | null; out_at?: string | null; last_type?: string | null; shifts?: number; status?: string }[] }>(
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
        {/* v1.325.0 (Global UI System D-2) - the one tab row */}
        <div className={sp.peekTabs}><LineTabs label={L("Profile sections", "Bahagian profil")} value={peekTab} onChange={setPeekTab} tabs={PEEK_TABS.map(([k, label]) => [k, label] as const)} /></div>

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
                <button type="button" className={btnSm} onClick={() => { setPeek(null); go("Users"); }}><AppIcon name="lock" />{L("View in Users & Security", "Lihat di Pengguna & Keselamatan")}</button>
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

        {peekTab === "documents" && <StaffVault userId={u.id} name={displayName(u)} onOpenHr={openHrLifecycle ? () => { setPeek(null); openHrLifecycle(); } : undefined} />}

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
                  /* v1.307.0 - the monitor's day verdict: a rest day, a holiday, leave
                     or a shift not yet started is never "not clocked in" */
                  : today?.status === "leave" ? <span className={chipNeutral}>{L("On leave", "Bercuti")}</span>
                  : today?.status === "rest_day" || today?.status === "holiday" || today?.status === "not_employed" ? <span className={chipNeutral}>{L("Not scheduled", "Tiada jadual")}</span>
                  : today?.status === "not_due" ? <span className={chipNeutral}>{L("Shift not started", "Syif belum bermula")}</span>
                  : today?.status === "pending" ? <span className={chipWarn}>{L("Punch awaiting approval", "Ketukan menunggu kelulusan")}</span>
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
      {canPrivate && <button type="button" className={btnSm} onClick={() => void printWithPrivate([u])}><AppIcon name="print" />{L("Print badge", "Cetak lencana")}</button>}
      <button type="button" className={btnSm} onClick={() => setPeek(null)}>{L("Close", "Tutup")}</button>
    </span>
  );

  return (
    /* The page's TabPage is the stack. v1.201.0 - five tabs, every zone
       mounted and hidden with sp.off, so a search, a selection or an open
       record survives a trip to another tab. */
    <>
      {/* outside every zone: a hidden tab must not hide a toast, a question or a drawer */}
      {toastNode}{promptNode}<PositionsDatalist list={posData?.positions} />
      <OffboardSheet person={offboard} onClose={() => setOffboard(null)}
        colleagues={offboard ? staff.filter((x) => x.id !== offboard.id && x.is_active && x.role !== "customer" && x.role !== "super_admin" && !["resigned", "terminated"].includes(x.employment_status ?? "")).map((x) => ({ id: x.id, name: displayName(x) })) : []}
        onDone={(m) => { showToast(L("Offboarded", "Khidmat ditamatkan"), m); void load(); }} />
      {/* v1.308.0 (S-0) - the six views: underline tabs on a wide screen, the
          Dashboard's view switch on a phone (with Add staff beside it) */}
      <div className="erp-desktop-only">
      <LineTabs value={tab} onChange={(k) => setTab(k)} label={L("Staff", "Kakitangan")} tabs={TAB_NAMES.map(([k, n]) => [k, n] as const)} aside={!readOnly ? (
        <TabAside>
          <TabAction icon="add" onClick={() => setShowCreate(true)}>{L("Add staff", "Tambah kakitangan")}</TabAction>
        </TabAside>
      ) : undefined} />
      </div>
      <div className={`erp-phone-only ${sp.viewBar}`} data-testid="staff-view-bar">
        <ViewSwitch value={tab} onChange={(k) => setTab(k)} label={L("Staff view", "Paparan kakitangan")} options={TAB_NAMES} />
        {!readOnly && <button type="button" className={btnSmPrimary} onClick={() => setShowCreate(true)}><AppIcon name="add" />{L("Add staff", "Tambah kakitangan")}</button>}
      </div>

      {/* ============================== OVERVIEW ============================== */}
      {/* v1.308.0 - REFERENCE 01: four figures, one distribution card, one
          Needs Attention list, one row of quick actions. Every number is the
          /staff/users list already loaded (and HR's own probation list, for
          the HR tier); nothing from Leave, Attendance, Payroll or Tasks. */}
      <TabZone label={L("Overview", "Gambaran")} className={tab !== "overview" ? sp.off : ""}>
        <KpiRow label={L("Staff summary", "Ringkasan kakitangan")}>
          <KpiTile icon="users" tone="navy" label={L("Total Staff", "Jumlah Kakitangan")} value={staff.length} busy={!loaded}
            sub={L("Everyone on the staff list", "Semua dalam senarai kakitangan")}
            onClick={() => showDirectory("")} title={L("Open the directory", "Buka direktori")} />
          <KpiTile icon="success" tone="green" label={L("Active Staff", "Kakitangan Aktif")} value={activeCount} busy={!loaded}
            sub={L(`${pctOf(activeCount, staff.length)}% of total staff${onLeaveToday ? ` · ${onLeaveToday} on leave today` : ""}`, `${pctOf(activeCount, staff.length)}% daripada jumlah${onLeaveToday ? ` · ${onLeaveToday} bercuti hari ini` : ""}`)}
            onClick={() => showDirectory("", "active")} title={L("Show only active staff", "Tunjuk kakitangan aktif sahaja")} />
          <KpiTile icon="store" tone="blue" label={L("Departments", "Jabatan")} value={departments} busy={!loaded}
            sub={byDept.filter(([k]) => k).map(([k]) => k).join(", ") || L("Named on the records", "Dinamakan pada rekod")}
            onClick={() => setTab("roles")} title={L("Open Departments & Roles", "Buka Jabatan & Peranan")} />
          <KpiTile icon="document" tone="gold" label={L("Profiles Missing Info", "Profil Kurang Maklumat")} value={incomplete.length} busy={!loaded}
            sub={L("Working staff missing key details", "Kakitangan bekerja tanpa butiran utama")}
            onClick={() => { setRecOnlyIncomplete(true); setTab("records"); }}
            title={L("Full name, NRIC, birth date, phone, staff ID, position, department, joined date, bank, account and emergency contact", "Nama penuh, NRIC, tarikh lahir, telefon, ID, jawatan, jabatan, tarikh mula, bank, akaun dan hubungan kecemasan")} />
        </KpiRow>

        <div className={sp.split}>
          <section className={card} aria-label={L("Staff distribution by department", "Taburan kakitangan mengikut jabatan")} data-testid="staff-distribution">
            {head("users", sp.goldWell, L("Staff Distribution by Department", "Taburan Kakitangan mengikut Jabatan"), L("Total staff by department and percentage.", "Jumlah kakitangan mengikut jabatan dan peratusan."))}
            {!loaded ? <SkelRows rows={4} /> : staff.length === 0 ? <p className={sp.empty}>{L("No staff records yet.", "Belum ada rekod kakitangan.")}</p> : (
              <>
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
                <div className={sp.halves}>
                  <div>
                    <p className={sp.groupLabel}><AppIcon name="chart" />{L("Staff Status", "Status Kakitangan")}</p>
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
                  </div>
                  <div>
                    <p className={sp.groupLabel}><AppIcon name="orders" />{L("Employment Type", "Jenis Pekerjaan")}</p>
                    <ul className={sp.bars}>
                      {typeCounts.map(([k, n]) => (
                        <li key={k || "unset"}>
                          <button type="button" onClick={() => { setQuery(""); setDeptF(""); setStateF("active"); setTypeF(k || NO_TYPE); setTab("directory"); }}>
                            <span>{employmentLabel(k)}</span>
                            <span className={sp.track}><span className={`${sp.fill} ${sp.fillBlue}`} style={{ width: `${Math.max(3, (n / maxType) * 100)}%` }} /></span>
                            <strong>{n}</strong>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className={card} aria-label={L("Needs attention", "Perlu perhatian")} data-testid="staff-attention">
            {head("warning", sp.redWell, L("Needs Attention", "Perlu Perhatian"), L("Items that require your action or follow-up.", "Perkara yang memerlukan tindakan atau susulan anda."))}
            {!loaded ? <SkelRows rows={4} /> : notWritten + incomplete.length + probationSoon + leavingSoon.length + signInBlocked.length + notOnChart === 0 ? (
              <p className={sp.empty}><AppIcon name="success" />{L("Nothing needs attention - every working record is complete, every role is written and everyone is on the chart.", "Tiada yang perlu perhatian - setiap rekod lengkap, setiap peranan ditulis dan semua berada pada carta.")}</p>
            ) : (
              <ul className={sp.attn}>
                {([
                  [notWritten, "document", sp.goldWell, L("Roles not written yet", "Peranan belum ditulis"), L("Working staff with no role title or responsibilities", "Kakitangan bekerja tanpa gelaran peranan atau tanggungjawab"), () => { setRolesF("missing"); setTab("roles"); }],
                  [incomplete.length, "person", sp.goldWell, L("Incomplete staff records", "Rekod kakitangan tidak lengkap"), L("Profiles missing key information (e.g. bank, ID, emergency contact)", "Profil tanpa maklumat utama (cth. bank, ID, hubungan kecemasan)"), () => { setRecOnlyIncomplete(true); setTab("records"); }],
                  [probationSoon, "date", sp.goldWell, L("Probation ending soon", "Percubaan hampir tamat"), L("Probation reviews due within 30 days - decided in HR", "Semakan percubaan dalam 30 hari - diputuskan di HR"), openHrLifecycle ?? null],
                  [leavingSoon.length, "offboard", sp.goldWell, L("Staff leaving soon", "Kakitangan akan keluar"), L("Resigned or terminated, last day within 60 days", "Letak jawatan atau ditamatkan, hari terakhir dalam 60 hari"), () => showDirectory("", "notice")],
                  [signInBlocked.length, "lock", sp.goldWell, L("Sign-in blocked", "Log masuk disekat"), L("Left staff whose account stays on for the final month's pay", "Kakitangan keluar yang akaunnya kekal untuk gaji bulan terakhir"), () => showDirectory("", "left")],
                  [notOnChart, "users", sp.blueWell, L("Not on the organisation chart", "Belum berada pada carta organisasi"), L("Nobody has said who they report to", "Belum ditetapkan kepada siapa mereka melapor"), () => setTab("org")],
                ] as const).filter(([n]) => n > 0).map(([n, icon, well, title, sub, go2]) => (
                  <li key={title}>{go2 ? (
                    <button type="button" onClick={go2} data-testid="staff-attention-row">
                      <span className={`${sp.well} ${well}`} aria-hidden><AppIcon name={icon} /></span>
                      <span className={sp.attnText}><strong>{title}</strong><span>{sub}</span></span>
                      <span className={sp.attnNum}>{n}</span>
                      <AppIcon name="next" />
                    </button>
                  ) : (
                    <div data-testid="staff-attention-row">
                      <span className={`${sp.well} ${well}`} aria-hidden><AppIcon name={icon} /></span>
                      <span className={sp.attnText}><strong>{title}</strong><span>{sub}</span></span>
                      <span className={sp.attnNum}>{n}</span>
                    </div>
                  )}</li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className={card} aria-label={L("Quick actions", "Tindakan pantas")}>
          {head("fast", sp.goldWell, L("Quick Actions", "Tindakan Pantas"), L("Go to key staff features or perform common actions.", "Pergi ke ciri kakitangan utama atau lakukan tindakan biasa."))}
          <ul className={sp.quick}>
            {([
              ["users", sp.goldWell, L("Staff Directory", "Direktori Kakitangan"), L("Find and manage staff", "Cari dan urus kakitangan"), () => showDirectory("")],
              ["chart", sp.blueWell, L("Organisation", "Organisasi"), L("View the company structure", "Lihat struktur syarikat"), () => setTab("org")],
              ["place", sp.blueWell, L("Team Map", "Peta Pasukan"), L("See the team at a glance", "Lihat pasukan sepintas lalu"), () => setTab("team")],
              ...(!readOnly ? [["add", sp.greenWell, L("Add Staff", "Tambah Kakitangan"), L("Create a new staff record", "Cipta rekod kakitangan baharu"), () => setShowCreate(true)] as const] : []),
              ["identification", sp.goldWell, L("Staff Records", "Rekod Kakitangan"), L("View and manage staff records", "Lihat dan urus rekod kakitangan"), () => setTab("records")],
            ] as const).map(([icon, well, title, sub, go2]) => (
              <li key={title}><button type="button" className={sp.quickBtn} onClick={go2}>
                <span className={`${sp.well} ${well}`} aria-hidden><AppIcon name={icon} /></span>
                <span className={sp.attnText}><strong>{title}</strong><span>{sub}</span></span>
                <AppIcon name="next" />
              </button></li>
            ))}
          </ul>
        </section>
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
            <PillSwitch testid="dir-layout" label={L("How to show the directory", "Cara memaparkan direktori")} value={layout} onChange={setLayout}
              options={[["table", L("List", "Senarai"), "documents"], ["grid", L("Grid", "Grid"), "users"]] as const} />)}
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
            <select className={selectClassSm} value={stateF} onChange={(e) => setStateF(e.target.value as "" | StatusKey)} aria-label={L("Status", "Status")} data-testid="staff-status-filter">
              <option value="">{L("All statuses", "Semua status")}</option>
              {statusCounts.map(([k]) => <option key={k} value={k}>{k === "active" ? L("Active (all on staff)", "Aktif (semua dalam perkhidmatan)") : STATUS_LABEL[k]}</option>)}
            </select>
            {/* v1.308.0 - employment type (reference 02): permanent, contract, part time */}
            <select className={selectClassSm} value={typeF} onChange={(e) => setTypeF(e.target.value)} aria-label={L("Employment type", "Jenis pekerjaan")} data-testid="staff-type-filter">
              <option value="">{L("All employment types", "Semua jenis pekerjaan")}</option>
              {typeKeys.filter((k) => k).map((k) => <option key={k} value={k}>{employmentLabel(k)}</option>)}
              <option value={NO_TYPE}>{L("Not set", "Belum ditetapkan")}</option>
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
          {canPrivate && <div className={sp.selectBar}>
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
                onClick={() => void printWithPrivate(staff.filter((u) => selected.has(u.id)))}
              >
                {L("Print badges", "Cetak lencana")} ({selected.size}) — {L("up to 9 per A4", "sehingga 9 setiap A4")}
              </button>
            )}
            <span className={sp.hint}>
              {selectMode
                ? L("Press a person to tick them.", "Tekan seseorang untuk menandanya.")
                : L("Press a person to open their profile.", "Tekan seseorang untuk buka profilnya.")}
            </span>
          </div>}

          {loadError && <p className={sp.warnText}><AppIcon name="warning" />{loadError}</p>}

          {layout === "table" ? (
            <FillPanel testid="staff-dir-fill" className={`erp-table-scroll ${sp.tableWrap}`}>
              <table className={sp.table} aria-label={L("Staff directory", "Direktori kakitangan")}>
                <thead><tr>
                  {selectMode && <th className={sp.checkCell}><span className={sp.srOnly}>{L("Ticked", "Ditanda")}</span></th>}
                  <th>{L("Staff", "Kakitangan")}</th>
                  <th>{L("Staff ID", "ID kakitangan")}</th>
                  <th>{L("Position", "Jawatan")}</th>
                  <th>{L("Department", "Jabatan")}</th>
                  <th>{L("Employment Type", "Jenis Pekerjaan")}</th>
                  <th>{L("Status", "Status")}</th>
                  <th><span className={sp.srOnly}>{L("Actions", "Tindakan")}</span></th>
                </tr></thead>
                <tbody>
                  {!loaded && skelRows(5, selectMode ? 8 : 7)}
                  {loaded && dirList.length === 0 && (
                    <tr><td colSpan={selectMode ? 8 : 7}><p className={sp.empty}><AppIcon name="search" />{query || deptF || stateF || typeF ? L("No staff matches that search.", "Tiada kakitangan sepadan dengan carian itu.") : L("No staff records yet.", "Belum ada rekod kakitangan.")}</p></td></tr>
                  )}
                  {loaded && dirList.map((u) => (
                    <tr key={u.id} className={`${selected.has(u.id) ? sp.rowOn : ""} ${isDim(u) ? sp.rowGone : ""}`}>
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
                      <td data-label={L("Employment type", "Jenis pekerjaan")}>{typeOf(u) ? <span className={chipNeutral}>{employmentLabel(typeOf(u))}</span> : <span className={sp.muted}>—</span>}</td>
                      <td data-label={L("Status", "Status")}>{stateChip(u)}</td>
                      {/* v1.308.0 (S-3) - Profile and Record on a wide screen, as
                          the reference; on a phone the row opens the profile and
                          its footer carries Open record and Print badge */}
                      <td className={sp.actCell}>
                        <span className="erp-desktop-only">
                          <button type="button" className={rowBtn} onClick={() => setPeek(u.id)}>{L("Profile", "Profil")}</button>
                          <button type="button" className={rowBtn} onClick={() => openRecord(u.id)}>{L("Record", "Rekod")}</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </FillPanel>
          ) : (
            <ul className={sp.grid} aria-label={L("Staff directory", "Direktori kakitangan")}>
              {!loaded && Array.from({ length: 6 }, (_, i) => (
                <li key={`sk-${i}`} aria-hidden><span className={sp.tile}><Skel className="h-11 w-11 rounded-full" /><Skel className="h-3 w-24" /><Skel className="h-2.5 w-16" /></span></li>
              ))}
              {loaded && dirList.length === 0 && <li><p className={sp.empty}><AppIcon name="search" />{L("No staff matches that search.", "Tiada kakitangan sepadan dengan carian itu.")}</p></li>}
              {loaded && dirList.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => press(u)} aria-pressed={selectMode ? selected.has(u.id) : undefined}
                    className={`${sp.tile} ${selected.has(u.id) ? sp.tileOn : ""} ${isDim(u) ? sp.tileGone : ""}`}>
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

        {/* v1.308.0 - the department cards that stood here repeated the
            Overview's distribution and this list's own department filter */}
      </TabZone>

      {/* ============================== ORGANISATION ============================== */}
      {/* v1.308.0 - REFERENCE 03: Leadership Summary, the tree, the reporting
          lines. One source - users.reports_to - and the CEO is the top by
          role, never assigned to anyone (the worker refuses it). */}
      <TabZone label={L("Organisation chart", "Carta organisasi")} className={tab !== "org" ? sp.off : ""}>
        {(() => {
          const ceo = staff.find((u) => u.role === "ceo" && !isGone(u)) ?? null;
          return (
            <section className={card} aria-label={L("Leadership summary", "Ringkasan kepimpinan")} data-testid="org-leadership">
              {head("trophy", sp.goldWell, L("Leadership Summary", "Ringkasan Kepimpinan"))}
              {!loaded ? <SkelRows rows={2} /> : !ceo ? <p className={sp.empty}>{L("No CEO record on the staff list.", "Tiada rekod CEO dalam senarai kakitangan.")}</p> : (
                <div className={sp.leader}>
                  <button type="button" className={sp.leaderWho} onClick={() => press(ceo)}>
                    <Avatar name={displayName(ceo)} photoKey={ceo.photo_key} size="lg" />
                    <span className={sp.personText}>
                      <strong>{ceo.position || L("Chief Executive Officer (CEO)", "Ketua Pegawai Eksekutif (CEO)")}</strong>
                      <span>{displayName(ceo)}</span>
                      <span>{deptName(ceo) || "—"}</span>
                    </span>
                  </button>
                  <ul className={sp.leaderFacts}>
                    <li><span className={`${sp.well} ${sp.goldWell}`} aria-hidden><AppIcon name="person" /></span>
                      <span className={sp.attnText}><strong>{L("No Direct Supervisor", "Tiada Penyelia Langsung")}</strong><span>{L("The CEO is the highest authority and is not assigned to anyone.", "CEO ialah kuasa tertinggi dan tidak ditetapkan kepada sesiapa.")}</span></span></li>
                    <li><span className={`${sp.well} ${sp.goldWell}`} aria-hidden><AppIcon name="chart" /></span>
                      <span className={sp.attnText}><strong>{L("Oversees the Company", "Menyelia Syarikat")}</strong><span>{L("Every department, role and member of staff sits under the CEO.", "Setiap jabatan, peranan dan kakitangan berada di bawah CEO.")}</span></span></li>
                  </ul>
                  <span className={sp.leaderLinks}>
                    <button type="button" className={sp.quickBtn} onClick={() => press(ceo)}>
                      <AppIcon name="users" /><span>{L(`Direct Reports (${reportsOf(ceo).length})`, `Melapor Terus (${reportsOf(ceo).length})`)}</span><AppIcon name="next" />
                    </button>
                    <button type="button" className={sp.quickBtn} onClick={() => setTab("roles")}>
                      <AppIcon name="folder" /><span>{L(`Departments (${departments})`, `Jabatan (${departments})`)}</span><AppIcon name="next" />
                    </button>
                  </span>
                </div>
              )}
            </section>
          );
        })()}
        <div ref={orgRef}>
          <OrgChart
            people={staff}
            loaded={loaded}
            canAssign={canAssign && !readOnly}
            saving={orgSaving}
            onAssign={(personId, managerId) => { void assignReportsTo(personId, managerId); }}
            onOpen={(p) => { const u = staff.find((x) => x.id === p.id); if (u) press(u); }}
          />
        </div>
        <section className={card} aria-label={L("Reporting lines", "Garis pelaporan")} data-testid="org-lines">
          {head("users", sp.goldWell, L("Reporting lines", "Garis pelaporan"),
            L("A quick summary of who reports to whom in the organisation.", "Ringkasan pantas siapa melapor kepada siapa dalam organisasi."),
            <button type="button" className={btnSm} onClick={() => orgRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}>{L("View Full Organisation", "Lihat Organisasi Penuh")}<AppIcon name="next" /></button>)}
          {!loaded ? <SkelRows rows={3} /> : managers.length === 0 ? (
            <p className={sp.empty}><AppIcon name="info" />{L("No reporting lines are set yet.", "Belum ada garis pelaporan ditetapkan.")}</p>
          ) : (
            <ul className={sp.lineStrip}>
              {managers.map((m) => {
                const up = managerOf(m);
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => press(m)}>
                      <span className={`${sp.well} ${sp.goldWell}`} aria-hidden><AppIcon name="person" /></span>
                      <span className={sp.attnText}>
                        <strong>{displayName(m)}{m.role === "ceo" || m.role === "coo" || m.role === "cco" ? ` (${m.role.toUpperCase()})` : ""}</strong>
                        <span>{m.role === "ceo" ? L("Reports to: no one (highest authority)", "Melapor kepada: tiada (kuasa tertinggi)") : up ? L(`Reports to: ${givenNames(displayName(up))}`, `Melapor kepada: ${givenNames(displayName(up))}`) : L("Reports to: not set", "Melapor kepada: belum ditetapkan")}</span>
                      </span>
                      <span className={chipNeutral}>{L(`${reportsOf(m).length} direct report${reportsOf(m).length === 1 ? "" : "s"}`, `${reportsOf(m).length} melapor terus`)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </TabZone>

      {/* ================================ TEAM MAP ================================ */}
      {/* v1.308.0 - REFERENCE 04 (team-map.tsx): department sectors round the
          CEO, names under faces, birthdays (day and month) and who is on leave
          today. The same /staff/users rows and ids - read-only. */}
      <TabZone label={L("Team map", "Peta pasukan")} className={tab !== "team" ? sp.off : ""}>
        {tab === "team" && (
          <TeamMap people={staff} gone={(u) => isGone(u as Staff)} loaded={loaded}
            colorOf={(k) => { const i = byDept.findIndex(([d]) => d === k); return deptColor(i < 0 ? 0 : i, k); }}
            birthdayOf={(u) => birthdayInfo((u as Staff).birthday, todayS)}
            onLeave={onLeaveIds} activeCount={activeCount}
            onOpen={(u) => press(u as Staff)} onShowDept={(d) => showDirectory(d || NO_DEPT)}
            goOrg={() => setTab("org")} goDirectory={() => showDirectory("")} goRoles={() => setTab("roles")} />
        )}
      </TabZone>

      {/* ========================== DEPARTMENTS & ROLES ========================== */}
      {/* v1.308.0 - REFERENCE 05: coverage of working staff, Everyone / Not
          written / Written, a department to focus, one card per department
          with Add staff to department. Written = a role title or at least one
          responsibility on the record (the one rule, unchanged). No delta and
          no "awaiting review": neither exists in the records (S-9). A job's
          responsibilities never grant a system permission - that is Users. */}
      <TabZone label={L("Departments and roles", "Jabatan dan peranan")} className={tab !== "roles" ? sp.off : ""}>
        <section className={card} aria-label={L("Roles and responsibilities coverage", "Liputan peranan dan tanggungjawab")} data-testid="roles-coverage">
          <div className={sp.coverage}>
            <div className={sp.lead}>
              <span className={`${sp.well} ${sp.goldWell}`} aria-hidden><AppIcon name="document" /></span>
              <div className={sp.headText}>
                <h3 className={sp.title}>{L("Roles & Responsibilities Coverage", "Liputan Peranan & Tanggungjawab")}</h3>
                <p className={sp.sub}>{L("Working staff with a role title or responsibilities written on their record.", "Kakitangan bekerja yang mempunyai gelaran peranan atau tanggungjawab bertulis pada rekod.")}</p>
              </div>
            </div>
            <span className={sp.coverFig}><strong>{loaded ? L(`${writtenCount} of ${activeCount}`, `${writtenCount} daripada ${activeCount}`) : "—"}</strong><span>{L("working staff completed", "kakitangan bekerja lengkap")}</span></span>
            <span className={sp.coverFig}><strong>{loaded ? `${pctOf(writtenCount, activeCount)}%` : "—"}</strong><span>{L("coverage", "liputan")}</span></span>
            <span className={sp.track} role="img" aria-label={L(`${writtenCount} of ${activeCount} written`, `${writtenCount} daripada ${activeCount} ditulis`)}>
              <span className={`${sp.fill} ${writtenCount >= activeCount && activeCount > 0 ? sp.fillGreen : ""}`} style={{ width: `${pctOf(writtenCount, activeCount)}%` }} />
            </span>
          </div>
        </section>
        {/* v1.322.0 - the positions list: the CEO and the Super Admin keep it (the server decides who) */}
        {posData?.can_manage && <PositionsCard onChanged={reloadPositions} />}
        <div className={sp.rolesBar}>
          <PillSwitch testid="roles-filter" label={L("Which staff to show", "Kakitangan mana untuk dipaparkan")} value={rolesF} onChange={setRolesF} options={[
            ["all", L(`Everyone (${activeCount})`, `Semua (${activeCount})`)], ["missing", L(`Not written yet (${notWritten})`, `Belum ditulis (${notWritten})`)], ["written", L(`Written (${writtenCount})`, `Ditulis (${writtenCount})`)],
          ] as const} />
          <select className={selectClassSm} value={rolesDept} onChange={(e) => setRolesDept(e.target.value)} aria-label={L("Department", "Jabatan")} data-testid="roles-dept">
            <option value="">{L("All departments", "Semua jabatan")}</option>
            {byDept.map(([k]) => <option key={k || NO_DEPT} value={k || NO_DEPT}>{k || noDept}</option>)}
          </select>
        </div>
        {!loaded && <section className={card}><SkelRows rows={4} /></section>}
        {loaded && rolesF === "missing" && notWritten === 0 && (
          <section className={card}><p className={sp.empty}><AppIcon name="success" />{L("Every working person has their role written.", "Peranan setiap orang yang bekerja telah ditulis.")}</p></section>
        )}
        {loaded && byDept.filter(([k]) => !rolesDept || (k || NO_DEPT) === rolesDept).map(([k, list]) => {
          const rows = rolesF === "missing" ? list.filter((u) => isHead(u) && !writtenOf(u)) : rolesF === "written" ? list.filter((u) => isHead(u) && writtenOf(u)) : list;
          if (rows.length === 0) return null;
          const working = list.filter(isHead);
          const done = working.filter(writtenOf).length;
          return (
            <section key={k || NO_DEPT} className={card} aria-label={k || noDept} data-testid="roles-dept-card">
              {head("store", k ? sp.blueWell : sp.redWell, k || noDept,
                L(`${list.length} staff · ${done} written · ${working.length - done} not written`, `${list.length} kakitangan · ${done} ditulis · ${working.length - done} belum ditulis`),
                !readOnly && k ? <button type="button" className={btnSm} onClick={() => setDeptAdd(k)}><AppIcon name="add" />{L("Add staff to department", "Tambah kakitangan ke jabatan")}</button> : undefined)}
              <div className={`erp-table-scroll ${sp.tableWrap}`}>
                <table className={sp.table} aria-label={k || noDept}>
                  <thead><tr>
                    <th>{L("Staff", "Kakitangan")}</th>
                    <th>{L("Position", "Jawatan")}</th>
                    <th>{L("Role title", "Gelaran peranan")}</th>
                    <th>{L("Responsibilities", "Tanggungjawab")}</th>
                    <th>{L("Last updated", "Kemas kini terakhir")}</th>
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
                            {isGone(u) ? <span className={chipNeutral}>{L("Left", "Telah keluar")}</span>
                              : writtenOf(u) ? <span className={chipSuccess}><AppIcon name="success" />{lines > 0 ? L(`Written · ${lines}`, `Ditulis · ${lines}`) : L("Written (title only)", "Ditulis (gelaran sahaja)")}</span>
                              : isHead(u) ? <span className={chipWarn}>{L("Not written", "Belum ditulis")}</span>
                              : <span className={chipNeutral}>{STATE_LABEL[stateOf(u)]}</span>}
                          </td>
                          <td data-label={L("Last updated", "Kemas kini terakhir")} className={sp.mono}>
                            {u.responsibilities_updated_at
                              ? `${dmy(u.responsibilities_updated_at.slice(0, 10))}${u.responsibilities_updated_by_name ? ` · ${properName(u.responsibilities_updated_by_name)}` : ""}`
                              : <span className={sp.muted}>—</span>}
                          </td>
                          <td className={sp.actCell}>
                            <span>
                              <button type="button" className={rowBtn} onClick={() => setPeek(u.id)}>{L("Read", "Baca")}</button>
                              {canEditResponsibilities && Boolean(u.is_active) && !isGone(u) && (
                                <button type="button" className={rowBtn} onClick={() => { setRecSection("role"); openRecord(u.id); }}>{L("Write", "Tulis")}</button>
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
      {/* v1.308.0 - REFERENCE 06: the Employee Master Record. Left, the people
          and each record's completeness; right, one record - its header, View
          then Edit / Cancel / Save, six sections, and how complete each other
          section is. The private block (NRIC, bank, statutory, address,
          emergency contact, blood type) is read for this one person from
          /staff/users/:id/private by the HR tier and the CEO only (S-1); a save
          sends the values it started from, so a change made meanwhile by
          somebody else is refused, never overwritten. */}
      <TabZone label={L("Staff records", "Rekod kakitangan")} className={tab !== "records" ? sp.off : ""}>
      <div className={`${sp.recordsSplit} ${open.size > 0 ? sp.recordsOpen : ""}`}>
        <section className={`${card} ${sp.recordsList}`} aria-label={L("Choose a record", "Pilih rekod")}>
          {head("identification", sp.goldWell, L("Staff Records", "Rekod Kakitangan"), L("Choose a person to view and edit their full record.", "Pilih seseorang untuk melihat dan menyunting rekod penuhnya."))}
          <div className={sp.toolbar}>
            <label className={sp.search}>
              <AppIcon name="search" />
              <input value={recQuery} onChange={(e) => setRecQuery(e.target.value)}
                placeholder={L("Find a record", "Cari rekod")} aria-label={L("Find a record", "Cari rekod")} />
            </label>
            <button type="button" className={recOnlyIncomplete ? btnSmPrimary : btnSm} aria-pressed={recOnlyIncomplete} onClick={() => setRecOnlyIncomplete((v) => !v)}
              title={L("Only working records missing key information", "Hanya rekod bekerja tanpa maklumat utama")} data-testid="rec-incomplete">
              <AppIcon name="warning" />{L(`Incomplete (${incomplete.length})`, `Tidak lengkap (${incomplete.length})`)}
            </button>
          </div>
          <ul className={sp.picker}>
            {!loaded && Array.from({ length: 5 }, (_, i) => (
              <li key={`sk-${i}`} aria-hidden><span className={sp.pick}><Skel className="h-9 w-9 rounded-full" /><Skel className="h-3 w-32" /><Skel className="h-3 w-8" /></span></li>
            ))}
            {loaded && recList.length === 0 && <li><p className={sp.empty}>{L("No record matches that search.", "Tiada rekod sepadan dengan carian itu.")}</p></li>}
            {loaded && recList.map((u) => (
              <li key={u.id}>
                <button type="button" className={`${sp.pick} ${isDim(u) ? sp.pickGone : ""}`} aria-pressed={open.has(u.id)} data-testid="rec-pick"
                  onClick={() => openRecordHere(u.id)}>
                  <Avatar name={displayName(u)} photoKey={u.photo_key} size="md" />
                  <span className={sp.personText}>
                    <strong>{displayName(u)}</strong>
                    <span>{[u.employee_id, u.position].filter(Boolean).join(" · ") || roleLabel(u.role)}</span>
                  </span>
                  <span className={`${sp.filled} ${filledOf(u) === RECORD_FIELDS.length ? sp.filledDone : ""}`} title={L("Fields filled on the record", "Medan yang diisi pada rekod")}>{filledOf(u)}/{RECORD_FIELDS.length}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className={sp.note}>
            <AppIcon name="info" />
            {L(`Completeness shows how many of the ${RECORD_FIELDS.length} key fields are filled for each staff record.`, `Kelengkapan menunjukkan berapa daripada ${RECORD_FIELDS.length} medan utama diisi bagi setiap rekod.`)}
          </p>
        </section>
        <div className={sp.recordCol} ref={recRef}>
          {loaded && open.size === 0 && (
            <section className={card}>
              <p className={sp.empty}><AppIcon name="identification" />{L("Choose someone on the left to open their record — personal details, employment, role, bank and statutory numbers, documents and emergency contact.", "Pilih seseorang di sebelah kiri untuk buka rekodnya — butiran peribadi, pekerjaan, peranan, nombor bank dan statutori, dokumen dan hubungan kecemasan.")}</p>
            </section>
          )}
      {ranked.map((u) => {
        if (!open.has(u.id)) return null;
        const pv = privateOf[u.id] ?? null;
        /* the record as stored: the list row and, for the HR tier, its private block */
        const base = { ...u, ...(pv ?? {}) } as Staff;
        const merged = { ...base, ...draft[u.id] } as Staff;
        const editing = editingId === u.id;
        const dirty = Object.keys(draft[u.id] ?? {}).length > 0;
        const lockedF = (key: keyof Staff) => readOnly || !editing || (!canAmend && Boolean(String(base[key] ?? "").trim()));
        const valueOf = (key: keyof Staff) => {
          const raw = (draft[u.id]?.[key] as string) ?? (base[key] as string) ?? "";
          return (DATE_KEYS as readonly string[]).includes(key as string) ? isoToDMY(raw) : raw;
        };
        const isPriv = (k: keyof Staff) => (PRIVATE_KEYS as readonly string[]).includes(k as string);
        const secCount = (key: RecordSectionKey) => {
          const sec = RECORD_SECTIONS.find((x) => x.key === key);
          if (sec) return [sec.fields.filter(([k]) => isFilled(u, k)).length, sec.fields.length] as const;
          if (key === "role") return [[Boolean(u.role_title?.trim()), responsibilityLines(u.responsibilities).length > 0, Boolean(managerOf(u)) || u.role === "ceo"].filter(Boolean).length, 3] as const;
          return null;
        };
        const tenure = (() => {
          if (!u.joined_on) return "";
          const end = isGone(u) && u.left_on ? u.left_on : todayS;
          const [y1, m1, d1] = u.joined_on.slice(0, 10).split("-").map(Number) as [number, number, number];
          const [y2, m2, d2] = end.split("-").map(Number) as [number, number, number];
          let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
          if (months < 0) months = 0;
          const yy = Math.floor(months / 12), mm = months % 12;
          return L(`${yy ? `${yy} year${yy === 1 ? "" : "s"} ` : ""}${mm} month${mm === 1 ? "" : "s"}`, `${yy ? `${yy} tahun ` : ""}${mm} bulan`);
        })();
        const field = (key: keyof Staff, label: string) => {
          const restricted = isPriv(key) && !canPrivate;
          const masked = key === "ic_number" && !editing && Boolean(base.ic_number);
          return (
            <label key={key} className={sp.field}>
              <span className={sp.fieldLabel}>
                {L(label, FIELD_LABEL_MS[key] ?? label)}
                {editing && lockedF(key) && !restricted && <AppIcon name="lock" />}
              </span>
              {restricted ? (
                <span className={sp.restricted}><AppIcon name="lock" />{isFilled(u, key) ? L("On file · restricted", "Ada dalam rekod · terhad") : L("Not on file", "Tiada dalam rekod")}</span>
              ) : SELECT_FIELDS[key as string] ? (
                <select className={input} value={valueOf(key)} disabled={lockedF(key)}
                  title={editing && lockedF(key) ? L("Locked — amendments are made by the CEO or an admin", "Dikunci — pindaan dibuat oleh CEO atau admin") : undefined}
                  onChange={(e) => set(u.id, key, e.target.value)}>
                  <option value="">{L("— select —", "— pilih —")}</option>
                  {SELECT_FIELDS[key as string]!.map((o) => (
                    <option key={o} value={o}>{L(o.replace("_", " "), STATUS_MS[o] ?? o.replace("_", " "))}</option>
                  ))}
                </select>
              ) : (
                <><input className={input} value={masked ? maskIc(base.ic_number ?? "") : valueOf(key)} disabled={lockedF(key)}
                  list={key === "position" ? POSITIONS_DATALIST : undefined /* v1.322.0 - the positions list as suggestions; another title may still be typed */}
                  placeholder={editing && FIELD_PLACEHOLDERS[key] ? L(FIELD_PLACEHOLDERS[key]!, FIELD_PLACEHOLDERS_MS[key] ?? FIELD_PLACEHOLDERS[key]!) : undefined}
                  title={editing && lockedF(key)
                    ? L("Locked — amendments are made by the CEO or an admin", "Dikunci — pindaan dibuat oleh CEO atau admin")
                    : (FIELD_TITLES[key] ? L(FIELD_TITLES[key]!, FIELD_TITLES_MS[key] ?? FIELD_TITLES[key]!) : undefined)}
                  onChange={(e) => set(u.id, key, e.target.value)} />
                {key === "position" && editing && <PositionHint value={valueOf(key)} role={u.role} list={posData?.positions} onRole={() => setRecSection("role")} />}</>
              )}
            </label>
          );
        };
        const SECTIONS: [RecordSectionKey, string, AppIconName, string][] = [
          ["personal", L("Personal Details", "Butiran Peribadi"), "person", L("Basic information and identity details.", "Maklumat asas dan butiran identiti.")],
          ["employment", L("Employment", "Pekerjaan"), "orders", L("Employment information, dates and employment status.", "Maklumat pekerjaan, tarikh dan status pekerjaan.")],
          ["role", L("Role & Access", "Peranan & Akses"), "access", L("Role title, responsibilities, reporting line and system role.", "Gelaran peranan, tanggungjawab, garis pelaporan dan peranan sistem.")],
          ["bank", L("Bank & Statutory", "Bank & Statutori"), "money", L("Bank account details, EPF (KWSP), SOCSO (PERKESO) and tax (LHDN).", "Butiran akaun bank, KWSP, PERKESO dan cukai (LHDN).")],
          ["documents", L("Documents", "Dokumen"), "document", L("Staff documents such as offer letter, contract and certifications.", "Dokumen kakitangan seperti surat tawaran, kontrak dan sijil.")],
          ["emergency", L("Emergency Contact", "Hubungan Kecemasan"), "person", L("Next of kin and emergency contact information.", "Maklumat waris dan hubungan kecemasan.")],
        ];
        const cur = SECTIONS.find(([k]) => k === recSection) ?? SECTIONS[0]!;
        const photo = u.photo_key ? `/api/v1/media/file/${encodeURIComponent(u.photo_key)}` : "";
        return (
          <section key={u.id} className={card} aria-label={L(`Record of ${displayName(u)}`, `Rekod ${displayName(u)}`)} data-testid="staff-record">
            <button type="button" className={`${btnSm} erp-phone-only ${sp.backBtn}`} onClick={() => { setOpen(new Set()); setEditingId(null); }}>
              <AppIcon name="previous" />{L("All records", "Semua rekod")}
            </button>
            <div className={sp.recHead}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photo ? <img className={sp.recPhoto} src={photo} alt={L(`Photo of ${displayName(u)}`, `Foto ${displayName(u)}`)} />
                : <span className={`${sp.recPhoto} ${sp.photoNone}`}><AppIcon name="person" /></span>}
              <span className={sp.recWho}>
                <strong className={sp.recName}>{displayName(u)}</strong>
                <span className={sp.muted}>{[u.employee_id, u.position || roleLabel(u.role)].filter(Boolean).join(" · ")}</span>
                <span className={sp.recMeta}>
                  {stateChip(u)}
                  {u.joined_on && <span><AppIcon name="date" />{L(`Joined ${dmy(u.joined_on)}`, `Mula ${dmy(u.joined_on)}`)}</span>}
                  {tenure && <span><AppIcon name="time" />{tenure}</span>}
                  {!u.full_name?.trim() && <span className={chipSmWarn}><AppIcon name="warning" />{L("no full name", "tiada nama penuh")}</span>}
                </span>
              </span>
              <span className={sp.recActions}>
                {canPrivate && <button type="button" className={btnSm} onClick={() => void printWithPrivate([u])}><AppIcon name="print" />{L("Print ID", "Cetak ID")}</button>}
                {canPrivate && <button type="button" className={btnSm} onClick={() => setRecSection("documents")}><AppIcon name="upload" />{L("Upload Document", "Muat Naik Dokumen")}</button>}
                <button type="button" className={btnSm} onClick={() => setHistoryFor(u.id)} data-testid="rec-history"><AppIcon name="time" />{L("History", "Sejarah")}</button>
                {!readOnly && !editing && <button type="button" className={btnSm} onClick={() => setEditingId(u.id)} data-testid="rec-edit"><AppIcon name="edit" />{L("Edit", "Sunting")}</button>}
                {!readOnly && editing && <button type="button" className={btnSm} onClick={() => { setDraft((d) => ({ ...d, [u.id]: {} })); setEditingId(null); setRowMsg((m) => ({ ...m, [u.id]: "" })); }} data-testid="rec-cancel">{L("Cancel", "Batal")}</button>}
                {!readOnly && editing && <button type="button" className={btnSmPrimary} disabled={!dirty} onClick={() => void save(u.id, displayName(u))} data-testid="rec-save"><AppIcon name="save" />{L("Save", "Simpan")}</button>}
              </span>
            </div>
            {(saved === u.id || rowMsg[u.id]) && (
              <p className={rowMsg[u.id] ? sp.warnText : sp.okText} role="status">{rowMsg[u.id] || L("Saved ✓", "Disimpan ✓")}</p>
            )}
            <div className={sp.secTabs}><LineTabs label={L("Record sections", "Bahagian rekod")} value={recSection} onChange={setRecSection} tabs={SECTIONS.map(([k, label]) => [k, label] as const)} /></div>
            <div className={sp.secBody}>
              <p className={sp.secTitle}><AppIcon name={cur[2]} /><span><strong>{cur[1]}</strong><span>{cur[3]}</span></span></p>

              {recSection === "personal" && (
                <div className={sp.personal}>
                  <div className={sp.photoCol}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {photo ? <img className={sp.bigPhoto} src={photo} alt="" /> : <span className={`${sp.bigPhoto} ${sp.photoNone}`}><AppIcon name="person" />{L("No photo", "Tiada foto")}</span>}
                    {!readOnly && (
                      <label className={`${btnSm} ${sp.photoBtn}`}>
                        <AppIcon name="upload" />{u.photo_key ? (canAmend ? L("Change Photo", "Tukar Foto") : L("Photo set (locked)", "Foto ditetapkan (dikunci)")) : L("Upload Photo", "Muat Naik Foto")}
                        <input type="file" accept="image/*" className={sp.srOnly} disabled={Boolean(u.photo_key) && !canAmend}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (!file) return;
                            setRowMsg((m) => ({ ...m, [u.id]: "" }));
                            const compressed = await compressImage(file);
                            const res = await csrfFetch(`${API}/users/${u.id}/photo`, { method: "POST", headers: { "Content-Type": compressed.type || "image/jpeg" }, body: compressed });
                            if (res.ok) {
                              setSaved(u.id);
                              window.setTimeout(() => setSaved(null), 3000);
                              showToast(L("Photo uploaded", "Foto dimuat naik"), `${displayName(u)} — ${L("badge photo saved", "foto lencana disimpan")}`);
                              void load();
                            } else {
                              const j = (await res.json().catch(() => null)) as ErrShape | null;
                              setRowMsg((m) => ({ ...m, [u.id]: j?.error?.message ?? L("Photo upload failed", "Muat naik foto gagal") }));
                              showToast(L("Photo upload failed", "Muat naik foto gagal"), j?.error?.message ?? `${displayName(u)} — ${L("try again", "cuba lagi")}`, "notice");
                            }
                          }} />
                      </label>
                    )}
                    <span className={sp.hint}>{L("JPG, PNG", "JPG, PNG")}</span>
                  </div>
                  <div className={sp.fields}>
                    {RECORD_SECTIONS.find((x) => x.key === "personal")!.fields.map(([k, label]) => field(k, label))}
                    <label className={sp.field}>
                      <span className={sp.fieldLabel}>{L("Work email (Users & Security)", "E-mel kerja (Pengguna & Keselamatan)")}</span>
                      <input className={input} value={u.email} disabled readOnly />
                    </label>
                  </div>
                  {canPrivate && (
                    <div className={sp.badgeRow}>
                      <button type="button" className={btnSm} onClick={() => setPreview((p) => (p === u.id ? null : u.id))}>
                        <AppIcon name="preview" />{preview === u.id ? L("Hide ID preview", "Sembunyikan pratonton ID") : L("Preview ID", "Pratonton ID")}
                      </button>
                      {preview === u.id && <div className={sp.badgePreview}><BadgePreview s={merged} /></div>}
                    </div>
                  )}
                </div>
              )}

              {(recSection === "employment" || recSection === "bank" || recSection === "emergency") && (
                recSection === "bank" && !canPrivate ? (
                  <p className={sp.empty}><AppIcon name="lock" />{L("Bank and statutory details are open to HR and the CEO only.", "Butiran bank dan statutori dibuka kepada HR dan CEO sahaja.")}</p>
                ) : (
                  <div className={sp.fields}>
                    {RECORD_SECTIONS.find((x) => x.key === recSection)!.fields.map(([k, label]) => field(k, label))}
                    {recSection === "employment" && (
                      <>
                        <div className={sp.field}>
                          <span className={sp.fieldLabel}>{L("Employment status", "Status pekerjaan")}</span>
                          <span>{stateChip(u)}</span>
                        </div>
                        {u.employment_status === "probation" && (
                          <div className={sp.field}>
                            <span className={sp.fieldLabel}>{L("Probation", "Percubaan")}</span>
                            {openHrLifecycle ? <button type="button" className={btnSm} onClick={openHrLifecycle}><AppIcon name="external" />{L("Review in HR", "Semak di HR")}</button> : <span className={sp.muted}>{L("Reviewed in HR", "Disemak di HR")}</span>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              )}
              {recSection === "employment" && canAmend && !["resigned", "terminated"].includes(u.employment_status ?? "") && (
                <p className={sp.actionsRow}>
                  <button type="button" className={rowBtnDanger} onClick={() => setOffboard({ id: u.id, name: displayName(u) })}>
                    <AppIcon name="offboard" />{L("Offboard", "Tamatkan khidmat")}
                  </button>
                  <span className={sp.hint}>{L("Last day, handover and account access in one audited step.", "Hari terakhir, serahan dan akses akaun dalam satu langkah yang diaudit.")}</span>
                </p>
              )}

              {recSection === "role" && (
                <>
                  <dl className={sp.facts}>
                    <div><dt>{L("Reporting supervisor", "Penyelia pelaporan")}</dt><dd>
                      {u.role === "ceo" ? <span className={sp.muted}>{L("None — the CEO is the highest authority", "Tiada — CEO ialah kuasa tertinggi")}</span>
                        : managerOf(u) ? <button type="button" className={sp.pill} onClick={() => setPeek(managerOf(u)!.id)}><Avatar name={displayName(managerOf(u)!)} photoKey={managerOf(u)!.photo_key} size="sm" />{displayName(managerOf(u)!)}</button>
                        : <span className={sp.muted}>{L("Not on the chart", "Tiada pada carta")}</span>}
                      {" "}<button type="button" className={btnSm} onClick={() => setTab("org")}>{L("Organisation", "Organisasi")}</button>
                    </dd></div>
                    <div><dt>{L("Department", "Jabatan")}</dt><dd>{deptName(u) || <span className={sp.muted}>—</span>}</dd></div>
                    <div><dt>{L("System role (portal access)", "Peranan sistem (akses portal)")}</dt><dd>
                      {canSetRole && !readOnly ? (
                        <select className={input} value={u.role} disabled={!roleEditable(u.role)}
                          title={roleEditable(u.role) ? L("Which tabs they see — recorded with your name", "Tab yang mereka lihat — direkodkan dengan nama anda") : L("Executive roles are set by the system administrator", "Peranan eksekutif ditetapkan oleh pentadbir sistem")}
                          onChange={(e) => void changeRole(u, e.target.value)}>
                          {roleEditable(u.role) ? roleChoices(u.role).map((r) => <option key={r} value={r}>{roleLabel(r)}</option>) : <option value={u.role}>{roleLabel(u.role)}</option>}
                        </select>
                      ) : <span className={sp.cap}>{roleLabel(u.role)}</span>}
                    </dd></div>
                  </dl>
                  <p className={sp.hint}><AppIcon name="lock" />{L("A job's responsibilities never grant a system permission — sign-in, MFA and access are kept in Users & Security.", "Tanggungjawab kerja tidak pernah memberi kebenaran sistem — log masuk, MFA dan akses disimpan dalam Pengguna & Keselamatan.")}</p>
                  {(u.is_active || u.role_title || u.responsibilities) ? (
                    <ResponsibilitiesBlock userId={u.id} personName={displayName(u)}
                      value={{ role_title: u.role_title, responsibilities: u.responsibilities, responsibilities_updated_at: u.responsibilities_updated_at, responsibilities_updated_by_name: u.responsibilities_updated_by_name }}
                      canEdit={canEditResponsibilities && Boolean(u.is_active)}
                      onSaved={(next) => {
                        const mergeR = (list: Staff[]) => list.map((x) => (x.id === u.id ? { ...x, ...next } : x));
                        setStaff(mergeR); setAllStaff(mergeR); void load();
                      }} />
                  ) : null}
                </>
              )}

              {recSection === "documents" && <StaffVault userId={u.id} name={displayName(u)} onOpenHr={openHrLifecycle} />}
            </div>

            <ul className={sp.secRows} aria-label={L("Other sections", "Bahagian lain")}>
              {SECTIONS.filter(([k]) => k !== recSection).map(([k, label, icon, sub]) => {
                const c = secCount(k);
                return (
                  <li key={k}><button type="button" onClick={() => setRecSection(k)}>
                    <span className={`${sp.well} ${sp.goldWell}`} aria-hidden><AppIcon name={icon} /></span>
                    <span className={sp.attnText}><strong>{label}</strong><span>{sub}</span></span>
                    {c && <span className={c[0] === c[1] ? chipSmSuccess : chipSmWarn}>{c[0] === c[1] ? "✓ " : ""}{c[0]}/{c[1]}</span>}
                    <AppIcon name="next" />
                  </button></li>
                );
              })}
            </ul>
          </section>
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

      {/* v1.308.0 (S-12) - one person's change history: who changed what, when.
          A private field is named, never valued. */}
      <SideDrawer open={historyFor !== null} onClose={() => setHistoryFor(null)}
        title={L("Change history", "Sejarah perubahan")}
        subtitle={historyFor !== null ? displayName(staff.find((x) => x.id === historyFor) ?? { name: "", full_name: "" } as Staff) : undefined}>
        <div className={sp.drawer} data-testid="rec-history-list">
          {historyView.loading && !historyView.data ? <SkelRows rows={4} /> : historyView.failed && !historyView.data ? (
            <p className={sp.empty}><AppIcon name="lock" />{L("The history could not be read.", "Sejarah tidak dapat dibaca.")}</p>
          ) : (historyView.data?.entries ?? []).length === 0 ? (
            <p className={sp.empty}><AppIcon name="info" />{L("No recorded change yet.", "Belum ada perubahan direkodkan.")}</p>
          ) : (
            <ol className={sp.history}>
              {(historyView.data?.entries ?? []).map((e) => (
                <li key={e.id}>
                  <strong>{HISTORY_LABEL[e.action] ? L(HISTORY_LABEL[e.action]![0], HISTORY_LABEL[e.action]![1]) : e.action.replace(/^staff\./, "").replace(/_/g, " ")}</strong>
                  <span className={sp.muted}>{dmy(e.created_at.slice(0, 10))} · {e.by_name ? properName(e.by_name) : "—"}</span>
                  {historyLine(e.action, e.detail) && <span>{historyLine(e.action, e.detail)}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </SideDrawer>

      {/* v1.308.0 - Add staff to department (reference 05): the same record
          field, the same lock - HR fills an empty department; the CEO or an
          admin moves somebody who already has one */}
      <SideDrawer open={deptAdd !== null} onClose={() => setDeptAdd(null)}
        title={L(`Add staff to ${deptAdd ?? ""}`, `Tambah kakitangan ke ${deptAdd ?? ""}`)}>
        <div className={sp.drawer}>
          <p className={sp.hint}>{canAmend ? L("Anyone working here can be moved; their current department is shown.", "Sesiapa yang bekerja boleh dipindahkan; jabatan semasa mereka dipaparkan.")
            : L("You can place people who have no department yet. Moving someone from a department is for the CEO or an admin.", "Anda boleh meletakkan orang yang belum mempunyai jabatan. Memindahkan dari jabatan lain untuk CEO atau admin.")}</p>
          <ul className={sp.miniList}>
            {staff.filter((u) => !isGone(u) && deptName(u) !== deptAdd && (canAmend || !deptName(u))).map((u) => (
              <li key={u.id}>
                <span className={sp.personText}><strong>{displayName(u)}</strong><span>{deptName(u) || noDept}</span></span>
                <button type="button" className={btnSm} onClick={async () => {
                  const r = await api<ErrShape>(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ department: deptAdd, expect: { department: u.department ?? "" } }) });
                  if (r.ok) { showToast(L("Department set", "Jabatan ditetapkan"), `${displayName(u)} → ${deptAdd}`); void load(); }
                  else showToast(L("Not changed", "Tidak diubah"), r.data?.error?.message ?? L("The server refused that", "Pelayan menolaknya"), "notice");
                }}>{L("Add here", "Tambah di sini")}</button>
              </li>
            ))}
          </ul>
        </div>
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
            "Company emails (@a2zcreative.my) aren't Google accounts, so staff can't self-register — create the account here with a temporary password and hand it over. They change it on first sign-in.",
            "E-mel syarikat (@a2zcreative.my) bukan akaun Google, jadi kakitangan tidak boleh mendaftar sendiri — cipta akaun di sini dengan kata laluan sementara dan serahkan kepada mereka. Mereka menukarnya pada log masuk pertama.",
          )}
        </p>
        {/* v1.4.135: every placeholder field carries a SUBHEAD label above it,
            so the field's purpose stays visible after typing. */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Sub t={L("Company email", "E-mel syarikat")}>
            <input className={input} placeholder="name@a2zcreative.my" value={newStaff.email}
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
            <input className={input} placeholder={L("e.g. Marketing Executive", "cth. Eksekutif Pemasaran")} value={newStaff.position} list={POSITIONS_DATALIST}
              onChange={(e) => setNewStaff((d) => ({ ...d, position: e.target.value }))} />
            <PositionHint value={newStaff.position} role={newStaff.role} list={posData?.positions} />
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
function StaffVault({ userId, name, onOpenHr }: { userId: number; name: string; onOpenHr?: () => void }) {
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
      {/* v1.306.0 - HR 4.0 (H-3): read here; ticked in HR > Employee Lifecycle, the checklist's one editor */}
      <p className="text-muted-foreground mt-3 text-[11px] font-semibold tracking-wide uppercase">{L("Onboarding checklist", "Senarai semak onboarding")} · {ONBOARDING_ITEMS.filter(([k]) => onb[k]).length}/{ONBOARDING_ITEMS.length}</p>
      <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3" aria-label={L("Onboarding checklist", "Senarai semak onboarding")} data-testid="staff-onboarding-readonly">
        {ONBOARDING_ITEMS.map(([k, l]) => (
          <li key={k} className="flex items-center gap-1.5 text-xs">
            <AppIcon name={onb[k] ? "success" : "pending"} className="h-3.5 w-3.5" />
            <span className={onb[k] ? "text-muted-foreground" : ""}>{L(l, ONBOARDING_MS[k] ?? l)}</span>
          </li>
        ))}
      </ul>
      {onOpenHr && <button type="button" className={`${btnSm} mt-2`} onClick={onOpenHr} data-testid="staff-open-hr-joining"><AppIcon name="external" />{L("Tick steps in HR > Employee Lifecycle", "Tanda langkah di HR > Kitaran Pekerja")}</button>}
    </div>
  );
}
