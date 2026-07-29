import {
  IconCreative,
  IconLiveHost,
  IconOperations,
  IconPerformance,
  IconShopeeLive,
  IconStrategy,
  IconTikTokLive,
} from "@/components/ui/service-icons";

import type {
  CaseStudy,
  FaqItem,
  PackageMatrixRow,
  PackageTier,
  ProcessStep,
  Service,
  Testimonial,
  TrustSignal,
} from "@/types";

/* ------------------------------------------------------------------ */
/* Contact — TODO(Alīf): replace with the real numbers/links.          */
/* ------------------------------------------------------------------ */

export const CONTACT = {
  // WhatsApp number in international format, digits only.
  whatsapp: "60123834821",
  whatsappMessage:
    "Hi AZ ONE OFFICIAL, I'm interested in your Live Commerce services. I would like to know more.",
  email: "admin@azoneofficial.com",
  socials: {
    tiktok: "https://www.tiktok.com/@azoneofficialhq",
    instagram: "https://www.instagram.com/azoneofficialhq",
    facebook: "https://www.facebook.com/azoneofficialhq",
  },
} as const;

export function whatsappUrl(message?: string): string {
  const text = encodeURIComponent(message ?? CONTACT.whatsappMessage);
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
    "We do not advise from the sidelines. ELFIA, the premium hijab label whose live channel we built and run, sells through the same playbook we would put your brand through — so every recommendation has been tested against real stock, real margins, and a real audience.",
  ],
} as const;

/**
 * Credibility markers shown in place of performance counters.
 *
 * The previous counters ("500+ sessions", "12 hosts", "3x GMV") were
 * placeholders and rendered as 0+ / 0 / 0x on the live site, which read as
 * "an agency with zero experience". Until there are real, defensible numbers
 * to publish, we lead with facts that are true today and still build trust.
 *
 * When real figures exist, add them back via STATISTICS — do not publish
 * estimates or aspirational numbers.
 */
export const TRUST_SIGNALS: readonly TrustSignal[] = [
  {
    label: "SSM-registered",
    description:
      "AZ One Official — 202603168673 (JM1046169-H). A registered Malaysian company, not a freelance side project.",
  },
  {
    label: "Operators, not observers",
    description:
      "We run live channels end to end for brands like ELFIA — so every recommendation comes from operating a channel, not observing one.",
  },
  {
    label: "Johor Bahru based team",
    description:
      "Hosts, creative, and management in one team you can meet — with fast WhatsApp support during your sessions.",
  },
  {
    label: "Bahasa Melayu & English hosts",
    description:
      "Trained to sell in the language your buyers actually shop in, or a natural mix of both.",
  },
] as const;

/**
 * Real performance figures. Empty until AZ ONE has numbers worth publishing —
 * the About section falls back to TRUST_SIGNALS while this is empty, so no
 * zeroes are ever rendered.
 */
export const STATISTICS: readonly any[] = [] as const;

/* ------------------------------------------------------------------ */
/* Packages                                                            */
/* ------------------------------------------------------------------ */

/**
 * Published package tiers. Prices are deliberately not shown — the site sells
 * the consultation, and pricing is quoted per brand.
 *
 * TODO(Alīf): confirm the session counts and inclusions below against the
 * package sheet before this goes live. The shape is right; the specifics
 * should match what you actually deliver.
 */
export const PACKAGES: readonly PackageTier[] = [
  {
    name: "Starter",
    tagline: "Test live commerce properly, without committing a season to it.",
    cadence: "1 session per week",
    features: [
      "2 hours per live session",
      "1 trained live host (BM/English)",
      "Post-session report: viewers, orders, GMV",
      "2 creative assets per month (covers, overlays)",
      "Onboarding consultation",
    ],
  },
  {
    name: "Growth",
    tagline: "A real schedule, so the algorithm and your buyers learn to expect you.",
    cadence: "3 sessions per week",
    features: [
      "2–3 hours per live session",
      "Live host + comment moderator",
      "Weekly reporting with what we change next",
      "6 creative assets per month",
      "Monthly strategy call",
    ],
    featured: true,
  },
  {
    name: "Scale",
    tagline: "Live as a primary sales channel, managed end to end.",
    cadence: "5 sessions per week",
    features: [
      "Host rotation + dedicated live manager",
      "Full session management: rundown, offers, order push",
      "Weekly reporting + optimisation review",
      "12 creative assets + short-form edits",
      "Bi-weekly strategy call",
    ],
  },
  {
    name: "Enterprise",
    tagline: "Built around your calendar, your studio, and your team.",
    cadence: "Custom schedule",
    features: [
      "Daily or campaign-based scheduling",
      "Dedicated host team and account lead",
      "Custom reporting to your format",
      "Full creative production",
      "On-site sessions at your office or studio",
    ],
  },
] as const;

