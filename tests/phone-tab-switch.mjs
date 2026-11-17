/* v1.356.0 - THE PHONE'S VIEW SWITCH, EVERYWHERE (the CEO, 18-11-2026: "tabs
   should follow like a dashboard ... globally").
   On a phone every page's sections are the Dashboard's "CEO View ▾" pill and
   its menu, drawn by the ONE shared LineTabs; from 768px the underline row is
   unchanged. These checks keep it that way:
   - LineTabs draws the switch (a menu button naming the open section) and the
     menu of every section (menuitemradio, the open one ticked, counts kept);
   - below 768px the stylesheet shows the switch and hides the underline row,
     from 768px the reverse, so nothing jumps after the page loads;
   - the switch is the navy pill of the Dashboard's ViewSwitch (primary fill,
     full radius, 44px touch height) - tokens only, no colour of its own. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let passed = 0, failed = 0;
const ok = (label, cond) => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}`); } };

const tsx = read("components/ui/line-tabs.tsx");
const css = read("components/ui/line-tabs.module.css");
ok("LineTabs draws the phone switch: a menu button naming the open section", /aria-haspopup="menu"/.test(tsx) && /aria-expanded=\{open\}/.test(tsx) && /cur\[3\] \?\? cur\[1\]/.test(tsx));
ok("...and a menu of every section, the open one ticked", /role="menu"/.test(tsx) && /role="menuitemradio"/.test(tsx) && /aria-checked=\{k === value\}/.test(tsx) && /tabs\.map\(\(\[k, text, n\]\)/.test(tsx));
ok("...that closes on Escape and when focus leaves it", /e\.key === "Escape"/.test(tsx) && /onBlur=/.test(tsx));
ok("the underline row is still drawn (tablet and desktop)", /role="tablist"/.test(tsx) && /role="tab"/.test(tsx));
const phone = css.match(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/g)?.join("\n") ?? "";
ok("below 768px: the switch shows and the underline row is hidden", /\.switch \{[^}]*display: block/.test(phone) && /\.tabs \{[^}]*display: none/.test(phone));
ok("from 768px: the switch is hidden by default", /^\.switch \{[^}]*display: none/m.test(css));
const chip = css.match(/\.chip \{([^}]*)\}/)?.[1] ?? "";
ok("the switch is the Dashboard's navy pill (tokens only, 44px)", /background: var\(--primary\)/.test(chip) && /border-radius: var\(--radius-full\)/.test(chip) && /min-height: 2\.75rem/.test(chip) && !/#[0-9a-f]{3,6}/i.test(css));
ok("the page's own action stays on the same line on a phone", /\.aside \{[^}]*margin-left: auto/.test(phone));

console.log(failed ? `phone-tab-switch: ${failed} of ${passed + failed} failed` : `phone-tab-switch: ${passed} checks passed - on a phone every page's sections are the Dashboard's view switch`);
if (failed) process.exit(1);
