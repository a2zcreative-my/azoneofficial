/* v1.32.0 — the two named portfolio entries link out via the brand
   registry, so a domain is never written twice (tests/brands-guard.mjs
   enforces that). */
import { brandByCode } from "./brands";

import {
  Building2,
  Clock4,
  FileBarChart,
  Headset,
  MapPin,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ------------------------------------------------------------------ */
/* Why choose us (per master prompt)                                   */
/* ------------------------------------------------------------------ */

export interface WhyItem {
  title: string;
  description: string;
  icon: LucideIcon;
}

export const WHY_CHOOSE_US: readonly WhyItem[] = [
  {
    title: "Professional team",
    description:
      "Strategists, designers, producers, and hosts who treat every brief like a campaign, not a favour done between other jobs.",
    icon: UsersRound,
  },
  {
    title: "Modern live studio",
    description:
      "Purpose-built sets, lighting, and framing that make products look worth buying.",
    icon: Building2,
  },
  {
    title: "Dedicated live operations",
    description:
      "Moderation, order push, and offer pacing handled in real time while the host sells.",
    icon: Clock4,
  },
  {
    title: "Monthly reporting",
    description:
      "Reach, GMV, viewers, and conversion in plain numbers — plus what we'll change next month.",
    icon: FileBarChart,
  },
  {
    title: "Fast support",
    description:
      "One WhatsApp away. Questions answered in hours, not ticket queues.",
    icon: Headset,
  },
  {
    title: "Local Malaysian team",
    description:
      "Based in Johor Bahru, marketing and selling in Bahasa Melayu and English to the audience you actually serve.",
    icon: MapPin,
  },
] as const;

/* ------------------------------------------------------------------ */
/* Portfolio & case studies                                            */
/* TODO(Alīf): add real entries as they land. Pages show an honest     */
/* "in preparation" state while these are empty.                       */
/* ------------------------------------------------------------------ */

export interface PortfolioItem {
  client: string;
  summary: string;
  result: string;
  /** External link to the client's own site; card becomes clickable. */
  href?: string;
  /** v1.32.0 — logo in /public/brands. Only for entries cleared to be named. */
  logo?: string;
  /** Short line under the name: what the relationship actually is. */
  role?: string;
}

/*
 * Client confidentiality (v1.27.0): entries are published anonymised unless
 * the client has given written permission to be named. The capability story
 * is ours to tell; the client's name is theirs.
 *
 * v1.32.0 — the CEO's instruction of 20-08-2026 ("include portfolio AZ one
 * and ELFIA", named, with logos) is that permission, on the record, for the
 * two entries below and no others. AZ ONE OFFICIAL is our own sister
 * company; ELFIA is a client, named here on his authority. Anyone adding a
 * THIRD named entry still needs written permission from that client first.
 */
export const PORTFOLIO_ITEMS: readonly PortfolioItem[] = [
  {
    client: "ELFIA",
    role: "Modestwear brand — live commerce client",
    logo: "/brands/elfia.png",
    href: brandByCode("elfia")?.url,
    summary:
      "Built the live selling channel from a standing start: session format, trained hosts, rundowns, and the creative that surrounds each drop. We also built and run the brand's own online store.",
    result:
      "A repeatable drop format the brand now runs on a schedule, with short-form content cut from each session keeping the channel warm in between — and a direct-to-customer storefront taking orders between lives.",
  },
  {
    client: "AZ ONE OFFICIAL",
    role: "Business consultancy — sister company",
    logo: "/brands/azone.png",
    href: brandByCode("azone")?.url,
    summary:
      "Brand, website and enquiry pipeline for the group's consultancy arm: positioning, the full site, and a lead desk that turns an enquiry into a quotation without anything falling through the gaps.",
    result:
      "A consultancy that presents as seriously as it works — every enquiry tracked from first message to signed proposal, on its own domain and its own letterhead.",
  },
] as const;

export interface CaseStudy {
  title: string;
  client: string;
  challenge: string;
  approach: string;
  result: string;
}

/* Same confidentiality rule as PORTFOLIO_ITEMS above: anonymised unless the
   client has given written permission to be named. */
export const CASE_STUDIES: readonly CaseStudy[] = [
  {
    title: "Building a live channel for a premium modestwear label",
    client: "A premium modestwear label",
    challenge:
      "The brand sells premium chiffon in a category where the decision is tactile — drape, weight, and true colour decide the sale, and none of them survive a flat product photo. It had product and a point of view, but no live presence, no host, and no repeatable session format.",
    approach:
      "We built the channel end to end: positioning and offer structure first, then a session format with a rundown, pinned-deal pacing, and comment moderation. Hosts were trained to sell fabric the way a shopper judges it — styling each piece on camera under real light and answering objections live. Every drop is run as a campaign, with creative before the session and short-form edits cut from the footage afterwards.",
    result:
      "A live channel that runs on a schedule rather than on hope: drops sell in-session, pricing is revealed live to limited quantities, and session footage keeps selling between drops.",
  },
] as const;

/* ------------------------------------------------------------------ */
/* Blog — starter posts. TODO(Alīf): review before publishing.         */
/* ------------------------------------------------------------------ */

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readMinutes: number;
  body: readonly string[];
}

