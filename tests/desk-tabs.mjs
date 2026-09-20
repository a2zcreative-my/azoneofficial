/**
 * ONE CARD, EVENTS FIRST, AND WHO IS AWAY — guard #72, v1.152.0.
 *
 * The CEO, 11-09-2026, on the Dashboard: *"I want My attendance — September
 * and Upcoming events into minimalist interface which is tabs. but Upcoming
 * events should be 1st tabs first. on Upcoming events need to add also staff
 * that planned leave so easier for me to aware on the calendar after
 * approval"*.
 *
 * THE PROPERTIES, not the implementation:
 *   1. THE TWO REFERENCE CARDS ARE ONE CARD WITH A PILL ROW, and the events
 *      pill is the first one - the one the card opens on.
 *   2. THE EVENTS BODY INSIDE THAT CARD HAS NO FRAME AND NO TITLE OF ITS
 *      OWN. A card inside a card, or a title under a pill that says the same
 *      word, is the opposite of the "minimalist" the CEO asked for.
 *   3. THE ANCHOR SURVIVES. The mobile hero card scrolls to #upcoming-events;
 *      it has to land on the new card.
 *   4. LEAVE ON THE CALENDAR IS APPROVED LEAVE, FROM THE PDPA DOOR. The
 *      calendar reads /leave/calendar (v1.131.0) - the route that already
 *      returns names and dates only, floor for managers and own days for
 *      everybody else - and never the type or the reason. It does not build
 *      a leave query of its own.
 *   5. THE MONTH ON SCREEN IS THE MONTH ASKED FOR: the request follows the
 *      calendar's month, first day to last.
 *   6. A LEAVE DAY IS DRAWN AND NAMED: a mark in the cell, the name on the
 *      desk, a legend entry, and the person on the day's agenda.
 *
 * Negative-tested by: putting the attendance pill first (1); leaving the
 * card frame on the embedded events body (2); dropping the anchor (3);
 * fetching /leave?all=1 instead (4); asking for a fixed range (5); dropping
 * the legend entry (6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const dash = read("components/portal/dashboard.tsx");
const events = read("components/portal/events.tsx");

/* ---- 1 + 3. one card, anchor kept ----
   v1.171.0 - the CEO, 20-09-2026: *"clean off my dashboard and resort it
   based on it own function and properly put in on their own tabs!"*, and
   his choice for the bottom of the page: "Tasks | Leave | News | Events".
   The v1.152.0 events/attendance card is folded away: the events are the
   FOURTH pill of the one work-overview card (tasks first - the v1.116.0
   order the CEO approved for that card), the personal month lives in the
   month card above, and the #upcoming-events anchor sits on the work card
   so anything that still scrolls to it lands on the events. The mobile hero
   (NextEventCard) that used to scroll there is gone from the Dashboard - a
   second navy band under the shift hero was the mess he described. */
{
  const cardStart = dash.indexOf('id="upcoming-events"');
  ok("the events anchor still exists", cardStart > 0);
  const cardBlock = dash.slice(cardStart, cardStart + 2500);
  ok("the anchor is on a card with a pill row", /className=\{`\$\{card\} scroll-mt-16`\}/.test(cardBlock) && /<SectionTabs/.test(cardBlock));
  const pills = [...cardBlock.matchAll(/\["(tasks|leave|news|events)", /g)].map((m) => m[1]);
  ok("the pills read tasks, leave, news, events", pills.join(",") === "tasks,leave,news,events", `pills: ${pills.join(",") || "none"}`);
  ok("the card opens on tasks", /useState<"tasks" \| "leave" \| "news" \| "events">\("tasks"\)/.test(dash));
  ok("bodies are hidden, not unmounted (SectionTabs' rule)", ["tasks", "leave", "news", "events"].every((k) => new RegExp(`<div hidden=\\{aroundTab !== "${k}"\\}`).test(dash)));
  ok("the separate events/attendance card is gone", !/deskTab/.test(dash) && !/useState<"events" \| "attendance">/.test(dash));
  ok("the personal month bar chart is gone with it (the month card draws the month once)", !/bg-bar-high/.test(dash) && (dash.match(/<MonthAttendanceCard /g) ?? []).length === 1);
  ok("the mobile hero is off the Dashboard", !/NextEventCard/.test(dash));
  ok("my schedule (own roster sessions) sits under the events pill, above the company calendar",
     /<div hidden=\{aroundTab !== "events"\} className="mt-4">[\s\S]{0,400}\{mySessions\.length > 0 && \([\s\S]*?<UpcomingEventsCard role=\{user\.role\} embedded \/>\s*<\/div>/.test(dash));
}

/* ---- 2. the embedded events body has no frame and no title ---- */
{
  ok("the dashboard embeds the events body", /<UpcomingEventsCard role=\{user\.role\} embedded \/>/.test(dash));
  ok("embedded drops the card frame", /<div className=\{embedded \? "" : card\}>/.test(events));
  const titleIdx = events.indexOf('{L("Upcoming events", "Acara akan datang")}');
  const before = events.slice(Math.max(0, titleIdx - 200), titleIdx);
  ok("embedded drops the title under the pill", titleIdx > 0 && /\{!embedded && \(/.test(before));
}

/* ---- 4 + 5. leave from the PDPA door, for the month on screen ---- */
{
  ok("the calendar reads /leave/calendar, the names-and-dates door", /`\/staff\/leave\/calendar\?from=\$\{calMonth\}-01&to=\$\{calMonth\}-\$\{String\(last\)\.padStart\(2, "0"\)\}`/.test(events));
  ok("and re-reads it when the month changes", /\}, \[calMonth\]\);/.test(events.slice(events.indexOf("/staff/leave/calendar"), events.indexOf("/staff/leave/calendar") + 400)));
  ok("it never asks the full leave list", !/\/staff\/leave\?all=1/.test(events) && !/\/staff\/leave`/.test(events));
  ok("the span carries no type and no reason", /interface LeaveSpan \{ user_id: number; name: string; start_date: string; end_date: string \}/.test(events) && !/LeaveSpan[^}]*type/.test(events));
  /* the worker side of the door has to keep its stance */
  const staff = read("worker/src/staff.ts");
  const door = staff.slice(staff.indexOf('if (path === "/leave/calendar" && method === "GET")'), staff.indexOf('if (path === "/leave/calendar" && method === "GET")') + 3000);
  ok("the door returns approved rows only", (door.match(/l\.status = 'approved'/g) ?? []).length >= 2);
  ok("the door selects names and dates, never the type", /SELECT l\.user_id, COALESCE\(NULLIF\(TRIM\(u\.full_name\), ''\), u\.name\) AS name, l\.start_date, l\.end_date/.test(door) && !/l\.type|l\.reason|l\.\*/.test(door));
  ok("the floor is managers only; everyone else sees their own days", /can\(user\.role, "team_manage"\)/.test(door) && /l\.user_id = \?3/.test(door));
}

/* ---- 6. a leave day is drawn and named ---- */
{
  ok("a day inside a span finds the people away", /const leaveOn = \(d: string\) => leave\.filter\(\(l\) => l\.start_date <= d && l\.end_date >= d\);/.test(events));
  ok("the cell shows the first name on the desk", /\{firstName\(leaveOn\(dISO\)\[0\]!\.name\)\}/.test(events));
  ok("and a mark on the phone", /leaveOn\(dISO\)\.length > 0 && \([\s\S]*?md:hidden[\s\S]*?rounded-full bg-primary/.test(events));
  ok("the legend names it", /\{L\("On leave \(approved\)", "Cuti \(diluluskan\)"\)\}/.test(events));
  ok("the day's agenda lists who is away", /leaveOn\(selected\)\.map\(\(l\) => \([\s\S]*?\{L\("on leave", "cuti"\)\}/.test(events));
  ok("the mark is not a category colour (it is not a kind of event)", !/leaveOn\(dISO\)[\s\S]{0,400}EVENT_COLORS/.test(events));
}

console.log(failed === 0
  ? `desk-tabs: ${passed} checks passed.`
  : `\n${failed} desk-tabs check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