/**
 * Side-by-side comparison, in PACKAGES order: Starter, Growth, Scale, Enterprise.
 *
 * TODO(Alīf): confirm these against the real package sheet before launch —
 * same caveat as PACKAGES above.
 */
export const PACKAGE_MATRIX: readonly PackageMatrixRow[] = [
  {
    feature: "Live sessions",
    values: ["1 per week", "3 per week", "5 per week", "Custom schedule"],
  },
  {
    feature: "Hours per session",
    values: ["2 hours", "2–3 hours", "2–3 hours", "Custom"],
  },
  {
    feature: "Live host",
    values: [
      "1 trained host",
      "Host + moderator",
      "Host rotation + live manager",
      "Dedicated host team",
    ],
  },
  {
    feature: "Reporting",
    values: [
      "Post-session report",
      "Weekly reporting",
      "Weekly + optimisation review",
      "Custom format",
    ],
  },
  {
    feature: "Creative",
    values: [
      "2 assets / month",
      "6 assets / month",
      "12 assets + short-form edits",
      "Full production",
    ],
  },
  {
    feature: "Consultation",
    values: [
      "Onboarding call",
      "Monthly strategy call",
      "Bi-weekly strategy call",
      "Dedicated account lead",
    ],
  },
  {
    feature: "On-site sessions",
    values: [false, false, "On request", true],
  },
  {
    feature: "WhatsApp support during sessions",
    values: [true, true, true, true],
  },
] as const;

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

