import type { Metadata } from "next";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { CONTACT, ELFIA, ELFIA_PRODUCTS, whatsappUrl } from "@/constants/content";

export const metadata: Metadata = {
  title: "ELFIA",
  description:
    "ELFIA — AZ ONE OFFICIAL's premium hijab brand: chiffon shawls in essential neutrals, launched live on TikTok.",
};

export default function ProductsPage() {
  return (
    <>
      <Navbar />
      <main className="bg-brand pt-16 text-white">
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <header className="max-w-2xl">
            <p className="text-gold mb-3 text-xs font-medium tracking-[0.3em] uppercase">
              {ELFIA.eyebrow}
            </p>
            <h1 className="text-5xl font-semibold tracking-[0.15em] sm:text-6xl">
              {ELFIA.title}
            </h1>
            <p className="text-gold mt-3 text-sm tracking-[0.2em] uppercase">
              {ELFIA.tagline}
            </p>
            <p className="mt-6 text-base leading-relaxed text-white/70">
              {ELFIA.body}
            </p>
          </header>

          <section className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3">
            {ELFIA_PRODUCTS.map((product) => (
              <article key={product.name} className="group">
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
                  <span className="absolute top-4 left-4 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-black">
                    {product.category}
                  </span>
                </div>
                <h2 className="mt-4 text-base font-medium">{product.name}</h2>
              </article>
            ))}
          </section>

          <section className="mt-16 max-w-2xl">
            <h2 className="text-xl font-semibold tracking-tight">
              Where to buy
            </h2>
            <p className="mt-3 text-base leading-relaxed text-white/70">
              ELFIA drops are launched and sold during our TikTok Live
              sessions — prices and availability are announced live, and
              limited pieces sell out in-session. Follow us so you never miss a
              drop.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href={CONTACT.socials.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gold hover:bg-gold/85 inline-flex h-12 items-center justify-center rounded-full px-8 text-sm font-medium text-black transition-colors"
              >
                {ELFIA.cta}
              </a>
              <a
                href={whatsappUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 px-8 text-sm font-medium text-white transition-colors hover:bg-white/10"
              >
                Ask about ELFIA on WhatsApp
              </a>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
