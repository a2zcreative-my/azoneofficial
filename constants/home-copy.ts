/**
 * Website restructure (18-11-2026, unreleased) - THE HOMEPAGE WORDS, English and Bahasa Melayu.
 *
 * The owner's brief (18-11-2026): six sections - hero, our services, selected
 * work, why A2Z, consultation & enquiries, footer - on the original A2Z look
 * (white header, deep navy gradient hero, gold call to action, white and
 * light-grey sections, "Creative · Digital · Commerce", "Build the brand.
 * Sell it live.").
 *
 * Only facts that are true today: the registered company, the Johor Bahru
 * team and studio, BM and English, the services we sell. No figures, ratings,
 * client counts or rankings - publish those only when they are real.
 */
import type { Lang } from "@/constants/services";

export interface HomeCopy {
  meta: { title: string; description: string };
  hero: {
    eyebrow: string;
    line1: string;
    line2: string;
    lede: string;
    primary: string;
    secondary: string;
    whatsapp: string;
    facts: { title: string; text: string }[];
    panelTitle: string;
    panelText: string;
    panelCta: string;
  };
  services: { eyebrow: string; title: string; lede: string; all: string; more: string; stage: string };
  proof: { registered: string; companies: string; client: string; channels: string };
  route: { label: string; a: string; z: string };
  team: { title: string; lede: string; card: string };
  work: { eyebrow: string; title: string; lede: string; all: string; note: string };
  why: { eyebrow: string; title: string; lede: string; points: { title: string; text: string }[] };
  consult: {
    eyebrow: string;
    title: string;
    lede: string;
    whatsapp: string;
    call: string;
    email: string;
    visit: string;
    hours: string;
  };
  form: {
    title: string;
    name: string;
    phone: string;
    service: string;
    serviceAny: string;
    message: string;
    messageHint: string;
    send: string;
    sending: string;
    sent: string;
    already: string;
    error: string;
    errorWa: string;
    privacy: string;
    privacyLink: string;
    required: string;
  };
}

