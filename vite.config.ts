import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

const PUBLIC_BACKEND_FALLBACKS = {
  VITE_SUPABASE_PROJECT_ID: "svjlieovpyiffbqwhtgk",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2amxpZW92cHlpZmZicXdodGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwMDQ1MzcsImV4cCI6MjA4NjU4MDUzN30.-LnwDsiT1vmWxfoLiHlK9hHqCzN9ToHeB6qkH5-A2I4",
  VITE_SUPABASE_URL: "https://svjlieovpyiffbqwhtgk.supabase.co",
  VITE_ENABLE_ADMIN: "true",
  VITE_ENABLE_REGISTRATION: "true",
} as const;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

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
      "import.meta.env.VITE_ENABLE_REGISTRATION": JSON.stringify(
        env.VITE_ENABLE_REGISTRATION || PUBLIC_BACKEND_FALLBACKS.VITE_ENABLE_REGISTRATION,
      ),
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      VitePWA({
      registerType: "autoUpdate",
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
            // vite-plugin-pwa's manifest icon `purpose` type doesn't include
            // "apple touch icon" but iOS supports it; widen to string.
            purpose: "apple touch icon" as string,
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,json,nmea}"],
        globIgnores: ["**/tracks.zip"],
        navigateFallbackDenylist: [/^\/~oauth/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.basemaps\.cartocdn\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles-carto",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
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
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
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
  };
});
