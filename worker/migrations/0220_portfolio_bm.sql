-- 0220 - A PORTFOLIO IN BAHASA MELAYU (the CEO 19-11-2026 - the public page switched its labels to BM
-- but the words each person wrote stayed in English).
-- content_ms holds the BM words of a portfolio as JSON - tagline, intro, experience, a phrase map for the
-- specialties, expertise and responsibilities, and each work title and description. Filled by the
-- Translate to BM button (Cloudflare AI) and corrected by staff, frozen with the rest at publish.
-- NULL or an empty field = the English words are shown. The staff record is not altered.
-- ADDITIVE ONLY: one nullable column on staff_portfolios.
ALTER TABLE staff_portfolios ADD COLUMN content_ms TEXT;
