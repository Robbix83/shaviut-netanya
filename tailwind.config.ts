import type { Config } from "tailwindcss";

export default {
  // hover: utilities only apply on devices with a real hover + fine pointer (no sticky hover after a tap)
  future: { hoverOnlyWhenSupported: true },
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // direction A ("חוף נקי"): white ground, black controls, one sunset orange
        brand: {
          DEFAULT: "#c2410c",   // deep sunset orange: white text on it passes AA
          dark: "#9a3412",
          light: "#fff1e6",
          glow: "#c2410c",
        },
        ink: "#0c0c0b",
        butter: {
          DEFAULT: "#f4f4f5",   // neutral light ground (light pages, wizard surfaces)
          soft: "#f6f6f7",      // card surface on white
          deep: "#e8e8ea",      // tone step (chips, tracks)
        },
        sun: "#ff8a3d",         // the bright sunset: the homepage's own action
        night: "#0c0c0b",       // the cinema ground of the homepage
        "hero-dark": "#060d24",   // legacy (admin/report surfaces)
      },
      fontFamily: {
        sans: ["Rubik", "system-ui", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 24px 60px -30px rgba(0,0,0,0.35)",
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
