"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Section } from "@/components/layout/section";
import { FAQS } from "@/constants/content";
import { cn } from "@/lib/utils";

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <Section
      id="faq"
      eyebrow="FAQ"
      title="Before you ask"
      intro="The questions brands ask us most, answered straight."
    >
      <div className="mx-auto max-w-3xl divide-y divide-border border-y border-border">
        {FAQS.map((item, i) => {
          const isOpen = openIndex === i;
          const panelId = `faq-panel-${i}`;
          const buttonId = `faq-button-${i}`;
          return (
            <div key={item.question}>
              <h3>
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-medium"
                >
                  {item.question}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "h-5 w-5 shrink-0 transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
              </h3>
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                hidden={!isOpen}
                className="pb-5"
              >
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {item.answer}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
