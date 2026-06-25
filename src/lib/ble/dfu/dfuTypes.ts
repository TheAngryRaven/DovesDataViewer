/**
 * Shared types for the firmware-update flow.
 *
 * The published OTA package is still a Nordic "DFU" zip (we extract the
 * application `.bin` from it), but the on-device install is the SD-staged,
 * application-level OTA — see `docs/plans/0002-firmware-sdcard-ota.md`. The legacy
 * BLE-DFU transport was removed (Chrome blocklists the legacy DFU service); the
 * image is uploaded over the `0x1820` file service (see `firmwareUpload.ts`).
 */

// ---------------------------------------------------------------------------
// Firmware manifest (the OTA index served from GitHub Pages)
// ---------------------------------------------------------------------------

/** A single build entry under `manifest.builds`. */
export interface FirmwareBuild {
  /** The `builds` key, e.g. "BirdsEye-sense". */
  name: string;
  /** Variant id, e.g. "sense" / "nonsense". */
  variant: string;
  /** URL to the firmware `.zip` package (legacy / fallback source for the image). */
  dfuZip: string;
  /** Direct URL to the raw application `.bin` (preferred — no unzip needed). */
  appBin?: string;
  /** Publisher's CRC-32/IEEE of the `.bin`, 8-char hex — verified after download. */
  appCrc32?: string;
  /** Expected `.bin` size in bytes — verified after download. */
  appSize?: number;
}

/** The top-level OTA manifest (`manifest.json`). */
export interface FirmwareManifest {
  version: string;
  releaseTag?: string;
  publishedAt?: string;
  releaseNotes?: string;
  builds: Record<string, FirmwareBuild>;
}

// ---------------------------------------------------------------------------
// Firmware package (contents of one `dfuZip`)
// ---------------------------------------------------------------------------

/** Metadata parsed from a package's inner `manifest.json`. */
export interface DfuPackageMeta {
  binFile: string;
  datFile: string;
  dfuVersion: number;
  deviceType?: number;
  deviceRevision?: number;
  applicationVersion?: number;
  firmwareCrc16?: number;
  softdeviceReq?: number[];
}

/** A parsed firmware package. The SD-staged flow uses `image` (the app `.bin`). */
export interface DfuPackage {
  /** Application image (`.bin`) — uploaded to the device and CRC-checked. */
  image: Uint8Array;
  /** Legacy init packet (`.dat`); retained as metadata, unused by SD-staged OTA. */
  initPacket: Uint8Array;
  meta: DfuPackageMeta;
}

// ---------------------------------------------------------------------------
// Device-reported firmware info (read from the Device Information Service)
// ---------------------------------------------------------------------------

/** Firmware identity read off the standard DIS (`0x180A`). */
export interface DeviceFirmwareInfo {
  /** DIS Firmware Revision (`0x2A26`), e.g. "2.1.0". `null` if unreadable. */
  version: string | null;
  /** Raw DIS Model Number (`0x2A24`), e.g. "BirdsEye-sense". `null` if absent. */
  model: string | null;
  /** Variant parsed from the model (e.g. "sense"). `null` if not derivable. */
  variant: string | null;
  /** DIS Manufacturer (`0x2A29`), e.g. "DovesDataLogger". `null` if absent. */
  manufacturer: string | null;
}
