/* v1.55.0 — reading the labels out of a catalog PDF, at upload time.
 *
 * The CEO: "the portal can upload the PDF for this catalog without the
 * prices tag and it will automatically live price embedded to the PDF
 * uploaded."
 *
 * The deal struck with the ELFIA store (its PORTAL-BRIDGE-SPEC, catalog
 * section): the store's Worker stays dumb — it downloads the PDF and a MAP
 * of where the product labels sit, and draws live prices under them. The
 * map is extracted HERE, in the CEO's browser, the moment she picks the
 * file — because the browser has the full pdf.js text engine and the Worker
 * does not, and because she is looking at the screen when it happens, so a
 * bad read is caught before anything is uploaded.
 *
 * This module is the GEOMETRY only, deliberately free of pdf.js imports and
 * DOM types: it takes the raw text runs pdf.js reports and turns them into
 * labelled boxes. That makes it a plain function a node rig can feed
 * synthetic runs into (scratch/catalog-extract-check.mjs) — the same
 * shipped-code-under-test pattern as bridge-feed.ts.
 *
 * Coordinates: pdf.js reports a run's transform in PDF space (origin at the
 * BOTTOM-left); the map the store expects is TOP-left origin (y grows
 * downward), because that is what its patcher and its own map rigs use. The
 * flip happens here, once: y_top = pageHeight - y_baseline - ascent.
 */

/** One text run as pdf.js's getTextContent() reports it, reduced to the
    five numbers this module needs. `x` and `baseline` are transform[4] and
    transform[5] — PDF space, bottom-left origin. */
export interface TextRun {
  str: string;
  x: number;
  baseline: number;
  width: number;
  height: number;
}

export interface PageRuns {
  w: number;
  h: number;
  runs: TextRun[];
}

export interface ExtractedSite {
  page: number; // 0-based, matching the store's map contract
  label: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ExtractedMap {
  version: 1;
  pages: { w: number; h: number }[];
  sites: ExtractedSite[];
}

export interface ExtractResult {
  map: ExtractedMap;
  /** Runs that look like printed prices ("RM 36.00"). The CEO asked for a
      catalog WITHOUT price tags; if the file still has them, the shop would
      show hers AND the stale printed ones — worth a warning, not a refusal
      (a cover might legitimately say "from RM 29"). */
  prices_detected: number;
  /** True when more labels existed than the store's 300-site cap; the
      overflow was dropped from the END (later pages), never silently. */
  truncated: boolean;
}

/** The store refuses maps beyond this; mirrored so the refusal happens in
    front of the person who can do something about it. */
export const MAX_SITES = 300;

const PRICE_RE = /(^|\s)RM\s?\d/i;
/** A run that is only digits/punctuation (page numbers, sizes) — never a
    product label on its own. */
const NUMERIC_RE = /^[\d\s.,/–-]+$/;

/** Two runs share a text line when their baselines nearly coincide,
    measured against the taller of the two. */
const sameLine = (a: TextRun, b: TextRun): boolean =>
  Math.abs(a.baseline - b.baseline) < Math.max(a.height, b.height, 1) * 0.6;

/** Merge one page's runs into left-to-right lines, then keep the lines that
    read like labels. Returns sites in top-left-origin coordinates. */
function extractPage(page: PageRuns, pageIndex: number): { sites: ExtractedSite[]; prices: number } {
  let prices = 0;
  const usable: TextRun[] = [];
  for (const r of page.runs) {
    const s = r.str.trim();
    if (s === "") continue;
    if (PRICE_RE.test(s)) { prices++; continue; } // a printed price is never a label
    if (!Number.isFinite(r.x) || !Number.isFinite(r.baseline) || !Number.isFinite(r.width)) continue;
    usable.push(r);
  }
  /* Reading order: top of the page first, then left to right. PDF baseline
     grows UPWARD, so top-first means descending baseline. */
  usable.sort((a, b) => (b.baseline - a.baseline) || (a.x - b.x));

  const lines: TextRun[][] = [];
  for (const r of usable) {
    const line = lines[lines.length - 1];
    const last = line?.[line.length - 1];
    if (line && last && sameLine(last, r) && r.x - (last.x + last.width) < Math.max(last.height, r.height) * 1.2) {
      line.push(r);
    } else {
      lines.push([r]);
    }
  }

  const sites: ExtractedSite[] = [];
  for (const line of lines) {
    /* pdf.js splits a word wherever kerning changes; joining with a space
       only where a visible gap exists keeps "Bawal" + "lumi" readable and
       "UP" + "LAN" whole. */
    let label = "";
    for (let i = 0; i < line.length; i++) {
      const r = line[i]!;
      if (i > 0) {
        const prev = line[i - 1]!;
        const gap = r.x - (prev.x + prev.width);
        if (gap > Math.max(prev.height, r.height) * 0.18) label += " ";
      }
      label += r.str;
    }
    label = label.replace(/\s+/g, " ").trim();
    if (label.length < 2 || label.length > 80) continue;
    if (!/\p{L}/u.test(label)) continue;      // no letters — not a label
    if (NUMERIC_RE.test(label)) continue;
    if (PRICE_RE.test(label)) { prices++; continue; } // price assembled from split runs

    const first = line[0]!;
    const lastRun = line[line.length - 1]!;
    const ascent = Math.max(...line.map((r) => r.height));
    const x0 = first.x;
    const x1 = lastRun.x + lastRun.width;
    /* Flip to top-left origin. The run's baseline sits under its glyphs, so
       the box's top is baseline + ascent (in PDF space), i.e. h - that. */
    const y0 = page.h - (first.baseline + ascent);
    const y1 = page.h - first.baseline + ascent * 0.25; // a little descent room
    if (!(x1 > x0)) continue;
    sites.push({
      page: pageIndex,
      label,
      x0: Math.round(x0 * 100) / 100,
      y0: Math.round(y0 * 100) / 100,
      x1: Math.round(x1 * 100) / 100,
      y1: Math.round(y1 * 100) / 100,
    });
  }
  return { sites, prices };
}

/** The whole document. Pages must arrive in document order. */
export function extractCatalogMap(pages: PageRuns[]): ExtractResult {
  const sites: ExtractedSite[] = [];
  let prices = 0;
  pages.forEach((p, i) => {
    const r = extractPage(p, i);
    sites.push(...r.sites);
    prices += r.prices;
  });
  const truncated = sites.length > MAX_SITES;
  return {
    map: {
      version: 1,
      pages: pages.map((p) => ({ w: p.w, h: p.h })),
      sites: truncated ? sites.slice(0, MAX_SITES) : sites,
    },
    prices_detected: prices,
    truncated,
  };
}
