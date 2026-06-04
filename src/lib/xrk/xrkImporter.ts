// Public entry point for AiM .xrk/.xrz import — the isolated module the format
// router calls, mirroring the other parsers' `isXxxFormat` / `parseXxxFile`
// contract (async here, because parsing runs in a wasm worker).

import { ParsedData } from "@/types/racing";
import { XRK_EXTENSIONS } from "./xrkConfig";
import { runXrkWorker, type RunXrkOptions } from "./xrkClient";
import { mapXrkToParsedData } from "./xrkMapping";
import type { XrkProgress } from "./xrkTypes";

/** Raw XRK magic: every AiM log begins with a `<h…>` header message. */
const XRK_MAGIC = [0x3c, 0x68]; // "<h"

/**
 * Detect an AiM XRK/XRZ file. The filename extension is authoritative when
 * present (`.xrk`/`.xrz`); otherwise a raw `<h` magic sniff catches an
 * extension-less uncompressed log. `.xrz` is zlib-compressed, so it has no
 * stable text magic — we rely on the extension for it.
 */
export function isXrkFile(fileName: string, buffer?: ArrayBuffer): boolean {
  const lower = fileName.toLowerCase();
  if (XRK_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;

  if (buffer && buffer.byteLength >= XRK_MAGIC.length) {
    const head = new Uint8Array(buffer, 0, XRK_MAGIC.length);
    if (XRK_MAGIC.every((b, i) => head[i] === b)) return true;
  }
  return false;
}

export type XrkProgressCallback = (progress: XrkProgress) => void;

/**
 * Parse an AiM `.xrk`/`.xrz` `File` into the app's `ParsedData`. Heavy lifting
 * (libxrk wasm) runs in a worker; this just orchestrates and maps the
 * result. Throws a user-facing `Error` on failure — never crashes the caller.
 */
export async function parseXrkFile(
  file: File,
  onProgress?: XrkProgressCallback,
): Promise<ParsedData> {
  const options: RunXrkOptions = onProgress ? { onProgress } : {};
  const raw = await runXrkWorker(file, options);
  return mapXrkToParsedData(raw, file.name);
}
