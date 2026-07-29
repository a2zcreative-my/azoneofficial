import Link from "next/link";

import { Button, ButtonGroup, CoverflowGallery, Section } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { BRAND, whatsappUrl } from "@/constants/brand";
import { COLLECTIONS, DROP_STEPS, PRODUCTS } from "@/constants/catalogue";

export default function HomePage() {
  const galleryItems = PRODUCTS.map((product) => ({
    id: product.slug,
    href: `/products/${product.slug}`,
    imageSrc: product.imageSrc,
    imageAlt: product.imageAlt,
    label: product.name,
    badge: COLLECTIONS.find((c) => c.slug === product.collection)?.tagline,
  }));

  return (
    <>
      <Navbar />
      <main className="pt-16">
        {/* Hero — the slogan leads, its English meaning sits beneath it */}
        <section className="bg-brand text-brand-neutral">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-28">
            <div>
              <h1 className="font-display text-5xl tracking-[0.18em] sm:text-7xl">
                {BRAND.name}
              </h1>
              <p className="text-gold mt-5 text-lg tracking-[0.1em] italic">
                {BRAND.slogan}
              </p>
              <p className="mt-2 text-sm opacity-60 italic">
                {BRAND.strapline}
              </p>
              <p className="mt-8 max-w-md text-base leading-relaxed opacity-80">
                Premium chiffon hijabs in essential neutrals, designed in
                Malaysia for office, everyday, and active wear. Every drop
                launches live, so you see the fabric move before you ever tap
                checkout.
              </p>
              <div className="mt-10">
                <ButtonGroup>
                  <Button href="/products" variant="gold">
                    Shop the shawls
                  </Button>
                  <Button href="/live" variant="outlineLight">
                    Next live drop
                  </Button>
                </ButtonGroup>
              </div>
            </div>

            <CoverflowGallery items={galleryItems} />
          </div>
        </section>

        <Section
          id="collections"
          eyebrow="Collections"
          title="Made for how you actually wear it"
          intro="Three collections, one fabric philosophy: it has to fall well, cover properly, and still look right at the end of a long day."
        >
          <ul className="grid gap-6 md:grid-cols-3">
            {COLLECTIONS.map((collection) => (
              <li key={collection.slug}>
                <Link
                  href={`/collections/${collection.slug}`}
                  className="border-border hover:border-foreground/30 group block h-full overflow-hidden rounded-xl border transition-colors"
                >
                  <div className="relative aspect-[4/5] w-full overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={collection.imageSrc}
                      alt={collection.imageAlt}
                      className="absolute inset-0 block h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none"
                      loading="lazy"
                    />
                  </div>
                  <div className="p-5">
                    <p className="text-gold-deep text-xs tracking-[0.28em] uppercase">
                      {collection.tagline}
                    </p>
                    <h3 className="font-display mt-2 text-xl">
                      {collection.name}
                    </h3>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {collection.description}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="how-it-works"
          eyebrow="How a drop works"
          title="Buying live, explained"
          intro="If you have never bought during a live session, here is exactly what happens — no guesswork."
        >
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {DROP_STEPS.map((item) => (
              <li
                key={item.step}
                className="border-border rounded-xl border p-5"
              >
                <span className="text-gold-deep text-xs font-semibold tracking-[0.3em]">
                  {item.step}
                </span>
                <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {item.description}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-10">
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
          </div>
        </Section>
      </main>
      <Footer />
    </>
  );
}
