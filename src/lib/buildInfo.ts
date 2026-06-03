// Build-time version metadata, surfaced in the landing-page footer so it's easy
// to tell at a glance which revision is deployed. The raw values are injected by
// Vite's `define` (see vite.config.ts) from package.json + git at build time.

export interface BuildInfo {
  /** App version from package.json (e.g. "2.0.0"). */
  version: string;
  /** Short git commit hash, or "unknown" when it couldn't be resolved. */
  commit: string;
  /** ISO build timestamp, or "" when unavailable. */
  buildDate: string;
}

const GITHUB_REPO = "TheAngryRaven/DovesDataViewer";

export const buildInfo: BuildInfo = {
  version: import.meta.env.VITE_APP_VERSION ?? "0.0.0",
  commit: import.meta.env.VITE_GIT_HASH ?? "unknown",
  buildDate: import.meta.env.VITE_BUILD_DATE ?? "",
};

/** True when we have a real commit hash worth linking/displaying. */
export function hasCommit(info: BuildInfo = buildInfo): boolean {
  return !!info.commit && info.commit !== "unknown";
}

/** Short human label, e.g. "v2.0.0 · 837b514" (omits the hash if unknown). */
export function formatBuildLabel(info: BuildInfo = buildInfo): string {
  return hasCommit(info) ? `v${info.version} · ${info.commit}` : `v${info.version}`;
}

/** GitHub commit URL for the build's hash, or null when there's no real hash. */
export function commitUrl(info: BuildInfo = buildInfo): string | null {
  return hasCommit(info) ? `https://github.com/${GITHUB_REPO}/commit/${info.commit}` : null;
}
