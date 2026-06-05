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
      // Coverage is scoped to *logic* worth unit-testing (parsers, utilities,
      // protocol code, hooks, plugins). The React view layer is deliberately
      // out of scope — presentational components, route/page shells, and
      // context providers are validated by integration/visual testing, not
      // Vitest line coverage. We exclude view code, NOT untested logic: hooks
      // and lib/ stay in the report so the number is an honest signal.
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/components/**/*.tsx", // presentational React components (keeps video-overlays/*.ts logic in scope)
        "src/pages/**", // route/page shells — view layer
        "src/contexts/**", // provider wiring — view layer
        "src/App.tsx", // app shell / routing
        "src/components/ui/**", // vendored shadcn/ui primitives
        "src/integrations/supabase/**", // auto-generated — DO NOT EDIT
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      // Floors guard against regressions in the logic we test. Set a few points
      // below current actuals so routine churn doesn't redden CI; ratchet up as
      // coverage grows.
      thresholds: {
        lines: 50,
        functions: 45,
        branches: 45,
        statements: 49,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
