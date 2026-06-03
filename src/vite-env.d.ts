/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** App version, baked in from package.json at build time. */
  readonly VITE_APP_VERSION?: string;
  /** Short git commit hash of the build (or "unknown" if unavailable). */
  readonly VITE_GIT_HASH?: string;
  /** ISO timestamp of when the bundle was built. */
  readonly VITE_BUILD_DATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
