import { About } from "@/components/home/about";
import { Cta } from "@/components/home/cta";
import { Faq } from "@/components/home/faq";
import { Hero } from "@/components/home/hero";
import { LiveShowcase } from "@/components/home/live-showcase";
import { Packages } from "@/components/home/packages";
import { Problems } from "@/components/home/problems";
import { Process } from "@/components/home/process";
import { Services } from "@/components/home/services";
import { Showcase } from "@/components/home/showcase";
import { Work } from "@/components/home/work";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main>
        {/* v1.197.0 - the owner's mockup order: the hero, the services and
            selected work first; then who we are, the problems we solve, live
            commerce and its channels, the packages, the process, the
            questions and the final call to action - each kept short on a
            phone (swipe rows, the first About paragraph). */}
        <Hero />
        <Services />
        <Work />
        <About />
        <Problems />
        <Showcase />
        <LiveShowcase />
        <Packages />
        <Process />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
