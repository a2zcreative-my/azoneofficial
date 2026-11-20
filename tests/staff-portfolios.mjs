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

  /* 0218 - capitals or normal letters for the name */
  ok(d.portfolio.name_case === "normal", "letters: normal by default");
  ok((await call(`/staff/portfolios/${pid}`, 1, "PUT", { version: d.portfolio.version, name_case: "shout" })).status === 400, "letters: only capitals or normal");
  await call(`/staff/portfolios/${pid}`, 1, "PUT", { version: d.portfolio.version, name_case: "upper" });
  d = (await call(`/staff/portfolios/${pid}`, 1)).j;
  ok(d.portfolio.name_case === "upper", "letters: capitals saved");
  await call(`/staff/portfolios/${pid}/publish`, 1, "POST", { version: d.portfolio.version });
  ok((await call("/public/portfolio/nurfarah", null)).j?.portfolio?.name_case === "upper", "letters: once published, the page draws the name in capitals");

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
  ok((await call(`/staff/portfolios/${pid}/unpublish`, 3, "POST", {})).status === 403, "the COO cannot unpublish (v1.390.0: the CEO and super admin approve)");
  ok((await call(`/staff/portfolios/${pid}/unpublish`, 1, "POST", {})).status === 200, "the CEO unpublishes");
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

  /* v1.390.0 (the CEO, 19-11-2026: "Portfolios should be able to visible by the staff for them to generate
     and download it by themselves") - a person on staff builds and edits their OWN portfolio, never
     anyone else's, and sends it for approval; publishing stays the approver's */
  r = await call("/staff/portfolios/mine", 4, "POST", {});
  ok(r.status === 201 && r.j?.id, "self: a sales executive creates their own portfolio", r.text);
  const own4 = r.j?.id;
  ok((await call("/staff/portfolios/mine", 4, "POST", {})).j?.existed === true, "self: a second create opens the same one");
  r = await call("/staff/portfolios/mine", 14, "POST", {});
  ok(r.status === 401 || r.status === 403, "self: a leaver cannot create one", `${r.status} ${r.text}`);
  let o = (await call(`/staff/portfolios/${own4}`, 4)).j;
  ok(o?.can?.edit === true && o?.can?.publish === false && o?.can?.submit === true, "self: may edit and send for approval, not publish", JSON.stringify(o?.can));
  ok((await call(`/staff/portfolios/${own4}`, 4, "PUT", { version: o.portfolio.version, tagline: "My own line", specialties: ["Sales", "Client Relationship", "Live Selling"] })).status === 200, "self: edits their own draft");
  ok((await call(`/staff/portfolios/${own4}/portrait?own=1`, 4, "POST", PNG("self"), "image/png")).status === 201, "self: uploads their own portfolio photo");
  ok((await call(`/staff/portfolios/${own4}/items`, 4, "POST", { kind: "image", title: "My work" })).status === 201, "self: adds their own work");
  o = (await call(`/staff/portfolios/${own4}`, 4)).j;
  ok((await call(`/staff/portfolios/${own4}`, 4, "PUT", { version: o.portfolio.version, show_phone: true })).status === 403, "self: cannot approve their own phone for the public");
  ok((await call(`/staff/portfolios/${own4}/publish`, 4, "POST", { version: o.portfolio.version })).status === 403, "self: cannot publish their own portfolio");
  ok((await call(`/staff/portfolios/${pid}`, 4)).status === 403 && (await call(`/staff/portfolios/${pid}`, 4, "PUT", { version: 1, tagline: "x" })).status === 403, "self: cannot open or edit someone else's portfolio");
  ok((await call(`/staff/portfolios/${pid}/portrait`, 4, "POST", PNG("x"), "image/png")).status === 403 && (await call(`/staff/portfolios/${pid}/items`, 4, "POST", { kind: "image", title: "x" })).status === 403, "self: cannot change someone else's photo or work");
  ok((await call("/staff/portfolios", 4)).status === 403, "self: the Staff -> Portfolios list stays closed");
  r = await call("/staff/portfolios/mine/submit", 4, "POST", {});
  ok(r.status === 200 && r.j?.sent_to >= 1, "self: sends it for approval", r.text);
  ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND ref LIKE 'portfolio:${own4}:ask:%'`).get().n === 1, "self: the approver is told");
  ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 2 AND ref LIKE 'portfolio:${own4}:ask:%'`).get().n === 0, "self: HR (cannot publish) is not asked");
  ok(r.j?.stage === "approval", "chart: with nobody placed above them, it goes straight to the approvers", r.text);
  ok((await call("/staff/portfolios/mine/submit", 4, "POST", {})).j?.already === true, "chart: a second tap is the same submission");

  /* 0219 - the reporting chart: the nearest COO / CCO above pre-checks first */
  db.exec(`UPDATE users SET reports_to = 3 WHERE id = 4; UPDATE users SET reports_to = 1 WHERE id = 3`);
  o = (await call(`/staff/portfolios/${own4}`, 4)).j;
  await call(`/staff/portfolios/${own4}`, 4, "PUT", { version: o.portfolio.version, intro: "Hello" });
  r = await call("/staff/portfolios/mine/submit", 4, "POST", {});
  ok(r.status === 200 && r.j?.stage === "precheck" && r.j?.prechecker?.role === "coo", "chart: sent to the COO above them for a pre-check", r.text);
  const ask = (uid) => db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND ref LIKE 'portfolio:${own4}:ask:%'`).get(uid).n;
  ok(ask(3) === 1 && ask(1) === 1, "chart: the COO is asked; the CEO is not asked again yet");
  o = (await call(`/staff/portfolios/${own4}`, 3)).j;
  ok(o?.can?.precheck === true && o?.review?.stage === "precheck" && o?.can?.publish === false, "chart: the COO sees it waiting on them, and cannot publish", JSON.stringify([o?.can, o?.review]));
  ok((await call(`/staff/portfolios/${own4}`, 1)).j?.can?.precheck === false, "chart: the pre-check is the COO's, not the CEO's");
  ok((await call(`/staff/portfolios/${own4}/precheck`, 2, "POST", { decision: "ok" })).status === 403, "chart: HR cannot pre-check");
  ok((await call(`/staff/portfolios/${own4}/precheck`, 3, "POST", { decision: "return" })).status === 400, "chart: returning needs a note");
  r = await call(`/staff/portfolios/${own4}/precheck`, 3, "POST", { decision: "return", note: "Add a clearer photo" });
  ok(r.status === 200 && r.j?.stage === "returned", "chart: the COO returns it with a note", r.text);
  ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 4 AND ref LIKE 'portfolio:${own4}:ret:%'`).get().n === 1, "chart: the person is told why");
  ok((await call("/staff/portfolios/mine", 4)).j?.review?.stage === "returned", "chart: Profile shows it returned");
  r = await call("/staff/portfolios/mine/submit", 4, "POST", {});
  ok(r.j?.stage === "precheck" && ask(3) === 2, "chart: sent again, the COO is asked again", r.text);
  r = await call(`/staff/portfolios/${own4}/precheck`, 3, "POST", { decision: "ok" });
  ok(r.status === 200 && r.j?.stage === "approval", "chart: the COO marks it pre-checked", r.text);
  ok((await call(`/staff/portfolios/${own4}/precheck`, 3, "POST", { decision: "ok" })).status === 409, "chart: a second pre-check is refused (already decided)");
  ok(db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 1 AND ref LIKE 'portfolio:${own4}:pre:%'`).get().n === 1, "chart: the CEO is asked to approve once it is pre-checked");
  o = (await call(`/staff/portfolios/${own4}`, 1)).j;
  ok(o?.review?.stage === "approval" && o?.review?.prechecked_by, "chart: the CEO sees who pre-checked it", JSON.stringify(o?.review));
  ok((await call("/staff/portfolios", 1)).j?.people?.find((x) => x.user_id === 4)?.review?.stage === "approval", "chart: the list shows it ready to approve");
  let upd = false; try { db.exec(`UPDATE staff_portfolio_reviews SET step = 'prechecked'`); } catch { upd = true; }
  ok(upd, "chart: a review step is never edited (trigger)");
  db.exec(`UPDATE users SET reports_to = NULL WHERE id IN (3, 4)`);

  const slug4 = (await call("/staff/portfolios/mine", 4)).j?.portfolio?.slug;
  ok((await call(`/public/portfolio/${slug4}`, null)).status === 404, "self: a sent draft is still not public");
  o = (await call(`/staff/portfolios/${own4}`, 1)).j;
  ok((await call(`/staff/portfolios/${own4}/publish`, 3, "POST", { version: o.portfolio.version })).status === 403, "chart: the COO cannot publish");
  ok((await call(`/staff/portfolios/${own4}/publish`, 1, "POST", { version: o.portfolio.version })).status === 200 && (await call(`/public/portfolio/${slug4}`, null)).j?.portfolio?.tagline === "My own line", "self: the CEO publishes it, and the page shows their own words");
  o = (await call(`/staff/portfolios/${own4}`, 4)).j;
  await call(`/staff/portfolios/${own4}`, 4, "PUT", { version: o.portfolio.version, tagline: "Changed after approval" });
  ok((await call(`/public/portfolio/${slug4}`, null)).j?.portfolio?.tagline === "My own line", "self: an edit after approval stays private until published again");
  ok((await call("/staff/portfolios/mine", 4)).j?.review === null, "chart: once published, the review is done");

  /* 0220 - BM words (the CEO 19-11-2026: "text doesn't change to BM"): Translate proposes, staff save, publish freezes */
  const hadAI = rt.env.AI; delete rt.env.AI;
  ok((await call(`/staff/portfolios/${own4}/translate`, 4, "POST", {})).status === 503, "bm: no AI on the server - said plainly (503)");
  rt.env.AI = { run: async (_m, i) => ({ response: JSON.stringify(JSON.parse(i.messages[1].content).map((t) => `BM ${t}`)) }) };
  ok((await call(`/staff/portfolios/${pid}/translate`, 4, "POST", {})).status === 403, "bm: nobody translates someone else's portfolio");
  r = await call(`/staff/portfolios/${own4}/translate`, 4, "POST", {});
  ok(r.status === 200 && r.j?.content_ms?.tagline === "BM Changed after approval" && r.j?.content_ms?.phrases?.["Live Selling"] === "BM Live Selling" && r.j?.content_ms?.items && Object.values(r.j.content_ms.items).some((x) => x.title === "BM My work"), "bm: Translate proposes the tagline, the phrases and the work titles", r.text);
  o = (await call(`/staff/portfolios/${own4}`, 4)).j;
  ok(!o.portfolio.content_ms, "bm: a proposal saves nothing");
  ok((await call(`/staff/portfolios/${own4}`, 4, "PUT", { version: o.portfolio.version, content_ms: { tagline: "  Garisan saya  ", intro: 5, phrases: { "Live Selling": "Jualan Langsung", "Empty": "  " }, items: { abc: { title: "x" } } } })).status === 200, "bm: the person saves the checked BM words");
  o = (await call(`/staff/portfolios/${own4}`, 4)).j;
  ok(JSON.stringify(o.portfolio.content_ms) === JSON.stringify({ tagline: "Garisan saya", phrases: { "Live Selling": "Jualan Langsung" } }), "bm: what is saved is cleaned (trimmed, strings only, empties and bad keys dropped)", JSON.stringify(o.portfolio.content_ms));
  ok(!(await call(`/public/portfolio/${slug4}`, null)).j?.portfolio?.ms, "bm: the public page has no BM until it is published");
  await call(`/staff/portfolios/${own4}/publish`, 1, "POST", { version: o.portfolio.version });
  r = await call(`/public/portfolio/${slug4}`, null);
  ok(r.j?.portfolio?.ms?.tagline === "Garisan saya" && r.j?.portfolio?.ms?.phrases?.["Live Selling"] === "Jualan Langsung", "bm: once published, the page carries the approved BM words", r.text.slice(0, 300));
  rt.env.AI = { run: async () => ({ response: "not json" }) };
  ok((await call(`/staff/portfolios/${own4}/translate`, 4, "POST", {})).status === 502, "bm: a translation that does not come back is said, never half-saved (502)");
  if (hadAI) rt.env.AI = hadAI; else delete rt.env.AI;
  ok(db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'portfolio.edit' AND user_id = 4`).get().n >= 2, "self: their edits are in the audit log");

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
  dir: read("components/staff/staff-directory.tsx"), mine: read("components/portal/my-portfolio.tsx"),
};
function checks(s) {
  const out = [];
  const t = (c, m) => out.push([!!c, m]);
  t(/\/portfolio\/elfia\s+\/portfolio\s+301[\s\S]*\/portfolio\/:name\s+\/portfolio\/staff\s+200/.test(s.redirects), "every /portfolio/<name> is the one static page (rewrite 200), after the /portfolio/elfia 301");
  t(/\\\/api\\\/v1\\\/public\\\/portfolio\\\//.test(s.idx), "the public API lives under /api/v1/public/portfolio (the content list keeps /api/v1/portfolio)");
  t(/const LATEST_MIGRATION = "(0216_staff_portfolios|0217_portfolio_display_name|0218_portfolio_name_case|0219_portfolio_review|0220_portfolio_bm|0221_card_rules)"/.test(s.idx) && /"0216_staff_portfolios",\n\s*("0217_portfolio_display_name",\n\s*)?("0218_portfolio_name_case",\n\s*)?("0219_portfolio_review",\n\s*)?("0220_portfolio_bm",\n\s*)?("0221_card_rules",\n\s*)?\];/.test(s.idx), "0216 is in the expected list (0217 the nickname after it)");
  t(/if \(r\.assignee_id !== user\.id\) return err\("forbidden"/.test(s.pf) && /a\.role === "coo" \|\| a\.role === "cco"/.test(s.pf), "0219: only the COO / CCO on the reporting chart pre-checks");
  t(/portfolio_manage: \[[^\]]*"hr_admin"[^\]]*\]/.test(s.perms) && /portfolio_publish: \["super_admin", "ceo"\]/.test(s.perms), "portfolio_manage and portfolio_publish are PERMS caps (publish = CEO and super admin; the COO / CCO pre-check)");
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
  t(/const writer = manage \|\| isOwn\(p, s, user\);/.test(s.pf) && /isOwn = \(p: \{ user_id: number \}, s: \{ current: number \} \| null, user: StaffUser\) => p\.user_id === user\.id && Boolean\(s\?\.current\)/.test(s.pf), "self (v1.390.0): a person writes only their OWN portfolio, while on staff");
  t(/rest === "\/publish" && method === "POST"\) \{\n\s*if \(!publish\)/.test(s.pf) && /rest === "\/unpublish" && method === "POST"\) \{\n\s*if \(!publish\)/.test(s.pf), "self: publishing and unpublishing stay the approver's");
  t(/<dialog ref=\{sheet\}/.test(s.page) && /data-testid="portfolio-dock"/.test(s.page) && /data-testid="portfolio-form"/.test(s.page) && /\/public\/portfolio\/\$\{slug\}\/enquiry/.test(s.page), "v1.391.0 page: an inline enquiry card on a wide screen, a sticky dock and a native sheet on a phone, the same enquiry route");
  t(/const email = p\.email \?\? A2Z_CREATIVE\.email;/.test(s.page) && !/CONTACT\.email/.test(s.page), "v1.391.0 page: with no approved email it shows A2Z Creative Marketing's own, never another company's");
  t(/const bm = lang === "ms" \? \(p\.ms \?\? null\) : null;/.test(s.page) && /const T = \(en: string\) => bm\?\.phrases\?\.\[en\] \?\? en;/.test(s.page), "0220 page: BM visitors read the approved BM words, English where none is written");
  t(/if \(rest === "\/translate" && method === "POST"\) \{\n\s*if \(!writer\)/.test(s.pf) && /portfolio_translate:\$\{user\.id\}/.test(s.pf), "0220: Translate is the writer's, budgeted per person");
  t(!/portfolio-card/.test(s.page), "v1.391.0 page: the public page does not draw or change the card (PNG / PDF stay in lib/portfolio-card.ts)");
  t(/data-testid="my-portfolio-create"/.test(s.mine) && /data-testid="my-portfolio-edit"/.test(s.mine) && /PortfolioEditor/.test(s.mine) && /data-testid="pf-submit"/.test(s.studio), "self: Profile offers Create / Edit my portfolio with the one editor, and Send for approval");
  return out;
}
const base = checks(SRC);
let failed = 0;
for (const [p, m] of [...runtime, ...base]) if (!p) { failed++; console.log(`  x ${m}`); }
const MUT = [
  ["render", "a QR drawn for a draft", `qrUrl: d.portfolio.state === "published" ? d.portfolio.public_url : null`, `qrUrl: d.portfolio.public_url ?? d.portfolio.address`],
  ["perms", "HR may publish", `portfolio_publish: ["super_admin", "ceo"]`, `portfolio_publish: ["super_admin", "ceo", "hr_admin"]`],
  ["redirects", "the rewrite dropped", "/portfolio/:name  /portfolio/staff  200", ""],
  ["pf", "drafts made public", "state = 'published' AND published_json IS NOT NULL", "published_json IS NOT NULL OR 1 = 1"],
  ["pf", "anyone writes any portfolio", "const writer = manage || isOwn(p, s, user);", "const writer = true;"],
  ["pf", "anyone may pre-check", `if (r.assignee_id !== user.id) return err("forbidden"`, `if (false) return err("forbidden"`],
  ["pf", "the owner may publish", `if (rest === "/publish" && method === "POST") {\n    if (!publish)`, `if (rest === "/publish" && method === "POST") {\n    if (!publish && !writer)`],
];
let caught = 0;
if (!process.env.NOMUT) for (const [k, name, from, to] of MUT) {
  if (!SRC[k].includes(from)) { failed++; console.log(`  x mutation did not apply: ${name}`); continue; }
  if (checks({ ...SRC, [k]: SRC[k].replace(from, to) }).some(([p]) => !p)) caught++; else { failed++; console.log(`  x mutation not caught: ${name}`); }
}
/* 19-11-2026 (the CEO: "Key specialties require to find correct svc ... make sure that it is able to check
   and match it properly") - the specialty icons: each common specialty its own fitting icon (English and
   Malay), no two on one card when another fits, and every icon drawn from absolute starts (a piece that
   began with a relative "m" had been drawn from the end of the piece before it) */
{
  const { execSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { pathToFileURL } = await import("node:url");
  const outF = join(mkdtempSync(join(tmpdir(), "icons-")), "ci.mjs");
  execSync(`npx esbuild "${join(root, "lib/card-icons.ts")}" --format=esm --outfile="${outF}" --log-level=error`, { cwd: root });
  const { iconFor, iconsFor, CARD_ICONS } = await import(pathToFileURL(outF).href);
  const want = {
    "Graphic Design": "design", "Branding": "brand", "Multimedia": "multimedia", "Video Editing": "clapper", "Marketing Design": "megaphone",
    "Live Selling": "live", "Content Creation": "content", "Copywriting": "copywrite", "Social Media Management": "share", "Photography": "camera",
    "Facebook Ads": "click", "SEO": "seo", "Customer Service": "headset", "Client Relationship": "handshake", "E-commerce": "cart",
    "Inventory Management": "package", "Accounting": "calculator", "Data Analysis": "chart", "Event Management": "calendar", "Project Management": "clipboard",
    "Recruitment": "team", "UI/UX Design": "layout", "Motion Graphics": "wand", "Illustration": "brush", "Public Speaking": "mic",
    "Reka Bentuk Grafik": "design", "Penjenamaan": "brand", "Suntingan Video": "clapper", "Pemasaran Digital": "click", "Media Sosial": "share", "Canva": "design",
  };
  let bad = Object.entries(want).filter(([l, ic]) => iconFor(l) !== ic).map(([l, ic]) => `${l}: ${iconFor(l)} (want ${ic})`);
  if (bad.length) { failed++; console.log(`  x a specialty gets the wrong icon - ${bad.join("; ")}`); }
  const card = iconsFor(["Graphic Design", "Poster Design", "Layout Design"]);
  if (new Set(card).size !== 3) { failed++; console.log(`  x two specialties on one card share an icon when another fits - ${card.join(", ")}`); }
  bad = Object.entries(CARD_ICONS).filter(([, d]) => !/^M/.test(d) || / m[-.\d]/.test(d)).map(([k]) => k);
  if (bad.length) { failed++; console.log(`  x an icon piece starts with a relative move (drawn in the wrong place) - ${bad.join(", ")}`); }
  if (iconFor("Hardware") !== "star") { failed++; console.log("  x a specialty nothing fits should get the star"); }
}
if (failed) { console.log(`staff-portfolios: ${failed} failed`); process.exit(1); }
console.log(`PASS - staff portfolios: real worker on every migration; draft/unpublished/leaver never public; publish is the approval and freezes photo + work; no private field public; the address fixed; no QR without a page (${runtime.length} runtime + ${base.length} static checks${process.env.NOMUT ? "" : `, ${caught} mutations caught`})`);