export const HOME_COPY: Record<Lang, HomeCopy> = {
  en: {
    meta: {
      title: "A2Z Creative Marketing | Creative & Live Commerce Agency Johor Bahru",
      description:
        "Creative marketing, digital production and live commerce in Johor Bahru: live hosts, TikTok Live, studio rental, product video, design, websites and affiliates.",
    },
    hero: {
      eyebrow: "Creative · Digital · Commerce",
      line1: "Build the brand.",
      line2: "Sell it live.",
      lede:
        "Creative marketing, digital production and live commerce from one team in Johor Bahru - from the first design to the sale on TikTok Live, for businesses across Malaysia.",
      primary: "Get a Free Consultation",
      secondary: "View Our Work",
      whatsapp: "WhatsApp us",
      facts: [
        { title: "Johor Bahru based", text: "Team and studio in Taman Setia Tropika" },
        { title: "Serving all of Malaysia", text: "On-site in Johor, online nationwide" },
        { title: "BM & English", text: "Hosts and content in both languages" },
      ],
      panelTitle: "Talk to our team",
      panelText: "Tell us what you sell and what you need. We reply on WhatsApp with honest advice and a quotation.",
      panelCta: "Start on WhatsApp",
    },
    services: {
      eyebrow: "Our services",
      title: "Eight services, one team, from A to Z",
      lede: "Start at the stage you need, or hand us the whole route - the same team carries your brand from the first design to the sale.",
      all: "All services",
      more: "Learn more",
      stage: "Stage",
    },
    proof: {
      registered: "Registered Malaysian company",
      companies: "Our companies",
      client: "Client",
      channels: "Selling live on TikTok Live and Shopee Live",
    },
    route: { label: "The A2Z route", a: "Your brand", z: "Your sale" },
    team: {
      title: "The people you will work with",
      lede: "A2Z is run by its three directors. You speak to the people who make the decisions.",
      card: "Contact card",
    },
    work: {
      eyebrow: "Selected work",
      title: "Work we have built, and still run",
      lede: "Real projects only. A client is named here only with their permission.",
      all: "View portfolio",
      note: "Live channel",
    },
    why: {
      eyebrow: "Why A2Z",
      title: "Why businesses work with A2Z",
      lede: "",
      points: [
        { title: "A registered company", text: "A2Z Creative Marketing (202603003468 / CA0414729-A), a Malaysian business you can verify." },
        { title: "Our own studio and live channels", text: "We host, shoot and sell from our studio in Johor Bahru, and run live channels of our own." },
        { title: "Creative, content and commerce together", text: "Design, video, live selling, websites and affiliates planned by one team, so nothing is lost between suppliers." },
        { title: "Straight answers on WhatsApp", text: "Talk to the people doing the work. We tell you what fits your business - and what does not." },
      ],
    },
    consult: {
      eyebrow: "Consultation & enquiries",
      title: "Tell us what you want to build",
      lede: "A free consultation with our team: we look at your products and channels, and reply with practical advice and a quotation - no obligation.",
      whatsapp: "WhatsApp",
      call: "Call",
      email: "Email",
      visit: "Visit",
      hours: "We reply to WhatsApp and enquiries during working hours.",
    },
    form: {
      title: "Send an enquiry",
      name: "Your name",
      phone: "Phone / WhatsApp",
      service: "Service",
      serviceAny: "Not sure yet",
      message: "How can we help?",
      messageHint: "Your products, your goal and any dates.",
      send: "Send enquiry",
      sending: "Sending…",
      sent: "Thank you - your enquiry has reached our team. We will contact you on the number you gave.",
      already: "We already have this enquiry - our team will contact you. You can also WhatsApp us.",
      error: "The form could not send just now. Please",
      errorWa: "message us on WhatsApp",
      privacy: "We use these details only to reply to your enquiry.",
      privacyLink: "Privacy Policy",
      required: "required",
    },
  },
  ms: {
    meta: {
      title: "A2Z Creative Marketing | Agensi Kreatif & Live Commerce Johor Bahru",
      description:
        "Pemasaran kreatif, produksi digital dan live commerce di Johor Bahru: live host, TikTok Live, sewaan studio, video produk, reka bentuk, laman web dan affiliate.",
    },
    hero: {
      eyebrow: "Creative · Digital · Commerce",
      line1: "Build the brand.",
      line2: "Sell it live.",
      lede:
        "Pemasaran kreatif, produksi digital dan live commerce daripada satu pasukan di Johor Bahru - dari reka bentuk pertama hingga jualan di TikTok Live, untuk perniagaan di seluruh Malaysia.",
      primary: "Dapatkan Konsultasi Percuma",
      secondary: "Lihat Hasil Kerja Kami",
      whatsapp: "WhatsApp kami",
      facts: [
        { title: "Berpangkalan di Johor Bahru", text: "Pasukan dan studio di Taman Setia Tropika" },
        { title: "Seluruh Malaysia", text: "Di lokasi di Johor, dalam talian ke seluruh negara" },
        { title: "BM & Inggeris", text: "Host dan kandungan dalam kedua-dua bahasa" },
      ],
      panelTitle: "Bercakap dengan pasukan kami",
      panelText: "Beritahu kami apa yang anda jual dan apa yang diperlukan. Kami balas di WhatsApp dengan nasihat jujur dan sebut harga.",
      panelCta: "Mula di WhatsApp",
    },
    services: {
      eyebrow: "Perkhidmatan kami",
      title: "Lapan perkhidmatan, satu pasukan, dari A hingga Z",
      lede: "Mula di peringkat yang anda perlukan, atau serahkan seluruh laluan kepada kami - pasukan yang sama membawa jenama anda dari reka bentuk pertama hingga jualan.",
      all: "Semua perkhidmatan",
      more: "Ketahui lanjut",
      stage: "Peringkat",
    },
    proof: {
      registered: "Syarikat berdaftar di Malaysia",
      companies: "Syarikat kami",
      client: "Klien",
      channels: "Menjual secara live di TikTok Live dan Shopee Live",
    },
    route: { label: "Laluan A2Z", a: "Jenama anda", z: "Jualan anda" },
    team: {
      title: "Pasukan yang akan bekerja dengan anda",
      lede: "A2Z diterajui oleh tiga pengarahnya. Anda berurusan terus dengan mereka yang membuat keputusan.",
      card: "Kad hubungan",
    },
    work: {
      eyebrow: "Hasil kerja terpilih",
      title: "Kerja yang kami bina, dan masih kami uruskan",
      lede: "Projek sebenar sahaja. Klien hanya dinamakan di sini dengan kebenaran mereka.",
      all: "Lihat portfolio",
      note: "Saluran live",
    },
    why: {
      eyebrow: "Kenapa A2Z",
      title: "Kenapa perniagaan memilih A2Z",
      lede: "",
      points: [
        { title: "Syarikat berdaftar", text: "A2Z Creative Marketing (202603003468 / CA0414729-A), perniagaan Malaysia yang boleh anda semak." },
        { title: "Studio dan saluran live sendiri", text: "Kami host, rakam dan menjual dari studio kami di Johor Bahru, dan menguruskan saluran live kami sendiri." },
        { title: "Kreatif, kandungan dan jualan bersama", text: "Reka bentuk, video, jualan live, laman web dan affiliate dirancang oleh satu pasukan, jadi tiada yang tercicir antara pembekal." },
        { title: "Jawapan jujur di WhatsApp", text: "Bercakap terus dengan pasukan yang membuat kerja. Kami beritahu apa yang sesuai untuk perniagaan anda - dan apa yang tidak." },
      ],
    },
    consult: {
      eyebrow: "Konsultasi & pertanyaan",
      title: "Ceritakan apa yang anda mahu bina",
      lede: "Konsultasi percuma dengan pasukan kami: kami teliti produk dan saluran anda, dan membalas dengan nasihat praktikal serta sebut harga - tanpa sebarang komitmen.",
      whatsapp: "WhatsApp",
      call: "Telefon",
      email: "E-mel",
      visit: "Alamat",
      hours: "Kami membalas WhatsApp dan pertanyaan dalam waktu bekerja.",
    },
    form: {
      title: "Hantar pertanyaan",
      name: "Nama anda",
      phone: "Telefon / WhatsApp",
      service: "Perkhidmatan",
      serviceAny: "Belum pasti",
      message: "Apa yang boleh kami bantu?",
      messageHint: "Produk anda, matlamat anda dan sebarang tarikh.",
      send: "Hantar pertanyaan",
      sending: "Menghantar…",
      sent: "Terima kasih - pertanyaan anda telah sampai kepada pasukan kami. Kami akan menghubungi anda di nombor yang diberikan.",
      already: "Kami sudah menerima pertanyaan ini - pasukan kami akan menghubungi anda. Anda juga boleh WhatsApp kami.",
      error: "Borang tidak dapat dihantar sekarang. Sila",
      errorWa: "hubungi kami di WhatsApp",
      privacy: "Kami gunakan maklumat ini hanya untuk membalas pertanyaan anda.",
      privacyLink: "Dasar Privasi",
      required: "wajib",
    },
  },
};

