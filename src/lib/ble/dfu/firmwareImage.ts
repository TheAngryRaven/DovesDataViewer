/**
 * Acquire a verified firmware image for a manifest build: download (preferring
 * the raw `.bin`, falling back to unzipping the DFU package for older
 * manifests), compute its CRC-32, and verify both against the manifest's
 * published size/CRC — the first link of the full-circle CRC chain, catching a
 * corrupt download before any device is involved.
 *
 * Transport-agnostic: shared by the web (Web Bluetooth SD-staged OTA) and
 * native (Tauri `logger_update_firmware`) update flows.
 */

import { crc32Hex } from "../firmwareCrc";
import { parseDfuPackage } from "./dfuPackage";
import { assertImageMatchesBuild, fetchFirmwarePackage } from "./firmwareManifest";
import type { FirmwareBuild } from "./dfuTypes";

type FetchLike = (input: string) => Promise<Response>;

/** A downloaded, manifest-verified firmware image and its CRC-32 (8-char hex). */
export interface AcquiredFirmwareImage {
  image: Uint8Array;
  crc: string;
}

/**
 * Download + verify the firmware image for `build`. Throws when the download
 * fails or the bytes don't match the manifest's published size/CRC.
 * `fetchImpl` is injectable for tests.
 */
export async function acquireFirmwareImage(
  build: FirmwareBuild,
  fetchImpl?: FetchLike,
): Promise<AcquiredFirmwareImage> {
  const image = build.appBin
    ? new Uint8Array(await fetchFirmwarePackage(build.appBin, fetchImpl))
    : (await parseDfuPackage(await fetchFirmwarePackage(build.dfuZip, fetchImpl))).image;
  const crc = crc32Hex(image);
  assertImageMatchesBuild(build, image, crc);
  return { image, crc };
}
