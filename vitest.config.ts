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
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/components/ui/**", // vendored shadcn/ui primitives
        "src/integrations/supabase/**", // auto-generated — DO NOT EDIT
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      // Gate intentionally low so it can be ratcheted up later as coverage grows.
      thresholds: {
        lines: 1,
        functions: 1,
        branches: 1,
        statements: 1,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
