import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

import { PageShell } from "@azone/ui";
import { CONTACT } from "@/constants/content";
import { SITE_CONFIG } from "@/constants/site";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "Terms governing the use of the AZ ONE OFFICIAL website and services.",
};

export default function TermsPage() {
  return (
    <>
      <Navbar />
      <PageShell
      eyebrow="Legal"
      title="Terms & Conditions"
      updated="24 July 2026"
    >
      <section>
        <p>
          These terms govern your use of this website, operated by{" "}
          {SITE_CONFIG.legalName}. By using this website or engaging our
          services, you agree to these terms.
        </p>
      </section>

      <section>
        <h2>Our services</h2>
        <p>
          AZ ONE OFFICIAL provides live commerce services, including live host
          services, live commerce management, TikTok strategy, creative design,
          content creation, and business consultation. The scope, fees, and
          deliverables of any engagement are set out in the proposal or
          agreement issued for that engagement, which prevails over these
          general terms where they differ.
        </p>
      </section>

      <section>
        <h2>No guarantee of results</h2>
        <p>
          Live commerce performance depends on many factors outside our
          control, including platform algorithms, product pricing, and stock.
          Unless expressly agreed in writing, we do not guarantee any specific
          sales, viewership, or growth outcome.
        </p>
      </section>

      <section>
        <h2>Intellectual property</h2>
        <p>
          Content on this website — including the AZ ONE OFFICIAL and ELFIA
          names, logos, text, and images — belongs to {SITE_CONFIG.legalName}{" "}
          or its licensors and may not be used without permission. Rights in
          materials produced during an engagement are set out in that
          engagement's agreement.
        </p>
      </section>

      <section>
        <h2>Payments and cancellations</h2>
        <p>
          Payment terms, cancellation windows, and any refunds are stated in
          each engagement's proposal or invoice. Booked live sessions cancelled
          on short notice may be charged, as set out in the applicable
          proposal.
        </p>
      </section>

      <section>
        <h2>Liability</h2>
        <p>
          To the fullest extent permitted by Malaysian law, our total liability
          arising from any engagement is limited to the fees paid for that
          engagement, and we are not liable for indirect or consequential
          losses.
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of Malaysia, and the courts of
          Malaysia have jurisdiction over any dispute.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT.email}`} className="text-foreground underline">
            {CONTACT.email}
          </a>
          <br />
          {SITE_CONFIG.legalName}, {SITE_CONFIG.address}
        </p>
      </section>
      </PageShell>
      <Footer />
    </>
  );
}
