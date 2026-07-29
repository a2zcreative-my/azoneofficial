import { Button, PageShell } from "@azone/ui";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

export default function NotFound() {
  return (
    <>
      <Navbar />
      <PageShell
        eyebrow="404"
        title="This page has moved on"
        intro="The piece or page you were looking for is not here. The full range is one tap away."
      >
        <section>
          <Button href="/products">Browse the shawls</Button>
        </section>
      </PageShell>
      <Footer />
    </>
  );
}
