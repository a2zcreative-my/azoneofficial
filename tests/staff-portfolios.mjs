/* v1.389.0 - GUARD: STAFF PORTFOLIOS (the CEO, 19-11-2026: the Staff Portfolio Card Generator).
 *
 * Runs the REAL worker (bundled worker/src/index.ts) on every migration in an in-memory SQLite,
 * with an in-memory R2, and proves the rules that matter:
 *   - only portfolio managers build, only the approver publishes and approves a public email/phone
 *   - a draft, an unpublished portfolio and a leaver are never public (404, like no page at all)
 *   - the public answer carries the frozen public fields and the live name / position /
 *     department, and never an id, a private key, a phone or email nobody approved
 *   - publishing freezes the portrait and the work files; later edits stay private until republished
 *   - the address is fixed once published (printed QR codes), the staff record is never written
 *     except through the existing staff photo door, uploads are sniffed
 *   - no QR is drawn for a page that does not exist
 * Plus the static wiring: the rewrite, the registry, the caps, the shared components.
 *
 *   node tests/staff-portfolios.mjs        NOMUT=1 skips the mutations
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeRuntime, root } from "./browser/portfolio-runtime.mjs";

const PNG = (seed) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`fake-png-${seed}`.padEnd(64, "."))]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg".padEnd(64, "."))]);
const read = (f) => readFileSync(join(root, f), "utf8");

const runtime = [];
const ok = (c, m, why = "") => runtime.push([!!c, why && !c ? `${m} - ${why}` : m]);

const rt = await makeRuntime();
const { call, db } = rt;
try {
  let r = await call("/staff/portfolios", 1);
  ok(r.status === 200 && r.j?.people?.some((p) => p.user_id === 11), "the CEO sees the people on staff", r.text);
  ok(!r.j?.people?.some((p) => p.user_id === 14), "a leaver is not offered a portfolio");
  ok((await call("/staff/portfolios", 4)).status === 403, "a sales executive without portfolio rights is refused (403)");
  ok((await call("/staff/portfolios", 11)).status === 403, "a team member cannot open the studio (403)");

  r = await call("/staff/portfolios", 2, "POST", { user_id: 11 });
  ok(r.status === 201 && r.j?.slug === "nurfarah", "HR creates a draft; the address is the person's own name", r.text);
  const pid = r.j?.id;
  ok((await call("/staff/portfolios", 2, "POST", { user_id: 11 })).j?.existed === true, "a second create opens the same portfolio (one per person)");
  ok((await call("/staff/portfolios", 4, "POST", { user_id: 12 })).status === 403, "someone without the right cannot create");
  ok((await call("/staff/portfolios", 1, "POST", { user_id: 14 })).status === 404, "no portfolio for a leaver");
  ok(db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n === 8, "creating a portfolio adds no staff record");

  ok((await call("/public/portfolio/nurfarah", null)).status === 404, "a draft is not public (404)");

  let d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d?.staff?.position === "Test Position A" && d?.staff?.department === "Test Department A", "the position and department are read from the staff record");
  const d13 = (await call(`/staff/portfolios/${(await call("/staff/portfolios", 1, "POST", { user_id: 13 })).j?.id}`, 1)).j;
  ok(d13?.duties?.public?.length === 0 && d13?.duties?.all === 2, "nobody's responsibilities are public until ticked Public");
  ok((await call(`/staff/portfolios/${pid}`, 2, "PUT", { version: d.portfolio.version + 5, tagline: "x" })).status === 409, "a stale edit is refused (409)");
  r = await call(`/staff/portfolios/${pid}`, 2, "PUT", { version: d.portfolio.version, tagline: "Turning ideas into stories", specialties: ["Live Selling", "Content", "Photography", "Video", "Design", "Extra"], expertise: ["TikTok Live"] });
  ok(r.status === 200, "HR edits the draft", r.text);
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.specialties.length === 5, "at most five specialties are kept");
  ok((await call(`/staff/portfolios/${pid}`, 2, "PUT", { version: d.portfolio.version, show_phone: true })).status === 403, "only the approver may show a person's phone in public (HR refused)");
  ok((await call(`/staff/portfolios/${pid}`, 1, "PUT", { version: d.portfolio.version, socials: { instagram: "http://evil.example/x" } })).status === 400, "a social link must be https to the named network");
  ok((await call(`/staff/portfolios/${pid}`, 1, "PUT", { version: d.portfolio.version, slug: "staff" })).status === 400, "a reserved word is never an address");

  /* the photo: the existing staff photo door, then a processed portrait */
  r = await call("/staff/users/11/photo", 2, "POST", PNG("first"), "image/png");
  ok(r.status === 201, "HR sets the first staff photo through the existing door", r.text);
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(Boolean(d.staff.photo_key), "the portfolio sees the new staff photo at once");
  r = await call(`/staff/portfolios/${pid}/portrait`, 2, "POST", JPG, "image/png");
  ok(r.status >= 400, "a portrait whose bytes are not the declared type is refused", String(r.status));
  r = await call(`/staff/portfolios/${pid}/portrait`, 2, "POST", PNG("cutout"), "image/png");
  ok(r.status === 201, "the cut-out portrait is saved", r.text);
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.portrait_key && !d.portfolio.portrait_stale, "the portrait is current");

  /* the work */
  r = await call(`/staff/portfolios/${pid}/items`, 2, "POST", { kind: "image", title: "Raya campaign", description: "Product shots", featured: true });
  const iid = r.j?.id;
  ok(r.status === 201, "a piece of work is added");
  ok((await call(`/staff/portfolios/${pid}/items/${iid}/media`, 2, "POST", PNG("work-1"), "image/png")).status === 201, "its image is uploaded");
  ok((await call(`/staff/portfolios/${pid}/items`, 2, "POST", { kind: "video", title: "Live", video_url: "https://evil.example/v" })).status === 400, "a video link must be a known video site");

  /* publish: the approval */
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok((await call(`/staff/portfolios/${pid}/publish`, 2, "POST", { version: d.portfolio.version })).status === 403, "HR cannot publish (approval)");
  ok((await call(`/staff/portfolios/${pid}/publish`, 1, "POST", { version: d.portfolio.version - 1 })).status === 409, "publishing a version nobody checked is refused (409)");
  r = await call(`/staff/portfolios/${pid}/publish`, 1, "POST", { version: d.portfolio.version });
  ok(r.status === 200 && r.j?.public_url === "https://a2zcreative.my/portfolio/nurfarah", "the CEO publishes; the address is a2zcreative.my/portfolio/<name>", r.text);
  ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portfolio.publish'`).get().n === 1, "the publish is in the audit log");
  ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 11 AND ref LIKE 'portfolio:%'`).get().n === 1, "the person is told their portfolio is published");

  r = await call("/public/portfolio/nurfarah", null);
  const pub = r.j?.portfolio;
  ok(r.status === 200 && pub?.name === "NURFARAH" && pub?.position === "Test Position A" && pub?.department === "Test Department A", "the public page gets the name, position and department", r.text);
  ok(pub?.tagline === "Turning ideas into stories" && pub?.specialties?.length === 5 && pub?.items?.length === 1, "and the approved words and work");
  ok(JSON.stringify(pub?.responsibilities) === JSON.stringify(["Test duty one", "Test duty two", "Test duty three"]), "the responsibilities ticked Public on the person's list, in order", JSON.stringify(pub?.responsibilities));
  ok(!/Test duty (four|five|six)/.test(r.text), "a responsibility not ticked Public is never on the page");
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(JSON.stringify(d.duties?.public) === JSON.stringify(["Test duty one", "Test duty two", "Test duty three"]) && d.duties?.all === 6, "the studio shows the Public ones and how many are written");
  ok(!/private\/|user_id|"id":11|0121111111|nurfarah@a2zcreative\.my|password|salary|ic_number|employee_id|photo_key|media_key/.test(r.text), "nothing private: no id, key, phone or email nobody approved", r.text);
  ok(pub?.email === null && pub?.phone === null, "email and phone stay off until approved");

  const portraitPub = await call("/public/portfolio/nurfarah/portrait", null);
  ok(portraitPub.status === 200 && /image\/png/.test(portraitPub.type ?? "") && portraitPub.buf.includes(Buffer.from("fake-png-cutout")), "the approved portrait is served without a sign-in");
  const workPub = await call(`/public/portfolio/nurfarah/media/${iid}`, null);
  ok(workPub.status === 200 && workPub.buf.includes(Buffer.from("fake-png-work-1")), "the published work image is served");
  ok((await call(`/public/portfolio/nurfarah/media/99999`, null)).status === 404, "any other file is not (404)");

  /* later edits stay private until republished */
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  await call(`/staff/portfolios/${pid}`, 2, "PUT", { version: d.portfolio.version, tagline: "A newer line" });
  await call(`/staff/portfolios/${pid}/items/${iid}/media`, 2, "POST", PNG("work-2"), "image/png");
  ok((await call("/public/portfolio/nurfarah", null)).j?.portfolio?.tagline === "Turning ideas into stories", "a later draft edit is not public until it is published again");
  ok((await call(`/public/portfolio/nurfarah/media/${iid}`, null)).buf.includes(Buffer.from("fake-png-work-1")), "a replaced work file is not public until published again");
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.unpublished_changes === true, "the studio says there are changes the page does not show");
  ok((await call(`/staff/portfolios/${pid}`, 1, "PUT", { version: d.portfolio.version, slug: "farah" })).status === 409, "the address is fixed once published (printed QR codes)");

  /* a new staff photo: the card follows it, the public keeps the approved one */
  await call("/staff/users/11/photo", 1, "POST", PNG("second"), "image/png");
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.portrait_stale === true, "a new staff photo makes the old portrait stale - the card falls back to the new photo");
  ok((await call("/public/portfolio/nurfarah/portrait", null)).buf.includes(Buffer.from("fake-png-cutout")), "the public keeps the approved photo until republished");

  /* 19-11-2026 (the CEO) - the portfolio's OWN photo: uploaded for the portfolio, never the staff record,
     and a later staff photo change does not replace it */
  const staffPhotoBefore = db.prepare("SELECT photo_key FROM users WHERE id = 11").get().photo_key;
  r = await call(`/staff/portfolios/${pid}/portrait?own=1`, 2, "POST", PNG("own"), "image/png");
  ok(r.status === 201, "own photo: a photo uploaded for the portfolio is saved", r.text);
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.portrait_own === true && d.portfolio.portrait_stale === false, "own photo: marked as the portfolio's own and current", JSON.stringify(d.portfolio).slice(0, 160));
  ok(db.prepare("SELECT photo_key FROM users WHERE id = 11").get().photo_key === staffPhotoBefore, "own photo: the staff record photo is not touched");
  await call("/staff/users/11/photo", 1, "POST", PNG("third"), "image/png");
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.portrait_own === true && d.portfolio.portrait_stale === false, "own photo: a new staff photo does not replace it");

  /* 19-11-2026 (the CEO) - a nickname on the portfolio: the card and the page show it, the staff record keeps the full name */
  const fullBefore = db.prepare("SELECT name, full_name FROM users WHERE id = 11").get();
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok((await call(`/staff/portfolios/${pid}`, 1, "PUT", { version: d.portfolio.version, display_name: "  Farah  " })).status === 200, "nickname: saved on the portfolio");
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.display_name === "Farah" && d.staff.name !== "Farah", "nickname: the portfolio holds it; the staff name is the record's", JSON.stringify([d.portfolio.display_name, d.staff.name]));
  ok(JSON.stringify(db.prepare("SELECT name, full_name FROM users WHERE id = 11").get()) === JSON.stringify(fullBefore), "nickname: the staff record is not changed");
  ok((await call("/public/portfolio/nurfarah", null)).j?.portfolio?.name !== "Farah", "nickname: the public page changes only when published again");
  await call(`/staff/portfolios/${pid}/publish`, 1, "POST", { version: d.portfolio.version });
  ok((await call("/public/portfolio/nurfarah", null)).j?.portfolio?.name === "Farah", "nickname: once published, the public page shows it");
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  await call(`/staff/portfolios/${pid}`, 1, "PUT", { version: d.portfolio.version, display_name: "" });
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.display_name === null, "nickname: emptied, the full name is used again");

  /* the approver shows the phone */
  await call(`/staff/portfolios/${pid}`, 1, "PUT", { version: d.portfolio.version, show_phone: true });
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  await call(`/staff/portfolios/${pid}/publish`, 1, "POST", { version: d.portfolio.version });
  r = await call("/public/portfolio/nurfarah", null);
  ok(r.j?.portfolio?.phone === "0121111111" && r.j?.portfolio?.tagline === "A newer line", "republished: the approved phone and the newer words are public");

  /* enquiries */
  r = await call("/public/portfolio/nurfarah/enquiry", null, "POST", { name: "Client A", message: "Need a live host" });
  ok(r.status === 400, "an enquiry needs a phone or an email");
  r = await call("/public/portfolio/nurfarah/enquiry", null, "POST", { name: "Client A", phone: "0199999999", message: "Need a live host" });
  ok(r.status === 201, "a client enquiry from the page is accepted", r.text);
  const enq = db.prepare(`SELECT message FROM enquiries ORDER BY id DESC LIMIT 1`).get();
  ok(/^\[Portfolio: NURFARAH, Test Position A\] Need a live host$/.test(enq?.message ?? ""), "it lands in Enquiries, naming the portfolio", JSON.stringify(enq));
  ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 11 AND kind = 'enquiry'`).get().n === 1, "the person is told a client asked");

  /* unpublish; a leaver */
  ok((await call(`/staff/portfolios/${pid}/unpublish`, 2, "POST", {})).status === 403, "HR cannot unpublish");
  ok((await call(`/staff/portfolios/${pid}/unpublish`, 3, "POST", {})).status === 200, "the COO unpublishes");
  ok((await call("/public/portfolio/nurfarah", null)).status === 404 && (await call("/public/portfolio/nurfarah/portrait", null)).status === 404, "unpublished: the page and the photo are gone (404)");
  r = await call("/staff/portfolios", 1, "POST", { user_id: 12 });
  const p2 = r.j?.id;
  let d2 = (await call(`/staff/portfolios/${p2}`, 1)).j;
  await call(`/staff/portfolios/${p2}/publish`, 1, "POST", { version: d2.portfolio.version });
  ok((await call("/public/portfolio/noraleeya", null)).status === 200, "a second portfolio publishes (no photo needed)");
  db.exec(`UPDATE users SET employment_status = 'resigned', left_on = '2026-01-01' WHERE id = 12`);
  ok((await call("/public/portfolio/noraleeya", null)).status === 404, "a leaver's portfolio is never public");

  /* own card on Profile; the record kept */
  ok((await call("/staff/portfolios/mine", 11)).j?.portfolio?.slug === "nurfarah", "the person reads their own portfolio (Profile)");
  ok((await call("/staff/portfolios/mine", 4)).j?.portfolio === null, "someone without one gets none");
  let threw = false; try { db.exec(`DELETE FROM staff_portfolios`); } catch { threw = true; }
  ok(threw, "a portfolio is never deleted (trigger)");
  const crud = await call("/portfolio", null);
  ok(crud.status === 200, "the website's content list /api/v1/portfolio still answers", String(crud.status));
} catch (e) {
  runtime.push([false, `runtime: ${e?.stack ?? e}`]);
}

