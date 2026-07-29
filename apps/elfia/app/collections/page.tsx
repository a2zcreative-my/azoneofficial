import Link from "next/link";
import type { Metadata } from "next";

import { PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { COLLECTIONS } from "@/constants/catalogue";

export const metadata: Metadata = {
  title: "Collections",
  description:
    "ELFIA collections — Signature, Corporate, and Active. One fabric philosophy, three ways to wear it.",
};

export default function CollectionsPage() {
  return (
    <>
      <Navbar />
      <PageShell
        eyebrow="Collections"
        title="One fabric philosophy, three ways to wear it"
        intro="It has to fall well, cover properly, and still look right at the end of a long day. Everything else follows from that."
      >
        <section>
          <ul className="grid gap-8 md:grid-cols-3">
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
                    <h2 className="font-display mt-2 text-xl">
                      {collection.name}
                    </h2>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      {collection.description}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </PageShell>
      <Footer />
    </>
  );
}
