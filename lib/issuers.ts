/* v1.27.0, completed v1.28.0 — DOCUMENT ISSUER IDENTITY: the single source of
   truth for the legal entity whose name, registration numbers, registered
   address and bank account appear on a document we hand to a customer or an
   employee.

   THE THREE-IDENTITY MODEL
   ------------------------
   1) PUBLIC / MARKETING identity — constants/site.ts (SITE_CONFIG).
      A2Z CREATIVE MARKETING is the parent company and the outward-facing
      brand: the website, meta tags, taglines, social copy.

   2) LEGAL / DOCUMENT-ISSUER identity — THIS FILE.
      The entity that quotes, invoices, receipts, credits, employs and banks.
      From v1.28.0 the OPERATING issuer (DOCUMENT_ISSUER — used for every NEW
      document) is A2Z CREATIVE MARKETING, on the CEO's decision of
      19-08-2026: "A2Z invoices, A2Z employs", registered address and Maybank
      account supplied the same day.

   3) BUSINESS-UNIT identity — AZ ONE OFFICIAL, the consultancy. A SEPARATE
      legal entity (SSM 202603168673 / JM1046169-H), and the issuer of every
      document created BEFORE the switch.

   THE ONE RULE THAT KEEPS THIS LEGALLY CLEAN
   ------------------------------------------
   A document forever shows the entity that ISSUED it. Documents carry an
   `issuer_code` stamped at creation/release time (migration 0073):
     NULL  -> legacy row, issued before the switch -> AZ ONE OFFICIAL
     'a2z' -> A2Z CREATIVE MARKETING
     'azoo'-> AZ ONE OFFICIAL (explicit)
   Renderers resolve it with resolveIssuer() below. Re-printing a 2026-07
   invoice therefore still shows AZ ONE's letterhead and AZ ONE's bank
   account — the account the customer was told to pay and the entity that
   was liable. Only documents issued after the switch carry A2Z.

   tests/document-issuer-guard.mjs enforces: DOCUMENT_ISSUER is A2Z with the
   exact CEO-supplied bank account; AZ_ONE remains complete and reachable for
   legacy rendering; no document generator reads SITE_CONFIG.

   Letterheads are deliberately English-only — they are legal identification,
   not UI copy, so they do not go through L("EN","BM"). */

/** An entity we can legally issue documents as: every field is known. */
export interface Issuer {
  /** Stable technical code, stored in documents' issuer_code column. */
  readonly code: "azoo" | "a2z";
  /** Legal name, exactly as it must be printed. Uppercase on documents. */
  readonly name: string;
  /** Current SSM registration number. */
  readonly ssm: string;
  /** Legacy (pre-SSM-renumbering) registration number. */
  readonly oldReg: string;
  /** Both numbers, in the form every document prints them. */
  readonly registration: string;
  /** One-line business descriptor printed before the registration on the
      letterhead ("Live Commerce Agency - SSM ..."). */
  readonly descriptor: string;
  /** Registered address, one entry per printed line. */
  readonly addressLines: readonly string[];
  /** Registered address as a single line, for one-line letterheads. */
  readonly address: string;
  readonly email: string;
  readonly whatsapp: string;
  /** Bare domain, for footers that print it without a scheme. */
  readonly website: string;
  /** Full URL, for letterheads that print the scheme. */
  readonly websiteUrl: string;
  readonly slogan: string;
  /** Bank and account number for payment instructions. */
  readonly bank: string;
  /** Account holder name — must match `name`, or the bank rejects payment. */
  readonly bankHolder: string;
  /** When false, documents must carry the "no SST charged" note. */
  readonly sstRegistered: boolean;
  /** HR form template IDs + versions — the claim/leave form letterhead names
      the employer, so a different issuer is a different controlled document
      and must carry its own document number and version. */
  readonly claimFormNo: string;
  readonly claimFormVersion: string;
  readonly leaveFormNo: string;
  readonly leaveFormVersion: string;
}

