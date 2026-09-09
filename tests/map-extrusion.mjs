/**
 * THE RAISED STATES ARE STILL MALAYSIA — guard #64, v1.140.0.
 *
 * The CEO, 08-09-2026, asked for 3D state maps and settled the contract with
 * me: SVG extrusion, no WebGL, no library, and not one of the sixteen state
 * buttons given up. A state is not tilted, it is RAISED - its own figure says
 * how far - and the face swept underneath it is the wall. All four maps draw
 * it: Sales, Operations, ELFIA Traffic, Hotels.
 *
 * THE PROPERTIES, not the implementation:
 *   1. THE WALLS ARE THE COUNTRY. Every state has walls, no wall belongs to a
 *      state that does not exist, and every point of a state's wall lies
 *      inside that state's own bounding box - a wall cannot be built from a
 *      neighbour's coastline.
 *   2. NOTHING RAISED LEAVES THE FRAME. At the tallest lift, the highest ink
 *      of every state still sits inside viewBox "0 -20 860 400". This is the
 *      number that decides the viewBox, so it is asserted rather than trusted.
 *   3. A WALL IS CLOSED INK. Every subpath ends in Z, and there are as many
 *      subpaths as runs - an unclosed subpath fills to wherever the next one
 *      starts, which is a stripe across the map.
 *   4. NO FIGURE, NO INK. h = 0 draws nothing at all.
 *   5. THE LIFT IS BOUNDED AND FAIR. Zero for zero, never below the 2px floor
 *      for a real figure, never above the 16px ceiling, never decreasing as
 *      the figure grows, and square-rooted - a state at a quarter of the
 *      biggest stands more than a quarter as tall, which is the whole reason
 *      the curve is not linear.
 *
 *   6. AN ENCLAVE RISES WITH ITS HOST. Kuala Lumpur and Putrajaya are holes
 *      in Selangor's own outline; if they lift less than the hole does, the
 *      page shows through and reads as a crack across the map.
 *   7. THE FOUR MAPS DRAW IT THE SAME WAY. The wall is decorative in every one
 *      of them - never the button, never in the way of a finger - the RAISED
 *      state is what a press lands on, and the frame is the one the ceiling
 *      was measured against.
 *
 * Negative-tested by: moving one wall point 30px east of its state (1); lifting
 * the ceiling to 40 (2); dropping the Z from the last subpath (3); returning a
 * sliver at h = 0 (4); making liftFor linear (5); emptying HOST_STATE (6); and,
 * in a panel, making a wall clickable and dropping the north-first order (7).
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname.
   On Windows `new URL("..", import.meta.url).pathname` is "/C:/Users/..." -
   a URL path with a leading slash, not a file path - so join() produced
   "\\C:\\Users\\..." and every read failed with "C:\\C:\\Users\\...". */
const root = fileURLToPath(new URL("..", import.meta.url));

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const dir = mkdtempSync(join(tmpdir(), "mapx-"));
const out = join(dir, "map.mjs");
execSync(`npx esbuild "${join(root, "lib/malaysia-map.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`,
  { cwd: root, stdio: "inherit" });
const { STATES, STATE_WALLS, wallPath, liftFor, liftsFor } = await import(pathToFileURL(out).href);

/* the frame the panels draw in, and the ceiling liftFor may reach */
const VIEW_TOP = -20;
const MAX_LIFT = 16;

/* does this outline enclose anything? a repeated point does not. */
function hasArea(d) {
  let total = 0;
  for (const sub of d.split(/(?=M)/)) {
    const pts = outline(sub);
    let a = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    total += Math.abs(a);
  }
  return total > 1;
}

/* every point of a state's own outline, so a wall can be judged against it */
function outline(d) {
  const pts = [];
  for (const m of d.matchAll(/([ML])([-\d.,]+)/gi)) {
    const nums = m[2].split(/[,\s]+/).filter(Boolean).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  }
  return pts;
}

