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

/**
 * A live connection to a logger. The download surface (`listLogs` /
 * `downloadLog`) is uniform across loggers; logger-specific features (the
 * Fledgling's settings/tracks/firmware tabs) are gated on `supportsDeviceDetails`
 * and reach for their own transport directly.
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
