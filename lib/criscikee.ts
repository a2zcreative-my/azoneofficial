/**
 * CRISCIKEE — the vocabulary the browser shares with the worker. v1.149.0.
 *
 * The CEO, 10-09-2026: a tab for the crispy chicken skin, to learn WHO is
 * trying it, WHAT flavour they prefer, HOW MUCH they like it and WHY.
 *
 * Every closed list a review is made of lives here once, in the ORDER the
 * screens show it, with both languages. worker/src/criscikee.ts carries the
 * same keys for validation and the migration carries them as CHECK
 * constraints; tests/criscikee.mjs holds the three copies together, the way
 * hotel-pipeline.mjs holds STAGES.
 *
 * The keys are CODES, never the translated label. A filter compares
 * `r.gender === "female"`, and a chip's aria-pressed is decided on the code -
 * the clickable-data guard asserts exactly that, because a label changes with
 * the language and a code does not.
 */

export const GENDERS = [
  ["male", "Male", "Lelaki"],
  ["female", "Female", "Perempuan"],
  ["undisclosed", "Prefer not to say", "Tidak mahu nyatakan"],
] as const;
export type Gender = (typeof GENDERS)[number][0];

/** Age bands, youngest first. The boundaries are ageGroupOf() below and the
    worker has the SAME function - the guard runs both over every age from
    3 to 110 and fails if they ever disagree on a single one. */
export const AGE_GROUPS = [
  ["under_18", "Below 18", "Bawah 18"],
  ["18_24", "18–24", "18–24"],
  ["25_34", "25–34", "25–34"],
  ["35_44", "35–44", "35–44"],
  ["45_54", "45–54", "45–54"],
  ["55_plus", "55+", "55+"],
] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number][0];

/** Age 27 → "25_34". The one rule; the worker's copy is identical. */
export function ageGroupOf(age: number): AgeGroup {
  if (age < 18) return "under_18";
  if (age <= 24) return "18_24";
  if (age <= 34) return "25_34";
  if (age <= 44) return "35_44";
  if (age <= 54) return "45_54";
  return "55_plus";
}

export const IMPRESSIONS = [
  ["loved_it", "Loved it", "Sangat suka"],
  ["good", "Good", "Sedap"],
  ["average", "Average", "Biasa"],
  ["not_my_taste", "Not my taste", "Bukan citarasa saya"],
] as const;
export type Impression = (typeof IMPRESSIONS)[number][0];

export const SENTIMENTS = [
  ["positive", "Positive", "Positif"],
  ["neutral", "Neutral", "Neutral"],
  ["negative", "Negative", "Negatif"],
] as const;
export type Sentiment = (typeof SENTIMENTS)[number][0];

/** A rating is 1 to 5, whole stars. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** The age range the form and the API accept. A three-year-old can be handed
    a piece; a hundred-and-ten-year-old can too. Outside that is a typo. */
export const AGE_MIN = 3;
export const AGE_MAX = 110;

/** How long a comment may be. Long enough for a paragraph, short enough that
    a pasted essay is refused rather than stored. */
export const COMMENT_MAX = 1000;

/** Below this many reviews a figure is shown but never called "best" or
    "worst" - one five-star review is not a winning flavour. The worker's
    insights use the same number. */
export const MIN_SAMPLE = 5;

/** Look a code up in one of the lists above, in the current language. */
export function labelOf(
  list: readonly (readonly [string, string, string])[],
  code: string | null | undefined,
  lang: "en" | "ms",
): string {
  const row = list.find((r) => r[0] === code);
  if (!row) return code ?? "";
  return lang === "ms" ? row[2] : row[1];
}
