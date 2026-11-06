/* v1.269.0 - Phase 2A: run what a REAL browser (Chromium's virtual
 * authenticator, tests/browser/auth-2a.py) posted through the worker's own
 * verifier, worker/src/webauthn.ts - bundled bare, as the worker runs it.
 * stdin: { reg: { credential, challenge, origin }, logins: [{ credential, challenge, origin }], rpId }
 * stdout: { registration, logins: [...], wrongOrigin, wrongChallenge } */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), "wa-")), "webauthn.mjs");
execSync(`npx esbuild "${join(root, "worker/src/webauthn.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const wa = await import(pathToFileURL(out).href);
const input = JSON.parse(readFileSync(0, "utf8"));
const rpId = input.rpId;
const reg = await wa.verifyRegistration(input.reg.credential, { challenge: input.reg.challenge, origins: [input.reg.origin], rpId });
const result = { registration: reg.ok ? { ok: true, alg: reg.alg, uv: true, signCount: reg.signCount } : reg, logins: [] };
if (reg.ok) {
  let count = reg.signCount;
  const handle = input.reg.userHandle;
  for (const l of input.logins) {
    const cred = { credential_id: reg.credentialId, public_key: reg.publicKey, alg: reg.alg, sign_count: count, user_handle: handle };
    const v = await wa.verifyAssertion(l.credential, cred, { challenge: l.challenge, origins: [l.origin], rpId });
    result.logins.push(v);
    if (v.ok) count = v.signCount;
  }
  const l0 = input.logins[0];
  const cred0 = { credential_id: reg.credentialId, public_key: reg.publicKey, alg: reg.alg, sign_count: 0, user_handle: handle };
  result.wrongOrigin = await wa.verifyAssertion(l0.credential, cred0, { challenge: l0.challenge, origins: ["https://evil.example"], rpId });
  result.wrongChallenge = await wa.verifyAssertion(l0.credential, cred0, { challenge: "AAAA", origins: [l0.origin], rpId });
}
console.log(JSON.stringify(result));
