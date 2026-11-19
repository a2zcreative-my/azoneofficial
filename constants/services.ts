/**
 * WEBSITE RESTRUCTURE (18-11-2026, unreleased) - THE EIGHT OFFICIAL SERVICES, each with its own indexable page.
 *
 * The owner's brief (18-11-2026, "A2Z CREATIVE MARKETING WEBSITE
 * RESTRUCTURING & SEO"): eight official services, a compact 4 x 2 grid on the
 * homepage, and one landing page per service at /services/<slug> (English)
 * and /ms/services/<slug> (Bahasa Melayu), linked to each other by hreflang.
 *
 * Rules this file keeps:
 * - Every word is written for A2Z's own service. No copied copy, no keyword
 *   stuffing, no invented clients, results, prices, ratings or rankings.
 * - "work" names ONLY real, approved work: ELFIA (named on the CEO's recorded
 *   permission, constants/brands.ts permissionOnFile), A2Z's own TikTok and
 *   Shopee channels, A2Z's own sister company AZ ONE OFFICIAL, and this site.
 *   A service with no verified example shows none - never a placeholder.
 * - Domains of other brands come from constants/brands.ts (brands-guard).
 * - One contact number: CONTACT.whatsapp. Each page has its own WhatsApp
 *   message so the team knows which service the enquiry is about.
 *
 * The SAME content drives the homepage cards, the navbar menu, the footer,
 * the /services hub, both language versions, the sitemap and the JSON-LD,
 * so a service is renamed or added in exactly one place.
 */
