/**
 * The label extractor reads a catalog the way the shop needs it (v1.55.0).
 *
 * The CEO: "the portal can upload the PDF for this catalog without the
 * prices tag and it will automatically live price embedded to the PDF
 * uploaded." The extraction happens in her browser; THIS proves the shipped
 * geometry (lib/catalog-extract.ts imported directly, never a copy) and the
 * pdf.js reading path it will be fed from, in node.
 *
 * Two layers:
 *   1. Synthetic runs — the merge/filter/flip rules, case by case.
 *   2. A real PDF, written raw by this rig, read back through pdfjs-dist's
 *      node build exactly as the panel reads uploads — the label must come
 *      out once, priced text must be counted and excluded, and the box must
 *      sit where the text was drawn (top-left origin, the store's contract).
 *
 * Run: node --experimental-strip-types scratch/catalog-extract-check.mjs
 */
import { extractCatalogMap, MAX_SITES } from "../lib/catalog-extract.ts";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

/* Helvetica-ish runs: x/baseline in PDF space (bottom-left origin). */
const run = (str, x, baseline, width, height = 12) => ({ str, x, baseline, width, height });
const page = (runs, w = 595.28, h = 841.89) => ({ w, h, runs });

step("labels merge, prices and page furniture do not survive");
{
  const r = extractCatalogMap([page([
    run("Bawal", 100, 500, 34),          // one label, split by kerning
    run(" ", 134, 500, 3),
    run("lumi", 137.5, 500, 24),
    run("RM 36.00", 100, 484, 50),       // the printed price — a warning, never a site
    run("12", 500, 820, 12),             // a page number
    run("Shawl Aurora", 300, 500, 80),   // second label, same line band
  ])]);
  ok("two labels come out", r.map.sites.length === 2, JSON.stringify(r.map.sites.map((s) => s.label)));
  ok("the split runs read as one label", r.map.sites.some((s) => s.label === "Bawal lumi"),
     JSON.stringify(r.map.sites.map((s) => s.label)));
  ok("the second label is its own site", r.map.sites.some((s) => s.label === "Shawl Aurora"));
  ok("the printed price was counted", r.prices_detected === 1, String(r.prices_detected));
  ok("the page number never became a label", !r.map.sites.some((s) => /^\d+$/.test(s.label)));
  ok("pages carry their true size", r.map.pages[0].w === 595.28 && r.map.pages[0].h === 841.89);
}

step("the flip to top-left is exact — this is the store's coordinate contract");
{
  /* Baseline at 500 (PDF, bottom-left), height 12, page 841.89 tall:
     top-left-origin top = 841.89 - (500 + 12) = 329.89. */
  const r = extractCatalogMap([page([run("Bawal Uplan", 100, 500, 70, 12)])]);
  const s = r.map.sites[0];
  ok("y0 is height-flipped (top under the page top)", Math.abs(s.y0 - 329.89) < 0.01, String(s.y0));
  ok("y1 sits below y0, with descent room", s.y1 > s.y0 + 12 && s.y1 < s.y0 + 12 * 1.5, String(s.y1));
  ok("x0/x1 hug the drawn run", s.x0 === 100 && Math.abs(s.x1 - 170) < 0.01, `${s.x0}..${s.x1}`);
  ok("page index is 0-based", s.page === 0);
}

step("a price split across runs is still a price");
{
  const r = extractCatalogMap([page([run("RM", 100, 500, 16), run("36.00", 118, 500, 30)])]);
  ok("assembled and excluded", r.map.sites.length === 0, JSON.stringify(r.map.sites));
  ok("and counted for the warning", r.prices_detected >= 1, String(r.prices_detected));
}

step("different lines never merge into one label");
{
  const r = extractCatalogMap([page([run("Bawal lumi", 100, 500, 60), run("Bawal Aurora", 100, 470, 70)])]);
  ok("two sites, one per line", r.map.sites.length === 2 && r.map.sites[0].label !== r.map.sites[1].label,
     JSON.stringify(r.map.sites.map((s) => s.label)));
  ok("top line first (reading order)", r.map.sites[0].label === "Bawal lumi");
}

step("the store's 300-site cap is honoured here, loudly");
{
  /* 20pt line spacing — clearly distinct lines (the tolerance is 0.6 of the
     text height, 7.2pt here). */
  const many = Array.from({ length: 320 }, (_, i) => run(`Bawal shade ${String.fromCharCode(65 + (i % 26))}${i}`, 50, 8000 - i * 20, 90));
  const r = extractCatalogMap([page(many)]);
  ok("sites are capped", r.map.sites.length === MAX_SITES, String(r.map.sites.length));
  ok("and the cut is reported, never silent", r.truncated === true);
}

step("junk in, nothing out");
{
  const r = extractCatalogMap([page([run("—", 10, 500, 8), run("  ", 30, 500, 4), run("2026/08", 50, 500, 40)])]);
  ok("no sites from dashes, blanks and dates", r.map.sites.length === 0, JSON.stringify(r.map.sites));
  ok("an empty page list still answers", extractCatalogMap([]).map.sites.length === 0);
}

