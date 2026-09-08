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
  /* v1.139.0 - the family, fabric and SHAPE words a listing repeats. A shape
     word left distinctive ("bidang") let "Bawal Bidang 45 Black" match a line
     that said Bidang 50, because 45 was under three characters and dropped. */
  "selendang", "sarung", "instant", "square", "bidang", "size", "saiz",
  "inch", "inci", "warna", "colour", "color", "exclusive", "collection", "series",
]);

/** Lower-cased ASCII words, punctuation gone, accents folded.
 *
 * v1.139.0 - a display face fuses words ("lumiMahogany"), and the old answer
 * to that was to search the whole line with its spaces removed for any
 * three-letter word. That is how "SHAWL CHIFFON Tangerine" deducted a
 * "Shawl Tan" and "BAWAL Cashmere" deducted a "Bawal ASH": a substring is
 * not a word. The fusion is undone HERE instead, by splitting a lower-upper
 * boundary before the text is folded, so "lumiMahogany" becomes two real
 * words and nothing else changes. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter(Boolean);
}

/** The words of an item name that tell it from its siblings.
 *
 * A run of digits is ALWAYS distinctive however short: 45 and 50 are the
 * whole difference between two bidangs, and the old three-character floor
 * dropped both. */
export function distinctive(name: string): string[] {
  return words(name).filter((w) => !GENERIC_WORDS.has(w) && (w.length >= 3 || /^\d+$/.test(w)));
}

/** The store's SKU rule (bridge-core.ts, PORTAL-BRIDGE-SPEC.md): case- and
    whitespace-insensitive. 'LUMI 001' is 'lumi001' is 'LUMI001'. Restated
    here so this file stays import-free. */
export function skuKey(sku: string): string {
  return sku.toUpperCase().replace(/\s+/g, "");
}

/** v1.136.0 - `category` is the item's family (Bawal, Shawl). It is not part
    of the match: it only breaks a tie, because a shop that names its items by
    shade alone ("LILAC" as both a bawal and a shawl) has nothing else to tell
    them apart, and the line itself says which family it is. */
export interface Candidate { id: number; name: string; category?: string | null }

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
  const has = (w: string) => tw.has(w);
  /* v1.139.0 - THE RULE READS BOTH WAYS NOW, AGAINST THE SHOP\'S OWN WORDS.
     It only ever required every distinctive word of the ITEM to be in the
     line, which let an item match a line that named something MORE: "Bawal
     lumi Olive" answered a line for Dusty Olive, and "ROSE" answered one for
     Rose Gold - a different real product each time, deducted in silence.
     So a word the LINE says must be in the item too. But only a word the
     shop itself uses: a listing is full of words that are not product names
     ("CLOSET SALE", "READY STOCK"), and requiring those would refuse every
     honest order. The catalogue is the dictionary - if "dusty" names some
     item somewhere, a line that says dusty means it, and an item without it
     is a different product; if no item anywhere says "closet", the word is
     the seller talking. That is exactly the line between the two mistakes.
     Everything refused lands on the card as "not in inventory", which is a
     sentence somebody reads - the opposite of a silent wrong deduction. */
  const vocab = new Set<string>();
  for (const it of items) for (const w of distinctive(it.name)) vocab.add(w);
  const lineD = words(text).filter(
    (w) => !GENERIC_WORDS.has(w) && (w.length >= 3 || /^\d+$/.test(w)) && vocab.has(w),
  );
  const scored: { item: T; score: number }[] = [];
  for (const it of items) {
    const d = distinctive(it.name);
    if (d.length === 0 || !d.every(has)) continue;
    const all = words(it.name);
    const own = new Set(all);
    if (!lineD.every((w) => own.has(w))) continue;
    const covered = all.filter(has).length;
    /* Whole name present beats a name with a generic word the line never
       said: for "BAWAL COTTON VOILE Sky", "Bawal Sky" over "Bawal lumi Sky". */
    scored.push({ item: it, score: (covered === all.length ? 1000 : 0) + covered });
  }
  if (scored.length === 0) return { kind: "none" };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  const tied = scored.filter((s) => s.score === best.score);
  if (tied.length > 1) {
    /* v1.136.0 - the family breaks the tie. "BAWAL LUMI COTTON VOILE Lilac"
       against two items both called Lilac: the one filed under Bawal. Only
       when EXACTLY one of the tied items has its family named in the line -
       none, or both, is still a question for a human. */
    const byCat = tied.filter((s) => {
      const c = (s.item.category ?? "").trim();
      /* v1.139.0 - a category word is matched as a WORD, never as a
         substring: a family called "Set" once matched inside "CLOSET SALE".
         Generic words are NOT filtered here - Bawal and Shawl are family
         words, and being named in the line is the whole point. A family that
         every listing names (Lumi) simply leaves both sides tied, which is
         still a question for a human. */
      const cw = words(c).filter((w) => w.length >= 3);
      return cw.length > 0 && cw.every((w) => tw.has(w));
    });
    if (byCat.length === 1) return { kind: "one", item: byCat[0]!.item };
    return { kind: "ambiguous", names: tied.map((s) => s.item.name) };
  }
  return { kind: "one", item: best.item };
}
