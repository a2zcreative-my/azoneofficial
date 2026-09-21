/**
 * v1.4.254 — the shared look, in one file.
 *
 * These strings were copy-pasted into sixteen files. `card` had drifted into
 * three different paddings — the portal's own page and its panels rendered
 * cards on the SAME tab at different sizes — and nobody would ever have
 * noticed until the whole set sat side by side. That is what a duplicated
 * constant does: it doesn't break, it drifts.
 *
 * Class strings, not components: every consumer is already a plain element
 * with its own props, so swapping a className cannot change behaviour.
 *
 * Row buttons live in components/ui/row-button.tsx (v1.4.253) — this file is
 * for surfaces and form fields.
 */

/** Every card in every app. One padding, everywhere.
    v1.10.0: phones get the reference design's rounder, calmer card
    (rounded-2xl); the desktop kept its v1.8.0 8px look (md:rounded-lg).
    v1.12.0: the desktop steps up to the shell's 16px card radius
    (`rounded-card`), so phone and desktop finally agree and cards sit
    correctly inside the 26px rounded canvas. Changing this ONE string
    restyles every card in the portal, admin and account — which is the
    whole reason it lives here. v1.164.0: the ERP workspace scopes this
    radius to 8px; legacy surfaces retain their existing defaults. */
export const card = "erp-card";

/* ============ v1.172.1 — PORTAL INTERFACE SYSTEM V3 =====================
   Every name in this file now resolves to a NAMED CLASS from
   styles/erp-v3.css (`card` → "erp-card", `inputClass` → "erp-input",
   `chipSuccess` → "erp-chip erp-chip-success"). The vocabulary is
   unchanged - three hundred call sites kept their imports - but the look
   is defined once, in CSS, in the semantic tokens, and a Tailwind utility
   appended by a caller (`${inputClass} sm:max-w-56`) still wins, so a
   screen can adjust a width without inventing a control. Tailwind is a
   compatibility layer from here on: new surfaces take a name from this
   file or a class from erp-v3.css, never a fresh utility string
   (tests/interface-v3.mjs). */

/* ============ v1.125.0 — THE CARD VOCABULARY ===========================
   The CEO, 06-09-2026: *"Some card-like inner rows use borders and rounded
   corners inside real cards … without names, every bordered rounded box
   competes visually with actual cards."*

   He is describing the failure mode exactly. `card` above said "one padding,
   everywhere", and it was true of everything that called it — but thirty
   other surfaces were spelling out `rounded-xl border border-border bg-card
   p-3` by hand, in five radii and four paddings, because none of them was a
   page card and there was no other name to use. Unnamed, they all read as
   cards that got it wrong. Named, most of them turn out to be right.

   So: a card is not one thing. It is five, and which one you want follows
   from where the box sits, not from how big you want it.

     card         a page card. Sits in the page grid, holds a heading and a
                  section of work. Widest padding, largest radius.
     compactCard  the same card, dense. For side rails, mini calendars and
                  small widgets, where `card`'s padding would leave a 264px
                  column mostly empty.
     insetCard    a bordered box INSIDE a card — a detail panel, a repeated
                  item row. Smaller radius on purpose: it must read as
                  contained by its parent, not as a card competing with it.
     accentCard   a card with a coloured top edge, for a figure that carries
                  a status.
     tileCard     a small square tile in a grid of them: one figure, one
                  label, centred.
     modalCard    the panel a dialog draws over the page.
     sheetCard    the phone's bottom sheet.
     toastCard    the centred confirmation card that fades.
     menuCard     v1.172.0 - a floating menu that pops beside the button that
                  owns it (the table's Columns menu). Tight padding, lifted by
                  a shadow, positioned by the caller.

   And one rule that is not about size. A card's own expandable detail belongs
   INSIDE that card, under a rule — never as a sibling card. v1.125.0 fixed
   the Inventory status strip, where opening "Low" added a second card to a
   two-card row and the row stopped lining up. If a detail deserves to be its
   own card, promote it to a full cell in the grid; if it does not, keep it in.

   tests/card-vocabulary.mjs holds the line: a hand-rolled `border-border
   bg-card rounded-* p-*` in app/ or components/ fails the build. */

