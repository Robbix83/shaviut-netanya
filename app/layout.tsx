import type { Metadata, Viewport } from "next";
import "./globals.css";
import Analytics from "@/components/Analytics";
import WhatsAppButton from "@/components/WhatsAppButton";
import AccessibilityMenu from "@/components/AccessibilityMenu";
import { A11Y_BOOT_SCRIPT } from "@/lib/a11yPrefs";

const BASE_URL = "https://www.sikuma.co.il";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: "באיזה מחיר נמכרו דירות לידך בנתניה? | סקר עסקאות אמיתיות",
  description:
    "ראו בחינם עסקאות אמיתיות שנמכרו בבניין, ברחוב ובסביבה שלכם בנתניה, כפי שדווחו לרשות המסים. סקר מחירים בלבד, אינו שומת מקרקעין.",
  keywords: ["מחירי דירות נתניה", "עסקאות נדלן נתניה", "סקר מחירים נתניה", "מתווך נתניה"],
  alternates: {
    canonical: BASE_URL,
  },
  openGraph: {
    title: "באיזה מחיר נמכרו דירות לידך בנתניה?",
    description: "סקירת מחירים לפי עסקאות אמיתיות שנמכרו באזורכם — בחינם ומיידי.",
    locale: "he_IL",
    type: "website",
    url: BASE_URL,
    siteName: "שוויות נתניה",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "באיזה מחיר נמכרו דירות לידך בנתניה?",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "באיזה מחיר נמכרו דירות לידך בנתניה?",
    description: "סקר עסקאות אמיתיות שנמכרו באזורכם, בחינם.",
    images: ["/og-image.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // אין חסימת זום (נגישות). זום אוטומטי של iOS נמנע כי כל שדות הקלט ≥16px.
  interactiveWidget: "resizes-content",
  viewportFit: "cover",
  themeColor: "#ffffff",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "RealEstateAgent",
      "@id": `${BASE_URL}/#agent`,
      name: process.env.NEXT_PUBLIC_AGENT_NAME || "מתווך מורשה נתניה",
      description: "מתווך נדל\"ן מורשה המתמחה בשוק הדיור בנתניה — סקרי מחירים, ליווי מכירה ורכישה.",
      url: BASE_URL,
      areaServed: {
        "@type": "City",
        name: "נתניה",
        addressCountry: "IL",
      },
      hasCredential: {
        "@type": "EducationalOccupationalCredential",
        credentialCategory: "רישיון מתווך",
        recognizedBy: { "@type": "Organization", name: "משרד המשפטים" },
      },
    },
    {
      "@type": "WebApplication",
      "@id": `${BASE_URL}/#app`,
      name: "סקר עסקאות נדל\"ן נתניה",
      description: "כלי חינמי להצגת עסקאות נדל\"ן שנמכרו בנתניה, לפי מאגר רשות המסים.",
      url: BASE_URL,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Any",
      offers: { "@type": "Offer", price: "0", priceCurrency: "ILS" },
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "באיזה מחיר נמכרו דירות לידי בנתניה?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "מקלידים רחוב ומספר בית ורואים עסקאות אמיתיות שנמכרו בבניין, ברחוב ובסביבה, כפי שדווחו לרשות המסים.",
          },
        },
        {
          "@type": "Question",
          name: "האם זו הערכת שווי?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "לא. האתר מציג סקר מחירים לפי עסקאות שדווחו לרשות המסים. הוא אינו קובע את שווי הנכס ואינו שומת מקרקעין.",
          },
        },
        {
          "@type": "Question",
          name: "האם השירות בחינם?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "כן, הכלי חינמי לחלוטין ללא עלות וללא התחייבות.",
          },
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Preconnect לגופן — מפחית FOUC */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Rubik — the only typeface (preload + stylesheet) */}
        <link
          rel="preload"
          as="style"
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;800;900&display=swap"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;700;800;900&display=swap"
          rel="stylesheet"
        />
        {/* הגדרות תפריט הנגישות של המבקר — לפני הציור הראשון, בלי הבהוב */}
        <script dangerouslySetInnerHTML={{ __html: A11Y_BOOT_SCRIPT }} />
        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-screen bg-white text-ink antialiased">
        <Analytics />
        {children}
        <WhatsAppButton />
        <AccessibilityMenu />
      </body>
    </html>
  );
}
