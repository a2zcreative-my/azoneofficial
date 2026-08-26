/**
 * The catalog upload, proven on the REAL portal worker (v1.55.0).
 *
 * The CEO: "the portal can upload the PDF for this catalog without the
 * prices tag and it will automatically live price embedded to the PDF
 * uploaded."
 *
 * The store's half (download + live pricing) has its own rig in the store
 * repo. THIS proves the portal's half: the three staff routes, the exact
 * moment the feed starts and stops advertising the catalog, and the one
 * safety rule everything hangs on — a NEW PDF with an OLD map must never be
 * visible together, because that pairing is prices on the wrong labels.
 *
 * Setup (same as bulk-discount-e2e.mjs):
 *   cd worker && npx wrangler d1 migrations apply azoneofficial --local --config wrangler.e2e.toml
 *   cd .. && node scratch/seed-e2e.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8300
 *   node scratch/catalog-portal-e2e.mjs
 */
const API = process.env.PORTAL_API ?? "http://127.0.0.1:8300/api/v1";
const CSRF = "e2ecsrf";
const COOKIES = `azone_session=e2etoken; csrf_token=${CSRF}`;
const BRIDGE_KEY = process.env.ELFIA_BRIDGE_KEY ?? "shared-bridge-secret";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);
const staff = (path, init = {}) => fetch(`${API}/staff${path}`, {
  ...init,
  headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "application/json", ...(init.headers ?? {}) },
});
const status = async () => (await (await staff("/elfia/catalog")).json());
const feed = async () => (await (await fetch(`${API}/bridge/elfia-inventory`, {
  headers: { "X-Bridge-Key": BRIDGE_KEY } })).json());

/* A small but honest PDF — same builder as catalog-extract-check.mjs. */
const buildPdf = (title) => {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>");
  const content = `BT /F1 12 Tf 100 500 Td (${title}) Tj ET`;
  add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
};
const MAP = { version: 1, pages: [{ w: 595, h: 842 }], sites: [{ page: 0, label: "Bawal lumi Uplan", x0: 100, y0: 330, x1: 170, y1: 345 }] };
const JPEG_STUB = Buffer.from("ffd8ffe000104a46494600", "hex");
const postBinary = (path, body, type) => fetch(`${API}/staff${path}`, {
  method: "POST", headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": type }, body,
});

try {
  step("a clean slate, and the feed carries no catalog");
  {
    await staff("/elfia/catalog", { method: "DELETE" });
    const s = await status();
    ok("nothing uploaded", s.live === false && s.pending === false, JSON.stringify(s));
    ok("the feed has no catalog key", (await feed()).catalog === undefined);
  }

  step("the doors hold before anything real goes up");
  {
    const r1 = await postBinary("/elfia/catalog", Buffer.from("<html>not a pdf</html>"), "application/pdf");
    ok("a fake PDF is refused by its bytes, not its name", r1.status === 400, String(r1.status));
    const r2 = await staff("/elfia/catalog/map", { method: "POST", body: JSON.stringify({ map: MAP }) });
    ok("a map with no PDF to describe is refused", r2.status === 409, String(r2.status));
    const r3 = await staff("/elfia/catalog/map", { method: "POST", body: JSON.stringify({ map: { version: 2 } }) });
    ok("a wrong-shaped map is refused at the door", r3.status === 400, String(r3.status));
    const r4 = await fetch(`${API}/staff/elfia/catalog`, {
      method: "POST", headers: { Cookie: COOKIES, "Content-Type": "application/pdf" }, body: buildPdf("X"),
    });
    ok("no CSRF token, no upload", r4.status === 403, String(r4.status));
  }

  step("PDF up — and the half-finished upload is invisible to the store");
  let pdfUrl;
  {
    const r = await postBinary("/elfia/catalog", buildPdf("Bawal lumi Uplan"), "application/pdf");
    const j = await r.json();
    ok("the PDF is accepted", r.status === 201 && typeof j.pdf_key === "string", JSON.stringify(j));
    const s = await status();
    ok("status says pending, not live", s.pending === true && s.live === false, JSON.stringify(s));
    ok("the feed STILL has no catalog key (no map yet)", (await feed()).catalog === undefined);
  }

  step("cover, then map — the map is the switch");
  let firstMarker;
  {
    const rc = await postBinary("/elfia/catalog/cover", JPEG_STUB, "image/jpeg");
    ok("the cover is accepted", rc.status === 201, String(rc.status));
    const rm = await staff("/elfia/catalog/map", { method: "POST", body: JSON.stringify({ map: MAP }) });
    const jm = await rm.json();
    ok("the map goes live", rm.status === 201 && jm.live === true, JSON.stringify(jm));
    firstMarker = jm.updated_at;
    const s = await status();
    ok("status says live", s.live === true && typeof s.updated_at === "string", JSON.stringify(s));
  }

  step("the feed now hands the store all three, on this request's origin");
  {
    const c = (await feed()).catalog;
    ok("the catalog key is on the feed", c && typeof c.url === "string" && typeof c.map_url === "string"
       && typeof c.cover_url === "string" && c.updated_at === firstMarker, JSON.stringify(c));
    pdfUrl = c.url;
    const p = await fetch(c.url);
    const head = Buffer.from(await p.arrayBuffer());
    ok("the PDF URL serves her file, publicly", p.ok && head.subarray(0, 5).toString() === "%PDF-",
       `${p.status} ${head.subarray(0, 5)}`);
    const m = await (await fetch(c.map_url)).json();
    ok("the map URL serves the exact map", m.version === 1 && m.sites?.[0]?.label === "Bawal lumi Uplan",
       JSON.stringify(m).slice(0, 80));
    const cv = Buffer.from(await (await fetch(c.cover_url)).arrayBuffer());
    ok("the cover URL serves the JPEG", cv[0] === 0xff && cv[1] === 0xd8, cv.subarray(0, 2).toString("hex"));
  }

  step("a REPLACEMENT PDF silences the feed until ITS map arrives");
  {
    const r = await postBinary("/elfia/catalog", buildPdf("Shawl Aurora"), "application/pdf");
    ok("the new PDF is accepted", r.status === 201, String(r.status));
    const s = await status();
    ok("back to pending — the old map is dead", s.pending === true && s.live === false, JSON.stringify(s));
    ok("the feed key is GONE (new file + old map must never pair)", (await feed()).catalog === undefined);
    const rm = await staff("/elfia/catalog/map", {
      method: "POST",
      body: JSON.stringify({ map: { ...MAP, sites: [{ ...MAP.sites[0], label: "Shawl Aurora" }] } }),
    });
    const jm = await rm.json();
    ok("its own map brings it back, under a NEW marker",
       rm.status === 201 && jm.updated_at && jm.updated_at !== firstMarker, JSON.stringify(jm));
    const c = (await feed()).catalog;
    ok("and the feed says so", c && c.updated_at === jm.updated_at, JSON.stringify(c ?? null));
  }

  step("remove — and nothing is left behind");
  {
    const r = await staff("/elfia/catalog", { method: "DELETE" });
    const j = await r.json();
    ok("the remove answers", r.ok && j.ok === true, JSON.stringify(j));
    const s = await status();
    ok("status is empty again", s.live === false && s.pending === false, JSON.stringify(s));
    ok("the feed key is gone", (await feed()).catalog === undefined);
    if (pdfUrl) {
      const gone = await fetch(pdfUrl);
      ok("the old file is really deleted from media", gone.status === 404, String(gone.status));
    }
  }
} finally {
  await staff("/elfia/catalog", { method: "DELETE" }).catch(() => null);
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: the portal's half of the self-pricing catalog.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
