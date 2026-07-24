import { About } from "@/components/home/about";
import { Cta } from "@/components/home/cta";
import { Elfia } from "@/components/home/elfia";
import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
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
        <Showcase />
        <Elfia />
        <Process />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
