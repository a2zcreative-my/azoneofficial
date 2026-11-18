/* v1.369.0 - THE BUSINESS GROWTH CHECK'S WORDS, once. The public form
   (app/apply/business) and the staff screen (components/portal/growth-enquiries)
   read the same keys the server accepts (worker/src/growth.ts GROWTH_*), so a
   choice is written once and said the same way on both sides. */

export type Bi = [string, string];

export const GROWTH_SOURCES: [string, Bi][] = [
  ["facebook", ["Facebook", "Facebook"]], ["instagram", ["Instagram", "Instagram"]], ["tiktok", ["TikTok", "TikTok"]], ["threads", ["Threads", "Threads"]],
  ["x", ["X", "X"]], ["linkedin", ["LinkedIn", "LinkedIn"]], ["whatsapp", ["WhatsApp", "WhatsApp"]], ["google", ["Google", "Google"]],
  ["website", ["Website", "Laman web"]], ["referral", ["Referral", "Rujukan"]], ["event", ["Event", "Acara"]], ["other", ["Other", "Lain-lain"]],
];
export const GROWTH_INDUSTRIES: [string, Bi][] = [
  ["food_beverage", ["Food & beverage", "Makanan & minuman"]], ["retail", ["Retail / shop", "Runcit / kedai"]], ["fashion_beauty", ["Fashion & beauty", "Fesyen & kecantikan"]],
  ["health_wellness", ["Health & wellness", "Kesihatan & kesejahteraan"]], ["education", ["Education & training", "Pendidikan & latihan"]],
  ["professional_services", ["Professional services", "Perkhidmatan profesional"]], ["property", ["Property & construction", "Hartanah & pembinaan"]],
  ["automotive", ["Automotive", "Automotif"]], ["manufacturing", ["Manufacturing", "Pembuatan"]], ["agriculture", ["Agriculture", "Pertanian"]],
  ["technology", ["Technology", "Teknologi"]], ["travel_hospitality", ["Travel & hospitality", "Pelancongan & hospitaliti"]], ["other", ["Other", "Lain-lain"]],
];
export const GROWTH_STATES: [string, Bi][] = [
  ["johor", ["Johor", "Johor"]], ["kedah", ["Kedah", "Kedah"]], ["kelantan", ["Kelantan", "Kelantan"]], ["melaka", ["Melaka", "Melaka"]], ["negeri_sembilan", ["Negeri Sembilan", "Negeri Sembilan"]],
  ["pahang", ["Pahang", "Pahang"]], ["perak", ["Perak", "Perak"]], ["perlis", ["Perlis", "Perlis"]], ["pulau_pinang", ["Pulau Pinang", "Pulau Pinang"]], ["sabah", ["Sabah", "Sabah"]],
  ["sarawak", ["Sarawak", "Sarawak"]], ["selangor", ["Selangor", "Selangor"]], ["terengganu", ["Terengganu", "Terengganu"]], ["kuala_lumpur", ["W.P. Kuala Lumpur", "W.P. Kuala Lumpur"]],
  ["labuan", ["W.P. Labuan", "W.P. Labuan"]], ["putrajaya", ["W.P. Putrajaya", "W.P. Putrajaya"]], ["outside_malaysia", ["Outside Malaysia", "Luar Malaysia"]],
];
export const GROWTH_CHALLENGES: [string, Bi][] = [
  ["low_sales", ["Sales are low or falling", "Jualan rendah atau menurun"]], ["few_customers", ["Not enough new customers", "Kurang pelanggan baharu"]],
  ["weak_brand", ["The brand is not well known", "Jenama kurang dikenali"]], ["content", ["No consistent content", "Tiada kandungan yang konsisten"]],
  ["social_reach", ["Low reach on social media", "Capaian media sosial rendah"]], ["ads_results", ["Ads do not bring results", "Iklan tidak membawa hasil"]],
  ["online_store", ["Selling online is hard", "Sukar menjual secara dalam talian"]], ["competition", ["Strong competition", "Persaingan sengit"]],
  ["no_strategy", ["No clear marketing plan", "Tiada pelan pemasaran yang jelas"]], ["no_time", ["No time or team for marketing", "Tiada masa atau pasukan untuk pemasaran"]],
  ["other", ["Something else", "Lain-lain"]],
];
export const GROWTH_PLATFORMS: [string, Bi][] = [
  ["facebook", ["Facebook", "Facebook"]], ["instagram", ["Instagram", "Instagram"]], ["tiktok", ["TikTok", "TikTok"]], ["whatsapp", ["WhatsApp Business", "WhatsApp Business"]],
  ["shopee", ["Shopee", "Shopee"]], ["lazada", ["Lazada", "Lazada"]], ["tiktok_shop", ["TikTok Shop", "TikTok Shop"]], ["website", ["Own website", "Laman web sendiri"]],
  ["google_business", ["Google Business Profile", "Google Business Profile"]], ["youtube", ["YouTube", "YouTube"]], ["none", ["None yet", "Belum ada"]],
];
export const GROWTH_INTERESTS: [string, Bi][] = [
  ["sales", ["Increasing sales", "Meningkatkan jualan"]], ["customer_acquisition", ["Getting new customers", "Mendapatkan pelanggan baharu"]],
  ["branding", ["Branding", "Penjenamaan"]], ["creative_content", ["Creative content", "Kandungan kreatif"]], ["ai_video", ["AI promotional videos", "Video promosi AI"]],
  ["digital_marketing", ["Digital marketing", "Pemasaran digital"]], ["seo", ["SEO (Google search)", "SEO (carian Google)"]], ["ecommerce", ["E-commerce", "E-dagang"]],
];
export const GROWTH_TIMES: [string, Bi][] = [
  ["morning", ["Morning (9am - 12pm)", "Pagi (9 pg - 12 tgh)"]], ["afternoon", ["Afternoon (12pm - 5pm)", "Petang (12 tgh - 5 ptg)"]],
  ["evening", ["Evening (5pm - 9pm)", "Malam (5 ptg - 9 mlm)"]], ["any", ["Any time", "Bila-bila masa"]],
];
export const GROWTH_METHODS: [string, Bi][] = [["whatsapp", ["WhatsApp", "WhatsApp"]], ["call", ["Phone call", "Panggilan telefon"]], ["email", ["Email", "E-mel"]]];