step("a real PDF, read the way the panel reads uploads");
{
  /* A raw one-page PDF with three text draws: two labels and a price.
     Offsets computed honestly — pdf.js must not need xref repair. */
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  const content = "BT /F1 12 Tf 100 500 Td (Bawal lumi Uplan) Tj ET\n" +
                  "BT /F1 12 Tf 100 484 Td (RM 36.00) Tj ET\n" +
                  "BT /F1 14 Tf 300 700 Td (Shawl Aurora) Tj ET";
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new TextEncoder().encode(pdf) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    pages.push({
      w: vp.width, h: vp.height,
      runs: tc.items.flatMap((it) => ("str" in it && Array.isArray(it.transform))
        ? [{ str: it.str, x: Number(it.transform[4]), baseline: Number(it.transform[5]), width: it.width, height: it.height }]
        : []),
    });
  }
  const r = extractCatalogMap(pages);
  ok("both labels were read", r.map.sites.length === 2, JSON.stringify(r.map.sites.map((s) => s.label)));
  ok("with their exact text", r.map.sites.some((s) => s.label === "Bawal lumi Uplan")
     && r.map.sites.some((s) => s.label === "Shawl Aurora"));
  ok("the printed price was flagged, not mapped", r.prices_detected === 1
     && !r.map.sites.some((s) => /RM/.test(s.label)), String(r.prices_detected));
  const s = r.map.sites.find((x) => x.label === "Bawal lumi Uplan");
  ok("the box sits where the text was drawn (x)", s && Math.abs(s.x0 - 100) < 1, s && String(s.x0));
  /* Drawn at baseline 500 on an 842pt page → top-left y ≈ 842-500-ascent. */
  ok("the box sits where the text was drawn (y, flipped)", s && s.y0 > 322 && s.y0 < 336, s && String(s.y0));
  ok("the page size came from the PDF itself", r.map.pages[0].w === 595 && r.map.pages[0].h === 842);
  /* The exact shape the staff route validates — refused there is refused here. */
  const shapeOk = r.map.version === 1 && Array.isArray(r.map.pages) && r.map.sites.every((x) =>
    Number.isInteger(x.page) && x.page >= 0 && typeof x.label === "string" && x.label.length > 0 && x.label.length <= 120
    && [x.x0, x.y0, x.x1, x.y1].every((n) => typeof n === "number" && Number.isFinite(n)));
  ok("the map passes the upload route's own validation rules", shapeOk);
}

step("printed prices become price SITES — the override map (v1.57.0)");
{
  /* The CEO's designer ships catalogs WITH prices now; the shop covers
     each one and writes the live price in its place. So a price is not
     merely excluded from labels — its PLACE travels in the map. */
  const r = extractCatalogMap([page([
    run("Bawal lumi Sky", 100, 500, 80),
    run("RM", 100, 484, 16), run("39.00", 118, 484, 30),   // split price, one site
    run("Bawal lumi Luxe", 300, 500, 80),
    run("RM 39.00", 300, 484, 46),                          // whole price
    run("64.00", 480, 300, 30),                             // stray decimal, no RM — NOT a price
  ])]);
  ok("each printed price is one site", (r.map.price_sites ?? []).length === 2,
     JSON.stringify(r.map.price_sites));
  const ps = r.map.price_sites[0];
  ok("the split RM + amount merged into one box", ps.x0 === 100 && Math.abs(ps.x1 - 148) < 0.6,
     `${ps.x0}..${ps.x1}`);
  ok("a stray decimal with no RM near it is not a price",
     !(r.map.price_sites ?? []).some((p2) => p2.y0 > 500), JSON.stringify(r.map.price_sites));
  ok("prices_detected counts the sites", r.prices_detected === 2, String(r.prices_detected));
}

step("a row of labels with hair-different baselines survives whole (the CEO's lost shawl row)");
{
  /* His real file: three labels on one printed row, baselines differing by
     hundredths of a point, and the raw sort put a right-hand label first —
     the leftward merge then folded the row into an inside-out rectangle
     and all three vanished. */
  const r = extractCatalogMap([page([
    run("Shawl Chiffon Dark Purple", 428.6, 29.84, 125.9, 11),
    run("Shawl Chiffon Black", 259.1, 29.845, 95.4, 11),
    run("Shawl Chiffon Champange", 34.0, 29.32, 127.0, 11),
  ])]);
  ok("all three labels of the row extracted", r.map.sites.length === 3,
     JSON.stringify(r.map.sites.map((x) => x.label)));
  /* Within ONE quantised row, left to right; the third label truly sits
     half a point lower and reads as the next row — what matters is that
     nothing merged and nothing vanished. */
  ok("row-mates read left to right",
     r.map.sites.findIndex((x) => x.label.endsWith("Black")) <
     r.map.sites.findIndex((x) => x.label.endsWith("Purple")),
     r.map.sites.map((x) => x.label).join(" | "));
  ok("every rect is the right way round", r.map.sites.every((x) => x.x1 > x.x0 && x.y1 > x.y0));
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: what her browser reads is what the shop can price.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
