import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/layout/page-shell";
import { BLOG_POSTS } from "@/constants/pages";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical notes on marketing and live commerce in Malaysia from the A2Z Creative Marketing team.",
  alternates: { canonical: "/blog" },
};

export default function BlogPage() {
  return (
    <PageShell
      eyebrow="Blog"
      title="Notes from the live room"
      intro="Practical notes on live commerce in Malaysia — what we learn running sessions, written for brand owners."
    >
      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {BLOG_POSTS.map((post) => (
          <article key={post.slug} className="flex h-full flex-col rounded-xl border border-border p-6">
            <p className="text-muted-foreground text-xs">
              {post.date.slice(0, 10).split("-").reverse().join("-")}{" "}
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
  );
}
