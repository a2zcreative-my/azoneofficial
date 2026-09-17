import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "company-review-"));
const db = new DatabaseSync(":memory:");
try {
  const bundle = join(dir,"review.mjs");
  execSync(`npx --no-install esbuild worker/src/company-review.ts --bundle --platform=node --format=esm --outfile="${bundle}"`, { stdio:"pipe" });
  const { handleCompanyReview } = await import(pathToFileURL(bundle).href);
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER);
    INSERT INTO users VALUES(1,'CEO','ceo',1),(2,'Employee','editor',1),(3,'Customer','customer',1);
    CREATE TABLE audit_log(id INTEGER PRIMARY KEY,user_id INTEGER,action TEXT,entity TEXT,entity_id TEXT,detail TEXT);
    CREATE TABLE expenses(id INTEGER PRIMARY KEY,vendor TEXT,description TEXT,expense_date TEXT,amount_cents INTEGER);
    INSERT INTO expenses VALUES(1,'Shared vendor','Office expenses','2026-09-17',12345),(2,'Unknown vendor','Uncertain owner','2026-09-17',5000);
    CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY,po_no TEXT,items TEXT,total_cents INTEGER);
    INSERT INTO purchase_orders VALUES(1,'PO-1','[{"inventory_item_id":1}]',1000);
    CREATE TABLE bank_accounts(id INTEGER PRIMARY KEY,name TEXT,bank TEXT,number_masked TEXT);
    INSERT INTO bank_accounts VALUES(1,'Operating account','Bank','1234');
    CREATE TABLE cashflow_entries(id INTEGER PRIMARY KEY,bank_id INTEGER,amount_cents INTEGER,description TEXT,ref TEXT);
    INSERT INTO cashflow_entries VALUES(1,1,3000,'Movement','EXP-1');
    CREATE TABLE reconciliations(id INTEGER PRIMARY KEY,period TEXT,channel TEXT,order_no TEXT,customer TEXT);
    INSERT INTO reconciliations VALUES(1,'2026-09','direct','Order-1','Customer');
    CREATE TABLE inventory_items(id INTEGER PRIMARY KEY,sku TEXT,name TEXT,stock INTEGER);
    INSERT INTO inventory_items VALUES(1,'SKU1','Stock item',20);
    CREATE TABLE manual_stockouts(id INTEGER PRIMARY KEY,item_id INTEGER,item_name TEXT,qty INTEGER);
    INSERT INTO manual_stockouts VALUES(1,1,'Stock item',3);
    CREATE TABLE stock_ledger(id INTEGER PRIMARY KEY,item_id INTEGER,delta INTEGER,source TEXT);
    INSERT INTO stock_ledger VALUES(1,1,-3,'manual');
    CREATE TABLE journal_entries(id INTEGER PRIMARY KEY,memo TEXT,ref TEXT);
    INSERT INTO journal_entries VALUES(1,'Office expense','EXP-1');`);
  db.exec(readFileSync("worker/migrations/0134_company_review.sql","utf8"));
  let failAudit = false, beforeBatch = null;
  const DB = {
    prepare(sql) {
      let values = [];
      const execute = method => {
        if (failAudit && sql.includes("INSERT INTO audit_log")) throw new Error("injected audit failure");
        let args = values;
        const query = /\?\d/.test(sql) ? sql.replace(/\?(\d+)/g, (_, n) => "?") : sql;
        if (/\?\d/.test(sql)) args = [...sql.matchAll(/\?(\d+)/g)].map(m => values[Number(m[1])-1]);
        return db.prepare(query)[method](...args);
      };
      return { bind(...args) { values=args; return this; }, async first() { return execute("get") ?? null; }, async all() { return { results:execute("all") }; }, async run() { const r=execute("run"); return { success:true,meta:{ changes:Number(r.changes) } }; } };
    },
    async batch(statements) {
      if (beforeBatch) { const fn=beforeBatch; beforeBatch=null; fn(); }
      db.exec("BEGIN");
      try { const result=[]; for (const s of statements) result.push(await s.run()); db.exec("COMMIT"); return result; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
  const ceo = { id:1,name:"CEO",email:"ceo@example.test",role:"ceo" };
  const call = (path, method="GET", body=null, role="ceo") => handleCompanyReview({ DB },new URL(`https://fixture.test${path}`),path.split("?")[0],method,body,{ ...ceo,role });
  const parsed = async r => { assert.equal(r.status,200,await r.clone().text()); return r.json(); };
  const detail = (kind="expenses",id=1) => call(`/records/${kind}/${id}`).then(parsed);
  const payload = (row,extra={}) => ({ proposed_company:"azoo",reason:"Verified original invoice",version:row.decision?.version ?? 0,snapshot:row.snapshot,request_id:crypto.randomUUID(),...extra });
  const save = (row,body) => call(`/records/${row.kind}/${row.id}`,"PUT",body);
  const kinds = ["expenses","purchase_orders","bank_accounts","cashflow_entries","reconciliations","inventory_items","manual_stockouts","stock_ledger","journal_entries"];
  const balances = JSON.stringify(kinds.map(k => db.prepare(`SELECT * FROM ${k}`).all()));
  for (const role of ["editor","coo","admin","hr_admin","customer"]) {
    assert.equal((await call("/records?kind=expenses","GET",null,role)).status,403);
    assert.equal((await call("/records/expenses/1","PUT",{},role)).status,403);
    assert.equal((await call("/staff","GET",null,role)).status,403);
    assert.equal((await call("/staff/2","PUT",{},role)).status,403);
  }
  for (const kind of kinds) {
    const data=await parsed(await call(`/records?kind=${kind}`));
    assert(data.records.length > 0,kind);
    assert(data.records.every(r => r.state === "unassigned" && !r.decision),"No inferred ownership");
    assert.equal((await detail(kind)).kind,kind);
  }
  assert.equal((await call("/records?kind=users")).status,400);
  assert.equal((await call("/records?kind=expenses&page=-1")).status,400);
  assert.equal((await call("/records/expenses/999")).status,404);
  let row=await detail();
  assert.equal(row.related.length,0,"Free-text EXP-1 must not become an ownership link");
  assert.equal((await detail("cashflow_entries")).related[0].kind,"bank_accounts");
  assert.equal((await detail("purchase_orders")).related[0].kind,"inventory_items");
  assert.equal((await detail("inventory_items")).related.length,2);
  assert.equal((await save(row,payload(row,{ proposed_company:"invalid" }))).status,400);
  assert.equal((await save(row,payload(row,{ reason:"" }))).status,400);
  assert.equal((await save(row,payload(row,{ version:-1 }))).status,400);
  const original=payload(row);
  await parsed(await save(row,original));
  await parsed(await save(row,original));
  assert.equal(db.prepare("SELECT count(*) AS n FROM company_review_events").get().n,1,"Retry creates one event");
  assert.equal((await save(row,{ ...original,proposed_company:"a2z" })).status,409,"Request ID cannot be reused for a different decision");
  assert.equal((await save(row,payload(row))).status,409,"Concurrent old version refused");
  assert.equal((await parsed(await call("/records?kind=expenses"))).total,1);
  assert.equal((await parsed(await call("/records?kind=expenses&filter=reviewed"))).total,1);
  row=await detail();
  assert.equal(row.state,"proposed");
  assert.equal(row.history.length,1);
  assert.equal(JSON.parse(row.history[0].after_json).source_json,row.decision.source_json,"History preserves the reviewed source");
  const deferred=payload(row,{ proposed_company:null,reason:"Original ownership evidence is missing" });
  await parsed(await save(row,deferred));
  assert.equal((await detail()).state,"deferred");
  assert.equal(JSON.stringify(kinds.map(k => db.prepare(`SELECT * FROM ${k}`).all())),balances,"No review changes money, stock or operational records");

  row=await detail();
  db.exec("UPDATE expenses SET amount_cents=12346 WHERE id=1");
  assert.equal((await detail()).state,"stale");
  assert.equal((await save(row,payload(row))).status,409,"Changed source requires fresh review");
  row=await detail();
  beforeBatch=() => db.exec("UPDATE expenses SET amount_cents=12347 WHERE id=1");
  assert.equal((await save(row,payload(row))).status,409,"Source race is checked inside transaction");
  assert.equal(db.prepare("SELECT version FROM company_review_decisions WHERE record_id=1").get().version,2);
  row=await detail();
  const countBefore=db.prepare("SELECT count(*) AS n FROM company_review_events").get().n;
  failAudit=true;
  assert.equal((await save(row,payload(row))).status,500);
  failAudit=false;
  assert.equal(db.prepare("SELECT count(*) AS n FROM company_review_events").get().n,countBefore,"Event rolled back when audit fails");
  assert.equal(db.prepare("SELECT version FROM company_review_decisions WHERE record_id=1").get().version,2,"Decision rolled back when audit fails");
  assert.throws(() => db.exec("DELETE FROM company_review_events"),/immutable/);
  assert.throws(() => db.exec("UPDATE company_review_events SET actor_id=2"),/immutable/);
  let people=(await parsed(await call("/staff"))).staff;
  assert.equal(people.length,2,"Customers excluded");
  assert(people.every(p => p.employer_code === null && !p.memberships.length));
  const staffBody={ employer_code:"a2z",memberships:[{ company_code:"azoo",access_mode:"read" }],reason:"Reviewed employment and access needs",version:0,request_id:crypto.randomUUID() };
  await parsed(await call("/staff/2","PUT",staffBody));
  await parsed(await call("/staff/2","PUT",staffBody));
  assert.equal((await call("/staff/2","PUT",{ ...staffBody,request_id:crypto.randomUUID() })).status,409);
  assert.equal((await call("/staff/3","PUT",{ ...staffBody,request_id:crypto.randomUUID() })).status,404);
  assert.equal((await call("/staff/2","PUT",{ ...staffBody,version:1,memberships:[staffBody.memberships[0],staffBody.memberships[0]],request_id:crypto.randomUUID() })).status,400);
  people=(await parsed(await call("/staff"))).staff;
  const employee=people.find(p => p.id === 2);
  assert.equal(employee.employer_code,"a2z");
  assert.deepEqual(employee.memberships,staffBody.memberships,"Employer must not grant membership automatically");
  assert.equal(db.prepare("SELECT role FROM users WHERE id=2").get().role,"editor","Existing authority unchanged");
  assert.equal((await parsed(await call("/staff/2"))).history.length,1);
  failAudit=true;
  assert.equal((await call("/staff/2","PUT",{ ...staffBody,version:1,memberships:[],request_id:crypto.randomUUID() })).status,500);
  failAudit=false;
  assert.equal(db.prepare("SELECT count(*) AS n FROM company_memberships WHERE user_id=2").get().n,1,"Membership deletion rolled back");
  await parsed(await call("/staff/2","PUT",{ ...staffBody,version:1,memberships:[],employer_code:null,request_id:crypto.randomUUID() }));
  assert.equal(db.prepare("SELECT count(*) AS n FROM company_memberships WHERE user_id=2").get().n,0);
  db.exec("DROP TABLE company_review_decisions");
  assert.equal((await call("/records?kind=expenses")).status,503,"Missing migration is not an empty queue");
  console.log("Company review: authorization, no inferred ownership, evidence snapshots, atomic audit, retries, source races, staff setup and unchanged balances passed.");
} finally { db.close(); rmSync(dir,{ recursive:true,force:true }); }
