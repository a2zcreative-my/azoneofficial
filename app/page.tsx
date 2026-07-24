import { SITE_CONFIG } from "@/constants/site";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-gold text-sm font-medium tracking-[0.3em] uppercase">
        Coming together
      </p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        {SITE_CONFIG.name}
      </h1>
      <p className="text-muted-foreground max-w-md text-base">
        {SITE_CONFIG.tagline}. Site under construction — sections land milestone
        by milestone.
      </p>
    </main>
  );
}
