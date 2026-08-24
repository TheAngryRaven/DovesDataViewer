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
// Pure version comparison — TWO comparators, because there are two questions
// ---------------------------------------------------------------------------
//
// A beta firmware is stamped `<base>-beta.<gitsha>` (the logger's beta workflow
// passes `-DFIRMWARE_VERSION_OVERRIDE`), so "4.1.0-beta.a1b2c3d" and "4.1.0"
// are both real strings a device can report. They must be ordered one way for
// one question and the other way for the other, and conflating the two is how
// this file shipped a bug:
//
//   - **"Does this firmware have feature X?"** — a capability gate.
//     `4.1.0-beta.<sha>` was cut FROM 4.1.0, so it has 4.1.0's features and
//     must compare EQUAL to it. That is {@link compareVersions}.
//   - **"Is the published build newer than what's installed?"** — release
//     ordering. Semver is explicit here (spec §11): a prerelease has LOWER
//     precedence than its release, so `4.1.0` is an upgrade from
//     `4.1.0-beta.<sha>`. That is {@link compareReleases}.
//
// Before this split there was only the first, and `isUpdateAvailable()` used
// it — so a device on `4.1.0-beta.<sha>` was told it was already up to date
// when the real 4.1.0 shipped, with no way to move to the official build.
//
// **Do not "de-duplicate" these into one function.** They share the numeric
// core comparison (`compareReleases` literally calls `compareVersions` for it),
// and that is as far as the sharing goes.

function versionCore(v: string): number[] {
  // Strip a leading 'v' and any build/prerelease suffix, then split on dots.
  const core = v.trim().replace(/^v/i, "").split(/[-+]/)[0];
  return core.split(".").map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * Compare two versions on their **numeric core only** — the capability
 * comparator. Returns -1 if a<b, 0 if equal, 1 if a>b. Prerelease and build
 * suffixes are ignored, so `4.1.0-beta.<sha>` compares equal to `4.1.0`.
 *
 * This is the right comparison for "does this firmware carry feature X",
 * because a beta cut from a release carries that release's features
 * (`supportsLargeTrackBuffer`, `needsOtaLayoutUpgrade`).
 *
 * It is the WRONG comparison for deciding whether an update is available —
 * use {@link compareReleases}. Pure.
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
 * Prerelease identifiers of a version, or `null` when it has none.
 * `"4.1.0-beta.3"` → `["beta", "3"]`; `"4.1.0"` → `null`.
 *
 * Build metadata (`+…`) is stripped first and never affects precedence
 * (semver §10), so `4.1.0+ci7` and `4.1.0` are the same release.
 */
function prereleaseIds(v: string): string[] | null {
  const noBuild = v.trim().replace(/^v/i, "").split("+")[0];
  const dash = noBuild.indexOf("-");
  if (dash < 0) return null;
  const pre = noBuild.slice(dash + 1);
  return pre ? pre.split(".") : null;
}

/** Semver §11 precedence for the prerelease portion of two equal cores. */
function comparePrerelease(a: string[] | null, b: string[] | null): -1 | 0 | 1 {
  if (a === null && b === null) return 0;
  // "A pre-release version has lower precedence than the associated normal
  // version" — this line is the whole point of the split.
  if (a === null) return 1;
  if (b === null) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ia = a[i];
    const ib = b[i];
    // "A larger set of pre-release fields has a higher precedence than a
    // smaller set, if all of the preceding identifiers are equal."
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;

    const na = /^\d+$/.test(ia) ? parseInt(ia, 10) : null;
    const nb = /^\d+$/.test(ib) ? parseInt(ib, 10) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    // "Numeric identifiers always have lower precedence than alphanumeric."
    if (na !== null) return -1;
    if (nb !== null) return 1;
    // ASCII sort order — JS string comparison is UTF-16 code units, which
    // agrees with ASCII for the [0-9A-Za-z-] identifiers semver allows.
    if (ia !== ib) return ia < ib ? -1 : 1;
  }
  return 0;
}

/**
 * Compare two versions as **releases** — the ordering comparator. Full semver
 * precedence: numeric core first, then a prerelease sorting BELOW its release,
 * with build metadata ignored. Returns -1 if a<b, 0 if equal, 1 if a>b.
 *
 * `compareReleases("4.1.0", "4.1.0-beta.a1b2c3d") === 1` — the official build
 * always supersedes the beta it was cut from, which is the case that motivated
 * this function.
 *
 * Ordering **between** two betas of the same core falls out of the git shas,
 * which is arbitrary rather than chronological. That is accepted: nothing
 * decides anything important on it, and a tester who needs a specific beta has
 * the force path. Pure.
 */
export function compareReleases(a: string, b: string): -1 | 0 | 1 {
  const core = compareVersions(a, b);
  if (core !== 0) return core;
  return comparePrerelease(prereleaseIds(a), prereleaseIds(b));
}

/**
 * True when `latest` is strictly newer than `installed`, as **releases** — so
 * the official `4.1.0` reads as newer than `4.1.0-beta.<sha>`. Returns `false`
 * when the installed version is unknown (`null`) so we never nag without
 * certainty. Pure.
 */
export function isUpdateAvailable(
  installed: string | null | undefined,
  latest: string,
): boolean {
  if (!installed) return false;
  return compareReleases(latest, installed) > 0;
}

/**
 * Why the version check was bypassed, when it was. Reported separately from
 * {@link FirmwareUpdateReason} because `"forced"` alone doesn't say who forced
 * it, and the three cases need different copy:
 *
 *  - `"preview"` — a beta/preview build of THIS APP always pushes firmware
 *    through so testers can re-flash freely.
 *  - `"user"` — someone asked outright, via the "Force update…" button or the
 *    "Install anyway" action on the up-to-date toast. A deliberate reinstall
 *    or downgrade.
 *  - `"unknown"` — the installed version couldn't be read, so there was
 *    nothing to compare against. Reachable from BOTH flows: the native one
 *    offers the build anyway when the handshake carries no version (and when
 *    the user picks the variant by hand), and on the web any forced check —
 *    a preview build's automatic one included — lands here rather than on
 *    `"user"`/`"preview"` when the DIS read came back empty. See
 *    {@link forceKindFor} for that tie-break.
 */
export type FirmwareForceKind = "preview" | "user" | "unknown" | null;

/**
 * Which flavour of "the version check was skipped" to report.
 *
 * A user-initiated force on a device whose version couldn't be read is BOTH
 * `"user"` and `"unknown"`, and {@link evaluateFirmwareUpdate} resolves `force`
 * before `no-version`, so `reason` alone can't separate them. **`"unknown"`
 * wins**: it is the more informative of the two — it explains why the dialog
 * can't name what you're upgrading *from* — and "you asked for this" is not
 * news to the person who pressed the button. Pure.
 */
export function forceKindFor(
  reason: FirmwareUpdateReason,
  userRequested: boolean,
  installedVersion: string | null | undefined,
): FirmwareForceKind {
  if (reason !== "forced") return null;
  if (!installedVersion) return "unknown";
  return userRequested ? "user" : "preview";
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
