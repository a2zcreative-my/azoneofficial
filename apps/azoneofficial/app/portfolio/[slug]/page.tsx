import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Button, ButtonGroup, PageShell } from "@azone/ui";
import { breadcrumbJsonLd } from "@azone/seo";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { CASE_STUDIES, whatsappUrl } from "@/constants/content";
import { SEO } from "@/constants/seo";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return CASE_STUDIES.map((study) => ({ slug: study.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const study = CASE_STUDIES.find((s) => s.slug === slug);
  if (!study) return { title: "Case study" };
  return {
    title: `${study.client} — case study`,
    description: study.summary,
    openGraph: { images: [{ url: study.heroImage, alt: study.heroImageAlt }] },
  };
}

export default async function CaseStudyPage({ params }: Props) {
  const { slug } = await params;
  const study = CASE_STUDIES.find((s) => s.slug === slug);
  if (!study) notFound();

  const jsonLd = breadcrumbJsonLd(SEO, [
    { name: "Portfolio", path: "/portfolio" },
    { name: study.client, path: `/portfolio/${study.slug}` },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />

      <div className="border-border bg-secondary/30 border-b pt-16">
        <nav
          aria-label="Breadcrumb"
          className="mx-auto w-full max-w-6xl px-6 py-3.5"
        >
          <ol className="flex items-center gap-2 text-sm">
            <li>
              <Link
                href="/portfolio"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Portfolio
              </Link>
            </li>
            <li aria-hidden="true" className="text-muted-foreground/50">
              /
            </li>
            <li aria-current="page" className="min-w-0 truncate font-medium">
              {study.client}
            </li>
          </ol>
        </nav>
      </div>

      <PageShell
        eyebrow={study.industry}
        title={study.client}
        intro={study.summary}
      >
        <section>
          <div className="border-border overflow-hidden rounded-xl border">
            <div className="relative aspect-[16/9] w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={study.heroImage}
                alt={study.heroImageAlt}
                className="absolute inset-0 block h-full w-full object-cover object-center"
              />
            </div>
          </div>
        </section>

        <section>
          <h2>The challenge</h2>
          {study.challenge.map((paragraph) => (
            <p key={paragraph} className="mt-3">
              {paragraph}
            </p>
          ))}
        </section>

        <section>
          <h2>What we did</h2>
          {study.solution.map((paragraph) => (
            <p key={paragraph} className="mt-3">
              {paragraph}
            </p>
          ))}
          <ul className="mt-6 flex flex-wrap gap-2">
            {study.services.map((service) => (
              <li
                key={service}
                className="bg-brand text-gold rounded-md px-3 py-1.5 text-xs font-medium"
              >
                {service}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Results</h2>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {study.results.map((result) => (
              <li
                key={result.label}
                className="border-border flex h-full flex-col rounded-xl border p-5"
              >
                <p className="text-base font-semibold">{result.label}</p>
                <p className="mt-2 text-sm leading-relaxed">{result.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        {study.quote && (
          <section>
            <blockquote className="border-gold-deep/50 border-l-2 pl-5">
              <p className="text-lg leading-relaxed italic">
                &ldquo;{study.quote.text}&rdquo;
              </p>
              <footer className="text-muted-foreground mt-2 text-sm">
                — {study.quote.attribution}
              </footer>
            </blockquote>
          </section>
        )}

        <section>
          <h2>Want a channel like this?</h2>
          <p className="mt-3 mb-6">
            Every engagement starts with a free live audit. Tell us about your
            products and we will tell you honestly whether live is worth it.
          </p>
          <ButtonGroup>
            <Button href={whatsappUrl()} external>
              Get a free live audit
            </Button>
            {study.website && (
              <Button href={study.website} external variant="outline">
                Visit {study.client}
              </Button>
            )}
          </ButtonGroup>
        </section>
      </PageShell>
      <Footer />
    </>
  );
}
