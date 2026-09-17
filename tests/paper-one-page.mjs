/**
 * PAPER PRINTS ONE PAGE, ON A PHONE TOO — guard #80, v1.158.1.
 *
 * The CEO, 13-09-2026: *"when I create invoice in Mobile apps view, the pdf
 * generate 2 page instead of the 1 pages format which is being used in Web
 * view! this is unacceptable!"*
 *
 * Every A2Z document is designed as ONE A4 page (v1.99.2). Two things made a
 * phone print two:
 *
 *   1. The print window carried a device-width viewport, so a phone laid the
 *      page out at 390px - every flex row crushed, every description wrapped
 *      three times - and Save as PDF paginated THAT. The viewport must be the
 *      paper: 794px (A4 at 96dpi), and the html/body 210mm wide.
 *   2. The print min-height was a fixed 296mm. A phone browser keeps its own
 *      print margins whatever @page says, so 296mm did not fit the printable
 *      height and the footer alone became page two. In print, 100vh is the
 *      page the browser is actually going to print on.
 *
 * And on a phone the PDF button no longer goes through the browser's print
 * dialog at all: it opens the real one-page file the Share button has always
 * built (lib/doc-pdf.ts). A desk keeps the print dialog.
 *
 * The same two rules hold for every A4 print window the portal writes: the
 * sales document (lib/doc-template.ts), the statement of account
 * (components/portal/sales.tsx) and the claim form (role-panels.tsx).
 *
 * Negative-tested by: restoring width=device-width in doc-template (1);
 * restoring min-height: 296mm in the SOA (2); removing the matchMedia branch
 * from printDoc (3).
 *
 * Run: node tests/paper-one-page.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const papers = [
  ["the sales document", "lib/doc-template.ts"],
  ["the statement of account", "components/portal/sales.tsx"],
  ["the claim form", "components/portal/role-panels.tsx"],
];
for (const [name, file] of papers) {
  const src = read(file);
  /* only the A4 print windows: the block from the viewport meta to </style> */
  const windows = [...src.matchAll(/<meta name="viewport" content="([^"]*)">[\s\S]*?<\/style>/g)];
  ok(`${name} writes at least one print window`, windows.length >= 1, file);
  for (const w of windows) {
    const block = w[0];
    ok(`${name}: the viewport is the paper, not the device`, w[1] === "width=794", w[1]);
    ok(`${name}: the html is never narrower than A4`, /html \{ min-width: 210mm; \}/.test(block));
    ok(`${name}: the body is 210mm wide on screen`, /width: 210mm; max-width: 210mm; margin-inline: auto;/.test(block));
    ok(`${name}: ...and in print`, /@media print \{ html, body \{ width: 210mm; \}/.test(block));
    ok(`${name}: the print min-height follows the printable page, not a fixed 296mm`, /min-height: calc\(100vh - 2mm\)/.test(block) && !/@media print[^\n]*min-height: 29\dmm/.test(block));
    ok(`${name}: A4 with no page margin of its own`, /@page \{ size: A4; margin: 0; \}/.test(block));
  }
}

/* the PDF button on a phone */
{
  const sales = read("components/portal/sales.tsx");
  const fn = sales.slice(sales.indexOf("export async function printDoc("), sales.indexOf("/* v1.4.191 CLIENT LAYER"));
  ok("printDoc provides the real one-page PDF in a closable viewer",
    /openDocumentPreview/.test(fn) && /const blob = await buildDocPdf\(doc\);/.test(fn) && /blob, filename:/.test(fn) && !/window\.open/.test(fn));
  ok("...and keeps the shared HTML for printing", /html: buildDocHtml\(doc, false\)/.test(fn));
  ok("...built by the same file the Share button uses", /import \{ buildDocPdf \} from "@\/lib\/doc-pdf";/.test(sales));
}

console.log(failed === 0
  ? `paper-one-page: ${passed} checks passed.`
  : `\n${failed} paper-one-page check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
