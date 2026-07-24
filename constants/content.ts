import {
  BarChart3,
  Clapperboard,
  Megaphone,
  Palette,
  Radio,
  Users,
} from "lucide-react";

import type {
  ElfiaProduct,
  FaqItem,
  ProcessStep,
  Service,
  Statistic,
  Testimonial,
} from "@/types";

/* ------------------------------------------------------------------ */
/* Contact — TODO(Alīf): replace with the real numbers/links.          */
/* ------------------------------------------------------------------ */

export const CONTACT = {
  // WhatsApp number in international format, digits only.
  whatsapp: "60123834821",
  whatsappMessage:
    "Hi AZ ONE OFFICIAL, I'm interested in your Live Commerce services. I would like to know more.",
  email: "hello@azoneofficial.com", // TODO: confirm mailbox
  socials: {
    tiktok: "https://www.tiktok.com/@azoneofficial", // TODO: confirm handle
    instagram: "https://www.instagram.com/azoneofficial", // TODO: confirm handle
    facebook: "https://www.facebook.com/azoneofficial", // TODO: confirm handle
  },
} as const;

export function whatsappUrl(): string {
  const text = encodeURIComponent(CONTACT.whatsappMessage);
  return `https://wa.me/${CONTACT.whatsapp}?text=${text}`;
}

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */

export const ABOUT = {
  eyebrow: "About AZ ONE",
  title: "Live commerce, run like a business — not an experiment",
  body: [
    "AZ ONE OFFICIAL is a Malaysian live commerce agency. We put brands in front of buyers in real time — TikTok Live hosting, end-to-end live commerce management, and social commerce strategy built around what actually converts.",
    "We are also a brand owner ourselves: ELFIA, our premium fashion label, is built, sold, and scaled through the same live commerce playbook we run for clients. When we advise you, it is from the seller's chair, not the sidelines.",
  ],
} as const;

export const STATISTICS: readonly Statistic[] = [
  { value: 500, suffix: "+", label: "Live sessions hosted" },
  { value: 12, suffix: "", label: "Trained live hosts" },
  { value: 3, suffix: "x", label: "Average GMV growth" },
] as const; // TODO(Alīf): replace with real numbers before launch

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export const SERVICES: readonly Service[] = [
  {
    title: "Live host service",
    description:
      "Trained hosts who sell — product pitching, pinned-deal pacing, and comment conversion, in Bahasa Melayu and English.",
    icon: Radio,
  },
  {
    title: "Live commerce management",
    description:
      "We run the whole session: rundown, offers, moderation, order push, and post-live reporting. You watch the numbers.",
    icon: BarChart3,
  },
  {
    title: "TikTok strategy",
    description:
      "Account positioning, campaign planning, and a content calendar that feed your live room instead of fighting it.",
    icon: Megaphone,
  },
  {
    title: "Creative design",
    description:
      "Covers, overlays, product cards, and campaign visuals that make your brand look worth stopping the scroll for.",
    icon: Palette,
  },
  {
    title: "Video editing & content creation",
    description:
      "Live-session highlights cut into short-form content that keeps selling long after the stream ends.",
    icon: Clapperboard,
  },
  {
    title: "Business consultation",
    description:
      "Brand positioning, pricing, and channel strategy — advised from the seller's chair, because we sell live too.",
    icon: Users,
  },
] as const;

/* ------------------------------------------------------------------ */
/* Showcase — testimonials.                                            */
/* TODO(Alīf): SAMPLE quotes. Replace with real client words, or hide  */
/* the section by leaving this array empty.                            */
/* ------------------------------------------------------------------ */

export const TESTIMONIALS: readonly Testimonial[] = [] as const;

/* ------------------------------------------------------------------ */
/* ELFIA                                                               */
/* ------------------------------------------------------------------ */

export const ELFIA = {
  eyebrow: "Our house brand",
  title: "ELFIA",
  tagline: "Premium hijabs, born live",
  body: "ELFIA is AZ ONE's own hijab label — premium chiffon shawls in essential neutrals, designed in Malaysia for office, everyday, and active wear. Every drop is launched on TikTok Live, so our audience sees the fabric move before they ever tap checkout.",
  cta: "Watch the next drop live",
} as const;

