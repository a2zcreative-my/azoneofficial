import type { PackageTier } from "@/types";

/** One package tier card. Shared by the homepage teaser and /packages. */
export function PackageCard({ tier }: { tier: PackageTier }) {
  return (
    <article
      className={`flex h-full w-full flex-col rounded-xl border p-6 ${
        tier.featured ? "border-gold-deep/40 bg-secondary/40" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight">{tier.name}</h3>
        {tier.featured && (
          <span className="bg-brand text-gold rounded-md px-2.5 py-1 text-[11px] font-medium tracking-wide uppercase">
            Most chosen
          </span>
        )}
      </div>
      <p className="text-gold-deep mt-2 text-sm font-medium">{tier.cadence}</p>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {tier.tagline}
      </p>
      <ul className="mt-5 grow space-y-2.5">
        {tier.features.map((feature) => (
          <li
            key={feature}
            className="text-muted-foreground flex items-start gap-2.5 text-sm leading-relaxed"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-gold-deep mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
            {feature}
          </li>
        ))}
      </ul>
    </article>
  );
}
