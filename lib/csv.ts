/**
 * CSV that Excel opens correctly — v1.74.0.
 *
 * Every export in this portal ends up in Excel on a Windows machine, and
 * four things have to be right or the file is quietly wrong rather than
 * broken:
 *
 *   1. THE BOM. Without it Excel reads UTF-8 as the local code page and
 *      "Nur Nasuha binti Zainal Abidin" is fine but the first name with an
 *      accent or a Malay diacritic arrives as mojibake.
 *   2. CRLF. Excel accepts LF, but Notepad and a few older importers do not,
 *      and these files get forwarded to accountants.
 *   3. QUOTING. A comma or a quote inside a value splits the row.
 *   4. FORMULA INJECTION. A cell beginning with = + - or @ is executed by
 *      Excel when the file is opened. The values here are staff names and
 *      times, so this is not today's threat — but "the data was harmless
 *      when I wrote the exporter" is exactly how that vulnerability gets
 *      into a product, and defusing it costs one character.
 *
 * Rows are arrays of strings or numbers; the first row is the header.
 * Nothing here formats numbers — a currency or date format is the caller's
 * decision, and it differs per export.
 */

/** One cell: defused, then quoted if it needs it. */
export function csvCell(v: string | number | null | undefined): string {
  const raw = v === null || v === undefined ? "" : String(v);
  /* A leading =, +, - or @ makes Excel treat the cell as a formula. A single
     quote in front tells it "this is text" and is not shown in the cell. */
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The whole file, BOM included, ready to be a Blob. */
export function buildCsv(rows: (string | number | null | undefined)[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Build it and hand it to the browser as a download.
 *
 * `name` should carry what the file IS, including whatever narrowed it —
 * a folder of files called export(3).csv is a folder nobody can use.
 */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]): void {
  const url = URL.createObjectURL(
    new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name.endsWith(".csv") ? name : `${name}.csv`;
  a.click();
  /* Freed on the next tick rather than immediately: Safari has not always
     finished reading the blob when click() returns. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `2026-08-30 14:07 MYT` — the stamp that goes in an export's header line. */
export function csvStampMyt(): string {
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  return `${now.slice(0, 10)} ${now.slice(11, 16)} MYT`;
}
