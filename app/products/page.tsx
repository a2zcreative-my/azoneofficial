import Link from "next/link";
import type { Metadata } from "next";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ElfiaGallery } from "@/components/ui/elfia-gallery";
import {
  CONTACT,
  ELFIA,
  ELFIA_DROP_STEPS,
  ELFIA_PRODUCTS,
  whatsappUrl,
} from "@/constants/content";

export const metadata: Metadata = {
  title: "ELFIA",
  description:
    "ELFIA — Dekat Di Mata, Menarik Di Hati. At First Sight. Forever in Your Heart. AZ ONE OFFICIAL's premium hijab brand: chiffon shawls in essential neutrals, launched live on TikTok.",
};

export default function ProductsPage() {
  return (
    <>
      <Navbar />
      <main className="bg-brand pt-16 text-white">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-24">
          <header className="max-w-2xl">
            <p className="text-gold mb-3 text-xs font-medium tracking-[0.3em] uppercase">
              {ELFIA.eyebrow}
            </p>
            <h1 className="text-4xl font-semibold tracking-[0.12em] sm:text-6xl sm:tracking-[0.15em]">
              {ELFIA.title}
            </h1>
            <p className="text-gold mt-3 text-base tracking-[0.14em] italic">
              {ELFIA.slogan}
            </p>
            <p className="mt-2 text-sm text-white/55 italic">
              {ELFIA.tagline}
            </p>
            <p className="mt-6 text-base leading-relaxed text-white/70">
              {ELFIA.body}
            </p>
          </header>

          {/* Coverflow gallery — centre card links to its detail page */}
          <section className="mt-16" aria-label="Product gallery">
            <ElfiaGallery products={ELFIA_PRODUCTS} />
          </section>

          {/* Direct links to every detail page (the carousel shows one at a time) */}
          <section className="mt-16" aria-label="All products">
            <h2 className="text-xl font-semibold tracking-tight">
              Explore the range
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ELFIA_PRODUCTS.map((product) => (
                <li key={product.slug}>
                  <Link
                    href={`/products/${product.slug}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/15 px-5 py-4 transition-colors hover:border-white/40 hover:bg-white/5"
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {product.name}
                      </span>
                      <span className="text-gold mt-0.5 block text-xs tracking-wide uppercase">
                        {product.category}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-white/50">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/*
            Buying live is unfamiliar to many shoppers. Spelling out the
            sequence answers "what actually happens if I show up?" — the
            hesitation that stops people joining a session at all.
          */}
          <section className="mt-16" aria-labelledby="how-drops-work">
            <h2
              id="how-drops-work"
              className="text-xl font-semibold tracking-tight"
            >
              How an ELFIA drop works
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {ELFIA_DROP_STEPS.map((item) => (
                <li
                  key={item.step}
                  className="rounded-xl border border-white/10 bg-white/5 p-5"
                >
                  <span className="text-gold text-xs font-semibold tracking-[0.3em]">
                    {item.step}
                  </span>
                  <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">
                    {item.description}
                  </p>
                </li>
              ))}
            </ol>
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
            <div className="mt-6">
                <ButtonGroup>
              <Button href={CONTACT.socials.tiktok} external variant="gold">
                {ELFIA.cta}
              </Button>
              <Button
                href={whatsappUrl("Hi AZ ONE, please add me to the ELFIA drop alerts.")}
                external
                variant="outlineLight"
              >
                Get drop alerts on WhatsApp
              </Button>
            </ButtonGroup>
              </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
