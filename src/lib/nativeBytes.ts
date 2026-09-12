/**
 * Bytes across the native (Tauri) bridge, WebView → shell direction.
 *
 * Tauri's raw-body IPC (`invoke(cmd, bytes, { headers })`) only exists where
 * the WebView can hand the shell a request body, and Android's WebView
 * cannot: there Tauri falls back to `window.ipc.postMessage`, which
 * serializes a `Uint8Array` payload as a JSON *array of numbers* (~4× the
 * text, one heap value per byte on the Rust side) — and a raw-body command
 * rejects it outright. That is how the first on-device export and video-store
 * uploads failed on their very first chunk.
 *
 * So bulk uploads go as base64 strings in ordinary JSON args, in chunks; the
 * shell decodes each in one pass (LapWing `video::job::decode_chunk`). The
 * encoding is `FileReader.readAsDataURL`, which the browser does natively off
 * the main thread — no per-byte JavaScript. Bytes coming *back* (raw
 * `tauri::ipc::Response`) are unaffected; those work everywhere.
 */

/**
 * Upload chunk size. Base64 inflates 4/3, so ~5.3 MB of text per message —
 * big enough that the per-call bridge overhead is noise, small enough that
 * the transient copies (JS string, Java string, Rust string, decoded bytes)
 * stay modest on a phone.
 */
export const NATIVE_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * Base64 (standard alphabet, padded) of raw bytes — pure JS, in 32 KB steps
 * so `btoa` never sees a call-argument list the engine would refuse. The
 * fallback for `blobToBase64` where there is no `FileReader`.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const STEP = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

/** Base64 (standard alphabet, padded) of a Blob's bytes — no data-URL prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader === "undefined") {
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read bytes"));
    reader.onload = () => {
      const url = reader.result;
      if (typeof url !== "string") {
        reject(new Error("Failed to read bytes"));
        return;
      }
      // "data:<mime>;base64,<payload>" — the mime varies with the Blob's type.
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : "");
    };
    reader.readAsDataURL(blob);
  });
}
