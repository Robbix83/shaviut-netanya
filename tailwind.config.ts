import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#0d3efb",
          dark: "#0a2fc2",
          light: "#e8edff",
          glow: "#6b93ff",
        },
        ink: "#0f172a",
        "hero-dark": "#060d24",   // deep navy hero background
      },
      fontFamily: {
        sans: ["Heebo", "system-ui", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 10px 40px -12px rgba(13,62,251,0.18)",
        glow: "0 0 40px rgba(13,62,251,0.35)",
        "glow-lg": "0 0 60px rgba(13,62,251,0.5)",
      },
      backgroundImage: {
        "hero-gradient": "linear-gradient(135deg, #060d24 0%, #0d1a4a 50%, #0a1035 100%)",
        "brand-gradient": "linear-gradient(135deg, #0d3efb 0%, #3b5fff 100%)",
      },
      animation: {
        "fade-up": "fadeUp 0.6s ease forwards",
        "fade-in": "fadeIn 0.4s ease forwards",
        "shimmer": "shimmer 2.5s infinite",
        ping: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