/** The page card, at rail density. Same border, same radius, tighter inside. */
export const compactCard = "erp-card erp-card-compact";

/** A bordered box inside a card. Smaller radius: contained, not competing. */
export const insetCard = "erp-card-inset";

/** A card with a coloured top edge, for a figure that carries a status.
    The caller supplies the edge colour (`border-t-success`, `border-t-brand`);
    everything else is the card. */
export const accentCard = "erp-card erp-card-accent";

/** One figure, one label, centred — in a grid of siblings. */
export const tileCard = "erp-stat";

/** The panel a dialog draws. Callers add their own max-height/scrolling. */
export const modalCard = "erp-modal";

/** The phone's bottom sheet — pinned to the bottom edge, so only the top corners round. */
export const sheetCard = "erp-sheet";

/** The centred confirmation card that pops and fades. */
export const toastCard = "erp-toast";

/** v1.172.0 - a floating menu beside its button. The caller positions it. */
export const menuCard = "erp-menu";

/* v1.164.1 — PWA bottom chrome has one measurement now.

   The installed app and an ordinary browser tab do not agree on the bottom
   safe area. Hard-coded `pb-28` cleared most phones, but it was disconnected
   from the fixed nav's real height, so the content could feel slightly
   floated or tucked depending on the WebView. Keep the nav and the page
   clearance on the same formula: 4rem nav + its safe-area floor + one
   breathing unit for the last card. */
export const mobileAppBottomClearance =
  "pb-[calc(5rem+max(env(safe-area-inset-bottom,0px),6px))]";
export const mobileBottomNav =
  "border-border bg-card fixed inset-x-0 bottom-0 z-40 flex border-t pb-[max(env(safe-area-inset-bottom,0px),6px)] md:hidden";

/* v1.70.0 — ONE standard content width for the whole portal.
   (CEO: "make the width globally standardize instead of inconsistent")

   The portal shell carried `md:max-w-none`, so every screen was as wide as
   the window. On a laptop that looks fine; on a wide monitor a paragraph in
   one card runs to two hundred characters while the card beside it holds a
   table pinned to 760px, and nothing on the page shares a measure.

   1600px is chosen from the widest thing the portal actually draws — the
   seven-column roster grid and the payroll tables — plus room to breathe.
   Anything narrower would make those scroll on a screen with space to spare.

   Use this on the OUTER container of a screen, never on a card: cards are
   meant to fill their column, and capping them individually is how the
   inconsistency started. */
/* v1.74.0 (CEO: "I want it full fit to the website width... just make it
   fit only") — the cap is gone, the RULE is not.

   1600px was chosen for line length, and on a 1920 monitor it left a band of
   page background down both sides that reads as a window that failed to
   maximise. The portal is a dense work surface, not an article: the roster,
   the payroll table and the attendance list all want every pixel, and the
   person using it is looking at data, not reading prose.

   What this still is: ONE width for every screen, set in ONE place, applied
   to the OUTER container and never to a card. Change this line and every
   screen changes together — which was the whole point of it existing. */
export const PORTAL_WIDTH = "mx-auto w-full max-w-none";

/** Standard form field (v1.4.154 width standard applies to the wrapper). */
export const inputClass =
  /* v1.172.1 - the V3 control: 44px on every breakpoint (it sits beside 44px
     pills in the same row), 16px type on a phone so iOS does not zoom, one
     radius, one focus ring, min-w-0 (v1.171.0) so a date field never widens
     its column. Append a width utility to narrow it; never restate it. */
  "erp-input";

/** Public-site field — larger type and touch target for the marketing pages,
    where visitors arrive cold on a phone. Deliberately not the same. */
export const inputClassLg =
  "w-full rounded-lg border border-input bg-background px-4 py-2.5 text-base text-foreground outline-none focus:ring-2 focus:ring-ring sm:text-sm";

/** Standard primary button. */
export const btnClass =
  "erp-button erp-button-primary";

/** Full-width variant — sign-in and other single-action forms. */
export const btnClassBlock =
  "erp-button erp-button-primary erp-button-block";

