/**
 * AN EVENT KNOWS WHO IT IS FOR — guard #65, v1.144.0.
 *
 * The CEO, 09-09-2026, on a Brand2Market class for four people: *"I want some
 * selected staff which is require to join the event only being notified."*
 * Every event used to ring every bell, so a class for four interrupted eleven,
 * and the four who had to be there could not tell their event from the other
 * nine.
 *
 * THE PROPERTIES, not the implementation:
 *   1. NO LIST STILL MEANS EVERYONE. Every event that existed before 0122 has
 *      no list and was announced to the whole floor. If an empty list ever
 *      came to mean "nobody", this release would silently un-announce the
 *      past - so the route must ring everyone when the list is empty, and
 *      only the list when it is not.
 *   2. ONLY REAL, CURRENT STAFF GO ON IT. An id typed by hand, or one left
 *      behind by somebody who has since left, would otherwise sit in the
 *      table for ever and be counted on every card.
 *   3. AN EDIT TELLS THE NEWLY ADDED, AND ONLY THEM. Somebody already going
 *      does not need a second bell because a fifth person joined, and
 *      somebody taken off must not be told to come.
 *   4. THE LIST DIES WITH THE EVENT. There are no foreign keys here by policy,
 *      so nothing else would ever remove those rows, and an id reused by a
 *      later event would inherit strangers.
 *   5. EVERYONE STILL SEES THE EVENT. The CEO's own call: the calendar is how
 *      the floor plans around a class. The read is not filtered by the list,
 *      and the card names who is going.
 *   6. THE PICKER CANNOT BE EMPTY FOR SOMEBODY ALLOWED TO USE IT. The staff
 *      options ride on the events response, because GET /users is gated on
 *      hr_manage / exec_view and an events manager may be neither.
 *
 *   7. THE MIGRATION IS REGISTERED THE HOUSE WAY - named by LATEST_MIGRATION,
 *      listed in EXPECTED_MIGRATIONS, and probeable from /system/health, so a
 *      pending migration can be named rather than guessed at.
 *
 * Negative-tested by: making an empty list notify nobody (1); dropping the
 * active-staff filter (2); notifying the whole list on an edit (3); leaving
 * the rows behind on delete (4); and sending the picker to /staff/users (6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/* v1.139.1 - fileURLToPath, NOT .pathname (Windows: "C:\\C:\\Users\\..."). */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const panel = read("components/portal/events.tsx");
const migration = read("worker/migrations/0122_event_attendees.sql");

/* the POST /events handler, on its own, so a rule proved here is proved about
   the route that creates an event and not about some neighbour of it */
const postEvents = (() => {
  const i = staff.indexOf('if (path === "/events" && method === "POST")');
  const j = staff.indexOf('const evMatch = path.match(/^\\/events\\/(\\d+)$/)', i);
  return i >= 0 && j > i ? staff.slice(i, j) : "";
})();
const patchEvents = (() => {
  const i = staff.indexOf('if (evMatch && method === "PATCH")');
  const j = staff.indexOf('if (evMatch && method === "DELETE")', i);
  return i >= 0 && j > i ? staff.slice(i, j) : "";
})();
const deleteEvents = (() => {
  const i = staff.indexOf('if (evMatch && method === "DELETE")');
  return i >= 0 ? staff.slice(i, i + 1200) : "";
})();

ok("the three event routes were found", postEvents.length > 0 && patchEvents.length > 0 && deleteEvents.length > 0,
   "the checks below would pass on nothing");

/* ---- 1. no list still means everyone ---- */
{
  ok("creating an event reads an attendee list", /readAttendees\(body\.attendees\)/.test(postEvents));
  ok("an empty list rings the whole floor, a list rings the list",
     /invited\.length > 0\s*\?\s*invited[\s\S]{0,120}?:\s*everyone/.test(postEvents),
     "an empty list meaning nobody would silently un-announce every event that pre-dates 0122");
  ok("the whole floor is still selected as active current staff",
     /SELECT id FROM users WHERE \$\{staffRolesSql\(\)\} AND is_active = 1 AND \$\{currentStaffSql\(\)\}/.test(postEvents));
  ok("the migration says an empty list means everyone", /STILL NOTIFIES EVERYONE/i.test(migration),
     "the rule has to be written where the table is, or the next reader will invert it");
}

