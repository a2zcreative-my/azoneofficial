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

/* v1.4.261: the display rule as ONE function — legal name when on file,
   short name otherwise. Worker routes that return only `name` already apply
   the same rule in SQL; this is for payloads that carry both fields. */
export function displayName(u: { name: string; full_name?: string | null }): string {
  return properName(u.full_name?.trim() || u.name);
}
