import type { Metadata } from "next";

import { Faq } from "@/components/home/faq";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";
import { whatsappUrl } from "@/constants/content";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Common questions about AZ ONE OFFICIAL's live commerce services and the ELFIA brand.",
};

export default function FaqPage() {
  return (
    <>
      <Navbar />
      <main className="pt-16">
        <Faq />
        <p className="text-muted-foreground mx-auto max-w-3xl px-6 pb-16 text-sm">
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
      </main>
      <Footer />
    </>
  );
}
