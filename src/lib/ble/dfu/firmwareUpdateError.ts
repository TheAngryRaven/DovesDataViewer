import { FirmwareProtocolError } from "../firmwareUpload";
import { compareVersions } from "./firmwareManifest";

/**
 * Turning a device-side `FWERR:<token>` into something the user can act on.
 *
 * The one that actually strands people is `SIZE`, and it is counter-intuitive:
 * **the size cap lives in the firmware already installed on the device**, not in
 * the image being delivered and not in this app (which has never enforced a cap
 * of its own — it relays what the device says). Firmware older than
 * `OTA_LAYOUT_MIN_VERSION` carved a 320 KiB staging region out of flash and
 * rejects anything larger at the `FWBEGIN` handshake, before a single image byte
 * is uploaded.
 *
 * So the fix is not to shrink anything — it is to install
 * `OTA_LAYOUT_MIN_VERSION` first (it fits under the old cap and carries the
 * bigger staging region), after which the current build installs normally. A
 * bare "SIZE" gives the user no way to know that.
 *
 * Pure — no I/O, no React.
 */

/**
 * First firmware release whose OTA staging region can accept an image larger
 * than {@link OTA_LEGACY_MAX_BYTES}. Devices below this need one hop through it.
 */
export const OTA_LAYOUT_MIN_VERSION = "3.1.0";

/** Image cap enforced by firmware older than {@link OTA_LAYOUT_MIN_VERSION}. */
export const OTA_LEGACY_MAX_BYTES = 320 * 1024;

export interface FirmwareFailureExplanation {
  /** User-facing replacement for the raw protocol token. */
  message: string;
  /**
   * True when the remedy is a staged update through
   * {@link OTA_LAYOUT_MIN_VERSION} rather than anything the user did wrong.
   */
  needsLayoutUpgrade: boolean;
}

export interface FirmwareFailureContext {
  /** Version reported by the device over DIS, when it could be read. */
  installedVersion?: string | null;
  /** Size of the image being installed, when known. */
  imageBytes?: number | null;
}

/**
 * True when firmware `version` predates the larger staging layout, and so
 * enforces the legacy cap. Unknown versions return `false` — never claim a
 * device is out of date without knowing.
 */
export function needsOtaLayoutUpgrade(version: string | null | undefined): boolean {
  if (!version) return false;
  return compareVersions(version, OTA_LAYOUT_MIN_VERSION) < 0;
}

/**
 * True when an image is too large for a pre-{@link OTA_LAYOUT_MIN_VERSION}
 * device to stage. Exported so a pre-flight check can warn before the download
 * rather than after the handshake.
 */
export function exceedsLegacyOtaCap(imageBytes: number | null | undefined): boolean {
  return typeof imageBytes === "number" && imageBytes > OTA_LEGACY_MAX_BYTES;
}

/** Bytes as whole KiB, for a message the user can compare against a cap. */
function kib(bytes: number): string {
  return `${Math.round(bytes / 1024)} KiB`;
}

/**
 * Explain a failed firmware update, or return `null` when there is nothing to
 * add and the caller should show the raw error.
 *
 * Only `SIZE` gets special treatment: every other token either means something
 * went wrong mid-transfer (retry) or is already self-explanatory.
 */
export function explainFirmwareFailure(
  error: unknown,
  context: FirmwareFailureContext = {},
): FirmwareFailureExplanation | null {
  if (!(error instanceof FirmwareProtocolError) || error.reason !== "SIZE") {
    return null;
  }

  const { installedVersion, imageBytes } = context;
  const size = typeof imageBytes === "number" ? ` (${kib(imageBytes)})` : "";

  // The device told us its version, and it is old enough to be the cause —
  // name it, so the user isn't left guessing which of their units is behind.
  if (needsOtaLayoutUpgrade(installedVersion)) {
    return {
      needsLayoutUpgrade: true,
      message:
        `This device is on v${installedVersion}, whose update layout can't accept an image this large${size}. ` +
        `Install v${OTA_LAYOUT_MIN_VERSION} first — it fits, and it unlocks the larger updates. Then retry this one.`,
    };
  }

  // Version unknown (DIS read failed) but the device rejected on size anyway,
  // so it is almost certainly running the old layout — say so without asserting
  // a version we never read.
  if (!installedVersion) {
    return {
      needsLayoutUpgrade: true,
      message:
        `The device rejected this image as too large${size}. Firmware older than v${OTA_LAYOUT_MIN_VERSION} ` +
        `can only take updates up to ${kib(OTA_LEGACY_MAX_BYTES)} — install v${OTA_LAYOUT_MIN_VERSION} first, then retry.`,
    };
  }

  // Reported new enough to have the bigger region and still refused: this is
  // not the staged-upgrade case, so don't send the user down that path.
  return {
    needsLayoutUpgrade: false,
    message:
      `The device rejected this image as too large${size}, even though it reports v${installedVersion}. ` +
      `It may need updating over USB instead.`,
  };
}