/** A row of labelled fields.
 *
 * v1.4.259: two columns on a phone, a flowing row from `sm` up. A bare
 * `flex gap-2` looks fine on a laptop and quietly ruins the same form on a
 * 390px screen: three fields share ~110px each and every placeholder is
 * clipped mid-word — "e.g. J&T, Po:" — so the hint that tells you what to
 * type is the first thing lost, exactly when you need it most.
 *
 * This is the v1.4.154 width standard with a name. Give any field that needs
 * the full width on a phone `col-span-2 sm:col-span-1`. */
export const fieldRow = "erp-field-row";

/* Table cells. v1.4.198 alignment standard: text left, numbers right.
   v1.4.253: numeric columns never wrap. */
export const th = "erp-th";
export const td = "erp-td";
export const thR2 = "erp-th erp-th-num";
export const tdR2 = "erp-td erp-td-num";

/* ===================== v1.5.0 — global style consolidation =====================
   These strings existed as copy-pasted literals across the portal, admin and
   account pages (btnGhost alone was pasted into four files with two different
   paddings). One definition each, everywhere. */

/** Secondary (outline) button — was duplicated in 4 files. */
export const btnGhost =
  "erp-button erp-button-secondary";

/** v1.172.1 - the quiet command: borderless, muted until hovered, for the
    third action in a row that must not compete with the first two. */
export const btnQuiet = "erp-button erp-button-ghost";
export const btnSmQuiet = "erp-button erp-button-ghost erp-button-compact";
/** v1.172.1 - the positive outline under the brief's name. */
export const btnSuccess = "erp-button erp-button-success";
export const btnSmSuccess = "erp-button erp-button-success erp-button-compact";
export const btnSmDanger = "erp-button erp-button-danger erp-button-compact";
/** v1.172.1 - the quiet icon command: no border until hovered. */
export const iconBtnQuiet = "erp-icon-button erp-icon-button-ghost";

/** Compact header control (phones share one row).
    v1.10.0: phones get the reference design's soft rounded square (h-9,
    rounded-xl); desktop keeps its previous look. */
export const btnHdr =
  "erp-icon-button";

/** Header control that exists ONLY from `md` up (sound, push, theme, EN/BM).
 *
 * v1.15.0 — this token exists because `${btnHdr} hidden md:inline-flex` DOES
 * NOT WORK: btnHdr already carries a bare `inline-flex`, and when one element
 * holds two unprefixed display utilities the stylesheet's order decides — in
 * this Tailwind build `.inline-flex` is emitted AFTER `.hidden`, so the
 * button stayed visible on every phone. That is why the v1.10.0 "calm mobile
 * header" was never actually calm in production: all four set-once switches
 * kept rendering at 390px and squeezed the screen title to zero width. The
 * fix is the standard Tailwind pattern — `hidden` as the ONLY base display
 * class, the visible display arriving with the `md:` variant. */
export const btnHdrDesktop =
  "erp-icon-button hidden md:inline-flex";

/** Small buttons for table rows and dense cards. */
export const btnSm =
  "erp-button erp-button-secondary erp-button-compact";
export const btnSmPrimary =
  "erp-button erp-button-primary erp-button-compact";
export const btnSmWarning =
  "erp-button erp-button-warning erp-button-compact";
export const btnSmInverse =
  "erp-button erp-button-inverse erp-button-compact";
export const iconBtnInverse =
  "erp-icon-button erp-icon-button-inverse";

/** Quick actions — full-width touch targets on phones, compact row actions on desktop. */
export const btnQuick =
  "erp-button erp-button-secondary w-full md:w-auto";
export const btnQuickPrimary =
  "erp-button erp-button-primary w-full md:w-auto";
export const btnHero =
  "erp-button erp-button-secondary w-full md:w-auto";
export const btnHeroPrimary =
  "erp-button erp-button-accent w-full md:w-auto";

/** Field labels — the two spellings that existed are now named. */
export const fieldLabel = "erp-label";
export const fieldLabelSm = "erp-label";

/** Compact inputs (the ad-hoc `border-input bg-background px-2 py-1 …` family). */
export const inputClassSm =
  /* v1.172.1 - the dense control for a table cell or a toolbar: 36px, the
     same border, radius and ring as the full field. Width is the caller's. */
  "erp-input erp-input-sm";

