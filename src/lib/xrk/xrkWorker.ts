/// <reference lib="webworker" />
// Web Worker: parses AiM .xrk/.xrz in-browser via libxrk's wasm core.
//
// Runs off the main thread so building the channel arrays for a large session
// never janks the UI. Flow: instantiate the wasm module once → libxrk parses the
// bytes → resample channels onto the GPS timebase → ship back as transferable
// Float64 buffers. Any failure becomes a single `error` message (the page must
// never crash on a bad file).

import init, { parse_xrk } from "./wasm/xrk_wasm.js";
// Vite resolves this to the hashed, served URL of the wasm asset.
import wasmUrl from "./wasm/xrk_wasm_bg.wasm?url";
import { wasmResultToRaw, type XrkWasmResult } from "./xrkResample";
import type {
  XrkParseRequest,
  XrkProgress,
  XrkWorkerMessage,
} from "./xrkTypes";

declare const self: DedicatedWorkerGlobalScope;

let wasmReady: Promise<void> | null = null;

/** Instantiate the wasm module exactly once per worker. */
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = init({ module_or_path: wasmUrl }).then(() => undefined);
  }
  return wasmReady;
}

function post(message: XrkWorkerMessage, transfer?: Transferable[]) {
  self.postMessage(message, transfer ?? []);
}

function progress(progress: XrkProgress) {
  post({ type: "progress", progress });
}

async function parse(req: XrkParseRequest): Promise<void> {
  progress({ phase: "boot", message: "Loading XRK parser…" });
  await ensureWasm();

  progress({ phase: "parse", message: "Parsing telemetry…" });
  const wasmResult = parse_xrk(new Uint8Array(req.buffer)) as XrkWasmResult;

  progress({ phase: "extract", message: "Aligning channels…" });
  const result = wasmResultToRaw(wasmResult);

  const transfer: Transferable[] = [
    result.timecodes.buffer,
    ...result.channels.map((c) => c.values.buffer),
  ];
  progress({ phase: "done", message: "Done" });
  post({ type: "result", result }, transfer);
}

self.onmessage = (event: MessageEvent<XrkParseRequest>) => {
  const req = event.data;
  if (req?.type !== "parse") return;
  parse(req).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: "error", message });
  });
};
