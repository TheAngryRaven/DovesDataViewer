/**
 * Firmware OTA manifest: fetch + pure parse / version-compare / build-pick.
 *
 * The manifest is published from the DovesDataLogger repo's GitHub Pages site.
 * GitHub Pages sends permissive CORS, so the browser can fetch both the manifest
 * and the `.zip` packages directly. This is one of the few **online-only**
 * features (like weather / satellite tiles) — firmware binaries can't ship in
 * the offline bundle. A user-provided local `.zip` path stays fully offline.
 */

import { isPreviewBuild } from "@/lib/buildInfo";
import type { FirmwareBuild, FirmwareManifest } from "./dfuTypes";

/** Production OTA manifest URL. */
export const DEFAULT_MANIFEST_URL =
  "https://theangryraven.github.io/DovesDataLogger/manifest.json";

/** Beta-channel OTA manifest — used on non-`main` (preview) builds. */
export const BETA_MANIFEST_URL =
  "https://theangryraven.github.io/DovesDataLogger/beta/manifest.json";

/**
 * Resolve the firmware manifest URL. Precedence:
 *   1. explicit `VITE_FIRMWARE_MANIFEST_URL` override (any branch)
 *   2. the **beta channel** on non-`main`/preview builds (same `isPreviewBuild()`
 *      switch as the footer / preview-DB / forced firmware update)
 *   3. production.
 * `preview` is injectable for tests; it defaults to `isPreviewBuild()`.
 */
export function getManifestUrl(preview: boolean = isPreviewBuild()): string {
  const override = import.meta.env?.VITE_FIRMWARE_MANIFEST_URL;
  if (typeof override === "string" && override) return override;
  return preview ? BETA_MANIFEST_URL : DEFAULT_MANIFEST_URL;
}

// ---------------------------------------------------------------------------
// Pure parsing / validation
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Validate + normalize a parsed JSON value into a {@link FirmwareManifest}.
 * Pure (no I/O); throws on a structurally-invalid manifest.
 */
export function parseFirmwareManifest(json: unknown): FirmwareManifest {
  if (!isRecord(json)) throw new Error("Firmware manifest is not an object");
  const { version, builds } = json;
  if (typeof version !== "string" || !version) {
    throw new Error("Firmware manifest missing 'version'");
  }
  if (!isRecord(builds)) throw new Error("Firmware manifest missing 'builds'");

  const parsedBuilds: Record<string, FirmwareBuild> = {};
  for (const [key, value] of Object.entries(builds)) {
    if (!isRecord(value)) continue;
    const dfuZip = value.dfuZip;
    if (typeof dfuZip !== "string" || !dfuZip) continue; // skip malformed entries
    const variant = typeof value.variant === "string" ? value.variant : key;
    parsedBuilds[key] = {
      name: key,
      variant,
      dfuZip,
      appBin: typeof value.appBin === "string" && value.appBin ? value.appBin : undefined,
      appCrc32:
        typeof value.appCrc32 === "string" && value.appCrc32
          ? value.appCrc32.toLowerCase()
          : undefined,
      appSize:
        typeof value.appSize === "number" && Number.isFinite(value.appSize)
          ? value.appSize
          : undefined,
    };
  }
  if (Object.keys(parsedBuilds).length === 0) {
    throw new Error("Firmware manifest has no usable builds");
  }

  return {
    version,
    releaseTag: typeof json.releaseTag === "string" ? json.releaseTag : undefined,
    publishedAt: typeof json.publishedAt === "string" ? json.publishedAt : undefined,
    releaseNotes:
      typeof json.releaseNotes === "string" ? json.releaseNotes : undefined,
    builds: parsedBuilds,
  };
}

/**
 * Pick the build matching a device variant. Matches the build's `variant`
 * first, then falls back to a `builds` key (exact, or "BirdsEye-<variant>").
 * Returns `null` when nothing matches. Pure.
 */
