import Link from "next/link";
import type { Metadata } from "next";

import { PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { JOURNAL_POSTS } from "@/constants/catalogue";

export const metadata: Metadata = {
  title: "Journal",
  description:
    "Styling notes and fabric thinking from ELFIA — how to wear chiffon, and why it falls the way it does.",
};

export default function JournalPage() {
  return (
    <>
      <Navbar />
      <PageShell
        eyebrow="Journal"
        title="Styling notes"
        intro="Short pieces on wearing chiffon well — written by the people who style it on camera every week."
      >
        <section>
          <ul className="grid gap-6 sm:grid-cols-2">
            {JOURNAL_POSTS.map((post) => (
              <li key={post.slug}>
                <article className="border-border flex h-full flex-col rounded-xl border p-6">
                  <time
                    dateTime={post.date}
                    className="text-muted-foreground text-xs tracking-[0.2em] uppercase"
                  >
                    {new Date(post.date).toLocaleDateString("en-MY", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </time>
                  <h2 className="font-display mt-3 text-xl">
                    <Link href={`/journal/${post.slug}`} className="hover:underline">
                      {post.title}
                    </Link>
                  </h2>
                  <p className="text-muted-foreground mt-2 grow text-sm leading-relaxed">
                    {post.excerpt}
                  </p>
                  <Link
                    href={`/journal/${post.slug}`}
                    className="mt-5 text-sm font-medium hover:underline"
                  >
                    Read →
                  </Link>
                </article>
              </li>
            ))}
          </ul>
        </section>
      </PageShell>
      <Footer />
    </>
  );
}
