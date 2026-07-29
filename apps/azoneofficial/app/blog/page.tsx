import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import Link from "next/link";

import { PageShell } from "@azone/ui";
import { BLOG_POSTS } from "@/constants/pages";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical notes on live commerce in Malaysia from the AZ ONE OFFICIAL team.",
};

export default function BlogPage() {
  return (
    <>
      <Navbar />
      <PageShell
      eyebrow="Blog"
      title="Notes from the live room"
      intro="Practical notes on live commerce in Malaysia — what we learn running sessions, written for brand owners."
    >
      <section className="grid gap-6 sm:grid-cols-2">
        {BLOG_POSTS.map((post) => (
          <article key={post.slug} className="flex h-full flex-col rounded-xl border border-border p-6">
            <p className="text-muted-foreground text-xs">
              {new Date(post.date).toLocaleDateString("en-MY", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}{" "}
              · {post.readMinutes} min read
            </p>
            <h2 className="mt-2 text-lg font-semibold text-foreground">
              <Link href={`/blog/${post.slug}`} className="hover:underline">
                {post.title}
              </Link>
            </h2>
            <p className="mt-2 grow text-sm">{post.excerpt}</p>
            <Link
              href={`/blog/${post.slug}`}
              className="text-gold-deep mt-3 inline-block text-sm font-medium hover:underline"
            >
              Read more →
            </Link>
          </article>
        ))}
      </section>
      </PageShell>
      <Footer />
    </>
  );
}
