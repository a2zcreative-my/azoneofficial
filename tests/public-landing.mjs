/* Website restructure (18-11-2026, the owner's brief "A2Z CREATIVE MARKETING
 * WEBSITE RESTRUCTURING & SEO"). Holds the parts that must not drift:
 *   - the eight official services, each with its own page in EN and BM,
 *     its own SEO title and description, five FAQs and its own WhatsApp text
 *   - hreflang pairs (en-MY, ms-MY, x-default) on the homepage and every
 *     service page, and the sitemap lists them
 *   - the original identity on the hero: "Creative · Digital · Commerce",
 *     "Build the brand." / "Sell it live.", the two calls to action
 *   - one contact number, from constants/content.ts, never typed into a page
 *   - the enquiry form writes to the EXISTING intake only (/api/v1/enquiries)
 *   - no ranking or award claims; old /services anchors still land
 *     node tests/public-landing.mjs            (NOMUT=1 skips mutations) */
import { readFileSync } from "node:fs";

const R = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const F = {
  svc: "constants/services.ts",
  copy: "constants/home-copy.ts",
  home: "components/landing/home-sections.tsx",
  page: "components/landing/service-page.tsx",
  form: "components/landing/enquiry-form.tsx",
  enRoute: "app/services/[slug]/page.tsx",
  msRoute: "app/ms/services/[slug]/page.tsx",
  enHome: "app/page.tsx",
  msHome: "app/ms/page.tsx",
  hub: "app/services/page.tsx",
  map: "app/sitemap.ts",
  nav: "components/layout/navbar.tsx",
  foot: "components/layout/footer.tsx",
};

