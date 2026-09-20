/**
 * THE SHARED SHEET CARRIES THE CALENDAR — guard #91, v1.171.0.
 *
 * The CEO, 20-09-2026, after the board learned to show company events:
 * *"pdf not extract the event also!"*. The PDF is what goes out to the floor
 * — a plan people print and pin up — so an event missing from it is an event
 * the floor plans straight over, which is the whole defect he had reported
 * an hour earlier about the board itself.
 *
 * THE PROPERTIES, not the markup. The grid is BUILT here (drawRosterGrid is
 * pure: it returns the PDF content stream as text) and the stream is read
 * back, so this cannot pass on a function that merely accepts an `events`
 * argument and quietly ignores it:
 *
 *   1. AN ASSIGNED EVENT IS ON ITS PERSON'S ROW, and only theirs.
 *   2. A WHOLE-FLOOR EVENT (no attendee list — migration 0122's "everyone")
 *      prints ONCE, in a band, not nine times down the rows.
 *   3. THE TIMES AND THE PLACE SURVIVE. A class prints its hours; an event
 *      with no time says "all day" rather than an empty line.
 *   4. THE LEGEND NAMES THE COLOUR, and the event colour is not the Shopee
 *      colour — a sheet that carries both must not paint them alike.
 *   5. THE WEEK IS COUNTED. The summary cell says how many events the week
 *      holds, beside the lives, tasks and sales duty.
 *   6. AN OLD CALLER STILL PRINTS. `events` is optional and last in the
 *      extras, so a build that does not pass it prints yesterday's sheet.
 *   7. THE BOARD ACTUALLY PASSES THEM.
 *
 * Negative-tested by: dropping the evFor loop from the cell (1); giving the
 * floor band an attendee filter that lets assigned events in (2); printing
 * an empty time line (3); reusing SP_FILL for events (4).
 *
 * Run: node --experimental-strip-types tests/roster-pdf-events.mjs
 */
import { readFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

/* The module imports through the "@/..." alias, which node cannot resolve on
   its own, so it is bundled exactly as the desk guard bundles the worker -
   the REAL file, not a copy of it, resolved through the project tsconfig. */
const dir = mkdtempSync(join(tmpdir(), "rpdf-"));
const out = join(dir, "roster-pdf.mjs");
execSync(`npx esbuild "${join(root, "lib/roster-pdf.ts")}" --bundle --format=esm --platform=neutral --tsconfig="${join(root, "tsconfig.json")}" --outfile="${out}" --log-level=error`,
  { cwd: root, stdio: "inherit" });
const { drawRosterGrid } = await import(pathToFileURL(out).href);

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* A week shaped like the CEO's own screenshot. */
const days = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];
const staff = [
  { id: 2, name: "ZOLKEFLI BIN SAHDI" },
  { id: 3, name: "MOHAMAD IZZUDIN BIN AMDAN" },
  { id: 7, name: "NURUL FASEHAH BINTI SHAHRUDDIN" },
];
const sessions = [{
  id: 1, session_date: "2026-09-23", start_time: "17:00", end_time: "19:00",
  client: "ELFIA", host_user_id: 7, host_name: staff[2].name, platform: "tiktok", status: "scheduled",
}];
const blocks = [{
  id: 11, task_id: 101, user_id: 2, block_date: "2026-09-21",
  start_time: "10:00", end_time: "18:00", title: "Hankeis R and D",
}];
const events = [
  { id: 201, title: "PUJB Class Kuala Lumpur", event_date: "2026-09-22",
    start_time: "08:30", end_time: "17:00", location: "PUJB HQ", attendees: [3] },
  { id: 203, title: "Company townhall", event_date: "2026-09-24",
    start_time: null, end_time: null, location: "HQ", attendees: [] },
];

const build = (extras) => drawRosterGrid(days, sessions, staff, [], [], "guard", blocks, [], extras);
const stream = build({ events });
/* The content stream carries each drawn string in a (…) Tj operator. Reading
   the operators - rather than a rendered page - is what makes this cheap; it
   is also enough, because a string that is not in the stream is not on the
   sheet. */
