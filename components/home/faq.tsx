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
      <FaqList />
    </Section>
  );
}