/* ---- 1. the walls are the country ---- */
{
  const names = STATES.map((s) => s.name);
  const walled = Object.keys(STATE_WALLS);
  /* A state has a wall exactly when it encloses area. Putrajaya's geometry in
     this projection is a single point repeated - the federal territory is
     smaller than a pixel at 860x380 - and a point sweeps no face however far
     it is raised. Asserted as the equivalence rather than as a list, so a
     future geometry that gives Putrajaya a real outline must also give it a
     wall, and nobody has to remember why it was exempt. */
  const wrong = names.filter((n) => {
    const st = STATES.find((s) => s.name === n);
    const has = Array.isArray(STATE_WALLS[n]) && STATE_WALLS[n].length > 0;
    return hasArea(st.d) !== has;
  });
  ok("a state has a wall exactly when it encloses area", wrong.length === 0,
     wrong.map((n) => `${n}: area ${hasArea(STATES.find((s) => s.name === n).d)}, wall ${!!STATE_WALLS[n]?.length}`).join(" · "));
  ok("no wall belongs to a state that is not on the map", walled.every((n) => names.includes(n)),
     walled.filter((n) => !names.includes(n)).join(", "));

  const strays = [];
  for (const st of STATES) {
    const pts = outline(st.d);
    const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
    for (const run of STATE_WALLS[st.name] ?? []) {
      for (const [x, y] of run) {
        if (x < minX - 0.2 || x > maxX + 0.2 || y < minY - 0.2 || y > maxY + 0.2) {
          strays.push(`${st.name} (${x},${y}) outside [${minX}..${maxX}]x[${minY}..${maxY}]`);
        }
      }
    }
  }
  ok("no wall point sits outside the state it belongs to", strays.length === 0, strays.slice(0, 3).join(" · "));

  const shortRuns = [];
  for (const [name, runs] of Object.entries(STATE_WALLS)) {
    for (const run of runs) if (run.length < 2) shortRuns.push(name);
  }
  ok("every run is a real edge, never a lone point", shortRuns.length === 0, shortRuns.join(", "));
}

/* ---- 2. nothing raised leaves the frame ---- */
{
  const escapes = [];
  for (const st of STATES) {
    const top = Math.min(...outline(st.d).map((p) => p[1]));
    if (top - MAX_LIFT < VIEW_TOP) escapes.push(`${st.name} tops out at ${(top - MAX_LIFT).toFixed(1)}`);
  }
  ok(`a state raised ${MAX_LIFT}px still sits inside viewBox top ${VIEW_TOP}`, escapes.length === 0, escapes.join(" · "));
  ok("the ceiling liftFor can reach is the one this guard checked",
     Math.abs(liftFor(1, 1) - MAX_LIFT) < 0.001, `liftFor(1,1) = ${liftFor(1, 1)}`);
}

/* ---- 3. a wall is closed ink ---- */
{
  const bad = [];
  for (const st of STATES) {
    const d = wallPath(st.name, 10);
    const opens = (d.match(/M/g) ?? []).length;
    const closes = (d.match(/Z/g) ?? []).length;
    const runs = (STATE_WALLS[st.name] ?? []).filter((r) => r.length > 1).length;
    if (opens !== runs || closes !== runs) bad.push(`${st.name}: ${opens} M, ${closes} Z, ${runs} runs`);
    if (d && !d.trimEnd().endsWith("Z")) bad.push(`${st.name}: last subpath left open`);
  }
  ok("every wall subpath is opened once and closed once", bad.length === 0, bad.slice(0, 3).join(" · "));

  /* the top edge of the wall is the bottom edge lifted by exactly h: the two
     halves of every subpath must answer the same shape, or the wall leans. */
  const h = 7;
  const st = STATES.find((s) => s.name === "Johor");
  const first = (STATE_WALLS.Johor ?? [])[0];
  const d = wallPath("Johor", h);
  ok("the wall starts at the first run's first point, lifted",
     !!st && !!first && d.startsWith(`M${first[0][0]} ${first[0][1] - h}`), d.slice(0, 40));
}

/* ---- 4. no figure, no ink ---- */
{
  ok("nothing is drawn at zero lift", wallPath("Johor", 0) === "" && wallPath("Johor", -3) === "");
  ok("a state with no wall data draws nothing rather than throwing", wallPath("Atlantis", 10) === "");
}

/* ---- 5. the lift is bounded and fair ---- */
{
  ok("no figure, no lift", liftFor(0, 100) === 0 && liftFor(50, 0) === 0 && liftFor(-5, 100) === 0);
  const samples = [1, 5, 25, 60, 99, 100];
  ok("every real figure clears the 2px floor", samples.every((v) => liftFor(v, 100) >= 2),
     samples.map((v) => liftFor(v, 100).toFixed(2)).join(", "));
  ok("no figure passes the 16px ceiling", samples.every((v) => liftFor(v, 100) <= MAX_LIFT)
     && liftFor(500, 100) <= MAX_LIFT, `liftFor(500,100) = ${liftFor(500, 100)}`);
  let rising = true;
  for (let v = 1; v < 100; v += 1) if (liftFor(v + 1, 100) < liftFor(v, 100)) rising = false;
  ok("a bigger figure never stands shorter", rising);
  /* the reason the curve is not linear: a quarter of the biggest must stand
     more than a quarter as tall, or the small states read as empty. */
  const quarter = (liftFor(25, 100) - 2) / (liftFor(100, 100) - 2);
  ok("a quarter of the biggest stands more than a quarter as tall", quarter > 0.4,
     `${(quarter * 100).toFixed(0)}% of the range`);
}

