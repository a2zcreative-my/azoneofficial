/* ONE LINE ARITHMETIC — v1.231.0.
 *
 * A document's subtotal is each line's qty x unit price less its own
 * discount (never more than the line), summed - the same terms as the
 * worker's POST /docs (staff.ts) and packages.ts linesSubtotal. The Create
 * form, the paper preview and the package editor all call this one, so a
 * package's total, a quotation's subtotal and the printed figure cannot
 * disagree. The document discount, tax and delivery stay where they are -
 * on the document. tests/sales-packages.mjs runs it against the worker's. */
import type { DocItem } from "@/lib/doc-template";

export const lineAmount = (i: Pick<DocItem, "qty" | "unit_price_cents" | "disc_cents">): number =>
  i.qty * i.unit_price_cents - Math.min(i.disc_cents ?? 0, i.qty * i.unit_price_cents);

export const docSubtotal = (items: readonly Pick<DocItem, "qty" | "unit_price_cents" | "disc_cents">[]): number =>
  items.reduce((s, i) => s + lineAmount(i), 0);
