/** v1.4.101: display names in Proper Case instead of ALL CAPS across tabs.
    Malay patronymics (bin, binti, a/l, a/p) stay lowercase; printed formal
    documents (payslip, claim form, badge, signer block) keep their own
    uppercase styling deliberately. */
const LOWER = new Set(["bin", "binti", "binte", "a/l", "a/p", "al", "ap"]);

export function properName(v?: string | null): string {
  if (!v) return "";
  return v
    .trim()
    .split(/\s+/)
    .map((w) => {
      const lw = w.toLowerCase();
      if (LOWER.has(lw)) return lw;
      // keep initials like "A." and hyphenated parts tidy
      return lw
        .split("-")
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join("-");
    })
    .join(" ");
}

export function firstName(v?: string | null): string {
  const p = properName(v);
  return p.split(" ")[0] ?? "";
}

/**
 * v1.92.0 — the GIVEN name, whole. CEO, 04-09-2026, on the Assignments card
 * printing "NUR" three times: *"I should be able to see their first and
 * middle name so that I can know."*
 *
 * Malay names carry the given name before a connector — "Nur Nasuha binti
 * Zainal Abidin" is Nur Nasuha, and "Nur" alone is half the floor. So:
 * every word up to bin / binti / a/l / a/p and the like; without a
 * connector, the first two words. Never the patronymic, which is what the
 * first-word rule was accidentally avoiding by printing too little.
 */
const CONNECTORS = new Set(["bin", "binti", "bt", "bt.", "b.", "a/l", "a/p", "al", "ap", "anak", "s/o", "d/o"]);
export function givenNames(v?: string | null): string {
  const words = properName(v).split(" ").filter(Boolean);
  const cut = words.findIndex((w) => CONNECTORS.has(w.toLowerCase()));
  const given = cut > 0 ? words.slice(0, cut) : words.slice(0, 2);
  return given.join(" ");
}

/* v1.4.261: the display rule as ONE function — legal name when on file,
   short name otherwise. Worker routes that return only `name` already apply
   the same rule in SQL; this is for payloads that carry both fields. */
export function displayName(u: { name: string; full_name?: string | null }): string {
  return properName(u.full_name?.trim() || u.name);
}
