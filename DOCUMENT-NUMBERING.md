# DOCUMENT-NUMBERING.md — Sales Document Numbering Specification

**Status:** Adopted v1.2.7 (25 Jul 2026) · Applies to: /portal → Sales (QT, DO, INV + future doc types)

---

## 1. Adopted format (v1.2.7)

```
{TYPE}{YYYYMMDD}-{NN}-AZOO
```

| Part | Meaning | Example |
|---|---|---|
| `TYPE` | Document type code | `QT`, `DO`, `INV` |
| `YYYYMMDD` | Issue date | `20260725` |
| `NN` | Daily running number per type, 2 digits, resets each day | `01` |
| `AZOO` | Issuer code — AZ One Official | `AZOO` |

**Examples:**
- `QT20260725-01-AZOO` — first quotation issued 25 Jul 2026
- `DO20260725-01-AZOO` — first delivery order that day
- `INV20260725-03-AZOO` — third invoice that day

### Why this refinement of `DO20260725-AZOO`
The proposed date-based format is a good direction — the issue date is readable at a glance, which the old yearly counter didn't give. Two adjustments were needed:

1. **Daily sequence (`-NN-`)** — without it, two documents of the same type on the same day would collide. Two digits allow 99/day per type; if volume ever exceeds that, widen to `NNN` (the parser below already tolerates both).
2. **Issuer code kept at the end** — clients filing documents from multiple vendors can identify the issuer instantly; it also survives filename truncation better than a prefix.

### Rules
- Numbers are **immutable once issued** — a cancelled document keeps its number and is marked VOID (required for a clean audit trail and for LHDN e-Invoice, where invoice numbers must be unique and gaps explainable).
- **Document chain is stored, not encoded**: a DO stores the source QT id, an INV stores its DO/QT ids. Printed docs show `Ref: QT20260722-02-AZOO`. Encoding the chain inside the number itself was considered and rejected — it breaks when one QT produces multiple DOs.
- Sorting: the format sorts chronologically as plain text within a type.
- Allowed characters (letters, digits, hyphen) are compatible with LHDN MyInvois e-Invoice document number fields.

### Recommended future doc types (same format)
| Code | Document | When |
|---|---|---|
| `OR` | Official Receipt | when payment recording ships |
| `CN` | Credit Note | returns/corrections (needed for e-Invoice compliance) |
| `PO` | Purchase Order | if procurement is added |

---

## 2. Migration

- Documents numbered under the old scheme (`QT202600001` style) **remain valid and unchanged**. Do not renumber — history must stay traceable.
- New format takes effect for documents issued **on or after the v1.2.7 deploy date**.
- The Sales list views should display both formats transparently (no format filter needed — both are plain strings).
- D1: counters live in `doc_counters_daily` keyed by `(doc_type, day)`; see `docNumber()` in `worker/src/staff.ts` and migration `0005_doc_numbering_daily.sql`.

---

## 3. History (do not remove)

| Version | Date | Scheme | Notes |
|---|---|---|---|
| v1.2.0–v1.2.6 | 2026 | `{TYPE}{YYYY}{NNNNN}` e.g. `QT202600001` | Yearly running counter per type. Retired for new docs from v1.2.7; existing numbers preserved. |
| v1.2.7 | 25 Jul 2026 | `{TYPE}{YYYYMMDD}-{NN}-AZOO` | Date-based with daily sequence + issuer code. Adopted from Alīf's proposal `DO20260725-AZOO`, refined with a daily sequence to prevent same-day collisions. |


## v1.4.4 — current format: {TYPE}-AZOO{DDMMYY}-{X}

Examples: `QT-AZOO300726-1`, `DO-AZOO300726-2`, `INV-AZOO010826-1`.

- `TYPE` — QT (quotation), DO (delivery order), INV (invoice)
- `AZOO` — company mark, now positioned after the type per business preference
- `DDMMYY` — issue date in Malaysia time (UTC+8)
- `X` — running number for that type on that day, starting at 1, no padding

Counters remain per-type-per-day in `doc_counters_daily` (migration 0005), so
the sequence resets each business day and two documents can never share a
number. **Documents already issued under earlier formats keep their numbers** —
formats are never applied retroactively and numbers are never reissued.

## History (do not remove)
| Version | Format | Example |
|---|---|---|
| v1.2.5 | {TYPE}2026{NNNNN} (yearly counter) | QT202600001 |
| v1.2.7 | {TYPE}{YYYYMMDD}-{NN}-AZOO (daily counter) | DO20260725-01-AZOO |
| v1.4.4 | {TYPE}-AZOO{DDMMYY}-{X} (daily counter) | QT-AZOO300726-1 |
