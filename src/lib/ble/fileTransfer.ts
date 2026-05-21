/// <reference types="web-bluetooth" />

import type { BleConnection, FileInfo, DownloadProgress } from "./types";
import { bleLog } from "./internal";
import { formatBytes, formatSpeed, formatTime } from "./format";

/**
 * File list + file download protocol.
 *
 * Commands sent on `fileRequest`:
 *   LIST           -> file list chunks on `fileList`, terminated by "END"
 *   GET:<filename> -> SIZE on `fileStatus`, chunks on `fileData`, terminated by "DONE"
 */

/** Request file list from device. */
export async function requestFileList(
  connection: BleConnection,
  onStatusChange?: (status: string) => void,
): Promise<FileInfo[]> {
  const updateStatus = onStatusChange || (() => {});

  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    let fileListBuffer = "";
    let fileListTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleFileListData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const decoder = new TextDecoder();
      const chunk = decoder.decode(target.value!);

      bleLog(`File list chunk (${chunk.length} bytes):`, chunk);

      // Always accumulate first. END may arrive batched in the same
      // notification as the last data segment (e.g., "...|END") — the prior
      // check-first-then-append order dropped that data.
      fileListBuffer += chunk;

      // END is sent as its own field in the `|`-separated list. Match `|END`
      // (or bare `END`) anchored at end-of-buffer, with optional trailing
      // whitespace. Anchoring at end-of-buffer prevents false matches inside
      // filenames that happen to start with "END" (e.g. "ENDURANCE.dove").
      const END_AT_END = /\|?END\s*$/;
      if (END_AT_END.test(fileListBuffer)) {
        bleLog("END MARKER DETECTED");
        const cleanBuffer = fileListBuffer.replace(END_AT_END, "");
        cleanup();
        resolve(parseFileList(cleanBuffer));
        return;
      }

      // Reset timeout - if no data for 2s, assume complete
      // BLE has small MTU (~20 bytes) so large file lists arrive in many chunks
      // with possible gaps between notifications
      if (fileListTimeout) clearTimeout(fileListTimeout);
      fileListTimeout = setTimeout(() => {
        bleLog("TIMEOUT - Assuming complete");
        if (fileListBuffer.length > 0) {
          cleanup();
          resolve(parseFileList(fileListBuffer));
        }
      }, 2000);
    };

    const cleanup = () => {
      if (fileListTimeout) clearTimeout(fileListTimeout);
      connection.characteristics.fileList.removeEventListener(
        "characteristicvaluechanged",
        handleFileListData,
      );
    };

    try {
      // Setup notification listener
      await connection.characteristics.fileList.startNotifications();
      connection.characteristics.fileList.addEventListener(
        "characteristicvaluechanged",
        handleFileListData,
      );

      updateStatus("Requesting file list...");

      // Send LIST command
      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode("LIST"));

      // Timeout after 10 seconds if no response
      setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for file list"));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Parse "name:size|name:size|..." into FileInfo[], skipping SETTINGS.json. */
function parseFileList(fileListStr: string): FileInfo[] {
  const files: FileInfo[] = [];
  const entries = fileListStr.split("|");

  entries.forEach((entry) => {
    if (entry.trim()) {
      const [name, sizeStr] = entry.split(":");
      if (name && sizeStr) {
        files.push({
          name: name.trim(),
          size: parseInt(sizeStr, 10),
        });
      }
    }
  });

  // Exclude non-log files (e.g. SETTINGS.json) from the download list
  return files.filter((f) => f.name.toUpperCase() !== "SETTINGS.JSON");
}

/**
 * Download a file from the device.
 *
 * Optimized for high-throughput BLE transfers (125+ kBps burst rates).
 * Chunks are buffered into a typed array queue with a running byte counter —
 * no O(n) reduce on every notification. UI updates are throttled to rAF cadence
 * so the notification handler never blocks on DOM work.
 */
