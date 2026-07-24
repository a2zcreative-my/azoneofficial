import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/layout/page-shell";
import { BLOG_POSTS } from "@/constants/pages";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical notes on live commerce in Malaysia from the AZ ONE OFFICIAL team.",
};

export default function BlogPage() {
  return (
    <PageShell eyebrow="Blog" title="Notes from the live room">
      <section className="space-y-6">
        {BLOG_POSTS.map((post) => (
          <article key={post.slug} className="rounded-xl border border-border p-6">
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
            <p className="mt-2 text-sm">{post.excerpt}</p>
            <Link
              href={`/blog/${post.slug}`}
              className="text-gold mt-3 inline-block text-sm font-medium hover:underline"
            >
              Read more →
            </Link>
          </article>
        ))}
      </section>
    </PageShell>
  );
}