/* ---- 2. only real, current staff go on the list ---- */
{
  ok("the ids are filtered through the staff table before they are stored",
     /keepRealStaff/.test(postEvents) && /keepRealStaff/.test(patchEvents));
  ok("that filter asks for active, current staff only",
     /const keepRealStaff[\s\S]{0,600}?staffRolesSql\(\)\} AND is_active = 1 AND \$\{currentStaffSql\(\)\}/.test(staff),
     "an id left behind by a leaver would be counted on the card for ever");
  ok("duplicate ids cannot be stored", /PRIMARY KEY \(event_id, user_id\)/.test(migration));
  ok("and cannot even reach the table twice", /new Set\(ids\)/.test(staff));
}

/* ---- 3. an edit tells the newly added, and only them ---- */
{
  ok("an edit reads the list that was there before it", /SELECT user_id FROM event_attendees WHERE event_id = \?1/.test(patchEvents));
  ok("and rings only the people who were not on it",
     /invited\.filter\(\(x\) => !had\.has\(x\)/.test(patchEvents),
     "a fifth person joining must not re-ring the other four");
  ok("the person doing the editing is never rung by their own edit",
     /!had\.has\(x\) && x !== user\.id/.test(patchEvents));
  ok("changing ONLY the list is a valid edit",
     /sets\.length === 0 && asked === null/.test(patchEvents),
     "picking the wrong four people must not need a pointless title edit to fix");
}

/* ---- 4. the list dies with the event ---- */
{
  ok("deleting an event deletes its attendee rows",
     /DELETE FROM event_attendees WHERE event_id = \?1/.test(deleteEvents),
     "no foreign keys here by policy, so nothing else ever would");
}

/* ---- 5. everyone still sees the event ---- */
{
  const get = (() => {
    const i = staff.indexOf('if (path === "/events" && method === "GET")');
    const j = staff.indexOf('if (path === "/events" && method === "POST")', i);
    return i >= 0 && j > i ? staff.slice(i, j) : "";
  })();
  ok("the events read is not filtered by who is on the list",
     get.length > 0 && !/event_attendees[\s\S]{0,200}?WHERE[\s\S]{0,80}?user\.id/.test(get),
     "a class nobody else can see is a class nobody else can plan around");
  ok("the read carries the attendees with each event", /attendees: byEvent\.get\(e\.id\) \?\? \[\]/.test(get));
  ok("a database without 0122 still answers", /catch \{/.test(get),
     "the events card must not go blank between the code deploying and the migration running");
  ok("the card names who is required", /Required:/.test(panel) && /ev\.attendees\.map/.test(panel));
  ok("the calendar day says it too", (panel.match(/Required:/g) ?? []).length >= 2);
}

/* ---- 6. the picker is never empty for somebody allowed to use it ---- */
{
  ok("the staff options ride on the events response",
     /can\(user\.role, "events_manage"\)[\s\S]{0,600}?FROM users u[\s\S]{0,300}?ORDER BY \$\{STAFF_ORDER_SQL\}/.test(staff),
     "GET /users is gated on hr_manage / exec_view - an events manager may be neither");
  ok("the picker lists people in the company order, not alphabetically",
     (staff.match(/ORDER BY \$\{STAFF_ORDER_SQL\}/g) ?? []).length >= 2,
     "alphabetical puts the CEO in the middle of the alphabet on the screen that chooses who attends");
  ok("the panel reads them from there, not from the directory",
     /staff\?: \{ id: number; name: string \}\[\]/.test(panel) && !/\/staff\/users/.test(panel));
  ok("nobody picked is stated on the form, not left to be guessed",
     /Nobody picked/.test(panel));
  ok("the button says how many will be told",
     /notifies all staff/.test(panel) && /notifies \$\{draft\.attendees\.length\} staff/.test(panel));
}

/* ---- 7. the migration is registered the house way (the triple bump) ---- */
{
  /* v1.147.0 - this used to read `LATEST_MIGRATION = "0122_event_attendees"`,
     which is the one line in the triple bump that MOVES: the next migration
     takes it, by design. 0123 landing made this guard fail on correct code
     and say nothing true about 0122. What has to hold is that 0122 is
     REGISTERED - listed and probeable - and that LATEST_MIGRATION names a
     migration no older than it, which is what proves the bump was done when
     0122 landed and never quietly rewound. */
  const latest = index.match(/const LATEST_MIGRATION = "(\d{4})_/);
  ok("LATEST_MIGRATION is set and is 0122 or newer",
     !!latest && Number(latest[1]) >= 122,
     latest ? `LATEST_MIGRATION is ${latest[1]}` : "LATEST_MIGRATION not found");
  ok("EXPECTED_MIGRATIONS lists it", /"0122_event_attendees",/.test(index));
  ok("a health probe can name it", /event_attendees LIMIT 1/.test(index));
}

console.log(failed === 0
  ? `event-attendees: ${passed} checks passed.`
  : `\n${failed} event-attendees check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