export async function downloadFile(
  connection: BleConnection,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
  onStatusChange?: (status: string) => void,
): Promise<Uint8Array> {
  const updateStatus = onStatusChange || (() => {});
  const updateProgress = onProgress || (() => {});

  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; preserve original semantics during the split
  return new Promise(async (resolve, reject) => {
    const receivedData: Uint8Array[] = [];
    let totalReceived = 0;
    let expectedFileSize = 0;
    let transferStartTime = Date.now();
    let progressRafId = 0;
    let progressDirty = false;
    let resolved = false;

    // Throttled progress updater — runs at most once per animation frame
    const scheduleProgressUpdate = () => {
      if (progressDirty || progressRafId) return;
      progressDirty = true;
      progressRafId = requestAnimationFrame(() => {
        progressRafId = 0;
        progressDirty = false;
        if (resolved) return;

        const percent = expectedFileSize > 0 ? (totalReceived / expectedFileSize) * 100 : 0;
        const elapsedSeconds = (Date.now() - transferStartTime) / 1000;
        const overallSpeed = elapsedSeconds > 0 ? totalReceived / elapsedSeconds : 0;
        const remainingBytes = expectedFileSize - totalReceived;
        const etaSeconds = overallSpeed > 0 ? remainingBytes / overallSpeed : 0;

        updateProgress({
          received: totalReceived,
          total: expectedFileSize,
          percent,
          speed: formatSpeed(overallSpeed),
          eta: formatTime(etaSeconds),
        });

        updateStatus(
          `Receiving: ${formatBytes(totalReceived)} / ${formatBytes(expectedFileSize)} ` +
            `(${percent.toFixed(1)}%)`,
        );
      });
    };

    // Hot path — called for every BLE data notification (up to 10x per loop).
    // Must be as lean as possible: push chunk, bump counter, schedule deferred UI.
    const handleFileData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const dv = target.value!;
      // Copy the DataView buffer — BLE reuses the underlying ArrayBuffer
      const chunk = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
      receivedData.push(chunk);
      totalReceived += chunk.length;
      scheduleProgressUpdate();
    };

    const statusDecoder = new TextDecoder();

    const handleStatusData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const status = statusDecoder.decode(target.value!);

      bleLog("Status:", status);

      if (status.startsWith("SIZE:")) {
        expectedFileSize = parseInt(status.substring(5), 10);
        updateStatus(`Receiving ${filename} (${formatBytes(expectedFileSize)})...`);
      } else if (status === "DONE") {
        resolved = true;
        if (progressRafId) {
          cancelAnimationFrame(progressRafId);
          progressRafId = 0;
        }
        cleanup();
        // Assemble final file in one pass from buffered chunks
        const fileData = new Uint8Array(totalReceived);
        let offset = 0;
        for (let i = 0; i < receivedData.length; i++) {
          fileData.set(receivedData[i], offset);
          offset += receivedData[i].length;
        }
        resolve(fileData);
      } else if (status === "ERROR") {
        resolved = true;
        if (progressRafId) {
          cancelAnimationFrame(progressRafId);
          progressRafId = 0;
        }
        cleanup();
        reject(new Error("Error opening file on device"));
      }
    };

    const cleanup = () => {
      connection.characteristics.fileData.removeEventListener(
        "characteristicvaluechanged",
        handleFileData,
      );
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handleStatusData,
      );
    };

    try {
      // Setup notification listeners
      await connection.characteristics.fileData.startNotifications();
      connection.characteristics.fileData.addEventListener(
        "characteristicvaluechanged",
        handleFileData,
      );

      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handleStatusData,
      );

      updateStatus(`Requesting ${filename}...`);
      transferStartTime = Date.now();

      // Send GET command
      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(
        encoder.encode("GET:" + filename),
      );

      // Timeout after 5 minutes for large files
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (progressRafId) {
            cancelAnimationFrame(progressRafId);
            progressRafId = 0;
          }
          cleanup();
          reject(new Error("Download timeout"));
        }
      }, 300000);
    } catch (error) {
      resolved = true;
      if (progressRafId) {
        cancelAnimationFrame(progressRafId);
        progressRafId = 0;
      }
      cleanup();
      reject(error);
    }
  });
}