/** Shared page words used by the service pages, both languages. */
export const PAGE_WORDS: Record<Lang, Record<string, string>> = {
  en: {
    home: "Home",
    services: "Services",
    included: "What's included",
    forWho: "Who it's for",
    how: "How it works",
    coverage: "Where we work",
    work: "Our work in this service",
    faq: "Frequently asked questions",
    related: "Related services",
    quote: "Get a quotation on WhatsApp",
    consult: "Get a Free Consultation",
    enquire: "Prefer a form?",
    ctaTitle: "Ready to talk about",
    ctaText: "Send us your details on WhatsApp and we will reply with honest advice and a quotation.",
    visit: "Visit site",
    caseStudy: "Read the case study",
    noWork: "",
    other: "Other services",
    hubTitle: "Our services",
    hubIntro: "Eight services from one team in Johor Bahru. Each page explains what is included, who it is for and how to get a quotation.",
    consultancyTitle: "Digital marketing and consultancy",
    consultancyText: "Strategy, positioning and business development are delivered by AZ ONE OFFICIAL, our consultancy service. Packages bundle our live commerce work into four tiers.",
    seeConsultancy: "See our consultancy",
    seePackages: "Compare packages",
  },
  ms: {
    home: "Utama",
    services: "Perkhidmatan",
    included: "Apa yang termasuk",
    forWho: "Untuk siapa",
    how: "Cara ia berjalan",
    coverage: "Kawasan perkhidmatan",
    work: "Hasil kerja kami dalam perkhidmatan ini",
    faq: "Soalan lazim",
    related: "Perkhidmatan berkaitan",
    quote: "Dapatkan sebut harga di WhatsApp",
    consult: "Dapatkan Konsultasi Percuma",
    enquire: "Lebih suka borang?",
    ctaTitle: "Sedia untuk berbincang tentang",
    ctaText: "Hantar maklumat anda melalui WhatsApp dan kami akan membalas dengan nasihat jujur dan sebut harga.",
    visit: "Lawati laman",
    caseStudy: "Baca kajian kes",
    noWork: "",
    other: "Perkhidmatan lain",
    hubTitle: "Perkhidmatan kami",
    hubIntro: "Lapan perkhidmatan daripada satu pasukan di Johor Bahru.",
    consultancyTitle: "Pemasaran digital dan perundingan",
    consultancyText: "Strategi, penjenamaan dan pembangunan perniagaan disampaikan oleh AZ ONE OFFICIAL, perkhidmatan perundingan kami.",
    seeConsultancy: "Lihat perundingan kami",
    seePackages: "Bandingkan pakej",
  },
};
