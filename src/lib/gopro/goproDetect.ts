/**
 * Cheap GoPro-video gates (plan 0029). Split from the importer because the
 * eager file-routing code (`datalogParser`, `FileImport`) needs to *recognise*
 * a video on every import, while the MP4/GPMF extractor itself only loads
 * when one actually arrives — keeping it off the main chunk.
 */

/** Containers a GoPro writes; `.360` is the MAX/Fusion spherical variant. */
const GOPRO_VIDEO_EXTENSIONS = [".mp4", ".mov", ".360"];

/** Name-based gate used before any bytes are read. */
export function isGoProVideoFile(name: string): boolean {
  const lower = name.toLowerCase();
  return GOPRO_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** True when the buffer opens with an ISO-BMFF `ftyp` box (MP4/MOV/.360). */
export function isIsoBmff(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer);
  return String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7)) === "ftyp";
}

/** True for an in-memory MP4/MOV — the sync content router refuses these. */
export function isGoProVideoBuffer(buffer: ArrayBuffer): boolean {
  return isIsoBmff(buffer);
}
