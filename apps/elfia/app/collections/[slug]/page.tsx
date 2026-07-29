import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { COLLECTIONS, PRODUCTS } from "@/constants/catalogue";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return COLLECTIONS.map((collection) => ({ slug: collection.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const collection = COLLECTIONS.find((c) => c.slug === slug);
  if (!collection) return { title: "Collection" };
  return { title: collection.name, description: collection.description };
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const collection = COLLECTIONS.find((c) => c.slug === slug);
  if (!collection) notFound();

  const items = PRODUCTS.filter((p) => p.collection === collection.slug);

  return (
    <>
      <Navbar />
      <PageShell
        eyebrow={collection.tagline}
        title={collection.name}
        intro={collection.description}
      >
        <section>
          {items.length > 0 ? (
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((product) => (
                <li key={product.slug}>
                  <Link
                    href={`/products/${product.slug}`}
                    className="border-border hover:border-foreground/30 group block h-full overflow-hidden rounded-xl border transition-colors"
                  >
                    <div className="relative aspect-[4/5] w-full overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={product.imageSrc}
                        alt={product.imageAlt}
                        className="absolute inset-0 block h-full w-full object-cover object-center"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-5">
                      <h2 className="text-base font-semibold group-hover:underline">
                        {product.name}
                      </h2>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>Pieces in this collection are announced at our next live drop.</p>
          )}
        </section>
      </PageShell>
      <Footer />
    </>
  );
}