/* ---------------- the static wiring ---------------- */
const SRC = {
  idx: read("worker/src/index.ts"), pf: read("worker/src/portfolios.ts"), staff: read("worker/src/staff.ts"), perms: read("worker/src/permissions.ts"),
  redirects: read("public/_redirects"), render: read("lib/portfolio-render.ts"), card: read("lib/portfolio-card.ts"), studio: read("components/portal/portfolio-studio.tsx"),
  studioCss: read("components/portal/portfolio-studio.module.css"), page: read("app/portfolio/staff/page.tsx"), mig: read("worker/migrations/0216_staff_portfolios.sql"),
  dir: read("components/staff/staff-directory.tsx"),
};
function checks(s) {
  const out = [];
  const t = (c, m) => out.push([!!c, m]);
  t(/\/portfolio\/elfia\s+\/portfolio\s+301[\s\S]*\/portfolio\/:name\s+\/portfolio\/staff\s+200/.test(s.redirects), "every /portfolio/<name> is the one static page (rewrite 200), after the /portfolio/elfia 301");
  t(/\\\/api\\\/v1\\\/public\\\/portfolio\\\//.test(s.idx), "the public API lives under /api/v1/public/portfolio (the content list keeps /api/v1/portfolio)");
  t(/const LATEST_MIGRATION = "(0216_staff_portfolios|0217_portfolio_display_name)"/.test(s.idx) && /"0216_staff_portfolios",\n\s*("0217_portfolio_display_name",\n\s*)?\];/.test(s.idx), "0216 is in the expected list (0217 the nickname after it)");
  t(/portfolio_manage: \[[^\]]*"hr_admin"[^\]]*\]/.test(s.perms) && /portfolio_publish: \["super_admin", "ceo", "coo"\]/.test(s.perms), "portfolio_manage and portfolio_publish are PERMS caps (publish = CEO, COO, super admin)");
  t(/cap: "portfolio_manage"/.test(s.perms) && /cap: "portfolio_publish"/.test(s.perms), "both are rows of the editable matrix");
  t(/handlePortfolios\(env, path, method, body, user, request\)/.test(s.staff) && /portfolios\\\/\\d\+\\\/\(portrait\|items\\\/\\d\+\\\/media\)/.test(s.staff), "one door in staff.ts; the uploads are raw bodies");
  t(/qrUrl: d\.portfolio\.state === "published" \? d\.portfolio\.public_url : null/.test(s.render), "the card's QR is only the published address - never a placeholder");
  t(/if \(d\.qrUrl\)/.test(s.card) && /QR appears/.test(s.card), "the card draws a QR only when there is a page; otherwise it says so");
  t(/if \(!p \|\| !p\.published_json\)|state = 'published' AND published_json IS NOT NULL/.test(s.pf) && /!s\.current\) return null/.test(s.pf), "the public read: published only, and never a leaver");
  t(!/UPDATE users\b/.test(s.pf), "portfolios.ts never writes a staff record");
  t(/KpiRow/.test(s.studio) && /KpiTile/.test(s.studio) && /SideDrawer/.test(s.studio) && /LineTabs/.test(s.studio), "the studio uses the shared strip, drawer and tabs");
  t(!/#[0-9a-fA-F]{3,8}\b/.test(s.studioCss), "no hex colour in the studio's CSS (tokens only)");
  t(!/className="[^"]*(?<![\w-])(flex|items-center|gap-\d|mt-\d|px-\d|md:\w+)(?![\w-])/.test(s.studio), "no utility classes in the studio");
  t(!/\b(p|portfolio)\.(user_id|employee_id|ic_number|salary|bank\w*|base_salary|email_personal)\b/.test(s.page) && !/user_id|employee_id|ic_number/.test(s.page.replace(/\/\*[\s\S]*?\*\//g, "")), "the public page reads no HR field");
  t(!/\bDROP\b|\bALTER\s+TABLE\s+users\b/i.test(s.mig) && /BEFORE DELETE ON staff_portfolios/.test(s.mig), "0216 is additive; portfolios are never deleted");
  t(/"portfolios"/.test(s.dir) && /data-testid="peek-portfolio"/.test(s.dir), "Staff has a Portfolios view and a Portfolio action on the profile");
  return out;
}
const base = checks(SRC);
let failed = 0;
for (const [p, m] of [...runtime, ...base]) if (!p) { failed++; console.log(`  x ${m}`); }
const MUT = [
  ["render", "a QR drawn for a draft", `qrUrl: d.portfolio.state === "published" ? d.portfolio.public_url : null`, `qrUrl: d.portfolio.public_url ?? d.portfolio.address`],
  ["perms", "HR may publish", `portfolio_publish: ["super_admin", "ceo", "coo"]`, `portfolio_publish: ["super_admin", "ceo", "coo", "hr_admin"]`],
  ["redirects", "the rewrite dropped", "/portfolio/:name  /portfolio/staff  200", ""],
  ["pf", "drafts made public", "state = 'published' AND published_json IS NOT NULL", "published_json IS NOT NULL OR 1 = 1"],
];
let caught = 0;
if (!process.env.NOMUT) for (const [k, name, from, to] of MUT) {
  if (!SRC[k].includes(from)) { failed++; console.log(`  x mutation did not apply: ${name}`); continue; }
  if (checks({ ...SRC, [k]: SRC[k].replace(from, to) }).some(([p]) => !p)) caught++; else { failed++; console.log(`  x mutation not caught: ${name}`); }
}
if (failed) { console.log(`staff-portfolios: ${failed} failed`); process.exit(1); }
console.log(`PASS - staff portfolios: real worker on every migration; draft/unpublished/leaver never public; publish is the approval and freezes photo + work; no private field public; the address fixed; no QR without a page (${runtime.length} runtime + ${base.length} static checks${process.env.NOMUT ? "" : `, ${caught} mutations caught`})`);