export const BLOG_POSTS: readonly BlogPost[] = [
  {
    slug: "what-is-live-commerce-malaysia",
    title: "What is live commerce, and why is Malaysia so good at it?",
    excerpt:
      "Live commerce turns a product feed into a conversation. Here's how it works and why Malaysian audiences respond to it so strongly.",
    date: "2026-07-24",
    readMinutes: 4,
    body: [
      "Live commerce is simple to describe and hard to fake: a host presents products on a live stream, viewers ask questions in real time, and purchases happen inside the same app — most often TikTok in Malaysia. No waiting, no guessing about sizing or texture, no leaving the video to check out.",
      "It works because it restores something online shopping removed: a person you can ask. When a viewer types a question and hears the answer seconds later — in their own language, from someone holding the actual product — trust forms faster than any product page can manage.",
      "Malaysian audiences have taken to this format especially strongly. Shopping here has always been conversational — pasar malam, bargaining, asking the seller what's good. Live commerce is that same behaviour, moved onto a phone screen.",
      "For brands, the practical difference is measurability. A live session produces hard numbers within hours: viewers, comments, add-to-carts, GMV. You learn more about your offer in one two-hour live than in a month of static posting.",
      "The catch is that going live badly is worse than not going live at all. An unprepared host, dead air, or fumbled offers cost trust in public. That's the gap agencies close: trained hosts, a session rundown, live operations, and reporting that turns each session into a better next one.",
    ],
  },
  {
    slug: "prepare-first-tiktok-live",
    title: "5 things to prepare before your brand's first TikTok Live",
    excerpt:
      "Most first lives fail in preparation, not on camera. Five things to have ready before you press Go Live.",
    date: "2026-07-24",
    readMinutes: 3,
    body: [
      "1. A hero offer. Not your whole catalogue — one deal strong enough to pin for the entire session. Viewers decide in seconds whether a live is worth staying for, and the pinned offer is what they judge.",
      "2. Stock you can actually ship. Nothing damages a new live channel faster than selling what you can't deliver. Confirm quantities before the session, not during it.",
      "3. Answers to the ten questions you'll definitely get. Size, material, delivery time, COD or not, returns. Write them down. A host who hesitates on basics loses the room.",
      "4. A reason to stay. Lives reward duration — a giveaway at the hour mark, a second drop, a discount that unlocks at a viewer count. Give people a reason not to scroll away.",
      "5. A way to measure. Decide before the session what success means: GMV, new followers, average watch time. A first live is a baseline, not a verdict — but only if you record the numbers.",
      "Get these five right and even a modest first session becomes a foundation. Get them wrong and no amount of on-camera charm will save it.",
    ],
  },
] as const;

/* ------------------------------------------------------------------ */
/* Careers                                                             */
/* ------------------------------------------------------------------ */

export const CAREERS = {
  intro:
    "A2Z CREATIVE MARKETING is a growing creative marketing team based in Johor Bahru, working across brand and campaign creative, digital marketing, content production, live commerce, and consultancy. We don't always have open roles listed — but we are always interested in meeting people who can sell, produce, or create.",
  interests: [
    "Live hosts — confident on camera in Bahasa Melayu, English, or both",
    "Live operations — moderation, order handling, session support",
    "Content & creative — short-form video editing, design, product styling",
    "Digital marketing — social strategy, campaign planning, paid and organic",
  ],
  cta: "Introduce yourself on WhatsApp with a short intro, a portfolio or showreel if you have one, and for hosts any on-camera clip.",
} as const;

