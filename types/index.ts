import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
}

export interface Service {
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface Statistic {
  value: number;
  suffix: string;
  label: string;
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

export interface ElfiaProduct {
  slug: string;
  name: string;
  category: string;
  imageSrc: string;
  imageAlt: string;
  description: string;
  gallery?: readonly string[];
}
