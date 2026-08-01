/**
 * Generic logger-connection contract.
 *
 * The app talks to every logger (PerchWerks Fledgling over BLE today; AiM
 * MyChron over Wi-Fi via the native shell, Alfano over BLE — both later) through
 * this one interface, so download UI never has to branch on the transport. Each
 * logger ships an adapter that fulfils `LoggerConnection`; see
 * `fledglingConnection.ts` for the BLE implementation.
 *
 * Kept free of any transport imports (no Web Bluetooth, no Tauri) so it stays on
 * the eager graph without pulling a protocol bundle in.
 */

/** Which physical logger a connection talks to. */
export type LoggerKind = "fledgling" | "mychron" | "alfano";

/** A downloadable log on the device. */
export interface LoggerFile {
  name: string;
  size: number;
  /** Recording date as reported by the device (ISO-ish string), when known. */
  date?: string;
  /** Extra device-reported metadata (e.g. lap count), when available. */
  meta?: Record<string, string>;
}

/** Progress for an in-flight download. */
export interface LoggerDownloadProgress {
  received: number;
  total: number;
  percent: number;
  speed: string;
  eta: string;
}

/** Battery reading from a logger that reports one. */
export interface DeviceBattery {
  percent: number;
  voltage: number;
}

/**
 * The Device-tab surface (settings / tracks / battery) behind one
 * transport-neutral interface, so the tabs never branch on Web Bluetooth vs
 * the native (Tauri) IPC. The Fledgling has two implementations: the Web
 * Bluetooth one wraps `@/lib/ble` (see `bleDetails.ts`), the native one wraps
 * the `logger_*` IPC commands (see `doveslogger/dovesloggerConnection.ts`).
 */
export interface DeviceDetails {
  /** Read the battery state. */
  battery(): Promise<DeviceBattery>;
  /** All device settings as a key → value map (values are strings on the wire). */
  listSettings(): Promise<Record<string, string>>;
  /** Write one setting. */
  setSetting(key: string, value: string): Promise<void>;
  /**
   * Factory-reset the settings. On success the device REBOOTS and the
   * connection is gone — callers must disconnect and reconnect.
   */
  resetSettings(): Promise<void>;
  /** List the track files stored on the device. */
  listTracks(): Promise<string[]>;
  /** Download one track file. */
  getTrack(name: string): Promise<Uint8Array>;
  /** Upload a track file. */
  putTrack(name: string, data: Uint8Array): Promise<void>;
  /** Delete a track file. */
  deleteTrack(name: string): Promise<void>;
}

/**
 * A live connection to a logger. The download surface (`listLogs` /
 * `downloadLog`) is uniform across loggers; logger-specific features (the
 * Fledgling's settings/tracks/firmware tabs) are gated on `supportsDeviceDetails`
 * and reached through `details`.
 */
export interface LoggerConnection {
  /** Which logger this connection talks to. */
  readonly kind: LoggerKind;
  /** Human-friendly device name for headers/toasts. */
  readonly displayName: string;
  /**
   * Whether the in-app Device tab (settings, tracks, firmware OTA) applies to
   * this logger. Only the Fledgling exposes those today.
   */
  readonly supportsDeviceDetails: boolean;
  /** The Device-tab surface, present iff `supportsDeviceDetails`. */
  readonly details?: DeviceDetails;
  /** List the downloadable logs on the device. */
  listLogs(onStatus?: (status: string) => void): Promise<LoggerFile[]>;
  /** Download one log by name, returning its raw bytes. */
  downloadLog(
    name: string,
    onProgress?: (progress: LoggerDownloadProgress) => void,
    onStatus?: (status: string) => void,
  ): Promise<Uint8Array>;
  /** Tear down the connection. Safe to call when already disconnected. */
  disconnect(): void;
}