/** AZ ONE OFFICIAL — the consultancy business unit; the issuer of every
    document created before the v1.28.0 switch, and the letterhead every
    legacy document keeps forever. Values verbatim from the pre-refactor
    generators (doc-pdf.ts letterhead/bank/slogan blocks). */
export const AZ_ONE: Issuer = {
  code: "azoo",
  name: "AZ ONE OFFICIAL",
  ssm: "202603168673",
  oldReg: "JM1046169-H",
  registration: "SSM 202603168673 (JM1046169-H)",
  descriptor: "Live Commerce Agency",
  addressLines: [
    "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika,",
    "81200 Johor Bahru, Johor, Malaysia",
  ],
  address:
    "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor, Malaysia",
  email: "admin@azoneofficial.com",
  whatsapp: "+60 12-383 4821",
  website: "azoneofficial.com",
  websiteUrl: "https://azoneofficial.com",
  slogan: "Empowering Brands Through Live Commerce and Digital Connections",
  bank: "MAYBANK 5516 2328 7032",
  bankHolder: "AZ ONE OFFICIAL",
  sstRegistered: false,
  claimFormNo: "AZOO-HR-CLM-001",
  claimFormVersion: "002",
  leaveFormNo: "AZOO-HR-LVE-001",
  leaveFormVersion: "001",
};

/** A2Z CREATIVE MARKETING — the parent company, and from v1.28.0 the issuer
    of every NEW document. Facts supplied by the CEO on 19-08-2026:
      - registered address: same office as AZ ONE (34-02, Jalan Setia
        Tropika 1/1) — supplied verbatim;
      - Maybank account 5511 0086 5300, held in A2Z's name;
      - not SST-registered (CEO confirmation, 19-08-2026) — so the "no SST
        charged" note stays, naming A2Z;
      - contact email/WhatsApp unchanged (the A2Z domain is not registered
        yet; azoneofficial.com is the group's working domain until then).
    HR form IDs: an A2Z-issued claim/leave form is a NEW controlled document —
    new document numbers under the A2Z code, starting at version 001. Legacy
    prints keep the AZOO-HR-* IDs and their old versions. */
export const A2Z_CREATIVE: Issuer = {
  code: "a2z",
  name: "A2Z CREATIVE MARKETING",
  ssm: "202603003468",
  oldReg: "CA0414729-A",
  registration: "SSM 202603003468 (CA0414729-A)",
  descriptor: "Creative Marketing Agency",
  addressLines: [
    "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika,",
    "81200 Johor Bahru, Johor, Malaysia",
  ],
  address:
    "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor, Malaysia",
  email: "admin@azoneofficial.com",
  whatsapp: "+60 12-383 4821",
  website: "azoneofficial.com",
  websiteUrl: "https://azoneofficial.com",
  slogan: "Empowering brands through creative marketing, digital growth, and live commerce",
  bank: "MAYBANK 5511 0086 5300",
  bankHolder: "A2Z CREATIVE MARKETING",
  sstRegistered: false,
  claimFormNo: "A2Z-HR-CLM-001",
  claimFormVersion: "001",
  leaveFormNo: "A2Z-HR-LVE-001",
  leaveFormVersion: "001",
};

/* ------------------------------------------------------------------------ */

/** THE OPERATING ISSUER — stamped onto every NEW document the system creates.
    A2Z CREATIVE MARKETING since v1.28.0 (CEO decision + bank account
    supplied, 19-08-2026). */
export const DOCUMENT_ISSUER: Issuer = A2Z_CREATIVE;

/** Resolve a stored issuer_code to the issuer whose letterhead the document
    must carry. NULL/undefined = legacy row from before the switch = AZ ONE.
    Unknown codes fall back to AZ ONE (fail toward the historical issuer —
    never retroactively rebrand a legacy document). */
export function resolveIssuer(code?: string | null): Issuer {
  return code === "a2z" ? A2Z_CREATIVE : AZ_ONE;
}
