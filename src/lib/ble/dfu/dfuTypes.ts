/**
 * Shared types, enums and UUIDs for the BLE firmware-update (DFU) flow.
 *
 * The DovesDataLogger is a Seeed XIAO nRF52840 running the Adafruit nRF52 core,
 * so it speaks the **legacy** (SDK-11-era) Nordic DFU protocol — *not* Secure
 * DFU. These constants/enums describe that legacy protocol and the Adafruit
 * buttonless DFU service used to reboot the board into its bootloader.
 *
 * See `docs/plans/firmware-bluetooth-dfu.md` for the full design + verification.
 */

// ---------------------------------------------------------------------------
// BLE UUIDs
// ---------------------------------------------------------------------------

/**
 * Adafruit buttonless DFU service (advertised by the running app AND the
 * bootloader). Note the Adafruit base UUID `…785FEABCD123` — distinct from the
 * older Nordic `…785FEEF13D00` base. Web Bluetooth requires lowercase.
 */
export const DFU_SERVICE_UUID = "00001530-1212-efde-1523-785feabcd123";
/** DFU control point — write op-codes here, receive responses via notify. */
export const DFU_CONTROL_POINT_UUID = "00001531-1212-efde-1523-785feabcd123";
/** DFU packet — image sizes / init packet / firmware bytes (write-no-response). */
export const DFU_PACKET_UUID = "00001532-1212-efde-1523-785feabcd123";
/** DFU revision — reads `0x0001` in app mode (buttonless), absent in bootloader. */
export const DFU_REVISION_UUID = "00001534-1212-efde-1523-785feabcd123";

// ---------------------------------------------------------------------------
// Legacy DFU protocol enums
// ---------------------------------------------------------------------------

/** Control-point op-codes (legacy DFU). */
export enum DfuOpCode {
  Start = 0x01,
  InitParams = 0x02,
  ReceiveFirmware = 0x03,
  Validate = 0x04,
  ActivateAndReset = 0x05,
  Reset = 0x06,
  ReportReceivedSize = 0x07,
  PacketReceiptRequest = 0x08,
  /** Prefix byte of a control-point *response* notification. */
  Response = 0x10,
  /** Prefix byte of a packet-receipt notification. */
  PacketReceiptNotification = 0x11,
}

/** Image-type selector sent with {@link DfuOpCode.Start}. */
export enum DfuImageType {
  SoftDevice = 0x01,
  Bootloader = 0x02,
  SoftDeviceAndBootloader = 0x03,
  Application = 0x04,
}

/** Sub-op of {@link DfuOpCode.InitParams}. */
export enum DfuInitParam {
  ReceiveInitPacket = 0x00,
  InitPacketComplete = 0x01,
}

/** Status byte in a control-point response notification. */
export enum DfuResponseStatus {
  Success = 0x01,
  InvalidState = 0x02,
  NotSupported = 0x03,
  DataSizeExceedsLimit = 0x04,
  CrcError = 0x05,
  OperationFailed = 0x06,
}

// ---------------------------------------------------------------------------
// Firmware manifest (the OTA index served from GitHub Pages)
// ---------------------------------------------------------------------------

/** A single build entry under `manifest.builds`. */
export interface FirmwareBuild {
  /** The `builds` key, e.g. "BirdsEye-sense". */
  name: string;
  /** Variant id, e.g. "sense" / "nonsense". */
  variant: string;
  /** URL to the legacy DFU `.zip` package. */
  dfuZip: string;
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
// DFU package (contents of one `dfuZip`)
// ---------------------------------------------------------------------------

/** Metadata parsed from a DFU package's inner `manifest.json`. */
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

/** A parsed, ready-to-flash DFU package. */
export interface DfuPackage {
  /** Application image (`.bin`). */
  image: Uint8Array;
  /** Legacy init packet (`.dat`, 14 bytes). */
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

// ---------------------------------------------------------------------------
// Flash progress
// ---------------------------------------------------------------------------

export type DfuPhase =
  | "starting"
  | "init"
  | "transferring"
  | "validating"
  | "activating"
  | "done";

/** Progress payload emitted during a flash. */
export interface DfuProgress {
  phase: DfuPhase;
  bytesSent: number;
  totalBytes: number;
  /** 0–100, based on firmware-image bytes transferred. */
  percent: number;
}
