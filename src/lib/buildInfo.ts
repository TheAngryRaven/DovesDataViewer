// Build-time version metadata, surfaced in the landing-page footer so it's easy
// to tell at a glance which revision is deployed. The raw values are injected by
// Vite's `define` (see vite.config.ts) from package.json + git at build time.
//
// The footer stamp has two modes, mirroring the _PREVIEW backend switch:
//   - `main` build      → "v2.0.0 · 837b514"          (version + hash)
//   - any other branch  → "my-branch · 837b514 · <commit time>"

export interface BuildInfo {
  /** App version from package.json (e.g. "2.0.0"). */
  version: string;
  /** Short git commit hash, or "unknown" when it couldn't be resolved. */
  commit: string;
  /** ISO build timestamp, or "" when unavailable. */
  buildDate: string;
  /** Branch the build came from, or "unknown" when it couldn't be resolved. */
  branch: string;
  /** ISO commit (committer) date of the build's commit, or "" when unavailable. */
  commitDate: string;
}

const GITHUB_REPO = "TheAngryRaven/DovesDataViewer";
const PROD_BRANCH = "main";

export const buildInfo: BuildInfo = {
  version: import.meta.env.VITE_APP_VERSION ?? "0.0.0",
  commit: import.meta.env.VITE_GIT_HASH ?? "unknown",
  buildDate: import.meta.env.VITE_BUILD_DATE ?? "",
  branch: import.meta.env.VITE_GIT_BRANCH ?? "unknown",
  commitDate: import.meta.env.VITE_GIT_COMMIT_DATE ?? "",
};

/** True when we have a real commit hash worth linking/displaying. */
export function hasCommit(info: BuildInfo = buildInfo): boolean {
  return !!info.commit && info.commit !== "unknown";
}

/**
 * True for a build off any branch other than `main` (a known, non-prod branch).
 * An unknown branch falls back to the production stamp.
 */
export function isPreviewBuild(info: BuildInfo = buildInfo): boolean {
  return !!info.branch && info.branch !== "unknown" && info.branch !== PROD_BRANCH;
}

/** Human-readable commit time (UTC), e.g. "Jun 3, 2026, 3:28 AM UTC"; "" if unparseable. */
export function formatCommitTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/**
 * Footer stamp label. On `main`: "v{version} · {hash}". On any other branch:
 * "{branch} · {hash} · {commit time}". Missing parts are dropped gracefully.
 */
export function formatBuildLabel(info: BuildInfo = buildInfo): string {
  if (isPreviewBuild(info)) {
    const parts = [info.branch];
    if (hasCommit(info)) parts.push(info.commit);
    const time = formatCommitTime(info.commitDate);
    if (time) parts.push(time);
    return parts.join(" · ");
  }
  return hasCommit(info) ? `v${info.version} · ${info.commit}` : `v${info.version}`;
}

/** GitHub commit URL for the build's hash, or null when there's no real hash. */
export function commitUrl(info: BuildInfo = buildInfo): string | null {
  return hasCommit(info) ? `https://github.com/${GITHUB_REPO}/commit/${info.commit}` : null;
}