import {
  Clapperboard,
  Globe,
  Handshake,
  Mic,
  Palette,
  Radio,
  Smartphone,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { brandByCode } from "@/constants/brands";
import { CONTACT, LIVE_SHOWCASE } from "@/constants/content";
import { SITE_CONFIG } from "@/constants/site";

export type Lang = "en" | "ms";

export interface Faq {
  q: string;
  a: string;
}

export interface WorkRef {
  /** a brand or handle - shown as written, never translated */
  name: string;
  /** what A2Z did, in the page's language */
  what: string;
  href: string;
  external: boolean;
}

export interface ServiceCopy {
  /** the card and menu name */
  name: string;
  /** one line on the homepage card */
  card: string;
  /** <title> (the site template adds " — A2Z CREATIVE MARKETING") */
  seoTitle: string;
  /** meta description, about 150 characters */
  seoDescription: string;
  h1: string;
  intro: string;
  /** "What's included" */
  scope: string[];
  /** "Who it's for" */
  forWho: string[];
  /** "How it works" */
  steps: { title: string; text: string }[];
  /** "Where we work" */
  coverage: string;
  faqs: Faq[];
  /** the WhatsApp message this page sends */
  whatsapp: string;
}

export type Stage = "brand" | "content" | "live" | "scale";

/** The A-to-Z route: four stages, two services each (the homepage's 4 x 2). */
export const STAGES: readonly { key: Stage; en: { name: string; line: string }; ms: { name: string; line: string } }[] = [
  { key: "brand", en: { name: "Brand", line: "Look the part everywhere you appear." }, ms: { name: "Jenama", line: "Kelihatan meyakinkan di mana-mana jenama anda muncul." } },
  { key: "content", en: { name: "Content", line: "Show the product the way buyers want to see it." }, ms: { name: "Kandungan", line: "Tunjukkan produk seperti yang pembeli mahu lihat." } },
  { key: "live", en: { name: "Live", line: "Sell in real time, with hosts who close." }, ms: { name: "Live", line: "Menjual secara langsung, dengan host yang menutup jualan." } },
  { key: "scale", en: { name: "Scale", line: "More sessions, more sellers, more reach." }, ms: { name: "Kembang", line: "Lebih banyak sesi, penjual dan capaian." } },
];

export interface ServiceDef {
  key: ServiceKey;
  stage: Stage;
  /** the URL segment under /services (and /ms/services) */
  slug: string;
  icon: LucideIcon;
  /** the schema.org Service "serviceType" */
  serviceType: string;
  /** where it is offered, for JSON-LD areaServed */
  area: "johor" | "malaysia";
  related: ServiceKey[];
  en: ServiceCopy;
  ms: ServiceCopy;
  /** real work only - see the header */
  work: (lang: Lang) => WorkRef[];
}

export type ServiceKey =
  | "live-host"
  | "live-commerce"
  | "studio"
  | "video"
  | "design"
  | "mobilegraphy"
  | "website"
  | "affiliate";

/* ---------------------------------------------------------------- real work */
const elfia = brandByCode("elfia");
const azone = brandByCode("azone");
const tiktok = LIVE_SHOWCASE.tiktokProfileUrl;
const shopee = LIVE_SHOWCASE.shopeeLiveUrl;
const tiktokHandle = `@${tiktok.split("@")[1] ?? ""}`;

const W = {
  elfiaLive: (l: Lang): WorkRef | null =>
    elfia
      ? {
          name: elfia.name,
          what: l === "en"
            ? "Live selling channel built and run end to end: session format, hosts, rundowns and the creative around each drop."
            : "Saluran jualan live yang dibina dan diuruskan sepenuhnya: format sesi, host, rundown dan kreatif untuk setiap drop.",
          href: elfia.url,
          external: true,
        }
      : null,
  elfiaStore: (l: Lang): WorkRef | null =>
    elfia
      ? {
          name: elfia.name,
          what: l === "en" ? "The brand's own online store, built and run by our team." : "Kedai dalam talian jenama tersebut, dibina dan diuruskan oleh pasukan kami.",
          href: elfia.url,
          external: true,
        }
      : null,
  elfiaCatalogue: (l: Lang): WorkRef | null =>
    elfia
      ? {
          name: elfia.name,
          what: l === "en"
            ? "Seasonal product catalogue and live-session visuals: covers, overlays and product cards."
            : "Katalog produk bermusim dan visual sesi live: cover, overlay dan kad produk.",
          href: elfia.url,
          external: true,
        }
      : null,
  ownTiktok: (l: Lang): WorkRef => ({
    name: tiktokHandle,
    what: l === "en"
      ? "Our own TikTok live channel - live sessions and short-form cuts, hosted and produced by our team."
      : "Saluran TikTok live kami sendiri - sesi live dan video pendek, dihoskan dan dihasilkan oleh pasukan kami.",
    href: tiktok,
    external: true,
  }),
  ownShopee: (l: Lang): WorkRef => ({
    name: "Shopee Live",
    what: l === "en"
      ? "Our own Shopee shop, where we run live sessions alongside the TikTok calendar."
      : "Kedai Shopee kami sendiri, tempat kami menjalankan sesi live seiring jadual TikTok.",
    href: shopee,
    external: true,
  }),
  azoneSite: (l: Lang): WorkRef | null =>
    azone
      ? {
          name: azone.name,
          what: l === "en"
            ? "Website for our consultancy company - positioning, pages and an enquiry desk."
            : "Laman web untuk syarikat perundingan kami - penjenamaan, halaman dan meja pertanyaan.",
          href: azone.url,
          external: true,
        }
      : null,
  ownSite: (l: Lang): WorkRef => ({
    name: "a2zcreative.my",
    what: l === "en"
      ? "This website - built and maintained by our own team, in English and Bahasa Melayu."
      : "Laman web ini - dibina dan diselenggara oleh pasukan kami sendiri, dalam Bahasa Inggeris dan Bahasa Melayu.",
    href: "/",
    external: false,
  }),
};
const real = (xs: (WorkRef | null)[]): WorkRef[] => xs.filter((x): x is WorkRef => Boolean(x));

/* ---------------------------------------------------------------- the eight */
export const SERVICE_PAGES: readonly ServiceDef[] = [
  {
    key: "live-host",
    stage: "live",
    slug: "live-host-malaysia",
    icon: Mic,
    serviceType: "Live streaming host",
    area: "malaysia",
    related: ["live-commerce", "studio", "mobilegraphy"],
    work: (l) => real([W.ownTiktok(l), W.elfiaLive(l)]),
    en: {
      name: "Live Host",
      card: "Trained BM and English hosts who sell on TikTok Live and Shopee Live.",
      seoTitle: "TikTok Live Host Malaysia — BM & English Hosts",
      seoDescription:
        "Hire a trained TikTok Live and Shopee Live host in Malaysia. Bahasa Melayu and English hosts who present, answer buyers and close sales. Johor Bahru based.",
      h1: "Live hosts who sell, in Bahasa Melayu and English",
      intro:
        "A good live host does more than read out product names. They keep viewers watching, answer questions on camera, explain the offer clearly and ask for the order. Our hosts work from a rundown built around your products, in the language your buyers shop in.",
      scope: [
        "A trained host for TikTok Live or Shopee Live, in Bahasa Melayu, English or a natural mix",
        "A session rundown planned with you: products, offers, timing and key selling points",
        "Product briefing before the session so the host knows sizes, materials and prices",
        "Live answers to buyer questions and comments while the session runs",
        "Sessions from our studio in Johor Bahru, or at your premises by arrangement",
        "A short note after each session on what was asked and what sold",
      ],
      forWho: [
        "Brands starting TikTok Live and needing a confident host from day one",
        "Sellers already live who want a regular host for a fixed schedule",
        "Businesses launching a product or campaign that needs a dedicated session",
      ],
      steps: [
        { title: "Brief", text: "You tell us the products, offers and the dates you want to go live." },
        { title: "Prepare", text: "We match a host, plan the rundown and brief them on every product." },
        { title: "Go live", text: "The host presents, answers buyers and pushes the offers in real time." },
        { title: "Review", text: "We share what happened in the session and what to change next time." },
      ],
      coverage:
        "Our hosts are based in Johor Bahru. Remote sessions run from our studio for brands anywhere in Malaysia; on-site sessions are arranged in Johor and further afield on request.",
      faqs: [
        { q: "Do your hosts speak Bahasa Melayu and English?", a: "Yes. Every host sells comfortably in Bahasa Melayu, and we match English or mixed-language hosts when your buyers need it." },
        { q: "Can the host go live from your studio?", a: "Yes. Most sessions run from our studio in Johor Bahru - you send the products and we handle the set, lighting and phone setup." },
        { q: "Do I need to supply the TikTok account?", a: "Usually yes - the session runs on your own TikTok or Shopee account so the sales and followers stay with your brand. We help you get it ready." },
        { q: "How long is one session?", a: "It depends on your products and plan. We agree the length and schedule with you before the first session." },
        { q: "How do I get a price?", a: "Send us your products and how often you want to go live on WhatsApp. We reply with a quotation for that schedule." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, I'm interested in your Live Host service. Could you send me a quotation?",
    },
    ms: {
      name: "Live Host",
      card: "Host BM dan Inggeris terlatih yang menjual di TikTok Live dan Shopee Live.",
      seoTitle: "Live Host TikTok Malaysia — Host Live BM & Inggeris",
      seoDescription:
        "Upah host TikTok Live dan Shopee Live terlatih di Malaysia. Host BM dan Inggeris yang mempersembahkan produk, menjawab pembeli dan menutup jualan.",
      h1: "Live host yang menjual, dalam Bahasa Melayu dan Inggeris",
      intro:
        "Live host yang baik bukan sekadar menyebut nama produk. Mereka mengekalkan penonton, menjawab soalan di depan kamera, menerangkan tawaran dengan jelas dan meminta pesanan. Host kami bekerja berdasarkan rundown yang dirancang mengikut produk anda, dalam bahasa yang digunakan oleh pembeli anda.",
      scope: [
        "Host terlatih untuk TikTok Live atau Shopee Live, dalam Bahasa Melayu, Inggeris atau campuran",
        "Rundown sesi yang dirancang bersama anda: produk, tawaran, masa dan kelebihan utama",
        "Taklimat produk sebelum sesi supaya host tahu saiz, bahan dan harga",
        "Jawapan secara langsung kepada soalan dan komen pembeli sepanjang sesi",
        "Sesi dari studio kami di Johor Bahru, atau di premis anda mengikut persetujuan",
        "Nota ringkas selepas setiap sesi tentang soalan pembeli dan produk yang terjual",
      ],
      forWho: [
        "Jenama yang baru bermula di TikTok Live dan memerlukan host yang yakin dari hari pertama",
        "Penjual yang sudah live dan mahukan host tetap untuk jadual yang tetap",
        "Perniagaan yang melancarkan produk atau kempen dan memerlukan sesi khas",
      ],
      steps: [
        { title: "Taklimat", text: "Anda beritahu kami produk, tawaran dan tarikh untuk live." },
        { title: "Persediaan", text: "Kami pilih host, rancang rundown dan beri taklimat setiap produk." },
        { title: "Live", text: "Host mempersembahkan produk, menjawab pembeli dan menolak tawaran secara langsung." },
        { title: "Semakan", text: "Kami kongsi apa yang berlaku dalam sesi dan apa yang perlu diubah." },
      ],
      coverage:
        "Host kami berpangkalan di Johor Bahru. Sesi jarak jauh dijalankan dari studio kami untuk jenama di seluruh Malaysia; sesi di lokasi boleh diatur di Johor dan kawasan lain atas permintaan.",
      faqs: [
        { q: "Adakah host anda boleh bercakap Bahasa Melayu dan Inggeris?", a: "Ya. Setiap host selesa menjual dalam Bahasa Melayu, dan kami sediakan host Inggeris atau campuran apabila pembeli anda memerlukannya." },
        { q: "Bolehkah host live dari studio anda?", a: "Boleh. Kebanyakan sesi dijalankan dari studio kami di Johor Bahru - anda hantar produk dan kami uruskan set, lampu dan telefon." },
        { q: "Perlukah saya sediakan akaun TikTok?", a: "Biasanya ya - sesi dijalankan di akaun TikTok atau Shopee anda sendiri supaya jualan dan pengikut kekal dengan jenama anda. Kami bantu sediakan akaun tersebut." },
        { q: "Berapa lama satu sesi?", a: "Bergantung pada produk dan perancangan anda. Kami tetapkan tempoh dan jadual bersama anda sebelum sesi pertama." },
        { q: "Bagaimana untuk mendapatkan harga?", a: "Hantar produk anda dan kekerapan live yang dikehendaki melalui WhatsApp. Kami balas dengan sebut harga untuk jadual tersebut." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, saya berminat dengan perkhidmatan Live Host. Boleh berikan sebut harga?",
    },
  },
  {
    key: "live-commerce",
    stage: "live",
    slug: "live-commerce-management",
    icon: Radio,
    serviceType: "Live commerce management",
    area: "malaysia",
    related: ["live-host", "affiliate", "video"],
    work: (l) => real([W.elfiaLive(l), W.ownTiktok(l), W.ownShopee(l)]),
    en: {
      name: "Live Commerce",
      card: "We plan and run your live selling sessions on TikTok and Shopee.",
      seoTitle: "Live Commerce Agency Malaysia — TikTok Live Management",
      seoDescription:
        "TikTok Live and Shopee Live management in Malaysia: session planning, hosts, offers, moderation and reporting. Promosi produk secara live by A2Z in Johor Bahru.",
      h1: "Live commerce management: promote and sell your products live",
      intro:
        "Live commerce works when every session is planned like a sales event. We run the channel with you - the schedule, the rundown, the host, the offers and the comments - and report what happened after each live, so the next session sells better than the last.",
      scope: [
        "A live schedule and session plan for TikTok Live and Shopee Live",
        "Rundowns built around your best offers, bundles and stock",
        "Hosts, plus a moderator to answer comments and pin products",
        "Overlays, covers and product cards for each session",
        "Live promotion setup on your shop: pinned products, vouchers and flash deals where the platform allows",
        "A report after each session: what was shown, asked and sold, and what to change",
      ],
      forWho: [
        "Brands that want to sell live regularly but have no team for it",
        "Sellers whose lives draw viewers but not orders",
        "Businesses launching a product range and wanting a live campaign",
      ],
      steps: [
        { title: "Consultation", text: "We look at your products, shop and current channels and agree the goal." },
        { title: "Set up", text: "Shop readiness, offers, creative and the session rundown." },
        { title: "Run", text: "Sessions go live on the agreed schedule with host and moderator." },
        { title: "Improve", text: "Each report shapes the next rundown: keep what sold, change what didn't." },
      ],
      coverage:
        "Managed from Johor Bahru for brands across Malaysia. Sessions can run from our studio or from your own premises.",
      faqs: [
        { q: "Which platforms do you manage?", a: "TikTok Live and Shopee Live. Tell us if your brand sells on another platform and we will advise honestly whether we can support it." },
        { q: "Do you hold my stock?", a: "No. Orders are fulfilled from your own stock and shop. We plan the session around what you can ship." },
        { q: "What do you need from me?", a: "Your products, prices, stock levels and access to the shop features the session uses. We prepare everything else." },
        { q: "Do you guarantee sales?", a: "No honest agency can guarantee sales. We plan, run and report every session so you can see what works and decide with real figures." },
        { q: "Is this the same as your packages?", a: "Yes - live commerce is sold in the packages on our Packages page, and we also quote custom schedules." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, I'm interested in Live Commerce management for my brand. Could we discuss a quotation?",
    },
    ms: {
      name: "Promosi Produk Secara Live",
      card: "Kami rancang dan jalankan sesi jualan live anda di TikTok dan Shopee.",
      seoTitle: "Promosi Produk Secara Live — Pengurusan TikTok Live",
      seoDescription:
        "Pengurusan TikTok Live dan Shopee Live di Malaysia: perancangan sesi, host, tawaran, moderasi dan laporan. Promosi produk secara live oleh A2Z di Johor Bahru.",
      h1: "Promosi produk secara live: jual produk anda secara langsung",
      intro:
        "Live commerce berkesan apabila setiap sesi dirancang seperti acara jualan. Kami uruskan saluran bersama anda - jadual, rundown, host, tawaran dan komen - dan melaporkan hasil selepas setiap live, supaya sesi seterusnya menjual lebih baik.",
      scope: [
        "Jadual live dan perancangan sesi untuk TikTok Live dan Shopee Live",
        "Rundown berdasarkan tawaran, bundle dan stok terbaik anda",
        "Host, serta moderator untuk menjawab komen dan pin produk",
        "Overlay, cover dan kad produk untuk setiap sesi",
        "Tetapan promosi live di kedai anda: produk pin, baucar dan flash deal mengikut kemudahan platform",
        "Laporan selepas setiap sesi: apa yang ditunjukkan, ditanya dan dijual, serta apa yang perlu diubah",
      ],
      forWho: [
        "Jenama yang mahu menjual secara live dengan kerap tetapi tiada pasukan",
        "Penjual yang live mereka ada penonton tetapi kurang pesanan",
        "Perniagaan yang melancarkan rangkaian produk dan mahukan kempen live",
      ],
      steps: [
        { title: "Konsultasi", text: "Kami teliti produk, kedai dan saluran semasa anda serta tetapkan matlamat." },
        { title: "Persediaan", text: "Kesediaan kedai, tawaran, kreatif dan rundown sesi." },
        { title: "Jalankan", text: "Sesi live mengikut jadual dengan host dan moderator." },
        { title: "Tambah baik", text: "Setiap laporan membentuk rundown seterusnya: kekalkan yang laku, ubah yang tidak." },
      ],
      coverage:
        "Diuruskan dari Johor Bahru untuk jenama di seluruh Malaysia. Sesi boleh dijalankan dari studio kami atau dari premis anda sendiri.",
      faqs: [
        { q: "Platform apa yang anda uruskan?", a: "TikTok Live dan Shopee Live. Beritahu kami jika jenama anda menjual di platform lain dan kami akan nasihatkan dengan jujur sama ada kami boleh membantu." },
        { q: "Adakah anda menyimpan stok saya?", a: "Tidak. Pesanan dipenuhi daripada stok dan kedai anda sendiri. Kami rancang sesi mengikut apa yang anda mampu hantar." },
        { q: "Apa yang anda perlukan daripada saya?", a: "Produk, harga, tahap stok dan akses kepada ciri kedai yang digunakan dalam sesi. Selebihnya kami sediakan." },
        { q: "Adakah jualan dijamin?", a: "Tiada agensi yang jujur boleh menjamin jualan. Kami rancang, jalankan dan laporkan setiap sesi supaya anda nampak apa yang berkesan dan membuat keputusan berdasarkan angka sebenar." },
        { q: "Adakah ini sama dengan pakej anda?", a: "Ya - live commerce dijual dalam pakej di halaman Pakej kami, dan kami juga beri sebut harga untuk jadual khas." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, saya berminat dengan Promosi Produk Secara Live untuk jenama saya. Boleh kita bincang sebut harga?",
    },
  },
  {
    key: "studio",
    stage: "scale",
    slug: "studio-rental-johor-bahru",
    icon: Warehouse,
    serviceType: "Studio rental",
    area: "johor",
    related: ["live-host", "video", "mobilegraphy"],
    work: () => [],
    en: {
      name: "Studio Rental",
      card: "A ready studio in Johor Bahru for live sessions, product shoots and video.",
      seoTitle: "Studio Rental Johor Bahru — Live, Photo & Video Studio",
      seoDescription:
        "Rent A2Z's studio in Johor Bahru for TikTok Live sessions, product photography and video shoots. Book by the session, with our team on hand if you need them.",
      h1: "Studio rental in Johor Bahru for live sessions and shoots",
      intro:
        "Not every brand has space for a proper live or shoot setup. Our studio in Taman Setia Tropika, Johor Bahru is set up for live selling and content work, so you can arrive with your products and start. Add a host, a camera operator or an editor from our team if you need them.",
      scope: [
        "Studio space for TikTok Live, Shopee Live, product photography and short video",
        "Lighting and a ready set for live and content work",
        "Booking by the session at times agreed with you",
        "Optional A2Z host, camera operator or editor for your booking",
        "A walkthrough before your first booking so you know the space",
      ],
      forWho: [
        "Sellers who go live from home and want a cleaner, brighter setup",
        "Brands shooting product photos or short videos for a launch",
        "Agencies and freelancers in Johor who need a studio for a client day",
      ],
      steps: [
        { title: "Enquire", text: "Tell us what you are shooting or streaming, when, and for how long." },
        { title: "Confirm", text: "We confirm availability, setup and the rate on WhatsApp." },
        { title: "Arrive", text: "Come with your products - the studio is ready when you arrive." },
        { title: "Extend", text: "Add our team or book the next session if you want to keep going." },
      ],
      coverage:
        "The studio is in Taman Setia Tropika, Johor Bahru. Bookings are for walk-in use at our premises.",
      faqs: [
        { q: "Where is the studio?", a: `${SITE_CONFIG.address}.` },
        { q: "What is included in a booking?", a: "The studio space and its standard setup. Tell us your plan and we will confirm exactly what is ready for your session before you book." },
        { q: "Can I bring my own team?", a: "Yes. You can use the studio with your own host and crew, or add someone from ours." },
        { q: "Can I visit before booking?", a: "Yes - message us on WhatsApp to arrange a time to see the space." },
        { q: "How do I book?", a: "Send us your preferred date, time and what you plan to do. We reply with availability and the rate." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, I'd like to ask about Studio Rental in Johor Bahru. Is the studio available, and what is the rate?",
    },
    ms: {
      name: "Sewaan Studio",
      card: "Studio sedia guna di Johor Bahru untuk sesi live, fotografi produk dan video.",
      seoTitle: "Sewaan Studio Johor Bahru — Studio Live, Foto & Video",
      seoDescription:
        "Sewa studio A2Z di Johor Bahru untuk sesi TikTok Live, fotografi produk dan penggambaran video. Tempah mengikut sesi, dengan pasukan kami sedia membantu jika diperlukan.",
      h1: "Sewaan studio di Johor Bahru untuk sesi live dan penggambaran",
      intro:
        "Bukan semua jenama ada ruang untuk set live atau penggambaran yang sesuai. Studio kami di Taman Setia Tropika, Johor Bahru disediakan untuk jualan live dan penghasilan kandungan, jadi anda hanya perlu datang dengan produk dan mula. Tambah host, jurukamera atau editor daripada pasukan kami jika perlu.",
      scope: [
        "Ruang studio untuk TikTok Live, Shopee Live, fotografi produk dan video pendek",
        "Lampu dan set sedia guna untuk live dan penghasilan kandungan",
        "Tempahan mengikut sesi pada masa yang dipersetujui",
        "Pilihan host, jurukamera atau editor A2Z untuk tempahan anda",
        "Lawatan ringkas sebelum tempahan pertama supaya anda kenal ruang tersebut",
      ],
      forWho: [
        "Penjual yang live dari rumah dan mahukan set yang lebih kemas dan terang",
        "Jenama yang menjalankan fotografi produk atau video pendek untuk pelancaran",
        "Agensi dan freelancer di Johor yang memerlukan studio untuk hari penggambaran klien",
      ],
      steps: [
        { title: "Pertanyaan", text: "Beritahu kami apa yang ingin dirakam atau di-live, bila dan berapa lama." },
        { title: "Pengesahan", text: "Kami sahkan kekosongan, set dan kadar melalui WhatsApp." },
        { title: "Hadir", text: "Datang dengan produk anda - studio sudah sedia apabila anda tiba." },
        { title: "Lanjutkan", text: "Tambah pasukan kami atau tempah sesi seterusnya jika mahu teruskan." },
      ],
      coverage:
        "Studio terletak di Taman Setia Tropika, Johor Bahru. Tempahan adalah untuk kegunaan di premis kami.",
      faqs: [
        { q: "Di mana studio anda?", a: `${SITE_CONFIG.address}.` },
        { q: "Apa yang termasuk dalam tempahan?", a: "Ruang studio dan set standardnya. Beritahu kami perancangan anda dan kami sahkan apa yang tersedia untuk sesi anda sebelum tempahan." },
        { q: "Bolehkah saya bawa pasukan sendiri?", a: "Boleh. Anda boleh gunakan studio dengan host dan krew sendiri, atau tambah seseorang daripada pasukan kami." },
        { q: "Bolehkah saya melawat sebelum menempah?", a: "Boleh - hubungi kami di WhatsApp untuk mengatur masa melihat ruang tersebut." },
        { q: "Bagaimana untuk menempah?", a: "Hantar tarikh, masa dan perancangan anda. Kami balas dengan kekosongan dan kadar." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, saya ingin bertanya tentang Sewaan Studio di Johor Bahru. Adakah studio kosong dan berapa kadarnya?",
    },
  },
  {
    key: "video",
    stage: "content",
    slug: "product-video-production",
    icon: Clapperboard,
    serviceType: "Product video production",
    area: "malaysia",
    related: ["mobilegraphy", "design", "studio"],
    work: (l) => real([W.ownTiktok(l), W.elfiaLive(l)]),
    en: {
      name: "Product & Promo Video",
      card: "Product and promotional videos for ads, social media and your shop.",
      seoTitle: "Product Videography Johor Bahru — Product & Promo Video",
      seoDescription:
        "Product videos and promotional videos in Johor Bahru for TikTok, Instagram, Facebook, Shopee and your website. Planned, shot and edited by A2Z Creative Marketing.",
      h1: "Product and promotional video production",
      intro:
        "Buyers want to see a product move, fit and work before they pay. We plan, shoot and edit product and promotional videos for your shop listings, social media and ads - short, clear and made for the screen your buyer is holding.",
      scope: [
        "Product videos for shop listings, social media and your website",
        "Promotional videos for launches, campaigns and sales",
        "Planning: the message, the shots and the call to action",
        "Shooting in our studio in Johor Bahru or at your location",
        "Editing with captions, music and your brand's look",
        "Vertical and landscape versions for each channel",
      ],
      forWho: [
        "Brands with listings that only have still photos",
        "Businesses launching a product, promotion or new range",
        "Sellers who need video content to run ads",
      ],
      steps: [
        { title: "Brief", text: "What the video must sell, where it will be posted and when you need it." },
        { title: "Plan", text: "We agree the shot list, the script or key messages and the formats." },
        { title: "Shoot", text: "Filming in our studio or on location, with your products." },
        { title: "Edit", text: "A first cut for your comments, then the final versions for each channel." },
      ],
      coverage:
        "Filmed in Johor Bahru, in our studio or at your premises in Johor. For brands elsewhere in Malaysia, send us your products and we shoot in our studio.",
      faqs: [
        { q: "Do you write the script?", a: "Yes. We plan the key messages and the shots with you; you approve them before we film." },
        { q: "Can you film at my shop or factory?", a: "Yes, in Johor. Further away, we can discuss travel or shoot your products in our studio." },
        { q: "Do I get versions for TikTok and Instagram?", a: "Yes. We agree the formats at the start - usually vertical for TikTok and Reels, and landscape where needed." },
        { q: "How many revisions are included?", a: "We agree this in the quotation so you know exactly what to expect before we start." },
        { q: "How do I get a quotation?", a: "Tell us the product, how many videos and where they will be used. We reply on WhatsApp with a quotation." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, I need product / promotional videos. Could you send me a quotation?",
    },
    ms: {
      name: "Video Produk / Promosi",
      card: "Video produk dan promosi untuk iklan, media sosial dan kedai anda.",
      seoTitle: "Video Produk Johor Bahru — Video Produk & Promosi",
      seoDescription:
        "Video produk dan video promosi di Johor Bahru untuk TikTok, Instagram, Facebook, Shopee dan laman web anda. Dirancang, dirakam dan disunting oleh A2Z Creative Marketing.",
      h1: "Penghasilan video produk dan video promosi",
      intro:
        "Pembeli mahu melihat produk bergerak, dipakai dan berfungsi sebelum membayar. Kami rancang, rakam dan sunting video produk dan promosi untuk senarai kedai, media sosial dan iklan anda - ringkas, jelas dan dibuat untuk skrin yang dipegang oleh pembeli anda.",
      scope: [
        "Video produk untuk senarai kedai, media sosial dan laman web",
        "Video promosi untuk pelancaran, kempen dan jualan",
        "Perancangan: mesej, syot dan seruan tindakan",
        "Penggambaran di studio kami di Johor Bahru atau di lokasi anda",
        "Suntingan dengan kapsyen, muzik dan identiti jenama anda",
        "Versi menegak dan mendatar untuk setiap saluran",
      ],
      forWho: [
        "Jenama yang senarai produknya hanya ada gambar",
        "Perniagaan yang melancarkan produk, promosi atau rangkaian baharu",
        "Penjual yang memerlukan kandungan video untuk iklan",
      ],
      steps: [
        { title: "Taklimat", text: "Apa yang perlu dijual oleh video, di mana ia akan disiarkan dan bila diperlukan." },
        { title: "Rancang", text: "Kami tetapkan senarai syot, skrip atau mesej utama dan format." },
        { title: "Rakam", text: "Penggambaran di studio kami atau di lokasi, dengan produk anda." },
        { title: "Sunting", text: "Draf pertama untuk komen anda, kemudian versi akhir untuk setiap saluran." },
      ],
      coverage:
        "Dirakam di Johor Bahru, di studio kami atau di premis anda di Johor. Untuk jenama di luar Johor, hantar produk anda dan kami rakam di studio kami.",
      faqs: [
        { q: "Adakah anda menulis skrip?", a: "Ya. Kami rancang mesej utama dan syot bersama anda; anda luluskan sebelum penggambaran." },
        { q: "Bolehkah anda merakam di kedai atau kilang saya?", a: "Boleh, di Johor. Untuk lokasi lebih jauh, kami boleh bincang perjalanan atau rakam produk anda di studio kami." },
        { q: "Adakah saya dapat versi untuk TikTok dan Instagram?", a: "Ya. Kami tetapkan format pada awal - biasanya menegak untuk TikTok dan Reels, dan mendatar apabila perlu." },
        { q: "Berapa kali pindaan yang termasuk?", a: "Kami tetapkan dalam sebut harga supaya anda tahu dengan tepat sebelum kerja bermula." },
        { q: "Bagaimana untuk mendapatkan sebut harga?", a: "Beritahu kami produk, bilangan video dan di mana ia akan digunakan. Kami balas di WhatsApp dengan sebut harga." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, saya perlukan video produk / promosi. Boleh berikan sebut harga?",
    },
  },
  {
    key: "design",
    stage: "brand",
    slug: "creative-design",
    icon: Palette,
    serviceType: "Graphic design",
    area: "malaysia",
    related: ["website", "video", "live-commerce"],
    work: (l) => real([W.elfiaCatalogue(l)]),
    en: {
      name: "Creative Design",
      card: "Brand visuals, social posts, catalogues and live-session graphics.",
      seoTitle: "Graphic Design Service Johor Bahru — Creative Design",
      seoDescription:
        "Graphic and creative design in Johor Bahru: social media posts, product catalogues, banners, live-session covers and overlays, and brand visuals for Malaysian businesses.",
      h1: "Creative design that keeps your brand consistent",
      intro:
        "A brand that looks the same on every post, listing and live is a brand buyers recognise and trust. We design the visuals your marketing uses every week - social posts, catalogues, banners and live-session graphics - in one consistent style.",
      scope: [
        "Social media posts and carousels for TikTok, Instagram and Facebook",
        "Product catalogues and price lists, print and PDF",
        "Banners and graphics for Shopee, TikTok Shop and your website",
        "Live-session covers, overlays and product cards",
        "Campaign visuals for sales, festive seasons and launches",
        "A simple style guide so your visuals stay consistent",
      ],
      forWho: [
        "Businesses whose posts and listings all look different",
        "Brands that need regular content every month",
        "Sellers preparing a catalogue, campaign or seasonal sale",
      ],
      steps: [
        { title: "Brief", text: "Your brand, your audience and what the design must achieve." },
        { title: "Direction", text: "We propose the look - colours, type and layout - for your approval." },
        { title: "Design", text: "We produce the pieces and share them for comments." },
        { title: "Deliver", text: "Final files in the sizes and formats each channel needs." },
      ],
      coverage: "Delivered online for businesses anywhere in Malaysia, from our team in Johor Bahru.",
      faqs: [
        { q: "Do you design logos?", a: "Tell us what you need. We focus on the visuals a brand uses every day, and we can discuss identity work as part of a brief." },
        { q: "Can you work with my existing brand?", a: "Yes. We follow your colours, fonts and logo, and help tidy them into a consistent style." },
        { q: "Do you print catalogues?", a: "We design print-ready files. Printing can be arranged with your own printer or one we recommend." },
        { q: "Can I get a monthly design package?", a: "Yes. Many brands take a fixed number of designs each month - ask us for a quotation." },
        { q: "Which file formats do I receive?", a: "The formats each channel needs, such as PNG or JPG for social media and PDF for print, agreed at the start." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, I'm interested in your Creative Design service. Could you send me a quotation?",
    },
    ms: {
      name: "Reka Bentuk Kreatif",
      card: "Visual jenama, posting sosial, katalog dan grafik sesi live.",
      seoTitle: "Reka Bentuk Grafik Johor Bahru — Creative Design",
      seoDescription:
        "Reka bentuk grafik dan kreatif di Johor Bahru: posting media sosial, katalog produk, banner, cover dan overlay sesi live, serta visual jenama untuk perniagaan Malaysia.",
      h1: "Reka bentuk kreatif yang mengekalkan identiti jenama anda",
      intro:
        "Jenama yang kelihatan sama pada setiap posting, senarai produk dan live adalah jenama yang mudah dikenali dan dipercayai pembeli. Kami reka visual yang digunakan dalam pemasaran anda setiap minggu - posting sosial, katalog, banner dan grafik sesi live - dalam satu gaya yang konsisten.",
      scope: [
        "Posting dan karusel media sosial untuk TikTok, Instagram dan Facebook",
        "Katalog produk dan senarai harga, cetak dan PDF",
        "Banner dan grafik untuk Shopee, TikTok Shop dan laman web anda",
        "Cover, overlay dan kad produk untuk sesi live",
        "Visual kempen untuk jualan, musim perayaan dan pelancaran",
        "Panduan gaya ringkas supaya visual anda kekal konsisten",
      ],
      forWho: [
        "Perniagaan yang posting dan senarai produknya tidak seragam",
        "Jenama yang memerlukan kandungan tetap setiap bulan",
        "Penjual yang menyediakan katalog, kempen atau jualan bermusim",
      ],
      steps: [
        { title: "Taklimat", text: "Jenama anda, sasaran anda dan apa yang perlu dicapai oleh reka bentuk." },
        { title: "Hala tuju", text: "Kami cadangkan gaya - warna, tulisan dan susun atur - untuk kelulusan anda." },
        { title: "Reka", text: "Kami hasilkan reka bentuk dan kongsi untuk komen." },
        { title: "Serahan", text: "Fail akhir dalam saiz dan format yang diperlukan setiap saluran." },
      ],
      coverage: "Diserahkan secara dalam talian untuk perniagaan di seluruh Malaysia, daripada pasukan kami di Johor Bahru.",
      faqs: [
        { q: "Adakah anda mereka logo?", a: "Beritahu kami keperluan anda. Fokus kami ialah visual yang digunakan jenama setiap hari, dan kerja identiti boleh dibincangkan dalam taklimat." },
        { q: "Bolehkah anda gunakan identiti jenama sedia ada?", a: "Boleh. Kami ikut warna, tulisan dan logo anda, dan bantu menyusunnya menjadi gaya yang konsisten." },
        { q: "Adakah anda mencetak katalog?", a: "Kami sediakan fail sedia cetak. Percetakan boleh diatur dengan pencetak anda sendiri atau yang kami cadangkan." },
        { q: "Ada pakej reka bentuk bulanan?", a: "Ada. Banyak jenama mengambil bilangan reka bentuk yang tetap setiap bulan - minta sebut harga daripada kami." },
        { q: "Format fail apa yang saya terima?", a: "Format yang diperlukan setiap saluran, seperti PNG atau JPG untuk media sosial dan PDF untuk cetakan, ditetapkan pada awal." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, saya berminat dengan perkhidmatan Reka Bentuk Kreatif. Boleh berikan sebut harga?",
    },
  },
  {
    key: "mobilegraphy",
    stage: "content",
    slug: "mobile-videography",
    icon: Smartphone,
    serviceType: "Mobile videography",
    area: "malaysia",
    related: ["video", "live-host", "design"],
    work: (l) => real([W.ownTiktok(l)]),
    en: {
      name: "Mobilegraphy",
      card: "Phone-shot photos and short videos made for TikTok, Reels and Shorts.",
      seoTitle: "Mobilegraphy Malaysia — Short Video for TikTok & Reels",
      seoDescription:
        "Mobilegraphy in Johor Bahru: phone-shot product photos and short-form videos for TikTok, Instagram Reels and YouTube Shorts, planned and edited by A2Z.",
      h1: "Mobilegraphy: short-form content shot on mobile",
      intro:
        "Short-form platforms reward content that feels native to the feed. Mobilegraphy is photography and video shot and edited on mobile, at the pace social media needs - quick to produce, natural to watch and easy to post every week.",
      scope: [
        "Short-form videos for TikTok, Instagram Reels and YouTube Shorts",
        "Phone-shot product photos for posts and listings",
        "Content ideas and simple shot plans based on what is working on the platform",
        "Editing with captions, text and trending formats that suit your brand",
        "Cutting live-session highlights into short clips",
        "Monthly content batches on a regular schedule",
      ],
      forWho: [
        "Brands that need frequent, fresh content without a large production",
        "Businesses starting or restarting their TikTok and Instagram",
        "Sellers who want live highlights turned into posts",
      ],
      steps: [
        { title: "Plan", text: "We agree the content themes and the number of pieces each month." },
        { title: "Shoot", text: "Batch shooting in our studio, at your location or around your products." },
        { title: "Edit", text: "Quick edits made for the feed, shared for your approval." },
        { title: "Post-ready", text: "Files delivered ready to post, with suggested captions." },
      ],
      coverage: "Shot in Johor Bahru and around Johor; edited for brands across Malaysia.",
      faqs: [
        { q: "What is the difference from product video?", a: "Mobilegraphy is lighter and faster: shot on mobile for social feeds and posted often. Product video is a more planned production for listings, ads and launches." },
        { q: "Do you post the content for me?", a: "We deliver post-ready files with suggested captions. Ask us if you also want help with posting." },
        { q: "Can you cut clips from my live sessions?", a: "Yes. Send us the recording or let us record the session, and we cut it into short clips." },
        { q: "How many videos can I get a month?", a: "That depends on your plan. We agree a monthly number in the quotation." },
        { q: "How do I start?", a: "Message us with your brand and the platforms you post on, and we suggest a monthly plan." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, I'm interested in Mobilegraphy content for my brand. Could you send me a quotation?",
    },
    ms: {
      name: "Mobilegraphy",
      card: "Foto dan video pendek dirakam dengan telefon untuk TikTok, Reels dan Shorts.",
      seoTitle: "Mobilegraphy Malaysia — Video Pendek TikTok & Reels",
      seoDescription:
        "Mobilegraphy di Johor Bahru: foto produk dan video pendek dirakam dengan telefon untuk TikTok, Instagram Reels dan YouTube Shorts, dirancang dan disunting oleh A2Z.",
      h1: "Mobilegraphy: kandungan pendek dirakam dengan telefon",
      intro:
        "Platform video pendek menghargai kandungan yang terasa semula jadi di feed. Mobilegraphy ialah fotografi dan video yang dirakam dan disunting menggunakan telefon, mengikut rentak media sosial - cepat dihasilkan, selesa ditonton dan mudah disiarkan setiap minggu.",
      scope: [
        "Video pendek untuk TikTok, Instagram Reels dan YouTube Shorts",
        "Foto produk dirakam dengan telefon untuk posting dan senarai produk",
        "Idea kandungan dan pelan syot ringkas berdasarkan apa yang berkesan di platform",
        "Suntingan dengan kapsyen, teks dan format semasa yang sesuai dengan jenama anda",
        "Memotong highlight sesi live menjadi klip pendek",
        "Kandungan bulanan mengikut jadual tetap",
      ],
      forWho: [
        "Jenama yang memerlukan kandungan baharu yang kerap tanpa produksi besar",
        "Perniagaan yang memulakan atau menghidupkan semula TikTok dan Instagram",
        "Penjual yang mahu highlight live dijadikan posting",
      ],
      steps: [
        { title: "Rancang", text: "Kami tetapkan tema kandungan dan bilangan kandungan setiap bulan." },
        { title: "Rakam", text: "Rakaman berkelompok di studio kami, di lokasi anda atau di sekitar produk anda." },
        { title: "Sunting", text: "Suntingan pantas untuk feed, dikongsi untuk kelulusan anda." },
        { title: "Sedia siar", text: "Fail diserahkan sedia untuk disiarkan, dengan cadangan kapsyen." },
      ],
      coverage: "Dirakam di Johor Bahru dan sekitar Johor; disunting untuk jenama di seluruh Malaysia.",
      faqs: [
        { q: "Apa bezanya dengan video produk?", a: "Mobilegraphy lebih ringan dan pantas: dirakam dengan telefon untuk feed media sosial dan disiarkan dengan kerap. Video produk ialah produksi yang lebih terancang untuk senarai produk, iklan dan pelancaran." },
        { q: "Adakah anda menyiarkan kandungan untuk saya?", a: "Kami serahkan fail sedia siar dengan cadangan kapsyen. Tanya kami jika anda juga mahu bantuan menyiarkannya." },
        { q: "Bolehkah anda memotong klip daripada sesi live saya?", a: "Boleh. Hantar rakaman kepada kami atau biar kami merakam sesi tersebut, dan kami potong menjadi klip pendek." },
        { q: "Berapa banyak video sebulan?", a: "Bergantung pada pelan anda. Kami tetapkan bilangan bulanan dalam sebut harga." },
        { q: "Bagaimana untuk bermula?", a: "Hubungi kami dengan maklumat jenama dan platform yang anda gunakan, dan kami cadangkan pelan bulanan." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, saya berminat dengan kandungan Mobilegraphy untuk jenama saya. Boleh berikan sebut harga?",
    },
  },
  {
    key: "website",
    stage: "brand",
    slug: "website-design-johor-bahru",
    icon: Globe,
    serviceType: "Website design",
    area: "malaysia",
    related: ["design", "affiliate", "video"],
    work: (l) => real([W.elfiaStore(l), W.azoneSite(l), W.ownSite(l)]),
    en: {
      name: "Product & Company Websites",
      card: "Websites for your products or company, fast on mobile and easy to find.",
      seoTitle: "Website Design Johor Bahru — Product & Company Sites",
      seoDescription:
        "Website design in Johor Bahru for products and companies: mobile-first pages, product showcases, enquiry forms and search-friendly setup, built by A2Z Creative Marketing.",
      h1: "Product and company websites, built to be found and to sell",
      intro:
        "Your website is where buyers check that your business is real, see what you sell and contact you. We build product and company websites that load fast on a phone, explain your offer clearly and make it easy to send an enquiry or buy.",
      scope: [
        "Company websites: who you are, what you offer and how to reach you",
        "Product websites and showcases for a brand or a product range",
        "Mobile-first design that matches your brand",
        "Enquiry forms and WhatsApp contact built in",
        "Search-friendly structure: page titles, descriptions and a sitemap",
        "Help with your domain, hosting setup and updates after launch",
      ],
      forWho: [
        "Businesses with no website, or one that is out of date",
        "Brands that sell on marketplaces and want a home of their own",
        "Companies that need a credible site for clients and partners",
      ],
      steps: [
        { title: "Scope", text: "The pages you need, the content you have and the goal of the site." },
        { title: "Design", text: "A layout in your brand's look for your approval." },
        { title: "Build", text: "We build the pages, forms and setup, and test them on phones." },
        { title: "Launch", text: "We put the site live on your domain and show you how to update it." },
      ],
      coverage: "Built for businesses anywhere in Malaysia, from our team in Johor Bahru.",
      faqs: [
        { q: "Can you build an online store?", a: "Tell us how you sell today. We build product websites and can advise whether a store, a catalogue with enquiries, or links to your marketplace shops fits you best." },
        { q: "Will my website show up on Google?", a: "We set up the pages so search engines can read and index them. Rankings depend on many things and no one can promise a position, but a well-built site is the starting point." },
        { q: "Do I need my own domain?", a: "Yes, the domain should be in your company's name. We help you register or connect it." },
        { q: "Can I update the website myself?", a: "We agree how updates will work before we build - either we update it for you or we show you how." },
        { q: "How long does it take?", a: "It depends on the number of pages and how ready your content is. We give you a timeline with the quotation." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, I need a product / company website. Could we discuss a quotation?",
    },
    ms: {
      name: "Website Produk / Syarikat",
      card: "Laman web untuk produk atau syarikat anda, pantas di telefon dan mudah dicari.",
      seoTitle: "Laman Web Johor Bahru — Website Produk & Syarikat",
      seoDescription:
        "Reka bentuk laman web di Johor Bahru untuk produk dan syarikat: mesra telefon, paparan produk, borang pertanyaan dan tetapan mesra carian. Oleh A2Z.",
      h1: "Website produk dan syarikat, dibina untuk dicari dan menjual",
      intro:
        "Laman web ialah tempat pembeli memastikan perniagaan anda sah, melihat apa yang anda jual dan menghubungi anda. Kami bina laman web produk dan syarikat yang pantas di telefon, menerangkan tawaran anda dengan jelas dan memudahkan pertanyaan atau pembelian.",
      scope: [
        "Laman web syarikat: siapa anda, apa yang ditawarkan dan cara menghubungi anda",
        "Laman web produk dan paparan untuk jenama atau rangkaian produk",
        "Reka bentuk mesra telefon yang sepadan dengan jenama anda",
        "Borang pertanyaan dan hubungan WhatsApp",
        "Struktur mesra carian: tajuk halaman, penerangan dan sitemap",
        "Bantuan domain, tetapan hosting dan kemas kini selepas pelancaran",
      ],
      forWho: [
        "Perniagaan yang belum ada laman web, atau laman web yang sudah lapuk",
        "Jenama yang menjual di marketplace dan mahukan laman sendiri",
        "Syarikat yang memerlukan laman web yang meyakinkan untuk klien dan rakan niaga",
      ],
      steps: [
        { title: "Skop", text: "Halaman yang diperlukan, kandungan yang ada dan matlamat laman web." },
        { title: "Reka", text: "Susun atur mengikut identiti jenama anda untuk kelulusan." },
        { title: "Bina", text: "Kami bina halaman, borang dan tetapan, serta uji di telefon." },
        { title: "Lancar", text: "Kami lancarkan laman web di domain anda dan tunjukkan cara mengemas kini." },
      ],
      coverage: "Dibina untuk perniagaan di seluruh Malaysia, daripada pasukan kami di Johor Bahru.",
      faqs: [
        { q: "Bolehkah anda bina kedai dalam talian?", a: "Beritahu kami cara anda menjual sekarang. Kami bina laman web produk dan boleh nasihatkan sama ada kedai, katalog dengan pertanyaan, atau pautan ke kedai marketplace anda paling sesuai." },
        { q: "Adakah laman web saya akan muncul di Google?", a: "Kami sediakan halaman supaya enjin carian boleh membaca dan mengindeksnya. Kedudukan bergantung pada banyak faktor dan tiada siapa boleh menjanjikan kedudukan, tetapi laman web yang dibina dengan baik ialah permulaannya." },
        { q: "Perlukah saya ada domain sendiri?", a: "Ya, domain sepatutnya atas nama syarikat anda. Kami bantu mendaftar atau menyambungkannya." },
        { q: "Bolehkah saya kemas kini laman web sendiri?", a: "Kami tetapkan cara kemas kini sebelum membina - sama ada kami kemas kini untuk anda atau kami tunjukkan caranya." },
        { q: "Berapa lama masa yang diambil?", a: "Bergantung pada bilangan halaman dan kesediaan kandungan anda. Kami berikan jadual masa bersama sebut harga." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, saya perlukan laman web produk / syarikat. Boleh kita bincang sebut harga?",
    },
  },
  {
    key: "affiliate",
    stage: "scale",
    slug: "affiliate-marketing",
    icon: Handshake,
    serviceType: "Affiliate marketing",
    area: "malaysia",
    related: ["live-commerce", "mobilegraphy", "website"],
    work: () => [],
    en: {
      name: "Affiliate Marketing",
      card: "Grow sales through affiliates and creators who promote your products.",
      seoTitle: "Affiliate Marketing Service Malaysia — TikTok & Shopee",
      seoDescription:
        "Affiliate marketing in Malaysia: set up and manage TikTok Shop and Shopee affiliate programmes, find creators, prepare product kits and track what sells. By A2Z.",
      h1: "Affiliate marketing: more people selling your products",
      intro:
        "Affiliates and creators can sell your products to audiences you do not reach yet, and you pay commission on what they sell. We help you set up the programme, find suitable affiliates, give them what they need to promote well, and follow up on the results.",
      scope: [
        "Affiliate programme setup on TikTok Shop and Shopee, where available to your shop",
        "Commission and product plans that suit your margins",
        "Finding and approaching affiliates and creators who fit your brand",
        "Product kits: key selling points, sample content and creative for affiliates",
        "Follow-up with affiliates and regular reporting on their sales",
        "Combining affiliates with your live sessions and campaigns",
      ],
      forWho: [
        "Brands on TikTok Shop or Shopee that want more people promoting them",
        "Sellers with good margins and stock ready to scale",
        "Businesses that want to grow without running every channel themselves",
      ],
      steps: [
        { title: "Review", text: "Your products, margins and shop, and whether affiliates suit them." },
        { title: "Set up", text: "Commission plan, programme settings and product kits." },
        { title: "Recruit", text: "We approach and onboard affiliates who fit your brand." },
        { title: "Manage", text: "Follow-ups, new content ideas and reports on what is selling." },
      ],
      coverage: "Managed for brands across Malaysia, from our team in Johor Bahru.",
      faqs: [
        { q: "How do affiliates get paid?", a: "Usually by commission on each sale, through the platform's own affiliate programme. We help you set rates that work for your margins." },
        { q: "Do you guarantee a number of affiliates?", a: "No. We approach suitable creators and report who joins and what they sell, so you can see the real picture." },
        { q: "Which platforms do you work with?", a: "Mainly TikTok Shop and Shopee affiliate programmes. Tell us where you sell and we will advise." },
        { q: "Do I need to send free samples?", a: "Often it helps affiliates promote well. We plan with you which products to sample and to whom." },
        { q: "Can this work with my live sessions?", a: "Yes. Affiliates and live sessions can promote the same campaign so each supports the other." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, I'm interested in Affiliate Marketing for my products. Could we discuss a quotation?",
    },
    ms: {
      name: "Pemasaran Affiliate",
      card: "Tingkatkan jualan melalui affiliate dan kreator yang mempromosi produk anda.",
      seoTitle: "Affiliate Marketing Malaysia — Affiliate TikTok & Shopee",
      seoDescription:
        "Pemasaran affiliate di Malaysia: sediakan dan urus program affiliate TikTok Shop dan Shopee, cari kreator, sediakan kit produk dan jejak apa yang terjual. Oleh A2Z.",
      h1: "Pemasaran affiliate: lebih ramai yang menjual produk anda",
      intro:
        "Affiliate dan kreator boleh menjual produk anda kepada audiens yang belum anda capai, dan anda membayar komisen atas jualan mereka. Kami bantu anda menyediakan program, mencari affiliate yang sesuai, memberi mereka bahan untuk mempromosi dengan baik, dan memantau hasilnya.",
      scope: [
        "Tetapan program affiliate di TikTok Shop dan Shopee, mengikut kemudahan kedai anda",
        "Pelan komisen dan produk yang sesuai dengan margin anda",
        "Mencari dan menghubungi affiliate dan kreator yang sesuai dengan jenama anda",
        "Kit produk: kelebihan utama, contoh kandungan dan kreatif untuk affiliate",
        "Susulan dengan affiliate dan laporan berkala tentang jualan mereka",
        "Menggabungkan affiliate dengan sesi live dan kempen anda",
      ],
      forWho: [
        "Jenama di TikTok Shop atau Shopee yang mahu lebih ramai mempromosi mereka",
        "Penjual dengan margin yang baik dan stok sedia untuk berkembang",
        "Perniagaan yang mahu berkembang tanpa menguruskan setiap saluran sendiri",
      ],
      steps: [
        { title: "Semakan", text: "Produk, margin dan kedai anda, serta kesesuaian affiliate." },
        { title: "Persediaan", text: "Pelan komisen, tetapan program dan kit produk." },
        { title: "Rekrut", text: "Kami hubungi dan daftarkan affiliate yang sesuai dengan jenama anda." },
        { title: "Urus", text: "Susulan, idea kandungan baharu dan laporan tentang apa yang terjual." },
      ],
      coverage: "Diuruskan untuk jenama di seluruh Malaysia, daripada pasukan kami di Johor Bahru.",
      faqs: [
        { q: "Bagaimana affiliate dibayar?", a: "Biasanya melalui komisen bagi setiap jualan, menerusi program affiliate platform itu sendiri. Kami bantu tetapkan kadar yang sesuai dengan margin anda." },
        { q: "Adakah anda menjamin bilangan affiliate?", a: "Tidak. Kami hubungi kreator yang sesuai dan melaporkan siapa yang menyertai serta apa yang mereka jual, supaya anda nampak gambaran sebenar." },
        { q: "Platform apa yang anda gunakan?", a: "Terutamanya program affiliate TikTok Shop dan Shopee. Beritahu kami di mana anda menjual dan kami akan nasihatkan." },
        { q: "Perlukah saya hantar sampel percuma?", a: "Selalunya ia membantu affiliate mempromosi dengan baik. Kami rancang bersama anda produk mana dan kepada siapa." },
        { q: "Bolehkah ini digabungkan dengan sesi live saya?", a: "Boleh. Affiliate dan sesi live boleh mempromosi kempen yang sama supaya saling menyokong." },
      ],
      whatsapp: "Hi A2Z Creative Marketing, saya berminat dengan Pemasaran Affiliate untuk produk saya. Boleh kita bincang sebut harga?",
    },
  },
];

/* ---------------------------------------------------------------- helpers */
export function serviceByKey(key: ServiceKey): ServiceDef {
  const s = SERVICE_PAGES.find((x) => x.key === key);
  if (!s) throw new Error(`unknown service ${key}`);
  return s;
}

export function serviceBySlug(slug: string): ServiceDef | undefined {
  return SERVICE_PAGES.find((x) => x.slug === slug);
}

/** /services/<slug>, or /ms/services/<slug> */
export function servicePath(s: ServiceDef, lang: Lang): string {
  return `${lang === "ms" ? "/ms" : ""}/services/${s.slug}`;
}

/** The one office number, with the page's own message. */
export function serviceWhatsApp(s: ServiceDef | null, lang: Lang): string {
  const msg = s ? s[lang].whatsapp : lang === "ms" ? HOME_WHATSAPP.ms : HOME_WHATSAPP.en;
  return `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(msg)}`;
}

export const HOME_WHATSAPP = {
  en: "Hi A2Z Creative Marketing, I'd like a free consultation for my business.",
  ms: "Hi A2Z Creative Marketing, saya ingin mendapatkan konsultasi percuma untuk perniagaan saya.",
} as const;

/** the office number, formatted from CONTACT.whatsapp for display */
export function displayPhone(): string {
  const d = CONTACT.whatsapp;
  return d.startsWith("60") ? `+60 ${d.slice(2, 4)}-${d.slice(4, 7)} ${d.slice(7)}` : `+${d}`;
}

/**
 * The page in the other language, when it has one. EN and BM pages exist in
 * pairs only for the homepage and the eight service pages; every other public
 * page stays English (the BM reader convenience in lang-runtime.tsx).
 */
export function twinPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return "/ms";
  if (p === "/ms") return "/";
  const en = /^\/services\/([a-z0-9-]+)$/.exec(p);
  if (en && serviceBySlug(en[1]!)) return `/ms/services/${en[1]}`;
  const ms = /^\/ms\/services\/([a-z0-9-]+)$/.exec(p);
  if (ms && serviceBySlug(ms[1]!)) return `/services/${ms[1]}`;
  return null;
}

export function isMsPath(pathname: string): boolean {
  return pathname === "/ms" || pathname.startsWith("/ms/");
}

/** The service a path is about, for the floating WhatsApp button. */
export function serviceForPath(pathname: string): { s: ServiceDef; lang: Lang } | null {
  const m = /^(\/ms)?\/services\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (!m) return null;
  const s = serviceBySlug(m[2]!);
  return s ? { s, lang: m[1] ? "ms" : "en" } : null;
}
