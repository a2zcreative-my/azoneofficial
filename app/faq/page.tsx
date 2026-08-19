import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";
import { FaqList } from "@/components/ui/faq-list";
import { whatsappUrl } from "@/constants/content";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Common questions about A2Z Creative Marketing's services, packages, and how an engagement works.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <PageShell
      eyebrow="FAQ"
      title="Before you ask"
      intro="The questions brands ask us most, answered straight."
    >
      <section>
        <FaqList />
        <p className="mt-8 text-sm">
          Still have a question?{" "}
          <a
            href={whatsappUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            Ask us directly on WhatsApp
          </a>
          .
        </p>
      </section>
    </PageShell>
  );
}
