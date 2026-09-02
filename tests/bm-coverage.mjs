/* v1.26.0 — BM coverage guard (CEO: "When I toggle BM, all the pages doesnt
   translate to BM!"). Walks every portal tab as CEO with localStorage
   azone-lang=ms and fails if common English UI words appear, or any tab
   crashes. Needs the static export served on :8931 (python3 -m http.server
   8931 --directory out). Run: node tests/bm-coverage.mjs [Tab...] */
import { chromium } from 'playwright-core';
const LISTY=['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','docs','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs','media','activity','balances','approvals','journal','journals','pos','allocations','spends','statements','runs','history','tabs','fences','documents','ot','batches','vault_docs'];
const OBJY=['by_status','by_courier','summary','totals','stats','counts','connection','health','by_state','geo','pipeline','breakdown','settings','config','balance','company'];
const EN_WORDS=/\b(Loading|Submit|Cancel|Delete|Search|Pending|Approved|Rejected|Upload|Download|Nothing|Today|Yesterday|This month|Create|Close|Week|Total|Amount|Actions|Announcements|Attendance|Apply leave|Clock in|Clock out|No records|Add new|Save changes|Settings|Overtime|Waiting|Approve|Reject|Not clocked|Showing|per page|scheduled|completed|cancelled|Preparing|Shipped|Delivered|Supplier|Purchase|Customer|Invoice|Quotation|Receipt|Expenses|Documents|month by month|best yet|Revenue|Sales history|leaderboard|attention|No results|Nothing waiting|Add rule|team goal|no rules yet)\b/g;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const p = await (await b.newContext({viewport:{width:1400,height:950}})).newPage();
await p.addInitScript(() => { try { localStorage.setItem('azone-lang','ms'); sessionStorage.clear(); } catch {} });
const errs=[];
p.on('pageerror', e => errs.push(e.message.slice(0,100)));
await p.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url()).pathname;
  let body={}; for(const k of LISTY) body[k]=[]; for(const k of OBJY) body[k]={};
  body.has_rules=false; body.total_cents=0; body.month='2026-08';
  body.reports=[]; body.shift=''; body.report=null;
  if (url.includes('/staff/attendance/monitor')) body={date:'2026-08-18', staff:[]};
  else if (url.includes('/attendance/report')) body={shift:'', records:[]};
  else if (url.includes('/staff/roster')) body={week_start:'2026-08-17', days:['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23'], manager:true, sessions:[], on_leave:[], requests:[], available_today:[], staff:[], hosts:[], conflicts:[], free_today:[], unassigned:[]};
  else if (url.includes('/staff/revenue') && !url.includes('/lines')) body={month:'2026-08',tiktok:{this_cents:0,this_orders:0,last_cents:0,last_orders:0},invoiced:{this_cents:0,this_docs:0,last_cents:0,last_docs:0}};
  else if (url.includes('/auth/me')) body={user:{id:1,email:'ceo@a.com',name:'Alif',role:'ceo'}};
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});
await p.goto('http://localhost:8931/portal.html',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(3500);
/* v1.40.1 (AUDIT M17): the tab list is DERIVED from ALL_TABS + the i18n
   dictionary instead of hardcoded. The old 23-item list silently skipped the
   24th tab ("Web Orders" / "Pesanan Web") and printed "every tab renders
   fully in BM" over a tab it never visited — exactly the reads-like-it-ran
   failure this suite exists to prevent. A tab missing a DICT entry fails
   here, before the browser even launches. */
import { readFileSync } from 'node:fs';
function derivedTabs() {
  /* v1.79.0: ALL_TABS moved to lib/portal-tabs.ts — one registry read by the
     portal, the access card and this suite. */
  const page = readFileSync('lib/portal-tabs.ts', 'utf8');
  const m = page.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/);
  if (!m) { console.error('FAIL: ALL_TABS not found in lib/portal-tabs.ts'); process.exit(1); }
  const names = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const dict = readFileSync('lib/i18n.ts', 'utf8');
  const ms = [];
  for (const name of names) {
    const dm = dict.match(new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}":\\s*\\{\\s*en:[^,]+,\\s*ms:\\s*"([^"]+)"`));
    if (!dm) { console.error(`FAIL: tab "${name}" has no ms entry in lib/i18n.ts DICT`); process.exit(1); }
    ms.push(dm[1]);
  }
  console.log(`walking ${ms.length} tabs (derived from ALL_TABS): ${ms.join(' · ')}`);
  return ms;
}
const TABS=(process.argv[2]||"").length ? process.argv.slice(2) : derivedTabs();
const findings={};
for (const tab of TABS) {
  console.log('TAB:', tab, new Date().toISOString());
  await p.goto('http://localhost:8931/portal.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2200);
  const ok = await p.locator(`button[aria-label="${tab}"]`).first().click({timeout:6000}).then(()=>true).catch(()=>false);
  if (!ok) { findings[tab]=['<CLICK FAILED>']; continue; }
  await p.waitForTimeout(1200);
  const txt = await Promise.race([p.evaluate(()=>document.body.innerText), new Promise(r=>setTimeout(()=>r('<EVAL TIMEOUT>'),8000))]);
  /* v1.27.0: app/portal/error.tsx is bilingual now, and this walk runs in BM —
     match BOTH wordings or a crashing tab would slip through as a pass. */
  if (/Something went wrong|Ada masalah pada skrin ini/.test(txt)) { const d=(txt.match(/(?:Detail for support|Butiran untuk sokongan): (.*)/)||[])[1]; findings[tab]=['<CRASHED> '+(d||'')]; await p.goto('http://localhost:8931/portal.html',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500); continue; }
  const hits=[...new Set((txt.match(EN_WORDS)||[]))]; if (hits.length) { for (const h of hits) { const i=txt.indexOf(h); console.log('CTX['+h+']:', JSON.stringify(txt.slice(Math.max(0,i-60), i+60))); } }
  if (hits.length) findings[tab]=hits;
  
}
console.log('PAGEERRORS:', JSON.stringify(errs.slice(0,5)));
console.log('FINDINGS:', JSON.stringify(findings, null, 1));
if (Object.keys(findings).length) { console.log('FAIL — English leaked into BM mode (or a tab crashed)'); process.exit(1); }
console.log('PASS — every tab renders fully in BM');
await b.close();
