/**
 * Alfano native (Bluetooth-serial) adapter — wraps the native (Tauri) transport
 * in the generic `LoggerConnection` surface so the download UI never branches on
 * transport. Mirrors `doveslogger/dovesloggerConnection.ts`. SKELETON: the
 * download/list commands resolve against a Rust backend that is still TBD.
 *
 * Importing this module pulls the native IPC client (and, lazily, Tauri) in, so
 * only the lazy native Alfano flow should reference it — never the eager picker.
 * Connection establishment (`loggerScan` / `loggerConnect`) happens in the UI;
 * this factory adapts an already-connected device.
 */

import type { LoggerConnection } from "../types";
import { computeProgress } from "../progress";
import {
  type LoggerDeviceInfo,
  loggerListFiles,
  loggerDownloadFile,
  loggerDisconnect,
} from "./ipc";

/** Adapt a connected Alfano (described by `info`) to the generic logger interface. */
export function createAlfanoConnection(info: LoggerDeviceInfo): LoggerConnection {
  return {
    kind: "alfano",
    displayName: info.name ?? info.model ?? "Alfano",
    // No in-app settings/tracks/firmware surfaces for Alfano — download only.
    supportsDeviceDetails: false,
    listLogs: async () => {
      const files = await loggerListFiles();
      return files.map((f) => ({ name: f.name, size: f.size, date: f.date, meta: f.meta }));
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
