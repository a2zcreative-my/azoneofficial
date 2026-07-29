import Link from "next/link";
import type { Metadata } from "next";

import { Button, ButtonGroup, PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { BRAND, whatsappUrl } from "@/constants/brand";
import { COLLECTIONS, PRODUCTS } from "@/constants/catalogue";

export const metadata: Metadata = {
  title: "Shawls",
  description:
    "Every ELFIA piece — premium chiffon shawls in essential neutrals for office, everyday, and active wear.",
};

export default function ProductsPage() {
  return (
    <>
      <Navbar />
      <PageShell
        eyebrow="Shawls"
        title="The full range"
        intro="Prices are announced during our live drops — quantities are limited and pieces are first come, first served."
      >
        <section>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map((product) => (
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
                      className="absolute inset-0 block h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                      loading="lazy"
                    />
                    <span className="text-foreground absolute top-3 left-3 rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium">
                      {COLLECTIONS.find((c) => c.slug === product.collection)
                        ?.tagline ?? "ELFIA"}
                    </span>
                  </div>
                  <div className="p-5">
                    <h2 className="text-base font-semibold group-hover:underline">
                      {product.name}
                    </h2>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {product.description}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Where to buy</h2>
          <p className="mt-3 mb-6">
            ELFIA drops are launched and sold during our live sessions. Follow
            us so you never miss one, or message us and we will tell you what is
            coming next.
          </p>
          <ButtonGroup>
            <Button href={BRAND.socials.tiktok} external>
              Watch the next drop live
            </Button>
            <Button
              href={whatsappUrl("Hi ELFIA, please add me to the drop alerts.")}
              external
              variant="outline"
            >
              Get drop alerts on WhatsApp
            </Button>
          </ButtonGroup>
        </section>
      </PageShell>
      <Footer />
    </>
  );
}