export function pickBuildForVariant(
  manifest: FirmwareManifest,
  variant: string | null | undefined,
): FirmwareBuild | null {
  if (!variant) return null;
  const want = variant.trim().toLowerCase();
  const builds = Object.values(manifest.builds);
  return (
    builds.find((b) => b.variant.trim().toLowerCase() === want) ??
    builds.find((b) => b.name.trim().toLowerCase() === want) ??
    builds.find((b) => b.name.trim().toLowerCase().endsWith(`-${want}`)) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Pure version comparison (dotted-numeric, tolerant of a leading 'v')
// ---------------------------------------------------------------------------

function versionCore(v: string): number[] {
  // Strip a leading 'v' and any build/prerelease suffix, then split on dots.
  const core = v.trim().replace(/^v/i, "").split(/[-+]/)[0];
  return core.split(".").map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * Compare two dotted versions. Returns -1 if a<b, 0 if equal, 1 if a>b.
 * Prerelease/build suffixes are ignored (compared on the numeric core only).
 * Pure.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = versionCore(a);
  const pb = versionCore(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

/**
 * True when `latest` is strictly newer than `installed`. Returns `false` when
 * the installed version is unknown (`null`) so we never nag without certainty.
 * Pure.
 */
export function isUpdateAvailable(
  installed: string | null | undefined,
  latest: string,
): boolean {
  if (!installed) return false;
  return compareVersions(latest, installed) > 0;
}

/** Why an update is / isn't offered (drives user-facing messaging). */
export type FirmwareUpdateReason =
  | "update" // a newer build is available
  | "forced" // version check bypassed (e.g. a beta/preview build) — always offered
  | "up-to-date" // installed >= latest
  | "no-version" // couldn't read the installed version
  | "no-build"; // no manifest build matches the device variant

/** Result of comparing a device's firmware against the manifest. Pure. */
export interface FirmwareUpdateEvaluation {
  available: boolean;
  reason: FirmwareUpdateReason;
  /** The build to flash (matched by variant), or `null` when none matches. */
  build: FirmwareBuild | null;
  latestVersion: string;
  installedVersion: string | null;
}

/**
 * Decide whether an update is available for a device, given its reported
 * firmware info and the fetched manifest. Pure — no I/O.
 *
 * `force` (used on beta/preview builds) bypasses the version comparison: as long
 * as a build matches the device variant, the update is always offered so testers
 * can re-flash the same or an older version.
 */
export function evaluateFirmwareUpdate(
  info: { version: string | null; variant: string | null },
  manifest: FirmwareManifest,
  options?: { force?: boolean },
): FirmwareUpdateEvaluation {
  const build = pickBuildForVariant(manifest, info.variant);
  const latestVersion = manifest.version;
  if (!build) {
    return {
      available: false,
      reason: "no-build",
      build: null,
      latestVersion,
      installedVersion: info.version,
    };
  }
  if (options?.force) {
    return { available: true, reason: "forced", build, latestVersion, installedVersion: info.version };
  }
  if (!info.version) {
    return { available: false, reason: "no-version", build, latestVersion, installedVersion: null };
  }
  const available = isUpdateAvailable(info.version, latestVersion);
  return {
    available,
    reason: available ? "update" : "up-to-date",
    build,
    latestVersion,
    installedVersion: info.version,
  };
}

/**
 * Verify a freshly-downloaded image against the manifest's published size + CRC
 * (download-integrity, the first link of the full-circle CRC chain). `crcHex` is
 * the CRC-32 the caller computed over `image`. No-op for the fields the manifest
 * omits (older manifests). Throws on a mismatch. Pure.
 */
export function assertImageMatchesBuild(
  build: FirmwareBuild,
  image: Uint8Array,
  crcHex: string,
): void {
  if (build.appSize != null && image.byteLength !== build.appSize) {
    throw new Error(
      `Downloaded firmware is ${image.byteLength} bytes but the manifest expects ${build.appSize} — aborting`,
    );
  }
  if (build.appCrc32 && build.appCrc32.toLowerCase() !== crcHex.toLowerCase()) {
    throw new Error(
      `Downloaded firmware CRC ${crcHex} does not match the manifest CRC ${build.appCrc32} — corrupt download, aborting`,
    );
  }
}

// ---------------------------------------------------------------------------
// Network I/O (fetch injectable for tests)
// ---------------------------------------------------------------------------

type FetchLike = (input: string) => Promise<Response>;

function resolveFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) return fetchImpl;
  if (typeof fetch === "function") return (input) => fetch(input);
  throw new Error("No fetch implementation available");
}

/** Fetch + parse the OTA manifest. Online-only. */
export async function fetchFirmwareManifest(
  url: string = getManifestUrl(),
  fetchImpl?: FetchLike,
): Promise<FirmwareManifest> {
  const res = await resolveFetch(fetchImpl)(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch firmware manifest (HTTP ${res.status})`);
  }
  return parseFirmwareManifest(await res.json());
}

/** Download a firmware `.zip` package as raw bytes. Online-only. */
export async function fetchFirmwarePackage(
  url: string,
  fetchImpl?: FetchLike,
): Promise<ArrayBuffer> {
  const res = await resolveFetch(fetchImpl)(url);
  if (!res.ok) {
    throw new Error(`Failed to download firmware package (HTTP ${res.status})`);
  }
  return res.arrayBuffer();
}
