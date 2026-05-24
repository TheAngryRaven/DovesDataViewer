import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Build-time loader for external plugin npm packages (the AI coach). Candidate
// package names default to the public coach and can be overridden via the
// DOVE_PLUGIN_PACKAGES env var (comma-separated). Only packages actually
// present in node_modules are imported, so a fresh clone that skips optional
// deps still compiles to an empty plugin list. See src/plugins/.
function externalPluginsLoader(candidates: string[]): Plugin {
  const VIRTUAL = "virtual:external-plugins";
  const RESOLVED = "\0" + VIRTUAL;
  const isInstalled = (pkg: string) =>
    fs.existsSync(path.resolve(__dirname, "node_modules", ...pkg.split("/"), "package.json"));
  return {
    name: "dove-external-plugins",
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      const present = candidates.filter(isInstalled);
      const imports = present.map((p, i) => `import p${i} from ${JSON.stringify(p)};`).join("\n");
      const list = present.map((_, i) => `p${i}`).join(", ");
      return `${imports}\nexport default [${list}];\n`;
    },
  };
}

const PUBLIC_BACKEND_FALLBACKS = {
  VITE_SUPABASE_PROJECT_ID: "svjlieovpyiffbqwhtgk",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2amxpZW92cHlpZmZicXdodGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwMDQ1MzcsImV4cCI6MjA4NjU4MDUzN30.-LnwDsiT1vmWxfoLiHlK9hHqCzN9ToHeB6qkH5-A2I4",
  VITE_SUPABASE_URL: "https://svjlieovpyiffbqwhtgk.supabase.co",
  // Admin + registration default OFF in fallbacks. The production deploy
  // enables them via Lovable Cloud env injection ("true"). A new contributor
  // cloning the repo without a .env should see the public app, not admin UI
  // pointing at a backend they don't control.
  VITE_ENABLE_ADMIN: "false",
  // Cloud auth + sync (public user accounts, Google sign-in, Cloud Sync Labs
  // panel). Default OFF — the repo's offline-first invariant means a fresh
  // clone with no .env never touches the cloud. Production deploys flip this
  // to "true" via Lovable Cloud env injection.
  VITE_ENABLE_CLOUD: "false",
} as const;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const DEFAULT_PLUGIN_PACKAGES = "@perchwerks/eye-in-the-sky";
  const pluginPackages = (env.DOVE_PLUGIN_PACKAGES || DEFAULT_PLUGIN_PACKAGES)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    server: {
      host: "::",
      port: 8080,
    },
    define: {
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(
        env.VITE_SUPABASE_PROJECT_ID || PUBLIC_BACKEND_FALLBACKS.VITE_SUPABASE_PROJECT_ID,
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        env.VITE_SUPABASE_PUBLISHABLE_KEY || PUBLIC_BACKEND_FALLBACKS.VITE_SUPABASE_PUBLISHABLE_KEY,
      ),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        env.VITE_SUPABASE_URL || PUBLIC_BACKEND_FALLBACKS.VITE_SUPABASE_URL,
      ),
      "import.meta.env.VITE_ENABLE_ADMIN": JSON.stringify(
        env.VITE_ENABLE_ADMIN || PUBLIC_BACKEND_FALLBACKS.VITE_ENABLE_ADMIN,
      ),
      "import.meta.env.VITE_ENABLE_CLOUD": JSON.stringify(
        env.VITE_ENABLE_CLOUD || PUBLIC_BACKEND_FALLBACKS.VITE_ENABLE_CLOUD,
      ),
    },
    plugins: [
      react(),
      externalPluginsLoader(pluginPackages),
      mode === "development" && componentTagger(),
      VitePWA({
        filename: "service-worker.js",
        registerType: "autoUpdate",
        devOptions: {
          enabled: false,
        },
        includeAssets: ["favicon.png", "favicon.ico", "robots.txt", "tracks.json", "samples/**/*"],
        manifest: {
          name: "HackTheTrack - Motorsport Data Viewer",
          short_name: "HackTheTrack",
          description: "Open source motorsport data acquisition and analytics",
          theme_color: "#1a1a2e",
          background_color: "#0f0f1a",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "apple-touch-icon-180x180.png",
              sizes: "180x180",
              type: "image/png",
              purpose: "apple touch icon" as string,
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,json,nmea}"],
          globIgnores: ["**/tracks.zip"],
          navigateFallbackDenylist: [/^\/~oauth/],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "app-html",
                networkTimeoutSeconds: 3,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/.*\.basemaps\.cartocdn\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "map-tiles-carto",
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/server\.arcgisonline\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "map-tiles-esri",
                expiration: {
                  maxEntries: 500,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      // Split heavy vendor libs into their own chunks so they cache
      // independently across deploys. Each entry below becomes a separate
      // file in /dist/assets; a deploy that only touches app code lets users
      // re-use the existing vendor chunks instead of re-downloading them.
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-react": ["react", "react-dom", "react-router-dom"],
            "vendor-query": ["@tanstack/react-query"],
            "vendor-leaflet": ["leaflet"],
            "vendor-supabase": ["@supabase/supabase-js"],
            // Radix is many small packages; group them into one chunk.
            "vendor-radix": [
              "@radix-ui/react-collapsible",
              "@radix-ui/react-dialog",
              "@radix-ui/react-label",
              "@radix-ui/react-select",
              "@radix-ui/react-separator",
              "@radix-ui/react-slider",
              "@radix-ui/react-slot",
              "@radix-ui/react-switch",
              "@radix-ui/react-tabs",
              "@radix-ui/react-toast",
              "@radix-ui/react-tooltip",
            ],
          },
        },
      },
    },
  };
});
