import { Section } from "@/components/layout/section";
import { Reveal } from "@/components/ui/reveal";
import { CONTACT, ELFIA, ELFIA_PRODUCTS } from "@/constants/content";
import type { ElfiaProduct } from "@/types";

function ProductCard({ product }: { product: ElfiaProduct }) {
  return (
    <article className="group">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-white/10 bg-white/5">
        {product.imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageSrc}
            alt={product.imageAlt}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            role="img"
            aria-label={product.imageAlt}
            className="flex h-full w-full items-center justify-center"
          >
            <span className="text-gold text-5xl font-light tracking-[0.3em]">
              E
            </span>
          </div>
        )}
        <span className="text-foreground absolute top-4 left-4 rounded-full bg-white/90 px-3 py-1 text-xs font-medium">
          {product.category}
        </span>
      </div>
      <h3 className="mt-4 text-base font-medium">{product.name}</h3>
    </article>
  );
}

export function Elfia() {
  return (
    <Section id="elfia" dark>
      <div className="grid gap-12 lg:grid-cols-5 lg:gap-16">
        <div className="lg:col-span-2">
          <Reveal>
            <p className="text-gold mb-3 text-xs font-medium tracking-[0.3em] uppercase">
              {ELFIA.eyebrow}
            </p>
            <h2 className="text-5xl font-semibold tracking-[0.15em] sm:text-6xl">
              {ELFIA.title}
            </h2>
            <p className="text-gold mt-3 text-sm tracking-[0.2em] uppercase">
              {ELFIA.tagline}
            </p>
            <p className="mt-6 max-w-md text-base leading-relaxed text-white/70">
              {ELFIA.body}
            </p>
            <a
              href={CONTACT.socials.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-gold hover:bg-gold/85 mt-8 inline-flex h-12 items-center rounded-full px-8 text-sm font-medium text-black transition-colors"
            >
              {ELFIA.cta}
            </a>
          </Reveal>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 lg:col-span-3">
          {ELFIA_PRODUCTS.map((product, i) => (
            <Reveal key={product.name} delay={i * 0.1}>
              <ProductCard product={product} />
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
