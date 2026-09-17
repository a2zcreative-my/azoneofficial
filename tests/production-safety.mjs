import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { patchSheetXml, unzip, zipStore } from "../worker/src/m2e.ts";

function functionSource(path, name) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const fn = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  assert(fn, `${name} exists`);
  const local = ts.factory.updateFunctionDeclaration(
    fn,
    fn.modifiers?.filter((m) => m.kind !== ts.SyntaxKind.ExportKeyword),
    fn.asteriskToken,
    fn.name,
    fn.typeParameters,
    fn.parameters,
    fn.type,
    fn.body
  );
  return ts.transpileModule(
    ts.createPrinter().printNode(ts.EmitHint.Unspecified, local, source),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText;
}

const otp = vm.runInNewContext(
  `const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; ${functionSource("worker/src/index.ts", "base32Decode")} ${functionSource("worker/src/index.ts", "totpAt")} totpAt`,
  { crypto, Uint8Array, ArrayBuffer, DataView }
);
// RFC 6238 SHA-1 vectors, expressed as the six digits used by the portal.
for (const [time, expected] of [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
]) {
  assert.equal(
    await otp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", Math.floor(time / 30)),
    expected
  );
}
const data = new TextEncoder().encode("Payroll fixture");
const zipped = zipStore([{ name: "xl/worksheets/sheet1.xml", data }]);
assert.deepEqual(await unzip(zipped), [
  { name: "xl/worksheets/sheet1.xml", data },
]);
await assert.rejects(() => unzip(zipped.slice(0, 15)));
const corrupt = zipped.slice();
new DataView(corrupt.buffer).setUint32(corrupt.length - 6, 0xffffff00, true);
await assert.rejects(() => unzip(corrupt));
const xml = patchSheetXml(
  '<worksheet><sheetData><row r="2"><c r="B2" s="3"><v>1</v></c></row></sheetData></worksheet>',
  new Map([
    [
      2,
      [
        { col: "A", text: "00123" },
        { col: "B", num: 45.6 },
      ],
    ],
    [1, [{ col: "A", text: "A&B" }]],
  ])
);
assert(xml.includes('<c r="B2" s="3"><v>45.6</v></c>'));
assert(xml.includes(">00123</t>") && xml.includes(">A&amp;B</t>"));

const shareSource = functionSource("lib/doc-pdf.ts", "sharePdfFile");
for (const outcome of ["shared", "cancelled", "unavailable", "unsupported"]) {
  let downloads = 0,
    revoked = 0;
  const share = vm.runInNewContext(`${shareSource}; sharePdfFile`, {
    File,
    Blob,
    DOMException,
    navigator: {
      canShare: () => outcome !== "unsupported",
      share: async () => {
        if (outcome === "cancelled")
          throw new DOMException("Dismissed", "AbortError");
        if (outcome === "unavailable")
          throw new DOMException("Blocked", "NotAllowedError");
      },
    },
    URL: {
      createObjectURL: () => "blob:test",
      revokeObjectURL: () => revoked++,
    },
    document: {
      body: { append() {} },
      createElement: () => ({ click: () => downloads++, remove() {} }),
    },
    setTimeout: (fn) => fn(),
  });
  assert.equal(
    await share(new Blob(["pdf"]), "test.pdf", "Test"),
    outcome === "shared" || outcome === "cancelled" ? outcome : "downloaded"
  );
  assert.equal(
    downloads,
    outcome === "unavailable" || outcome === "unsupported" ? 1 : 0
  );
  assert.equal(revoked, downloads);
}
console.log(
  "production-safety: OTP vectors, payroll ZIP/XML and PDF sharing outcomes passed."
);
