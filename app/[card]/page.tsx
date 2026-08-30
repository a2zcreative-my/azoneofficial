import { Mail, MapPin, MessageCircle, Phone, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SITE_CONFIG } from "@/constants/site";
import { CARD_COMPANY, TEAM, cardBySlug, cardMonogram } from "@/constants/team";

/**
 * v1.71.0 — the digital business card (Track V).
 *
 * One route renders all three cards. `generateStaticParams` fixes the set at
 * build time and `dynamicParams = false` means a path that is not a card is
 * a plain 404, exactly as it was before this route existed.
 *
 * This page is deliberately a SERVER component with no state, no fetch and
 * no client JavaScript of its own: everything on it is a link. That is what
 * makes it survive a bad day — it is a file on a CDN.
 *
 * The slug is short (`/farhan`, not `/c/farhan`) because a card is read
 * aloud across a table and typed with a thumb. The collision risk that the
 * `/c/` namespace would have removed by convention is removed instead by
 * tests/business-cards.mjs, which fails the BUILD if a slug ever matches a
 * real route or a reserved word.
 */

export const dynamicParams = false;

export function generateStaticParams(): Array<{ card: string }> {
  return TEAM.map((m) => ({ card: m.slug }));
}

interface Props {
  params: Promise<{ card: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { card } = await params;
  const m = cardBySlug(card);
  if (!m) return {};

  const title = `${m.name} — ${m.role}`;
  const description = `${m.role}, ${SITE_CONFIG.name}. Save the contact, call, WhatsApp or email ${m.known} directly.`;
  const url = `/${m.slug}`;
  const og = `/cards/${m.slug}-og.png`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      url: `${SITE_CONFIG.url}${url}`,
      siteName: SITE_CONFIG.name,
      title,
      description,
      locale: SITE_CONFIG.locale,
      /* Forwarding the link in WhatsApp has to show a face and a name, not a
         bare URL. This is how a card actually spreads. */
      images: [{ url: og, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [og] },
  };
}

const MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  SITE_CONFIG.address,
)}`;

const ELSEWHERE = [
  { href: "/services", label: "What we do", note: "Creative, digital and live commerce" },
  { href: "/packages", label: "Packages", note: "Where most clients start" },
  { href: "/portfolio", label: "Work", note: "Campaigns and live sessions" },
  { href: "/contact", label: "Contact the office", note: "Enquiries, quotes, visits" },
] as const;

export default async function BusinessCardPage({ params }: Props) {
  const { card } = await params;
  const m = cardBySlug(card);
  if (!m) notFound();

  const cardUrl = `${SITE_CONFIG.url}/${m.slug}`;
  const waHref = `https://wa.me/${m.mobileE164.replace(/[^0-9]/g, "")}`;

  /* schema.org Person. A card page is exactly the thing this type exists for,
     and it is what lets a search result show the role rather than guessing. */
  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${cardUrl}#person`,
    name: m.name,
    alternateName: m.known,
    jobTitle: m.role,
    email: m.email,
    telephone: m.mobileE164,
    url: cardUrl,
    worksFor: { "@id": `${SITE_CONFIG.url}/#organization` },
  };

  return (
    <main className="bg-background text-foreground min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />

      {/* The card face. Navy and gold, the same object as the paper. */}
      <header className="bg-brand text-white">
        <div className="mx-auto w-full max-w-xl px-6 pt-12 pb-10 sm:pt-16">
          <Link
            href="/"
            className="text-gold text-[11px] font-medium tracking-[0.3em] uppercase"
          >
            {SITE_CONFIG.name}
          </Link>

          <div className="mt-8 flex items-center gap-5">
            {m.photo ? (
              <img
                src={m.photo}
                alt={m.name}
                className="border-gold/40 h-20 w-20 shrink-0 rounded-full border object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="border-gold/40 text-gold flex h-20 w-20 shrink-0 items-center justify-center rounded-full border text-2xl font-semibold tracking-wide"
              >
                {cardMonogram(m)}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
                {m.name}
              </h1>
              <p className="text-gold mt-2 text-sm font-medium">{m.role}</p>
              <p className="mt-1 text-sm text-white/60">{m.known}</p>
            </div>
          </div>

          <p className="mt-6 text-sm leading-relaxed text-white/70">{m.lead}</p>

          {/* The headline feature: a real vCard, not a picture of a card. */}
          <a
            href={`/cards/${m.slug}.vcf`}
            download={`${m.slug}-a2z.vcf`}
            className="bg-gold focus-visible:outline-gold mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-lg px-6 text-sm font-medium text-black transition-colors hover:bg-gold/85 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Save to contacts
          </a>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <a
              href={`tel:${m.mobileE164}`}
              className="flex h-12 items-center justify-center gap-2 rounded-lg border border-white/20 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call
            </a>
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-lg border border-white/20 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              WhatsApp
            </a>
            <a
              href={`mailto:${m.email}`}
              className="flex h-12 items-center justify-center gap-2 rounded-lg border border-white/20 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              Email
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-6 py-12">
        {/* Everything printed on the paper, in the same order it is read. */}
        <section>
          <h2 className="text-muted-foreground text-[11px] font-medium tracking-[0.3em] uppercase">
            Direct
          </h2>
          {/* Label above value, and the value wraps. A long address on one line
              with the label beside it truncated izzudin.amdan@... on a phone,
              which is a contact detail the page exists to hand over. */}
          <dl className="border-border divide-border mt-4 divide-y rounded-xl border">
            <div className="flex flex-col gap-1 px-4 py-3">
              <dt className="text-muted-foreground text-xs">Mobile</dt>
              <dd>
                <a href={`tel:${m.mobileE164}`} className="text-sm font-medium">
                  {m.mobile}
                </a>
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-4 py-3">
              <dt className="text-muted-foreground text-xs">Email</dt>
              <dd>
                <a href={`mailto:${m.email}`} className="text-sm font-medium break-all">
                  {m.email}
                </a>
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-4 py-3">
              <dt className="text-muted-foreground text-xs">Office</dt>
              <dd>
                <a
                  href={`mailto:${CARD_COMPANY.email}`}
                  className="text-sm font-medium break-all"
                >
                  {CARD_COMPANY.email}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="text-muted-foreground text-[11px] font-medium tracking-[0.3em] uppercase">
            Visit
          </h2>
          <a
            href={MAP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border mt-4 flex items-start gap-3 rounded-xl border px-4 py-4"
          >
            <MapPin className="text-gold-deep mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {/* One source of truth: this is the address that prints on every
                invoice this company issues (lib/issuers.ts feeds it). */}
            <span className="text-sm leading-relaxed">{SITE_CONFIG.address}</span>
          </a>
        </section>

        <section className="mt-10">
          <h2 className="text-muted-foreground text-[11px] font-medium tracking-[0.3em] uppercase">
            A2Z Creative Marketing
          </h2>
          <ul className="border-border divide-border mt-4 divide-y rounded-xl border">
            {ELSEWHERE.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="flex flex-col gap-0.5 px-4 py-3">
                  <span className="text-sm font-medium">{l.label}</span>
                  <span className="text-muted-foreground text-xs">{l.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* For when the cards run out: show the screen, let them scan it. */}
        <section className="mt-10 text-center">
          <img
            src={`/cards/${m.slug}-qr.png`}
            alt={`QR code for ${cardUrl}`}
            width={180}
            height={180}
            className="border-border mx-auto h-[180px] w-[180px] rounded-xl border bg-white p-3"
          />
          <p className="text-muted-foreground mt-3 text-xs">
            Out of cards? Show this.
          </p>
          <p className="mt-1 text-xs font-medium">{cardUrl.replace("https://", "")}</p>
        </section>

        <footer className="border-border text-muted-foreground mt-12 border-t pt-6 text-center text-xs">
          <p>{SITE_CONFIG.legalName}</p>
          <p className="mt-1">{SITE_CONFIG.brandTagline}</p>
        </footer>
      </div>
    </main>
  );
}
