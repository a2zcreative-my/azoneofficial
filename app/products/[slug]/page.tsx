import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { CONTACT, ELFIA_PRODUCTS, whatsappUrl } from "@/constants/content";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return ELFIA_PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = ELFIA_PRODUCTS.find((p) => p.slug === slug);
  if (!product) return {};
  return {
    title: `${product.name} — ELFIA`,
    description: product.description,
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = ELFIA_PRODUCTS.find((p) => p.slug === slug);
  if (!product) notFound();

  const gallery = product.gallery ?? [product.imageSrc];

  return (
    <>
      <Navbar />
      <main className="bg-brand pt-16 text-white">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
          <nav aria-label="Breadcrumb" className="text-sm text-white/50">
            <Link href="/products" className="hover:text-white">
              ELFIA
            </Link>{" "}
            / <span className="text-white/80">{product.name}</span>
          </nav>

          <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="grid grid-cols-2 gap-4">
              {gallery.map((src, i) => (
                <div
                  key={src}
                  className={
                    i === 0 && gallery.length > 1
                      ? "col-span-2 overflow-hidden rounded-xl border border-white/10"
                      : "overflow-hidden rounded-xl border border-white/10"
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={product.imageAlt}
                    className="h-full w-full object-cover"
                    loading={i === 0 ? "eager" : "lazy"}
                  />
                </div>
              ))}
            </div>

            <div>
              <p className="text-gold text-xs font-medium tracking-[0.3em] uppercase">
                {product.category}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                {product.name}
              </h1>
              <p className="mt-5 text-base leading-relaxed text-white/70">
                {product.description}
              </p>

              <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-5">
                <p className="text-sm font-medium">Price announced live</p>
                <p className="mt-1 text-sm text-white/60">
                  ELFIA pieces are launched and priced during our TikTok Live
                  drops — limited quantities, first come first served.
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button href={CONTACT.socials.tiktok} external variant="gold">
                  Watch the next drop live
                </Button>
                <Button href={whatsappUrl()} external variant="outlineLight">
                  Ask on WhatsApp
                </Button>
              </div>

              <div className="mt-10">
                <h2 className="text-sm font-semibold tracking-[0.2em] uppercase text-white/60">
                  More from ELFIA
                </h2>
                <ul className="mt-3 space-y-1.5">
                  {ELFIA_PRODUCTS.filter((p) => p.slug !== product.slug)
                    .slice(0, 3)
                    .map((p) => (
                      <li key={p.slug}>
                        <Link
                          href={`/products/${p.slug}`}
                          className="text-sm text-white/70 hover:text-white hover:underline"
                        >
                          {p.name}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
