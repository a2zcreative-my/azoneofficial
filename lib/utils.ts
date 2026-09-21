import { clsx, type ClassValue } from "clsx";

/* v1.172.2 - Tailwind retired: cn() no longer merges conflicting utilities
   (tailwind-merge is gone). It joins class names, exactly like clsx, and
   callers that used to rely on a later utility overriding an earlier one
   pass an explicit prop instead (components/layout/section.tsx `neutral`). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
