/* v1.361.0 - the CEO (18-11-2026): "resigned staff should be in grey and at
   the bottom of the list since it is inactive, same goes to staff records".
   The Directory (list and grid) and the Staff Records picker put working
   staff first, inactive accounts next and leavers last, whatever the sort,
   and draw the last two greyed. Order and colour only: nobody is hidden. */
import { readFileSync } from "node:fs";
const D = readFileSync(new URL("../components/staff/staff-directory.tsx", import.meta.url), "utf8");
const C = readFileSync(new URL("../components/staff/staff-page.module.css", import.meta.url), "utf8");
let n = 0, bad = 0;
const ok = (name, pass) => { n++; if (!pass) { bad++; console.error(`  ✗ ${name}`); } };
ok("one ranking: working 0, inactive 1, left 2",
   /const dimRank = \(u: Staff\) => \(isGone\(u\) \? 2 : stateOf\(u\) === "inactive" \? 1 : 0\);/.test(D));
ok("leavers go last as a stable partition (the chosen sort holds inside each group)",
   /const leaversLast = <T extends Staff>\(list: T\[\]\): T\[\] => \[0, 1, 2\]\.flatMap\(\(r\) => list\.filter\(\(u\) => dimRank\(u\) === r\)\);/.test(D));
ok("the Directory reads the ordered list", /const ranked = leaversLast\(sorted\);/.test(D));
ok("the Staff Records picker reads the ordered list", /const recList = leaversLast\(staff\)\.filter\(/.test(D));
ok("list rows grey", /\$\{isDim\(u\) \? sp\.rowGone : ""\}/.test(D));
ok("grid tiles grey", /\$\{isDim\(u\) \? sp\.tileGone : ""\}/.test(D));
ok("record picks grey", /\$\{isDim\(u\) \? sp\.pickGone : ""\}/.test(D));
ok("nobody is filtered out by the ordering", !/leaversLast\([^)]*\)\.filter\(\(u\) => !isDim/.test(D));
ok("the grey is a token, never a hex", /\.rowGone td \{\s*background: color-mix\(in srgb, var\(--secondary\)/.test(C)
   && /\.pickGone \{\s*background: color-mix\(in srgb, var\(--secondary\)/.test(C) && !/Gone[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(C));
if (bad) { console.error(`staff-leavers-last: ${bad} of ${n} failed`); process.exit(1); }
console.log(`staff-leavers-last: ${n} checks passed - working staff first, inactive next, leavers last and greyed in the Directory and Staff Records; nobody hidden`);
