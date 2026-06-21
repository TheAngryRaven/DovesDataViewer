/**
 * AiM MyChron adapter — wraps the native (Tauri) Wi-Fi transport in the generic
 * `LoggerConnection` surface so the download UI never branches on transport.
 * Mirrors `fledglingConnection.ts` (BLE).
 *
 * Importing this module pulls the native IPC client (and, lazily, Tauri) in, so
 * only the lazy MyChron download flow should reference it — never the eager
 * picker. Connection establishment (`loggerConnect`) happens in the UI; this
 * factory adapts an already-connected device, just like `createFledglingConnection`
 * takes a live BLE handle.
 */

import type { LoggerConnection } from "../types";
import { computeProgress } from "../progress";
import {
  type LoggerDeviceInfo,
  loggerListFiles,
  loggerDownloadFile,
  loggerDisconnect,
} from "./ipc";

/** Adapt a connected MyChron (described by `info`) to the generic logger interface. */
export function createMychronConnection(info: LoggerDeviceInfo): LoggerConnection {
  return {
    kind: "mychron",
    displayName: info.name ?? info.model ?? "AiM MyChron",
    // No in-app Device tab (settings/tracks/firmware) for MyChron.
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
