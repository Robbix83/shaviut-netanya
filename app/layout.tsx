import type { Metadata, Viewport } from "next";
import "./globals.css";
import Analytics from "@/components/Analytics";
import WhatsAppButton from "@/components/WhatsAppButton";

const BASE_URL = "https://shaviut-netanya.co.il"; // TODO: החלף בדומיין האמיתי

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: "כמה שווה הדירה שלך בנתניה? | סקירת מחירים לפי עסקאות אמיתיות",
  description:
    "גלו בחינם אינדיקציית מחיר לדירה שלכם בנתניה לפי עסקאות אמיתיות שנמכרו באזורכם. דוח מחירים מיידי ומבוסס נתונים (אינו הערכת שמאי).",
  keywords: ["שווי דירה נתניה", "הערכת שווי דירה", "מחירי דירות נתניה", "מתווך נתניה", "עסקאות נדלן נתניה"],
  alternates: {
    canonical: BASE_URL,
  },
  openGraph: {
    title: "כמה שווה הדירה שלך בנתניה?",
    description: "סקירת מחירים לפי עסקאות אמיתיות שנמכרו באזורכם — בחינם ומיידי.",
    locale: "he_IL",
    type: "website",
    url: BASE_URL,
    siteName: "שווי דירה נתניה",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "כמה שווה הדירה שלך בנתניה?",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "כמה שווה הדירה שלך בנתניה?",
    description: "דוח שווי מיידי לפי עסקאות אמיתיות — בחינם.",
    images: ["/og-image.jpg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,   // מונע zoom אוטומטי של iOS על שדות קלט (נראה כמו ריענון)
  viewportFit: "cover",
  themeColor: "#0d3efb",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "RealEstateAgent",
      "@id": `${BASE_URL}/#agent`,
      name: process.env.NEXT_PUBLIC_AGENT_NAME || "מתווך מורשה נתניה",
      description: "מתווך נדל\"ן מורשה המתמחה בשוק הדיור בנתניה — הערכות שווי, ליווי מכירה ורכישה.",
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
      name: "מחשבון שווי דירה נתניה",
      description: "כלי חינמי לאומדן שווי נכסי מגורים בנתניה, מבוסס עסקאות אמיתיות ממאגר רשות המסים.",
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
          name: "כמה שווה הדירה שלי בנתניה?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "הכנס את פרטי הדירה (שכונה, מספר חדרים, שטח, קומה) ותקבל אומדן מחיר תוך 30 שניות, מבוסס על עסקאות אמיתיות שנמכרו באזורך.",
          },
        },
        {
          "@type": "Question",
          name: "האם הערכת השווי מהימנה?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "ההערכה מבוססת על עסקאות ממאגר רשות המסים ומהווה אינדיקציה בלבד. היא אינה תחליף להערכת שמאי מוסמך.",
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
    <html lang="he" dir="rtl">
      <head>
        {/* Preconnect לגופן — מפחית FOUC */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Preload Heebo Bold (המשקל הכבד ביותר — נטען ראשון) */}
        <link
          rel="preload"
          as="style"
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
        {/* JSON-LD Structured Data */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-screen bg-slate-50 text-ink antialiased">
        <Analytics />
        {children}
        <WhatsAppButton />
      </body>
    </html>
  );
}
