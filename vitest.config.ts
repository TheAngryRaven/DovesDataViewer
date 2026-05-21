/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

// Minimal Vitest config — keeps test concerns out of vite.config.ts so the
// PWA/build pipeline isn't loaded for unit tests.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", ".lovable"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