/** the status words and their meaning, in the pipeline's order */
export const GROWTH_STATUS: [string, Bi, Bi][] = [
  ["new", ["New", "Baharu"], ["Submitted, not picked up yet.", "Dihantar, belum diambil."]],
  ["assigned", ["Assigned", "Ditugaskan"], ["Picked up by a staff member.", "Diambil oleh staf."]],
  ["contacted", ["Contacted", "Dihubungi"], ["The entrepreneur was reached.", "Usahawan telah dihubungi."]],
  ["problem_identified", ["Problem Identified", "Masalah Dikenal Pasti"], ["The main problem is understood and recorded.", "Masalah utama difahami dan direkod."]],
  ["advice_delivered", ["Free Advice Delivered", "Cadangan Percuma Diberi"], ["The free first advice was given.", "Cadangan awal percuma telah diberi."]],
  ["qualified", ["Qualified", "Layak"], ["Interested in a paid solution - quotation next.", "Berminat dengan penyelesaian berbayar - sebut harga seterusnya."]],
  ["follow_up", ["Follow-Up", "Susulan"], ["Not ready yet - a follow-up date is set.", "Belum bersedia - tarikh susulan ditetapkan."]],
  ["not_interested", ["Not Interested", "Tidak Berminat"], ["Closed - the reason is kept.", "Ditutup - sebab disimpan."]],
];

export const wordOf = (m: [string, Bi, ...unknown[]][], k: string | null | undefined, lang: "en" | "ms"): string => {
  const hit = m.find((x) => x[0] === k);
  return hit ? hit[1][lang === "ms" ? 1 : 0] : k ?? "—";
};

/** The CEO's WhatsApp opening, word for word (18-11-2026). Opening it is not proof it was sent. */
export function growthWhatsAppText(name: string, staff: string, business: string): string {
  return `Salam ${name}, saya ${staff} daripada A2Z Creative Marketing. Terima kasih kerana mengisi Business Growth Check. Saya ingin memahami cabaran yang dihadapi oleh ${business} supaya kami boleh berikan cadangan awal secara percuma.`;
}
/** WhatsApp's official click-to-chat link, the message prefilled - nothing is sent until the person presses Send */
export const growthWhatsAppLink = (whatsapp: string, message: string) => `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
