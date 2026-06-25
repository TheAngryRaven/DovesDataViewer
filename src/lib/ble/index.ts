/**
 * BLE Datalogger public API.
 *
 * Re-exports the surface from per-protocol modules. Internals (UUIDs, debug
 * logging) live in `./internal` and are intentionally not re-exported.
 *
 * Existing import sites can use either `@/lib/bleDatalogger` (legacy barrel)
 * or `@/lib/ble`. New code should prefer the latter.
 */

export type {
  BleConnection,
  FileInfo,
  DownloadProgress,
  BatteryInfo,
} from "./types";

export { formatBytes, formatSpeed, formatTime } from "./format";
export { isBleSupported, connectToDevice, disconnect } from "./connection";
export { requestFileList, downloadFile } from "./fileTransfer";
export { requestBatteryLevel } from "./battery";
export {
  requestSettingsList,
  getDeviceSetting,
  setDeviceSetting,
  resetDeviceSettings,
} from "./settings";
export {
  requestTrackFileList,
  downloadTrackFile,
  uploadTrackFile,
  deleteTrackFile,
} from "./trackSync";

// SD-staged firmware update (see docs/plans/0002-firmware-sdcard-ota.md)
export { crc32, crc32Hex } from "./firmwareCrc";
export {
  beginFirmwareUpdate,
  uploadFirmwareImage,
  applyFirmware,
} from "./firmwareUpload";
export type {
  FirmwareUploadProgress,
  BeginOptions,
  UploadOptions,
  ApplyOptions,
} from "./firmwareUpload";
