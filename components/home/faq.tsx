import Link from "next/link";

import { Section } from "@/components/layout/section";
import { FaqList } from "@/components/ui/faq-list";

export function Faq() {
  return (
    <Section
      id="faq"
      eyebrow="FAQ"
      title="Before you ask"
      intro="The questions brands ask us most, answered straight."
    >
      <FaqList limit={5} />
      <p className="text-muted-foreground mt-6 text-sm">
        <Link href="/faq" className="text-foreground font-medium underline">
          See all questions
        </Link>{" "}
        — including pricing, session length, studio, and on-site sessions.
      </p>
    </Section>
  );
}
