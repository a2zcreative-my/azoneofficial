/* v1.237.0 - WHAT THE SIGNED-IN PERSON MAY DO, AS THE SERVER DECIDES IT.

   The owner, 31-10-2026: the Roles & Permissions matrix is editable by the
   company owner and the super admin (claude/EDITABLE-PERMISSIONS-AUDIT.md).
   The worker applies those edits inside can() and sends the person's
   resulting capabilities with /auth/me (`caps`). A screen that offers an
   action on the matrix asks `holds(cap, fallback)`: the server's answer once
   it is known, the role rule written at the call site until then. Drawing
   only - every route still checks every request. */
let CAPS: Set<string> | null = null;

export function setCaps(list: readonly string[] | null | undefined): void {
  CAPS = Array.isArray(list) ? new Set(list) : null;
}

/** Does the signed-in person hold `cap`? `fallback` is used until /auth/me has answered. */
export function holds(cap: string, fallback: boolean): boolean {
  return CAPS ? CAPS.has(cap) : fallback;
}
