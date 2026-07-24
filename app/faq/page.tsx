import type { Metadata } from "next";

import { Faq } from "@/components/home/faq";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

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
      </main>
      <Footer />
    </>
  );
}
