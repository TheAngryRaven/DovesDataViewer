/**
 * Firmware-update support — public API.
 *
 * Checks the installed version (via the standard DIS) against the published OTA
 * manifest and unpacks the matching package. The actual on-device install is the
 * SD-staged, application-level OTA — the image is uploaded over the `0x1820` file
 * service (`firmwareUpload.ts`) and the device verifies + installs it. The legacy
 * BLE-DFU transport was removed (Chrome blocklists the legacy DFU service).
 *
 * See `docs/plans/firmware-sdcard-ota.md`.
 */

export type {
  DeviceFirmwareInfo,
  DfuPackage,
  DfuPackageMeta,
  FirmwareBuild,
  FirmwareManifest,
} from "./dfuTypes";

export {
  DEFAULT_MANIFEST_URL,
  getManifestUrl,
  parseFirmwareManifest,
  pickBuildForVariant,
  compareVersions,
  isUpdateAvailable,
  evaluateFirmwareUpdate,
  assertImageMatchesBuild,
  fetchFirmwareManifest,
  fetchFirmwarePackage,
} from "./firmwareManifest";
export type {
  FirmwareUpdateEvaluation,
  FirmwareUpdateReason,
} from "./firmwareManifest";

export { parseDfuPackage } from "./dfuPackage";

export {
  DIS_SERVICE_UUID,
  parseVariantFromModel,
  readDeviceFirmwareInfo,
} from "./version";
