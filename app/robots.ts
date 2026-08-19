import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = "https://shaviut-netanya.co.il"; // החלף בדומיין האמיתי

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms"],
        disallow: ["/admin/", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
