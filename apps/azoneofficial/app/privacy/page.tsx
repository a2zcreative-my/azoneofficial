import type { Metadata } from "next";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

import { PageShell } from "@azone/ui";
import { CONTACT } from "@/constants/content";
import { SITE_CONFIG } from "@/constants/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How AZ ONE OFFICIAL collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <PageShell eyebrow="Legal" title="Privacy Policy" updated="24 July 2026">
      <section>
        <p>
          {SITE_CONFIG.legalName} ("AZ ONE OFFICIAL", "we", "us") respects your
          privacy. This policy explains what personal data we collect through
          this website and our services, how we use it, and the choices you
          have. We process personal data in line with the Personal Data
          Protection Act 2010 (PDPA) of Malaysia.
        </p>
      </section>

      <section>
        <h2>Data we collect</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Contact details you send us — such as your name, company, phone
            number, and email — when you message us on WhatsApp, email us, or
            submit an enquiry.
          </li>
          <li>
            Business information you share with us during consultations about
            your brand, products, and sales channels.
          </li>
          <li>
            Basic technical data collected automatically when you visit this
            website, such as pages viewed and approximate location, used in
            aggregate to understand how the site is used.
          </li>
        </ul>
      </section>

      <section>
        <h2>How we use your data</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>To respond to your enquiries and provide our services.</li>
          <li>To prepare proposals and manage our engagement with you.</li>
          <li>To improve this website and our services.</li>
          <li>
            To send you information about our services, where you have agreed
            to receive it. You can opt out at any time.
          </li>
        </ul>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>
          We do not sell your personal data. We share it only with service
          providers who help us operate (such as hosting and analytics
          providers), where required by law, or with your consent.
        </p>
      </section>

      <section>
        <h2>Retention and security</h2>
        <p>
          We keep personal data only as long as needed for the purposes above
          or as required by law, and we take reasonable technical and
          organisational measures to protect it.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Under the PDPA, you may request access to or correction of your
          personal data, and withdraw consent to its processing. To exercise
          these rights, contact us at{" "}
          <a href={`mailto:${CONTACT.email}`} className="text-foreground underline">
            {CONTACT.email}
          </a>{" "}
          or via WhatsApp.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          We may update this policy from time to time. The latest version will
          always be published on this page with its updated date.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          {SITE_CONFIG.legalName}
          <br />
          {SITE_CONFIG.address}
        </p>
      </section>
      </PageShell>
      <Footer />
    </>
  );
}
