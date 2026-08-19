"use client";
import Script from "next/script";

export default function Analytics() {
  const ga4Id = process.env.NEXT_PUBLIC_GA4_ID;
  const fbId = process.env.NEXT_PUBLIC_FB_PIXEL_ID;
  if (!ga4Id && !fbId) return null;
  return (
    <>
      {ga4Id && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">{`
            window.dataLayer=window.dataLayer||[];
            function gtag(){dataLayer.push(arguments);}
            gtag('js',new Date());
            gtag('config','${ga4Id}');
          `}</Script>
        </>
      )}
      {fbId && (
        <Script id="fb-pixel" strategy="afterInteractive">{`
          !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){
            n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)
          };if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
          s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)
          }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
          fbq('init','${fbId}');
          fbq('track','PageView');
        `}</Script>
      )}
    </>
  );
}
