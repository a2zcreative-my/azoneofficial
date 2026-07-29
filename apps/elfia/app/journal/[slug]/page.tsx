import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { JOURNAL_POSTS } from "@/constants/catalogue";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return JOURNAL_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = JOURNAL_POSTS.find((p) => p.slug === slug);
  if (!post) return { title: "Journal" };
  return { title: post.title, description: post.excerpt };
}

export default async function JournalPostPage({ params }: Props) {
  const { slug } = await params;
  const post = JOURNAL_POSTS.find((p) => p.slug === slug);
  if (!post) notFound();

  return (
    <>
      <Navbar />
      <PageShell
        eyebrow="Journal"
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