/* ------------------------------------------------------------------ */
/* Consultancy — AZ ONE OFFICIAL, the consultancy arm of A2Z (v1.27.0) */
/*                                                                     */
/* House rule: content lives here, never hard-coded in the component.  */
/* Renders at /consultancy via app/consultancy/page.tsx.               */
/* ------------------------------------------------------------------ */

export interface ConsultancyService {
  title: string;
  description: string;
}

export const CONSULTANCY = {
  eyebrow: "Consultancy",
  /** The wording the CEO approved — use this lockup verbatim in headings. */
  lockup: "AZ ONE OFFICIAL — A Consultancy Service by A2Z Creative Marketing",
  title: "AZ ONE OFFICIAL",
  intro:
    "A Consultancy Service by A2Z Creative Marketing. Advice from a team that runs live channels and campaigns every week — so what you get is a plan that has already survived contact with real buyers.",
  /** Metadata description for the route; kept beside the copy it describes. */
  metaDescription:
    "AZ ONE OFFICIAL — A Consultancy Service by A2Z Creative Marketing. Business consultation, live commerce consultancy, and brand and channel strategy for Malaysian brands, from operators who sell live every week.",
  positioning: [
    "AZ ONE OFFICIAL is the consultancy service of A2Z Creative Marketing. Where the rest of the group builds and runs campaigns and live channels for brands, this is where brand owners come for the decision before the work: what to sell, where to sell it, at what price, and whether a channel is worth entering at all.",
    "It is a separate registered entity — 202603168673 (JM1046169-H) — and the entity that contracts, quotes, and invoices consultancy engagements. Everything else about it is A2Z: the same operators, the same standards, the same numbers.",
  ],
  servicesTitle: "What we advise on",
  services: [
    {
      title: "Business consultation",
      description:
        "Positioning, pricing, margin, and offer structure. We start from your numbers, not a template — then agree what a realistic next twelve months looks like and what has to be true for it to happen.",
    },
    {
      title: "Live commerce consultancy",
      description:
        "Whether live suits your product, what a viable session cadence costs, how to cast and train hosts, and what to measure. Includes an honest answer when live is the wrong channel for you.",
    },
    {
      title: "Brand & channel strategy",
      description:
        "Which platforms deserve your effort, what the brand should stand for on each, and how creative, content, and commerce fit together instead of competing for the same budget.",
    },
    {
      title: "Business & product development",
      description:
        "New product lines, bundle and range planning, and market-entry work for brands moving into a category or a channel for the first time — taken from idea to a plan someone can execute.",
    },
    {
      title: "Team & capability building",
      description:
        "Training your in-house team on the selling techniques, session operations, and reporting rhythm our own team uses, so the capability stays with you when the engagement ends.",
    },
    {
      title: "Performance review",
      description:
        "A read of what your channels are actually producing — reach, conversion, GMV, cost per sale — and a prioritised list of what to fix first, in the order that pays back fastest.",
    },
  ] as readonly ConsultancyService[],
  credibilityTitle: "Operators, not observers",
  credibility: [
    "Most consultancies advise on live commerce from a deck. We run live sessions ourselves, every week, on the same platforms and against the same algorithm you are up against — including for a premium modestwear label whose channel we built from zero and still operate end to end.",
    "That changes the advice. We know what a two-hour session actually costs to staff, how long a host takes to become good, what a realistic conversion rate looks like in month one versus month six, and which platform promises quietly do not hold. You get the version we would act on ourselves.",
  ],
  engagementTitle: "How an engagement works",
  engagement: [
    "A free first call on WhatsApp to understand the business and decide whether we are the right people for it.",
    "A scoped proposal with a fixed fee, the questions the engagement will answer, and the deliverables you keep.",
    "The work itself — sessions with you and your team, our own research, and access to our operators where relevant.",
    "A written recommendation, a prioritised action plan, and an optional review after you have run with it.",
  ],
  ctaTitle: "Start with the free call",
  ctaBody:
    "Tell us about your brand, your products, and where you are stuck. If consultancy is not what you need, we will say so and point you at the service that is.",
} as const;
