/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** App version, baked in from package.json at build time. */
  readonly VITE_APP_VERSION?: string;
  /** Short git commit hash of the build (or "unknown" if unavailable). */
  readonly VITE_GIT_HASH?: string;
  /** ISO timestamp of when the bundle was built. */
  readonly VITE_BUILD_DATE?: string;
  /** Branch the build came from (or "unknown"). Drives the footer stamp mode. */
  readonly VITE_GIT_BRANCH?: string;
  /** ISO commit (committer) date of the build's commit. */
  readonly VITE_GIT_COMMIT_DATE?: string;
  /**
   * "true" for a bundle built for the native (Tauri/Android) shell. Gates
   * native-only behaviour (no service worker, no in-app purchases, external
   * links via the system browser). Defaults to "false" — see lib/platform.ts.
   */
  readonly VITE_IS_NATIVE?: string;
  /**
   * PostHog project key for anonymous usage statistics (plan 0030). Unset →
   * no analytics at all (self-hosters, local dev). See lib/analytics.ts.
   */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingest host override (EU cloud or a reverse proxy). Defaults to the US cloud. */
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
