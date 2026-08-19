import {
  IconConsult,
  IconDesign,
  IconLiveCommerce,
  IconLiveHost,
  IconStrategy,
  IconVideo,
} from "@/components/ui/service-icons";

import type {
  FaqItem,
  PackageMatrixRow,
  PackageTier,
  ProcessStep,
  Service,
  Statistic,
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
    "Hi A2Z Creative Marketing, I'm interested in your services. I would like to know more.",
  email: "admin@azoneofficial.com",
  socials: {
    tiktok: "https://www.tiktok.com/@azoneofficialhq",
    instagram: "https://www.instagram.com/azoneofficialhq",
    facebook: "https://www.facebook.com/azoneofficialhq",
  },
} as const;

/* ------------------------------------------------------------------ */
/* Problems we solve — homepage section.                               */
/* ------------------------------------------------------------------ */

/**
 * Pain → solution pairs; copy written to equal length so cards match.
 *
 * v1.27.0: the first two pains are brand and channel problems, the last four
 * are live-commerce problems. Every argument that was here before is kept —
 * live is now the sharp end of the list, not the whole list.
 */
export const PROBLEMS = [
  {
    problem: "Our brand looks different everywhere it appears",
    solution:
      "One creative direction, applied everywhere: identity, campaign visuals, product cards, session overlays, and packaging cues. A brand a buyer recognises in half a second is a brand they trust enough to buy from.",
  },
  {
    problem: "We post constantly and nothing converts",
    solution:
      "Posting is not a strategy. We build the plan first — audience, offer, channel mix, and calendar — then produce content designed to move someone from scroll to checkout, and report on what actually did.",
  },
  {
    problem: "We went live and nobody bought",
    solution:
      "A session is a sales format, not a camera pointed at products. We bring a trained host and a rundown built around your best offers — pitch, answer, close, on repeat for the full session.",
  },
  {
    problem: "We have no team or time to go live every week",
    solution:
      "We run the channel end to end: schedule, studio, host, moderation, order push, and reporting. You approve the plan and the offers; we do the rest, week after week.",
  },
  {
    problem: "Views are fine, but conversion is not",
    solution:
      "Watchers become buyers through offer structure — pinned deals, live pricing, limited quantities, and comment moderation that answers objections in the moment. Measured per session.",
  },
  {
    problem: "Everything dies when the stream ends",
    solution:
      "Session footage is cut into short-form content that keeps selling between lives, and every post-live report tells you what converted, what didn\u2019t, and what changes next session.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Live showcase — homepage section.                                   */
/* ------------------------------------------------------------------ */

/**
 * Live channels shown on the homepage.
 *
 * Platform reality, so nobody re-litigates this later:
 * - A LIVE stream cannot play inside another website on either platform.
 *   TikTok blocks its /live page from being framed; Shopee sends
 *   `X-Frame-Options`/frame-ancestors headers that block framing of shop and
 *   live pages outright. An <iframe> would render blank or refuse to load.
 * - Neither exposes a public "is this account live now?" API a static export
 *   could poll, so the site cannot branch on live status.
 *
 * What each platform DOES allow, and what we use:
 * - TikTok: the official creator embed (account + latest videos, always
 *   current). `videoUrl` pins one specific video instead, if ever wanted.
 * - Shopee: no embed of any kind. We present a branded channel card that
 *   links straight to the shop, where the live badge appears during a
 *   session — the closest honest equivalent.
 *
 * Both platform CTAs are live-status agnostic: the TikTok /live URL routes
 * to the live room during a session and the profile otherwise, and the
 * Shopee shop URL surfaces the live room when one is running.
 */
export const LIVE_SHOWCASE = {
  eyebrow: "Watch us work",
  title: "See a live session, live",
  intro:
    "The best proof of live commerce is a live session. Catch us on TikTok or Shopee while we run one — or watch our latest sessions and cuts right here.",
  /** Routes to the live room while live, to the profile otherwise. */
  tiktokLiveUrl: "https://www.tiktok.com/@azoneofficialhq/live",
  /** Profile URL for TikTok's creator embed (latest videos, always current). */
  tiktokProfileUrl: "https://www.tiktok.com/@azoneofficialhq",
  /** Shopee shop; the live badge appears here during a session. "" hides the card. */
  shopeeLiveUrl: "https://shopee.com.my/azoneoff",
  /** Shopee shop handle, shown on the channel card. */
  shopeeHandle: "azoneoff",
  /** Optional: pin one TikTok video instead of the creator widget. */
  videoUrl: "",
  /** Shown under the CTAs; edit to your real cadence. */
  scheduleNote: "Follow @azoneofficialhq so our next session lands in your feed.",
} as const;

export function whatsappUrl(message?: string): string {
  const text = encodeURIComponent(message ?? CONTACT.whatsappMessage);
  return `https://wa.me/${CONTACT.whatsapp}?text=${text}`;
}

/* ------------------------------------------------------------------ */
/* About                                                               */
/* ------------------------------------------------------------------ */

export const ABOUT = {
  eyebrow: "About A2Z",
  title: "Marketing, run like a business — not an experiment",
  body: [
    "A2Z CREATIVE MARKETING is a Malaysian creative marketing group based in Johor Bahru. We build brands and then sell for them: creative marketing, digital marketing, content creation, live commerce, marketing consultancy, and business and product development — one team, one accountable plan.",
    "We run channels, not just campaigns: for a premium modestwear label we built the live selling channel from zero and operate it end to end. When we advise you, it is from the seller's chair, not the sidelines.",
    "Our consultancy work is delivered by AZ ONE OFFICIAL — A Consultancy Service by A2Z Creative Marketing — the business unit that advises brand owners on positioning, channel strategy, and live commerce. Same team, same standards, a dedicated remit.",
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
      "A2Z Creative Marketing — 202603003468 (CA0414729-A). A registered Malaysian company, not a freelance side project.",
  },
  {
    label: "Operators, not observers",
    description:
      "We built and run the live selling channel for a premium modestwear label end to end — so every recommendation comes from the seller's chair.",
  },
  {
    label: "Johor Bahru based team",
    description:
      "Creatives, hosts, and management in one team you can meet — with fast WhatsApp support during your campaigns and sessions.",
  },
  {
    label: "Bahasa Melayu & English hosts",
    description:
      "Trained to sell in the language your buyers actually shop in, or a natural mix of both.",
  },
] as const;

/**
 * Real performance figures. Empty until A2Z has numbers worth publishing —
 * the About section falls back to TRUST_SIGNALS while this is empty, so no
 * zeroes are ever rendered.
 */
export const STATISTICS: readonly Statistic[] = [] as const;

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

/**
 * A2Z's service lines (v1.27.0).
 *
 * Six cards, deliberately: the grids that render this are 2-column on
 * /services and 3-column on the homepage, so six fills both cleanly. Between
 * them they cover the full registered remit — creative marketing, digital
 * marketing, live commerce, content creation, marketing consultancy,
 * business development, and product development. Live commerce is two of the
 * six, not the identity of all six.
 */
export const SERVICES: readonly Service[] = [
  {
    title: "Creative marketing",
    description:
      "Brand identity, campaign concepts, and the visuals that carry them — covers, overlays, product cards, and key art that make a brand worth stopping the scroll for.",
    icon: IconDesign,
  },
  {
    title: "Digital marketing",
    description:
      "Channel positioning, campaign planning, and a content calendar across TikTok, Instagram, and Facebook — built to feed your sales channels instead of fighting them.",
    icon: IconStrategy,
  },
  {
    title: "Live commerce management",
    description:
      "We run the whole session: rundown, offers, moderation, order push, and post-live reporting. You watch the numbers.",
    icon: IconLiveCommerce,
  },
  {
    title: "Live host service",
    description:
      "Trained hosts who sell — product pitching, pinned-deal pacing, and comment conversion, in Bahasa Melayu and English.",
    icon: IconLiveHost,
  },
  {
    title: "Content creation & video",
    description:
      "Shoots, short-form edits, and live-session highlights cut into content that keeps selling long after the stream ends.",
    icon: IconVideo,
  },
  {
    title: "Consultancy & business development",
    description:
      "Brand positioning, pricing, channel strategy, and new product development — delivered by AZ ONE OFFICIAL, our consultancy service, and advised from the seller's chair.",
    icon: IconConsult,
  },
] as const;

/* ------------------------------------------------------------------ */
/* Showcase — testimonials.                                            */
/* TODO(Alīf): SAMPLE quotes. Replace with real client words, or hide  */
/* the section by leaving this array empty.                            */
/* ------------------------------------------------------------------ */

export const TESTIMONIALS: readonly Testimonial[] = [] as const;

/* ------------------------------------------------------------------ */
/* Process                                                             */
/* ------------------------------------------------------------------ */

export const PROCESS: readonly ProcessStep[] = [
  {
    step: 1,
    title: "Consultation",
    description:
      "We review your products, margins, audience, and current marketing, and agree on what growth actually looks like for you.",
  },
  {
    step: 2,
    title: "Build",
    description:
      "Positioning and creative direction first, then the machinery: account readiness, campaign assets, studio setup, host casting, and a session rundown built around your best offers.",
  },
  {
    step: 3,
    title: "Go to market",
    description:
      "Campaigns run and sessions go live. Our hosts and producers work the room end to end — pitching, moderating, and pushing orders in real time.",
  },
  {
    step: 4,
    title: "Scale",
    description:
      "Reporting turns into the next campaign and the next rundown. We keep what converted, cut what didn't, and grow the schedule.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

export const FAQS: readonly FaqItem[] = [
  {
    question: "What does A2Z Creative Marketing actually do?",
    answer:
      "We are a Malaysian creative marketing group: creative marketing, digital marketing, content creation, live commerce, marketing consultancy, and business and product development. Brands come to us for one of those and usually stay for two or three, because the same team runs the strategy, the creative, and the selling.",
  },
  {
    question: "Do you only do live commerce?",
    answer:
      "No. Live commerce is one of our strongest capabilities — we build and run live selling channels end to end — but it sits alongside brand and campaign creative, digital marketing, content production, and consultancy. If live is not right for your product, we will tell you and recommend what is.",
  },
  {
    question: "Which platforms do you go live on?",
    answer:
      "Our core platform is TikTok Live, where Malaysian live commerce is strongest today. We can also support other platforms your brand already sells on — tell us during consultation.",
  },
  {
    question: "Do you work with small brands?",
    answer:
      "Yes. Good marketing rewards good products and good offers, not big ad budgets. Our packages scale from single trial sessions to full monthly schedules.",
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
    question: "What is AZ ONE OFFICIAL?",
    answer:
      "AZ ONE OFFICIAL is A2Z Creative Marketing's consultancy service — the business unit brand owners engage for business consultation, live commerce consultancy, and brand and channel strategy. It is a separate registered entity (202603168673 / JM1046169-H) and the entity that issues consultancy quotations, invoices, and receipts. See our Consultancy page for what an engagement covers.",
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
      "Get a free live audit. It is a short call on WhatsApp where we review your products and current channel, then recommend the right starting package.",
  },
] as const;
