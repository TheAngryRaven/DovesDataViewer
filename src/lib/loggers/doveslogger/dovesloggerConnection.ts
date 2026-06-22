/**
 * PerchWerks DovesLogger (Fledgling) native-BLE adapter — wraps the native
 * (Tauri) BLE transport in the generic `LoggerConnection` surface so the download
 * UI never branches on transport. Mirrors `mychron/mychronConnection.ts`.
 *
 * Importing this module pulls the native IPC client (and, lazily, Tauri) in, so
 * only the lazy native DovesLogger flow should reference it — never the eager
 * picker. Connection establishment (`loggerScan` / `loggerConnect`) happens in the
 * UI; this factory adapts an already-connected device, just like
 * `createMychronConnection` takes a connected device's `info`.
 */

import type { LoggerConnection } from "../types";
import { computeProgress } from "../progress";
import {
  type LoggerDeviceInfo,
  loggerListFiles,
  loggerDownloadFile,
  loggerDisconnect,
} from "./ipc";

/** Adapt a connected DovesLogger (described by `info`) to the generic logger interface. */
export function createDovesloggerConnection(info: LoggerDeviceInfo): LoggerConnection {
  return {
    // Same physical logger family as the Web Bluetooth Fledgling.
    kind: "fledgling",
    displayName: info.name ?? info.model ?? "PerchWerks Fledgling",
    // Settings / tracks / firmware OTA stay on the Web Bluetooth path for now, so
    // the native BLE connection exposes only the download surface.
    supportsDeviceDetails: false,
    listLogs: async () => {
      const files = await loggerListFiles();
      return files.map((f) => ({ name: f.name, size: f.size }));
    },
    downloadLog: (name, onProgress) => {
      const start = Date.now();
      return loggerDownloadFile(name, ({ received, total }) => {
        onProgress?.(computeProgress(received, total, start));
      });
    },
    disconnect: () => void loggerDisconnect(),
  };
}
