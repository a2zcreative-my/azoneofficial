import { About } from "@/components/home/about";
import { Cta } from "@/components/home/cta";
import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
import { LiveShowcase } from "@/components/home/live-showcase";
import { Packages } from "@/components/home/packages";
import { Process } from "@/components/home/process";
import { Services } from "@/components/home/services";
import { Showcase } from "@/components/home/showcase";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <About />
        <Services />
        <Packages />
        <Showcase />
        <LiveShowcase />
        <Process />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
