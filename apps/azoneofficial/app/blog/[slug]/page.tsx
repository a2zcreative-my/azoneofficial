import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { notFound } from "next/navigation";

import { PageShell } from "@azone/ui";
import { BLOG_POSTS } from "@/constants/pages";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) return {};
  return { title: post.title, description: post.excerpt };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((p) => p.slug === slug);
  if (!post) notFound();

  return (
    <>
      <Navbar />
      <PageShell
      eyebrow="Blog"
      title={post.title}
      updated={new Date(post.date).toLocaleDateString("en-MY", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}
    >
      <section className="space-y-5">
        {post.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </section>
      </PageShell>
      <Footer />
    </>
  );
}
