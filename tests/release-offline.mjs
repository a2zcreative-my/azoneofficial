import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { saveAndPush, verifyHealth } from "../scripts/verify-release.mjs";

function runner({ staged = 0, fail, remoteHead = "abc" } = {}) {
  const calls = [];
  const run = (_, args) => {
    calls.push(args);
    if (args[0] === fail) throw Error("simulated failure");
    return { code: args[0] === "diff" ? staged : 0, output: args[0] === "symbolic-ref" ? "main"
      : args[0] === "config" ? (args[2].endsWith("remote") ? "origin" : "refs/heads/main")
      : args[0] === "ls-remote" ? `${remoteHead}\trefs/heads/main` : "abc" };
  };
  return { calls, run };
}
let r = runner();
assert.equal(saveAndPush("fixture", "test", r.run), "abc");
assert(!r.calls.some(x => x[0] === "commit"));
r = runner({ staged: 1 });
saveAndPush("fixture", "test", r.run);
assert(r.calls.some(x => x[0] === "commit"));
for (const fail of ["add", "diff", "commit", "push", "ls-remote"]) {
  assert.throws(() => saveAndPush("fixture", "test", runner({ staged: 1, fail }).run));
}
assert.throws(() => saveAndPush("fixture", "test", runner({ remoteHead: "other" }).run));
const health = data => async () => new Response(JSON.stringify(data), { status: 200 });
await verifyHealth("https://a2zcreative.my/api/v1/health", health({ ok: true, db: true }));
await assert.rejects(verifyHealth("https://a2zcreative.my/api/v1/health", health({ ok: true, db: false })));
await assert.rejects(verifyHealth("https://elfiaofficialstore.my/api/v1/health", health({ ok: true, db: true, r2: true, migrations_current: false })));
await assert.rejects(verifyHealth("https://a2zcreative.my/api/v1/health", async () => new Response("unavailable", { status: 503 })));

const handlers = {};
const cached = new Map([["/portal", new Response("portal html", { headers: { "content-type": "text/html" } })]]);
const caches = { open: async () => ({ put: async () => {}, match: async key => cached.get(key.url ?? key) }),
  match: async key => cached.get(key.url ?? key), keys: async () => [], delete: async () => true };
vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
  self: { location: { origin: "https://fixture.test" }, addEventListener: (name, fn) => { handlers[name] = fn; } },
  caches, URL, Response, fetch: async () => { throw Error("offline"); },
});
const request = async (path, mode = "cors") => {
  let answer;
  handlers.fetch({ request: { method: "GET", url: `https://fixture.test${path}`, mode },
    respondWith: value => { answer = value; }, waitUntil: () => {} });
  return answer;
};
assert.equal((await request("/_next/static/missing.js")).type, "error");
assert.equal((await request("/missing.css")).type, "error");
assert.equal((await request("/portal?tab=On%20Shift", "navigate")).headers.get("content-type"), "text/html");
assert.equal(await request("/api/v1/staff/attendance"), undefined);
cached.set("https://fixture.test/_next/static/present.js", new Response("script", { headers: { "content-type": "application/javascript" } }));
assert.equal((await request("/_next/static/present.js")).headers.get("content-type"), "application/javascript");
console.log("Release failure handling and offline asset behavior passed.");
