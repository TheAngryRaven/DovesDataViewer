import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { VitePWA } from "vite-plugin-pwa";
import { resolveBranchBackend } from "./scripts/resolveSupabaseBranch";

// Build-time version metadata for the footer "what changed" stamp. The app
// version comes from package.json; the commit hash + build date are baked in at
// build so a deployed bundle can show exactly which revision is live. The CI
// commit-SHA env vars are preferred (Cloudflare Workers Builds / Pages, generic
// CI) so the hash is correct even on a shallow checkout; we fall back to a local
// `git` call for dev, and to "unknown" when neither is available.
function readAppVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function gitShortHash(): string {
  const fromEnv =
    process.env.WORKERS_CI_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { cwd: __dirname }).toString().trim();
  } catch {
    return "unknown";
  }
}

// Branch the build came from. Drives the footer stamp's mode: `main` shows the
// version + hash; any other branch shows branch + hash + commit time (mirrors
// the _PREVIEW backend switch). CI branch env vars are preferred so it's right
// on detached/shallow CI checkouts, falling back to local `git`, then "unknown".
function gitBranch(): string {
  const fromEnv =
    process.env.WORKERS_CI_BRANCH || process.env.CF_PAGES_BRANCH || process.env.GITHUB_REF_NAME;
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: __dirname }).toString().trim();
  } catch {
    return "unknown";
  }
}

