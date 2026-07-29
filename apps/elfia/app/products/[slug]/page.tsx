import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { breadcrumbJsonLd } from "@azone/seo";
import { Button, ButtonGroup, ProductGallery } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { BRAND, whatsappUrl } from "@/constants/brand";
import { COLLECTIONS, PRODUCTS } from "@/constants/catalogue";
import { SEO } from "@/constants/seo";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return PRODUCTS.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = PRODUCTS.find((p) => p.slug === slug);
  if (!product) return { title: "Shawl" };
  return {
    title: product.name,
    description: product.description,
    openGraph: {
      images: [{ url: product.imageSrc, alt: product.imageAlt }],
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = PRODUCTS.find((p) => p.slug === slug);
  if (!product) notFound();

  const gallery = product.gallery ?? [product.imageSrc];
  const collection = COLLECTIONS.find((c) => c.slug === product.collection);
  const others = PRODUCTS.filter((p) => p.slug !== product.slug).slice(0, 3);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: `${SEO.url}${product.imageSrc}`,
    brand: { "@type": "Brand", name: BRAND.name },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            jsonLd,
            breadcrumbJsonLd(SEO, [
              { name: "Shawls", path: "/products" },
              { name: product.name, path: `/products/${product.slug}` },
            ]),
          ]),
        }}
      />
      <Navbar />
      <main className="pt-16">
        <div className="border-border border-b">
          <nav
            aria-label="Breadcrumb"
            className="mx-auto w-full max-w-6xl px-6 py-3.5"
          >
            <ol className="flex items-center gap-2 text-sm">
              <li>
                <Link
                  href="/products"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Shawls
                </Link>
              </li>
              <li aria-hidden="true" className="text-muted-foreground/50">
                /
              </li>
              <li aria-current="page" className="min-w-0 truncate font-medium">
                {product.name}
              </li>
            </ol>
          </nav>
        </div>

        <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <ProductGallery images={gallery} alt={product.imageAlt} />

            <div>
              {collection && (
                <p className="text-gold-deep text-xs font-medium tracking-[0.3em] uppercase">
                  {collection.tagline}
                </p>
              )}
              <h1 className="font-display mt-3 text-3xl sm:text-4xl">
                {product.name}
              </h1>
              <p className="text-muted-foreground mt-5 text-base leading-relaxed">
                {product.description}
              </p>

              {product.details && product.details.length > 0 && (
                <dl className="border-border mt-8 divide-y divide-current/10 border-y">
                  {product.details.map((detail) => (
                    <div
                      key={detail.label}
                      className="flex justify-between gap-6 py-3 text-sm"
                    >
                      <dt className="text-muted-foreground">{detail.label}</dt>
                      <dd className="text-right font-medium">{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="bg-secondary mt-8 rounded-xl p-5">
                <p className="text-sm font-semibold">Price announced live</p>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                  ELFIA pieces are launched and priced during our live drops —
                  limited quantities, first come first served.
                </p>
              </div>

              <div className="mt-6">
                <ButtonGroup>
                  <Button href={BRAND.socials.tiktok} external>
                    Watch the next drop live
                  </Button>
                  <Button
                    href={whatsappUrl(
                      `Hi ELFIA, I'm interested in ${product.name}. When is the next drop?`,
                    )}
                    external
                    variant="outline"
                  >
                    Ask about this piece
                  </Button>
                </ButtonGroup>
              </div>

              <section className="mt-10">
                <h2 className="text-xs font-medium tracking-[0.3em] uppercase opacity-60">
                  More from ELFIA
                </h2>
                <ul className="mt-4 space-y-2">
                  {others.map((other) => (
                    <li key={other.slug}>
                      <Link
                        href={`/products/${other.slug}`}
                        className="text-sm hover:underline"
                      >
                        {other.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