/* ---- 6. an enclave rises with its host ----
   Selangor carries Kuala Lumpur and Putrajaya as holes in its own outline.
   If the enclave lifts less than the hole does, the page shows through the
   gap and reads as a crack across the map. So the enclave takes the host's
   height exactly - whichever of the two carries the bigger figure. */
{
  const big = (n) => (n === "Selangor" ? 10 : n === "Kuala Lumpur" ? 100 : n === "Putrajaya" ? 1 : 0);
  const l = liftsFor(big, 100);
  ok("an enclave stands exactly as high as its host, even holding a bigger figure",
     l["Kuala Lumpur"] === l.Selangor && l.Putrajaya === l.Selangor,
     `Selangor ${l.Selangor?.toFixed(2)} · KL ${l["Kuala Lumpur"]?.toFixed(2)} · Putrajaya ${l.Putrajaya?.toFixed(2)}`);
  const flat = liftsFor((n) => (n === "Selangor" ? 0 : 100), 100);
  ok("a host with no figure keeps its enclaves on the page too",
     flat.Selangor === 0 && flat["Kuala Lumpur"] === 0 && flat.Putrajaya === 0);
  ok("an island is not an enclave - Labuan rises on its own figure",
     liftsFor((n) => (n === "Labuan" ? 100 : 0), 100).Labuan === liftFor(100, 100));
  ok("every state on the map gets a lift", STATES.every((s) => typeof l[s.name] === "number"));
}

/* ---- 7. the four maps draw it the same way ----
   The portal has one geometry and four consumers, and the CEO's rule for them
   is that they read as one product. The properties here are the ones that keep
   the extrusion honest in every one of them: the wall is decorative, the
   RAISED state is the button (so the hit area is what the eye sees), and the
   frame is the one the 16px ceiling was measured against. */
{
  const PANELS = [
    "components/portal/sales-map.tsx",
    "components/portal/ops-map.tsx",
    "components/portal/elfia-traffic-panel.tsx",
    "components/portal/hotels-panel.tsx",
  ];
  for (const p of PANELS) {
    const src = readFileSync(join(root, p), "utf8");
    const name = p.split("/").pop();
    ok(`${name} raises its states`, /wallPath\(/.test(src) && /liftsFor\(/.test(src));
    ok(`${name} keeps the wall out of the way of a finger`,
       (src.match(/d=\{wall\}/g) ?? []).length > 0
       && !/d=\{wall\}[^>]*role="button"/s.test(src)
       && (src.match(/d=\{wall\}[\s\S]{0,200}?pointerEvents="none"[\s\S]{0,60}?aria-hidden="true"/g) ?? []).length
          === (src.match(/d=\{wall\}/g) ?? []).length,
       "every wall path must be pointerEvents none and aria-hidden, and never the button");
    ok(`${name} moves the button with the state it draws`,
       /transform=\{h \? `translate\(0 \$\{-h\}\)` : undefined\}[\s\S]{0,120}?role="button"/.test(src),
       "the raised path is the button - a flat button under a raised state is a lie about where to press");
    ok(`${name} draws in the frame the ceiling was measured against`,
       src.includes('viewBox="0 -20 860 400"') && src.includes("aspect-[860/400]"),
       "viewBox and skeleton must both make room for the lift");
    ok(`${name} paints north first`, /sort\(\(a, b\) => a\.cy - b\.cy\)/.test(src),
       "a southern state is nearer the reader; its wall must cover its northern neighbour's");
  }
}

/* ---- 8. the generator that made this data is kept, and is not shipped ---- */
{
  const gen = join(root, "scratch/gen-state-walls.mjs");
  let has = true;
  try { readFileSync(gen, "utf8"); } catch { has = false; }
  ok("the offline generator is kept beside the data it produced", has,
     "scratch/gen-state-walls.mjs - without it nobody can regenerate the walls");
  const lib = readFileSync(join(root, "lib/malaysia-map.ts"), "utf8");
  ok("the shipped module still imports nothing", !/^\s*import\s/m.test(lib));
}

console.log(failed === 0
  ? `map-extrusion: ${passed} checks passed.`
  : `\n${failed} map-extrusion check(s) failed.`);
/* v1.148.1 - exitCode, NOT process.exit(). This guard `await import()`s a
   .ts module under --experimental-strip-types, and calling process.exit()
   while that loader is still tearing down aborts Node on Windows:
     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c:76
   cards-tab lost that race on the 09-09 deploy and failed the whole run one
   line after printing "35 passed, 0 failed", so nothing was published.
   Setting exitCode lets Node drain and exit on its own with the same status,
   and flushes stdout, which process.exit() on Windows does not reliably do.
   Early process.exit() calls in catch blocks above are left alone: those run
   only when an import already failed and MUST stop the script. */
process.exitCode = failed === 0 ? 0 : 1;