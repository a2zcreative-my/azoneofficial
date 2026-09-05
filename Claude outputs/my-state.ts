/**
 * WHICH STATE IS THIS ADDRESS IN — v1.113.0.
 *
 * The CEO, 05-09-2026: *"on Sales tabs should add Sales mapped like ecommerce
 * or hotel type for me to monitor on the sales state location and revenue by
 * states."* Neither an invoice nor a web order carries a state: a customer
 * has one free-text address line, and the ELFIA checkout has one free-text
 * address box. So the state is READ out of the text, here, one way, for both.
 *
 * Two readings:
 *
 *   1. THE STATE NAME, as people write it - "Selangor", "Pulau Pinang" or
 *      "Penang", "N. Sembilan", "W.P. Kuala Lumpur", "KL". The LAST name in
 *      the text is taken, because a Malaysian address ends with its state.
 *   2. THE POSTCODE. Malaysian postcodes are five digits and their first two
 *      map to a state without exception, with a handful of outliers (Genting
 *      Highlands is Pahang on a Selangor-looking number).
 *
 * When both are present and disagree, the LATER one in the text is believed:
 * an address reads "..., 50480 Kuala Lumpur" - postcode, then state - so a
 * state name that comes before the postcode is a street or a town ("Jalan
 * Kelantan, 50480 Kuala Lumpur" is in Kuala Lumpur).
 *
 * Neither reading found: null, and the caller keeps the money in an
 * "unplaced" bucket rather than losing it - a map that silently drops 30% of
 * revenue is worse than no map.
 *
 * The vocabulary is the geometry's (lib/malaysia-map.ts), upper case, which is
 * also the hotel workbook's - one country, one list of names. Labuan is here
 * because the geometry draws it; the hotel picker leaves it out by choice.
 */

export const MY_STATE_NAMES = [
  "KUALA LUMPUR", "SELANGOR", "PUTRAJAYA", "NEGERI SEMBILAN", "JOHOR", "MELAKA", "KEDAH", "PERAK",
  "PERLIS", "TERENGGANU", "PULAU PINANG", "PAHANG", "KELANTAN", "SABAH", "SARAWAK", "LABUAN",
] as const;
export type MyStateName = (typeof MY_STATE_NAMES)[number];

/* how people write each state; matched whole-word, case-insensitively; dots optional */
const ALIASES: [RegExp, MyStateName][] = [
  [/\b(?:w\.?\s*p\.?\s*)?kuala\s+lumpur\b|\bk\.?\s*l\b\.?(?!\w)/i, "KUALA LUMPUR"],
  [/\bselangor\b/i, "SELANGOR"],
  [/\b(?:w\.?\s*p\.?\s*)?putrajaya\b/i, "PUTRAJAYA"],
  [/\b(?:negeri|n\.?)\s*sembilan\b|\bn9\b/i, "NEGERI SEMBILAN"],
  [/\bjohor(?:e)?\b/i, "JOHOR"],
  [/\bmelaka\b|\bmalacca\b/i, "MELAKA"],
  [/\bkedah\b/i, "KEDAH"],
  [/\bperak\b/i, "PERAK"],
  [/\bperlis\b/i, "PERLIS"],
  [/\bt(?:e)?rengganu\b/i, "TERENGGANU"],
  [/\b(?:pulau|p\.?)\s*pinang\b|\bpenang\b/i, "PULAU PINANG"],
  [/\bpahang\b/i, "PAHANG"],
  [/\bkelantan\b/i, "KELANTAN"],
  [/\bsabah\b/i, "SABAH"],
  [/\bsarawak\b/i, "SARAWAK"],
  [/\b(?:w\.?\s*p\.?\s*)?labuan\b/i, "LABUAN"],
];

/** Malaysian postcode -> state. The first two digits decide, with the
    outliers Pos Malaysia allocates across the Selangor / Pahang line. */
export function stateFromPostcode(postcode: string | number): MyStateName | null {
  const s = String(postcode).trim();
  if (!/^\d{5}$/.test(s)) return null;
  const n = Number(s);
  const p2 = Math.floor(n / 1000);
  if (n === 39000 || n === 39007 || n === 39009 || n === 49000 || n === 69000) return "PAHANG"; // Cameron Highlands, Genting Highlands
  if (p2 >= 1 && p2 <= 2) return "PERLIS";
  if (p2 >= 5 && p2 <= 9) return "KEDAH";
  if (p2 >= 10 && p2 <= 14) return "PULAU PINANG";
  if (p2 >= 15 && p2 <= 18) return "KELANTAN";
  if (p2 >= 20 && p2 <= 24) return "TERENGGANU";
  if (p2 >= 25 && p2 <= 28) return "PAHANG";
  if (p2 >= 30 && p2 <= 36) return "PERAK";
  if ((p2 >= 40 && p2 <= 48) || p2 === 63 || p2 === 64 || p2 === 68) return "SELANGOR";
  if (p2 >= 50 && p2 <= 60) return "KUALA LUMPUR";
  if (p2 === 62) return "PUTRAJAYA";
  if (p2 >= 70 && p2 <= 73) return "NEGERI SEMBILAN";
  if (p2 >= 75 && p2 <= 78) return "MELAKA";
  if (p2 >= 79 && p2 <= 86) return "JOHOR";
  if (p2 === 87) return "LABUAN";
  if (p2 >= 88 && p2 <= 91) return "SABAH";
  if (p2 >= 93 && p2 <= 98) return "SARAWAK";
  return null;
}

/** The state an address is in, or null when the text does not say. */
export function stateFromAddress(text: string | null | undefined): MyStateName | null {
  if (!text) return null;
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return null;
  /* 1. the last state name written */
  let best: { at: number; state: MyStateName } | null = null;
  for (const [re, state] of ALIASES) {
    const g = new RegExp(re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = g.exec(s)) !== null) {
      if (!best || m.index > best.at) best = { at: m.index, state };
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  /* 2. the last five-digit number that is a postcode */
  let code: { at: number; state: MyStateName } | null = null;
  for (const m of s.matchAll(/(?<!\d)(\d{5})(?!\d)/g)) {
    const st = stateFromPostcode(m[1]!);
    if (st) code = { at: m.index ?? 0, state: st };
  }
  if (best && code) return code.at > best.at ? code.state : best.state;
  if (best) return best.state;
  if (code) return code.state;
  return null;
}
