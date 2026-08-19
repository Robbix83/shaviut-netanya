import { defineConfig } from "vitest/config";
import path from "path";

// Minimal Vitest setup for Wave 0A-1 characterization tests.
// Node environment (route handlers + crypto), with the "@/" path alias mapped to repo root.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "audit/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