/* v1.137.0 — THE SELECT, at last.
   `inputClass` has existed since v1.4.154 and every <select> in the app went
   without: twelve different class strings across six files, in four heights,
   three radii and two type sizes. A dropdown beside a text field looked like
   a different control on Users, Attendance and the trading desk.
   A select needs a fixed HEIGHT where an input can take padding — the arrow
   the browser draws makes py-based sizing land a pixel off — hence h-9/h-7
   rather than py-2/py-1. Everything else matches the input it stands next
   to, deliberately. */
export const selectClass =
  /* v1.172.1 - the V3 select: the input plus its own chevron. */
  "erp-input erp-select sm:w-auto";
/** v1.172.1 - the V3 textarea; append `rows` on the element, not a height. */
export const textareaClass = "erp-input erp-textarea";
/** v1.172.1 - the V3 dense select, for toolbars and table cells. */
export const selectClassSm = "erp-input erp-input-sm erp-select";

/** Card-header row: title left, actions right, wraps politely on phones. */
export const rowHead = "erp-card-head";

/** Bordered list row (the 5× duplicated `border-b py-2 last:border-0` row). */
export const listRow = "erp-row";

/** Status chips — semantic tokens instead of the six hand-mixed palettes. */
export const chip = "erp-chip";
export const chipNeutral = `${chip} erp-chip-neutral`;
export const chipSuccess = `${chip} erp-chip-success`;
export const chipWarn = `${chip} erp-chip-warning`;
export const chipDanger = `${chip} erp-chip-danger`;
export const chipInfo = `${chip} erp-chip-info`;
/** v1.172.1 - the gold chip, for the house's own accent (an event, a live). */
export const chipGold = `${chip} erp-chip-gold`;

/** Interactive chips keep a full touch target without enlarging display-only badges. */
export const chipAction = "erp-chip-action";

/* v1.137.0 — the DENSE chip, for a chip that sits in a list row rather than
   in a card. Users had eight of these hand-rolled at `px-1.5 py-px
   text-[10px]`, which is why the same "part time" chip read smaller on Users
   than on Attendance. One size for rows, one for cards, and no third size
   invented per panel. */
export const chipSm = "erp-chip erp-chip-sm";
export const chipSmNeutral = `${chipSm} erp-chip-neutral`;
export const chipSmSuccess = `${chipSm} erp-chip-success`;
export const chipSmWarn = `${chipSm} erp-chip-warning`;
export const chipSmDanger = `${chipSm} erp-chip-danger`;
export const chipSmInfo = `${chipSm} erp-chip-info`;

/* v1.137.0 — THE LIST BOX. A bordered, hairline-divided, scrollable list
   INSIDE a card: the staff list, the customer list, an events log. It is not
   an insetCard — it has no padding and no fill of its own, because its rows
   bring their own — and spelling it out by hand is how one list ended up
   `max-h-80` while the one beside it was `max-h-96`. The caller sets the
   height; everything else is here. */
export const listBox = "erp-listbox";

/* v1.137.0 — THE ROW ACTION. A square, labelled tap target for the ✎ / ✕ that
   sit at the end of a list row.

   Users had its edit affordance as a bare `✎` inside `text-[11px] underline`:
   about 12×14 px of touch target, unlabelled for a screen reader, and sitting
   directly beside three chips. On a phone that is a mis-tap waiting to
   happen — which is why the height is 44px until `sm`, the platform minimum,
   and only then relaxes to the desk's 28px. Always give it an aria-label:
   a glyph is not a name. */
export const iconBtn =
  "erp-icon-button text-muted-foreground hover:text-foreground";

/** Dashboard tile styling. */
export const tile = card;

/* v1.123.0 — THE TAB PILL, globally. The CEO, 06-09-2026: *"like tabs inside
   Attendance ... also use globally css / style that created before"*. The
   style is the one v1.80.0 introduced on the attendance card and v1.4.x used
   on MoneyCard; it lived twice, hand-rolled. It lives here now, and
   components/portal/page-shared.tsx SectionTabs is the one component that
   draws it. A card with more than one thing to show uses that, so a pill
   means the same thing on every tab of the portal. */
export const tabPill =
  "erp-button erp-button-secondary erp-button-compact text-muted-foreground";
export const tabPillOn =
  "erp-button erp-button-primary erp-button-compact";
