/**
 * CSV export guard (v1.74.0) — guard #22.
 *
 * Two different failures, both silent:
 *
 *   1. THE FILE. A CSV that Excel opens wrongly still opens — the file is not
 *      broken, it is just subtly untrue: names with diacritics turn to
 *      mojibake without a BOM, a comma in a value splits a row, and a cell
 *      beginning with = is EXECUTED. Nobody notices any of that in the
 *      browser, because the browser is not where the file is read. So this
 *      guard compiles lib/csv.ts and checks the actual output bytes rather
 *      than the shape of the source.
 *
 *   2. THE ROWS. The CEO asked for an export that follows the filters — "by
 *      follow to the filter that I want". If the button ever reads `rows`
 *      instead of the filtered set, it exports the whole month while showing
 *      one person, and the number in the file disagrees with the number on
 *      the screen. The table and the button therefore share ONE definition
 *      of what is visible, and that is asserted here.
 *
 *   node tests/csv-export.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- 1. the file Excel actually receives ---- */
const out = path.join(mkdtempSync(path.join(tmpdir(), "csv-guard-")), "csv.mjs");
try {
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["esbuild", path.join(root, "lib/csv.ts"), "--format=esm", `--outfile=${out}`],
    { stdio: "pipe" },
  );
} catch (e) {
  console.log(`FAIL — lib/csv.ts does not compile: ${e.message}`);
  process.exit(1);
}
const { buildCsv, csvCell } = await import(`file://${out}`);

{
  const file = buildCsv([["Staff", "Type"], ["Nur Nasuha binti Zainal Abidin", "In"]]);
  ok("the file starts with a UTF-8 BOM", file.charCodeAt(0) === 0xfeff,
     "without it Excel reads UTF-8 as the local code page and any diacritic arrives as mojibake");
  ok("rows are separated by CRLF", file.includes("\r\n") && !/[^\r]\n/.test(file),
     "Excel copes with LF; the accountants these files get forwarded to do not always");
  ok("a plain value is not quoted", csvCell("Nur Nasuha") === "Nur Nasuha");
  ok("a value containing a comma is quoted",
     csvCell("Abidin, Nur") === '"Abidin, Nur"',
     "otherwise one staff member becomes two columns and every column after it shifts");
  ok("a quote inside a value is doubled",
     csvCell('He said "hi"') === '"He said ""hi"""');
  ok("a newline inside a value is quoted", csvCell("a\nb") === '"a\nb"');
  /* Excel runs a cell that begins with = + - or @. The values in these
     exports are names and times today; "the data was harmless when I wrote
     the exporter" is how that hole gets shipped. */
  for (const dangerous of ["=SUM(A1)", "+1+1", "-2+3", "@SUM(A1)"]) {
    const cell = csvCell(dangerous);
    ok(`a formula cell is defused: ${dangerous}`, cell.startsWith("'") || cell.startsWith(`"'`),
       `produced ${cell} — Excel would execute this on open`);
  }
  ok("an empty cell stays empty", csvCell(null) === "" && csvCell(undefined) === "");
  ok("a number survives as a number", csvCell(1234) === "1234",
     "quoting a number makes Excel treat it as text and the column stops summing");
}

/* ---- 2. one definition of what is on screen ---- */
{
  const panels = read("components/portal/role-panels.tsx");
  ok("the visible set is defined once", /const exportRows = \(\): AttRecord\[\] => \{/.test(panels));
  ok("the table renders it", /\{exportRows\(\)\.map\(\(r\) => \(/.test(panels),
     "if the table filters separately from the export, the two disagree the first time a filter is added");
  ok("the export button uses it too", /const rows = exportRows\(\);/.test(panels));
  ok("the export never reaches for the unfiltered rows",
     !/downloadCsv\([\s\S]{0,600}?\brows\.map\(\(r\) => \{[\s\S]{0,200}?created_at/.test(panels) ||
     /const rows = exportRows\(\);/.test(panels));
  ok("the button says how many rows it will write",
     /⬇ CSV — \$\{exportRows\(\)\.length\}/.test(panels),
     "a download with a surprising row count is found out in Excel, which is too late");
  ok("the filename records what narrowed it",
     /\["attendance", month, q\.trim\(\)/.test(panels),
     "a folder of attendance(3).csv is a folder nobody can use");
  ok("the file's own header line names the filters",
     /\$\{L\("filters", "tapisan"\)\}/.test(panels),
     "the file outlives the screen it came from");
}

/* ---- 3. nothing hand-rolls a CSV any more ---- */
{
  const OFFENDERS = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(root, dir))) {
      if (e === "node_modules" || e === ".next") continue;
      const rel = `${dir}/${e}`;
      if (statSync(path.join(root, rel)).isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(e) || rel === "lib/csv.ts") continue;
      const src = read(rel);
      if (/type: "text\/csv/.test(src)) OFFENDERS.push(rel);
    }
  };
  const { readdirSync, statSync } = await import("node:fs");
  for (const d of ["app", "components", "lib"]) walk(d);
  ok("every client-side CSV goes through lib/csv.ts", OFFENDERS.length === 0,
     `${OFFENDERS.join(", ")} builds its own CSV blob — it will miss the BOM, the CRLF or the formula defusing`);
}

console.log(
  fails.length === 0
    ? `PASS — the file is one Excel reads correctly, and it holds exactly the rows on screen (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
