/**
 * v1.30.0 — the group's brands, in ONE place.
 *
 * CEO: "how to make sure that AZONE official and ELFIA is not in my A2Z
 * system? I just want that customer or client can have a option to click on
 * their logo then will redirecting to their own domain."
 *
 * The answer has two halves, and this file is the first: every outbound
 * brand link on the public site is generated from this list. Nothing
 * hardcodes a sister company's or a client's domain in a component, so a
 * domain change is one edit here (and one line in public/_redirects) rather
 * than a hunt through the codebase. tests/brands-guard.mjs enforces that.
 *
 * The second half is the honesty rule this file encodes in its types:
 *
 *   kind: "company"  — a business you OWN. A2Z and AZ ONE OFFICIAL are
 *                      separate legal entities under one roof; both may be
 *                      shown together as "Our companies".
 *   kind: "client"   — a business you WORK FOR. ELFIA is a client of A2Z,
 *                      not a division of it. Client marks are published only
 *                      with written permission on file (standing rule since
 *                      v1.27.0, when the ELFIA strip was removed from the
 *                      hero), and they never appear in the companies row —
 *                      a shared logo row silently claims ownership.
 *
 * A client with permissionOnFile: false renders NOWHERE on the public site.
 * Flip it to true only when the signed permission actually exists.
 */

export type BrandKind = "company" | "client";

export interface Brand {
  /** Stable short code. Also the /go/<code> short link. Never reuse one. */
  code: string;
  name: string;
  kind: BrandKind;
  /** Canonical domain, no trailing slash. The one address that owns the SEO. */
  url: string;
  /** Logo in /public. Companies use the white mark (the footer is navy). */
  logo: string;
  /** One line, plain language — what this business does. */
  descriptor: string;
  /** Registration, for companies. Clients carry none: they are not ours. */
  registration?: string;
  /**
   * Clients ONLY: is written permission to publish this mark on file?
   * false (or missing) = do not render this brand anywhere public.
   */
  permissionOnFile?: boolean;
}

export const BRANDS: readonly Brand[] = [
  {
    code: "a2z",
    name: "A2Z CREATIVE MARKETING",
    kind: "company",
    url: "https://a2zcreative.my",
    logo: "/logo-white.png",
    descriptor: "Creative marketing, digital growth and live commerce",
    registration: "202603003468 (CA0414729-A)",
  },
  {
    code: "azone",
    name: "AZ ONE OFFICIAL",
    kind: "company",
    url: "https://azoneofficial.com",
    logo: "/brands/azone-white.png",
    descriptor: "Business consultancy and development",
    registration: "202603168673 (JM1046169-H)",
  },
  {
    code: "elfia",
    name: "ELFIA",
    kind: "client",
    url: "https://elfiaofficialstore.my",
    logo: "/brands/elfia.png",
    descriptor: "Live commerce client",
    // No signed permission on file — so ELFIA renders nowhere public. Ask,
    // get it in writing, THEN flip this. Do not flip it "temporarily".
    permissionOnFile: false,
  },
] as const;

/** The businesses you own — safe to show together, in this order. */
export const OUR_COMPANIES: readonly Brand[] = BRANDS.filter((b) => b.kind === "company");

/** Clients cleared for publication. Empty until a permission is on file. */
export const PUBLISHABLE_CLIENTS: readonly Brand[] = BRANDS.filter(
  (b) => b.kind === "client" && b.permissionOnFile === true,
);

/** Everything except us — the "other companies" a visitor can jump to. */
export const SISTER_COMPANIES: readonly Brand[] = OUR_COMPANIES.filter((b) => b.code !== "a2z");

export function brandByCode(code: string): Brand | undefined {
  return BRANDS.find((b) => b.code === code);
}
