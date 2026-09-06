import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CardView } from "@/components/cards/card-view";
import { SITE_CONFIG } from "@/constants/site";
import { TEAM, cardBySlug } from "@/constants/team";

/**
 * v1.71.0 — the digital business card (Track V).
 *
 * One route renders all three cards. `generateStaticParams` fixes the set at
 * build time and `dynamicParams = false` means a path that is not a card is
 * a plain 404, exactly as it was before this route existed.
 *
 * This page is deliberately a SERVER component with no fetch: it owns
 * generateStaticParams, generateMetadata and the schema.org block, none of
 * which can live in a component that holds state. That is what makes it
 * survive a bad day — it is a file on a CDN.
 *
 * v1.128.0 — the readable BODY moved into components/cards/card-view.tsx, a
 * client component, so the CEO's BM/EN switcher can change the language
 * without a reload. The page did not become a client page: everything above
 * stayed here, and what went down is one small script on a static file.
 *
 * The metadata below is MALAY, because Malay is what the card opens in and
 * these tags describe the page a client actually lands on. The Open Graph
 * image is Malay for the same reason (scripts/card-og.py, regenerated from
 * constants/team.ts).
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

  const title = `${m.name} — ${m.role.ms}`;
  const description = `${m.role.ms}, ${SITE_CONFIG.name}. Simpan kenalan, telefon, WhatsApp atau e-mel ${m.known.ms} terus.`;
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

export default async function BusinessCardPage({ params }: Props) {
  const { card } = await params;
  const m = cardBySlug(card);
  if (!m) notFound();

  const cardUrl = `${SITE_CONFIG.url}/${m.slug}`;

  /* schema.org Person. A card page is exactly the thing this type exists for,
     and it is what lets a search result show the role rather than guessing. */
  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${cardUrl}#person`,
    name: m.name,
    alternateName: m.known.ms,
    /* schema.org takes ONE jobTitle. It is the Malay one, matching the
       metadata, the vCard and the preview image — every one-string artefact
       on this card says the same thing. */
    jobTitle: m.role.ms,
    email: m.email,
    telephone: m.mobileE164,
    url: cardUrl,
    worksFor: { "@id": `${SITE_CONFIG.url}/#organization` },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <CardView m={m} />
    </>
  );
}
