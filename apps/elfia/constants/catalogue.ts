export interface Product {
  slug: string;
  name: string;
  collection: string;
  imageSrc: string;
  imageAlt: string;
  description: string;
  /** Fabric, dimensions, and care. Left empty until confirmed — never invented. */
  details?: readonly { label: string; value: string }[];
  gallery?: readonly string[];
}

export interface Collection {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
}

export const COLLECTIONS: readonly Collection[] = [
  {
    slug: "signature",
    name: "The Signature Shawl",
    tagline: "Everyday",
    description:
      "Premium chiffon in essential neutrals — soft drape, opaque coverage, and a matte finish that pairs with everything.",
    imageSrc: "/products/shawl-taupe.jpg",
    imageAlt: "The Signature Shawl in mocha, styled with a white blazer",
  },
  {
    slug: "corporate",
    name: "The Corporate Series",
    tagline: "Workwear",
    description:
      "A structured drape that holds its shape through a full working day, made for boardrooms and long meetings.",
    imageSrc: "/products/corporate.jpg",
    imageAlt: "The Corporate Series styled with a tailored black suit",
  },
  {
    slug: "active",
    name: "The Active Hijab",
    tagline: "Active",
    description:
      "Breathable, quick-dry, and secure without pins — from warm-up to match point.",
    imageSrc: "/products/active.jpg",
    imageAlt: "The Active Hijab worn on a pickleball court",
  },
] as const;

export const PRODUCTS: readonly Product[] = [
  {
    slug: "signature-shawl-mocha",
    name: "The Signature Shawl — Mocha",
    collection: "signature",
    imageSrc: "/products/shawl-taupe.jpg",
    imageAlt: "ELFIA signature chiffon shawl in mocha, styled with a white blazer",
    description:
      "Our signature premium chiffon in warm mocha — soft drape, opaque coverage, and a matte finish that pairs with everything from office whites to weekend neutrals.",
  },
  {
    slug: "signature-shawl-beige",
    name: "The Signature Shawl — Beige",
    collection: "signature",
    imageSrc: "/products/shawl-beige.jpg",
    imageAlt: "ELFIA signature chiffon shawl in beige",
    description:
      "The quietest neutral in the range. Beige sits close to skin tones, which makes it the easiest piece to reach for when the outfit is doing the talking.",
  },
  {
    slug: "signature-shawl-soft-grey",
    name: "The Signature Shawl — Soft Grey",
    collection: "signature",
    imageSrc: "/products/shawl-grey-front.jpg",
    imageAlt: "ELFIA signature chiffon shawl in soft grey, front draped styling",
    description:
      "Cool soft grey in our signature chiffon — clean and contemporary. Shown in front-draped, side, and back styling so you can see the full fall of the fabric.",
    gallery: [
      "/products/shawl-grey-front.jpg",
      "/products/shawl-grey.jpg",
      "/products/shawl-grey-profile.jpg",
      "/products/shawl-grey-back.jpg",
    ],
  },
  {
    slug: "corporate-khaki",
    name: "Corporate Series — Khaki",
    collection: "corporate",
    imageSrc: "/products/corporate.jpg",
    imageAlt: "ELFIA corporate series hijab in khaki, styled with a black suit",
    description:
      "Built for the boardroom: a structured drape in khaki that holds its shape through a full working day, styled here against a tailored black suit.",
  },
  {
    slug: "active-black",
    name: "Active Hijab — Black",
    collection: "active",
    imageSrc: "/products/active.jpg",
    imageAlt: "ELFIA active sports hijab in black on a pickleball court",
    description:
      "A breathable sports hijab that stays put from warm-up to match point — lightweight, quick-dry, and secure without pins.",
  },
  {
    slug: "neutral-collection",
    name: "The Neutral Collection",
    collection: "signature",
    imageSrc: "/products/collection.jpg",
    imageAlt: "The ELFIA neutral collection — black, mocha, beige, and soft grey",
    description:
      "All four essential neutrals — black, mocha, beige, and soft grey — the foundation of an ELFIA wardrobe.",
  },
] as const;

/**
 * Live drop schedule. Sessions are published from the CMS in production
 * (Admin → Content, key `live.schedule`); this is the static fallback so the
 * page is never empty.
 */
export interface LiveSession {
  /** ISO date — used for both display and the JSON-LD event. */
  date: string;
  time: string;
  platform: string;
  title: string;
  description: string;
  href: string;
}

export const LIVE_SESSIONS: readonly LiveSession[] = [] as const;

export const DROP_STEPS = [
  {
    step: "01",
    title: "We announce the drop",
    description:
      "Follow us so the session lands in your feed. Each drop is announced ahead of time with the pieces and colours going live.",
  },
  {
    step: "02",
    title: "You see the fabric move",
    description:
      "Every piece is styled on camera — drape, fall, and true colour under real light. Ask anything in the comments and we answer live.",
  },
  {
    step: "03",
    title: "Price is revealed live",
    description:
      "Prices are announced during the session, not before. Quantities are limited and pieces are first come, first served.",
  },
  {
    step: "04",
    title: "Checkout in the session",
    description:
      "Order through the pinned link while you watch. We confirm and arrange delivery straight after the drop closes.",
  },
] as const;

export const JOURNAL_POSTS = [
  {
    slug: "how-to-style-a-chiffon-shawl",
    title: "Three ways to style a chiffon shawl",
    excerpt:
      "The same shawl reads differently depending on how it falls. Here are the three drapes we come back to most.",
    date: "2026-07-20",
    body: [
      "Chiffon rewards a light hand. The fabric is designed to fall, so the styling decisions that matter most are about where you let it hang rather than how tightly you secure it.",
      "The front drape is the most forgiving: even lengths on both sides, one shoulder loose. It suits a blazer because the vertical line lengthens the whole outfit.",
      "The side sweep moves the volume to one shoulder. It works when the outfit already has a focal point on the other side — a bag strap, a detail on the sleeve.",
      "The wrapped finish tucks the longer end back over the shoulder. It stays put through a full day, which is why it is the one we recommend for work.",
    ],
  },
] as const;
