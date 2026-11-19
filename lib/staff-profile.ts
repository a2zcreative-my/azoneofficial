/* v1.388.0 - THE STAFF PROFILE'S DATA, ONE SHAPE FOR EVERY SCREEN (the CEO,
   19-11-2026: "Position and Responsibilities must be stored once and reused
   throughout A2Z OS, including future staff portfolio cards").

   The server owns it (worker/src/responsibilities.ts, migration 0215): the
   position is the staff record's, each responsibility is its own record with
   Key / Public flags, templates are kept per position. This file is the
   client's copy of the SHAPES and the one display rule (which responsibilities
   a compact card shows), so Departments & Roles, Staff Records, the Profile
   and a portfolio card can never disagree. Nothing here decides who may do
   anything - the server refuses what a screen hides. */

export const RESP_LIMITS = { title: 120, text: 200, items: 30, key: 5 } as const;

/** one responsibility, as GET /staff/users (responsibility_items) and
    GET /staff/users/:id/responsibilities send it */
export type RespItem = {
  id?: number;
  text: string;
  is_key: number | boolean;
  is_public: number | boolean;
  template_position_id?: number | null;
};

/** the portfolio card's one shape - GET /staff/portfolio/:id */
export type StaffPortfolio = {
  user_id: number;
  photo_key: string | null;
  name: string;
  full_name: string | null;
  /** the main professional title: the position, else the role title */
  title: string | null;
  position: string | null;
  role_title: string | null;
  department: string | null;
  staff_id: string | null;
  /** up to five, for the compact card */
  key: string[];
  /** the whole list, for the expanded portfolio */
  responsibilities: string[];
  /** the ones ticked Public */
  public: string[];
  is_active: boolean;
};

/** The compact card's list - the server's own rule (portfolioOf): the ones
    marked Key, else the first five. */
export function keyResponsibilities(items: readonly RespItem[]): string[] {
  const marked = items.filter((i) => Boolean(i.is_key));
  return (marked.length ? marked : items).slice(0, RESP_LIMITS.key).map((i) => i.text);
}

/** Clean one line the way the server does: one space, no leading bullet. */
export function cleanResponsibility(text: string): string {
  return text.replace(/\s+/g, " ").replace(/^\s*[-•*]\s*/, "").trim();
}
