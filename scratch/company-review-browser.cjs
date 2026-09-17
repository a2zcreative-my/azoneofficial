// Local browser fixtures only. No live business API requests are allowed through.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:3210';
const output = join(tmpdir(),'erp-company-review');
(async () => {
  mkdirSync(output,{ recursive:true });
  const browser = await chromium.launch({ channel:'msedge',headless:true });
  try {
    for (const width of [360,390,768,1440]) for (const scenario of ['review','stale','unavailable']) {
      const context=await browser.newContext({ viewport:{ width,height:1000 },serviceWorkers:'block' });
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e => errors.push(e.message));
      let decision=null, employee={ id:9003,name:'Review Employee',role:'editor',is_active:1,employer_code:null,memberships:[],version:0 };
      let history=[],staffHistory=[],savedStaff=null;
      const record=() => ({ id:1,title:'Shared vendor / Office expenses',date:'2026-09-17',amount_cents:12345,quantity:null,state:decision ? decision.proposed_company ? 'proposed' : 'deferred' : 'unassigned',decision });
      await page.addInitScript(() => { localStorage.setItem('azone-install-dismissed','1'); localStorage.setItem('azone-lang','en'); });
      await page.route('**/api/v1/**',async route => {
        const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/api/v1','');
        if (req.resourceType() === 'eventsource') return route.fulfill({ status:200,contentType:'text/event-stream',body:': fixture\n\n' });
        let status=200,data={ records:[],tasks:[],leave:[],announcements:[],events:[],sessions:[],items:[],rows:[],findings:[],open:[],watchers:[],notifications:[],users:[],versions:{},birthdays:[],holidays:[],staff:[],balances:{},pending:[],patterns:[],assignments:[],ot:[] };
        if (p === '/auth/me') data={ user:{ id:9002,name:'Review CEO',role:'ceo',email:'review@example.test' } };
        if (p === '/staff/tabs/access') data={ overrides:{},mine:{ allow:[],deny:[] } };
        if (p === '/staff/desk') data={ items:[],counts:{},total:0,missing:[] };
        if (p.startsWith('/staff/companies/')) {
          if (scenario === 'unavailable') { status=503; data={ error:{ message:'Company review migration 0134 is required' } }; }
          else if (p === '/staff/companies/records') data={ records:decision && url.searchParams.get('filter') === 'unassigned' ? [] : [record()],total:decision && url.searchParams.get('filter') === 'unassigned' ? 0 : 1 };
          else if (p === '/staff/companies/records/expenses/1' && req.method() === 'GET') data={ ...record(),kind:'expenses',snapshot:'a'.repeat(64),source:{ id:1,vendor:'Shared vendor',description:'Office expenses',amount_cents:12345 },related:[],related_truncated:false,history };
          else if (p === '/staff/companies/records/expenses/1' && req.method() === 'PUT') {
            if (scenario === 'stale') { status=409; data={ error:{ message:'The source or review changed. Reload it before saving' } }; }
            else { const b=req.postDataJSON(); decision={ proposed_company:b.proposed_company,reason:b.reason,version:(decision?.version ?? 0)+1,source_json:'{}',reviewed_at:'2026-09-17 08:00:00',reviewed_by_name:'Review CEO' }; history=[{ actor_name:'Review CEO',created_at:'2026-09-17 08:00:00',after_json:JSON.stringify(decision) },...history]; data={ ok:true }; }
          } else if (p === '/staff/companies/staff') data={ staff:[employee] };
          else if (p === '/staff/companies/staff/9003' && req.method() === 'GET') data={ history:staffHistory };
          else if (p === '/staff/companies/staff/9003' && req.method() === 'PUT') { savedStaff=req.postDataJSON(); employee={ ...employee,...savedStaff,version:employee.version+1 }; staffHistory=[{ actor_name:'Review CEO',created_at:'2026-09-17 08:00:00',after_json:JSON.stringify(savedStaff) }]; data={ ok:true }; }
        }
        return route.fulfill({ status,contentType:'application/json',body:JSON.stringify(data) });
      });
      await page.goto(base+'/portal?tab=Companies',{ waitUntil:'networkidle',timeout:120000 });
      await page.addStyleTag({ content:'nextjs-portal { display:none !important; }' });
      if (scenario === 'unavailable') {
        await page.getByRole('alert').filter({ hasText:'migration 0134' }).waitFor();
        assert.equal(await page.getByText('No matching records.',{ exact:true }).count(),0);
      } else {
        await page.getByRole('button',{ name:/Shared vendor \/ Office expenses/ }).click();
        await page.getByLabel('Proposed company').waitFor();
        await page.getByLabel('Proposed company').selectOption('azoo');
        await page.getByLabel('Evidence / reason').fill('Original invoice verified with management');
        await page.screenshot({ path:join(output,`company-record-${scenario}-${width}.png`),fullPage:true });
        await page.getByRole('button',{ name:'Save review',exact:true }).click();
        await page.getByRole('button',{ name:'Confirm review',exact:true }).click();
        if (scenario === 'stale') {
          await page.getByRole('alert').filter({ hasText:'source or review changed' }).waitFor();
          assert.equal(await page.getByLabel('Evidence / reason').inputValue(),'Original invoice verified with management');
        } else {
          await page.getByText('Review saved. Reconciliation remains pending.',{ exact:true }).waitFor();
          await page.getByLabel('Review status').selectOption('reviewed');
          await page.getByRole('button',{ name:/Shared vendor \/ Office expenses/ }).click();
          await page.getByLabel('Proposed company').selectOption('');
          await page.getByLabel('Evidence / reason').fill('Further original ownership evidence is needed');
          await page.getByRole('button',{ name:'Save review',exact:true }).click();
          await page.getByRole('button',{ name:'Confirm review',exact:true }).click();
          await page.getByText('Deferred',{ exact:true }).waitFor();
          assert.equal(decision.proposed_company,null);
          await page.getByRole('button',{ name:'Staff setup',exact:true }).click();
          await page.getByRole('button',{ name:/Review Employee/ }).click();
          await page.getByLabel('Employer',{ exact:true }).selectOption('a2z');
          assert.equal(await page.getByRole('checkbox',{ name:'A2Z CREATIVE MARKETING',exact:true }).isChecked(),false);
          await page.getByRole('checkbox',{ name:'AZ ONE OFFICIAL',exact:true }).check();
          await page.getByLabel('Reason',{ exact:true }).fill('Employment record and access plan verified');
          await page.screenshot({ path:join(output,`company-staff-${width}.png`),fullPage:true });
          await page.getByRole('button',{ name:'Save setup',exact:true }).click();
          await page.getByRole('button',{ name:'Confirm setup',exact:true }).click();
          await page.getByText('Review saved. Reconciliation remains pending.',{ exact:true }).waitFor();
          assert.equal(savedStaff.employer_code,'a2z');
          assert.deepEqual(savedStaff.memberships,[{ company_code:'azoo',access_mode:'read' }]);
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1),false,`${scenario}/${width} horizontal overflow`);
      assert.deepEqual(errors,[],`${scenario}/${width} runtime errors`);
      console.log(`PASS ${scenario} ${width}px`);
      await context.close();
    }
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
