/**
 * WHICH INVENTORY ITEM A SALES LINE MEANS — v1.135.0.
 *
 * The CEO, 07-09-2026, on two shipped TikTok orders sitting on "No stock
 * movement recorded · not in inventory (SKU or name): 1x BAWAL LUMI COTTON
 * VOILE Lilac": *"LUMI was not deducted from the inventory which is it is
 * not correct. it is supposed to deduct automatically!!!"*
 *
 * The listing on TikTok is "BAWAL LUMI COTTON VOILE", variant "Lilac". The
 * item in inventory is "Bawal lumi Lilac". Since v1.4.162 the name fallback
 * asked whether the inventory name appeared INSIDE the TikTok name, as one
 * contiguous string - and "bawal lumi lilac" does not appear inside "bawal
 * lumi cotton voile lilac", because the fabric sits between the brand and
 * the shade. So the line matched nothing, and the stock stood still.
 *
 * The rule the store and the ELFIA panel already use for catalogue labels
 * (v1.57.0) is the right one here too: an item matches a line when EVERY
 * DISTINCTIVE WORD of the item's name appears in the line's words, in any
 * order, with anything else in between. "Bawal lumi Lilac" has one
 * distinctive word - lilac - and the line has it.
 *
 * Two safeguards, because a rule that can move the wrong stock is worse
 * than one that moves none:
 *   - when more than one item qualifies, the one whose whole name (generic
 *     words included) is best covered by the line wins - "Bawal lumi Lilac"
 *     over "Shawl chiffon Lilac" for a line that says bawal and lumi - and a
 *     TIE is refused as AMBIGUOUS, naming both, so a human decides;
 *   - a word shorter than three characters is never distinctive on its own.
 *
 * Zero imports, pure functions: tests/tiktok-line-match.mjs bundles this
 * file and runs the rule on the CEO's own two orders.
 */

/** Words that name a family or a fabric, not a product. Shared with the
    store's catalogue matcher and the ELFIA panel's preview of it. */
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  "bawal", "shawl", "chiffon", "lumi", "premium", "by", "elfia",
  "cotton", "voile", "satin", "silk", "tudung", "hijab", "scarf", "plain", "printed",
]);

/** Lower-cased ASCII words, punctuation gone, accents folded. */
export function words(s: string): string[] {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** The words of an item name that tell it from its siblings. */
export function distinctive(name: string): string[] {
  return words(name).filter((w) => !GENERIC_WORDS.has(w) && w.length >= 3);
}

/** The store's SKU rule (bridge-core.ts, PORTAL-BRIDGE-SPEC.md): case- and
    whitespace-insensitive. 'LUMI 001' is 'lumi001' is 'LUMI001'. Restated
    here so this file stays import-free. */
export function skuKey(sku: string): string {
  return sku.toUpperCase().replace(/\s+/g, "");
}

export interface Candidate { id: number; name: string }

export type WordMatch<T extends Candidate> =
  | { kind: "one"; item: T }
  | { kind: "ambiguous"; names: string[] }
  | { kind: "none" };

/**
 * THE RULE. Among `items`, the one whose distinctive words all appear in
 * `text` (the TikTok product name and variant, joined). Ranked by how much
 * of the WHOLE name the text covers; a unique best wins, a tie is
 * ambiguous. Display faces fuse words ("lumiMahogany"), so a word may also
 * be found inside the text with its spaces removed.
 */
export function matchByWords<T extends Candidate>(text: string, items: T[]): WordMatch<T> {
  const tw = new Set(words(text));
  const squashed = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const has = (w: string) => tw.has(w) || (w.length >= 3 && squashed.includes(w));
  const scored: { item: T; score: number }[] = [];
  for (const it of items) {
    const d = distinctive(it.name);
    if (d.length === 0 || !d.every(has)) continue;
    const all = words(it.name);
    const covered = all.filter(has).length;
    /* Whole name present beats a name with a generic word the line never
       said: for "BAWAL COTTON VOILE Sky", "Bawal Sky" over "Bawal lumi Sky". */
    scored.push({ item: it, score: (covered === all.length ? 1000 : 0) + covered });
  }
  if (scored.length === 0) return { kind: "none" };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const tied = scored.filter((s) => s.score === best.score);
  if (tied.length > 1) return { kind: "ambiguous", names: tied.map((s) => s.item.name) };
  return { kind: "one", item: best.item };
}