// ISO timestamp of the build's commit (committer date), for the preview stamp.
function gitCommitDate(): string {
  try {
    return execSync("git log -1 --format=%cI", { cwd: __dirname }).toString().trim();
  } catch {
    return "";
  }
}

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
  // No public backend is baked in — supply your own Supabase credentials via
  // VITE_*/HTT_* env (or a committed `.env`) to enable admin/cloud features.
  // Left blank, the app runs fully offline-first with no backend wired up.
  VITE_SUPABASE_PROJECT_ID: "",
  VITE_SUPABASE_PUBLISHABLE_KEY: "",
  VITE_SUPABASE_URL: "",
  // Admin + cloud default OFF in fallbacks. The production deploy enables them
  // via env injection ("true") / committed `.env` / HTT_* build
  // secrets. A new contributor cloning the repo without a .env must see the
  // public, offline-first app — NOT the admin UI or live cloud-sync pointing at
  // a backend they don't control. Anyone who hosts that build would otherwise
  // expose admin surfaces and account features for an upstream backend.
  VITE_ENABLE_ADMIN: "false",
  // Cloud auth + sync (public user accounts, Google sign-in, Cloud Sync
  // panels). Defaulted OFF for the same reason — a fresh build is offline-only
  // until the operator explicitly opts in via VITE_*/HTT_* env. The production
  // deploy sets this to "true".
  VITE_ENABLE_CLOUD: "false",
  // The web app is the default target; the Tauri/Android build sets this to
  // "true" (VITE_IS_NATIVE / HTT_IS_NATIVE) so the bundle skips the service
  // worker, hides in-app purchases (web-only billing for Google Play), and
  // routes external links through the system browser. See lib/platform.ts.
  VITE_IS_NATIVE: "false",
} as const;

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Some secret stores reject the `VITE_` prefix (those are public, build-time
  // values by Vite convention). To let contributors stash the backend wiring in
  // workspace build secrets *without* committing a `.env`, we also accept a
  // parallel `HTT_` prefix and copy it into the VITE_* names at build time.
  // Precedence: VITE_* > HTT_* > public fallback.
  //
  // NOTE: Vite's loadEnv() only reads .env files — it does NOT include
  // process.env. Some hosts inject build secrets as real env vars, so we must
  // check process.env explicitly for the HTT_* (and VITE_*) fallbacks to work
  // when there's no committed .env file.
  //
  // PREVIEW BACKEND: Cloudflare Workers Builds sets WORKERS_CI_BRANCH on every
  // build (Pages sets CF_PAGES_BRANCH). On any non-production branch we prefer
  // parallel `*_PREVIEW` build variables (VITE_*_PREVIEW / HTT_*_PREVIEW), so a
  // beta/preview deployment bakes in the Supabase **preview-branch** database
  // instead of production. Production (`main`) builds and local dev never see
  // the _PREVIEW values, so they're untouched. The creds are build-time-baked,
  // not runtime — picking them here is the only place to switch backends.
  const ciBranch = process.env.WORKERS_CI_BRANCH || process.env.CF_PAGES_BRANCH;
  const PROD_BRANCH = "main";
  const isPreviewBuild = !!ciBranch && ciBranch !== PROD_BRANCH;

  const pick = (viteKey: string, httKey: string, fallback: string, override?: string) => {
    // A resolved per-branch Supabase preview DB (see below) wins over everything:
    // it's the whole point — this branch's own ephemeral database.
    if (override) return override;
    if (isPreviewBuild) {
      const previewVal =
        env[`${viteKey}_PREVIEW`] ||
        process.env[`${viteKey}_PREVIEW`] ||
        env[`${httKey}_PREVIEW`] ||
        process.env[`${httKey}_PREVIEW`];
      if (previewVal) return previewVal;
    }
    return env[viteKey] || process.env[viteKey] || env[httKey] || process.env[httKey] || fallback;
  };

  // DYNAMIC PER-BRANCH BACKEND: on a preview build, ask the Supabase Management
  // API whether a preview-branch database exists for THIS git branch and, if so,
  // bake in its creds instead of the one static beta DB. This is the only thing
  // that makes branch-specific databases reachable from branch-specific previews.
  // Requires a SUPABASE_ACCESS_TOKEN build secret; without it (or when the branch
  // has no DB changes, so Supabase made no branch) `branchBackend` stays null and
  // pick() falls through to the existing `_PREVIEW`/beta chain — today's behaviour.
  // The resolver never throws and times out fast, so it can't break a deploy.
  const prodProjectRef =
    env.VITE_SUPABASE_PROJECT_ID ||
    process.env.VITE_SUPABASE_PROJECT_ID ||
    env.HTT_SUPABASE_PROJECT_ID ||
    process.env.HTT_SUPABASE_PROJECT_ID ||
    "";
  const branchBackend = isPreviewBuild
    ? await resolveBranchBackend({
        gitBranch: ciBranch ?? "",
        prodProjectRef,
        accessToken: process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || "",
      })
    : null;
  if (branchBackend) {
    console.log(
      `[supabase-branch] using preview DB ${branchBackend.projectId} for branch "${ciBranch}"`,
    );
  }

  const appVersion = readAppVersion();
  const gitHash = gitShortHash();
  const buildDate = new Date().toISOString();
  const branch = gitBranch();
  const commitDate = gitCommitDate();

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
        pick("VITE_SUPABASE_PROJECT_ID", "HTT_SUPABASE_PROJECT_ID", PUBLIC_BACKEND_FALLBACKS.VITE_SUPABASE_PROJECT_ID, branchBackend?.projectId),
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        pick("VITE_SUPABASE_PUBLISHABLE_KEY", "HTT_SUPABASE_PUBLISHABLE_KEY", PUBLIC_BACKEND_FALLBACKS.VITE_SUPABASE_PUBLISHABLE_KEY, branchBackend?.anonKey),
      ),
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        pick("VITE_SUPABASE_URL", "HTT_SUPABASE_URL", PUBLIC_BACKEND_FALLBACKS.VITE_SUPABASE_URL, branchBackend?.url),
      ),
      "import.meta.env.VITE_ENABLE_ADMIN": JSON.stringify(
        pick("VITE_ENABLE_ADMIN", "HTT_ENABLE_ADMIN", PUBLIC_BACKEND_FALLBACKS.VITE_ENABLE_ADMIN),
      ),
      "import.meta.env.VITE_ENABLE_CLOUD": JSON.stringify(
        pick("VITE_ENABLE_CLOUD", "HTT_ENABLE_CLOUD", PUBLIC_BACKEND_FALLBACKS.VITE_ENABLE_CLOUD),
      ),
      "import.meta.env.VITE_IS_NATIVE": JSON.stringify(
        pick("VITE_IS_NATIVE", "HTT_IS_NATIVE", PUBLIC_BACKEND_FALLBACKS.VITE_IS_NATIVE),
      ),
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
      "import.meta.env.VITE_GIT_HASH": JSON.stringify(gitHash),
      "import.meta.env.VITE_BUILD_DATE": JSON.stringify(buildDate),
      "import.meta.env.VITE_GIT_BRANCH": JSON.stringify(branch),
      "import.meta.env.VITE_GIT_COMMIT_DATE": JSON.stringify(commitDate),
    },
    plugins: [
      react(),
      externalPluginsLoader(pluginPackages),
      // Emit a tiny version.json next to the bundle so a running tab can detect a
      // newer deploy without depending on the service worker's own diff-detection
      // (see src/lib/versionCheck.ts). It carries the same build constants baked
      // into buildInfo, so the deployed copy is by definition "latest".
      {
        name: "emit-version-json",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "version.json",
            source: JSON.stringify(
              { version: appVersion, commit: gitHash, buildDate, branch, commitDate },
              null,
              2,
            ),
          });
        },
      } satisfies Plugin,
      VitePWA({
        filename: "service-worker.js",
        registerType: "autoUpdate",
        devOptions: {
          enabled: false,
        },
        includeAssets: ["favicon.png", "favicon.ico", "robots.txt", "tracks.json", "samples/**/*"],
        manifest: {
          name: "LapWing - Motorsport Data Viewer",
          short_name: "LapWing",
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
          // woff2 only: every SW-capable browser supports it, so the legacy
          // .woff fallbacks @fontsource emits would just be dead precache weight.
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,json,nmea,wasm}"],
          // version.json must never be precached — it's the freshness signal the
          // running tab fetches uncached to detect a newer deploy (see versionCheck.ts).
          globIgnores: ["**/tracks.zip", "version.json"],
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
            {
              // Esri Wayback historical satellite imagery (date-picker tiles).
              urlPattern: /^https:\/\/wayback\.maptiles\.arcgis\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "map-tiles-wayback",
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
            "vendor-i18n": ["i18next", "react-i18next"],
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
