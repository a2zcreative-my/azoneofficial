import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { FaqList, PageShell } from "@azone/ui";

import { FAQS, whatsappUrl } from "@/constants/content";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Common questions about AZ ONE OFFICIAL's live commerce services and the ELFIA brand.",
};

export default function FaqPage() {
  return (
    <>
      <Navbar />
      <PageShell
      eyebrow="FAQ"
      title="Before you ask"
      intro="The questions brands ask us most, answered straight."
    >
      <section>
        <FaqList items={FAQS} />
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
      <Footer />
    </>
  );
}
