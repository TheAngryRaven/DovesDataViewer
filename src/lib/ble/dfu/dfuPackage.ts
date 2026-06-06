/**
 * Parse a legacy Adafruit/Nordic DFU `.zip` package into a flashable form.
 *
 * Package layout (from `adafruit-nrfutil dfu genpkg`):
 *   <app>.bin       application image
 *   <app>.dat       legacy init packet (14 bytes)
 *   manifest.json   { manifest: { application: { bin_file, dat_file, init_packet_data }, dfu_version } }
 *
 * Deterministic given input bytes (no network, no BLE) — unit-tested by
 * round-tripping a zip built in-memory with the same `jszip` dependency.
 */

import JSZip from "jszip";
import type { DfuPackage, DfuPackageMeta } from "./dfuTypes";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Parse a DFU package zip (ArrayBuffer/Uint8Array) into image + init packet. */
export async function parseDfuPackage(
  zipData: ArrayBuffer | Uint8Array,
): Promise<DfuPackage> {
  const zip = await JSZip.loadAsync(zipData);

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    throw new Error("DFU package is missing manifest.json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await manifestFile.async("string"));
  } catch {
    throw new Error("DFU package manifest.json is not valid JSON");
  }

  const root = isRecord(parsed) ? parsed.manifest : undefined;
  const application = isRecord(root) ? root.application : undefined;
  if (!isRecord(application)) {
    // Only the application image is supported (no SoftDevice/bootloader OTA).
    throw new Error("DFU package manifest has no 'application' section");
  }

  const binFile = application.bin_file;
  const datFile = application.dat_file;
  if (typeof binFile !== "string" || typeof datFile !== "string") {
    throw new Error("DFU package manifest is missing bin_file/dat_file");
  }

  const binEntry = zip.file(binFile);
  const datEntry = zip.file(datFile);
  if (!binEntry) throw new Error(`DFU package is missing image file: ${binFile}`);
  if (!datEntry) throw new Error(`DFU package is missing init packet: ${datFile}`);

  const [image, initPacket] = await Promise.all([
    binEntry.async("uint8array"),
    datEntry.async("uint8array"),
  ]);

  if (image.byteLength === 0) {
    throw new Error("DFU package application image is empty");
  }

  const init = isRecord(application.init_packet_data)
    ? application.init_packet_data
    : {};
  const softdeviceReqRaw = (init as Record<string, unknown>).softdevice_req;
  const softdeviceReq = Array.isArray(softdeviceReqRaw)
    ? softdeviceReqRaw.filter((n): n is number => typeof n === "number")
    : undefined;

  const meta: DfuPackageMeta = {
    binFile,
    datFile,
    dfuVersion: numOrUndef(isRecord(root) ? root.dfu_version : undefined) ?? 0,
    deviceType: numOrUndef((init as Record<string, unknown>).device_type),
    deviceRevision: numOrUndef((init as Record<string, unknown>).device_revision),
    applicationVersion: numOrUndef(
      (init as Record<string, unknown>).application_version,
    ),
    firmwareCrc16: numOrUndef((init as Record<string, unknown>).firmware_crc16),
    softdeviceReq,
  };

  return { image, initPacket, meta };
}
