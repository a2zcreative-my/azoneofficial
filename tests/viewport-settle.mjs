/* tests/viewport-settle.mjs - v1.181.4: THE BARS COME BACK WHEN THE KEYBOARD GOES.
 *
 * The CEO's iPhone, 23-09-2026, Profile, after typing a new password: the
 * bottom bar floating one keyboard-height up the screen and the topbar gone.
 * iOS left `visualViewport.offsetTop` at the keyboard's height after the
 * keyboard closed, and everything pinned to the layout viewport was drawn
 * that far up. lib/viewport-settle.ts scrolls the layout viewport back under
 * the visual one.
 *
 * No browser in this sandbox has an iOS keyboard, so the guard RUNS the
 * installer against a fake window that reproduces the stuck state, and holds:
 *
 *   1. stuck offset + nothing focused -> scrolled to scrollY + offset;
 *   2. a field still focused (keyboard up) -> left alone;
 *   3. a pinch zoom -> left alone;
 *   4. no offset -> no scroll at all (it must never fight a normal scroll);
 *   5. it fires on the viewport's resize AND after focusout;
 *   6. the cleanup removes every listener and timer;
 *   7. no visualViewport -> a no-op, not a crash;
 *   8. the portal provider installs it, once, in an effect (the provider
 *      mounts once for the whole portal; the shell is a pure view).
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const importPath = (p) => p.replace(/\\/g, "/");

let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` - ${why}` : ""}`); } };

const dir = mkdtempSync(join(tmpdir(), "viewport-settle-"));
writeFileSync(join(dir, "entry.ts"), `export * from "${importPath(join(root, "lib/viewport-settle.ts"))}";`);
const out = join(dir, "vs.mjs");
execSync(`npx esbuild "${join(dir, "entry.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`,
  { cwd: root, stdio: "inherit" });
const { settleTarget, installViewportSettle } = await import(pathToFileURL(out).href);
try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }

/* ---- a fake window: synchronous timers and frames, counted listeners ---- */
function fakeWindow({ offsetTop = 0, scale = 1, scrollY = 1200, focused = null, vv = true } = {}) {
  const listeners = { vv: new Map(), doc: new Map() };
  const add = (m) => (t, f) => { m.set(t, [...(m.get(t) ?? []), f]); };
  const rem = (m) => (t, f) => { m.set(t, (m.get(t) ?? []).filter((g) => g !== f)); };
  const fire = (m, t) => { for (const f of m.get(t) ?? []) f(); };
  let timers = 0;
  const w = {
    scrollX: 0, scrollY, scrolls: [],
    scrollTo(x, y) { this.scrolls.push([x, y]); this.scrollY = y; },
    setTimeout(f) { timers++; f(); return timers; },
    clearTimeout() {},
    requestAnimationFrame(f) { f(); return 1; },
    cancelAnimationFrame() {},
    visualViewport: vv ? { offsetTop, height: 500, scale, addEventListener: add(listeners.vv), removeEventListener: rem(listeners.vv) } : null,
    document: {
      activeElement: focused ? { matches: (sel) => sel.includes(focused) } : { matches: () => false },
      addEventListener: add(listeners.doc), removeEventListener: rem(listeners.doc),
    },
    fireResize: () => fire(listeners.vv, "resize"),
    fireFocusOut: () => fire(listeners.doc, "focusout"),
    count: () => [...listeners.vv.values(), ...listeners.doc.values()].reduce((n, a) => n + a.length, 0),
  };
  return w;
}

/* 1. the stuck state is settled */
{
  const w = fakeWindow({ offsetTop: 336 });
  installViewportSettle(w);
  w.fireResize();
  ok("1. a stuck keyboard offset is scrolled away", w.scrolls.length >= 1 && w.scrolls.at(-1)[1] === 1200 + 336, JSON.stringify(w.scrolls));
}
/* 2. keyboard still up */
{
  const w = fakeWindow({ offsetTop: 336, focused: "input" });
  installViewportSettle(w); w.fireResize(); w.fireFocusOut();
  ok("2. a focused field is left alone (the keyboard is up)", w.scrolls.length === 0);
  const w2 = fakeWindow({ offsetTop: 336, focused: "textarea" });
  installViewportSettle(w2); w2.fireResize();
  ok("2. ...a textarea too", w2.scrolls.length === 0);
}
/* 3. pinch zoom */
{
  const w = fakeWindow({ offsetTop: 200, scale: 2 });
  installViewportSettle(w); w.fireResize();
  ok("3. a pinch zoom is left alone", w.scrolls.length === 0);
}
/* 4. nothing to do */
{
  const w = fakeWindow({ offsetTop: 0 });
  installViewportSettle(w); w.fireResize(); w.fireFocusOut();
  ok("4. no offset, no scroll", w.scrolls.length === 0);
  ok("4. half a pixel is rounding, not a stuck keyboard", settleTarget({ offsetTop: 0.4, height: 500, scale: 1 }, false, 10) === null);
}
/* 5. focusout path */
{
  const w = fakeWindow({ offsetTop: 300 });
  installViewportSettle(w); w.fireFocusOut();
  ok("5. focusout settles it too", w.scrolls.length >= 1 && w.scrolls[0][1] === 1500);
}
/* 6. cleanup */
{
  const w = fakeWindow({ offsetTop: 300 });
  const stop = installViewportSettle(w);
  ok("6. it listens (resize + focusout)", w.count() === 2, String(w.count()));
  stop();
  ok("6. the cleanup removes every listener", w.count() === 0, String(w.count()));
}
/* 7. no visualViewport */
{
  let threw = false;
  try { const stop = installViewportSettle(fakeWindow({ vv: false })); stop(); } catch { threw = true; }
  ok("7. no visualViewport is a no-op, not a crash", !threw);
}
/* 8. wired in */
{
  const shell = read("components/portal/portal-provider.tsx");
  ok("8. the portal provider imports the installer", /import \{ installViewportSettle \} from "@\/lib\/viewport-settle";/.test(shell));
  ok("8. ...and installs it once, in an effect, returning the cleanup",
    (shell.match(/useEffect\(\(\) => installViewportSettle\(window\), \[\]\);/g) ?? []).length === 1);
}

if (failed) {
  console.log(`\nviewport-settle: ${failed} failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`viewport-settle: ${passed} checks passed - the bars come back when the keyboard goes.`);