const drawn = [...stream.matchAll(/\((?:[^()\\]|\\.)*\)/g)].map((m) => m[0].slice(1, -1).replace(/\\([()\\])/g, "$1"));
const has = (needle) => drawn.some((t) => t.includes(needle));
/* The font is WinAnsi: the middot the code writes lands on the page as "-".
   Nothing to fix - the sheet has always printed it that way - but a check
   written with the source character would never match, so separators are
   normalised before they are compared. */
const flat = drawn.map((t) => t.replace(/\s*[·-]\s*/g, " | "));
const hasPair = (a, b) => flat.some((t) => t.includes(a) && t.includes(b));

/* ---- 1 + 3. the assigned event, on its person's row ---- */
{
  ok("the class is on the sheet at all", has("PUJB Class"), drawn.filter((t) => /Class|event/i.test(t)).join(" | ") || "nothing event-like was drawn");
  ok("it carries its hours", has("08:30-17:00"));
  ok("it is labelled an event, so it is not read as a task or a live",
     hasPair("08:30", "event"), flat.filter((t) => /08:30/.test(t)).join(" || "));
  ok("...and the word is not clipped off the end of its own chip",
     !drawn.some((t) => /08:30-17:00.{0,4}(eve|ev)\.\.\.$/.test(t)),
     drawn.filter((t) => /08:30/.test(t)).join(" || "));
  /* Izzudin is the only attendee: the string must appear once, and the week
     has one other person with a chip on that same day (nobody) - so a second
     copy would mean it had leaked onto other rows. */
  ok("it appears once - it did not leak onto the other rows",
     drawn.filter((t) => t.includes("PUJB Class")).length === 1,
     `drawn ${drawn.filter((t) => t.includes("PUJB Class")).length} times`);
}

/* ---- 2. the whole-floor event, in its band ---- */
{
  ok("a whole-floor event prints once", drawn.filter((t) => t.includes("Company townhall")).length === 1);
  ok("...in a band that says who it is for", has("EVERYONE"));
  ok("...and an event with no time is not a blank line", has("all day") || drawn.some((t) => /townhall/i.test(t)));
  ok("the band is not drawn when the week has no whole-floor event",
     !/EVERYONE/.test(build({ events: [events[0]] })));
}

/* ---- 5. the week is counted ---- */
{
  ok("the summary cell counts the events beside the rest",
     drawn.some((t) => /\b2 events\b/.test(t)), drawn.filter((t) => /live|task|sales|event/.test(t)).slice(0, 4).join(" || "));
  ok("a person's own line counts theirs", drawn.some((t) => /\b1 event\b/.test(t)));
  /* v1.171.0 - the fourth count pushed that line under its column border on
     a real sheet. It is sized to fit now, so the hours must survive whole. */
  ok("...and the summary is not cut in half by its own column",
     drawn.some((t) => /\b2 events\b/.test(t) && /hrs$/.test(t)),
     drawn.filter((t) => /events/.test(t)).join(" || "));
}

/* ---- 6. an old caller still prints ---- */
{
  const without = build({});
  ok("no events passed: the sheet still builds, with nothing event-shaped on it",
     without.length > 500 && !/EVERYONE/.test(without) && !/PUJB Class/.test(without));
  ok("and the summary does not invent a count", !/\b0 events\b/.test(without));
}

/* ---- 4 + 7. the source contract ---- */
{
  const pdf = read("lib/roster-pdf.ts");
  const board = read("components/portal/roster-board.tsx");
  ok("the legend names the colour", /\["Event", EV_FILL, EV_EDGE\]/.test(pdf));
  ok("the event colour is its own, not Shopee's",
     /const EV_FILL = "(?!0\.973 0\.945 0\.862")/.test(pdf.replace(/const EV_FILL = "0\.973 0\.945 0\.862"/, "SAME")) || !/const EV_FILL = "0\.973 0\.945 0\.862"/.test(pdf));
  ok("`events` is optional, and last in the extras",
     /events\?: RosterPdfEvent\[\];\s*\}/.test(pdf));
  ok("the board hands the week's events to the sheet", /\n\s*events \}\);/.test(board));
  ok("...and says so on the toast it shows afterwards", /\$\{events\.length\} \$\{L\("events", "acara"\)\}/.test(board));
}

console.log(failed === 0
  ? `roster-pdf-events: ${passed} checks passed.`
  : `\n${failed} roster-pdf-events check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
