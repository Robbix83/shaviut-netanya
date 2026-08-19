/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: process.env.NODE_ENV === "production",
  // מאפשר גישה מה-IP הרשתי ב-dev (בדיקות מסלולר)
  allowedDevOrigins: ["10.100.102.76"],
  onDemandEntries: {
    maxInactiveAge: 30 * 60 * 1000,
    pagesBufferLength: 5,
  },
};

export default nextConfig;
