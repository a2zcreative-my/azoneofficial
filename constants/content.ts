import {
  BarChart3,
  Camera,
  Megaphone,
  Radio,
  ShoppingBag,
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
  whatsapp: "60123456789", // TODO: replace with the real AZ ONE WhatsApp number
  whatsappMessage: "Hi AZ ONE OFFICIAL, I'd like to book a consultation.",
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
    title: "TikTok Live hosting",
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
    title: "Social commerce strategy",
    description:
      "Account positioning, content calendar, and campaign planning that feed your live room instead of fighting it.",
    icon: Megaphone,
  },
  {
    title: "Studio & production",
    description:
      "Lighting, framing, and set design that make products look worth buying — from our studio or on-site at yours.",
    icon: Camera,
  },
  {
    title: "Host training",
    description:
      "Turn your own team into confident live sellers with our hosting curriculum, scripts, and live drills.",
    icon: Users,
  },
  {
    title: "Brand partnerships",
    description:
      "Consignment and revenue-share models for brands that want sales first and fixed costs later.",
    icon: ShoppingBag,
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
  tagline: "Premium fashion, born live",
  body: "ELFIA is AZ ONE's own fashion label — designed in Malaysia and sold the way we know best: live. Every drop is launched on TikTok Live, so our audience sees the fabric move before they ever tap checkout.",
  cta: "Watch the next drop live",
} as const;

export const ELFIA_PRODUCTS: readonly ElfiaProduct[] = [
  {
    name: "Signature Collection",
    category: "Ready-to-wear",
    imageSrc: "", // TODO(Alīf): add /public/elfia/signature.jpg
    imageAlt: "ELFIA Signature Collection ready-to-wear pieces",
  },
  {
    name: "Live Exclusive Drops",
    category: "Limited",
    imageSrc: "", // TODO(Alīf): add /public/elfia/drops.jpg
    imageAlt: "ELFIA limited pieces sold only during live sessions",
  },
  {
    name: "Essentials",
    category: "Everyday",
    imageSrc: "", // TODO(Alīf): add /public/elfia/essentials.jpg
    imageAlt: "ELFIA everyday essential pieces",
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
      "ELFIA is our own premium fashion brand, built and sold through live commerce. It is proof that the playbook we offer clients is one we run — and win with — ourselves.",
  },
  {
    question: "How do I get started?",
    answer:
      "Book a consultation. It is a short call on WhatsApp where we learn about your brand and recommend the right starting package.",
  },
] as const;
