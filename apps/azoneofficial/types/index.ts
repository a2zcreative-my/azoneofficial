import type { ComponentType, SVGProps } from "react";

export interface NavItem {
  label: string;
  href: string;
}

export interface Service {
  title: string;
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

/** Qualitative credibility marker shown instead of counters. */
export interface TrustSignal {
  label: string;
  description: string;
}

export interface PackageMatrixRow {
  feature: string;
  /** One value per tier, in PACKAGES order. true = included, false = not. */
  values: readonly (string | boolean)[];
}

export interface PackageTier {
  name: string;
  tagline: string;
  /** Availability/scale line, e.g. "1 session per week". */
  cadence: string;
  features: readonly string[];
  featured?: boolean;
}

export interface Testimonial {
  quote: string;
  author: string;
  role: string;
  company: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface ProcessStep {
  step: number;
  title: string;
  description: string;
}

export interface CaseStudyResult {
  label: string;
  detail: string;
}

/** A client engagement presented as portfolio work. */
export interface CaseStudy {
  slug: string;
  client: string;
  industry: string;
  summary: string;
  heroImage: string;
  heroImageAlt: string;
  /** The client's own site, if they have one. */
  website?: string;
  challenge: readonly string[];
  solution: readonly string[];
  results: readonly CaseStudyResult[];
  /** Which of our services the engagement used. */
  services: readonly string[];
  quote?: { text: string; attribution: string };
}