export const SERVICES: readonly Service[] = [
  {
    title: "TikTok Live",
    description:
      "The channel most Malaysian brands sell on. We run the room end to end — hosting, pinned-deal pacing, comment conversion, and order push — in Bahasa Melayu, English, or a natural mix.",
    icon: IconTikTokLive,
  },
  {
    title: "Shopee Live",
    description:
      "Sessions built for a marketplace audience that arrives ready to buy: voucher timing, bundle framing, and stock sequencing tuned to how Shopee shoppers actually behave.",
    icon: IconShopeeLive,
  },
  {
    title: "Live commerce strategy",
    description:
      "Which platform, what cadence, which SKUs lead, and what an offer should look like. Built from your margins and stock, not a template.",
    icon: IconStrategy,
  },
  {
    title: "Live hosts",
    description:
      "Trained hosts who sell rather than present — product pitching, objection handling, and comment conversion, matched to your brand and your buyers.",
    icon: IconLiveHost,
  },
  {
    title: "Live operations",
    description:
      "The half of live nobody sees: rundowns, moderation, order push, stock checks, and the studio setup — run by a team so your host only has to sell.",
    icon: IconOperations,
  },
  {
    title: "Creative content",
    description:
      "Covers, overlays, product cards, and short-form edits cut from your sessions, so the selling continues long after the stream ends.",
    icon: IconCreative,
  },
  {
    title: "Performance marketing",
    description:
      "Paid amplification around your sessions — traffic into the room, retargeting after it, and reporting that ties spend to GMV rather than views.",
    icon: IconPerformance,
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

/* ------------------------------------------------------------------ */
/* Client case studies                                                 */
/* ------------------------------------------------------------------ */

/**
 * ELFIA is a CLIENT of AZ ONE OFFICIAL, presented as a portfolio case study.
 * It is no longer an internal brand: its own site lives at apps/elfia and
 * deploys independently. Nothing here should describe it as "our brand".
 */
export const CASE_STUDIES: readonly CaseStudy[] = [
  {
    slug: "elfia",
    client: "ELFIA",
    industry: "Modest fashion — premium hijabs",
    summary:
      "A premium hijab label that needed a live channel from a standing start — and a way to sell fabric that only convinces when you see it move.",
    heroImage: "/clients/elfia/hero.jpg",
    heroImageAlt: "An ELFIA chiffon shawl styled on camera during a live session",
    website: "https://elfia.com.my",
    challenge: [
      "ELFIA sells premium chiffon shawls in a category where the buying decision is tactile: drape, weight, and true colour decide the sale, and none of them survive a flat product photo.",
      "The brand had product and a point of view, but no live presence, no host, and no repeatable session format — so every launch depended on static posts and hope.",
    ],
    solution: [
      "We built the live channel end to end: positioning and offer structure first, then a session format with a rundown, pinned-deal pacing, and comment moderation.",
      "Hosts were trained to sell the fabric the way a shopper judges it — styling each piece on camera, showing the fall under real light, and answering objections live.",
      "Every drop is treated as a campaign: creative assets before the session, short-form edits cut from the footage afterwards, and reporting that says what changes next.",
    ],
    results: [
      {
        label: "Live channel built from zero",
        detail:
          "From no live presence to a repeatable session format the brand runs on a schedule.",
      },
      {
        label: "Drops sell in-session",
        detail:
          "Pricing is revealed live and pieces are limited — turning each session into the release event rather than an afterthought.",
      },
      {
        label: "Content that outlives the stream",
        detail:
          "Session footage is cut into short-form assets that keep selling between drops.",
      },
    ],
    services: [
      "Live commerce strategy",
      "Live hosts",
      "Live operations",
      "Creative content",
    ],
    quote: {
      text: "They did not just host our sessions — they built the channel, and they sell it like it is their own.",
      attribution: "ELFIA",
    },
  },
] as const;

/** Convenience accessor for the homepage feature block. */
export const FEATURED_CASE_STUDY = CASE_STUDIES[0];



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
      "ELFIA — Dekat Di Mata, Menarik Di Hati — is our own premium hijab brand: chiffon shawls in essential neutrals for office, everyday, and active wear, built and sold through live commerce. It is proof that the playbook we offer clients is one we run ourselves.",
  },
  {
    question: "How much does it cost?",
    answer:
      "Pricing depends on how often you go live, how many hosts you need, and how much creative work is involved — so we quote per brand rather than publish a rate card. Our packages start with one session a week and scale to a daily schedule. Tell us your products and target cadence on WhatsApp and you'll get a clear number, not a range.",
  },
  {
    question: "How long is a live session, and how long before I see results?",
    answer:
      "Sessions typically run 2–3 hours; shorter than that rarely gives the room time to build. On results: a first session gives you a baseline, not a verdict. Brands that commit to a consistent weekly schedule usually see the picture clearly within 4–6 weeks, because live rewards repetition more than one-off effort.",
  },
  {
    question: "Can I use my own host?",
    answer:
      "Yes. If you already have a host or an in-house team, we can run everything around them — rundown, moderation, offers, order push, and reporting — or train them on the selling techniques our hosts use. Some brands start with our host and transition to their own later.",
  },
  {
    question: "Do you provide a studio?",
    answer:
      "Yes, we run sessions from our own setup in Johor Bahru, including lighting and the streaming setup. If your products need particular staging, tell us during consultation so we can plan it.",
  },
  {
    question: "Can you come to my office or warehouse?",
    answer:
      "Yes. On-site sessions are available and often make sense when stock is bulky, fragile, or high-value. Travel arrangements are agreed upfront during consultation.",
  },
  {
    question: "Do you guarantee sales?",
    answer:
      "No, and we would be careful with anyone who does. Sales depend on your product, pricing, stock, and offer as much as on hosting. What we commit to is the controllable part: trained hosts, a proper rundown, consistent sessions, and honest reporting — including when something isn't working and what we'll change.",
  },
  {
    question: "How do I get started?",
    answer:
      "Book a consultation. It is a short call on WhatsApp where we learn about your brand and recommend the right starting package.",
  },
] as const;
