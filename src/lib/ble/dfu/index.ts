/**
 * Firmware update over BLE (DFU) — public API.
 *
 * The DovesDataLogger (Seeed XIAO nRF52840, Adafruit nRF52 core) speaks the
 * legacy Nordic DFU protocol. This module checks the installed version against
 * the published OTA manifest, downloads the matching package, reboots the device
 * into its bootloader, and flashes the new image — all from the browser.
 *
 * See `docs/plans/firmware-bluetooth-dfu.md`.
 */

export type {
  DeviceFirmwareInfo,
  DfuPackage,
  DfuPackageMeta,
  DfuPhase,
  DfuProgress,
  FirmwareBuild,
  FirmwareManifest,
} from "./dfuTypes";
export {
  DFU_SERVICE_UUID,
  DFU_CONTROL_POINT_UUID,
  DFU_PACKET_UUID,
} from "./dfuTypes";

export {
  DEFAULT_MANIFEST_URL,
  getManifestUrl,
  parseFirmwareManifest,
  pickBuildForVariant,
  compareVersions,
  isUpdateAvailable,
  evaluateFirmwareUpdate,
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

export { flashFirmware } from "./dfuProtocol";
export type { DfuTransport, FlashFirmwareOptions } from "./dfuProtocol";

export { triggerDfuMode, connectToDfu, connectToDfuDevice } from "./dfuTransport";
export type { DfuConnection, ConnectToDfuOptions } from "./dfuTransport";
