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
      "Hosts, producers, and strategists who treat every live like a campaign, not a webcam session.",
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
      "GMV, viewers, and conversion in plain numbers — plus what we'll change next month.",
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
      "Based in Johor Bahru, selling in Bahasa Melayu and English to the audience you actually serve.",
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
}

export const PORTFOLIO_ITEMS: readonly PortfolioItem[] = [] as const;

export interface CaseStudy {
  title: string;
  client: string;
  challenge: string;
  approach: string;
  result: string;
}

export const CASE_STUDIES: readonly CaseStudy[] = [] as const;

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
    "AZ ONE OFFICIAL is a growing live commerce team based in Johor Bahru. We don't always have open roles listed — but we are always interested in meeting people who can sell, produce, or create.",
  interests: [
    "Live hosts — confident on camera in Bahasa Melayu, English, or both",
    "Live operations — moderation, order handling, session support",
    "Content & creative — short-form video editing, design, product styling",
  ],
  cta: "Introduce yourself on WhatsApp with a short intro and, for hosts, any on-camera clip you have.",
} as const;
