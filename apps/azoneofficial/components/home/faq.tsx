import Link from "next/link";
import { FAQS } from "@/constants/content";
import { FaqList, Section } from "@azone/ui";


export function Faq() {
  return (
    <Section
      id="faq"
      eyebrow="FAQ"
      title="Before you ask"
      intro="The questions brands ask us most, answered straight."
    >
      <FaqList items={FAQS} limit={5} />
      <p className="text-muted-foreground mt-6 text-sm">
        <Link href="/faq" className="text-foreground font-medium underline">
          See all questions
        </Link>{" "}
        — including pricing, session length, studio, and on-site sessions.
      </p>
    </Section>
  );
}
