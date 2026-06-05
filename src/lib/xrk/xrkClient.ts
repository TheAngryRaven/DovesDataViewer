// Main-thread client for the XRK wasm worker.
//
// Spawns a short-lived module worker, hands it the file bytes (transferred), and
// resolves with the raw parsed channels — surfacing progress along the way. The
// worker is always terminated when we're done (success, error, or timeout).

import type {
  XrkParseRequest,
  XrkProgress,
  XrkRawResult,
  XrkWorkerMessage,
} from "./xrkTypes";

/** Hard ceiling so a wedged worker can never hang the import UI forever. */
const PARSE_TIMEOUT_MS = 2 * 60_000;

export interface RunXrkOptions {
  onProgress?: (progress: XrkProgress) => void;
}

/**
 * Parse one `.xrk`/`.xrz` file in a worker and resolve with the raw channel
 * arrays. Rejects with a user-facing `Error` on any worker failure or timeout.
 */
export async function runXrkWorker(
  file: File,
  options: RunXrkOptions = {},
): Promise<XrkRawResult> {
  const buffer = await file.arrayBuffer();

  const worker = new Worker(new URL("./xrkWorker.ts", import.meta.url), {
    type: "module",
    name: "xrk-parser",
  });

  return new Promise<XrkRawResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("Timed out parsing XRK file")));
    }, PARSE_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<XrkWorkerMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "progress":
          options.onProgress?.(msg.progress);
          break;
        case "result":
          finish(() => resolve(msg.result));
          break;
        case "error":
          finish(() => reject(new Error(msg.message)));
          break;
      }
    };

    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || "XRK worker crashed")));
    };

    const request: XrkParseRequest = {
      type: "parse",
      fileName: file.name,
      buffer,
    };
    worker.postMessage(request, [buffer]);
  });
}