export const ELFIA_PRODUCTS: readonly ElfiaProduct[] = [
  {
    slug: "signature-shawl-taupe",
    name: "The Signature Shawl — Taupe",
    category: "Everyday",
    imageSrc: "/elfia/shawl-taupe.jpg",
    imageAlt: "ELFIA signature chiffon shawl in taupe, styled with a white blazer",
    description:
      "Our signature premium chiffon in warm taupe — soft drape, opaque coverage, and a matte finish that pairs with everything from office whites to weekend neutrals.",
  },
  {
    slug: "signature-shawl-beige",
    name: "The Signature Shawl — Beige",
    category: "Everyday",
    imageSrc: "/elfia/shawl-beige.jpg",
    imageAlt: "ELFIA signature chiffon shawl in beige, styled with a white blazer",
    description:
      "The same signature chiffon in soft beige — a warm neutral that flatters every skin tone and layers beautifully over light workwear.",
  },
  {
    slug: "signature-shawl-grey",
    name: "The Signature Shawl — Grey",
    category: "Everyday",
    imageSrc: "/elfia/shawl-grey-front.jpg",
    imageAlt: "ELFIA signature chiffon shawl in light grey, front draped styling",
    description:
      "Cool light grey in our signature chiffon — clean and contemporary. Shown here in front-draped, side, and back styling so you can see the full fall of the fabric.",
    gallery: [
      "/elfia/shawl-grey-front.jpg",
      "/elfia/shawl-grey.jpg",
      "/elfia/shawl-grey-profile.jpg",
      "/elfia/shawl-grey-back.jpg",
    ],
  },
  {
    slug: "corporate-blush",
    name: "Corporate Series — Blush",
    category: "Workwear",
    imageSrc: "/elfia/corporate.jpg",
    imageAlt: "ELFIA corporate series hijab in blush, styled with a black suit",
    description:
      "Built for the boardroom: a structured drape in soft blush that holds its shape through a full working day, styled here against a tailored black suit.",
  },
  {
    slug: "active-black",
    name: "Active Hijab — Black",
    category: "Active",
    imageSrc: "/elfia/active.jpg",
    imageAlt: "ELFIA active sports hijab in black, worn on court",
    description:
      "A breathable sports hijab that stays put from warm-up to match point — lightweight, quick-dry, and secure without pins.",
  },
  {
    slug: "neutral-collection",
    name: "The Neutral Collection",
    category: "Collection",
    imageSrc: "/elfia/collection.jpg",
    imageAlt: "ELFIA neutral collection — black, taupe, beige, and grey chiffon shawls",
    description:
      "All four essential neutrals — black, taupe, beige, and grey — the foundation of an effortless rotation. Collection bundles are announced during live drops.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Process                                                             */
/* ------------------------------------------------------------------ */

export const PROCESS: readonly ProcessStep[] = [
  {
    step: 1,
    title: "Consultation",
    description:
      "We review your products, margins, and audience, and agree on what a winning live channel looks like for you.",
  },
  {
    step: 2,
    title: "Setup",
    description:
      "Account readiness, studio setup, host casting, and a session rundown built around your best offers.",
  },
  {
    step: 3,
    title: "Go live",
    description:
      "Our hosts and producers run the session end to end — pitching, moderating, and pushing orders in real time.",
  },
  {
    step: 4,
    title: "Scale",
    description:
      "Post-live reporting turns into the next rundown. We keep what converted, cut what didn't, and grow the schedule.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

export const FAQS: readonly FaqItem[] = [
  {
    question: "Which platforms do you go live on?",
    answer:
      "Our core platform is TikTok Live, where Malaysian live commerce is strongest today. We can also support other platforms your brand already sells on — tell us during consultation.",
  },
  {
    question: "Do you work with small brands?",
    answer:
      "Yes. Live commerce rewards good products and good offers, not big ad budgets. Our packages scale from single trial sessions to full monthly schedules.",
  },
  {
    question: "Can you host in Bahasa Melayu and English?",
    answer:
      "Both. Our hosts sell comfortably in Bahasa Melayu, English, or a natural mix — matched to your audience.",
  },
  {
    question: "What do I need to prepare before the first live?",
    answer:
      "Products, pricing, and stock. We handle the rest: rundown, studio, host, moderation, and reporting.",
  },
  {
    question: "What is ELFIA?",
    answer:
      "ELFIA is our own premium hijab brand — chiffon shawls in essential neutrals for office, everyday, and active wear — built and sold through live commerce. It is proof that the playbook we offer clients is one we run ourselves.",
  },
  {
    question: "How do I get started?",
    answer:
      "Book a consultation. It is a short call on WhatsApp where we learn about your brand and recommend the right starting package.",
  },
] as const;