function checks(S) {
  const out = [];
  const ok = (name, cond) => out.push([Boolean(cond), name]);
  const slugs = [...S.svc.matchAll(/^\s{4}slug: "([a-z0-9-]+)",$/gm)].map((m) => m[1]);
  const WANT = [
    "live-host-malaysia", "live-commerce-management", "studio-rental-johor-bahru", "product-video-production",
    "creative-design", "mobile-videography", "website-design-johor-bahru", "affiliate-marketing",
  ];
  ok("the eight official services, in the brief's order, at the brief's URLs", JSON.stringify(slugs) === JSON.stringify(WANT));
  ok("each service has English and Bahasa Melayu copy", (S.svc.match(/^\s{4}en: \{$/gm) ?? []).length === 8 && (S.svc.match(/^\s{4}ms: \{$/gm) ?? []).length === 8);
  const faqs = [...S.svc.matchAll(/faqs: \[([\s\S]*?)\n\s{6}\],/g)].map((m) => (m[1].match(/\{ q: /g) ?? []).length);
  ok("five FAQs on every page, both languages", faqs.length === 16 && faqs.every((n) => n === 5));
  const titles = [...S.svc.matchAll(/seoTitle: "([^"]+)"/g)].map((m) => m[1]);
  const descs = [...S.svc.matchAll(/seoDescription:\s*"([^"]+)"/g)].map((m) => m[1]);
  ok("sixteen unique SEO titles", titles.length === 16 && new Set(titles).size === 16);
  ok("sixteen unique descriptions, none over 170 characters", descs.length === 16 && new Set(descs).size === 16 && descs.every((d) => d.length <= 170));
  const wa = [...S.svc.matchAll(/whatsapp: "([^"]+)"/g)].map((m) => m[1]);
  ok("a WhatsApp message per service per language", wa.length === 16 && new Set(wa).size === 16);
  ok("work shows only real, approved examples (brands registry, our own channels and site)", !/name: "(?!@|Shopee Live|a2zcreative\.my)[^"]+",\s*\n\s*what:/.test(S.svc) && /brandByCode\("elfia"\)/.test(S.svc));
  ok("no ranking, award or number-one claims", !/(#1|No\.\s?1|number[- ]one|award[- ]winning|top[- ]rated|best agency|guaranteed (sales|results|ranking))/i.test(S.svc + S.copy + S.home + S.page));
  for (const [k, langs] of [["enRoute", ["en-MY", "ms-MY", "x-default"]], ["msRoute", ["en-MY", "ms-MY", "x-default"]], ["enHome", ["en-MY", "ms-MY", "x-default"]], ["msHome", ["en-MY", "ms-MY", "x-default"]]]) {
    ok(`${F[k]} declares its canonical and the hreflang pair`, /canonical:/.test(S[k]) && langs.every((l) => S[k].includes(`"${l}"`)));
  }
  ok("both service routes are built at export time", /generateStaticParams/.test(S.enRoute) && /generateStaticParams/.test(S.msRoute) && /dynamicParams = false/.test(S.enRoute));
  ok("the sitemap lists every service page in both languages", /SERVICE_PAGES\.flatMap/.test(S.map) && /\/ms\/services\/\$\{s\.slug\}/.test(S.map) && /alternates: \{ languages \}/.test(S.map));
  const n = (re) => (S.copy.match(re) ?? []).length;
  ok("the hero keeps the original brand line and statement, in both languages", n(/eyebrow: "Creative · Digital · Commerce"/g) === 2 && n(/line1: "Build the brand\."/g) === 2 && n(/line2: "Sell it live\."/g) === 2);
  ok("the hero's calls to action are the brief's", /primary: "Get a Free Consultation"/.test(S.copy) && /secondary: "View Our Work"/.test(S.copy));
  ok("no drawn phone or simulated live room on the hero", !/liveChip|bubble|Studio view|illustration/i.test(S.home));
  ok("the number is never typed into a page", !/383\s?4821|60123834821/.test(S.home + S.page + S.form + S.nav + S.foot + S.svc));
  ok("the enquiry form writes only to the existing intake", (S.form.match(/Fetch\(|\bfetch\(/g) ?? []).length === 1 && /csrfFetch\("\/api\/v1\/enquiries"/.test(S.form));
  ok("the enquiry carries its service and page for the team", /\[Service: \$\{serviceName\}\] \[Page: \$\{path\}\]/.test(S.form));
  ok("the same enquiry is not sent twice from one browser within a day", /seen\(fp\)/.test(S.form) && /remember\(fp\)/.test(S.form));
  ok("the form says what the details are for and links the policy", /href="\/privacy"/.test(S.form));
  ok("the old /services anchors still land", ["live-host-service", "live-commerce-management", "content-creation-and-video", "creative-marketing", "digital-marketing", "consultancy-and-business-development"].every((a) => S.hub.includes(`"${a}"`)));
  ok("the menu and the footer list the eight service pages", /SERVICE_PAGES\.map/.test(S.nav) && /servicePath\(s, lang\)/.test(S.nav) && /SERVICE_PAGES\.map/.test(S.foot));
  return out;
}

const SRC = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, R(p)]));
const base = checks(SRC);
let failed = 0;
for (const [pass, name] of base) if (!pass) { failed++; console.log(`  ✗ ${name}`); }
const MUT = [
  ["svc", "a service page dropped", '    slug: "affiliate-marketing",', '    slug: "affiliate-marketing-x",'],
  ["copy", "the brand statement reworded", 'line2: "Sell it live."', 'line2: "Sell more."'],
  ["home", "the number typed into the hero", "{displayPhone()}", "+60 12-383 4821"],
  ["form", "a second endpoint", 'csrfFetch("/api/v1/enquiries"', 'csrfFetch("/api/v1/leads"'],
  ["enRoute", "the BM pair dropped", '"ms-MY": `/ms${path}`, ', ""],
  ["svc", "a ranking claim", "Live hosts who sell, in Bahasa Melayu and English", "The number-one live hosts in Malaysia"],
];
let caught = 0;
if (!process.env.NOMUT) {
  for (const [k, name, from, to] of MUT) {
    if (!SRC[k].includes(from)) { failed++; console.log(`  ✗ mutation did not apply: ${name}`); continue; }
    if (checks({ ...SRC, [k]: SRC[k].replace(from, to) }).some(([p]) => !p)) caught++;
    else { failed++; console.log(`  ✗ mutation not caught: ${name}`); }
  }
}
if (failed) { console.log(`public-landing: ${failed} failed`); process.exit(1); }
console.log(`PASS - public landing: eight service pages in EN and BM with their own titles, FAQs and WhatsApp text; hreflang pairs and the sitemap; the original hero; one number; the existing enquiry intake only (${base.length} checks${process.env.NOMUT ? "" : `, ${caught} mutations caught`})`);
